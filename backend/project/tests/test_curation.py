import json
import os
import unittest
from unittest import mock

import mongoengine
import mongomock

# Deterministic RCC folder analysis, through the real ASGI middleware with the
# file server fully mocked — NO external request is ever made. These tests pin
# the security posture (auth/CSRF, root allowlist, traversal, TLS opt-in),
# the bounded crawl, and the conservative classification rules: charts only
# from images, tools only from pinned manifests, no experiment inference, and
# no directory contents in logs or storage.
from project import connexionapp
from project import curation
from project import folderstandard
from project.models import Paper

RCC = "https://notebook.rcc.uchicago.edu/files"
FOLDER = RCC + "/10.1021.acs.jpcc.5c01077"

# The reference fixture tree from the DOI folder.
FIXTURE = {
    "": (["data", "figures", "scripts"], ["README.md", "requirements.txt"]),
    "data": (["SE-RSH", "VDOS", "dipoles", "short_traj", "vlocal"], []),
    "data/SE-RSH": ([], ["se_rsh.dat"]),
    "data/VDOS": ([], ["vdos.dat"]),
    "data/dipoles": ([], ["dipoles.dat"]),
    "data/short_traj": ([], ["traj_1.xyz", "traj_2.xyz"]),
    "data/vlocal": ([], ["vlocal.cube"]),
    "figures": ([], ["figure1.png", "figure2.png"]),
    "scripts": ([], ["plot_vdos.py", "compute_dipoles.py"]),
}

TEXTS = {
    "requirements.txt": "numpy==1.26.4\nmatplotlib==3.8.0\nscipy>=1.10\n# note\n",
    "scripts/plot_vdos.py": '"""Plot the vibrational density of states."""\n'
                            "import numpy as np\nimport matplotlib.pyplot\n",
    "scripts/compute_dipoles.py": "import numpy as np\nprint(1)\n",
}


def fake_lister(url):
    relative = url[len(FOLDER):].strip("/")
    if relative not in FIXTURE:
        raise AssertionError("unexpected listing request: %s" % url)
    return FIXTURE[relative]


class CurationTestBase(unittest.TestCase):
    def setUp(self):
        self.client = connexionapp.test_client()
        os.environ["QRESP_ENABLE_DEV_LOGIN"] = "1"
        mongoengine.disconnect_all()
        mongoengine.connect('mongoenginetest',
                            mongo_client_class=mongomock.MongoClient)

    def tearDown(self):
        os.environ.pop("QRESP_ENABLE_DEV_LOGIN", None)
        os.environ.pop("QRESP_FILESERVER_ROOTS", None)
        os.environ.pop("QRESP_FILESERVER_INSECURE_TLS_HOSTS", None)
        mongoengine.disconnect_all()

    def login(self, email="curator@example.com"):
        response = self.client.post(
            "/api/auth/dev-login", json={"email": email})
        assert response.status_code == 200, response.text
        self.csrf = self.client.get("/api/auth/me").json()["csrf_token"]

    def analyze(self, path=FOLDER, csrf=True, walk=None, texts=None):
        headers = {}
        if csrf and getattr(self, "csrf", None):
            headers["X-CSRF-Token"] = self.csrf
        texts = TEXTS if texts is None else texts
        with mock.patch("project.curation._list_directory",
                        side_effect=fake_lister) as lister, \
                mock.patch("project.curation._fetch_text",
                           side_effect=lambda url: texts.get(
                               url[len(FOLDER):].strip("/"), "")) as fetch:
            if walk is not None:
                lister.side_effect = walk
            response = self.client.post(
                "/api/curation/analyze-folder", json={"path": path},
                headers=headers)
        return response, lister, fetch


class TestAnalyzeFolderAccess(CurationTestBase):
    def test_anonymous_rejected_without_any_fetch(self):
        response, lister, _ = self.analyze(csrf=False)
        self.assertEqual(401, response.status_code)
        lister.assert_not_called()

    def test_missing_csrf_rejected_without_any_fetch(self):
        self.login()
        response, lister, _ = self.analyze(csrf=False)
        self.assertEqual(403, response.status_code)
        lister.assert_not_called()

    def test_allowed_folder_accepted(self):
        self.login()
        response, _, _ = self.analyze()
        self.assertEqual(200, response.status_code)
        self.assertEqual(FOLDER, response.json()["root"])


class TestAnalyzeFolderPathSafety(CurationTestBase):
    """Every rejection must happen BEFORE a request is made."""

    def assert_refused(self, path):
        self.login()
        response, lister, fetch = self.analyze(path=path)
        self.assertEqual(400, response.status_code, path)
        lister.assert_not_called()
        fetch.assert_not_called()
        return response.json()["error"]

    def test_arbitrary_host_rejected(self):
        message = self.assert_refused("https://evil.example.com/files/x")
        self.assertIn("outside the file server roots", message)

    def test_lookalike_host_prefix_rejected(self):
        self.assert_refused(
            "https://notebook.rcc.uchicago.edu.evil.com/files/x")

    def test_same_host_outside_root_rejected(self):
        self.assert_refused("https://notebook.rcc.uchicago.edu/etc/passwd")

    def test_root_prefix_without_separator_rejected(self):
        # ".../filesXYZ" must not satisfy a startswith check on ".../files".
        self.assert_refused("https://notebook.rcc.uchicago.edu/filesXYZ/a")

    def test_scheme_change_rejected(self):
        self.assert_refused("http://notebook.rcc.uchicago.edu/files/x")
        self.assert_refused("file:///etc/passwd")
        self.assert_refused("ftp://notebook.rcc.uchicago.edu/files/x")

    def test_credentials_in_url_rejected(self):
        message = self.assert_refused(
            "https://user:pw@notebook.rcc.uchicago.edu/files/x")
        self.assertIn("Credentials", message)

    def test_query_and_fragment_rejected(self):
        self.assert_refused(FOLDER + "?a=b")
        self.assert_refused(FOLDER + "#frag")

    def test_traversal_rejected(self):
        self.assert_refused(FOLDER + "/../../etc")
        self.assert_refused("../../etc/passwd")

    def test_encoded_traversal_rejected(self):
        self.assert_refused(FOLDER + "/%2e%2e/%2e%2e/etc")
        self.assert_refused(FOLDER + "/%2E%2E/secret")

    def test_backslash_and_nested_scheme_rejected(self):
        self.assert_refused(FOLDER + "/%5C%5Cserver%5Cshare")
        self.assert_refused(FOLDER + "/a/https%3A%2F%2Fevil.com")

    def test_empty_path_rejected(self):
        message = self.assert_refused("")
        self.assertIn("Select and save", message)

    def test_relative_path_resolves_inside_the_root(self):
        self.assertEqual(FOLDER, curation.resolve_folder_url(
            "10.1021.acs.jpcc.5c01077"))
        self.assertEqual(FOLDER, curation.resolve_folder_url(
            "/10.1021.acs.jpcc.5c01077/"))

    def test_root_allowlist_is_environment_only(self):
        os.environ["QRESP_FILESERVER_ROOTS"] = "https://other.example.org/pub"
        self.assertEqual("https://other.example.org/pub/a",
                         curation.resolve_folder_url(
                             "https://other.example.org/pub/a"))
        with self.assertRaises(curation.FolderError):
            curation.resolve_folder_url(FOLDER)


class TestTlsPosture(CurationTestBase):
    def test_tls_verification_is_on_by_default(self):
        self.assertTrue(curation._verify_for(FOLDER))

    def test_insecure_bypass_is_opt_in_and_host_restricted(self):
        os.environ["QRESP_FILESERVER_INSECURE_TLS_HOSTS"] = \
            "notebook.rcc.uchicago.edu"
        self.assertFalse(curation._verify_for(FOLDER))
        # Only the named host: every other host still verifies.
        self.assertTrue(curation._verify_for("https://other.example.org/pub"))

    def test_the_scope_is_a_no_op_for_a_verified_host(self):
        # No exception configured -> no notice, and urllib3's own warning is
        # left exactly as it is.
        with mock.patch("builtins.print") as printed:
            with curation.tls_exception_scope(FOLDER):
                pass
        printed.assert_not_called()

    def test_the_configured_exception_warns_once_and_quiets_urllib3(self):
        os.environ["QRESP_FILESERVER_INSECURE_TLS_HOSTS"] = \
            "notebook.rcc.uchicago.edu"
        from urllib3.exceptions import InsecureRequestWarning
        import warnings as warnings_module
        with mock.patch("builtins.print") as printed:
            with curation.tls_exception_scope(FOLDER):
                # Exactly one class is silenced, and only that one. Asserting
                # on the filter list keeps this independent of whatever
                # warning state other tests happen to leave behind.
                inside = [f for f in warnings_module.filters
                          if f[0] == "ignore" and f[2] is InsecureRequestWarning]
                self.assertEqual(1, len(inside))
        # Exactly one human-readable notice, naming the host and the variable.
        self.assertEqual(1, printed.call_count)
        message = printed.call_args.args[0]
        self.assertIn("notebook.rcc.uchicago.edu", message)
        self.assertIn("QRESP_FILESERVER_INSECURE_TLS_HOSTS", message)
        self.assertIn("every other host still verifies", message)

    def test_the_exception_does_not_leak_out_of_the_scope(self):
        os.environ["QRESP_FILESERVER_INSECURE_TLS_HOSTS"] = \
            "notebook.rcc.uchicago.edu"
        import warnings as warnings_module
        before = list(warnings_module.filters)
        with curation.tls_exception_scope(FOLDER):
            self.assertNotEqual(before, list(warnings_module.filters))
        # Restored exactly: the suppression lasts one analysis, not the
        # lifetime of the process.
        self.assertEqual(before, list(warnings_module.filters))

    def test_other_hosts_still_verify_inside_the_scope(self):
        os.environ["QRESP_FILESERVER_INSECURE_TLS_HOSTS"] = \
            "notebook.rcc.uchicago.edu"
        with curation.tls_exception_scope(FOLDER):
            self.assertTrue(curation._verify_for("https://other.example.org/a"))
            self.assertFalse(curation._verify_for(FOLDER))

    def test_listing_passes_verify_true_by_default(self):
        with mock.patch("project.curation.requests") as requests_mock:
            requests_mock.get.return_value = mock.Mock(
                content=b"<html></html>", status_code=200)
            curation._list_directory(FOLDER)
        self.assertTrue(requests_mock.get.call_args.kwargs["verify"])
        self.assertEqual(curation.REQUEST_TIMEOUT,
                         requests_mock.get.call_args.kwargs["timeout"])


class TestBoundedWalk(CurationTestBase):
    def test_walks_the_reference_tree(self):
        files, dirs, warnings, truncated = curation.walk_folder(
            FOLDER, list_directory=fake_lister)
        self.assertFalse(truncated)
        self.assertEqual([], warnings)
        self.assertIn("data/short_traj/traj_1.xyz", files)
        self.assertIn("figures/figure1.png", files)
        self.assertIn("data/short_traj", dirs)

    def test_depth_is_capped(self):
        deep = {}
        path = ""
        for level in range(curation.MAX_DEPTH + 4):
            child = "level%d" % level
            deep[path] = ([child], ["file%d.dat" % level])
            path = ("%s/%s" % (path, child)) if path else child
        deep[path] = ([], [])

        def lister(url):
            return deep[url[len(FOLDER):].strip("/")]

        files, _, warnings, truncated = curation.walk_folder(
            FOLDER, list_directory=lister)
        self.assertTrue(truncated)
        self.assertTrue(warnings)
        self.assertLessEqual(len(files), curation.MAX_DEPTH + 1)

    def test_file_count_is_capped_and_reported(self):
        many = {"": ([], ["f%d.dat" % i
                          for i in range(curation.MAX_FILES + 50)])}
        files, _, warnings, truncated = curation.walk_folder(
            FOLDER, list_directory=lambda url: many[""])
        self.assertTrue(truncated)
        self.assertEqual(curation.MAX_FILES, len(files))
        self.assertIn("larger than Qresp will inspect", " ".join(warnings))

    def test_the_depth_cap_says_so_even_alongside_other_warnings(self):
        # A deep tree that ALSO has an unlistable folder must still report
        # why it stopped — a silent `truncated` flag is what makes a partial
        # result look complete.
        deep = {}
        path = ""
        for level in range(curation.MAX_DEPTH + 3):
            child = "level%d" % level
            deep[path] = ([child, "broken"], ["f%d.dat" % level])
            path = ("%s/%s" % (path, child)) if path else child
        deep[path] = ([], [])

        def lister(url):
            relative = url[len(FOLDER):].strip("/")
            if relative.endswith("broken"):
                raise IOError("boom")
            return deep[relative]

        _, _, warnings, truncated = curation.walk_folder(
            FOLDER, list_directory=lister)
        self.assertTrue(truncated)
        joined = " ".join(warnings)
        self.assertIn("could not be listed", joined)
        self.assertIn("first %d folder levels" % curation.MAX_DEPTH, joined)
        # The depth message is reported once, not once per skipped folder.
        self.assertEqual(1, joined.count("folder levels"))

    def test_a_failing_subfolder_is_skipped_not_fatal(self):
        def flaky(url):
            if url.endswith("/scripts"):
                raise IOError("boom")
            return fake_lister(url)

        files, _, warnings, _ = curation.walk_folder(
            FOLDER, list_directory=flaky)
        self.assertIn("figures/figure1.png", files)
        self.assertIn("could not be listed", " ".join(warnings))

    def test_directory_requests_are_capped(self):
        wide = {"": (["d%d" % i for i in range(curation.MAX_DIR_REQUESTS + 20)],
                     [])}
        wide.update({"d%d" % i: ([], [])
                     for i in range(curation.MAX_DIR_REQUESTS + 20)})
        _, _, warnings, truncated = curation.walk_folder(
            FOLDER, list_directory=lambda url:
            wide[url[len(FOLDER):].strip("/")])
        self.assertTrue(truncated)
        self.assertIn("directory listings", " ".join(warnings))


class TestStructureDetection(CurationTestBase):
    """Which mode a folder lands in, and why."""

    def test_exact_lowercase_roles_are_the_standard(self):
        mode, roles, issues = folderstandard.detect_structure(
            ["datasets/a/x.csv", "charts/f1/preview.png", "scripts/s/r.py",
             "docs/g.md", "README.md"],
            ["datasets", "datasets/a", "charts", "charts/f1", "scripts",
             "scripts/s", "docs"])
        self.assertEqual("standard", mode)
        self.assertEqual(
            {"datasets": "datasets", "charts": "charts",
             "scripts": "scripts", "docs": "docs"}, roles)
        self.assertEqual([], issues)

    def test_known_aliases_map_case_insensitively_to_legacy(self):
        mode, roles, issues = folderstandard.detect_structure(
            ["Data/x.csv", "Figures_Tables/f.png", "Plot_Scripts/p.py",
             "Doc/readme.md"],
            ["Data", "Figures_Tables", "Plot_Scripts", "Doc"])
        self.assertEqual("legacy", mode)
        self.assertEqual(
            {"Data": "datasets", "Figures_Tables": "charts",
             "Plot_Scripts": "scripts", "Doc": "docs"}, roles)
        # The mapping is explained, and nothing is renamed on the server.
        self.assertTrue(issues)
        self.assertTrue(any("Nothing on the file server is renamed"
                            in issue["reason"] for issue in issues))

    def test_the_known_acs_folder_enters_legacy_mode(self):
        # acs.nanolett.7b00283 in the public corpus.
        mode, roles, _ = folderstandard.detect_structure(
            ["data/a.dat", "doc/notes.md", "figures_tables/f.png",
             "scripts/s.py"],
            ["data", "doc", "figures_tables", "scripts"])
        self.assertEqual("legacy", mode)
        self.assertEqual("datasets", roles["data"])
        self.assertEqual("charts", roles["figures_tables"])
        self.assertEqual("scripts", roles["scripts"])
        self.assertEqual("docs", roles["doc"])

    def test_an_unknown_root_is_invalid_not_a_guess(self):
        mode, _, issues = folderstandard.detect_structure(
            ["datasets/a/x.csv", "mystery_stuff/y.png"],
            ["datasets", "datasets/a", "mystery_stuff"])
        self.assertEqual("invalid", mode)
        self.assertEqual(["mystery_stuff"], [i["path"] for i in issues])

    def test_a_flat_folder_of_loose_files_is_invalid(self):
        mode, _, issues = folderstandard.detect_structure(
            ["a.csv", "b.png", "c.py"], [])
        self.assertEqual("invalid", mode)
        self.assertIn("no top-level directories", issues[0]["reason"])

    def test_new_artifact_ids_must_be_url_safe(self):
        for good in ("figure_01", "bandgap-2", "d.1", "A9"):
            self.assertTrue(folderstandard.validate_artifact_id(good), good)
        for bad in ("has space", "a/b", "a?b", "a#b", "", None):
            self.assertFalse(folderstandard.validate_artifact_id(bad), bad)


class TestRecordBoundaries(CurationTestBase):
    """One immediate child of a role directory is ONE Qresp record."""

    STANDARD_FILES = [
        "datasets/bandgap/values.csv",
        "datasets/bandgap/runs/run1/out.dat",
        "datasets/bandgap/runs/run2/out.dat",
        "datasets/single.csv",
        "charts/figure_01/preview.png",
        "charts/figure_01/notebook.ipynb",
        "charts/figure_01/data/points.csv",
        "scripts/analysis/analyze.py",
        "scripts/analysis/helper.py",
        "scripts/plot.py",
        "docs/guide.md",
        "docs/img/logo.png",
        "README.md",
        "main.ipynb",
    ]
    STANDARD_DIRS = [
        "datasets", "datasets/bandgap", "datasets/bandgap/runs",
        "datasets/bandgap/runs/run1", "datasets/bandgap/runs/run2",
        "charts", "charts/figure_01", "charts/figure_01/data",
        "scripts", "scripts/analysis", "docs", "docs/img",
    ]

    def analyze(self):
        return curation.analyze_folder_tree(
            self.STANDARD_FILES, self.STANDARD_DIRS, {})

    def test_a_dataset_folder_is_one_candidate_carrying_its_path(self):
        result = self.analyze()
        by_files = [c["proposal"]["files"] for c in result["datasets"]]
        # The folder, not its 3 descendants.
        self.assertIn(["datasets/bandgap"], by_files)
        # A direct file under datasets/ is also one dataset.
        self.assertIn(["datasets/single.csv"], by_files)
        self.assertEqual(2, len(result["datasets"]))

    def test_nested_dataset_descendants_do_not_duplicate(self):
        result = self.analyze()
        paths = [f for c in result["datasets"] for f in c["proposal"]["files"]]
        for nested in ("datasets/bandgap/runs",
                       "datasets/bandgap/runs/run1",
                       "datasets/bandgap/runs/run1/out.dat"):
            self.assertNotIn(nested, paths)
        # The curator is told how to split them if they want to.
        bandgap = [c for c in result["datasets"]
                   if c["proposal"]["files"] == ["datasets/bandgap"]][0]
        self.assertTrue(any("place them as siblings" in line
                            for line in bandgap["evidence"]))

    def test_a_chart_folder_groups_preview_data_and_notebook(self):
        result = self.analyze()
        self.assertEqual(1, len(result["charts"]))
        chart = result["charts"][0]
        self.assertEqual("charts/figure_01/preview.png",
                         chart["proposal"]["imageFile"])
        self.assertEqual(["charts/figure_01/data"], chart["proposal"]["files"])
        self.assertEqual("charts/figure_01/notebook.ipynb",
                         chart["proposal"]["notebookFile"])
        # Still never invented.
        self.assertEqual("", chart["proposal"]["number"])
        self.assertEqual("", chart["proposal"]["caption"])
        self.assertEqual([], chart["proposal"]["properties"])

    def test_a_script_folder_is_one_record_and_a_loose_file_is_another(self):
        result = self.analyze()
        by_files = [c["proposal"]["files"] for c in result["scripts"]]
        self.assertIn(["scripts/analysis"], by_files)
        self.assertIn(["scripts/plot.py"], by_files)
        self.assertEqual(2, len(result["scripts"]))

    def test_docs_produce_no_candidates_and_no_unclassified_noise(self):
        result = self.analyze()
        everything = (result["charts"] + result["datasets"]
                      + result["scripts"] + result["tools"])
        for candidate in everything:
            for path in candidate["paths"]:
                self.assertFalse(path.startswith("docs/"), path)
        self.assertEqual(0, result["unclassified_total"])

    def test_python_under_a_dataset_root_is_not_a_script(self):
        result = curation.analyze_folder_tree(
            ["data/set1/prepare.py", "data/set1/values.csv"],
            ["data", "data/set1"], {})
        self.assertEqual([], result["scripts"])
        self.assertEqual(["data/set1"],
                         result["datasets"][0]["proposal"]["files"])

    def test_csv_under_a_script_root_is_not_a_dataset(self):
        result = curation.analyze_folder_tree(
            ["scripts/job/table.csv", "scripts/job/run.py"],
            ["scripts", "scripts/job"], {})
        self.assertEqual([], result["datasets"])
        self.assertEqual(["scripts/job"],
                         result["scripts"][0]["proposal"]["files"])

    def test_a_tool_folder_leaves_package_and_version_blank_without_evidence(self):
        result = curation.analyze_folder_tree(
            ["tools/west/patches/a.patch", "tools/west/README.md"],
            ["tools", "tools/west", "tools/west/patches"], {})
        tool = result["tools"][0]
        self.assertEqual("", tool["proposal"]["packageName"])
        self.assertEqual("", tool["proposal"]["version"])
        self.assertIn("packageName", tool["needs_input"])
        self.assertEqual(["tools/west/patches/a.patch"],
                         tool["proposal"]["patches"])

    def test_a_tool_folder_uses_an_explicit_declaration_when_present(self):
        result = curation.analyze_folder_tree(
            ["tools/west/README.md"], ["tools", "tools/west"],
            {"tools/west/README.md": "Run with WEST v5.0.0"})
        tool = result["tools"][0]
        self.assertEqual("WEST", tool["proposal"]["packageName"])
        self.assertEqual("5.0.0", tool["proposal"]["version"])

    def test_optional_root_files_are_not_a_problem(self):
        result = self.analyze()
        self.assertEqual(0, result["unclassified_total"])
        self.assertEqual("standard", result["structure_mode"])


class TestLegacyMode(CurationTestBase):
    def test_legacy_aliases_produce_boundary_candidates(self):
        files = ["Data/set_a/x.dat", "Figures_Tables/fig1/preview.png",
                 "Plot_Scripts/plot.py", "Doc/manual.md"]
        dirs = ["Data", "Data/set_a", "Figures_Tables",
                "Figures_Tables/fig1", "Plot_Scripts", "Doc"]
        result = curation.analyze_folder_tree(files, dirs, {})
        self.assertEqual("legacy", result["structure_mode"])
        self.assertEqual(["Data/set_a"],
                         result["datasets"][0]["proposal"]["files"])
        self.assertEqual("Figures_Tables/fig1/preview.png",
                         result["charts"][0]["proposal"]["imageFile"])
        self.assertEqual(["Plot_Scripts/plot.py"],
                         result["scripts"][0]["proposal"]["files"])

    def test_legacy_offers_a_bounded_boundary_tree_for_data_and_scripts(self):
        files = ["data/%s/x.dat" % name for name in ("a", "b", "c")]
        files += ["data/a/nested/y.dat", "scripts/s/run.py"]
        dirs = ["data", "data/a", "data/a/nested", "data/b", "data/c",
                "scripts", "scripts/s"]
        result = curation.analyze_folder_tree(files, dirs, {})
        trees = result["boundary_trees"]
        self.assertIn("data", trees)
        self.assertIn("scripts", trees)
        self.assertEqual("datasets", trees["data"]["role"])
        paths = [node["path"] for node in trees["data"]["nodes"]]
        self.assertIn("data/a", paths)
        self.assertIn("data/a/nested", paths)
        # Every node carries a count, not a file list.
        for node in trees["data"]["nodes"]:
            self.assertIn("file_count", node)
            self.assertLessEqual(len(node["sample_names"]),
                                 folderstandard.MAX_NAMES_PER_GROUP)

    def test_the_acs_folder_does_not_explode_into_unclassified(self):
        files = (["data/run%02d/out.dat" % i for i in range(40)]
                 + ["figures_tables/fig1/preview.png"]
                 + ["scripts/plot.py"]
                 + ["doc/notes.md"])
        dirs = (["data"] + ["data/run%02d" % i for i in range(40)]
                + ["figures_tables", "figures_tables/fig1", "scripts", "doc"])
        result = curation.analyze_folder_tree(files, dirs, {})
        self.assertEqual("legacy", result["structure_mode"])
        # 40 dataset records (one per immediate child), not 40 raw files.
        self.assertEqual(40, len(result["datasets"]))
        self.assertEqual(0, result["unclassified_total"])
        self.assertEqual([], result["grouped_unclassified"])


class TestNeedsReorganization(CurationTestBase):
    def test_unknown_roots_produce_grouped_rows_and_no_candidates(self):
        files = ["mystery/%d.png" % i for i in range(120)]
        files += ["mystery/deep/a.csv", "datasets/d/x.csv"]
        dirs = ["mystery", "mystery/deep", "datasets", "datasets/d"]
        result = curation.analyze_folder_tree(files, dirs, {})

        self.assertEqual("invalid", result["structure_mode"])
        # No extension-based guessing at all.
        for group in ("charts", "datasets", "scripts", "tools"):
            self.assertEqual([], result[group], group)
        # ONE grouped row for the unsupported root, not 121 file entries.
        rows = result["grouped_unclassified"]
        self.assertEqual(["mystery"], [row["path"] for row in rows])
        row = rows[0]
        self.assertEqual(121, row["file_count"])
        self.assertIn(".png", row["extensions"])
        self.assertLessEqual(len(row["sample_names"]),
                             folderstandard.MAX_NAMES_PER_GROUP)
        self.assertIn("not a layout Qresp", row["reason"])
        # The raw list is never returned.
        self.assertEqual([], result["unclassified"])


class TestGroupedUnclassified(CurationTestBase):
    def test_rows_are_grouped_bounded_and_counted(self):
        leftover = ["a/%d.txt" % i for i in range(60)] + ["b/x.dat"]
        rows = folderstandard.group_unclassified(leftover, leftover)
        self.assertEqual(["a", "b"], sorted(row["path"] for row in rows))
        row_a = [r for r in rows if r["path"] == "a"][0]
        self.assertEqual(60, row_a["file_count"])
        self.assertEqual([".txt"], row_a["extensions"])
        # Names only as a bounded sample, never the whole list.
        self.assertEqual(folderstandard.MAX_NAMES_PER_GROUP,
                         len(row_a["sample_names"]))

    def test_the_row_count_itself_is_bounded(self):
        leftover = ["f%03d/x.txt" % i for i in range(400)]
        rows = folderstandard.group_unclassified(leftover, leftover)
        self.assertLessEqual(len(rows), folderstandard.MAX_GROUP_ROWS)


class TestAnalyzeFolderResponse(CurationTestBase):
    def test_response_shape_and_counts(self):
        self.login()
        response, _, _ = self.analyze()
        body = response.json()
        self.assertEqual(FOLDER, body["root"])
        self.assertFalse(body["truncated"])
        # data/ + figures/ + scripts/ are known aliases -> legacy mode.
        self.assertEqual("legacy", body["structure_mode"])
        self.assertEqual("datasets", body["normalized_roles"]["data"])
        self.assertEqual("charts", body["normalized_roles"]["figures"])
        candidates = body["candidates"]
        # Two loose images directly under figures/ -> two charts.
        self.assertEqual(2, len(candidates["charts"]))
        self.assertEqual(2, len(candidates["scripts"]))
        # Five immediate children of data/ -> five datasets, not 6 raw files.
        self.assertEqual(5, len(candidates["datasets"]))
        # Tools now come only from a tools/ role folder; a root
        # requirements.txt is not one.
        self.assertEqual([], candidates["tools"])
        self.assertIn("grouped_unclassified", candidates)
        self.assertEqual(body["counts"]["files"], len(self.all_files()))

    def all_files(self):
        files, _, _, _ = curation.walk_folder(
            FOLDER, list_directory=fake_lister)
        return files

    def test_the_response_states_the_limits_in_force(self):
        self.login()
        response, _, _ = self.analyze()
        limits = response.json()["limits"]
        self.assertEqual(curation.MAX_DEPTH, limits["max_depth"])
        self.assertEqual(curation.MAX_FILES, limits["max_files"])
        self.assertEqual(curation.MAX_DIR_REQUESTS,
                         limits["max_directory_listings"])

    def test_paths_are_relative_and_filetree_compatible(self):
        self.login()
        response, _, _ = self.analyze()
        candidates = response.json()["candidates"]
        for key in ("charts", "datasets", "scripts", "tools"):
            for candidate in candidates[key]:
                for path in candidate["paths"]:
                    self.assertFalse(path.startswith("/"), path)
                    self.assertNotIn("://", path)
                    self.assertNotIn("\\", path)

    def test_nothing_is_written_to_mongo(self):
        self.login()
        before = Paper.objects.count()
        self.analyze()
        self.assertEqual(before, Paper.objects.count())

    def test_only_manifests_and_scripts_are_read_never_data_or_images(self):
        self.login()
        _, _, fetch = self.analyze()
        read = [call.args[0] for call in fetch.call_args_list]
        for url in read:
            self.assertFalse(url.endswith((".xyz", ".png", ".cube", ".dat")),
                             url)
        self.assertIn(FOLDER + "/requirements.txt", read)

    def test_directory_contents_are_never_logged(self, ):
        self.login()
        with mock.patch("builtins.print") as printed:
            self.analyze()
        logged = " ".join(str(call.args[0]) for call in printed.call_args_list
                          if call.args)
        self.assertNotIn("traj_1.xyz", logged)
        self.assertNotIn("figure1.png", logged)
        self.assertNotIn("numpy==", logged)
        self.assertIn("Folder analysis:", logged)

    def test_unreadable_folder_reports_without_leaking_details(self):
        self.login()

        def broken(url):
            raise RuntimeError("connection to 10.0.0.5 refused: secret detail")

        with mock.patch("project.curation.walk_folder", side_effect=broken):
            response = self.client.post(
                "/api/curation/analyze-folder", json={"path": FOLDER},
                headers={"X-CSRF-Token": self.csrf})
        self.assertEqual(502, response.status_code)
        self.assertNotIn("secret detail", response.text)
        self.assertNotIn("10.0.0.5", response.text)

    def test_empty_folder_reports_404(self):
        self.login()
        with mock.patch("project.curation._list_directory",
                        return_value=([], [])):
            response = self.client.post(
                "/api/curation/analyze-folder", json={"path": FOLDER},
                headers={"X-CSRF-Token": self.csrf})
        self.assertEqual(404, response.status_code)


GEMINI_ENV = {
    "QRESP_GEMINI_ENABLED": "1",
    "QRESP_GEMINI_API_KEY": "test-gemini-super-secret",
    "QRESP_GEMINI_MODEL": "gemini-test",
}

AI_ITEMS = [
    {
        "id": "script-0",
        "kind": "script",
        "name": "scripts/plot_vdos.py",
        "paths": ["scripts/plot_vdos.py"],
        "context": "Plot the vibrational density of states.",
    },
]


def gemini_reply(items):
    return {"candidates": [{"content": {"parts": [
        {"text": json.dumps({"items": items})}]}}]}


class MockResponse:
    def __init__(self, payload, status_code=200, text=""):
        self._payload = payload
        self.status_code = status_code
        self.text = text

    def json(self):
        return self._payload


class DescribeCandidatesBase(CurationTestBase):
    def setUp(self):
        super().setUp()
        for key, value in GEMINI_ENV.items():
            os.environ[key] = value

    def tearDown(self):
        for key in GEMINI_ENV:
            os.environ.pop(key, None)
        from project.models import AssistUsage
        AssistUsage.drop_collection()
        super().tearDown()

    def describe(self, payload, reply=None, csrf=True):
        headers = {}
        if csrf and getattr(self, "csrf", None):
            headers["X-CSRF-Token"] = self.csrf
        with mock.patch("project.assist.requests") as requests_mock:
            requests_mock.post.return_value = (
                reply if reply is not None
                else MockResponse(gemini_reply([
                    {"id": "script-0", "description": "Plots the VDOS.",
                     "keywords": ["VDOS"]}])))
            response = self.client.post(
                "/api/curation/describe-candidates", json=payload,
                headers=headers)
        return response, requests_mock


class TestDescribeCandidatesGating(DescribeCandidatesBase):
    def test_anonymous_rejected(self):
        response, requests_mock = self.describe(
            {"consent": True, "items": AI_ITEMS}, csrf=False)
        self.assertEqual(401, response.status_code)
        requests_mock.post.assert_not_called()

    def test_missing_csrf_rejected(self):
        self.login()
        response, requests_mock = self.describe(
            {"consent": True, "items": AI_ITEMS}, csrf=False)
        self.assertEqual(403, response.status_code)
        requests_mock.post.assert_not_called()

    def test_consent_is_required(self):
        # Omitting it never reaches the handler: the spec marks it required.
        self.login()
        response, requests_mock = self.describe({"items": AI_ITEMS})
        self.assertEqual(400, response.status_code)
        requests_mock.post.assert_not_called()

    def test_consent_false_is_not_consent(self):
        self.login()
        response, requests_mock = self.describe(
            {"consent": False, "items": AI_ITEMS})
        self.assertEqual(400, response.status_code)
        self.assertIn("Confirm", response.json()["error"])
        requests_mock.post.assert_not_called()

    def test_unconfigured_provider_reports_503_without_calling_out(self):
        for key in GEMINI_ENV:
            os.environ.pop(key, None)
        self.login()
        response, requests_mock = self.describe(
            {"consent": True, "items": AI_ITEMS})
        self.assertEqual(503, response.status_code)
        self.assertIn("not configured", response.json()["error"])
        requests_mock.post.assert_not_called()

    def test_folder_analysis_still_works_without_gemini(self):
        # The deterministic path must never depend on the AI provider.
        for key in GEMINI_ENV:
            os.environ.pop(key, None)
        self.login()
        response, _, _ = self.analyze()
        self.assertEqual(200, response.status_code)
        self.assertTrue(response.json()["candidates"]["charts"])

    def test_quota_is_enforced(self):
        os.environ["QRESP_GEMINI_MAX_REQUESTS_PER_USER_PER_DAY"] = "1"
        try:
            self.login()
            first, _ = self.describe({"consent": True, "items": AI_ITEMS})
            self.assertEqual(200, first.status_code)
            second, requests_mock = self.describe(
                {"consent": True, "items": AI_ITEMS})
            self.assertEqual(429, second.status_code)
            requests_mock.post.assert_not_called()
        finally:
            os.environ.pop("QRESP_GEMINI_MAX_REQUESTS_PER_USER_PER_DAY", None)


class TestDescribeCandidatesPayload(DescribeCandidatesBase):
    def sent_payload(self, items):
        self.login()
        _, requests_mock = self.describe({"consent": True, "items": items})
        body = requests_mock.post.call_args.kwargs["json"]
        return json.loads(body["contents"][0]["parts"][0]["text"]), body

    def test_only_allowlisted_fields_travel(self):
        payload, _ = self.sent_payload([dict(
            AI_ITEMS[0],
            email="curator@example.com",
            owner="someone",
            absolute_path="/etc/passwd",
            file_bytes="\x00\x01binary",
            api_key="secret",
        )])
        for item in payload["items"]:
            self.assertEqual(set(curation.AI_ALLOWED_KEYS), set(item))
        serialized = json.dumps(payload)
        self.assertNotIn("curator@example.com", serialized)
        self.assertNotIn("someone", serialized)
        self.assertNotIn("/etc/passwd", serialized)
        self.assertNotIn("binary", serialized)
        self.assertNotIn("secret", serialized)

    def test_absolute_and_external_paths_are_dropped(self):
        payload, _ = self.sent_payload([dict(
            AI_ITEMS[0],
            paths=["scripts/ok.py", "/etc/shadow", "https://evil.com/x"])])
        self.assertEqual(["scripts/ok.py"], payload["items"][0]["paths"])

    def test_context_is_bounded(self):
        payload, _ = self.sent_payload([dict(AI_ITEMS[0], context="x" * 99999)])
        self.assertEqual(curation.MAX_AI_CONTEXT_CHARS,
                         len(payload["items"][0]["context"]))

    def test_item_count_is_bounded(self):
        payload, _ = self.sent_payload([
            dict(AI_ITEMS[0], id="script-%d" % i) for i in range(50)])
        self.assertEqual(curation.MAX_AI_ITEMS, len(payload["items"]))

    def test_batch_cap_is_ten(self):
        self.assertEqual(10, curation.MAX_AI_ITEMS)

    def test_unknown_kinds_are_refused(self):
        self.login()
        response, requests_mock = self.describe(
            {"consent": True,
             "items": [dict(AI_ITEMS[0], kind="experiment")]})
        self.assertEqual(400, response.status_code)
        requests_mock.post.assert_not_called()

    def test_structured_output_and_header_auth(self):
        _, body = self.sent_payload(AI_ITEMS)
        self.assertEqual(curation.AI_RESPONSE_SCHEMA,
                         body["generationConfig"]["responseSchema"])
        self.assertEqual("application/json",
                         body["generationConfig"]["responseMimeType"])
        # No tools/grounding/search/code execution are ever requested.
        for forbidden in ("tools", "toolConfig", "safetySettings"):
            self.assertNotIn(forbidden, body)


class TestDescribeCandidatesResponse(DescribeCandidatesBase):
    def test_suggestions_are_returned_for_review(self):
        self.login()
        response, _ = self.describe({"consent": True, "items": AI_ITEMS})
        self.assertEqual(200, response.status_code)
        suggestions = response.json()["suggestions"]
        self.assertEqual("Plots the VDOS.",
                         suggestions["script-0"]["description"])
        self.assertEqual(["VDOS"], suggestions["script-0"]["keywords"])

    def test_ids_that_were_never_sent_are_discarded(self):
        self.login()
        response, _ = self.describe(
            {"consent": True, "items": AI_ITEMS},
            reply=MockResponse(gemini_reply([
                {"id": "script-0", "description": "ok", "keywords": []},
                {"id": "smuggled", "description": "not requested",
                 "keywords": []}])))
        self.assertEqual(["script-0"], list(response.json()["suggestions"]))

    def test_tools_get_a_description_but_never_keywords(self):
        # Qresp has no keyword field on a Tool, so shipping keywords for one
        # would only invite the UI to invent a home for them.
        self.login()
        response, _ = self.describe(
            {"consent": True,
             "items": [dict(AI_ITEMS[0], id="tool-0", kind="tool",
                            name="numpy 1.26.4")]},
            reply=MockResponse(gemini_reply([
                {"id": "tool-0", "description": "Array library.",
                 "keywords": ["arrays", "numerics"]}])))
        suggestion = response.json()["suggestions"]["tool-0"]
        self.assertEqual("Array library.", suggestion["description"])
        self.assertEqual([], suggestion["keywords"])

    def test_only_descriptive_fields_can_come_back(self):
        # The schema has no room for factual fields, so a model that tries to
        # set one cannot reach the curator.
        properties = curation.AI_RESPONSE_SCHEMA["properties"]["items"]
        # id + the reviewable, non-factual suggestions + how well supported.
        self.assertEqual(
            {"id", "description", "keywords", "kind", "confidence", "reason"},
            set(properties["items"]["properties"]))
        # `kind` is an enum of the four record types, so it cannot become a
        # free-text field either.
        self.assertEqual(["chart", "dataset", "script", "tool"],
                         properties["items"]["properties"]["kind"]["enum"])
        self.login()
        response, _ = self.describe(
            {"consent": True, "items": AI_ITEMS},
            reply=MockResponse(gemini_reply([
                {"id": "script-0", "description": "ok", "keywords": [],
                 "files": ["invented.py"], "packageName": "fake",
                 "version": "9.9", "number": 3, "imageFile": "fake.png"}])))
        self.assertEqual(
            {"description", "keywords", "kind", "confidence", "reason"},
            set(response.json()["suggestions"]["script-0"]))

    def test_ai_confidence_can_never_reach_high(self):
        # Only direct deterministic evidence is "high"; a model claiming it
        # would put a guess on the same footing as a detected file path.
        self.login()
        for claimed in ("high", "HIGH", "certain", "", None, 99):
            response, _ = self.describe(
                {"consent": True, "items": AI_ITEMS},
                reply=MockResponse(gemini_reply([
                    {"id": "script-0", "description": "d", "keywords": [],
                     "confidence": claimed}])))
            got = response.json()["suggestions"]["script-0"]["confidence"]
            self.assertIn(got, ("medium", "low"), claimed)

    def test_ai_confidence_and_reason_are_passed_through_bounded(self):
        self.login()
        response, _ = self.describe(
            {"consent": True, "items": AI_ITEMS},
            reply=MockResponse(gemini_reply([
                {"id": "script-0", "description": "d", "keywords": [],
                 "confidence": "medium", "reason": "r" * 999}])))
        suggestion = response.json()["suggestions"]["script-0"]
        self.assertEqual("medium", suggestion["confidence"])
        self.assertEqual(200, len(suggestion["reason"]))

    def test_a_differing_kind_comes_back_as_a_note(self):
        self.login()
        response, _ = self.describe(
            {"consent": True, "items": AI_ITEMS},
            reply=MockResponse(gemini_reply([
                {"id": "script-0", "description": "d", "keywords": [],
                 "kind": "dataset"}])))
        self.assertEqual("dataset",
                         response.json()["suggestions"]["script-0"]["kind"])

    def test_agreeing_with_qresp_is_not_reported_as_a_change(self):
        self.login()
        response, _ = self.describe(
            {"consent": True, "items": AI_ITEMS},
            reply=MockResponse(gemini_reply([
                {"id": "script-0", "description": "d", "keywords": [],
                 "kind": "script"}])))
        self.assertEqual("", response.json()["suggestions"]["script-0"]["kind"])

    def test_an_invented_kind_is_dropped(self):
        self.login()
        for invented in ("experiment", "paper", "<script>", "", None):
            response, _ = self.describe(
                {"consent": True, "items": AI_ITEMS},
                reply=MockResponse(gemini_reply([
                    {"id": "script-0", "description": "d", "keywords": [],
                     "kind": invented}])))
            self.assertEqual(
                "", response.json()["suggestions"]["script-0"]["kind"],
                invented)

    def test_the_kind_note_never_touches_a_factual_field(self):
        self.login()
        response, _ = self.describe(
            {"consent": True, "items": AI_ITEMS},
            reply=MockResponse(gemini_reply([
                {"id": "script-0", "description": "d", "keywords": [],
                 "kind": "chart", "imageFile": "invented.png",
                 "files": ["invented.py"], "number": 3}])))
        self.assertEqual(
            {"description", "keywords", "kind", "confidence", "reason"},
            set(response.json()["suggestions"]["script-0"]))

    def test_insufficient_evidence_yields_a_blank_description(self):
        self.login()
        response, _ = self.describe(
            {"consent": True, "items": AI_ITEMS},
            reply=MockResponse(gemini_reply([
                {"id": "script-0", "description": "", "keywords": []}])))
        self.assertEqual("",
                         response.json()["suggestions"]["script-0"]["description"])

    def test_malformed_provider_answer_is_a_clean_502(self):
        self.login()
        response, _ = self.describe(
            {"consent": True, "items": AI_ITEMS},
            reply=MockResponse({"candidates": [{"content": {"parts": [
                {"text": "I am not JSON at all"}]}}]}))
        self.assertEqual(502, response.status_code)
        self.assertIn("unreadable", response.json()["error"])

    def test_provider_error_details_never_leak(self):
        self.login()
        response, _ = self.describe(
            {"consent": True, "items": AI_ITEMS},
            reply=MockResponse({"error": {"message": "invalid api key abc123"}},
                               status_code=403, text="invalid api key abc123"))
        self.assertEqual(502, response.status_code)
        self.assertNotIn("abc123", response.text)
        self.assertNotIn("api key", response.text.lower())

    def test_the_api_key_never_appears_in_a_response_or_log(self):
        self.login()
        with mock.patch("builtins.print") as printed:
            response, _ = self.describe({"consent": True, "items": AI_ITEMS})
        logged = " ".join(str(call.args[0]) for call in printed.call_args_list
                          if call.args)
        self.assertNotIn("test-gemini-super-secret", logged)
        self.assertNotIn("test-gemini-super-secret", response.text)

    def test_descriptions_are_bounded(self):
        self.login()
        response, _ = self.describe(
            {"consent": True, "items": AI_ITEMS},
            reply=MockResponse(gemini_reply([
                {"id": "script-0", "description": "y" * 9999,
                 "keywords": ["k"] * 99}])))
        suggestion = response.json()["suggestions"]["script-0"]
        self.assertEqual(curation.MAX_AI_DESCRIPTION_CHARS,
                         len(suggestion["description"]))
        self.assertLessEqual(len(suggestion["keywords"]), 8)

    def test_nothing_is_persisted_beyond_the_usage_counter(self):
        self.login()
        before = Paper.objects.count()
        self.describe({"consent": True, "items": AI_ITEMS})
        self.assertEqual(before, Paper.objects.count())


if __name__ == "__main__":
    unittest.main()
