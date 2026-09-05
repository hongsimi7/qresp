"""What a model may be shown about a script.

The parser in `codelinks` needs no permission: it reads a file and reports a
line. This is the other thing -- a bundle that LEAVES the server -- so every
test here is about the boundary, not about usefulness.
"""
import json
import unittest

from project import codeexcerpts


CANDIDATES = [
    {"id": "d0", "type": "dataset", "path": "data/raw.csv"},
    {"id": "", "type": "dataset", "path": "derived/clean.csv"},
    {"id": "c0", "type": "chart", "path": "figures/result.png"},
]

SHELL = (
    "#!/bin/bash\n"
    "set -e\n"
    'python preprocess.py "$INPUT" > derived/clean.csv\n'
    "python plot.py derived/clean.csv figures/result.png\n"
)


class WhatGoesIn(unittest.TestCase):

    def test_a_shell_wrapper_yields_the_lines_that_name_files(self):
        manifest, summary = codeexcerpts.build_manifest(
            {"run.sh": SHELL}, set(), CANDIDATES)

        self.assertEqual(manifest["sources"],
                         [{"path": "run.sh", "language": "shell"}])
        texts = "\n".join(entry["text"] for entry in manifest["excerpts"])
        self.assertIn("preprocess.py", texts)
        self.assertIn("figures/result.png", texts)
        # The interpreter line says nothing about this paper's files.
        self.assertNotIn("#!/bin/bash", texts)

    def test_every_excerpt_says_where_it_came_from(self):
        manifest, _ = codeexcerpts.build_manifest(
            {"run.sh": SHELL}, set(), CANDIDATES)
        for entry in manifest["excerpts"]:
            self.assertEqual("run.sh", entry["path"])
            self.assertGreater(entry["line"], 0)
            self.assertIsNone(entry["cell"])
            self.assertTrue(entry["id"])

    def test_a_notebook_gives_cell_numbers_and_never_its_output(self):
        document = {
            "cells": [
                {"cell_type": "markdown", "source": "read data/raw.csv"},
                {"cell_type": "code",
                 "source": "run('data/raw.csv')\n",
                 "outputs": [{"text": "figures/secret_result.png"}]},
            ],
            "nbformat": 4,
        }
        manifest, _ = codeexcerpts.build_manifest(
            {"prep.ipynb": json.dumps(document)}, set(), CANDIDATES)
        texts = "\n".join(entry["text"] for entry in manifest["excerpts"])
        self.assertIn("data/raw.csv", texts)
        # Not the markdown, and above all not the output.
        self.assertNotIn("secret_result", texts)
        self.assertEqual([2], [entry["cell"]
                               for entry in manifest["excerpts"]])

    def test_what_the_parser_already_resolved_is_not_asked_about(self):
        # The point of asking is what is left over.
        manifest, _ = codeexcerpts.build_manifest(
            {"run.sh": SHELL}, {"derived/clean.csv", "figures/result.png"},
            CANDIDATES)
        self.assertNotIn("derived/clean.csv", manifest["unresolved_paths"])
        self.assertNotIn("figures/result.png", manifest["unresolved_paths"])

    def test_only_the_candidates_the_scan_found_are_offered(self):
        manifest, _ = codeexcerpts.build_manifest(
            {"run.sh": SHELL}, set(),
            CANDIDATES + [{"id": "x", "type": "tool", "path": "t.py"},
                          {"id": "y", "type": "dataset", "path": ""}])
        self.assertEqual(
            [item["path"] for item in manifest["candidates"]],
            ["data/raw.csv", "derived/clean.csv", "figures/result.png"])

    def test_a_language_it_cannot_read_contributes_nothing(self):
        manifest, _ = codeexcerpts.build_manifest(
            {"src/main.f90": "open(unit=1, file='data/raw.csv')\n"},
            set(), CANDIDATES)
        self.assertEqual([], manifest["sources"])
        self.assertEqual([], manifest["excerpts"])


class WhatNeverGoes(unittest.TestCase):
    """The allowlist, tested as a denylist would be tested."""

    def test_a_line_mentioning_a_credential_is_dropped_whole(self):
        source = (
            "API_KEY = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'\n"
            "password = 'hunter2'\n"
            "run('data/raw.csv')\n"
        )
        manifest, summary = codeexcerpts.build_manifest(
            {"run.py": source}, set(), CANDIDATES)
        blob = json.dumps(manifest) + json.dumps(summary)
        self.assertNotIn("hunter2", blob)
        self.assertNotIn("API_KEY", blob)
        self.assertNotIn("password", blob)
        # ...and the ordinary line is still there.
        self.assertIn("data/raw.csv", blob)

    def test_every_spelling_of_a_secret_is_refused(self):
        for word in ("secret", "token", "api_key", "private_key",
                     "client_secret", "Authorization", "AWS_ACCESS_KEY"):
            source = "%s = 'x'\nrun('data/raw.csv')\n" % word
            manifest, _ = codeexcerpts.build_manifest(
                {"run.py": source}, set(), CANDIDATES)
            texts = "\n".join(e["text"] for e in manifest["excerpts"])
            self.assertNotIn(word, texts, word)

    def test_a_long_keylike_run_is_redacted_even_on_a_line_that_survives(self):
        source = "run('data/raw.csv', 'ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789')\n"
        manifest, _ = codeexcerpts.build_manifest(
            {"run.py": source}, set(), CANDIDATES)
        texts = "\n".join(e["text"] for e in manifest["excerpts"])
        self.assertIn("[REDACTED]", texts)
        self.assertNotIn("ABCDEFGHIJKLMNOPQRSTUVWXYZ", texts)

    def test_an_env_file_is_not_a_path_worth_asking_about(self):
        manifest, _ = codeexcerpts.build_manifest(
            {"run.sh": "source .env\npython plot.py figures/result.png\n"},
            set(), CANDIDATES)
        self.assertNotIn(".env", manifest["unresolved_paths"])

    def test_nothing_from_another_folder_is_included(self):
        # Only the sources handed in, which are the script's own.
        manifest, _ = codeexcerpts.build_manifest(
            {"run.sh": SHELL}, set(), CANDIDATES)
        self.assertEqual(["run.sh"],
                         [entry["path"] for entry in manifest["sources"]])

    def test_the_bundle_is_bounded_however_large_the_file(self):
        huge = "".join("run('file_%d.csv')\n" % i for i in range(4000))
        manifest, summary = codeexcerpts.build_manifest(
            {"run.py": huge}, set(), CANDIDATES)
        self.assertLessEqual(len(manifest["excerpts"]),
                             codeexcerpts.MAX_EXCERPTS)
        self.assertLessEqual(
            sum(len(e["text"]) for e in manifest["excerpts"]),
            codeexcerpts.MAX_TOTAL_CHARS)
        self.assertLessEqual(len(manifest["unresolved_paths"]),
                             codeexcerpts.MAX_TOKENS)
        self.assertEqual(summary["excerpt_count"],
                         len(manifest["excerpts"]))

    def test_a_source_past_the_read_cap_is_not_included(self):
        oversized = "run('data/raw.csv')\n" * codeexcerpts.MAX_SOURCE_CHARS
        manifest, _ = codeexcerpts.build_manifest(
            {"run.py": oversized}, set(), CANDIDATES)
        self.assertEqual([], manifest["sources"])

    def test_one_absurdly_long_line_is_truncated(self):
        source = "run('data/raw.csv'" + ("," + "'x'") * 500 + ")\n"
        manifest, _ = codeexcerpts.build_manifest(
            {"run.py": source}, set(), CANDIDATES)
        for entry in manifest["excerpts"]:
            for line in entry["text"].splitlines():
                self.assertLessEqual(len(line), codeexcerpts.MAX_LINE_CHARS)

    def test_the_module_reaches_no_network_and_no_provider(self):
        import inspect
        text = inspect.getsource(codeexcerpts)
        for forbidden in ("requests", "urllib", "socket", "gemini", "Gemini",
                          "generativelanguage", "exec(", "eval(",
                          "subprocess", "__import__"):
            self.assertNotIn(forbidden, text,
                             "codeexcerpts must not mention %r" % forbidden)


class WhatTheCuratorIsShown(unittest.TestCase):

    def test_the_summary_describes_exactly_what_would_be_sent(self):
        manifest, summary = codeexcerpts.build_manifest(
            {"run.sh": SHELL}, set(), CANDIDATES)
        self.assertEqual(summary["sources"], ["run.sh"])
        self.assertEqual(summary["excerpt_count"],
                         len(manifest["excerpts"]))
        self.assertEqual(summary["candidate_count"],
                         len(manifest["candidates"]))
        # The excerpts themselves, so "some code will be sent" can be read
        # rather than taken on trust.
        self.assertEqual(
            [entry["text"] for entry in summary["excerpts"]],
            [entry["text"] for entry in manifest["excerpts"]])

    def test_an_empty_bundle_says_so_rather_than_looking_full(self):
        manifest, summary = codeexcerpts.build_manifest(
            {"run.py": "print('nothing to see')\n"}, set(), CANDIDATES)
        self.assertEqual([], manifest["excerpts"])
        self.assertEqual(0, summary["excerpt_count"])


if __name__ == "__main__":
    unittest.main()
