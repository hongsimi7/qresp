"""What a script says about the files it reads and writes.

The rule under every one of these tests: a suggestion exists because the CODE
says so, at a line the curator can go and read. Nothing here may come from a
file's name, a folder's name, or a resemblance between the two.
"""
import unittest

from project import codelinks


FILES = {
    "scripts/plot_dos.py",
    "scripts/prepare.ipynb",
    "data/dos.dat",
    "data/raw.csv",
    "data/clean.csv",
    "figures/dos.png",
    "figures/bands.png",
}


def scan(sources, files=None):
    return codelinks.scan_sources(sources, files or FILES)


class ReadsAndWrites(unittest.TestCase):

    def test_literal_read_csv_names_the_dataset_it_reads(self):
        found = scan({"scripts/plot_dos.py":
                      "import pandas as pd\n"
                      "frame = pd.read_csv('data/raw.csv')\n"})
        self.assertEqual(len(found), 1)
        self.assertEqual(found[0]["mode"], "read")
        self.assertEqual(found[0]["path"], "data/raw.csv")
        self.assertEqual(found[0]["script"], "scripts/plot_dos.py")
        self.assertEqual(found[0]["call"], "pandas.read_csv")
        # The line is the point: a curator can open the file and check.
        self.assertEqual(found[0]["line"], 2)
        self.assertIsNone(found[0]["cell"])

    def test_literal_savefig_names_the_figure_it_writes(self):
        found = scan({"scripts/plot_dos.py":
                      "import matplotlib.pyplot as plt\n"
                      "plt.savefig('figures/dos.png')\n"})
        self.assertEqual(len(found), 1)
        self.assertEqual(found[0]["mode"], "write")
        self.assertEqual(found[0]["path"], "figures/dos.png")
        self.assertEqual(found[0]["call"], "matplotlib.pyplot.savefig")

    def test_to_csv_names_the_dataset_it_writes(self):
        found = scan({"scripts/plot_dos.py":
                      "frame.to_csv('data/clean.csv')\n"})
        self.assertEqual(len(found), 1)
        self.assertEqual(found[0]["mode"], "write")
        self.assertEqual(found[0]["path"], "data/clean.csv")
        self.assertEqual(found[0]["call"], "DataFrame.to_csv")

    def test_a_method_on_a_local_variable_still_counts(self):
        # `fig` is a variable no static read can resolve. The METHOD name is
        # the evidence, and the argument still has to name a real file.
        found = scan({"scripts/plot_dos.py":
                      "fig.savefig('figures/bands.png')\n"})
        self.assertEqual([f["path"] for f in found], ["figures/bands.png"])

    def test_open_for_reading_counts_and_open_for_writing_does_not(self):
        reads = scan({"scripts/plot_dos.py":
                      "handle = open('data/dos.dat')\n"})
        self.assertEqual([f["mode"] for f in reads], ["read"])

        explicit = scan({"scripts/plot_dos.py":
                         "handle = open('data/dos.dat', 'r')\n"})
        self.assertEqual([f["mode"] for f in explicit], ["read"])

        # Opened to write: the writing happens later, through a variable, and
        # this line does not say what is written.
        writes = scan({"scripts/plot_dos.py":
                       "handle = open('data/dos.dat', 'w')\n"})
        self.assertEqual(writes, [])

    def test_the_other_supported_readers(self):
        source = ("import numpy as np\n"
                  "import xarray as xr\n"
                  "import scipy.io\n"
                  "a = np.loadtxt('data/dos.dat')\n"
                  "b = xr.open_dataset('data/raw.csv')\n"
                  "c = scipy.io.loadmat('data/clean.csv')\n")
        found = scan({"scripts/plot_dos.py": source})
        self.assertEqual(
            sorted(f["call"] for f in found),
            ["numpy.loadtxt", "scipy.io.loadmat", "xarray.open_dataset"])


class Notebooks(unittest.TestCase):

    def notebook(self, *cells):
        return {"cells": [{"cell_type": "code", "source": cell}
                          for cell in cells],
                "metadata": {}, "nbformat": 4}

    def test_a_code_cell_reads_like_a_script(self):
        import json
        text = json.dumps(self.notebook(
            "import pandas as pd\n",
            "frame = pd.read_csv('data/raw.csv')\n",
        ))
        found = scan({"scripts/prepare.ipynb": text})
        self.assertEqual(len(found), 1)
        self.assertEqual(found[0]["path"], "data/raw.csv")
        # Which cell, and where in it -- the two things a curator needs to
        # find the line again.
        self.assertEqual(found[0]["cell"], 2)
        self.assertEqual(found[0]["line"], 1)

    def test_a_markdown_cell_and_an_output_are_never_read(self):
        import json
        document = {
            "cells": [
                {"cell_type": "markdown",
                 "source": "We read data/raw.csv with pd.read_csv('data/raw.csv')"},
                {"cell_type": "code", "source": "print('hello')\n",
                 "outputs": [{"text": "pd.read_csv('data/clean.csv')"}]},
            ],
            "nbformat": 4,
        }
        self.assertEqual(scan({"scripts/prepare.ipynb":
                               json.dumps(document)}), [])

    def test_a_broken_notebook_skips_itself_only(self):
        import json
        good = json.dumps(self.notebook(
            "import pandas as pd\nframe = pd.read_csv('data/raw.csv')\n"))
        found = scan({
            "scripts/prepare.ipynb": "{not json at all",
            "scripts/plot_dos.py": "import pandas as pd\n"
                                   "pd.read_csv('data/clean.csv')\n",
        })
        self.assertEqual([f["path"] for f in found], ["data/clean.csv"])
        # And the well-formed one still works.
        self.assertEqual(len(scan({"scripts/prepare.ipynb": good})), 1)

    def test_a_cell_of_magics_does_not_stop_the_notebook(self):
        import json
        text = json.dumps(self.notebook(
            "%matplotlib inline\n",
            "import pandas as pd\n",
            "pd.read_csv('data/raw.csv')\n",
        ))
        found = scan({"scripts/prepare.ipynb": text})
        self.assertEqual([f["path"] for f in found], ["data/raw.csv"])


class Aliases(unittest.TestCase):

    def test_an_alias_is_followed(self):
        found = scan({"scripts/plot_dos.py":
                      "import pandas as anything\n"
                      "anything.read_csv('data/raw.csv')\n"})
        self.assertEqual([f["call"] for f in found], ["pandas.read_csv"])

    def test_a_from_import_is_followed(self):
        found = scan({"scripts/plot_dos.py":
                      "from pandas import read_csv\n"
                      "read_csv('data/raw.csv')\n"})
        self.assertEqual([f["call"] for f in found], ["pandas.read_csv"])

    def test_a_name_that_was_never_imported_resolves_to_nothing(self):
        # `pd` could be anything. Without the import line there is no reason
        # to believe this is pandas.
        self.assertEqual(
            scan({"scripts/plot_dos.py": "pd.read_csv('data/raw.csv')\n"}), [])

    def test_a_star_import_binds_nothing(self):
        self.assertEqual(
            scan({"scripts/plot_dos.py":
                  "from pandas import *\n"
                  "read_csv('data/raw.csv')\n"}), [])

    def test_a_relative_import_binds_nothing(self):
        self.assertEqual(
            scan({"scripts/plot_dos.py":
                  "from . import read_csv\n"
                  "read_csv('data/raw.csv')\n"}), [])


class WhatIsRefused(unittest.TestCase):
    """Everything whose meaning depends on something the file does not say."""

    def refuses(self, code, why):
        self.assertEqual(
            scan({"scripts/plot_dos.py": "import pandas as pd\n" + code}), [],
            why)

    def test_an_f_string_is_not_a_path(self):
        self.refuses("pd.read_csv(f'data/{name}.csv')\n",
                     "an f-string is decided at runtime")

    def test_concatenation_is_not_a_path(self):
        self.refuses("pd.read_csv('data/' + name + '.csv')\n",
                     "the pieces are not all in the file")

    def test_a_variable_is_not_a_path(self):
        self.refuses("pd.read_csv(path)\n", "a variable holds anything")

    def test_a_config_or_env_lookup_is_not_a_path(self):
        self.refuses("pd.read_csv(os.environ['DATA'])\n",
                     "the value lives outside the repository")
        self.refuses("pd.read_csv(config['input'])\n",
                     "the value lives outside the file")

    def test_a_url_is_not_a_file_in_this_folder(self):
        self.refuses("pd.read_csv('https://example.org/data/raw.csv')\n",
                     "a URL is not a file in the folder")

    def test_an_absolute_path_is_not_a_file_in_this_folder(self):
        self.refuses("pd.read_csv('/var/data/raw.csv')\n",
                     "an absolute path belongs to one machine")
        self.refuses("pd.read_csv('C:/data/raw.csv')\n",
                     "a drive letter belongs to one machine")
        self.refuses("pd.read_csv('C:\\\\data\\\\raw.csv')\n",
                     "a Windows path belongs to one machine")

    def test_climbing_out_of_the_folder_is_refused(self):
        self.refuses("pd.read_csv('../../secrets/raw.csv')\n",
                     "the file is outside what was scanned")

    def test_a_glob_is_not_one_file(self):
        self.refuses("pd.read_csv('data/*.csv')\n", "a pattern is not a path")

    def test_a_file_the_scan_never_saw_is_refused(self):
        self.refuses("pd.read_csv('data/does_not_exist.csv')\n",
                     "nothing in the folder answers to that name")

    def test_similar_names_alone_link_nothing(self):
        # THE case this feature exists to not do: dos.py and dos.png share a
        # name and nothing else. Only a line of code relates them.
        found = codelinks.scan_sources(
            {"dos.py": "print('no io here')\n"},
            {"dos.py", "dos.png", "dos.dat"})
        self.assertEqual(found, [])

    def test_an_unsupported_call_is_refused(self):
        self.refuses("pd.read_hdf('data/raw.csv')\n",
                     "read_hdf is not in the supported list")
        self.refuses("subprocess.run('cp data/raw.csv out')\n",
                     "a shell command is not a file read")

    def test_a_python_file_that_does_not_parse_skips_itself(self):
        found = scan({
            "scripts/plot_dos.py": "def broken(:\n",
            "scripts/prepare.ipynb": "",
        })
        self.assertEqual(found, [])

    def test_a_script_reading_itself_is_not_a_link(self):
        self.assertEqual(
            scan({"scripts/plot_dos.py":
                  "open('scripts/plot_dos.py')\n"}), [])


class Ambiguity(unittest.TestCase):

    def test_a_path_beside_the_script_is_found(self):
        # Written relative to the script's own folder, which is how most
        # analysis code is actually written.
        found = codelinks.scan_sources(
            {"scripts/plot_dos.py": "import pandas as pd\n"
                                    "pd.read_csv('raw.csv')\n"},
            {"scripts/plot_dos.py", "scripts/raw.csv"})
        self.assertEqual([f["path"] for f in found], ["scripts/raw.csv"])

    def test_a_literal_matching_two_real_files_is_dropped(self):
        # `raw.csv` beside the script AND `raw.csv` at the root. The code does
        # not say which directory it ran from, so both readings are real and
        # neither is the answer. Guessing here would produce exactly the kind
        # of arrow a curator has to notice and undo.
        found = codelinks.scan_sources(
            {"scripts/plot_dos.py": "import pandas as pd\n"
                                    "pd.read_csv('raw.csv')\n"},
            {"scripts/plot_dos.py", "scripts/raw.csv", "raw.csv"})
        self.assertEqual(found, [])


class Determinism(unittest.TestCase):

    def test_the_same_pair_twice_is_one_suggestion(self):
        found = scan({"scripts/plot_dos.py":
                      "import pandas as pd\n"
                      "pd.read_csv('data/raw.csv')\n"
                      "pd.read_csv('data/raw.csv')\n"
                      "pd.read_table('data/raw.csv')\n"})
        self.assertEqual(len(found), 1)
        # The earliest place it appears is the one shown.
        self.assertEqual(found[0]["line"], 2)

    def test_reading_and_writing_the_same_file_are_two_facts(self):
        found = scan({"scripts/plot_dos.py":
                      "import pandas as pd\n"
                      "pd.read_csv('data/raw.csv')\n"
                      "frame.to_csv('data/raw.csv')\n"})
        self.assertEqual(sorted(f["mode"] for f in found), ["read", "write"])

    def test_the_order_does_not_depend_on_dictionary_order(self):
        sources = {
            "scripts/plot_dos.py": "import pandas as pd\n"
                                   "pd.read_csv('data/raw.csv')\n",
            "scripts/prepare.ipynb": "",
        }
        first = scan(sources)
        second = scan(dict(reversed(list(sources.items()))))
        self.assertEqual(first, second)


class NothingIsExecutedOrSent(unittest.TestCase):

    def test_module_level_code_is_never_run(self):
        # If this were executed, the marker would be set and the exception
        # would escape. `ast.parse` builds a tree and evaluates nothing.
        import project.codelinks as module
        marker = {"ran": False}
        source = ("import builtins\n"
                  "raise RuntimeError('this file must never run')\n")
        self.assertEqual(scan({"scripts/plot_dos.py": source}), [])
        self.assertFalse(marker["ran"])
        self.assertFalse(hasattr(module, "ran"))

    def test_the_module_reaches_no_network_and_no_provider(self):
        import inspect
        text = inspect.getsource(codelinks)
        for forbidden in ("requests", "urllib", "http", "socket",
                          "gemini", "Gemini", "generativelanguage",
                          "assist", "exec(", "eval(", "subprocess",
                          "importlib", "__import__"):
            self.assertNotIn(forbidden, text,
                             "codelinks must not mention %r" % forbidden)


if __name__ == "__main__":
    unittest.main()
