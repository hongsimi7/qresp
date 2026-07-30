import base64
import contextlib
import io
import json
import os
import unittest
import zipfile
from unittest import mock

# Auto-Curation Lite phase 1: DOI lookup + manuscript-source import, through
# the real ASGI middleware. ALL network (Crossref) is mocked — no external
# calls. TeX is only ever parsed as text; nothing is compiled or extracted to
# the filesystem, and these tests also assert that raw manuscript content
# never leaks into responses or stdout.
from project import connexionapp
from project import manuscript

CROSSREF_MESSAGE = {
    "type": "journal-article",
    "title": ["Registry Title"],
    "author": [
        {"given": "Ada B.", "family": "Lovelace"},
        {"given": "Charles", "family": "Babbage"},
    ],
    "container-title": ["Journal of Computing"],
    "issued": {"date-parts": [[2021, 5]]},
    "volume": "12",
    "issue": "3",
    "page": "100-110",
    "abstract": "<jats:p>Registry abstract.</jats:p>",
    "DOI": "10.1234/qresp.demo",
    "URL": "https://doi.org/10.1234/qresp.demo",
    "subject": ["Materials Science", "Computing"],
}

FULL_TEX = r"""
% \title{A commented-out decoy title}
\documentclass{article}
\title{The \textbf{Manuscript} Title\thanks{Funded by X}}
\author{Ada B. Lovelace \and Charles Babbage}
\keywords{simulation, DFT; materials}
\begin{document}
\maketitle
\begin{abstract}
We study \emph{interesting} things carefully.
\end{abstract}
doi: 10.1234/qresp.demo
\end{document}
"""

TEX_NO_DOI = r"""
\documentclass{article}
\title{Unpublished Manuscript}
\author{Solo Author}
\begin{document}
\begin{abstract}Draft abstract.\end{abstract}
\end{document}
"""


def b64(data):
    if isinstance(data, str):
        data = data.encode("utf-8")
    return base64.b64encode(data).decode("ascii")


def make_zip(members, infos=None):
    buffer = io.BytesIO()
    # Deflate like real Overleaf exports — the zip-bomb test relies on 51 MB
    # of zeros compressing far below the raw upload cap.
    with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for name, content in (members or {}).items():
            archive.writestr(name, content)
        for info, content in (infos or []):
            archive.writestr(info, content)
    return buffer.getvalue()


class MockResponse:
    def __init__(self, payload, status_code=200):
        self._payload = payload
        self.status_code = status_code

    def json(self):
        return self._payload


class ImportTestBase(unittest.TestCase):
    def setUp(self):
        self.client = connexionapp.test_client()
        os.environ["QRESP_ENABLE_DEV_LOGIN"] = "1"

    def tearDown(self):
        os.environ.pop("QRESP_ENABLE_DEV_LOGIN", None)

    def login(self):
        response = self.client.post(
            "/api/auth/dev-login", json={"email": "curator@example.com"})
        assert response.status_code == 200, response.text
        self.csrf = self.client.get("/api/auth/me").json()["csrf_token"]

    def post(self, path, payload, csrf=True):
        headers = {}
        if csrf and getattr(self, "csrf", None):
            headers["X-CSRF-Token"] = self.csrf
        return self.client.post(path, json=payload, headers=headers)

    def import_source(self, filename, data, crossref=None, csrf=True):
        with mock.patch("project.manuscript.requests") as requests_mock:
            if crossref is not None:
                requests_mock.get.return_value = MockResponse(
                    {"message": crossref})
            else:
                requests_mock.get.side_effect = AssertionError(
                    "unexpected network call")
            response = self.post(
                "/api/import/manuscript",
                {"filename": filename, "content_base64": b64(data)},
                csrf=csrf)
        return response, requests_mock


class TestImportAuth(ImportTestBase):
    def test_anonymous_rejected(self):
        response = self.post("/api/import/doi", {"doi": "10.1/x"}, csrf=False)
        self.assertEqual(401, response.status_code)
        response = self.post(
            "/api/import/manuscript",
            {"filename": "a.tex", "content_base64": b64("x")}, csrf=False)
        self.assertEqual(401, response.status_code)

    def test_missing_csrf_rejected(self):
        self.login()
        response = self.post("/api/import/doi", {"doi": "10.1234/x"},
                             csrf=False)
        self.assertEqual(403, response.status_code)
        response = self.post(
            "/api/import/manuscript",
            {"filename": "a.tex", "content_base64": b64("x")}, csrf=False)
        self.assertEqual(403, response.status_code)


class TestDoiLookup(ImportTestBase):
    def lookup(self, doi, response=None, side_effect=None):
        self.login()
        with mock.patch("project.manuscript.requests") as requests_mock:
            if side_effect is not None:
                requests_mock.get.side_effect = side_effect
            else:
                requests_mock.get.return_value = response
            result = self.post("/api/import/doi", {"doi": doi})
        return result

    def test_valid_doi_returns_full_proposal(self):
        response = self.lookup("10.1234/qresp.demo",
                               MockResponse({"message": CROSSREF_MESSAGE}))
        self.assertEqual(200, response.status_code, response.text)
        body = response.json()
        proposal = body["proposal"]
        self.assertEqual("Registry Title", proposal["title"])
        self.assertEqual(
            [{"firstName": "Ada", "middleName": "B.",
              "lastName": "Lovelace"},
             {"firstName": "Charles", "middleName": "", "lastName": "Babbage"}],
            proposal["authors"])
        self.assertEqual("Journal of Computing", proposal["journal"])
        self.assertEqual(2021, proposal["year"])
        self.assertEqual("12", proposal["volume"])
        self.assertEqual("3", proposal["issue"])
        self.assertEqual("100-110", proposal["pages"])
        self.assertEqual("Registry abstract.", proposal["abstract"])
        self.assertEqual("10.1234/qresp.demo", proposal["doi"])
        self.assertEqual(["Materials Science", "Computing"],
                         proposal["tags"])
        # Crossref work type maps to the curator's kind radio values.
        self.assertEqual("journal", proposal["kind"])
        self.assertEqual("crossref", body["provenance"]["title"])

    def test_doi_is_normalized_from_url_and_prefix_forms(self):
        for raw in ("https://doi.org/10.1234/QRESP.Demo",
                    "doi: 10.1234/qresp.demo", "  10.1234/qresp.demo  "):
            response = self.lookup(
                raw, MockResponse({"message": {"title": ["T"]}}))
            self.assertEqual(200, response.status_code, raw)
            self.assertEqual("10.1234/qresp.demo", response.json()["doi"])

    def test_invalid_doi_rejected_without_network(self):
        self.login()
        with mock.patch("project.manuscript.requests") as requests_mock:
            response = self.post("/api/import/doi",
                                 {"doi": "not-a-doi"})
        self.assertEqual(400, response.status_code)
        requests_mock.get.assert_not_called()

    def test_unknown_doi_reports_404(self):
        response = self.lookup("10.1234/missing",
                               MockResponse({}, status_code=404))
        self.assertEqual(404, response.status_code)
        self.assertIn("not found", response.json()["error"])

    def test_provider_timeout_reports_502_without_leaking(self):
        response = self.lookup("10.1234/slow",
                               side_effect=RuntimeError("boom internals"))
        self.assertEqual(502, response.status_code)
        self.assertNotIn("boom", response.text)

    def test_provider_error_body_is_not_leaked(self):
        response = self.lookup(
            "10.1234/error",
            MockResponse({"secret": "internal provider gibberish"},
                         status_code=500))
        self.assertEqual(502, response.status_code)
        self.assertNotIn("gibberish", response.text)

    def test_missing_optional_metadata_is_fine(self):
        response = self.lookup(
            "10.1234/minimal",
            MockResponse({"message": {"title": ["Only A Title"]}}))
        self.assertEqual(200, response.status_code)
        proposal = response.json()["proposal"]
        self.assertEqual("Only A Title", proposal["title"])
        self.assertNotIn("abstract", proposal)
        self.assertNotIn("authors", proposal)


class TestTexImport(ImportTestBase):
    def test_full_tex_extraction_and_crossref_merge(self):
        self.login()
        response, requests_mock = self.import_source(
            "paper.tex", FULL_TEX, crossref=CROSSREF_MESSAGE)
        self.assertEqual(200, response.status_code, response.text)
        body = response.json()
        proposal = body["proposal"]
        # Manuscript wins for title/authors/abstract; markup cleaned; the
        # commented-out decoy title is ignored.
        self.assertEqual("The Manuscript Title", proposal["title"])
        self.assertEqual("manuscript", body["provenance"]["title"])
        self.assertEqual(
            [{"firstName": "Ada", "middleName": "B.",
              "lastName": "Lovelace"},
             {"firstName": "Charles", "middleName": "",
              "lastName": "Babbage"}],
            proposal["authors"])
        self.assertEqual("We study interesting things carefully.",
                         proposal["abstract"])
        # Registry fills the bibliographic gaps.
        self.assertEqual("Journal of Computing", proposal["journal"])
        self.assertEqual(2021, proposal["year"])
        self.assertEqual("crossref", body["provenance"]["journal"])
        self.assertEqual("10.1234/qresp.demo", proposal["doi"])
        # Conflicting registry title surfaces as an alternative only.
        self.assertEqual(
            [{"source": "crossref", "value": "Registry Title"}],
            body["alternatives"]["title"])
        # Keywords + registry subjects merged, deduplicated.
        self.assertEqual(
            ["simulation", "DFT", "materials", "Materials Science",
             "Computing"], proposal["tags"])
        requests_mock.get.assert_called_once()

    def test_tex_without_doi_skips_network_and_warns(self):
        self.login()
        response, requests_mock = self.import_source(
            "draft.tex", TEX_NO_DOI, crossref=None)
        self.assertEqual(200, response.status_code, response.text)
        body = response.json()
        self.assertEqual("Unpublished Manuscript", body["proposal"]["title"])
        self.assertNotIn("journal", body["proposal"])
        # The backend never invents kind/year/venue for unpublished sources;
        # the frontend may SUGGEST kind=preprint, but that stays client-side.
        self.assertNotIn("kind", body["proposal"])
        self.assertNotIn("year", body["proposal"])
        self.assertTrue(any("No DOI" in w for w in body["warnings"]))
        requests_mock.get.assert_not_called()

    def test_unrecognizable_tex_returns_warning_not_error(self):
        self.login()
        response, _ = self.import_source(
            "notes.tex", "just some plain notes, nothing structured")
        self.assertEqual(200, response.status_code)
        body = response.json()
        self.assertEqual({}, body["proposal"])
        self.assertTrue(
            any("Nothing recognizable" in w for w in body["warnings"]))

    def test_manuscript_content_never_reaches_the_log(self):
        # A BOUNDED excerpt is returned to the browser on purpose, so the tab
        # can hold it in memory and offer it to Publication Assist after
        # consent. Nothing is logged, and nothing is persisted on either side.
        self.login()
        sentinel = "SUPER_SECRET_MANUSCRIPT_BODY_42"
        tex = TEX_NO_DOI.replace("Draft abstract.",
                                 "Public abstract.") + "\n" + sentinel
        stdout = io.StringIO()
        with contextlib.redirect_stdout(stdout):
            response, _ = self.import_source("draft.tex", tex)
        self.assertEqual(200, response.status_code)
        self.assertNotIn(sentinel, stdout.getvalue())
        excerpt = response.json()["source_excerpt"]
        self.assertLessEqual(len(excerpt),
                             manuscript.MAX_SOURCE_EXCERPT_CHARS)


class TestZipImport(ImportTestBase):
    def test_overleaf_zip_with_includes_and_bib(self):
        self.login()
        data = make_zip({
            "main.tex": ("\\documentclass{article}\n"
                         "\\title{Zipped Title}\n"
                         "\\begin{document}\n"
                         "\\input{sections/intro}\n"
                         "\\end{document}\n"),
            "sections/intro.tex": ("\\begin{abstract}Included abstract."
                                   "\\end{abstract}\n"),
            "refs.bib": ("@article{x,\n  doi = {10.5555/ref.one},\n}\n"
                         "@misc{y, doi = \"10.5555/ref.two\" }\n"),
            "figures/plot.png": b"\x89PNG not text",
        })
        response, requests_mock = self.import_source("project.zip", data)
        self.assertEqual(200, response.status_code, response.text)
        body = response.json()
        self.assertEqual("Zipped Title", body["proposal"]["title"])
        self.assertEqual("Included abstract.", body["proposal"]["abstract"])
        self.assertEqual("main.tex", body["main_file"])
        self.assertEqual(["sections/intro.tex"], body["included_files"])
        # Bib DOIs are reference candidates, never the manuscript's own DOI.
        self.assertEqual(["10.5555/ref.one", "10.5555/ref.two"],
                         body["doi_candidates"])
        requests_mock.get.assert_not_called()

    def test_two_mains_is_deterministic_and_reports_candidates(self):
        self.login()
        data = make_zip({
            "a_short.tex": ("\\documentclass{article}\\begin{document}"
                            "\\title{A}\\end{document}"),
            "b_longer_main.tex": ("\\documentclass{article}"
                                  "\\begin{document}\\title{B is the one}"
                                  "some more body text here"
                                  "\\end{document}"),
        })
        response, _ = self.import_source("project.zip", data)
        self.assertEqual(200, response.status_code)
        body = response.json()
        self.assertEqual("b_longer_main.tex", body["main_file"])
        self.assertEqual(2, len(body["main_candidates"]))

    def test_zip_without_usable_tex_rejected(self):
        self.login()
        data = make_zip({"readme.md": "hello", "notes.tex": "no preamble"})
        response, _ = self.import_source("project.zip", data)
        self.assertEqual(400, response.status_code)
        self.assertIn("No usable TeX", response.json()["error"])

    def test_path_traversal_rejected(self):
        self.login()
        data = make_zip({"../evil.tex": "\\documentclass{article}"})
        response, _ = self.import_source("project.zip", data)
        self.assertEqual(400, response.status_code)
        self.assertIn("unsafe relative paths", response.json()["error"])

    def test_absolute_path_rejected(self):
        self.login()
        data = make_zip({"/abs/evil.tex": "\\documentclass{article}"})
        response, _ = self.import_source("project.zip", data)
        self.assertEqual(400, response.status_code)
        self.assertIn("absolute paths", response.json()["error"])

    def test_symlink_rejected(self):
        self.login()
        info = zipfile.ZipInfo("link.tex")
        info.external_attr = (0o120777 << 16)  # symlink mode bits
        data = make_zip({"main.tex": "\\documentclass{article}"},
                        infos=[(info, "/etc/passwd")])
        response, _ = self.import_source("project.zip", data)
        self.assertEqual(400, response.status_code)
        self.assertIn("symbolic links", response.json()["error"])

    def test_too_many_entries_rejected(self):
        self.login()
        members = {"f%03d.txt" % i: "x" for i in range(201)}
        response, _ = self.import_source("project.zip", make_zip(members))
        self.assertEqual(400, response.status_code)
        self.assertIn("too many files", response.json()["error"])

    def test_excessive_nesting_rejected(self):
        self.login()
        deep = "/".join("d%d" % i for i in range(12)) + "/main.tex"
        response, _ = self.import_source(
            "project.zip", make_zip({deep: "\\documentclass{article}"}))
        self.assertEqual(400, response.status_code)
        self.assertIn("too deeply", response.json()["error"])

    def test_oversized_uncompressed_contents_rejected(self):
        self.login()
        # 51 MB of zeros compresses to almost nothing — the UNCOMPRESSED
        # size must trip the limit before anything is read.
        data = make_zip({"main.tex": "\\documentclass{article}",
                         "huge.dat": b"\0" * (51 * 1024 * 1024)})
        response, _ = self.import_source("project.zip", data)
        self.assertEqual(400, response.status_code)
        self.assertIn("size limit", response.json()["error"])

    def test_corrupt_zip_rejected_with_static_message(self):
        self.login()
        response, _ = self.import_source("project.zip", b"PK\x03\x04corrupt")
        self.assertEqual(400, response.status_code)
        self.assertIn("not a readable ZIP", response.json()["error"])


class TestUploadValidation(ImportTestBase):
    def test_unsupported_extension_rejected(self):
        self.login()
        response, _ = self.import_source("paper.docx", b"PK\x03\x04word")
        self.assertEqual(400, response.status_code)
        self.assertIn("Unsupported file type", response.json()["error"])

    def test_bad_base64_rejected(self):
        self.login()
        response = self.post(
            "/api/import/manuscript",
            {"filename": "a.tex", "content_base64": "!!!not base64!!!"})
        self.assertEqual(400, response.status_code)

    def test_oversized_payload_rejected_by_encoded_length(self):
        self.login()
        huge = "A" * ((10 * 1024 * 1024 * 4) // 3 + 4096)
        response = self.post(
            "/api/import/manuscript",
            {"filename": "a.tex", "content_base64": huge})
        self.assertEqual(400, response.status_code)
        self.assertIn("too large", response.json()["error"])


if __name__ == "__main__":
    unittest.main()
