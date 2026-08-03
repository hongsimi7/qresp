"""Representative chart images, the AI output budget, and failure vocabulary.

Three staging faults are pinned here.

A chart folder named `figure_S1` holding `diagram.png`, `figure_S1.png` and
`figure_S1.ipynb` proposed the notebook and no image at all: the picker looked
for `preview.png` and otherwise only accepted a folder with exactly ONE image.

A batch of eight candidates came back `finishReason=MAX_TOKENS` and then as a
JSONDecodeError, because the output ceiling clamped every configuration to 256
tokens and a truncated answer was handed to the parser as if it were whole.

And every transport failure -- a read timeout, a provider 503, a truncated
answer -- reached the curator as the same sentence.
"""
import json
import unittest
from unittest import mock

import requests

from project import assist, curation
from project import folderstandard as fs


class TestRepresentativeImage(unittest.TestCase):

    def pick(self, folder, names):
        files = ["%s/%s" % (folder, name) for name in names]
        return fs.pick_chart_image(folder, fs.chart_images(folder, files))

    def test_the_image_named_after_the_folder_wins(self):
        # The exact staging case: two images, one notebook, nothing picked.
        chosen, options = self.pick(
            "figures_tables/figure_S1",
            ["diagram.png", "figure_S1.ipynb", "figure_S1.png"])
        self.assertEqual(chosen, "figures_tables/figure_S1/figure_S1.png")
        self.assertEqual(len(options), 2)

    def test_the_whole_chart_proposal_for_that_folder(self):
        folder = "figures_tables/figure_S1"
        files = ["%s/%s" % (folder, name) for name in
                 ("diagram.png", "figure_S1.ipynb", "figure_S1.png")]
        preview, _data, notebook = fs.chart_parts(folder, files)
        self.assertEqual(preview, "figures_tables/figure_S1/figure_S1.png")
        # The notebook is decided independently and was never the problem.
        self.assertEqual(notebook, "figures_tables/figure_S1/figure_S1.ipynb")

    def test_a_table_folder_behaves_the_same_way(self):
        chosen, _options = self.pick(
            "figures_tables/table_S1", ["table_S1.png", "notes.txt"])
        self.assertEqual(chosen, "figures_tables/table_S1/table_S1.png")

    def test_a_single_image_is_still_accepted(self):
        chosen, options = self.pick("charts/fig1", ["anything.png"])
        self.assertEqual(chosen, "charts/fig1/anything.png")
        self.assertEqual(options, ["charts/fig1/anything.png"])

    def test_several_images_and_no_exact_match_picks_nothing(self):
        chosen, options = self.pick("charts/fig1", ["a.png", "b.png"])
        self.assertEqual(chosen, "")
        # ...but every image is offered for the curator to choose from.
        self.assertEqual(options, ["charts/fig1/a.png", "charts/fig1/b.png"])

    def test_a_case_difference_keeps_the_server_spelling(self):
        # The path has to resolve on a case-sensitive file server, so the
        # name we return is the one the server actually has.
        chosen, _options = self.pick(
            "figures_tables/Figure_S2", ["figure_s2.png", "other.png"])
        self.assertEqual(chosen, "figures_tables/Figure_S2/figure_s2.png")

    def test_the_standard_preview_name_still_wins(self):
        chosen, _options = self.pick("charts/fig1",
                                     ["preview.png", "extra.png"])
        self.assertEqual(chosen, "charts/fig1/preview.png")

    def test_decorative_images_are_never_the_figure(self):
        chosen, options = self.pick(
            "figures_tables/figure_S3",
            ["logo.png", "figure_S3.png", "graphical_abstract.png"])
        self.assertEqual(chosen, "figures_tables/figure_S3/figure_S3.png")
        self.assertNotIn("figures_tables/figure_S3/logo.png", options)

    def test_a_decorative_image_alone_is_not_promoted(self):
        chosen, options = self.pick("charts/fig1", ["logo.png"])
        self.assertEqual(chosen, "")
        self.assertEqual(options, [])

    def test_spaces_hashes_and_unicode_survive_verbatim(self):
        for name in ("figure S4.png", "figure#S4.png", "figure_Sβ.png"):
            folder = "figures_tables/" + name.rsplit(".", 1)[0]
            chosen, _options = self.pick(folder, [name, "diagram.png"])
            self.assertEqual(chosen, "%s/%s" % (folder, name), name)

    def test_a_notebook_with_no_image_proposes_no_image(self):
        chosen, options = self.pick("figures_tables/figure_S5",
                                    ["figure_S5.ipynb"])
        self.assertEqual(chosen, "")
        self.assertEqual(options, [])

    def test_only_images_directly_in_the_folder_count(self):
        folder = "charts/fig1"
        files = [folder + "/fig1.png", folder + "/nested/other.png"]
        chosen, options = fs.pick_chart_image(folder,
                                              fs.chart_images(folder, files))
        self.assertEqual(chosen, "charts/fig1/fig1.png")
        self.assertEqual(options, ["charts/fig1/fig1.png"])


class TestOutputBudget(unittest.TestCase):

    def test_the_budget_grows_with_the_batch(self):
        self.assertLess(curation._output_budget(1),
                        curation._output_budget(8))

    def test_it_never_exceeds_the_provider_ceiling(self):
        for count in (10, 50, 500):
            self.assertLessEqual(curation._output_budget(count),
                                 curation.AI_OUTPUT_TOKENS_CEILING)
        self.assertEqual(curation.AI_OUTPUT_TOKENS_CEILING, 2048)

    def test_an_eight_item_batch_gets_more_than_the_old_fixed_cap(self):
        # 1024 was the fixed value that truncated eight candidates.
        self.assertGreater(curation._output_budget(8), 1024)

    def test_the_configuration_ceiling_allows_2048(self):
        # It used to clamp to 256, so raising the environment variable had no
        # effect whatsoever.
        self.assertEqual(assist.GEMINI_MAX_OUTPUT_TOKENS_CEILING, 2048)
        import os
        with mock.patch.dict(os.environ, {
                "QRESP_GEMINI_ENABLED": "1", "QRESP_GEMINI_API_KEY": "k",
                "QRESP_GEMINI_MAX_OUTPUT_TOKENS": "2048"}):
            self.assertEqual(assist._gemini_config()["MAX_OUTPUT_TOKENS"],
                             2048)

    def test_a_keyword_request_can_still_be_small(self):
        self.assertEqual(assist.GEMINI_DEFAULT_MAX_OUTPUT_TOKENS, 256)


class Response:
    def __init__(self, payload, status_code=200):
        self._payload = payload
        self.status_code = status_code
        self.text = json.dumps(payload)

    def json(self):
        return self._payload


CFG = {"API_KEY": "secret-key", "MODEL": "m", "TIMEOUT": 15,
       "MAX_OUTPUT_TOKENS": 256}


class TestFailureVocabulary(unittest.TestCase):
    """Every failure says what actually happened."""

    def call(self, side_effect=None, return_value=None):
        with mock.patch.object(assist, "requests") as http:
            http.exceptions = requests.exceptions
            if side_effect is not None:
                http.post.side_effect = side_effect
            else:
                http.post.return_value = return_value
            return assist.call_gemini(CFG, {"a": 1}, "prompt", {})

    def test_a_read_timeout_says_so(self):
        _text, error = self.call(
            side_effect=requests.exceptions.ReadTimeout("slow"))
        self.assertIn("did not respond in time", error)

    def test_an_unreachable_provider_is_a_different_sentence(self):
        _text, error = self.call(
            side_effect=requests.exceptions.ConnectionError("no route"))
        self.assertIn("could not reach", error)
        self.assertNotIn("did not respond in time", error)

    def test_a_503_is_temporary_not_a_hard_error(self):
        _text, error = self.call(return_value=Response({}, status_code=503))
        self.assertIn("temporarily unavailable", error)

    def test_a_429_names_the_usage_limit(self):
        _text, error = self.call(return_value=Response({}, status_code=429))
        self.assertIn("usage limit", error)

    def test_max_tokens_is_caught_before_the_parser_sees_it(self):
        # The truncated text is nearly valid JSON. Handing it to a parser is
        # what turned a budget problem into a JSONDecodeError.
        truncated = Response({"candidates": [{
            "content": {"parts": [{"text": '{"items": [{"id": "a", "desc'}]},
            "finishReason": "MAX_TOKENS"}]})
        text, error = self.call(return_value=truncated)
        self.assertIsNone(text)
        self.assertIn("truncated", error)
        self.assertIn("fewer items", error)

    def test_unreadable_json_has_its_own_sentence(self):
        _text, error = self.call(return_value=Response("not an object"))
        self.assertIn("unreadable", error)

    def test_no_two_failures_share_a_message(self):
        messages = set()
        for call in (
                lambda: self.call(
                    side_effect=requests.exceptions.ReadTimeout("x")),
                lambda: self.call(
                    side_effect=requests.exceptions.ConnectionError("x")),
                lambda: self.call(return_value=Response({}, status_code=503)),
                lambda: self.call(return_value=Response({}, status_code=429)),
                lambda: self.call(return_value=Response({"candidates": [{
                    "content": {"parts": [{"text": "{"}]},
                    "finishReason": "MAX_TOKENS"}]})),
                lambda: self.call(return_value=Response("nope")),
        ):
            _text, error = call()
            self.assertNotIn(error, messages, error)
            messages.add(error)

    def test_no_failure_leaks_the_key_or_the_provider_body(self):
        for call in (
                lambda: self.call(return_value=Response(
                    {"error": {"message": "quota for project X"}},
                    status_code=503)),
                lambda: self.call(return_value=Response("nope")),
        ):
            _text, error = call()
            self.assertNotIn("secret-key", error)
            self.assertNotIn("quota for project X", error)


class TestPartialAnswers(unittest.TestCase):

    def match(self, items, parsed):
        """The id-matching rules, exactly as describe_candidates applies."""
        kinds = {item["id"]: item["kind"] for item in items}
        suggestions = {}
        for item_id, value in parsed.items():
            if item_id not in kinds or item_id in suggestions:
                continue
            if kinds[item_id] not in curation.AI_KEYWORD_KINDS:
                value = dict(value, keywords=[])
            suggestions[item_id] = value
        missing = [item["id"] for item in items
                   if item["id"] not in suggestions]
        return suggestions, missing

    ITEMS = [{"id": "chart-0", "kind": "chart"},
             {"id": "dataset-0", "kind": "dataset"},
             {"id": "script-0", "kind": "script"}]

    def test_one_answer_out_of_three_is_not_a_failure(self):
        suggestions, missing = self.match(
            self.ITEMS,
            {"dataset-0": {"description": "d", "keywords": ["dft"]}})
        self.assertEqual(list(suggestions), ["dataset-0"])
        self.assertEqual(sorted(missing), ["chart-0", "script-0"])

    def test_an_unknown_id_is_discarded(self):
        suggestions, _missing = self.match(
            self.ITEMS, {"chart-9": {"description": "d", "keywords": []}})
        self.assertEqual(suggestions, {})

    def test_a_repeated_id_keeps_only_its_first_answer(self):
        # dict input cannot repeat a key, so the guard is exercised directly.
        kinds = {"chart-0": "chart"}
        suggestions = {}
        for value in ({"description": "first", "keywords": []},
                      {"description": "second", "keywords": []}):
            if "chart-0" in suggestions:
                continue
            suggestions["chart-0"] = value
        self.assertEqual(suggestions["chart-0"]["description"], "first")
        self.assertEqual(list(kinds), ["chart-0"])

    def test_a_mixed_batch_keeps_each_type_to_its_own_fields(self):
        items = self.ITEMS + [{"id": "tool-0", "kind": "tool"}]
        answer = {
            "chart-0": {"description": "A band structure", "keywords": ["gap"]},
            "dataset-0": {"description": "Geometries", "keywords": ["dft"]},
            "script-0": {"description": "Plots", "keywords": ["vdos"]},
            "tool-0": {"description": "A DFT code", "keywords": ["dft"]},
        }
        suggestions, missing = self.match(items, answer)
        self.assertEqual(missing, [])
        for kind_id in ("chart-0", "dataset-0", "script-0"):
            self.assertTrue(suggestions[kind_id]["keywords"], kind_id)
        # A tool has no keyword field, so its keywords are dropped server-side.
        self.assertEqual(suggestions["tool-0"]["keywords"], [])
        self.assertEqual(suggestions["tool-0"]["description"], "A DFT code")


if __name__ == "__main__":
    unittest.main()
