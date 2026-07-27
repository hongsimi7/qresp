import base64
import contextlib
import io
import json
import os
import unittest
import zlib
from unittest import mock

import mongoengine
import mongomock

# PDF manuscript SOURCE support: extraction is text-only and in memory, and
# every provider call is mocked — no external request is ever made. These
# tests pin the safety envelope (encrypted / scanned / oversized / malformed)
# and prove no PDF bytes or extracted text leak into responses or logs.
from project import connexionapp
from project.manuscript import MAX_PDF_PAGES
from project.models import AssistUsage

GEMINI_ENV = {
    "QRESP_GEMINI_ENABLED": "1",
    "QRESP_GEMINI_API_KEY": "test-gemini-super-secret",
    "QRESP_GEMINI_MODEL": "gemini-test",
}


def gemini_reply(keywords):
    return {"candidates": [{"content": {"parts": [
        {"text": json.dumps({"keywords": keywords})}]},
        "finishReason": "STOP"}]}


class MockResponse:
    def __init__(self, payload, status_code=200, text=""):
        self._payload = payload
        self.status_code = status_code
        self.text = text

    def json(self):
        return self._payload


def b64(data):
    if isinstance(data, str):
        data = data.encode("utf-8")
    return base64.b64encode(data).decode("ascii")


# ---- minimal hand-built PDFs (no fixture binaries committed) ---------------

def _pdf(objects, trailer_extra=""):
    """Assemble a tiny but structurally valid PDF from body objects."""
    out = bytearray(b"%PDF-1.4\n")
    offsets = [0]
    for index, body in enumerate(objects, start=1):
        offsets.append(len(out))
        out += ("%d 0 obj\n" % index).encode("latin-1")
        out += body if isinstance(body, bytes) else body.encode("latin-1")
        out += b"\nendobj\n"
    xref_at = len(out)
    out += ("xref\n0 %d\n" % (len(objects) + 1)).encode("latin-1")
    out += b"0000000000 65535 f \n"
    for offset in offsets[1:]:
        out += ("%010d 00000 n \n" % offset).encode("latin-1")
    out += ("trailer\n<< /Size %d /Root 1 0 R %s>>\nstartxref\n%d\n%%%%EOF\n"
            % (len(objects) + 1, trailer_extra, xref_at)).encode("latin-1")
    return bytes(out)


def text_pdf(page_texts):
    """A text-based PDF: one page per entry, each drawing a text string."""
    page_count = len(page_texts)
    kids = " ".join("%d 0 R" % (3 + i * 2) for i in range(page_count))
    objects = [
        "<< /Type /Catalog /Pages 2 0 R >>",
        "<< /Type /Pages /Count %d /Kids [%s] >>" % (page_count, kids),
    ]
    for index, body in enumerate(page_texts):
        stream = ("BT /F1 12 Tf 72 720 Td (%s) Tj ET"
                  % body.replace("(", r"\(").replace(")", r"\)"))
        objects.append(
            "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] "
            "/Contents %d 0 R /Resources << /Font << /F1 << /Type /Font "
            "/Subtype /Type1 /BaseFont /Helvetica >> >> >> >>"
            % (4 + index * 2))
        objects.append(
            ("<< /Length %d >>\nstream\n%s\nendstream"
             % (len(stream), stream)))
    return _pdf(objects)


def imageless_scanned_pdf():
    """A page with no text-drawing operators at all (scan-like)."""
    stream = "q 1 0 0 1 0 0 cm Q"
    objects = [
        "<< /Type /Catalog /Pages 2 0 R >>",
        "<< /Type /Pages /Count 1 /Kids [3 0 R] >>",
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] "
        "/Contents 4 0 R >>",
        "<< /Length %d >>\nstream\n%s\nendstream" % (len(stream), stream),
    ]
    return _pdf(objects)


def encrypted_pdf():
    """Structurally valid and flagged encrypted via a trailer /Encrypt."""
    objects = [
        "<< /Type /Catalog /Pages 2 0 R >>",
        "<< /Type /Pages /Count 1 /Kids [3 0 R] >>",
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>",
        "<< /Filter /Standard /V 1 /R 2 /O <70617373776f7264> "
        "/U <70617373776f7264> /P -1 >>",
    ]
    return _pdf(objects, trailer_extra="/Encrypt 4 0 R ")


class PdfSourceTestBase(unittest.TestCase):
    def setUp(self):
        self.client = connexionapp.test_client()
        os.environ["QRESP_ENABLE_DEV_LOGIN"] = "1"
        for key, value in GEMINI_ENV.items():
            os.environ[key] = value
        mongoengine.disconnect_all()
        mongoengine.connect('mongoenginetest',
                            mongo_client_class=mongomock.MongoClient)

    def tearDown(self):
        os.environ.pop("QRESP_ENABLE_DEV_LOGIN", None)
        for key in GEMINI_ENV:
            os.environ.pop(key, None)
        AssistUsage.drop_collection()
        mongoengine.disconnect_all()

    def login(self, email="curator@example.com"):
        response = self.client.post(
            "/api/auth/dev-login", json={"email": email})
        assert response.status_code == 200, response.text
        self.csrf = self.client.get("/api/auth/me").json()["csrf_token"]

    def import_pdf(self, data, filename="paper.pdf", crossref=None):
        with mock.patch("project.manuscript.requests") as requests_mock:
            if crossref is not None:
                requests_mock.get.return_value = MockResponse(
                    {"message": crossref})
            else:
                requests_mock.get.side_effect = AssertionError(
                    "unexpected network call")
            response = self.client.post(
                "/api/import/manuscript",
                json={"filename": filename, "content_base64": b64(data)},
                headers={"X-CSRF-Token": self.csrf})
        return response, requests_mock

    def assist_pdf(self, data, filename="paper.pdf", reply=None,
                   extra=None):
        payload = {"filename": filename, "content_base64": b64(data)}
        payload.update(extra or {})
        with mock.patch("project.assist.requests") as requests_mock:
            requests_mock.post.return_value = (
                reply if reply is not None
                else MockResponse(gemini_reply(["Ice Nucleation"])))
            response = self.client.post(
                "/api/assist/keywords", json=payload,
                headers={"X-CSRF-Token": self.csrf})
        return response, requests_mock


class TestPdfImport(PdfSourceTestBase):
    def test_text_pdf_with_a_printed_doi_fills_from_the_registry(self):
        self.login()
        data = text_pdf([
            "Ice nucleation in confined water",
            "doi:10.1234/qresp.demo see the registry entry",
        ])
        response, requests_mock = self.import_pdf(data, crossref={
            "type": "journal-article",
            "title": ["Registry Title"],
            "container-title": ["Journal of Computing"],
            "issued": {"date-parts": [[2021]]},
        })
        self.assertEqual(200, response.status_code, response.text)
        body = response.json()
        self.assertEqual("pdf", body["source_kind"])
        # The DOI is the one deterministic signal taken from a PDF; the
        # bibliography then comes from the registry, never from PDF layout.
        self.assertEqual("10.1234/qresp.demo", body["proposal"]["doi"])
        self.assertEqual("Registry Title", body["proposal"]["title"])
        requests_mock.get.assert_called_once()

    def test_text_pdf_without_a_doi_proposes_nothing_and_says_so(self):
        self.login()
        response, requests_mock = self.import_pdf(
            text_pdf(["A paper about confined water with no identifier"]))
        self.assertEqual(200, response.status_code, response.text)
        body = response.json()
        self.assertEqual({}, body["proposal"])
        self.assertTrue(any("does not guess" in w for w in body["warnings"]))
        self.assertTrue(any("AI keyword suggestions" in w
                            for w in body["warnings"]))
        requests_mock.get.assert_not_called()

    def test_scanned_pdf_without_text_is_rejected_mentioning_ocr(self):
        self.login()
        response, _ = self.import_pdf(imageless_scanned_pdf())
        self.assertEqual(400, response.status_code)
        error = response.json()["error"]
        self.assertIn("No text could be extracted", error)
        self.assertIn("OCR", error)

    def test_encrypted_pdf_is_rejected(self):
        self.login()
        response, _ = self.import_pdf(encrypted_pdf())
        self.assertEqual(400, response.status_code)
        self.assertIn("password-protected or encrypted",
                      response.json()["error"])

    def test_malformed_pdf_is_rejected_safely(self):
        self.login()
        response, _ = self.import_pdf(b"%PDF-1.4\nnot really a pdf\n")
        self.assertEqual(400, response.status_code)
        self.assertIn("not a readable PDF", response.json()["error"])

    def test_too_many_pages_is_rejected(self):
        self.login()
        data = text_pdf(["page %d text" % i
                         for i in range(MAX_PDF_PAGES + 1)])
        response, _ = self.import_pdf(data)
        self.assertEqual(400, response.status_code)
        self.assertIn("too many pages", response.json()["error"])

    def test_oversized_pdf_upload_is_rejected_before_parsing(self):
        self.login()
        huge = "A" * ((10 * 1024 * 1024 * 4) // 3 + 4096)
        response = self.client.post(
            "/api/import/manuscript",
            json={"filename": "paper.pdf", "content_base64": huge},
            headers={"X-CSRF-Token": self.csrf})
        self.assertEqual(400, response.status_code)
        self.assertIn("too large", response.json()["error"])

    def test_pdf_bytes_and_text_never_appear_in_response_or_logs(self):
        self.login()
        stdout = io.StringIO()
        with contextlib.redirect_stdout(stdout):
            response, _ = self.import_pdf(
                text_pdf(["SECRET_PDF_BODY_TOKEN confined water study"]))
        self.assertEqual(200, response.status_code, response.text)
        for sink in (response.text, stdout.getvalue()):
            self.assertNotIn("SECRET_PDF_BODY_TOKEN", sink)
            self.assertNotIn("%PDF", sink)


class TestPdfAssist(PdfSourceTestBase):
    def test_pdf_source_reaches_gemini_as_sanitized_text_not_bytes(self):
        self.login()
        response, requests_mock = self.assist_pdf(
            text_pdf(["Confined water shows ice nucleation at the interface"]))
        self.assertEqual(200, response.status_code, response.text)
        self.assertEqual(["Ice Nucleation"], response.json()["keywords"])
        sent = requests_mock.post.call_args.kwargs["json"]
        excerpt = json.loads(
            sent["contents"][0]["parts"][0]["text"])["manuscript_excerpt"]
        # Extracted TEXT travels; raw PDF bytes never do.
        self.assertIn("ice nucleation", excerpt.lower())
        self.assertNotIn("%PDF", json.dumps(sent))
        self.assertNotIn("endstream", json.dumps(sent))

    def test_reference_section_is_stripped_before_sending(self):
        self.login()
        response, requests_mock = self.assist_pdf(text_pdf([
            "Methods We compute free energies for confined water. " * 20,
            "Conclusions The interface controls nucleation. " * 20,
            "References",
            "[1] CITED_WORK_TOKEN, Journal of Something, 2001.",
        ]))
        self.assertEqual(200, response.status_code, response.text)
        sent = json.dumps(requests_mock.post.call_args.kwargs["json"])
        # Body/methods/conclusions survive; the reference list does not.
        self.assertIn("free energies", sent)
        self.assertIn("Conclusions", sent)
        self.assertNotIn("CITED_WORK_TOKEN", sent)

    def test_encrypted_pdf_is_rejected_before_any_provider_call(self):
        self.login()
        response, requests_mock = self.assist_pdf(encrypted_pdf())
        self.assertEqual(400, response.status_code)
        self.assertIn("password-protected or encrypted",
                      response.json()["error"])
        requests_mock.post.assert_not_called()
        # A rejected upload must not burn the daily quota either.
        self.assertEqual(0, AssistUsage.objects.count())

    def test_scanned_pdf_is_rejected_before_any_provider_call(self):
        self.login()
        response, requests_mock = self.assist_pdf(imageless_scanned_pdf())
        self.assertEqual(400, response.status_code)
        self.assertIn("OCR", response.json()["error"])
        requests_mock.post.assert_not_called()

    def test_pdf_text_and_key_never_leak_through_a_provider_failure(self):
        self.login()
        stdout = io.StringIO()
        with contextlib.redirect_stdout(stdout):
            response, _ = self.assist_pdf(
                text_pdf(["SECRET_PDF_BODY_TOKEN nucleation study"]),
                reply=MockResponse({"error": {"message": "bad key"}},
                                   status_code=400, text="bad key"))
        self.assertEqual(502, response.status_code)
        for sink in (response.text, stdout.getvalue()):
            self.assertNotIn("SECRET_PDF_BODY_TOKEN", sink)
            self.assertNotIn("test-gemini-super-secret", sink)
            self.assertNotIn("%PDF", sink)

    def test_metadata_only_request_still_works_without_any_source(self):
        self.login()
        with mock.patch("project.assist.requests") as requests_mock:
            requests_mock.post.return_value = MockResponse(
                gemini_reply(["Water"]))
            response = self.client.post(
                "/api/assist/keywords",
                json={"title": "Confined water", "abstract": "We simulate."},
                headers={"X-CSRF-Token": self.csrf})
        self.assertEqual(200, response.status_code, response.text)
        self.assertEqual(["Water"], response.json()["keywords"])

    def test_nothing_is_persisted_by_a_pdf_assist_request(self):
        self.login()
        self.assist_pdf(text_pdf(["Confined water nucleation"]))
        connection = mongoengine.connection.get_db()
        collections = set(connection.list_collection_names())
        # Only the usage counter is touched: no PDF, no extracted text.
        self.assertIn("assist_usage", collections)
        self.assertNotIn("papers", collections)
        self.assertNotIn("curator_drafts", collections)
        usage = AssistUsage.objects.first()
        stored = json.dumps(usage.to_mongo().to_dict(), default=str)
        self.assertNotIn("Confined water", stored)


if __name__ == "__main__":
    unittest.main()
