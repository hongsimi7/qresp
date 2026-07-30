"""Publish validation must agree with what the curator form asks for.

The form and the publish schema are two gates on the same record. When they
disagree the curator sees a complete, valid form and then a rejection from the
server -- or worse, the reverse. These tests pin the contract from the server
side; ReferenceInfoForm.spec.js pins the same rules in the form.
"""
import io
import json
import os
import unittest

from jsonschema import ValidationError, validate

SCHEMA_PATH = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "schema.json")

with io.open(SCHEMA_PATH, encoding="utf-8") as handle:
    SCHEMA = json.load(handle)

CHART = {"id": "c1", "caption": "c", "number": "1", "files": ["f"],
         "imageFile": "i.png", "properties": ["p"], "saveas": "",
         "kind": "figure", "notebookFile": "", "extraFileNames": []}


def paper(**reference):
    fields = {"kind": "journal", "title": "T", "publishedAbstract": "A",
              "year": 2023, "page": "", "volume": "",
              "authors": [{"firstName": "A", "lastName": "B"}],
              "journal": {"fullName": "J. Chem. Phys.",
                          "abbrevName": "JCP"}}
    fields.update(reference)
    return {
        "PIs": [{"firstName": "A", "lastName": "B"}], "charts": [CHART],
        "collections": ["x"], "tags": ["t"], "schema": "1", "license": "cc",
        "info": {"insertedBy": {"firstName": "A", "middleName": "",
                                "lastName": "B", "emailId": "a@b.c"},
                 "timeStamp": "", "serverPath": "", "folderAbsolutePath": "",
                 "notebookFile": "", "notebookPath": "", "ProjectName": "",
                 "fileServerPath": "", "downloadPath": "", "isPublic": True,
                 "doi": "", "cloudID": ""},
        "reference": fields,
    }


class TestPublishValidation(unittest.TestCase):

    def accepts(self, document, why):
        try:
            validate(document, SCHEMA)
        except ValidationError as error:
            self.fail("%s -- rejected: %s" % (why, error.message))

    def rejects(self, document, why):
        with self.assertRaises(ValidationError, msg=why):
            validate(document, SCHEMA)

    def test_the_five_universal_requirements(self):
        for field in ("kind", "title", "publishedAbstract", "year",
                      "authors"):
            document = paper()
            del document["reference"][field]
            self.rejects(document, "publishing without %s" % field)

    def test_doi_is_optional(self):
        # A preprint or a dissertation may have no DOI at all, and the form
        # has never required one. Publish used to reject exactly these.
        document = paper(kind="preprint")
        self.assertNotIn("DOI", document["reference"])
        self.accepts(document, "a preprint with no DOI")

    def test_url_is_optional(self):
        self.accepts(paper(), "no URLs key")

    def test_journal_name_required_only_for_a_journal_article(self):
        self.rejects(paper(journal={"fullName": "", "abbrevName": ""}),
                     "a journal article with no journal name")
        for kind in ("preprint", "dissertation"):
            self.accepts(paper(kind=kind,
                               journal={"fullName": "", "abbrevName": ""}),
                         "a %s with no journal name" % kind)

    def test_volume_and_page_never_block_publish(self):
        for kind in ("journal", "preprint", "dissertation"):
            self.accepts(paper(kind=kind, volume="", page=""),
                         "a %s with no volume or page" % kind)
            document = paper(kind=kind)
            del document["reference"]["volume"]
            del document["reference"]["page"]
            self.accepts(document, "a %s missing volume/page keys" % kind)

    def test_a_legacy_record_still_validates(self):
        # Records published before this change carry DOI, volume and page.
        # Relaxing the rules must not invalidate anything already stored.
        self.accepts(paper(DOI="10.1021/x", volume="158", page="014101"),
                     "a fully populated legacy record")


if __name__ == "__main__":
    unittest.main()
