"""The read-only domain-quality evaluation CLI.

Nothing here touches the network: the Qresp reader and the Semantic Scholar
provider are both stubbed, and one test asserts that a run without --live
cannot make an external request at all.

The privacy assertions matter as much as the arithmetic. This tool reads a
real instance's public API, and the payloads it reads carry curator names,
emails, file-server paths and file names that must never reach a file it
writes.
"""
import io
import json
import os
import shutil
import tempfile
import unittest
from unittest import mock

from project import related
from project import relatedness as R
from project.tools import eval_core as core
from project.tools import related_eval


# --------------------------------------------------------------- fixtures

def search_record(index, title, abstract, doi=None, tags=(), collections=(),
                  publication="Journal of Placeholder Science", year=2020,
                  authors="Robin Sharedname, Casey Otherperson"):
    """A record in the LEGACY /api/search shape, name-mangled keys and all."""
    return {
        "_Search__id": "id%02d" % index,
        "_Search__title": title,
        "_Search__abstract": abstract,
        "_Search__doi": doi if doi is not None else "10.1000/id%02d" % index,
        "_Search__tags": list(tags),
        "_Search__collections": list(collections) or ["MICCOM"],
        "_Search__publication": publication,
        "_Search__year": year,
        "_Search__authors": authors,
        # Everything below is in the real payload and must never come out.
        "_Search__serverPath": "https://notebook.rcc.uchicago.edu/files/x",
        "_Search__fileServerPath": "https://files.example.org/secret",
        "_Search__folderAbsolutePath": "/project/secret/folder",
        "_Search__downloadPath": "https://internal.example.org/download",
        "_Search__notebookPath": "notebooks/private.ipynb",
        "_Search__notebookFile": "private-notebook.ipynb",
    }


def rich_corpus(count=6):
    """Records that genuinely relate to each other, so the gate has something
    to accept."""
    records = []
    for i in range(count):
        records.append(search_record(
            i,
            "Rareword resonance of gadgetite lattices variant %s"
            % "abcdefgh"[i],
            "Rareword resonance in gadgetite lattices is probed with a "
            "cryogenic spectrometer and a tunable oscillator of adjustable "
            "frequency across a wide temperature range. The resonance "
            "linewidth narrows monotonically as the gadgetite lattice cools, "
            "and the oscillator tracks the shift without recalibration.",
            tags=["rareword resonance", "gadgetite"],
            collections=["MICCOM" if i % 2 else "Other"]))
    return records


DETAILS = {
    "title": "Rareword resonance of gadgetite lattices variant a",
    "abstract": "Rareword resonance in gadgetite lattices.",
    "doi": "10.1000/id00",
    "tags": ["rareword resonance"],
    "collections": ["MICCOM"],
    "charts": [{"caption": "Resonance sweep", "properties": ["frequency"],
                "imageFile": "charts/secret-image.png",
                "files": ["charts/private.csv"]}],
    "datasets": [{"readme": "Sweep data", "keywords": ["diffraction"],
                  "files": ["datasets/private.dat"],
                  "URLs": ["https://notebook.rcc.uchicago.edu/files/x"]}],
    "scripts": [],
    "tools": [{"packageName": "RarePackage", "measurement": "spectroscopy",
               "URLs": ["https://internal.example.org/tool"]}],
    # Curator identity, present in the real details payload.
    "firstName": "Curator", "lastName": "Person",
    "emailId": "curator@example.com", "affiliation": "Somewhere",
    "fileServerPath": "https://files.example.org/secret",
    "downloadPath": "https://internal.example.org/download",
    "notebookFile": "private-notebook.ipynb",
}


class FakeResponse:
    def __init__(self, payload, status_code=200, headers=None):
        self._payload = payload
        self.status_code = status_code
        self.headers = headers or {}

    def json(self):
        if self._payload is None:
            raise ValueError("not json")
        return self._payload


class FakeQrespSession:
    """Stands in for the single `requests.Session` a run uses.

    Production points that one session at both Qresp and the provider (the
    provider calls arrive wrapped in PolitesClient), so the fake routes on
    host exactly the same way.
    """

    def __init__(self, records, details=None, provider=None):
        self.records = records
        self.details = details if details is not None else DETAILS
        self.provider = provider
        self.calls = []

    def get(self, url, params=None, headers=None, timeout=None, verify=True):
        self.calls.append(url)
        if url.startswith(related.SEMANTIC_SCHOLAR_ORIGIN):
            if self.provider is None:
                return FakeResponse({}, 503)
            return self.provider.get(url, params=params, headers=headers,
                                     timeout=timeout)
        if url.endswith("/api/search"):
            return FakeResponse(self.records)
        if "/api/paper/" in url:
            return FakeResponse(dict(self.details))
        return FakeResponse({}, 404)


def recommendation(title, abstract, doi=None, paper_id=None, year=2022):
    return {
        "paperId": paper_id or (doi or title).replace("/", "_"),
        "title": title,
        "abstract": abstract,
        "year": year,
        "externalIds": {"DOI": doi} if doi else {},
        "authors": [{"name": "Someone Else", "authorId": "A1",
                     "homepage": "https://example.org/person"}],
        "fieldsOfStudy": ["Physics"],
        # Volunteered by the real provider; must not survive.
        "openAccessPdf": {"url": "https://example.org/secret.pdf"},
        "citationCount": 42,
        "embedding": [0.1, 0.2],
    }


class FakeProvider:
    """Stands in for `project.related.requests`."""

    def __init__(self, candidates=None):
        self.calls = []
        self.candidates = candidates if candidates is not None else [
            recommendation(
                "Rareword resonance in gadgetite single crystals",
                "Rareword resonance of gadgetite lattices measured with a "
                "cryogenic spectrometer and a tunable oscillator across a "
                "wide temperature range.",
                doi="10.2000/external-a"),
            recommendation(
                "A study of data analysis in another discipline",
                "This study presents a simulation and a data analysis.",
                doi="10.2000/external-b"),
        ]

    def get(self, url, params=None, headers=None, timeout=None):
        self.calls.append({"url": url, "params": params or {},
                           "headers": headers or {}})
        if url.startswith(related.SEMANTIC_SCHOLAR_RECOMMENDATIONS_URL):
            return FakeResponse({"recommendedPapers": self.candidates})
        if url.startswith(related.SEMANTIC_SCHOLAR_TITLE_MATCH_URL):
            return FakeResponse({"data": [{
                "paperId": "S2-TITLE",
                "title": (params or {}).get("query", ""),
                "externalIds": {}}]})
        return FakeResponse({"paperId": "S2-DOI", "title": "x",
                             "externalIds": {}})


# ------------------------------------------------------------- normalization

class TestNormalization(unittest.TestCase):
    def test_legacy_search_keys_are_understood(self):
        record = core.normalize_search_record(search_record(
            1, "A title", "An abstract", doi="10.1/x", tags=["alpha"],
            collections=["MICCOM"], year=2019))
        self.assertEqual("id01", record["id"])
        self.assertEqual("A title", record["title"])
        self.assertEqual("An abstract", record["abstract"])
        self.assertEqual("10.1/x", record["doi"])
        self.assertEqual(["alpha"], record["tags"])
        self.assertEqual(["MICCOM"], record["collections"])
        self.assertEqual(2019, record["year"])

    def test_plain_keys_are_understood_too(self):
        record = core.normalize_search_record({
            "id": "abc", "title": "A title", "abstract": "An abstract",
            "doi": "10.1/x", "tags": ["alpha"], "collections": ["MICCOM"],
            "year": "2019", "authors": "A One, B Two"})
        self.assertEqual("abc", record["id"])
        self.assertEqual(2019, record["year"])
        self.assertEqual(["A One", "B Two"], record["authors"])

    def test_the_canonical_record_is_what_the_gate_expects(self):
        canonical, _ = core.to_canonical_record(
            search_record(1, "Widget dynamics", "About widgets."), DETAILS)
        profile = R.build_internal_profile(canonical)
        self.assertTrue(profile.title)
        self.assertIn("widget", profile.all_terms)
        # The fingerprint must be computable from it as well.
        self.assertRegex(R.metadata_fingerprint(canonical), r"^[0-9a-f]{64}$")

    def test_private_fields_never_enter_the_canonical_record(self):
        canonical, _ = core.to_canonical_record(
            search_record(1, "Widget dynamics", "About widgets."), DETAILS)
        blob = json.dumps(canonical).lower()
        for leak in ("curator@example.com", "rcc.uchicago", "files.example",
                     "internal.example", "notebook", "ipynb", "secret",
                     "folderabsolute", "downloadpath", "imagefile",
                     "private.csv", "private.dat", "affiliation"):
            self.assertNotIn(leak, blob, leak)
        # ...while the scientific artifact metadata IS carried across.
        self.assertEqual([{"caption": "Resonance sweep",
                           "properties": ["frequency"]}], canonical["charts"])
        self.assertEqual("RarePackage", canonical["tools"][0]["packageName"])


# ------------------------------------------------------------------- triage

class TestTriage(unittest.TestCase):
    def triage(self, **kwargs):
        record = core.normalize_search_record(search_record(1, **kwargs))
        return core.triage_record(record)

    def test_a_healthy_record_passes(self):
        status, flags = self.triage(
            title="Rareword resonance of gadgetite lattices",
            abstract="Rareword resonance in gadgetite lattices is probed "
                     "with a cryogenic spectrometer and a tunable oscillator "
                     "over a wide temperature range. The resonance linewidth "
                     "narrows monotonically as the gadgetite lattice cools, "
                     "and the tuned oscillator tracks the shift throughout.")
        self.assertEqual(core.STATUS_OK, status)
        self.assertEqual([], flags)

    def test_obvious_test_records_are_flagged_with_a_reason_not_dropped(self):
        for title in ("STAGING TEST record", "QA placeholder",
                      "asdf", "Untitled draft"):
            status, flags = self.triage(
                title=title, abstract="An abstract with plenty of real words "
                                      "about resonance in lattices measured "
                                      "carefully over temperature ranges.")
            self.assertEqual(core.STATUS_EXCLUDED, status, title)
            codes = {flag["code"] for flag in flags}
            self.assertTrue(codes & {"test_title", "thin_title"}, title)
            # A reason a human can read, always.
            self.assertTrue(all(flag["reason"] for flag in flags), title)

    def test_a_title_and_abstract_from_different_papers_are_flagged(self):
        status, flags = self.triage(
            title="Rareword resonance of gadgetite lattices",
            abstract="Seasonal migration patterns among coastal birds were "
                     "observed across several breeding periods using visual "
                     "counts from fixed stations.")
        self.assertEqual(core.STATUS_EXCLUDED, status)
        self.assertIn("title_abstract_mismatch",
                      {flag["code"] for flag in flags})

    def test_keyboard_mash_tags_are_flagged(self):
        status, flags = self.triage(
            title="Rareword resonance of gadgetite lattices",
            abstract="Rareword resonance in gadgetite lattices probed with a "
                     "cryogenic spectrometer and a tunable oscillator over a "
                     "wide temperature range in this work.",
            tags=["asdf"])
        self.assertEqual(core.STATUS_EXCLUDED, status)
        self.assertIn("test_tags", {flag["code"] for flag in flags})

    def test_a_missing_doi_is_only_worth_reviewing(self):
        status, flags = self.triage(
            title="Rareword resonance of gadgetite lattices", doi="",
            abstract="Rareword resonance in gadgetite lattices probed with a "
                     "cryogenic spectrometer and a tunable oscillator over a "
                     "wide temperature range in this work.")
        self.assertEqual(core.STATUS_REVIEW, status)
        self.assertIn("no_doi", {flag["code"] for flag in flags})


# ------------------------------------------------------------------ sampling

class TestSampling(unittest.TestCase):
    def test_the_sample_is_deterministic(self):
        records = rich_corpus(8)
        first, _ = core.select_sample(records, 4)
        second, _ = core.select_sample(list(reversed(records)), 4)
        self.assertEqual([e["normalized"]["id"] for e in first],
                         [e["normalized"]["id"] for e in second])

    def test_metadata_rich_records_are_preferred(self):
        thin = search_record(90, "Sparse widget note", "", doi="")
        rich = search_record(
            91, "Rareword resonance of gadgetite lattices",
            "Rareword resonance in gadgetite lattices probed with a "
            "cryogenic spectrometer and a tunable oscillator over a wide "
            "temperature range in this careful work.",
            tags=["rareword resonance", "gadgetite"])
        chosen, _ = core.select_sample([thin, rich], 1)
        self.assertEqual(["id91"], [e["normalized"]["id"] for e in chosen])

    def test_one_collection_cannot_crowd_out_the_rest(self):
        crowd = [search_record(
            i, "Rareword resonance of gadgetite variant %d" % i,
            "Rareword resonance in gadgetite lattices probed with a "
            "cryogenic spectrometer and a tunable oscillator over a wide "
            "temperature range.", collections=["Crowded"]) for i in range(10)]
        lonely = search_record(
            50, "Thermal transport in amorphous widgetite ribbons",
            "Thermal transport in amorphous widgetite ribbons studied by "
            "molecular dynamics over a wide temperature range in this "
            "careful work.", collections=["Rare"])
        chosen, _ = core.select_sample(crowd + [lonely], 3)
        strata = [core._stratum(e["normalized"]) for e in chosen]
        self.assertIn("collection:rare", strata)

    def test_flagged_records_are_set_aside_with_their_reasons(self):
        good = rich_corpus(2)
        bad = search_record(80, "STAGING TEST", "placeholder", tags=["asdf"])
        chosen, skipped = core.select_sample(good + [bad], 5)
        self.assertNotIn("id80", [e["normalized"]["id"] for e in chosen])
        flagged = [e for e in skipped if e["normalized"]["id"] == "id80"]
        self.assertEqual(1, len(flagged))
        self.assertTrue(flagged[0]["flags"])
        # ...and can be opted back in rather than being gone for good.
        chosen, _ = core.select_sample(good + [bad], 5, include_flagged=True)
        self.assertIn("id80", [e["normalized"]["id"] for e in chosen])


# ------------------------------------------------------- gate explanations

class TestGateExplanations(unittest.TestCase):
    def build(self):
        records = rich_corpus(6)
        entries = [core.to_canonical_record(r)[0] for r in records]
        stats = R.CorpusStats([R.build_internal_profile(e) for e in entries])
        return entries, stats

    def test_an_accepted_candidate_has_no_rejection_reason(self):
        entries, stats = self.build()
        assessment = R.assess(R.build_internal_profile(entries[0]),
                              R.build_internal_profile(entries[1]), stats)
        self.assertTrue(assessment.passes)
        self.assertEqual("", core.rejection_reason(assessment))

    def test_a_rejected_candidate_explains_itself_in_the_gates_terms(self):
        entries, stats = self.build()
        unrelated, _ = core.to_canonical_record(search_record(
            99, "Seasonal migration of coastal birds",
            "Observations of coastal bird migration over several seasons "
            "using visual counts from fixed stations."))
        assessment = R.assess(R.build_internal_profile(entries[0]),
                              R.build_internal_profile(unrelated), stats)
        self.assertFalse(assessment.passes)
        reason = core.rejection_reason(assessment)
        self.assertTrue(reason)
        self.assertIn("similarity", reason)

    def test_components_come_from_the_assessment_not_a_recomputation(self):
        entries, stats = self.build()
        assessment = R.assess(R.build_internal_profile(entries[0]),
                              R.build_internal_profile(entries[1]), stats)
        components = core.gate_components(assessment)
        self.assertEqual(round(assessment.score, 4), components["score"])
        self.assertEqual(round(assessment.similarity, 4),
                         components["similarity"])
        self.assertEqual(len(assessment.shared_terms),
                         components["shared_specific_terms"])
        self.assertEqual(round(assessment.shared_weight, 4),
                         components["shared_term_weight"])


# ----------------------------------------------------------- review file I/O

class TestReviewFile(unittest.TestCase):
    def rows(self):
        return [{
            "record_id": "id00",
            "record_title": "Rareword resonance",
            "internal": [
                {"source": "internal", "rank": 0, "title": "Accepted one",
                 "gate_score": 9.0, "gate_decision": "accepted",
                 "rejection_reason": "", "reasons": ["a reason"],
                 "in_top5": True},
                {"source": "internal", "rank": 1, "title": "Rejected one",
                 "gate_score": 1.0, "gate_decision": "rejected",
                 "rejection_reason": "no evidence at all: ...",
                 "reasons": [], "in_top5": False},
            ],
            "external": {},
        }]

    def test_human_rating_is_always_written_empty(self):
        rows = core.tsv_rows(self.rows())
        self.assertEqual(core.TSV_COLUMNS, rows[0])
        for row in rows[1:]:
            self.assertEqual("", row[core.TSV_COLUMNS.index("human_rating")])
            self.assertEqual("", row[core.TSV_COLUMNS.index("human_note")])

    def test_rejected_candidates_are_included_so_false_negatives_are_findable(self):
        titles = [row[3] for row in core.tsv_rows(self.rows())[1:]]
        self.assertIn("Accepted one", titles)
        self.assertIn("Rejected one", titles)

    def test_only_what_is_shown_plus_near_misses_reaches_the_review_file(self):
        # On a real corpus the gate accepts most pairs but shows five. Rating
        # hundreds of accepted-but-never-displayed rows buys nothing, so the
        # file carries the shown ones and the best few behind them.
        record = {
            "record_id": "id00", "record_title": "A record", "external": {},
            "internal": [
                {"source": "internal", "rank": i, "title": "shown %d" % i,
                 "gate_score": 100 - i, "gate_decision": "accepted",
                 "rejection_reason": "", "reasons": ["r"], "in_top5": True}
                for i in range(5)
            ] + [
                {"source": "internal", "rank": 5 + i,
                 "title": "not shown %d" % i, "gate_score": 50 - i,
                 "gate_decision": "accepted", "rejection_reason": "",
                 "reasons": ["r"], "in_top5": False}
                for i in range(40)
            ],
        }
        titles = [row[3] for row in
                  core.tsv_rows([record], rejected_per_source=5)[1:]]
        self.assertEqual(10, len(titles))
        for i in range(5):
            self.assertIn("shown %d" % i, titles)
        self.assertIn("not shown 0", titles)
        self.assertNotIn("not shown 39", titles)

    def test_tabs_and_newlines_cannot_break_a_row(self):
        rows = self.rows()
        rows[0]["record_title"] = "Title\twith\ttabs\nand a newline"
        rendered = core.render_tsv(core.tsv_rows(rows))
        # Split on newlines only: a bare strip() would eat the trailing empty
        # cells, which is precisely where the blank human rating lives.
        for line in [l for l in rendered.split("\n") if l]:
            self.assertEqual(len(core.TSV_COLUMNS), len(line.split("\t")))

    def test_only_the_three_ratings_are_accepted(self):
        header = "\t".join(core.TSV_COLUMNS)
        base = ["id00", "A record", "internal", "A candidate", "why", "9.0",
                "accepted"]
        for rating in ("related", "partial", "unrelated", "RELATED", " partial ",
                       ""):
            text = header + "\n" + "\t".join(base + [rating, ""])
            rows, errors = core.parse_tsv(text)
            self.assertEqual([], errors, rating)
            self.assertEqual(rating.strip().lower(), rows[0]["human_rating"])
        for rating in ("yes", "maybe", "3", "related-ish"):
            text = header + "\n" + "\t".join(base + [rating, ""])
            rows, errors = core.parse_tsv(text)
            self.assertTrue(errors, rating)
            self.assertEqual([], rows, rating)

    def test_a_wrong_header_is_refused_rather_than_guessed_at(self):
        rows, errors = core.parse_tsv("a\tb\nc\td\n")
        self.assertEqual([], rows)
        self.assertTrue(errors)


# ------------------------------------------------------------------ metrics

class TestMetrics(unittest.TestCase):
    def row(self, **kwargs):
        base = {"record_id": "id00", "record_title": "t", "source": "internal",
                "candidate_title": "c", "reasons": "", "gate_score": "1",
                "gate_decision": "accepted", "human_rating": "related",
                "human_note": ""}
        base.update(kwargs)
        return base

    def test_unrated_rows_are_excluded_and_counted(self):
        rows = [self.row(candidate_title="a"),
                self.row(candidate_title="b", human_rating=""),
                self.row(candidate_title="c", human_rating="")]
        metrics = core.score_ratings(rows)
        self.assertEqual(3, metrics["rows_total"])
        self.assertEqual(1, metrics["rows_rated"])
        self.assertEqual(2, metrics["rows_unrated"])
        self.assertEqual(2, metrics["rows_unrated_excluded_from_metrics"])
        self.assertEqual(1, metrics["accepted"]["rated"])

    def test_precision_at_5_counts_only_what_a_visitor_would_see(self):
        rows = [
            self.row(candidate_title="shown-related", human_rating="related"),
            self.row(candidate_title="shown-partial", human_rating="partial"),
            self.row(candidate_title="not-shown", human_rating="unrelated"),
        ]
        top5 = {("id00", "internal", "shown-related"),
                ("id00", "internal", "shown-partial")}
        metrics = core.score_ratings(rows, top5)
        self.assertEqual(2, metrics["shown_rows_rated"])
        self.assertEqual(0.5, metrics["precision_at_5"])
        self.assertEqual(1.0, metrics["precision_at_5_lenient"])

    def test_false_positives_and_false_negatives(self):
        rows = [
            self.row(candidate_title="fp", gate_decision="accepted",
                     human_rating="unrelated"),
            self.row(candidate_title="fn", gate_decision="rejected",
                     human_rating="related"),
            self.row(candidate_title="fn2", gate_decision="rejected",
                     human_rating="partial"),
            self.row(candidate_title="tn", gate_decision="rejected",
                     human_rating="unrelated"),
            self.row(candidate_title="tp", gate_decision="accepted",
                     human_rating="related"),
        ]
        metrics = core.score_ratings(rows)
        self.assertEqual(1, metrics["false_positives"])
        self.assertEqual(2, metrics["false_negatives"])
        self.assertEqual(1, metrics["false_negatives_strict"])

    def test_pools_are_compared_separately(self):
        rows = [
            self.row(source="internal", candidate_title="a",
                     human_rating="related"),
            self.row(source="recommendations_all_cs", candidate_title="b",
                     human_rating="unrelated"),
        ]
        metrics = core.score_ratings(rows)
        self.assertEqual(1.0, metrics["pools"]["internal"]["precision_strict"])
        self.assertEqual(
            0.0, metrics["pools"]["recommendations_all_cs"]["precision_strict"])

    def test_record_coverage_reports_partially_reviewed_sets(self):
        rows = [self.row(record_id="a", human_rating="related"),
                self.row(record_id="b", human_rating=""),
                self.row(record_id="c", human_rating="")]
        metrics = core.score_ratings(rows)
        self.assertEqual(3, metrics["record_coverage"]["records_in_review"])
        self.assertEqual(
            1, metrics["record_coverage"]["records_with_at_least_one_rating"])


# ------------------------------------------------------------ rate limiting

class TestPolitesClient(unittest.TestCase):
    class Session:
        def __init__(self, responses):
            self.responses = list(responses)
            self.calls = 0

        def get(self, url, params=None, headers=None, timeout=None):
            self.calls += 1
            return self.responses.pop(0) if self.responses else FakeResponse({})

    def client(self, responses, clock=None, **kwargs):
        self.slept = []
        session = self.Session(responses)
        # A clock that never advances: every call arrives "immediately after"
        # the last one, which is what the pacing has to handle.
        clock = clock or (lambda: 0.0)
        return session, related_eval.PolitesClient(
            session, sleep=self.slept.append, clock=clock, **kwargs)

    def test_a_429_is_retried_a_bounded_number_of_times(self):
        responses = [FakeResponse({}, 429, {"Retry-After": "2"})] * 10
        session, client = self.client(responses, max_retries=2, rate_limit=0)
        response = client.get("https://example.org/x")
        self.assertEqual(429, response.status_code)
        self.assertEqual(3, session.calls)      # initial + 2 retries
        self.assertEqual(2, client.retries)

    def test_retry_after_is_respected_and_capped(self):
        responses = [FakeResponse({}, 429, {"Retry-After": "5"}),
                     FakeResponse({"ok": True})]
        _, client = self.client(responses, max_retries=3, rate_limit=0)
        client.get("https://example.org/x")
        self.assertEqual([5], self.slept)

        responses = [FakeResponse({}, 429, {"Retry-After": "99999"}),
                     FakeResponse({"ok": True})]
        _, client = self.client(responses, max_retries=3, rate_limit=0)
        client.get("https://example.org/x")
        self.assertEqual([related_eval.MAX_RETRY_SLEEP], self.slept)

    def test_a_missing_retry_after_backs_off_anyway(self):
        responses = [FakeResponse({}, 429), FakeResponse({"ok": True})]
        _, client = self.client(responses, max_retries=3, rate_limit=0)
        client.get("https://example.org/x")
        self.assertEqual([1], self.slept)

    def test_requests_are_paced(self):
        session, client = self.client([FakeResponse({})] * 3, rate_limit=1.0)
        for _ in range(3):
            client.get("https://example.org/x")
        self.assertTrue(self.slept, "the rate limit must actually sleep")

    def test_a_success_is_never_retried(self):
        session, client = self.client([FakeResponse({"ok": True})],
                                      rate_limit=0)
        client.get("https://example.org/x")
        self.assertEqual(1, session.calls)
        self.assertEqual(0, client.retries)


# ---------------------------------------------------------------- end to end

class TestCollect(unittest.TestCase):
    def setUp(self):
        self.output = tempfile.mkdtemp(prefix="related-eval-")
        self.records = rich_corpus(6)

    def tearDown(self):
        shutil.rmtree(self.output, ignore_errors=True)

    def run_collect(self, live=False, provider=None, records=None,
                    extra=()):
        provider = provider if provider is not None else FakeProvider()
        session = FakeQrespSession(
            records if records is not None else self.records,
            provider=provider)
        argv = ["collect", "--api-base", "https://qresp.example.org",
                "--output-dir", self.output, "--sample-size", "4"]
        if live:
            argv.append("--live")
        argv.extend(extra)
        with mock.patch("requests.Session", return_value=session):
            code = related_eval.main(argv)
        return code, session, provider

    def read(self, name):
        with io.open(os.path.join(self.output, name), encoding="utf-8") as f:
            return f.read()

    def lines(self, name):
        """Split on newlines only. `str.strip()` would eat the trailing empty
        TSV cells, which is exactly where the (deliberately blank) human
        rating lives."""
        return [line for line in self.read(name).split("\n") if line]

    def test_without_live_no_external_request_is_made(self):
        provider = FakeProvider()
        code, _, _ = self.run_collect(live=False, provider=provider)
        self.assertEqual(0, code)
        self.assertEqual([], provider.calls)
        summary = json.loads(self.read("summary.json"))
        self.assertFalse(summary["live"])
        self.assertEqual(0, summary["provider_requests"]["calls"])

    def test_the_offline_client_refuses_rather_than_silently_skipping(self):
        with self.assertRaises(RuntimeError):
            related_eval.OfflineClient().get("https://example.org")

    def test_a_live_run_collects_each_pool_separately(self):
        code, _, provider = self.run_collect(live=True)
        self.assertEqual(0, code)
        self.assertTrue(provider.calls)
        lines = [json.loads(l) for l in
                 self.read("raw-results.jsonl").strip().split("\n")]
        self.assertTrue(lines)
        for line in lines:
            self.assertEqual(sorted(related_eval.EXTERNAL_POOLS),
                             sorted(line["external"]))

    def test_the_production_related_endpoint_is_never_called(self):
        _, session, _ = self.run_collect(live=True)
        for url in session.calls:
            self.assertNotIn("/related", url)

    def test_raw_results_carry_only_allowlisted_candidate_keys(self):
        self.run_collect(live=True)
        for line in self.read("raw-results.jsonl").strip().split("\n"):
            record = json.loads(line)
            self.assertEqual(sorted(core.RECORD_KEYS), sorted(record))
            candidates = list(record["internal"])
            for pool in record["external"].values():
                candidates.extend(pool)
            for candidate in candidates:
                self.assertEqual(sorted(core.CANDIDATE_KEYS),
                                 sorted(candidate))

    def test_no_secret_or_path_or_identity_reaches_any_output_file(self):
        with mock.patch.dict("os.environ",
                             {"QRESP_SEMANTIC_SCHOLAR_API_KEY": "s2-secret"}):
            self.run_collect(live=True)
        blob = "\n".join(self.read(name) for name in
                         ("raw-results.jsonl", "human-review.tsv",
                          "summary.json")).lower()
        for leak in ("s2-secret", "x-api-key", "authorization",
                     "curator@example.com", "rcc.uchicago", "files.example",
                     "internal.example", "notebook", "ipynb",
                     "openaccesspdf", "secret.pdf", "embedding",
                     "citationcount", "homepage", "private.csv"):
            self.assertNotIn(leak, blob, leak)

    def test_the_api_key_is_reported_only_as_a_boolean(self):
        with mock.patch.dict("os.environ",
                             {"QRESP_SEMANTIC_SCHOLAR_API_KEY": "s2-secret"}):
            self.run_collect(live=True)
        summary = json.loads(self.read("summary.json"))
        self.assertIs(True, summary["api_key_present"])

    def test_the_review_file_is_ready_for_a_person_and_empty_of_ratings(self):
        self.run_collect(live=True)
        lines = self.lines("human-review.tsv")
        self.assertEqual("\t".join(core.TSV_COLUMNS), lines[0])
        self.assertGreater(len(lines), 1)
        for line in lines[1:]:
            cells = line.split("\t")
            self.assertEqual(len(core.TSV_COLUMNS), len(cells))
            self.assertEqual("", cells[core.TSV_COLUMNS.index("human_rating")])
            self.assertEqual("", cells[core.TSV_COLUMNS.index("human_note")])

    def test_the_summary_reports_coverage_and_rejection_reasons(self):
        self.run_collect(live=True)
        summary = json.loads(self.read("summary.json"))
        self.assertEqual(4, summary["sample_size"])
        self.assertIn("pools", summary)
        self.assertIn("internal", summary["pools"])
        self.assertIn("gate_pass_rate", summary)
        self.assertIn("zero_candidate_ratio", summary)
        self.assertIsInstance(summary["rejection_reason_frequency"], dict)

    def test_short_internal_lists_are_not_padded_to_five(self):
        # One usable record plus unrelated ones: nothing may be invented.
        lonely = [search_record(
            0, "Rareword resonance of gadgetite lattices",
            "Rareword resonance in gadgetite lattices probed with a "
            "cryogenic spectrometer and a tunable oscillator over a wide "
            "temperature range in this careful work.")]
        lonely += [search_record(
            i, "Seasonal migration of coastal birds number %d" % i,
            "Observations of coastal bird migration over several seasons "
            "using visual counts from fixed stations at the shoreline.")
            for i in range(1, 4)]
        self.run_collect(live=False, records=lonely)
        for line in self.read("raw-results.jsonl").strip().split("\n"):
            record = json.loads(line)
            shown = [c for c in record["internal"] if c["in_top5"]]
            self.assertLessEqual(len(shown), related.MAX_RESULTS)
            for candidate in shown:
                self.assertEqual("accepted", candidate["gate_decision"])

    def test_flagged_records_are_reported_in_the_summary(self):
        records = rich_corpus(3) + [
            search_record(80, "STAGING TEST placeholder", "asdf",
                          tags=["asdf"])]
        self.run_collect(live=False, records=records)
        summary = json.loads(self.read("summary.json"))
        self.assertGreaterEqual(summary["records_flagged"], 1)
        self.assertIn("test_title", summary["flag_reasons"])
        # A record that was simply not drawn into the sample is NOT a finding
        # about the corpus and is counted separately.
        self.assertIn("records_not_sampled", summary)


class TestSummarizeCommand(unittest.TestCase):
    def setUp(self):
        self.output = tempfile.mkdtemp(prefix="related-eval-sum-")

    def tearDown(self):
        shutil.rmtree(self.output, ignore_errors=True)

    def write(self, name, text):
        path = os.path.join(self.output, name)
        with io.open(path, "w", encoding="utf-8", newline="\n") as handle:
            handle.write(text)
        return path

    def test_it_scores_a_reviewed_file(self):
        header = "\t".join(core.TSV_COLUMNS)
        rows = [
            ["id00", "A record", "internal", "Good one", "why", "9.0",
             "accepted", "related", ""],
            ["id00", "A record", "internal", "Bad one", "why", "8.0",
             "accepted", "unrelated", ""],
            ["id00", "A record", "internal", "Missed one", "", "1.0",
             "rejected", "related", "the gate should have kept this"],
            ["id00", "A record", "internal", "Not yet rated", "", "1.0",
             "rejected", "", ""],
        ]
        self.write("human-review.tsv",
                   header + "\n" + "\n".join("\t".join(r) for r in rows) + "\n")
        self.write("raw-results.jsonl", json.dumps({
            "record_id": "id00",
            "internal": [
                {"source": "internal", "title": "Good one", "in_top5": True},
                {"source": "internal", "title": "Bad one", "in_top5": True},
                {"source": "internal", "title": "Missed one",
                 "in_top5": False},
            ],
            "external": {},
        }) + "\n")

        code = related_eval.main(["summarize", "--output-dir", self.output])
        self.assertEqual(0, code)
        with io.open(os.path.join(self.output, "metrics.json"),
                     encoding="utf-8") as handle:
            metrics = json.load(handle)
        self.assertEqual(4, metrics["rows_total"])
        self.assertEqual(3, metrics["rows_rated"])
        self.assertEqual(1, metrics["rows_unrated"])
        self.assertEqual(0.5, metrics["precision_at_5"])
        self.assertEqual(1, metrics["false_positives"])
        self.assertEqual(1, metrics["false_negatives"])

    def test_an_invalid_rating_stops_the_scoring(self):
        header = "\t".join(core.TSV_COLUMNS)
        self.write("human-review.tsv", header + "\n" + "\t".join(
            ["id00", "t", "internal", "c", "", "1.0", "accepted", "sort of",
             ""]) + "\n")
        self.assertEqual(
            2, related_eval.main(["summarize", "--output-dir", self.output]))

    def test_a_missing_review_file_is_reported_not_crashed_on(self):
        self.assertEqual(
            2, related_eval.main(["summarize", "--output-dir", self.output]))


class TestCliSurface(unittest.TestCase):
    def test_no_production_url_is_hardcoded(self):
        source = io.open(related_eval.__file__, encoding="utf-8").read()
        source += io.open(core.__file__, encoding="utf-8").read()
        for host in ("qresp.org", "paperstack", "uchicago", "localhost:8443"):
            self.assertNotIn(host, source, host)

    def test_api_base_is_required(self):
        with self.assertRaises(SystemExit):
            related_eval.build_parser().parse_args(
                ["collect", "--output-dir", "x"])

    def test_ids_file_and_sample_size_are_mutually_exclusive(self):
        with self.assertRaises(SystemExit):
            related_eval.build_parser().parse_args(
                ["collect", "--api-base", "https://x", "--output-dir", "y",
                 "--ids-file", "a", "--sample-size", "5"])


if __name__ == "__main__":
    unittest.main()
