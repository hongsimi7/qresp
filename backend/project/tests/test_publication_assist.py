import json
import os
import unittest
from unittest import mock

import mongoengine
import mongomock

# Publication-metadata assistance: a SEPARATE endpoint from keyword
# suggestion, because the two answer different questions and carry different
# payloads. Everything here is a proposal — the DOI registry stays
# authoritative, a URL is derived rather than asked for, and nothing is
# applied, stored or published by this call. The provider is fully mocked;
# no external request is ever made.
from project import assist
from project import connexionapp
from project.models import AssistUsage, Paper

GEMINI_ENV = {
    "QRESP_GEMINI_ENABLED": "1",
    "QRESP_GEMINI_API_KEY": "test-gemini-super-secret",
    "QRESP_GEMINI_MODEL": "gemini-test",
}

SOURCE = ("Published in Journal of Chemical Physics, volume 158, pages "
          "014101-014112, in 2023. Abstract: We compute the electronic "
          "structure of embedded lead clusters using hybrid functionals.")


def gemini_reply(fields):
    return {"candidates": [{"content": {"parts": [
        {"text": json.dumps({"fields": fields})}]}}]}


class MockResponse:
    def __init__(self, payload, status_code=200, text=""):
        self._payload = payload
        self.status_code = status_code
        self.text = text

    def json(self):
        return self._payload


class PublicationAssistBase(unittest.TestCase):
    def setUp(self):
        self.client = connexionapp.test_client()
        os.environ["QRESP_ENABLE_DEV_LOGIN"] = "1"
        for key, value in GEMINI_ENV.items():
            os.environ[key] = value
        mongoengine.disconnect_all()
        mongoengine.connect("mongoenginetest",
                            mongo_client_class=mongomock.MongoClient)

    def tearDown(self):
        os.environ.pop("QRESP_ENABLE_DEV_LOGIN", None)
        for key in GEMINI_ENV:
            os.environ.pop(key, None)
        AssistUsage.drop_collection()
        mongoengine.disconnect_all()

    def login(self, email="curator@example.com"):
        response = self.client.post("/api/auth/dev-login",
                                    json={"email": email})
        assert response.status_code == 200, response.text
        self.csrf = self.client.get("/api/auth/me").json()["csrf_token"]

    def suggest(self, payload, fields=None, reply=None, csrf=True):
        headers = {}
        if csrf and getattr(self, "csrf", None):
            headers["X-CSRF-Token"] = self.csrf
        with mock.patch("project.assist.requests") as requests_mock:
            requests_mock.post.return_value = (
                reply if reply is not None
                else MockResponse(gemini_reply(fields or [])))
            response = self.client.post(
                "/api/assist/publication-metadata", json=payload,
                headers=headers)
        return response, requests_mock

    def by_field(self, body):
        return {p["field"]: p for p in body["proposals"]}


class TestGating(PublicationAssistBase):
    def test_anonymous_rejected(self):
        response, requests_mock = self.suggest(
            {"consent": True, "source_text": SOURCE}, csrf=False)
        self.assertEqual(401, response.status_code)
        requests_mock.post.assert_not_called()

    def test_missing_csrf_rejected(self):
        self.login()
        response, requests_mock = self.suggest(
            {"consent": True, "source_text": SOURCE}, csrf=False)
        self.assertEqual(403, response.status_code)
        requests_mock.post.assert_not_called()

    def test_no_ai_call_before_consent(self):
        self.login()
        response, requests_mock = self.suggest(
            {"consent": False, "source_text": SOURCE})
        self.assertEqual(400, response.status_code)
        self.assertIn("Confirm", response.json()["error"])
        requests_mock.post.assert_not_called()

    def test_unconfigured_provider_reports_503_without_calling_out(self):
        for key in GEMINI_ENV:
            os.environ.pop(key, None)
        self.login()
        response, requests_mock = self.suggest(
            {"consent": True, "source_text": SOURCE})
        self.assertEqual(503, response.status_code)
        requests_mock.post.assert_not_called()

    def test_quota_is_shared_with_the_other_assist_features(self):
        os.environ["QRESP_GEMINI_MAX_REQUESTS_PER_USER_PER_DAY"] = "1"
        try:
            self.login()
            first, _ = self.suggest({"consent": True, "source_text": SOURCE})
            self.assertEqual(200, first.status_code)
            second, requests_mock = self.suggest(
                {"consent": True, "source_text": SOURCE})
            self.assertEqual(429, second.status_code)
            requests_mock.post.assert_not_called()
        finally:
            os.environ.pop("QRESP_GEMINI_MAX_REQUESTS_PER_USER_PER_DAY", None)


class TestPayloadBoundary(PublicationAssistBase):
    def sent(self, payload, fields=None):
        self.login()
        _, requests_mock = self.suggest(payload, fields=fields)
        body = requests_mock.post.call_args.kwargs["json"]
        return json.loads(body["contents"][0]["parts"][0]["text"]), body

    def test_only_allowlisted_bibliographic_fields_travel(self):
        payload, _ = self.sent({
            "consent": True,
            "title": "Known title",
            "doi": "10.1021/x",
            "source_text": SOURCE,
            # None of this may leave the browser through this endpoint.
            "PIs": "Prof Example",
            "tags": ["dft", "water"],
            "collections": ["PaperStack A"],
            "notebookFile": "/rcc/notebook.ipynb",
            "fileServerPath": "https://notebook.rcc.uchicago.edu/files/x",
            "owner_email": "curator@example.com",
            "charts": [{"imageFile": "figures/f1.png"}],
            "datasets": [{"files": ["data/a.csv"]}],
        })
        self.assertEqual({"known_fields", "missing_fields",
                          "manuscript_excerpt"}, set(payload))
        self.assertEqual({"title": "Known title", "doi": "10.1021/x"},
                         payload["known_fields"])
        serialized = json.dumps(payload)
        for leaked in ("Prof Example", "PaperStack A", "notebook.ipynb",
                       "notebook.rcc", "curator@example.com",
                       "figures/f1.png", "data/a.csv", "dft"):
            self.assertNotIn(leaked, serialized, leaked)

    def test_the_excerpt_is_bounded(self):
        payload, _ = self.sent({"consent": True, "source_text": "x" * 999999})
        self.assertEqual(assist.MAX_PUB_SOURCE_CHARS,
                         len(payload["manuscript_excerpt"]))

    def test_only_missing_fields_are_requested(self):
        payload, _ = self.sent({
            "consent": True, "title": "T", "authors": "A",
            "source_text": SOURCE})
        self.assertNotIn("title", payload["missing_fields"])
        self.assertNotIn("authors", payload["missing_fields"])
        self.assertIn("publication", payload["missing_fields"])

    def test_structured_output_and_no_tools(self):
        _, body = self.sent({"consent": True, "source_text": SOURCE})
        self.assertEqual(assist.PUBLICATION_RESPONSE_SCHEMA,
                         body["generationConfig"]["responseSchema"])
        self.assertEqual("application/json",
                         body["generationConfig"]["responseMimeType"])
        for forbidden in ("tools", "toolConfig"):
            self.assertNotIn(forbidden, body)


class TestSourcePrecedence(PublicationAssistBase):
    def test_a_url_is_derived_from_the_doi_without_asking_the_model(self):
        self.login()
        response, requests_mock = self.suggest(
            {"consent": True, "doi": "10.1021/acs.jpcc.5c01077",
             "title": "T", "authors": "A", "publication": "J", "volume": "1",
             "page": "1", "year": "2023", "abstract": "A", "kind": "journal"},
            fields=[])
        proposals = self.by_field(response.json())
        self.assertEqual("https://doi.org/10.1021/acs.jpcc.5c01077",
                         proposals["url"]["value"])
        self.assertEqual("doi_registry", proposals["url"]["provenance"])
        # Every field was known, so the provider was never called at all.
        requests_mock.post.assert_not_called()

    def test_an_invalid_doi_derives_no_url(self):
        self.login()
        response, _ = self.suggest(
            {"consent": True, "doi": "not-a-doi", "source_text": SOURCE},
            fields=[])
        self.assertNotIn("url", self.by_field(response.json()))

    def test_the_model_can_never_originate_a_doi_or_url(self):
        self.login()
        response, _ = self.suggest(
            {"consent": True, "source_text": SOURCE},
            fields=[
                {"field": "doi", "value": "10.9999/invented",
                 "confidence": "medium", "evidence": "made up"},
                {"field": "url", "value": "https://evil.example.com/paper",
                 "confidence": "medium", "evidence": "made up"},
                {"field": "publication", "value": "Journal of Chemical Physics",
                 "confidence": "medium", "evidence": "Published in ..."},
            ])
        proposals = self.by_field(response.json())
        self.assertNotIn("doi", proposals)
        self.assertNotIn("url", proposals)
        # The legitimate reading survives.
        self.assertEqual("Journal of Chemical Physics",
                         proposals["publication"]["value"])

    def test_a_field_the_curator_already_filled_is_never_proposed_over(self):
        self.login()
        response, _ = self.suggest(
            {"consent": True, "publication": "My own journal name",
             "source_text": SOURCE},
            fields=[{"field": "publication", "value": "Something else",
                     "confidence": "medium", "evidence": "x"}])
        self.assertNotIn("publication", self.by_field(response.json()))

    def test_ai_confidence_can_never_be_high(self):
        self.login()
        response, _ = self.suggest(
            {"consent": True, "source_text": SOURCE},
            fields=[{"field": "year", "value": "2023", "confidence": "high",
                     "evidence": "in 2023"}])
        year = self.by_field(response.json())["year"]
        self.assertIn(year["confidence"], ("medium", "low"))
        self.assertEqual("ai", year["provenance"])

    def test_no_evidence_means_no_proposal_and_a_plain_message(self):
        self.login()
        response, _ = self.suggest(
            {"consent": True, "source_text": "Nothing bibliographic here."},
            fields=[])
        body = response.json()
        self.assertEqual([], body["proposals"])
        self.assertTrue(any("No reliable value" in w
                            for w in body["warnings"]))

    def test_an_out_of_vocabulary_field_is_dropped(self):
        self.login()
        response, _ = self.suggest(
            {"consent": True, "source_text": SOURCE},
            fields=[{"field": "owner_email", "value": "x@y.z"},
                    {"field": "tags", "value": "dft"},
                    {"field": "year", "value": "2023"}])
        proposals = self.by_field(response.json())
        self.assertEqual(["year"], list(proposals))

    def test_every_proposal_carries_provenance_confidence_and_evidence(self):
        self.login()
        response, _ = self.suggest(
            {"consent": True, "source_text": SOURCE},
            fields=[{"field": "volume", "value": "158",
                     "confidence": "medium", "evidence": "volume 158"}])
        volume = self.by_field(response.json())["volume"]
        self.assertEqual(
            {"field", "value", "provenance", "confidence", "evidence"},
            set(volume))
        self.assertEqual("volume 158", volume["evidence"])


class TestSupplementaryProtection(PublicationAssistBase):
    def test_supplementary_filenames_are_detected(self):
        for name in ("paper_si_v2.pdf", "acs-si-2023.pdf",
                     "supporting-information.pdf", "supp_material.pdf",
                     "ESI.pdf", "paper_supplementary.pdf"):
            self.assertTrue(assist.looks_supplementary(name), name)
        for name in ("paper.pdf", "manuscript.tex", "silicon_study.pdf"):
            self.assertFalse(assist.looks_supplementary(name), name)

    def test_a_supplementary_file_warns_and_caps_confidence_at_low(self):
        self.login()
        response, _ = self.suggest(
            {"consent": True, "filename": "paper_si_v2.pdf",
             "source_text": SOURCE},
            fields=[{"field": "publication", "value": "J. Chem. Phys.",
                     "confidence": "medium", "evidence": "Published in ..."}])
        body = response.json()
        self.assertTrue(body["supplementary"])
        self.assertTrue(any("supporting information" in w
                            for w in body["warnings"]))
        # Nothing from a supplement may look confident.
        self.assertEqual("low",
                         self.by_field(body)["publication"]["confidence"])

    def test_an_ordinary_filename_is_not_flagged(self):
        self.login()
        response, _ = self.suggest(
            {"consent": True, "filename": "paper.pdf", "source_text": SOURCE},
            fields=[{"field": "year", "value": "2023", "confidence": "medium"}])
        body = response.json()
        self.assertFalse(body["supplementary"])
        self.assertEqual("medium", self.by_field(body)["year"]["confidence"])


class TestNoPersistenceOrLeakage(PublicationAssistBase):
    def test_nothing_is_written_to_mongo(self):
        self.login()
        before = Paper.objects.count()
        self.suggest({"consent": True, "source_text": SOURCE})
        self.assertEqual(before, Paper.objects.count())

    def test_source_text_and_key_never_reach_the_log_or_response(self):
        self.login()
        secret_source = "SECRET_MANUSCRIPT_BODY " + SOURCE
        with mock.patch("builtins.print") as printed:
            response, _ = self.suggest(
                {"consent": True, "source_text": secret_source},
                fields=[{"field": "year", "value": "2023"}])
        logged = " ".join(str(call.args[0]) for call in printed.call_args_list
                          if call.args)
        self.assertNotIn("SECRET_MANUSCRIPT_BODY", logged)
        self.assertNotIn("SECRET_MANUSCRIPT_BODY", response.text)
        self.assertNotIn("test-gemini-super-secret", logged)
        self.assertNotIn("test-gemini-super-secret", response.text)

    def test_provider_error_details_never_leak(self):
        self.login()
        response, _ = self.suggest(
            {"consent": True, "source_text": SOURCE},
            reply=MockResponse({"error": {"message": "invalid api key abc123"}},
                               status_code=403, text="invalid api key abc123"))
        self.assertEqual(502, response.status_code)
        self.assertNotIn("abc123", response.text)

    def test_a_malformed_provider_answer_is_a_clean_502(self):
        self.login()
        response, _ = self.suggest(
            {"consent": True, "source_text": SOURCE},
            reply=MockResponse({"candidates": [{"content": {"parts": [
                {"text": "not JSON"}]}}]}))
        self.assertEqual(502, response.status_code)
        self.assertIn("unreadable", response.json()["error"])


class TestKeywordEndpointIsSeparate(PublicationAssistBase):
    def test_the_two_endpoints_are_distinct_handlers(self):
        self.assertIsNot(assist.suggest_publication_metadata,
                         assist.suggest_keywords)

    def test_publication_assist_never_returns_keywords(self):
        self.login()
        response, _ = self.suggest(
            {"consent": True, "source_text": SOURCE},
            fields=[{"field": "year", "value": "2023"}])
        self.assertNotIn("keywords", response.json())


if __name__ == "__main__":
    unittest.main()
