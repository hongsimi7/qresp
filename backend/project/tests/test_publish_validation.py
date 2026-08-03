"""The publish-time validation contract, as it actually stands.

A short-lived branch made journal/volume/page conditional on the kind of work
while PDF import and AI assistance were being tried. That scope was dropped,
and so was the relaxation: `schema.json` is back to the contract that predates
it, and `ReferenceInfoForm.js` requires every asterisked field again.

Note the asymmetry these tests record rather than hide: the publish schema has
always required a DOI, while the curator form has always treated DOI as
optional. The two layers disagree for a record with no DOI. That predates this
work; it is pinned here so the next person meets it deliberately instead of
discovering it from a rejected publish.
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

    def test_the_publish_required_set(self):
        # Exactly the six the schema has always listed.
        for field in ("DOI", "authors", "kind", "publishedAbstract", "title",
                      "year"):
            document = paper()
            del document["reference"][field]
            self.rejects(document, "publishing without %s" % field)

    def test_no_kind_conditional_rules_remain(self):
        # The dropped scope added an allOf/if-then requiring a journal name
        # for kind == "journal". It must be gone: publish validation does not
        # branch on kind at all.
        reference = SCHEMA["properties"]["reference"]
        self.assertNotIn("allOf", reference)
        self.assertNotIn("if", reference)
        for kind in ("journal", "preprint", "dissertation"):
            self.accepts(paper(kind=kind,
                               journal={"fullName": "", "abbrevName": ""}),
                         "publish does not branch on kind (%s)" % kind)

    def test_the_form_is_the_gate_for_journal_volume_and_page(self):
        # These are required by ReferenceInfoForm's yup schema for every kind
        # (see PublicationWorkflow.spec.js). The publish schema has never
        # enforced them, so a record assembled outside the form still passes.
        self.accepts(paper(volume="", page="",
                           journal={"fullName": "", "abbrevName": ""}),
                     "publish itself does not require journal/volume/page")

    def test_a_legacy_record_round_trips(self):
        # Nothing here migrates or rewrites stored records.
        self.accepts(paper(DOI="10.1021/x", volume="158", page="014101"),
                     "a fully populated legacy record")


if __name__ == "__main__":
    unittest.main()
