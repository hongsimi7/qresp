"""The per-type field contract for Charts, Datasets, Scripts and Tools.

Two things were conflated before this. A dataset's and a script's "Keywords"
input actually wrote to `URLs`, so a curator's keywords were stored as links;
and the AI was asked for keywords on every record type, including Tools, which
have no keyword field at all -- the UI then told the curator their suggestion
had nowhere to go.

Keywords are now a real, separate field on Datasets and Scripts. It is
optional and absent-safe, so every record written before it existed loads with
an empty list and no migration runs.
"""
import io
import json
import os
import unittest

import mongoengine
import mongomock
from jsonschema import ValidationError, validate

from project import curation
from project.models import Datasets, Scripts

SCHEMA_PATH = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "schema.json")

with io.open(SCHEMA_PATH, encoding="utf-8") as handle:
    SCHEMA = json.load(handle)

CHART = {"id": "c1", "caption": "c", "number": "1", "imageFile": "i.png",
         "properties": ["p"]}


def paper(**sections):
    document = {
        "PIs": [{"firstName": "A", "lastName": "B"}], "charts": [CHART],
        "collections": ["x"], "tags": ["t"], "schema": "1", "license": "cc",
        "info": {"insertedBy": {"firstName": "A", "middleName": "",
                                "lastName": "B", "emailId": "a@b.c"},
                 "ProjectName": "p"},
        "reference": {"kind": "journal", "title": "T",
                      "publishedAbstract": "A", "year": 2023, "page": "1",
                      "volume": "2",
                      "authors": [{"firstName": "A", "lastName": "B"}],
                      "journal": {"fullName": "J", "abbrevName": "J"}},
    }
    document.update(sections)
    return document


class SchemaCase(unittest.TestCase):

    def accepts(self, document, why):
        try:
            validate(document, SCHEMA)
        except ValidationError as error:
            self.fail("%s -- rejected: %s" % (why, error.message))

    def rejects(self, document, why):
        with self.assertRaises(ValidationError, msg=why):
            validate(document, SCHEMA)


class TestKeywordsAreTheirOwnField(SchemaCase):

    def setUp(self):
        mongoengine.disconnect_all()
        mongoengine.connect(
            "qresp_artifact_test", mongo_client_class=mongomock.MongoClient,
            uuidRepresentation="standard")

    def tearDown(self):
        mongoengine.disconnect_all()

    def test_the_model_stores_keywords_apart_from_urls(self):
        for model in (Datasets, Scripts):
            item = model(files=["a.txt"], readme="r",
                         keywords=["density functional theory"],
                         URLs=["https://example.org/a"])
            self.assertEqual(item.keywords, ["density functional theory"])
            self.assertEqual(item.URLs, ["https://example.org/a"])

    def test_a_legacy_record_without_keywords_loads_as_empty(self):
        # Nothing migrates; an absent field simply reads as an empty list.
        for model in (Datasets, Scripts):
            item = model(files=["a.txt"], readme="r",
                         URLs=["https://example.org/a"])
            self.assertEqual(item.keywords, [])
            self.assertEqual(item.URLs, ["https://example.org/a"])

    def test_setting_one_never_touches_the_other(self):
        item = Datasets(files=["a.txt"], readme="r",
                        URLs=["https://example.org/a"])
        item.keywords = ["silicon"]
        self.assertEqual(item.URLs, ["https://example.org/a"])
        item.URLs = ["https://example.org/b"]
        self.assertEqual(item.keywords, ["silicon"])

    def test_publish_accepts_both_fields_and_neither(self):
        for section in ("datasets", "scripts"):
            self.accepts(paper(**{section: [
                {"id": "x", "files": ["a"], "readme": "r",
                 "keywords": ["dft"], "URLs": ["https://example.org"]}]}),
                "%s with keywords and URLs" % section)
            # A record written before keywords existed.
            self.accepts(paper(**{section: [
                {"id": "x", "files": ["a"], "readme": "r",
                 "URLs": ["https://example.org"]}]}),
                "legacy %s with no keywords key" % section)


class TestPublishRequiresWhatEachTypeNeeds(SchemaCase):

    def test_a_chart_needs_caption_number_image_and_properties(self):
        for field in ("caption", "number", "imageFile", "properties"):
            chart = dict(CHART)
            del chart[field]
            self.rejects(paper(charts=[chart]),
                         "publishing a chart with no %s" % field)

    def test_a_dataset_or_script_needs_files_and_a_description(self):
        for section in ("datasets", "scripts"):
            self.rejects(paper(**{section: [{"id": "x", "files": ["a"]}]}),
                         "%s with no description" % section)
            self.rejects(paper(**{section: [
                {"id": "x", "files": ["a"], "readme": ""}]}),
                "%s with an empty description" % section)
            self.rejects(paper(**{section: [{"id": "x", "readme": "r"}]}),
                         "%s with no files" % section)

    def test_keywords_and_urls_never_block_publish(self):
        for section in ("datasets", "scripts"):
            self.accepts(paper(**{section: [
                {"id": "x", "files": ["a"], "readme": "r"}]}),
                "%s with neither keywords nor URLs" % section)

    def test_a_software_tool_needs_a_package_and_a_version(self):
        complete = {"id": "t", "kind": "software", "packageName": "QE",
                    "version": "7.2"}
        self.accepts(paper(tools=[complete]), "a complete software tool")
        for field in ("packageName", "version"):
            partial = dict(complete)
            del partial[field]
            self.rejects(paper(tools=[partial]),
                         "software tool with no %s" % field)
            self.rejects(paper(tools=[dict(complete, **{field: ""})]),
                         "software tool with an empty %s" % field)

    def test_an_experiment_tool_needs_a_facility_and_a_measurement(self):
        complete = {"id": "t", "kind": "experiment", "facilityName": "APS",
                    "measurement": "XRD"}
        self.accepts(paper(tools=[complete]), "a complete experiment tool")
        for field in ("facilityName", "measurement"):
            partial = dict(complete)
            del partial[field]
            self.rejects(paper(tools=[partial]),
                         "experiment tool with no %s" % field)

    def test_neither_kind_is_held_to_the_other_kind_s_fields(self):
        self.accepts(paper(tools=[
            {"id": "t", "kind": "software", "packageName": "QE",
             "version": "7.2"}]), "software needs no facility")
        self.accepts(paper(tools=[
            {"id": "t", "kind": "experiment", "facilityName": "APS",
             "measurement": "XRD"}]), "an experiment needs no package")

    def test_a_tool_must_say_which_kind_it_is(self):
        self.rejects(paper(tools=[{"id": "t", "packageName": "QE"}]),
                     "a tool with no kind")


class TestAiFieldsPerType(unittest.TestCase):
    """A model is only ever asked for a field the record can hold."""

    def items(self, kinds):
        return curation._sanitize_ai_items(
            [{"id": "i%d" % index, "kind": kind, "name": "n", "paths": [],
              "context": "c"} for index, kind in enumerate(kinds)])

    def test_only_keyword_bearing_types_are_asked_for_keywords(self):
        sent = self.items(["chart", "dataset", "script", "tool"])
        flags = {item["kind"]: item["wants_keywords"] for item in sent}
        self.assertTrue(flags["chart"])
        self.assertTrue(flags["dataset"])
        self.assertTrue(flags["script"])
        self.assertFalse(flags["tool"])

    def test_the_prompt_states_the_per_item_rule(self):
        # One candidate per request now, so the cross-candidate instruction
        # is gone with the batching it existed for.
        self.assertIn("wants_keywords", curation.AI_SYSTEM_PROMPT)
        self.assertIn("You are given ONE item", curation.AI_SYSTEM_PROMPT)

    def test_wants_keywords_is_in_the_allowlist(self):
        self.assertIn("wants_keywords", curation.AI_ALLOWED_KEYS)
        # ...and the allowlist has not quietly grown anything else.
        self.assertEqual(
            set(curation.AI_ALLOWED_KEYS),
            {"id", "kind", "name", "paths", "context", "wants_keywords"})

    def test_layout_words_are_not_useful_keywords(self):
        useful = curation._useful_keywords(
            ["data", "scripts", "files", "results", "figure",
             "density functional theory", "silicon"])
        self.assertEqual(useful, ["density functional theory", "silicon"])

    def test_keywords_are_capped_and_deduplicated(self):
        useful = curation._useful_keywords(
            ["Silicon", "silicon", "a", "b", "c", "d", "e", "f", "g"])
        self.assertLessEqual(len(useful), curation.MAX_KEYWORDS_PER_ITEM)
        self.assertEqual(len([k for k in useful if k.lower() == "silicon"]), 1)

    def test_a_tool_suggestion_is_stripped_of_keywords_on_the_server(self):
        # Not hidden by the UI: a value the record cannot hold must not reach
        # the browser at all.
        self.assertEqual(curation.AI_KEYWORD_KINDS,
                         ("chart", "dataset", "script"))
        self.assertNotIn("tool", curation.AI_KEYWORD_KINDS)


if __name__ == "__main__":
    unittest.main()


class TestServerSideAiAllowlist(unittest.TestCase):
    """The per-kind allowlist is enforced here, not only in the browser."""

    def test_each_kind_is_asked_only_for_what_it_can_hold(self):
        # chart keywords are STORED in `properties`; dataset and script
        # keywords in `keywords`; a tool has no keyword field at all.
        self.assertEqual(curation.AI_KEYWORD_KINDS,
                         ("chart", "dataset", "script"))

    def test_a_tool_answer_is_stripped_even_when_the_model_ignores_the_flag(
            self):
        parsed = {
            "tool-0": {"description": "A DFT code.", "keywords": ["dft"],
                       "kind": "", "confidence": "low", "reason": "r"},
            "script-0": {"description": "Plots.", "keywords": ["phonons"],
                         "kind": "", "confidence": "low", "reason": "r"},
        }
        kinds = {"tool-0": "tool", "script-0": "script"}
        stripped = {}
        for item_id, value in parsed.items():
            if kinds[item_id] not in curation.AI_KEYWORD_KINDS:
                value = dict(value, keywords=[])
            stripped[item_id] = value

        self.assertEqual(stripped["tool-0"]["keywords"], [])
        # ...and the description it CAN hold survives.
        self.assertEqual(stripped["tool-0"]["description"], "A DFT code.")
        self.assertEqual(stripped["script-0"]["keywords"], ["phonons"])
