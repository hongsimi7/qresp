"""Publication metadata is factual data, so it comes from facts only.

Two sources are allowed: the DOI registry, and what is actually printed in
the manuscript. There is no AI step here -- the publication-metadata assist
endpoint was removed, and these tests keep it removed. AI remains where
interpretation is genuinely needed (keyword suggestion, RCC candidate
descriptions), and those paths have their own tests.
"""
import base64
import io
import os
import unittest
from unittest import mock

import yaml

from project import assist, connexionapp, manuscript

SWAGGER_PATH = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "swagger.yml")

TEX_WITH_DOI = r"""\title{A Printed Title}
\author{Ada Lovelace}
DOI: 10.1234/qresp.demo
\begin{abstract}A printed abstract.\end{abstract}
"""

TEX_NO_DOI = r"""\title{A Printed Title}
\author{Ada Lovelace}
"""

TEX_WITH_ABSTRACT = r"""\title{A Printed Title}
\author{Ada Lovelace}
\begin{abstract}A printed abstract.\end{abstract}
"""


class TestPublicationAiRouteIsGone(unittest.TestCase):

    def test_no_handler_remains(self):
        for name in ("suggest_publication_metadata", "looks_supplementary",
                     "derive_doi_url", "PUBLICATION_FIELDS",
                     "PUBLICATION_RESPONSE_SCHEMA",
                     "PUBLICATION_SYSTEM_PROMPT"):
            self.assertFalse(hasattr(assist, name),
                             "assist.%s should have been removed" % name)

    def test_no_swagger_route(self):
        with io.open(SWAGGER_PATH, encoding="utf-8") as handle:
            spec = yaml.safe_load(handle)
        paths = spec.get("paths") or {}
        self.assertNotIn("/assist/publication-metadata", paths)
        operations = [
            operation.get("operationId")
            for path in paths.values() for operation in path.values()
            if isinstance(operation, dict)
        ]
        self.assertNotIn("project.assist.suggest_publication_metadata",
                         operations)
        # The AI features that DO survive are still routed.
        self.assertIn("/assist/keywords", paths)

    def test_the_shared_ai_plumbing_survives(self):
        # Removing one feature must not take the transport, the quota or the
        # keyword endpoint with it.
        for name in ("call_gemini", "suggest_keywords", "_gemini_config",
                     "_consume_daily_quota"):
            self.assertTrue(hasattr(assist, name), name)


class TestCrossrefMapping(unittest.TestCase):
    """Journal, volume, page and year come from the registry, exactly."""

    MESSAGE = {
        "title": ["Registry Title"],
        "author": [{"given": "Ada B.", "family": "Lovelace"}],
        "container-title": ["Journal of Computing"],
        "issued": {"date-parts": [[2021, 5]]},
        "created": {"date-parts": [[2022, 1]]},
        "volume": "12",
        "issue": "3",
        "page": "100-110",
        "abstract": "<jats:p>Registry abstract.</jats:p>",
        "DOI": "10.1234/Qresp.Demo",
        "URL": "https://doi.org/10.1234/qresp.demo",
    }

    def test_each_field_maps_where_it_should(self):
        fields = manuscript._crossref_fields(self.MESSAGE)
        self.assertEqual(fields["journal"], "Journal of Computing")
        self.assertEqual(fields["volume"], "12")
        self.assertEqual(fields["issue"], "3")
        self.assertEqual(fields["pages"], "100-110")
        self.assertEqual(fields["title"], "Registry Title")
        self.assertEqual(fields["authors"][0]["lastName"], "Lovelace")

    def test_year_comes_from_the_publication_date_not_the_record_date(self):
        # `issued` is when the work was published; `created` is when the
        # registry row was made, and the two fall in different years often
        # enough to matter.
        self.assertEqual(
            manuscript._crossref_fields(self.MESSAGE)["year"], 2021)

    def test_the_doi_is_normalized_and_the_abstract_is_untagged(self):
        fields = manuscript._crossref_fields(self.MESSAGE)
        self.assertEqual(fields["doi"], "10.1234/qresp.demo")
        self.assertEqual(fields["abstract"], "Registry abstract.")

    def test_absent_registry_fields_are_left_out_entirely(self):
        # A value the registry does not supply is left for the curator to
        # enter by hand. It is never filled with a placeholder or a guess.
        fields = manuscript._crossref_fields({"title": ["Only A Title"]})
        for absent in ("journal", "volume", "pages", "year", "abstract"):
            self.assertNotIn(absent, fields)


class ImportBase(unittest.TestCase):

    def setUp(self):
        self.client = connexionapp.test_client()
        os.environ["QRESP_ENABLE_DEV_LOGIN"] = "1"
        self.client.post("/api/auth/dev-login",
                         json={"email": "curator@example.com"})
        self.csrf = self.client.get("/api/auth/me").json()["csrf_token"]

    def tearDown(self):
        os.environ.pop("QRESP_ENABLE_DEV_LOGIN", None)

    def import_source(self, text, crossref=None, filename="paper.tex"):
        payload = {"filename": filename,
                   "content_base64": base64.b64encode(
                       text.encode("utf-8")).decode("ascii")}
        with mock.patch("project.manuscript.requests") as http:
            if crossref is None:
                http.get.side_effect = AssertionError(
                    "unexpected network call")
            else:
                inner = mock.Mock()
                inner.status_code = 200
                inner.json.return_value = {"message": crossref}
                http.get.return_value = inner
            return self.client.post("/api/import/manuscript", json=payload,
                                    headers={"X-CSRF-Token": self.csrf})


class TestCanonicalUrl(ImportBase):

    def test_a_doi_with_no_registry_url_gets_the_canonical_one(self):
        # The registry answered without a URL, so the one resolvable address a
        # DOI has is computed -- not looked up elsewhere, and not guessed.
        response = self.import_source(TEX_WITH_DOI,
                                      crossref={"title": ["Registry Title"]})
        self.assertEqual(200, response.status_code)
        body = response.json()
        self.assertEqual(body["proposal"]["url"],
                         "https://doi.org/10.1234/qresp.demo")
        self.assertEqual(body["provenance"]["url"], "derived")

    def test_the_registry_url_wins_when_there_is_one(self):
        response = self.import_source(
            TEX_WITH_DOI,
            crossref={"URL": "https://pubs.example.org/article/1"})
        body = response.json()
        self.assertEqual(body["proposal"]["url"],
                         "https://pubs.example.org/article/1")
        self.assertNotEqual(body["provenance"].get("url"), "derived")

    def test_no_doi_means_no_url_is_invented(self):
        response = self.import_source(TEX_NO_DOI)
        self.assertNotIn("url", response.json()["proposal"])


class TestImportNeverCallsGemini(ImportBase):
    """The deterministic paths must not reach the AI provider at all."""

    def test_tex_import_makes_no_provider_call(self):
        with mock.patch.object(assist, "call_gemini") as gemini:
            response = self.import_source(TEX_WITH_ABSTRACT)
        self.assertEqual(200, response.status_code)
        self.assertFalse(gemini.called)
        # ...and the printed abstract still arrives.
        self.assertEqual(response.json()["proposal"]["abstract"],
                         "A printed abstract.")

    def test_a_doi_fetch_makes_no_provider_call(self):
        with mock.patch.object(assist, "call_gemini") as gemini:
            with mock.patch("project.manuscript.requests") as http:
                inner = mock.Mock()
                inner.status_code = 200
                inner.json.return_value = {
                    "message": TestCrossrefMapping.MESSAGE}
                http.get.return_value = inner
                response = self.client.post(
                    "/api/import/doi", json={"doi": "10.1234/qresp.demo"},
                    headers={"X-CSRF-Token": self.csrf})
        self.assertEqual(200, response.status_code)
        self.assertEqual(response.json()["proposal"]["journal"],
                         "Journal of Computing")
        self.assertFalse(gemini.called)


if __name__ == "__main__":
    unittest.main()
