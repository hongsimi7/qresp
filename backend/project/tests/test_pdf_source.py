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
from project import manuscript
from project.manuscript import MAX_PDF_PAGES
from project.models import Paper
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

    def test_a_pdf_without_a_doi_still_offers_front_matter_for_review(self):
        self.login()
        response, requests_mock = self.import_pdf(
            text_pdf(["A paper about confined water with no identifier"]))
        self.assertEqual(200, response.status_code, response.text)
        body = response.json()
        # Read from the layout, so it is offered for review and labelled as a
        # PDF reading - never applied on its own.
        self.assertEqual("A paper about confined water with no identifier",
                         body["proposal"]["title"])
        self.assertEqual("pdf", body["provenance"]["title"])
        self.assertTrue(any("first page layout" in w
                            for w in body["warnings"]))
        # No DOI means no registry call at all.
        requests_mock.get.assert_not_called()

    def test_a_pdf_with_no_readable_front_matter_says_so(self):
        self.login()
        response, _ = self.import_pdf(
            text_pdf(["page 1 of 9", "12 34 56", "7 8 9"]))
        self.assertEqual(200, response.status_code, response.text)
        body = response.json()
        self.assertEqual({}, body["proposal"])
        self.assertTrue(any("Nothing recognizable was found in this PDF"
                            in w for w in body["warnings"]))
        self.assertTrue(any("AI keyword suggestions" in w
                            for w in body["warnings"]))

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

    def test_pdf_bytes_never_appear_and_nothing_is_logged(self):
        # The reviewable front matter AND a bounded text excerpt are returned
        # on purpose: the browser holds the excerpt in memory for this tab so
        # Publication Assist can read the missing fields after consent. What
        # must never happen is the raw FILE travelling back, or anything at
        # all reaching the log.
        self.login()
        stdout = io.StringIO()
        with contextlib.redirect_stdout(stdout):
            response, _ = self.import_pdf(text_pdf([
                "Confined water at the interface",
                "Jane Q. Doe, John Smith",
                "SECRET_PDF_BODY_TOKEN appears only in the body text",
                "and is never part of the front matter we propose.",
            ]))
        self.assertEqual(200, response.status_code, response.text)
        for sink in (response.text, stdout.getvalue()):
            self.assertNotIn("%PDF", sink)
            self.assertNotIn("endstream", sink)
        # The log carries no extracted text of any kind.
        self.assertNotIn("SECRET_PDF_BODY_TOKEN", stdout.getvalue())
        self.assertNotIn("Confined water", stdout.getvalue())
        # The excerpt is in the RESPONSE by design, and bounded.
        excerpt = response.json()["source_excerpt"]
        self.assertIn("SECRET_PDF_BODY_TOKEN", excerpt)
        self.assertLessEqual(len(excerpt),
                             manuscript.MAX_SOURCE_EXCERPT_CHARS)


class TestPdfFrontMatter(PdfSourceTestBase):
    """Conservative front-matter reading, and how it meets the registry.

    Everything here is a HEURISTIC on the first page's layout, so each case
    also checks that the result is labelled as a PDF reading rather than
    presented as fact.
    """

    FRONT_MATTER = [
        "Journal of Chemical Physics 158, 014101 (2023)",
        "Downloaded from https://example.org on 1 May 2024",
        "Electronic structure of embedded Pb clusters",
        "Jane Q. Doe, John Smith, and Alice B. Roe",
        "Department of Chemistry, University of Example",
        "ABSTRACT",
        "We compute the electronic structure of embedded lead clusters using "
        "hybrid density functionals and compare the densities of states with "
        "photoemission measurements across the whole series.",
        "1. Introduction",
        "Lead clusters have long been studied in the literature.",
    ]

    def test_title_authors_and_abstract_are_read_from_the_layout(self):
        self.login()
        response, _ = self.import_pdf(text_pdf(self.FRONT_MATTER))
        self.assertEqual(200, response.status_code, response.text)
        body = response.json()
        proposal = body["proposal"]

        self.assertEqual("Electronic structure of embedded Pb clusters",
                         proposal["title"])
        self.assertEqual("Jane Q. Doe, John Smith, Alice B. Roe",
                         proposal["authors"])
        self.assertIn("hybrid density functionals", proposal["abstract"])
        # The abstract stops at the next section heading.
        self.assertNotIn("Introduction", proposal["abstract"])
        self.assertNotIn("long been studied", proposal["abstract"])

        # Provenance says where each value came from...
        for key in ("title", "authors", "abstract"):
            self.assertEqual("pdf", body["provenance"][key], key)
        # ...and the caution is explicit about it being a layout reading.
        self.assertTrue(any("first page layout" in w
                            for w in body["warnings"]))

    def test_publisher_furniture_is_never_mistaken_for_a_title(self):
        self.login()
        proposal = self.import_pdf(
            text_pdf(self.FRONT_MATTER))[0].json()["proposal"]
        for noise in ("Journal of Chemical", "Downloaded from",
                      "Department of Chemistry"):
            self.assertNotIn(noise, proposal.get("title", ""))
            self.assertNotIn(noise, proposal.get("authors", ""))

    def test_a_line_carrying_a_doi_or_url_is_not_a_title(self):
        self.login()
        proposal = self.import_pdf(text_pdf([
            "Cite as J. Chem. Phys. doi:10.1021/acs.jpcc.5c01077 (2023)",
            "See https://doi.org/10.1021/acs.jpcc.5c01077 for the version",
        ]))[0].json()["proposal"]
        self.assertNotIn("title", proposal)
        # The DOI itself is still the one deterministic signal.
        self.assertEqual("10.1021/acs.jpcc.5c01077", proposal["doi"])

    def test_a_doi_only_pdf_proposes_only_the_doi(self):
        self.login()
        response, requests_mock = self.import_pdf(
            text_pdf(["12 34", "doi:10.1021/acs.jpcc.5c01077", "7 8 9"]),
            crossref=None)
        proposal = response.json()["proposal"]
        self.assertEqual("10.1021/acs.jpcc.5c01077", proposal["doi"])
        for key in ("title", "authors", "abstract"):
            self.assertNotIn(key, proposal, key)

    def test_an_abstract_fragment_is_refused_rather_than_proposed(self):
        self.login()
        proposal = self.import_pdf(text_pdf([
            "A perfectly ordinary paper title about confined water",
            "ABSTRACT",
            "Too short.",
        ]))[0].json()["proposal"]
        self.assertNotIn("abstract", proposal)

    def test_the_registry_outranks_the_layout_and_the_conflict_is_shown(self):
        # A PDF's layout is weaker evidence than the publisher's own record,
        # so Crossref wins - but what we read is kept visible as the
        # alternative, with its own provenance.
        self.login()
        response, _ = self.import_pdf(
            text_pdf(self.FRONT_MATTER + ["doi:10.1021/acs.jpcc.5c01077"]),
            crossref={
                "title": ["Electronic structure of embedded lead clusters"],
                "author": [{"given": "Jane", "family": "Doe"}],
                "abstract": "<jats:p>Registry abstract text that is quite "
                            "long enough to be a real abstract.</jats:p>",
                "container-title": ["J. Chem. Phys."],
                "issued": {"date-parts": [[2023]]},
                "type": "journal-article",
                "DOI": "10.1021/acs.jpcc.5c01077",
            })
        self.assertEqual(200, response.status_code, response.text)
        body = response.json()

        self.assertEqual("Electronic structure of embedded lead clusters",
                         body["proposal"]["title"])
        self.assertEqual("crossref", body["provenance"]["title"])
        # The layout reading is offered as the alternative, labelled "pdf".
        self.assertEqual(
            [{"source": "pdf",
              "value": "Electronic structure of embedded Pb clusters"}],
            body["alternatives"]["title"])
        self.assertEqual("pdf", body["alternatives"]["authors"][0]["source"])

    def test_a_tex_source_still_keeps_its_own_markup_on_conflict(self):
        # Regression guard: TeX markup is authoritative, so the OLD
        # preference must not have been flipped for it.
        from project import manuscript
        fields, provenance, alternatives = manuscript._merge_with_crossref(
            {"title": "From TeX", "doi": "10.1/x"},
            {"title": "From registry"}, source="manuscript")
        self.assertEqual("From TeX", fields["title"])
        self.assertEqual("manuscript", provenance["title"])
        self.assertEqual([{"source": "crossref", "value": "From registry"}],
                         alternatives["title"])

    def test_nothing_from_the_pdf_is_persisted_anywhere(self):
        self.login()
        before = Paper.objects.count()
        self.import_pdf(text_pdf(self.FRONT_MATTER))
        self.assertEqual(before, Paper.objects.count())


NEWLINE = chr(10)


class TestWrappedTitle(PdfSourceTestBase):
    """A title wraps over as many lines as the column needs."""

    # The exact staging case: three lines, joined into one sentence.
    WRAPPED = [
        "Design of heterogeneous chalcogenide",
        "nanostructures with pressure-tunable gaps and",
        "without electronic trap states",
        "Jane Q. Doe, John Smith",
        "ABSTRACT",
        "We show that pressure tunes the gap of heterogeneous chalcogenide "
        "nanostructures without introducing electronic trap states.",
        "1. Introduction",
    ]
    COMPLETE = ("Design of heterogeneous chalcogenide nanostructures with "
                "pressure-tunable gaps and without electronic trap states")

    def test_all_continuation_lines_are_joined(self):
        self.login()
        proposal = self.import_pdf(
            text_pdf(self.WRAPPED))[0].json()["proposal"]
        self.assertEqual(self.COMPLETE, proposal["title"])
        # Single spaces, no wrap artefacts, and not cut off mid-clause.
        self.assertNotIn("  ", proposal["title"])
        self.assertFalse(proposal["title"].endswith(" and"))
        # The byline still starts AFTER the whole title.
        self.assertEqual("Jane Q. Doe, John Smith", proposal["authors"])

    def test_a_two_line_title_still_works(self):
        from project.manuscript import extract_from_pdf_text
        fields = extract_from_pdf_text(NEWLINE.join([
            "Pressure-tunable electronic structure of",
            "layered chalcogenide heterostructures",
            "Jane Q. Doe",
        ]))
        self.assertEqual(
            "Pressure-tunable electronic structure of layered chalcogenide "
            "heterostructures", fields["title"])

    def test_a_title_left_hanging_is_refused_not_proposed(self):
        # If the continuation cannot be followed, a convincing half-sentence
        # is worse than nothing.
        from project.manuscript import extract_from_pdf_text
        fields = extract_from_pdf_text(NEWLINE.join([
            "Design of heterogeneous chalcogenide nanostructures with gaps and",
            "Jane Q. Doe, John Smith",
        ]))
        self.assertNotIn("title", fields)

    def test_a_new_sentence_does_not_get_absorbed(self):
        # A capitalised next line is indistinguishable from the byline, so it
        # is never treated as a continuation.
        from project.manuscript import extract_from_pdf_text
        fields = extract_from_pdf_text(NEWLINE.join([
            "Electronic structure of embedded lead clusters",
            "Comparison With Photoemission Measurements",
            "Jane Q. Doe",
        ]))
        self.assertEqual("Electronic structure of embedded lead clusters",
                         fields["title"])


class TestSourceExcerpt(PdfSourceTestBase):
    def test_a_bounded_excerpt_is_returned_for_the_browser_to_hold(self):
        self.login()
        body = self.import_pdf(text_pdf([
            "Electronic structure of embedded lead clusters",
            "Jane Q. Doe",
            "ABSTRACT",
            "We compute the electronic structure of embedded lead clusters "
            "using hybrid density functionals across the whole series.",
        ]))[0].json()
        excerpt = body["source_excerpt"]
        self.assertIn("embedded lead clusters", excerpt)
        self.assertLessEqual(len(excerpt),
                             manuscript.MAX_SOURCE_EXCERPT_CHARS)

    def test_the_excerpt_is_capped(self):
        self.login()
        long_body = ["Electronic structure of embedded lead clusters",
                     "Jane Q. Doe"] + ["filler sentence here." * 40] * 60
        body = self.import_pdf(text_pdf(long_body))[0].json()
        self.assertEqual(manuscript.MAX_SOURCE_EXCERPT_CHARS,
                         len(body["source_excerpt"]))

    def test_the_excerpt_is_never_logged(self):
        self.login()
        stdout = io.StringIO()
        with contextlib.redirect_stdout(stdout):
            self.import_pdf(text_pdf([
                "Electronic structure of embedded lead clusters",
                "Jane Q. Doe",
                "SECRET_BODY_TOKEN in the body",
            ]))
        self.assertNotIn("SECRET_BODY_TOKEN", stdout.getvalue())


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
