"""The publish-time validation contract: one rule set, both layers.

The form and the publish schema are two gates on the same record. They used
to disagree in both directions -- the schema demanded a DOI the form never
asked for, and the form demanded a journal, page and volume the schema never
checked -- so a curator could fill in everything the form marked required and
still be rejected at publish.

Both now enforce exactly this, for every kind of work:

    required   kind, at least one author, title, journal name, page,
               abstract, volume, year
    optional   DOI, URL

The mirror image lives in `ReferenceInfoForm.js` (yup) and is exercised in
`PublicationWorkflow.spec.js`. Required here means non-empty: requiring a key
that is always present with an empty value would check nothing.
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
              "year": 2023, "page": "100-110", "volume": "12",
              "DOI": "10.1234/qresp.demo",
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

    def test_a_complete_record_publishes(self):
        self.accepts(paper(), "a fully populated journal article")

    def test_every_required_field_blocks_publish_when_absent(self):
        for field in ("authors", "journal", "kind", "page",
                      "publishedAbstract", "title", "volume", "year"):
            document = paper()
            del document["reference"][field]
            self.rejects(document, "publishing without %s" % field)

    def test_required_means_non_empty_not_merely_present(self):
        for field, empty in (("title", ""), ("kind", ""),
                             ("publishedAbstract", ""), ("page", ""),
                             ("volume", ""), ("authors", [])):
            self.rejects(paper(**{field: empty}),
                         "publishing with an empty %s" % field)
        # journal is an object, so an empty name has to be caught inside it.
        self.rejects(paper(journal={"fullName": "", "abbrevName": ""}),
                     "publishing with an empty journal name")
        self.rejects(paper(journal={}), "publishing with no journal name key")

    def test_doi_is_optional(self):
        # A preprint or a dissertation may legitimately have none, and the
        # curator form has never required one. This is the case publish used
        # to reject after the form called the record complete.
        document = paper()
        del document["reference"]["DOI"]
        self.accepts(document, "a record with no DOI at all")
        self.accepts(paper(DOI=""), "a record with an empty DOI")

    def test_url_is_optional(self):
        document = paper()
        self.assertNotIn("URLs", document["reference"])
        self.accepts(document, "a record with no URL")

    def test_no_kind_conditional_rules_remain(self):
        # The dropped scope added an allOf/if-then requiring a journal name
        # for kind == "journal". It must be gone: publish validation does not
        # branch on kind at all.
        reference = SCHEMA["properties"]["reference"]
        self.assertNotIn("allOf", reference)
        self.assertNotIn("if", reference)

    def test_the_same_rules_apply_to_every_kind(self):
        # No kind-conditional branching: a preprint is held to the same
        # contract as a journal article, exactly as the form is.
        for kind in ("journal", "preprint", "dissertation"):
            self.accepts(paper(kind=kind), "a complete %s" % kind)
            self.rejects(paper(kind=kind, page=""),
                         "a %s with no page" % kind)

    def test_a_legacy_record_round_trips(self):
        # Nothing here migrates or rewrites stored records.
        self.accepts(paper(DOI="10.1021/x", volume="158", page="014101"),
                     "a fully populated legacy record")


if __name__ == "__main__":
    unittest.main()
