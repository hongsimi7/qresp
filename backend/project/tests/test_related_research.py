"""Related Research: the endpoint, the provider call, and the cache.

The pure scoring rules are covered by test_relatedness.py. What is pinned
here is everything AROUND them: the feature switch, exactly what does and does
not leave this server, the fixed provider endpoint, the `x-api-key` header,
de-duplication, the cache (hit / expiry / stale fallback), and the promise
that a provider failure degrades one section instead of the page -- and that
none of it ever writes to a Paper.
"""
import json
import unittest
from datetime import datetime, timedelta
from unittest import mock

import mongoengine
import mongomock

from project import connexionapp, related
from project.models import Paper, RelatedResearchCache

ENABLED = {"QRESP_RELATED_RESEARCH_ENABLED": "1",
           "QRESP_SEMANTIC_SCHOLAR_API_KEY": ""}
ENABLED_WITH_KEY = {"QRESP_RELATED_RESEARCH_ENABLED": "1",
                    "QRESP_SEMANTIC_SCHOLAR_API_KEY": "test-s2-super-secret"}
DISABLED = {"QRESP_RELATED_RESEARCH_ENABLED": "",
            "QRESP_SEMANTIC_SCHOLAR_API_KEY": ""}


class FakeResponse:
    def __init__(self, payload, status_code=200):
        self._payload = payload
        self.status_code = status_code
        self.text = json.dumps(payload) if payload is not None else ""

    def json(self):
        if self._payload is None:
            raise ValueError("not json")
        return self._payload


def paper_doc(key, title, abstract, tags=(), authors=(), doi=None,
              year=2020, tools=(), active=True, collections=("MICCOM",)):
    return {
        "version": 1,
        "schema": "https://raw.githubusercontent.com/qresp/schema/v1.0",
        "license": "cc-by",
        "collections": list(collections),
        "tags": list(tags),
        "is_active": active,
        "info": {"timeStamp": "2020-01-01 00:00:00",
                 "insertedBy": {"firstName": "Curator", "lastName": "Person",
                                "emailId": "curator@example.com"},
                 "fileServerPath": "https://files.example.org/%s" % key},
        "reference": {
            "title": title,
            "publishedAbstract": abstract,
            "DOI": doi if doi is not None else "10.1000/%s" % key,
            "year": year,
            "page": "1-2",
            "volume": "1",
            "journal": {"fullName": "Journal of Placeholder Science"},
            "authors": [{"firstName": n.split()[0], "middleName": "",
                         "lastName": n.split()[-1]} for n in authors],
        },
        "tools": [{"id": "t0", "kind": "software", "packageName": t}
                  for t in tools],
        "charts": [], "datasets": [], "scripts": [], "heads": [],
    }


# One tightly related neighbour, one same-lab-but-different-subject record,
# and unrelated filler so corpus rarity is meaningful.
def seed_corpus():
    saved = {}
    subject = paper_doc(
        "subject", "Rareword resonance of gadgetite lattices",
        "Rareword resonance in gadgetite lattices is probed with a cryogenic "
        "spectrometer and an oscillator of tunable frequency.",
        tags=["rareword resonance", "gadgetite"],
        authors=["Robin Sharedname", "Casey Otherperson"],
        doi="10.1000/subject", tools=["RarePackage"])
    saved["subject"] = Paper(**subject).save()
    saved["near"] = Paper(**paper_doc(
        "near", "Rareword resonance of gadgetite thin films",
        "Rareword resonance in gadgetite lattices is measured with a "
        "cryogenic spectrometer and a tunable oscillator.",
        tags=["rareword resonance", "gadgetite"],
        authors=["Robin Sharedname"], doi="10.1000/near",
        tools=["RarePackage"])).save()
    saved["unrelated"] = Paper(**paper_doc(
        "unrelated", "Seasonal migration of coastal birds",
        "Observations of coastal bird migration over several seasons.",
        tags=["ornithology"], authors=["Sam Nobody"],
        doi="10.1000/unrelated")).save()
    saved["hidden"] = Paper(**paper_doc(
        "hidden", "Rareword resonance of gadgetite powders",
        "Rareword resonance in gadgetite lattices with a cryogenic "
        "spectrometer and a tunable oscillator.",
        tags=["rareword resonance", "gadgetite"],
        authors=["Robin Sharedname"], doi="10.1000/hidden",
        active=False)).save()
    for i in range(20):
        Paper(**paper_doc("filler%d" % i, "Unrelated subject %d" % i,
                          "An abstract about topic%d and matter%d." % (i, i),
                          tags=["topic%d" % i], authors=["Person%d Sur%d" % (i, i)],
                          doi="10.1000/filler%d" % i,
                          collections=["other"])).save()
    return saved


def recommendation(title, abstract, doi=None, year=2022, authors=("Someone Else",),
                   paper_id=None, fields=("Physics",)):
    return {
        "paperId": paper_id or (doi or title).replace("/", "_"),
        "title": title,
        "abstract": abstract,
        "year": year,
        "externalIds": {"DOI": doi} if doi else {},
        "authors": [{"name": n} for n in authors],
        "fieldsOfStudy": list(fields),
    }


RELATED_EXTERNAL = recommendation(
    "Rareword resonance in gadgetite single crystals",
    "Rareword resonance of gadgetite lattices measured with a cryogenic "
    "spectrometer and a tunable oscillator.",
    doi="10.2000/external-a")

UNRELATED_EXTERNAL = recommendation(
    "A study of data analysis in another discipline",
    "This study presents a simulation and a data analysis of unrelated "
    "material.", doi="10.2000/external-b", fields=("Economics",))


class ProviderTimeout(IOError):
    """What `requests` raises when the provider never answers."""


# Every way one provider call can go wrong, named. `not_found` is the only
# one that is an ANSWER; the rest are non-answers and must never be recorded
# as a fact about the record.
FAILURE_MODES = ("timeout", "connection", "rate_limited", "server_error",
                 "malformed", "unexpected_shape")


def _failure_response(mode):
    if mode == "timeout":
        raise ProviderTimeout("timed out")
    if mode == "connection":
        raise OSError("connection reset")
    if mode == "rate_limited":
        return FakeResponse({"error": "too many requests",
                             "message": "quota exceeded"}, 429)
    if mode == "server_error":
        return FakeResponse({"error": "upstream exploded"}, 500)
    if mode == "malformed":
        return FakeResponse(None)                    # body is not JSON
    if mode == "unexpected_shape":
        return FakeResponse(["not", "an", "object"])  # 200, wrong type
    raise AssertionError("unknown failure mode %r" % mode)


class ProviderStub:
    """Stands in for `requests`, dispatching on the URL the code chose.

    Each of the two call sites -- paper resolution and recommendations -- has
    its own `mode`: `ok`, `not_found`, or any of FAILURE_MODES. Every call is
    recorded so the tests can assert on the endpoint, the params and the
    headers actually used.
    """

    def __init__(self, resolution=None, recommendations=None,
                 resolution_mode="ok", recommendation_mode="ok"):
        self.calls = []
        self.resolution = (resolution if resolution is not None
                           else {"paperId": "S2-SUBJECT",
                                 "title": "Rareword resonance of gadgetite "
                                          "lattices",
                                 "externalIds": {"DOI": "10.1000/subject"},
                                 "references": []})
        self.recommendations = (recommendations if recommendations is not None
                                else [RELATED_EXTERNAL, UNRELATED_EXTERNAL])
        self.resolution_mode = resolution_mode
        self.recommendation_mode = recommendation_mode

    def get(self, url, params=None, headers=None, timeout=None):
        self.calls.append({"url": url, "params": params or {},
                           "headers": headers or {}, "timeout": timeout})
        recommending = url.startswith(
            related.SEMANTIC_SCHOLAR_RECOMMENDATIONS_URL)
        mode = (self.recommendation_mode if recommending
                else self.resolution_mode)
        if mode == "not_found":
            return FakeResponse({"error": "Paper not found"}, 404)
        if mode != "ok":
            return _failure_response(mode)
        if recommending:
            return FakeResponse({"recommendedPapers": self.recommendations})
        if url.startswith(related.SEMANTIC_SCHOLAR_TITLE_MATCH_URL):
            return FakeResponse({"data": [self.resolution]})
        return FakeResponse(self.resolution)

    @property
    def recommendation_call(self):
        for call in self.calls:
            if call["url"].startswith(
                    related.SEMANTIC_SCHOLAR_RECOMMENDATIONS_URL):
                return call
        return None


class RelatedTestCase(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.client = connexionapp.test_client()

    def setUp(self):
        mongoengine.disconnect_all()
        mongoengine.connect('mongoenginetest',
                            mongo_client_class=mongomock.MongoClient)
        self.papers = seed_corpus()
        self.subject_id = str(self.papers["subject"].id)

    def tearDown(self):
        Paper.drop_collection()
        RelatedResearchCache.drop_collection()
        mongoengine.disconnect_all()

    def fetch(self, paper_id=None, env=None, provider=None):
        """GET the endpoint with the environment and provider stub in place.
        Returns (response, provider stub)."""
        stub = provider if provider is not None else ProviderStub()
        with mock.patch.dict('os.environ', env or ENABLED):
            with mock.patch.object(related, 'requests', stub):
                response = self.client.get(
                    '/api/paper/%s/related' % (paper_id or self.subject_id))
        return response, stub


# ------------------------------------------------------------ feature switch

class TestFeatureSwitch(RelatedTestCase):
    def test_off_by_default_and_no_provider_is_contacted(self):
        response, stub = self.fetch(env=DISABLED)
        self.assertEqual(200, response.status_code)
        body = response.json()
        self.assertFalse(body["enabled"])
        self.assertEqual([], body["internal"]["results"])
        self.assertEqual([], body["external"]["results"])
        self.assertEqual("disabled", body["external"]["status"])
        self.assertEqual([], stub.calls)

    def test_configuration_is_read_from_the_environment_only(self):
        # config.ini must not be able to switch an external call on, or
        # supply a credential.
        with mock.patch.dict('os.environ', DISABLED):
            self.assertFalse(related.config()["ENABLED"])
            self.assertEqual("", related.config()["API_KEY"])
        with mock.patch.dict('os.environ', ENABLED_WITH_KEY):
            self.assertTrue(related.config()["ENABLED"])
            self.assertEqual("test-s2-super-secret",
                             related.config()["API_KEY"])

    def test_timeout_and_cache_ttl_are_bounded(self):
        with mock.patch.dict('os.environ', dict(
                ENABLED, QRESP_SEMANTIC_SCHOLAR_TIMEOUT_SECONDS="99999",
                QRESP_RELATED_RESEARCH_CACHE_DAYS="99999")):
            cfg = related.config()
        self.assertEqual(related.MAX_TIMEOUT_SECONDS, cfg["TIMEOUT"])
        self.assertEqual(related.MAX_CACHE_DAYS, cfg["CACHE_DAYS"])

    def test_the_external_default_cache_ttl_is_seven_days(self):
        with mock.patch.dict('os.environ', ENABLED):
            self.assertEqual(7, related.config()["CACHE_DAYS"])


# ------------------------------------------------------- internal list

class TestInternalRecommendations(RelatedTestCase):
    def test_related_records_are_returned_with_grounded_reasons(self):
        response, _ = self.fetch()
        internal = response.json()["internal"]["results"]
        self.assertTrue(internal)
        titles = [item["title"] for item in internal]
        self.assertIn("Rareword resonance of gadgetite thin films", titles)
        top = internal[0]
        self.assertTrue(top["reasons"])
        self.assertLessEqual(len(top["reasons"]), 3)
        self.assertTrue(top["id"])
        self.assertEqual("internal", top["source"])

    def test_unrelated_records_are_left_out_rather_than_padding_the_list(self):
        response, _ = self.fetch()
        titles = [item["title"]
                  for item in response.json()["internal"]["results"]]
        self.assertNotIn("Seasonal migration of coastal birds", titles)
        self.assertLess(len(titles), 5)

    def test_the_current_paper_never_recommends_itself(self):
        response, _ = self.fetch()
        ids = [item["id"] for item in response.json()["internal"]["results"]]
        self.assertNotIn(self.subject_id, ids)

    def test_deactivated_records_are_never_recommended(self):
        response, _ = self.fetch()
        titles = [item["title"]
                  for item in response.json()["internal"]["results"]]
        self.assertNotIn("Rareword resonance of gadgetite powders", titles)

    def test_a_newly_published_record_appears_without_any_invalidation(self):
        # Internal results are computed per request, so publishing is
        # reflected immediately -- there is no stale internal cache to clear.
        before, _ = self.fetch()
        self.assertNotIn("Rareword resonance of gadgetite nanorods",
                         [i["title"] for i in before.json()["internal"]["results"]])
        Paper(**paper_doc(
            "fresh", "Rareword resonance of gadgetite nanorods",
            "Rareword resonance in gadgetite lattices measured with a "
            "cryogenic spectrometer and a tunable oscillator.",
            tags=["rareword resonance", "gadgetite"],
            authors=["Robin Sharedname"], doi="10.1000/fresh")).save()
        after, _ = self.fetch()
        self.assertIn("Rareword resonance of gadgetite nanorods",
                      [i["title"] for i in after.json()["internal"]["results"]])

    def test_a_deactivated_record_disappears_immediately(self):
        before, _ = self.fetch()
        self.assertIn("Rareword resonance of gadgetite thin films",
                      [i["title"] for i in before.json()["internal"]["results"]])
        Paper.objects(id=self.papers["near"].id).update(set__is_active=False)
        after, _ = self.fetch()
        self.assertNotIn("Rareword resonance of gadgetite thin films",
                         [i["title"] for i in after.json()["internal"]["results"]])

    def test_at_most_five_internal_results(self):
        for i in range(9):
            Paper(**paper_doc(
                "clone%d" % i,
                "Rareword resonance of gadgetite variant %d" % i,
                "Rareword resonance in gadgetite lattices measured with a "
                "cryogenic spectrometer and a tunable oscillator.",
                tags=["rareword resonance", "gadgetite"],
                authors=["Robin Sharedname"],
                doi="10.1000/clone%d" % i)).save()
        response, _ = self.fetch()
        self.assertEqual(5, len(response.json()["internal"]["results"]))


# ------------------------------------------------------------ external list

class TestExternalProvider(RelatedTestCase):
    def test_at_most_twenty_candidates_are_requested_from_the_fixed_endpoint(self):
        _, stub = self.fetch()
        call = stub.recommendation_call
        self.assertIsNotNone(call)
        self.assertTrue(call["url"].startswith("https://api.semanticscholar.org/"))
        self.assertEqual(20, call["params"]["limit"])
        self.assertEqual(related.EXTERNAL_CANDIDATE_LIMIT,
                         call["params"]["limit"])

    def test_the_candidate_pool_is_the_providers_default_and_not_settable(self):
        # Measured live: the alternative pool ("all-cs") answers with Computer
        # Science papers whatever the source paper's field -- 38 candidates
        # across two domains, best cosine 0.025 against a 0.16 bar, all
        # correctly rejected. Asking for it would buy nothing but traffic.
        _, stub = self.fetch()
        self.assertNotIn("from", stub.recommendation_call["params"])
        # ...and no environment variable can introduce one. (The first call
        # filled the cache, so it has to be cleared or nothing is fetched.)
        RelatedResearchCache.drop_collection()
        with mock.patch.dict('os.environ', dict(
                ENABLED, QRESP_SEMANTIC_SCHOLAR_RECOMMENDATION_POOL="all-cs",
                QRESP_RELATED_RESEARCH_POOL="all-cs")):
            other = ProviderStub()
            with mock.patch.object(related, 'requests', other):
                self.client.get('/api/paper/%s/related' % self.subject_id)
        self.assertNotIn("from", other.recommendation_call["params"])

    def test_an_empty_recommendation_list_is_an_answer_not_a_failure(self):
        # What the live provider actually returns today for Qresp-age
        # records: 200 with an empty list. That is `ok` with no results, and
        # it is cached for the full TTL -- not treated as an outage.
        response, _ = self.fetch(provider=ProviderStub(recommendations=[]))
        external = response.json()["external"]
        self.assertEqual("ok", external["status"])
        self.assertEqual([], external["results"])
        self.assertFalse(external["stale"])
        entry = RelatedResearchCache.objects(paper_id=self.subject_id).first()
        self.assertGreater(entry.expires_at,
                           datetime.utcnow() + timedelta(days=6))

    def test_the_provider_host_is_a_fixed_https_constant(self):
        for url in (related.SEMANTIC_SCHOLAR_PAPER_URL,
                    related.SEMANTIC_SCHOLAR_TITLE_MATCH_URL,
                    related.SEMANTIC_SCHOLAR_RECOMMENDATIONS_URL):
            self.assertTrue(url.startswith("https://api.semanticscholar.org/"),
                            url)
        # No environment variable may redirect it.
        with mock.patch.dict('os.environ', dict(
                ENABLED,
                QRESP_SEMANTIC_SCHOLAR_API_BASE="https://evil.example.org",
                QRESP_SEMANTIC_SCHOLAR_URL="https://evil.example.org",
                QRESP_SEMANTIC_SCHOLAR_HOST="evil.example.org")):
            stub = ProviderStub()
            with mock.patch.object(related, 'requests', stub):
                self.client.get('/api/paper/%s/related' % self.subject_id)
        for call in stub.calls:
            self.assertTrue(call["url"].startswith(
                "https://api.semanticscholar.org/"), call["url"])

    def test_only_minimal_metadata_fields_are_requested(self):
        _, stub = self.fetch()
        fields = stub.recommendation_call["params"]["fields"].split(",")
        self.assertEqual(
            sorted(["title", "abstract", "year", "authors.name",
                    "externalIds", "fieldsOfStudy"]), sorted(fields))

    def test_resolution_asks_only_for_flat_identity_fields(self):
        # A nested selector (`references.externalIds`) makes the live provider
        # DISCARD the whole field list and answer with its defaults -- more
        # data than was asked for, and still no reference DOIs. Verified
        # against the real API; pinned here so it cannot come back.
        _, stub = self.fetch()
        lookups = [c for c in stub.calls
                   if not c["url"].startswith(
                       related.SEMANTIC_SCHOLAR_RECOMMENDATIONS_URL)]
        self.assertTrue(lookups)
        for call in lookups:
            fields = call["params"]["fields"].split(",")
            self.assertEqual(["paperId", "title", "externalIds"], fields)
            self.assertNotIn("references", call["params"]["fields"])

    def test_provider_volunteered_extras_never_reach_a_result_or_the_cache(self):
        # The provider returns `openAccessPdf` (and a full author object)
        # alongside `abstract` whatever is requested. Nothing outside the
        # allowlist may survive normalization.
        noisy = recommendation(
            "Rareword resonance in gadgetite single crystals",
            "Rareword resonance of gadgetite lattices measured with a "
            "cryogenic spectrometer and a tunable oscillator.",
            doi="10.2000/noisy")
        noisy["openAccessPdf"] = {"url": "https://example.org/secret.pdf"}
        noisy["embedding"] = [0.1, 0.2]
        noisy["citationCount"] = 42
        noisy["authors"] = [{"authorId": "A1", "name": "Someone Else",
                             "homepage": "https://example.org/person"}]
        response, _ = self.fetch(provider=ProviderStub(recommendations=[noisy]))
        text = response.text
        for leak in ("openAccessPdf", "secret.pdf", "embedding",
                     "citationCount", "homepage", "authorId"):
            self.assertNotIn(leak, text, leak)
        entry = RelatedResearchCache.objects(paper_id=self.subject_id).first()
        stored = json.dumps(entry.to_mongo().to_dict(), default=str)
        for leak in ("openAccessPdf", "secret.pdf", "embedding", "homepage"):
            self.assertNotIn(leak, stored, leak)

    def test_the_api_key_travels_only_in_the_x_api_key_header(self):
        _, stub = self.fetch(env=ENABLED_WITH_KEY)
        self.assertTrue(stub.calls)
        for call in stub.calls:
            self.assertEqual("test-s2-super-secret",
                             call["headers"]["x-api-key"])
            # ...and nowhere else: not in the URL, not in the query.
            self.assertNotIn("test-s2-super-secret", call["url"])
            self.assertNotIn("test-s2-super-secret",
                             json.dumps(call["params"]))
            self.assertNotIn("authorization",
                             [k.lower() for k in call["headers"]])

    def test_without_a_key_no_credential_header_is_sent_and_the_page_works(self):
        response, stub = self.fetch(env=ENABLED)
        self.assertEqual(200, response.status_code)
        for call in stub.calls:
            self.assertNotIn("x-api-key", call["headers"])
        # The internal list is unaffected by the absence of a credential.
        self.assertTrue(response.json()["internal"]["results"])

    def test_only_this_papers_identity_leaves_the_server(self):
        """DOI (or, without one, the title). Never the abstract, the authors,
        the keywords, an RCC path, or another record."""
        _, stub = self.fetch()
        outgoing = json.dumps([{"url": c["url"], "params": c["params"]}
                               for c in stub.calls])
        self.assertIn("10.1000/subject", outgoing)
        for secret in ("cryogenic", "Sharedname", "RarePackage",
                       "files.example.org", "curator@example.com",
                       "10.1000/near", "gadgetite lattices is probed"):
            self.assertNotIn(secret, outgoing, secret)

    def test_a_title_lookup_is_used_only_when_there_is_no_doi(self):
        no_doi = Paper(**paper_doc(
            "nodoi", "Rareword resonance of gadgetite whiskers",
            "Rareword resonance in gadgetite lattices with a cryogenic "
            "spectrometer.", tags=["rareword resonance"], doi="")).save()
        stub = ProviderStub(resolution={
            "paperId": "S2-NODOI",
            "title": "Rareword resonance of gadgetite whiskers",
            "externalIds": {}})
        self.fetch(paper_id=str(no_doi.id), provider=stub)
        lookup = [c for c in stub.calls
                  if c["url"].startswith(related.SEMANTIC_SCHOLAR_TITLE_MATCH_URL)]
        self.assertEqual(1, len(lookup))
        self.assertEqual("Rareword resonance of gadgetite whiskers",
                         lookup[0]["params"]["query"])

    def test_an_inexact_title_match_skips_the_external_list_entirely(self):
        no_doi = Paper(**paper_doc(
            "nodoi2", "Rareword resonance of gadgetite whiskers",
            "Rareword resonance in gadgetite lattices.",
            tags=["rareword resonance"], doi="")).save()
        stub = ProviderStub(resolution={
            "paperId": "S2-WRONG",
            "title": "An entirely different paper about something else",
            "externalIds": {}})
        response, _ = self.fetch(paper_id=str(no_doi.id), provider=stub)
        body = response.json()
        self.assertEqual("unresolved", body["external"]["status"])
        self.assertEqual([], body["external"]["results"])
        self.assertIsNone(stub.recommendation_call)

    def test_being_recommended_is_not_by_itself_a_reason_to_show_a_paper(self):
        response, _ = self.fetch()
        external = response.json()["external"]["results"]
        titles = [item["title"] for item in external]
        self.assertIn("Rareword resonance in gadgetite single crystals", titles)
        self.assertNotIn("A study of data analysis in another discipline",
                         titles)
        for item in external:
            self.assertTrue(item["reasons"])

    def test_external_results_prefer_an_https_doi_link(self):
        response, _ = self.fetch()
        item = response.json()["external"]["results"][0]
        self.assertEqual("https://doi.org/10.2000/external-a", item["url"])
        self.assertEqual("10.2000/external-a", item["doi"])

    def test_at_most_five_external_results(self):
        # Distinct words, not digits: the title key drops numbers, so
        # "... sample 1" and "... sample 2" are correctly one work, not nine.
        shapes = ("films", "crystals", "powders", "whiskers", "nanorods",
                  "ribbons", "spheres", "platelets", "foams")
        clones = [recommendation(
            "Rareword resonance in gadgetite %s" % shape,
            "Rareword resonance of gadgetite lattices measured with a "
            "cryogenic spectrometer and a tunable oscillator.",
            doi="10.2000/clone-%s" % shape) for shape in shapes]
        response, _ = self.fetch(provider=ProviderStub(recommendations=clones))
        self.assertEqual(5, len(response.json()["external"]["results"]))


class TestExternalDeduplication(RelatedTestCase):
    def test_the_current_paper_is_removed_by_doi_and_by_title(self):
        by_doi = recommendation("Some other spelling of the same work",
                                "Rareword resonance of gadgetite lattices.",
                                doi="10.1000/subject")
        by_title = recommendation(
            "Rareword resonance of gadgetite lattices",
            "Rareword resonance of gadgetite lattices.",
            doi="10.3000/other")
        response, _ = self.fetch(provider=ProviderStub(
            recommendations=[by_doi, by_title, RELATED_EXTERNAL]))
        titles = [i["title"] for i in response.json()["external"]["results"]]
        self.assertNotIn("Some other spelling of the same work", titles)
        self.assertNotIn("Rareword resonance of gadgetite lattices", titles)

    def test_repeated_dois_titles_and_untitled_results_are_dropped(self):
        kept = related.dedupe_candidates([
            {"title": "Alpha study of widgets", "doi": "10.1/a"},
            {"title": "Alpha study of widgets", "doi": "10.1/b"},  # same title
            {"title": "Beta report", "doi": "10.1/a"},             # same doi
            {"title": "", "doi": "10.1/c"},                        # no title
            {"title": "Gamma survey", "doi": "10.1/d"},
        ], "10.1/current", "The current paper")
        self.assertEqual(["Alpha study of widgets", "Gamma survey"],
                         [c["title"] for c in kept])

    def test_the_current_paper_is_removed_even_when_its_doi_is_written_as_a_url(self):
        kept = related.dedupe_candidates(
            [{"title": "The same work", "doi": "https://doi.org/10.1/CURRENT"}],
            "10.1/current", "Something else entirely")
        self.assertEqual([], kept)


# ------------------------------------------------------------------- cache

class TestCache(RelatedTestCase):
    def test_a_fresh_cache_entry_is_served_without_calling_the_provider(self):
        _, first = self.fetch()
        self.assertTrue(first.calls)
        response, second = self.fetch()
        self.assertEqual([], second.calls)
        self.assertTrue(response.json()["external"]["results"])
        self.assertFalse(response.json()["external"]["stale"])

    def test_the_external_results_live_outside_the_paper_document(self):
        self.fetch()
        entry = RelatedResearchCache.objects(paper_id=self.subject_id).first()
        self.assertIsNotNone(entry)
        self.assertTrue(entry.results)
        stored = json.dumps(
            Paper.objects.get(id=self.subject_id).to_mongo().to_dict(),
            default=str)
        self.assertNotIn("external-a", stored)
        self.assertNotIn("related", stored.lower().replace("unrelated", ""))

    def test_the_cache_holds_no_secret_no_user_and_no_provider_body(self):
        self.fetch(env=ENABLED_WITH_KEY)
        entry = RelatedResearchCache.objects(paper_id=self.subject_id).first()
        stored = json.dumps(entry.to_mongo().to_dict(), default=str)
        for secret in ("test-s2-super-secret", "x-api-key", "curator@example.com",
                       "files.example.org", "Authorization"):
            self.assertNotIn(secret, stored, secret)

    def test_an_expired_entry_is_refreshed(self):
        self.fetch()
        RelatedResearchCache.objects(paper_id=self.subject_id).update_one(
            set__expires_at=datetime.utcnow() - timedelta(days=1))
        response, stub = self.fetch()
        self.assertTrue(stub.calls)
        self.assertEqual("ok", response.json()["external"]["status"])
        self.assertFalse(response.json()["external"]["stale"])

    def test_a_failed_refresh_serves_the_last_success_marked_stale(self):
        self.fetch()
        RelatedResearchCache.objects(paper_id=self.subject_id).update_one(
            set__expires_at=datetime.utcnow() - timedelta(days=1))
        response, _ = self.fetch(
            provider=ProviderStub(recommendation_mode="rate_limited"))
        external = response.json()["external"]
        self.assertTrue(external["stale"])
        self.assertEqual("unavailable", external["status"])
        self.assertTrue(external["results"])
        self.assertEqual("Rareword resonance in gadgetite single crystals",
                         external["results"][0]["title"])

    def test_a_first_ever_failure_is_an_empty_external_section_not_a_stale_one(self):
        response, _ = self.fetch(
            provider=ProviderStub(recommendation_mode="server_error"))
        external = response.json()["external"]
        self.assertEqual("unavailable", external["status"])
        self.assertEqual([], external["results"])
        self.assertFalse(external["stale"])

    def test_a_failure_is_remembered_only_briefly(self):
        self.fetch(provider=ProviderStub(recommendation_mode="rate_limited"))
        entry = RelatedResearchCache.objects(paper_id=self.subject_id).first()
        self.assertLess(entry.expires_at,
                        datetime.utcnow() + timedelta(days=1))

    def test_the_cache_is_keyed_per_record(self):
        self.fetch()
        other = self.papers["near"]
        _, stub = self.fetch(paper_id=str(other.id))
        self.assertTrue(stub.calls)
        self.assertEqual(
            2, RelatedResearchCache.objects.count())


class TestEditedMetadataInvalidatesTheCache(RelatedTestCase):
    """A cached external answer describes the record AS IT WAS. When the
    record's public scientific metadata changes, the answer is recomputed at
    once -- not seven days later."""

    def entry(self):
        return RelatedResearchCache.objects(paper_id=self.subject_id).first()

    def test_editing_the_title_refetches_inside_the_ttl(self):
        # REPRODUCTION of the bug this fixes: with the cache keyed on the
        # paper id and an expiry alone, a record edited a minute after
        # publication kept serving recommendations computed from the OLD text
        # for a week. The cache entry below is deliberately still fresh.
        self.fetch()
        before = self.entry()
        self.assertGreater(before.expires_at, datetime.utcnow())

        Paper.objects(id=self.subject_id).update(
            set__reference__title="Cryogenic oscillator survey of widgetite")
        response, stub = self.fetch()

        self.assertTrue(stub.calls, "an edited record must be looked up again")
        self.assertEqual("ok", response.json()["external"]["status"])
        self.assertNotEqual(before.fingerprint, self.entry().fingerprint)

    def test_every_scoring_field_forces_a_refetch(self):
        edits = {
            "abstract": {"set__reference__publishedAbstract": "New abstract."},
            "doi": {"set__reference__DOI": "10.1000/changed"},
            "tags": {"set__tags": ["rareword resonance", "added-tag"]},
            "collections": {"set__collections": ["MICCOM", "another"]},
        }
        for label, update in edits.items():
            with self.subTest(field=label):
                RelatedResearchCache.drop_collection()
                self.fetch()
                Paper.objects(id=self.subject_id).update(**update)
                _, stub = self.fetch()
                self.assertTrue(stub.calls, label)

    def test_editing_artifacts_and_tools_forces_a_refetch(self):
        for label, update in (
                ("tool", {"set__tools": [{"id": "t0", "kind": "software",
                                          "packageName": "OtherPackage"}]}),
                ("dataset", {"set__datasets": [{"id": "d0", "readme": "Data.",
                                               "keywords": ["diffraction"]}]}),
                ("chart", {"set__charts": [{"id": "c0",
                                            "imageFile": "charts/a.png",
                                            "caption": "A chart",
                                            "properties": ["pressure"]}]}),
                ("script", {"set__scripts": [{"id": "s0", "readme": "Fit.",
                                              "keywords": ["fitting"]}]})):
            with self.subTest(field=label):
                RelatedResearchCache.drop_collection()
                self.fetch()
                Paper.objects(id=self.subject_id).update(**update)
                _, stub = self.fetch()
                self.assertTrue(stub.calls, label)

    def test_ownership_and_file_server_edits_do_NOT_refetch(self):
        # These change nothing a recommendation depends on. Refetching for
        # them would also mean private fields were part of the cache key.
        self.fetch()
        Paper.objects(id=self.subject_id).update(
            set__owner_email="someone@example.com",
            set__editor_emails=["editor@example.com"],
            set__info__fileServerPath="https://elsewhere.example.org/x",
            set__info__insertedBy={"firstName": "Other", "lastName": "Person",
                                   "emailId": "other@example.com"},
            set__updated_by_email="someone@example.com")
        _, stub = self.fetch()
        self.assertEqual([], stub.calls)

    def test_a_legacy_entry_without_a_fingerprint_is_a_miss_not_a_migration(self):
        self.fetch()
        # Exactly what a document written by the previous version looks like.
        RelatedResearchCache.objects(paper_id=self.subject_id).update_one(
            unset__fingerprint=1)
        self.assertIsNone(self.entry().fingerprint)
        response, stub = self.fetch()
        self.assertTrue(stub.calls, "a fingerprintless entry must not be used")
        self.assertEqual("ok", response.json()["external"]["status"])
        self.assertTrue(self.entry().fingerprint)

    def test_the_stored_fingerprint_is_a_digest_and_leaks_nothing(self):
        self.fetch(env=ENABLED_WITH_KEY)
        fingerprint = self.entry().fingerprint
        self.assertRegex(fingerprint, r"^[0-9a-f]{64}$")
        for leak in ("rareword", "gadgetite", "Sharedname", "10.1000/subject",
                     "curator@example.com", "files.example.org",
                     "test-s2-super-secret"):
            self.assertNotIn(leak.lower(), fingerprint)


# ------------------------------------------------------- provider failures

class TestProviderFailuresDegradeGracefully(RelatedTestCase):
    def assert_internal_survives(self, provider):
        response, _ = self.fetch(provider=provider)
        self.assertEqual(200, response.status_code)
        body = response.json()
        self.assertTrue(body["internal"]["results"],
                        "internal results must survive a provider failure")
        self.assertEqual([], body["external"]["results"])
        return body

    def test_a_404_is_the_provider_ANSWERING_not_in_the_index(self):
        # The one failure that is a fact about the record.
        body = self.assert_internal_survives(
            ProviderStub(resolution_mode="not_found"))
        self.assertEqual("unresolved", body["external"]["status"])

    def test_a_404_from_the_recommendations_call_is_also_an_answer(self):
        body = self.assert_internal_survives(
            ProviderStub(recommendation_mode="not_found"))
        self.assertEqual("unresolved", body["external"]["status"])

    def test_every_non_answer_during_DOI_resolution_is_unavailable(self):
        # Previously ALL of these were recorded as "not in the index" and kept
        # for seven days: a timing-out or rate-limited provider silently
        # became a durable claim about the record.
        for mode in FAILURE_MODES:
            with self.subTest(mode=mode):
                RelatedResearchCache.drop_collection()
                body = self.assert_internal_survives(
                    ProviderStub(resolution_mode=mode))
                self.assertEqual("unavailable", body["external"]["status"],
                                 mode)

    def test_every_non_answer_during_title_lookup_is_unavailable(self):
        no_doi = Paper(**paper_doc(
            "nodoi-fail", "Rareword resonance of gadgetite whiskers",
            "Rareword resonance in gadgetite lattices with a cryogenic "
            "spectrometer.", tags=["rareword resonance"], doi="")).save()
        for mode in FAILURE_MODES:
            with self.subTest(mode=mode):
                RelatedResearchCache.drop_collection()
                response, stub = self.fetch(
                    paper_id=str(no_doi.id),
                    provider=ProviderStub(resolution_mode=mode))
                self.assertEqual(200, response.status_code)
                self.assertEqual("unavailable",
                                 response.json()["external"]["status"], mode)
                # It failed at the lookup, so it never asked for
                # recommendations for a paper it had not identified.
                self.assertIsNone(stub.recommendation_call, mode)

    def test_every_non_answer_during_recommendations_is_unavailable(self):
        for mode in FAILURE_MODES:
            with self.subTest(mode=mode):
                RelatedResearchCache.drop_collection()
                body = self.assert_internal_survives(
                    ProviderStub(recommendation_mode=mode))
                self.assertEqual("unavailable", body["external"]["status"],
                                 mode)

    def test_a_non_answer_is_never_cached_as_a_week_long_fact(self):
        for mode in FAILURE_MODES:
            with self.subTest(mode=mode):
                RelatedResearchCache.drop_collection()
                self.fetch(provider=ProviderStub(resolution_mode=mode))
                entry = RelatedResearchCache.objects(
                    paper_id=self.subject_id).first()
                self.assertEqual("unavailable", entry.status, mode)
                self.assertLessEqual(
                    entry.expires_at,
                    datetime.utcnow() + timedelta(
                        seconds=related.FAILURE_RETRY_SECONDS + 5), mode)

    def test_not_found_IS_cached_for_the_full_ttl(self):
        self.fetch(provider=ProviderStub(resolution_mode="not_found"))
        entry = RelatedResearchCache.objects(paper_id=self.subject_id).first()
        self.assertEqual("unresolved", entry.status)
        self.assertGreater(entry.expires_at,
                           datetime.utcnow() + timedelta(days=6))

    def test_a_non_answer_within_the_retry_window_still_reads_as_stale(self):
        # A failure is remembered for an hour. Anything served from that entry
        # came from an EARLIER success, so it must still be flagged stale --
        # the same promise the refresh path makes.
        self.fetch()
        RelatedResearchCache.objects(paper_id=self.subject_id).update_one(
            set__expires_at=datetime.utcnow() - timedelta(days=1))
        self.fetch(provider=ProviderStub(recommendation_mode="timeout"))
        response, stub = self.fetch(
            provider=ProviderStub(recommendation_mode="timeout"))
        external = response.json()["external"]
        self.assertEqual([], stub.calls, "the retry window must be honoured")
        self.assertEqual("unavailable", external["status"])
        self.assertTrue(external["stale"])
        self.assertTrue(external["results"])

    def test_no_provider_error_body_or_header_reaches_the_response(self):
        class Leaky(ProviderStub):
            def get(self, url, params=None, headers=None, timeout=None):
                self.calls.append({"url": url, "params": params or {},
                                   "headers": headers or {},
                                   "timeout": timeout})
                return FakeResponse(
                    {"error": "INTERNAL PROVIDER STACK TRACE",
                     "message": "quota exceeded for key test-s2-super-secret"},
                    500)
        response, _ = self.fetch(env=ENABLED_WITH_KEY, provider=Leaky())
        text = response.text
        for leak in ("INTERNAL PROVIDER STACK TRACE", "quota exceeded",
                     "test-s2-super-secret", "x-api-key"):
            self.assertNotIn(leak, text, leak)


# ------------------------------------------------------------ access policy

class TestAccessPolicy(RelatedTestCase):
    def test_a_missing_record_is_not_found(self):
        response, stub = self.fetch(paper_id="000000000000000000000000")
        self.assertEqual(404, response.status_code)
        self.assertEqual([], stub.calls)

    def test_an_unparseable_id_is_not_found(self):
        response, _ = self.fetch(paper_id="not-an-object-id")
        self.assertEqual(404, response.status_code)

    def test_a_deactivated_record_is_not_available_to_the_public(self):
        response, stub = self.fetch(paper_id=str(self.papers["hidden"].id))
        self.assertEqual(404, response.status_code)
        self.assertEqual("This record is not available.",
                         response.json()["error"])
        self.assertEqual([], stub.calls)

    def test_reading_related_research_changes_nothing(self):
        before = {str(p.id): json.dumps(p.to_mongo().to_dict(), default=str,
                                        sort_keys=True)
                  for p in Paper.objects()}
        self.fetch()
        self.fetch()
        after = {str(p.id): json.dumps(p.to_mongo().to_dict(), default=str,
                                       sort_keys=True)
                 for p in Paper.objects()}
        self.assertEqual(before, after)

    def test_the_response_carries_no_account_or_file_server_data(self):
        response, _ = self.fetch(env=ENABLED_WITH_KEY)
        text = response.text
        for leak in ("curator@example.com", "files.example.org",
                     "insertedBy", "owner_email", "editor_emails",
                     "test-s2-super-secret"):
            self.assertNotIn(leak, text, leak)


if __name__ == "__main__":
    unittest.main()
