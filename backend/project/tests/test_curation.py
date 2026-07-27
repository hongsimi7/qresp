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


class TestClassification(CurationTestBase):
    def setUp(self):
        super().setUp()
        self.files, self.dirs, _, _ = curation.walk_folder(
            FOLDER, list_directory=fake_lister)
        self.result = curation.analyze_folder_tree(
            self.files, self.dirs, TEXTS)

    def test_charts_come_only_from_images(self):
        charts = self.result["charts"]
        self.assertEqual(["figures/figure1.png", "figures/figure2.png"],
                         [c["proposal"]["imageFile"] for c in charts])
        for chart in charts:
            self.assertEqual([], chart["proposal"]["extraFields"])
            self.assertEqual("", chart["proposal"]["caption"])
            self.assertIn("caption", chart["needs_input"])
            self.assertIn("number", chart["needs_input"])

    def test_chart_number_is_a_sequence_proposal_not_the_paper_figure(self):
        numbers = [c["proposal"]["number"] for c in self.result["charts"]]
        self.assertEqual([1, 2], numbers)
        for chart in self.result["charts"]:
            self.assertIn("number", chart["needs_input"])

    def test_notebook_is_only_attached_when_one_exists(self):
        for chart in self.result["charts"]:
            self.assertEqual("", chart["proposal"]["notebookFile"])
        with_nb = curation.analyze_folder_tree(
            ["figures/figure1.png", "figures/figure1.ipynb"], [], {})
        self.assertEqual("figures/figure1.ipynb",
                         with_nb["charts"][0]["proposal"]["notebookFile"])

    def test_datasets_group_by_directory_with_generic_descriptions(self):
        datasets = {d["proposal"]["files"][0].rsplit("/", 1)[0]: d
                    for d in self.result["datasets"]}
        traj = datasets["data/short_traj"]
        self.assertEqual(["data/short_traj/traj_1.xyz",
                          "data/short_traj/traj_2.xyz"],
                         traj["proposal"]["files"])
        self.assertEqual("Files from data/short_traj",
                         traj["proposal"]["readme"])
        # Never an invented URL.
        self.assertEqual([], traj["proposal"]["URLs"])

    def test_scripts_use_their_own_docstring_when_present(self):
        scripts = {s["proposal"]["files"][0]: s
                   for s in self.result["scripts"]}
        self.assertEqual("Plot the vibrational density of states.",
                         scripts["scripts/plot_vdos.py"]["proposal"]["readme"])
        self.assertEqual([], scripts["scripts/plot_vdos.py"]["needs_input"])
        # No docstring -> a generic, non-inventive placeholder that the
        # curator is told to fill in.
        other = scripts["scripts/compute_dipoles.py"]
        self.assertEqual("Script compute_dipoles.py", other["proposal"]["readme"])
        self.assertIn("readme", other["needs_input"])

    def test_tools_only_from_pinned_manifest_entries(self):
        tools = {t["proposal"]["packageName"]: t for t in self.result["tools"]}
        self.assertEqual({"numpy", "matplotlib"}, set(tools))
        self.assertEqual("1.26.4", tools["numpy"]["proposal"]["version"])
        # scipy>=1.10 is not an exact version -> not a tool.
        self.assertNotIn("scipy", tools)
        for tool in self.result["tools"]:
            self.assertEqual("", tool["proposal"]["executableName"])
            self.assertEqual("", tool["proposal"]["urls"])
            self.assertEqual([], tool["proposal"]["patches"])

    def test_python_imports_are_a_hint_never_a_tool(self):
        result = curation.analyze_folder_tree(
            ["scripts/a.py"], [], {"scripts/a.py": "import ase\nimport numpy"})
        self.assertEqual([], result["tools"])
        self.assertIn("ase", result["possible_dependencies"])

    def test_no_experiment_records_are_inferred(self):
        self.assertNotIn("experiments", self.result)
        for group in ("charts", "datasets", "scripts", "tools"):
            for candidate in self.result[group]:
                self.assertNotIn("experiment", candidate["kind"])

    def test_patches_only_from_real_patch_files(self):
        result = curation.analyze_folder_tree(
            ["requirements.txt", "fix.patch", "notes.txt"], [],
            {"requirements.txt": "numpy==1.0\n"})
        self.assertEqual(["fix.patch"],
                         result["tools"][0]["proposal"]["patches"])

    def test_manifests_and_readmes_are_not_datasets(self):
        dataset_files = [f for d in self.result["datasets"]
                         for f in d["proposal"]["files"]]
        self.assertNotIn("requirements.txt", dataset_files)
        self.assertNotIn("README.md", dataset_files)

    def test_every_candidate_carries_evidence_and_a_stable_id(self):
        ids = []
        for group in ("charts", "datasets", "scripts", "tools"):
            for candidate in self.result[group]:
                self.assertTrue(candidate["evidence"])
                self.assertTrue(candidate["paths"])
                ids.append(candidate["id"])
        self.assertEqual(len(ids), len(set(ids)))

    def test_related_chart_files_are_conservative(self):
        result = curation.analyze_folder_tree(
            ["figure1.png", "figure1.csv", "unrelated_data.csv"], [], {})
        self.assertEqual(["figure1.csv"],
                         result["charts"][0]["proposal"]["files"])


class TestAnalyzeFolderResponse(CurationTestBase):
    def test_response_shape_and_counts(self):
        self.login()
        response, _, _ = self.analyze()
        body = response.json()
        self.assertEqual(FOLDER, body["root"])
        self.assertFalse(body["truncated"])
        candidates = body["candidates"]
        self.assertEqual(2, len(candidates["charts"]))
        self.assertEqual(2, len(candidates["tools"]))
        self.assertEqual(2, len(candidates["scripts"]))
        self.assertTrue(candidates["datasets"])
        self.assertIn("unclassified", candidates)
        self.assertEqual(body["counts"]["files"], len(self.all_files()))

    def all_files(self):
        files, _, _, _ = curation.walk_folder(
            FOLDER, list_directory=fake_lister)
        return files

    def test_paths_are_relative_and_filetree_compatible(self):
        self.login()
        response, _, _ = self.analyze()
        for group in response.json()["candidates"].values():
            if not isinstance(group, list):
                continue
            for candidate in group:
                if not isinstance(candidate, dict):
                    continue
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
        self.assertEqual({"id", "description", "keywords"},
                         set(properties["items"]["properties"]))
        self.login()
        response, _ = self.describe(
            {"consent": True, "items": AI_ITEMS},
            reply=MockResponse(gemini_reply([
                {"id": "script-0", "description": "ok", "keywords": [],
                 "files": ["invented.py"], "packageName": "fake",
                 "version": "9.9", "number": 3, "imageFile": "fake.png"}])))
        self.assertEqual({"description", "keywords"},
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
