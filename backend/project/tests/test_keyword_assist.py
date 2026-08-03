"""Keyword suggestion: the record's OWN metadata, and nothing else.

This endpoint reads what the curator wrote -- the bibliographic fields and the
descriptive fields of artifacts they have already accepted into the record --
and proposes tags. It never reads a source file, a path, a URL, or anything
about the account, because there is no manuscript upload in Qresp and this
must not become one under another name.
"""
import json
import os
import unittest
from unittest import mock

import mongoengine
import mongomock

from project import assist, connexionapp


class MockResponse:
    def __init__(self, payload, status_code=200):
        self._payload = payload
        self.status_code = status_code
        self.text = json.dumps(payload)

    def json(self):
        return self._payload


def gemini_answer(keywords):
    return MockResponse({
        "candidates": [{
            "content": {
                "parts": [{"text": json.dumps({"keywords": keywords})}]},
            "finishReason": "STOP",
        }],
    })


def sent_payload(http):
    """The allowlisted object exactly as it left for the provider."""
    request = http.post.call_args.kwargs["json"]
    return json.loads(request["contents"][0]["parts"][0]["text"])


def sent_text(http):
    """The whole outgoing request, for checking what must NOT be in it."""
    return json.dumps(http.post.call_args.kwargs["json"])


CONFIGURED = {
    "QRESP_GEMINI_ENABLED": "1",
    "QRESP_GEMINI_API_KEY": "test-gemini-super-secret",
}

BODY = {"consent": True,
        "title": "Pressure tuning of layered chalcogenides",
        "abstract": "We show that pressure tunes the electronic gap."}


class KeywordTestBase(unittest.TestCase):

    def setUp(self):
        mongoengine.disconnect_all()
        mongoengine.connect(
            "qresp_keyword_test", mongo_client_class=mongomock.MongoClient,
            uuidRepresentation="standard")
        self.client = connexionapp.test_client()
        os.environ["QRESP_ENABLE_DEV_LOGIN"] = "1"

    def tearDown(self):
        os.environ.pop("QRESP_ENABLE_DEV_LOGIN", None)
        mongoengine.disconnect_all()

    def login(self, email="curator@example.com"):
        self.client.post("/api/auth/dev-login", json={"email": email})
        self.csrf = self.client.get("/api/auth/me").json()["csrf_token"]

    def post(self, payload, csrf=True):
        headers = {}
        if csrf and getattr(self, "csrf", None):
            headers["X-CSRF-Token"] = self.csrf
        return self.client.post("/api/assist/keywords", json=payload,
                                headers=headers)

    def configured_post(self, payload, keywords=None):
        answer = keywords if keywords is not None else [
            {"keyword": "density functional theory"}]
        with mock.patch.dict(os.environ, CONFIGURED):
            with mock.patch("project.assist.requests") as http:
                http.post.return_value = gemini_answer(answer)
                response = self.post(payload)
        return response, http

    def seed(self, *tag_lists):
        from project.models import Paper, Reference
        for index, tags in enumerate(tag_lists):
            Paper(reference=Reference(title="Paper %d" % index),
                  tags=list(tags), collections=["c"], schema="1",
                  license="cc", is_active=True).save()


class TestGating(KeywordTestBase):

    def test_anonymous_rejected(self):
        self.assertEqual(401, self.post(BODY, csrf=False).status_code)

    def test_missing_csrf_rejected(self):
        self.login()
        self.assertEqual(403, self.post(BODY, csrf=False).status_code)

    def test_consent_is_required(self):
        self.login()
        with mock.patch.dict(os.environ, CONFIGURED):
            with mock.patch("project.assist.requests") as http:
                response = self.post({"title": "A title"})
        self.assertEqual(400, response.status_code)
        self.assertFalse(http.post.called)

    def test_unconfigured_provider_reports_503_without_calling_out(self):
        self.login()
        with mock.patch("project.assist.requests") as http:
            response = self.post(BODY)
        self.assertEqual(503, response.status_code)
        self.assertIn("not configured", response.json()["error"])
        self.assertFalse(http.post.called)

    def test_nothing_to_work_from_is_refused_before_any_call(self):
        self.login()
        with mock.patch.dict(os.environ, CONFIGURED):
            with mock.patch("project.assist.requests") as http:
                response = self.post({"consent": True})
        self.assertEqual(400, response.status_code)
        self.assertFalse(http.post.called)

    def test_quota_is_enforced_and_costs_one_call_per_request(self):
        self.login()
        limited = dict(CONFIGURED,
                       QRESP_GEMINI_MAX_REQUESTS_PER_USER_PER_DAY="1")
        with mock.patch.dict(os.environ, limited):
            with mock.patch("project.assist.requests") as http:
                http.post.return_value = gemini_answer([{"keyword": "silicon"}])
                first = self.post(BODY)
                second = self.post(BODY)
        self.assertEqual(200, first.status_code)
        self.assertEqual(429, second.status_code)
        # One request, one provider call: the second never reached the wire.
        self.assertEqual(1, http.post.call_count)

    def test_a_malformed_answer_is_reported_as_unreadable(self):
        self.login()
        with mock.patch.dict(os.environ, CONFIGURED):
            with mock.patch("project.assist.requests") as http:
                http.post.return_value = MockResponse({"candidates": [{
                    "content": {"parts": [
                        {"text": "here are some keywords!"}]},
                    "finishReason": "STOP"}]})
                response = self.post(BODY)
        self.assertEqual(502, response.status_code)
        self.assertIn("unreadable", response.json()["error"])


class TestPayloadAllowlist(KeywordTestBase):

    FULL = dict(
        BODY,
        kind="journal", publication="J. Chem. Phys. 158", doi="10.1/x",
        year="2023",
        charts=[{"caption": "Band structure", "properties": ["band gap"],
                 "imageFile": "charts/fig1/fig1.png",
                 "files": ["charts/fig1/data.txt"], "id": "c0"}],
        datasets=[{"description": "Relaxed geometries", "keywords": "geometry",
                   "URLs": ["https://notebook.rcc.uchicago.edu/files/x/y"],
                   "files": ["datasets/geo.xyz"]}],
        scripts=[{"description": "Band plotting", "keywords": "matplotlib",
                  "notebookFile": "scripts/plot.ipynb"}],
        tools=[{"packageName": "Quantum ESPRESSO", "description": "DFT code",
                "facility": "RCC Midway", "measurement": "total energy",
                "version": "7.2"}],
        # None of the following may travel, whatever a caller sends.
        basenames=["/abs/path/to/relaxed_geometry.xyz",
                   "https://notebook.rcc.uchicago.edu/files/run/output.log"],
        unclassified=["secret_notes.txt"],
        candidates=[{"name": "not accepted yet"}],
        insertedBy={"firstName": "Ada", "emailId": "ada@example.com"},
        owner_email="owner@example.com",
        editor_emails=["editor@example.com"],
        drafts=[{"id": "draft1"}],
        content_base64="QUFBQUFB", filename="paper.pdf",
        csrf_token="csrf-token-value", api_key="api-key-value",
    )

    def test_the_descriptive_fields_travel(self):
        self.login()
        _response, http = self.configured_post(self.FULL)
        sent = sent_text(http)
        for allowed in ("Pressure tuning", "Band structure", "band gap",
                        "Relaxed geometries", "Band plotting",
                        "Quantum ESPRESSO", "RCC Midway", "total energy",
                        "journal", "J. Chem. Phys. 158", "10.1/x", "2023"):
            self.assertIn(allowed, sent, allowed)

    def test_nothing_outside_the_allowlist_reaches_the_provider(self):
        self.login()
        _response, http = self.configured_post(self.FULL)
        sent = sent_text(http)
        for forbidden in ("charts/fig1/fig1.png", "charts/fig1/data.txt",
                          "datasets/geo.xyz", "scripts/plot.ipynb",
                          "notebook.rcc.uchicago.edu", "/abs/path/to",
                          "secret_notes.txt", "not accepted yet",
                          "ada@example.com", "owner@example.com",
                          "editor@example.com", "draft1", "QUFBQUFB",
                          "paper.pdf", "csrf-token-value", "api-key-value",
                          "insertedBy", "7.2", '"c0"'):
            self.assertNotIn(forbidden, sent, forbidden)

    def test_a_file_name_travels_without_its_path(self):
        self.login()
        _response, http = self.configured_post(self.FULL)
        payload = sent_payload(http)
        self.assertEqual(payload["file_names"],
                         ["relaxed_geometry.xyz", "output.log"])

    def test_the_context_is_bounded(self):
        self.login()
        many = [{"description": "d%d" % i, "keywords": "k%d" % i}
                for i in range(200)]
        _response, http = self.configured_post(dict(BODY, datasets=many))
        payload = sent_payload(http)
        self.assertLessEqual(len(payload["reviewed_artifacts"]["datasets"]),
                             assist.MAX_CONTEXT_ITEMS)

    def test_the_api_key_rides_in_a_header_not_the_payload(self):
        self.login()
        _response, http = self.configured_post(BODY)
        self.assertNotIn("test-gemini-super-secret", sent_text(http))


class TestTaxonomy(KeywordTestBase):

    def test_existing_vocabulary_is_offered_most_frequent_first(self):
        self.login()
        self.seed(["silicon", "DFT"], ["silicon", "band gap"])
        _response, http = self.configured_post(BODY)
        vocabulary = sent_payload(http)["qresp_vocabulary"]
        self.assertEqual(vocabulary[0], "silicon")
        self.assertIn("DFT", vocabulary)
        self.assertIn("band gap", vocabulary)

    def test_the_vocabulary_is_capped(self):
        self.login()
        self.seed(["term%03d" % index for index in range(400)])
        _response, http = self.configured_post(BODY)
        self.assertEqual(len(sent_payload(http)["qresp_vocabulary"]),
                         assist.MAX_TAXONOMY_TERMS)

    def test_case_and_blank_normalization(self):
        self.login()
        self.seed(["Silicon", "silicon", "  ", "", "SILICON"])
        _response, http = self.configured_post(BODY)
        vocabulary = sent_payload(http)["qresp_vocabulary"]
        lowered = [term.lower() for term in vocabulary]
        self.assertEqual(lowered.count("silicon"), 1)
        self.assertNotIn("", lowered)

    def test_suggestions_are_labelled_existing_or_new(self):
        self.login()
        self.seed(["silicon"])
        response, _http = self.configured_post(
            BODY, keywords=[{"keyword": "Silicon", "reason": "in the title"},
                            {"keyword": "chalcogenide", "reason": "new"}])
        self.assertEqual(200, response.status_code)
        by_word = {item["keyword"]: item
                   for item in response.json()["keywords"]}
        # Matched case-insensitively against the existing vocabulary.
        self.assertTrue(by_word["Silicon"]["existing"])
        self.assertFalse(by_word["chalcogenide"]["existing"])

    def test_a_term_outside_the_offered_list_is_still_recognized(self):
        # The model only sees the top MAX_TAXONOMY_TERMS, but labelling runs
        # against the whole vocabulary.
        self.login()
        self.seed(["common"], ["common"], ["rare term"])
        with mock.patch.object(assist, "MAX_TAXONOMY_TERMS", 1):
            _r, http = self.configured_post(BODY,
                                            keywords=[{"keyword": "rare term"}])
            offered = sent_payload(http)["qresp_vocabulary"]
        self.assertEqual(offered, ["common"])
        with mock.patch.object(assist, "MAX_TAXONOMY_TERMS", 1):
            response, _http = self.configured_post(
                BODY, keywords=[{"keyword": "rare term"}])
        self.assertTrue(response.json()["keywords"][0]["existing"])

    def test_no_vocabulary_still_answers(self):
        self.login()
        response, http = self.configured_post(BODY)
        self.assertEqual(200, response.status_code)
        self.assertNotIn("qresp_vocabulary", sent_payload(http))


class TestOutputHandling(KeywordTestBase):

    def test_suggestions_are_capped_deduplicated_and_trimmed(self):
        self.login()
        noisy = [{"keyword": "  silicon  "}, {"keyword": "SILICON"},
                 {"keyword": "x"}, {"keyword": ""},
                 {"keyword": "a" * 100}]
        noisy += [{"keyword": "term%d" % index} for index in range(20)]
        response, _http = self.configured_post(BODY, keywords=noisy)
        words = [item["keyword"] for item in response.json()["keywords"]]
        self.assertLessEqual(len(words), assist.MAX_SUGGESTIONS)
        self.assertEqual(words[0], "silicon")
        self.assertEqual(len([w for w in words if w.lower() == "silicon"]), 1)
        self.assertNotIn("x", words)
        self.assertNotIn("a" * 100, words)

    def test_nothing_is_persisted(self):
        from project.models import Paper
        self.login()
        before = Paper.objects.count()
        self.configured_post(BODY)
        self.assertEqual(Paper.objects.count(), before)

    def test_the_key_and_provider_body_never_reach_the_client(self):
        self.login()
        response, _http = self.configured_post(BODY)
        body = response.text
        self.assertNotIn("test-gemini-super-secret", body)
        self.assertNotIn("candidates", body)
        self.assertNotIn("finishReason", body)


if __name__ == "__main__":
    unittest.main()
