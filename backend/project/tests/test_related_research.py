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


class ProviderStub:
    """Stands in for `requests`, dispatching on the URL the code chose.
    Records every call so the tests can assert on the endpoint, the params
    and the headers actually used."""

    def __init__(self, resolution=None, recommendations=None,
                 recommendation_status=200, resolution_status=200):
        self.calls = []
        self.resolution = (resolution if resolution is not None
                           else {"paperId": "S2-SUBJECT",
                                 "title": "Rareword resonance of gadgetite "
                                          "lattices",
                                 "externalIds": {"DOI": "10.1000/subject"},
                                 "references": []})
        self.recommendations = (recommendations if recommendations is not None
                                else [RELATED_EXTERNAL, UNRELATED_EXTERNAL])
        self.recommendation_status = recommendation_status
        self.resolution_status = resolution_status

    def get(self, url, params=None, headers=None, timeout=None):
        self.calls.append({"url": url, "params": params or {},
                           "headers": headers or {}, "timeout": timeout})
        if url.startswith(related.SEMANTIC_SCHOLAR_RECOMMENDATIONS_URL):
            if self.recommendation_status != 200:
                return FakeResponse({"error": "rate limited"},
                                    self.recommendation_status)
            return FakeResponse({"recommendedPapers": self.recommendations})
        if self.resolution_status != 200:
            return FakeResponse({"error": "nope"}, self.resolution_status)
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
            provider=ProviderStub(recommendation_status=429))
        external = response.json()["external"]
        self.assertTrue(external["stale"])
        self.assertEqual("unavailable", external["status"])
        self.assertTrue(external["results"])
        self.assertEqual("Rareword resonance in gadgetite single crystals",
                         external["results"][0]["title"])

    def test_a_first_ever_failure_is_an_empty_external_section_not_a_stale_one(self):
        response, _ = self.fetch(
            provider=ProviderStub(recommendation_status=500))
        external = response.json()["external"]
        self.assertEqual("unavailable", external["status"])
        self.assertEqual([], external["results"])
        self.assertFalse(external["stale"])

    def test_a_failure_is_remembered_only_briefly(self):
        self.fetch(provider=ProviderStub(recommendation_status=429))
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

    def test_a_timeout_does_not_become_a_500(self):
        class Timeout(ProviderStub):
            def get(self, url, params=None, headers=None, timeout=None):
                raise IOError("timed out")
        body = self.assert_internal_survives(Timeout())
        self.assertEqual("unresolved", body["external"]["status"])

    def test_a_404_from_the_provider_is_not_an_error_page(self):
        body = self.assert_internal_survives(
            ProviderStub(resolution_status=404))
        self.assertEqual("unresolved", body["external"]["status"])

    def test_a_429_leaves_the_page_intact(self):
        body = self.assert_internal_survives(
            ProviderStub(recommendation_status=429))
        self.assertEqual("unavailable", body["external"]["status"])

    def test_a_malformed_response_is_treated_as_a_failure(self):
        class Malformed(ProviderStub):
            def get(self, url, params=None, headers=None, timeout=None):
                self.calls.append({"url": url, "params": params or {},
                                   "headers": headers or {},
                                   "timeout": timeout})
                return FakeResponse(None)
        self.assert_internal_survives(Malformed())

    def test_an_unexpected_payload_shape_is_treated_as_a_failure(self):
        class Weird(ProviderStub):
            def get(self, url, params=None, headers=None, timeout=None):
                self.calls.append({"url": url, "params": params or {},
                                   "headers": headers or {},
                                   "timeout": timeout})
                return FakeResponse(["not", "an", "object"])
        self.assert_internal_survives(Weird())

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
