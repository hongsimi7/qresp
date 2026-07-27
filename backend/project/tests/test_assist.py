import base64
import contextlib
import io
import json
import os
import unittest
import zipfile
from unittest import mock

import mongoengine
import mongomock

# Opt-in AI keyword suggestions (Gemini), through the real ASGI middleware
# with the provider fully mocked — NO external call is ever made. These tests
# pin the security posture: disabled-by-default 503, auth/CSRF, per-user daily
# limit, strict structured-output parsing, allowlisted request fields, the
# exact native provider contract (endpoint/x-goog-api-key/model/schema/token
# cap), and no manuscript/secret leakage.
from project import assist
from project import connexionapp
from project.models import AssistUsage

# Synthetic, obviously-fake credentials: never a real key.
GEMINI_ENV = {
    "QRESP_GEMINI_ENABLED": "1",
    "QRESP_GEMINI_API_KEY": "test-gemini-super-secret",
    "QRESP_GEMINI_MODEL": "gemini-test",
}


def gemini_reply(keywords):
    """A native generateContent success body carrying structured JSON."""
    return {"candidates": [{"content": {"parts": [
        {"text": json.dumps({"keywords": keywords})}]}}]}


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


class AssistTestBase(unittest.TestCase):
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
        os.environ.pop("QRESP_GEMINI_MAX_REQUESTS_PER_USER_PER_DAY", None)
        AssistUsage.drop_collection()
        mongoengine.disconnect_all()

    def login(self, email="curator@example.com"):
        response = self.client.post(
            "/api/auth/dev-login", json={"email": email})
        assert response.status_code == 200, response.text
        self.csrf = self.client.get("/api/auth/me").json()["csrf_token"]

    def suggest(self, payload, reply=None, csrf=True, responses=None):
        headers = {}
        if csrf and getattr(self, "csrf", None):
            headers["X-CSRF-Token"] = self.csrf
        with mock.patch("project.assist.requests") as requests_mock:
            if responses is not None:
                requests_mock.post.side_effect = responses
            else:
                requests_mock.post.return_value = (
                    reply if reply is not None
                    else MockResponse(gemini_reply(["DFT"])))
            response = self.client.post(
                "/api/assist/keywords", json=payload, headers=headers)
        return response, requests_mock


class TestAssistGating(AssistTestBase):
    def test_disabled_by_default_returns_503(self):
        for key in GEMINI_ENV:
            os.environ.pop(key, None)
        self.login()
        response, requests_mock = self.suggest({"title": "T"})
        self.assertEqual(503, response.status_code)
        self.assertIn("not configured", response.json()["error"])
        requests_mock.post.assert_not_called()

    def test_missing_key_is_still_unconfigured(self):
        os.environ.pop("QRESP_GEMINI_API_KEY", None)
        self.login()
        response, requests_mock = self.suggest({"title": "T"})
        self.assertEqual(503, response.status_code)
        requests_mock.post.assert_not_called()

    def test_anonymous_rejected(self):
        response, requests_mock = self.suggest({"title": "T"}, csrf=False)
        self.assertEqual(401, response.status_code)
        requests_mock.post.assert_not_called()

    def test_missing_csrf_rejected(self):
        self.login()
        response, requests_mock = self.suggest({"title": "T"}, csrf=False)
        self.assertEqual(403, response.status_code)
        requests_mock.post.assert_not_called()

    def test_legacy_provider_variables_alone_do_not_enable_the_feature(self):
        # The provider swap is clean: the retired QRESP_KIMI_* (and older
        # QRESP_QWEN_*) variables have NO effect and cannot resurrect the
        # integration.
        for key in GEMINI_ENV:
            os.environ.pop(key, None)
        legacy = {
            "QRESP_KIMI_ENABLED": "1",
            "QRESP_KIMI_API_KEY": "sk-legacy-should-be-ignored",
            "QRESP_KIMI_MODEL": "kimi-k3",
            "QRESP_KIMI_TIMEOUT_SECONDS": "30",
            "QRESP_KIMI_MAX_MANUSCRIPT_CHARS": "1000",
            "QRESP_KIMI_MAX_REQUESTS_PER_USER_PER_DAY": "99",
            "QRESP_QWEN_ENABLED": "1",
            "QRESP_QWEN_API_KEY": "sk-older-legacy-ignored",
        }
        os.environ.update(legacy)
        try:
            self.login()
            response, requests_mock = self.suggest({"title": "T"})
            self.assertEqual(503, response.status_code)
            self.assertIn("not configured", response.json()["error"])
            requests_mock.post.assert_not_called()
            self.assertNotIn("legacy", response.text)
        finally:
            for key in legacy:
                os.environ.pop(key, None)

    def test_enabled_without_api_key_stays_unconfigured(self):
        os.environ.pop("QRESP_GEMINI_API_KEY", None)
        self.login()
        response, requests_mock = self.suggest({"title": "T"})
        self.assertEqual(503, response.status_code)
        requests_mock.post.assert_not_called()

    def test_nothing_to_analyze_rejected(self):
        self.login()
        response, requests_mock = self.suggest({})
        self.assertEqual(400, response.status_code)
        requests_mock.post.assert_not_called()


class TestAssistSuggestions(AssistTestBase):
    def test_returns_normalized_deduplicated_capped_suggestions(self):
        self.login()
        response, requests_mock = self.suggest(
            {"title": "Ice nucleation", "abstract": "We simulate water."},
            reply=MockResponse(gemini_reply([
                "  DFT ", "dft", "Molecular Dynamics", "water", "Water",
                "ice nucleation", "a", "x" * 80, "phase diagrams",
                "free energy", "nucleation", "simulation", "supercooling",
            ])))
        self.assertEqual(200, response.status_code, response.text)
        keywords = response.json()["keywords"]
        # Deduplicated case-insensitively, bounded lengths dropped, capped.
        self.assertEqual(8, len(keywords))
        self.assertEqual("DFT", keywords[0])
        self.assertNotIn("dft", keywords[1:])
        self.assertNotIn("a", keywords)
        self.assertEqual(len([k for k in keywords
                              if k.lower() == "water"]), 1)
        requests_mock.post.assert_called_once()

    def test_calls_the_native_gemini_endpoint_with_header_auth(self):
        self.login()
        response, requests_mock = self.suggest({"title": "T"})
        self.assertEqual(200, response.status_code, response.text)
        args, kwargs = requests_mock.post.call_args
        url = args[0]
        # Exact official native endpoint, model in the path.
        self.assertEqual(
            "https://generativelanguage.googleapis.com/v1beta/models/"
            "gemini-test:generateContent", url)
        self.assertTrue(url.startswith(assist.GEMINI_API_BASE))
        # Header auth ONLY — the key must never ride in the query string.
        self.assertEqual("test-gemini-super-secret",
                         kwargs["headers"]["x-goog-api-key"])
        self.assertNotIn("key=", url)
        self.assertNotIn("test-gemini-super-secret", url)
        self.assertNotIn("Authorization", kwargs["headers"])
        # Bounded timeout is always passed.
        self.assertTrue(0 < kwargs["timeout"] <= assist.GEMINI_MAX_TIMEOUT)

    def test_requests_structured_json_output_with_a_capped_token_budget(self):
        self.login()
        response, requests_mock = self.suggest({"title": "T"})
        self.assertEqual(200, response.status_code, response.text)
        body = requests_mock.post.call_args.kwargs["json"]
        config = body["generationConfig"]
        self.assertEqual("application/json", config["responseMimeType"])
        self.assertEqual(assist.GEMINI_RESPONSE_SCHEMA,
                         config["responseSchema"])
        # Narrow schema: only a bounded keyword list is accepted back.
        self.assertEqual(
            ["keywords"], list(config["responseSchema"]["properties"]))
        self.assertEqual(
            8, config["responseSchema"]["properties"]["keywords"]["maxItems"])
        self.assertLessEqual(config["maxOutputTokens"],
                             assist.GEMINI_MAX_OUTPUT_TOKENS_CEILING)
        # Deprecated sampling knobs are deliberately absent.
        for forbidden in ("temperature", "topP", "topK", "top_p", "top_k"):
            self.assertNotIn(forbidden, config)
        # Native content shape, fixed system instruction, no tools/grounding.
        self.assertIn("system_instruction", body)
        self.assertEqual("user", body["contents"][0]["role"])
        for forbidden in ("tools", "toolConfig", "tool_config",
                          "safetySettings", "cachedContent"):
            self.assertNotIn(forbidden, body)

    def test_model_falls_back_to_the_default_when_unset(self):
        os.environ.pop("QRESP_GEMINI_MODEL", None)
        self.login()
        response, requests_mock = self.suggest({"title": "T"})
        self.assertEqual(200, response.status_code, response.text)
        self.assertIn("/gemini-3.6-flash:generateContent",
                      requests_mock.post.call_args[0][0])
        self.assertEqual("gemini-3.6-flash", assist.GEMINI_DEFAULT_MODEL)

    def test_malformed_model_name_cannot_escape_the_url_path(self):
        # A bad env value must not inject a path segment or query string.
        os.environ["QRESP_GEMINI_MODEL"] = "../../evil?key=leak"
        self.login()
        response, requests_mock = self.suggest({"title": "T"})
        self.assertEqual(200, response.status_code, response.text)
        url = requests_mock.post.call_args[0][0]
        self.assertEqual(
            "https://generativelanguage.googleapis.com/v1beta/models/"
            "gemini-3.6-flash:generateContent", url)
        self.assertNotIn("evil", url)

    def test_never_reuses_the_google_oauth_login_credentials(self):
        # The sign-in client id/secret must not enable or feed this feature.
        os.environ.pop("QRESP_GEMINI_API_KEY", None)
        os.environ["QRESP_GOOGLE_CLIENT_ID"] = "oauth-client-id"
        os.environ["QRESP_GOOGLE_CLIENT_SECRET"] = "oauth-client-secret"
        try:
            self.login()
            response, requests_mock = self.suggest({"title": "T"})
            self.assertEqual(503, response.status_code)
            requests_mock.post.assert_not_called()

            # Even when Gemini IS configured, no OAuth value travels.
            os.environ["QRESP_GEMINI_API_KEY"] = "test-gemini-super-secret"
            response, requests_mock = self.suggest({"title": "T"})
            self.assertEqual(200, response.status_code, response.text)
            sent = json.dumps({
                "url": requests_mock.post.call_args[0][0],
                "headers": requests_mock.post.call_args.kwargs["headers"],
                "json": requests_mock.post.call_args.kwargs["json"],
            })
            self.assertNotIn("oauth-client-id", sent)
            self.assertNotIn("oauth-client-secret", sent)
        finally:
            os.environ.pop("QRESP_GOOGLE_CLIENT_ID", None)
            os.environ.pop("QRESP_GOOGLE_CLIENT_SECRET", None)

    def test_api_key_never_reaches_the_client_or_the_logs(self):
        self.login()
        stdout = io.StringIO()
        with contextlib.redirect_stdout(stdout):
            response, _ = self.suggest(
                {"title": "T"},
                reply=MockResponse(
                    {"error": {"message": "API key not valid: "
                                          "test-gemini-super-secret"}},
                    status_code=400,
                    text="API key not valid: test-gemini-super-secret"))
        self.assertEqual(502, response.status_code)
        for sink in (response.text, stdout.getvalue()):
            self.assertNotIn("test-gemini-super-secret", sink)
            self.assertNotIn("x-goog-api-key", sink)
            self.assertNotIn("API key not valid", sink)

    def test_upstream_rate_limit_is_reported_safely(self):
        self.login()
        stdout = io.StringIO()
        with contextlib.redirect_stdout(stdout):
            response, _ = self.suggest(
                {"title": "T"},
                reply=MockResponse(
                    {"error": {"message": "Quota exceeded for project 12345"}},
                    status_code=429,
                    text="Quota exceeded for project 12345"))
        self.assertEqual(502, response.status_code)
        self.assertIn("rate limited", response.json()["error"])
        for sink in (response.text, stdout.getvalue()):
            self.assertNotIn("project 12345", sink)
            self.assertNotIn("Quota exceeded", sink)

    def test_requests_minimal_thinking_without_thought_summaries(self):
        self.login()
        response, requests_mock = self.suggest({"title": "T"})
        self.assertEqual(200, response.status_code, response.text)
        config = requests_mock.post.call_args.kwargs["json"]["generationConfig"]
        # Keyword extraction needs no deliberation, and thinking tokens share
        # the output budget with the answer.
        self.assertEqual({"thinkingLevel": "minimal"},
                         config["thinkingConfig"])
        # Thought summaries stay off.
        self.assertNotIn("includeThoughts", config["thinkingConfig"])

    def test_parses_a_thought_part_followed_by_the_answer(self):
        # THE STAGING BUG: a thinking model emits reasoning parts before the
        # structured answer. Concatenating them produced invalid JSON.
        self.login()
        response, _ = self.suggest(
            {"title": "T"},
            reply=MockResponse({"candidates": [{
                "content": {"parts": [
                    {"thought": True,
                     "text": "Let me consider the abstract... the topic is "
                             "clearly ice nucleation."},
                    {"thoughtSignature": "Ct8BQ2hvb3NlIGtleXdvcmRz"},
                    {"text": json.dumps({"keywords": ["Ice Nucleation",
                                                      "DFT"]})},
                ]},
                "finishReason": "STOP",
            }]}))
        self.assertEqual(200, response.status_code, response.text)
        self.assertEqual(["Ice Nucleation", "DFT"],
                         response.json()["keywords"])
        # Reasoning text and thought signatures never surface.
        self.assertNotIn("Let me consider", response.text)
        self.assertNotIn("thoughtSignature", response.text)
        self.assertNotIn("Ct8BQ2hvb3Nl", response.text)

    def test_parses_a_markdown_fenced_json_answer(self):
        self.login()
        fenced = "```json\n%s\n```" % json.dumps({"keywords": ["Water"]})
        response, _ = self.suggest(
            {"title": "T"},
            reply=MockResponse({"candidates": [{
                "content": {"parts": [{"text": fenced}]},
                "finishReason": "STOP",
            }]}))
        self.assertEqual(200, response.status_code, response.text)
        self.assertEqual(["Water"], response.json()["keywords"])

    def test_parses_an_answer_split_across_text_parts(self):
        self.login()
        payload = json.dumps({"keywords": ["Phase Diagrams"]})
        response, _ = self.suggest(
            {"title": "T"},
            reply=MockResponse({"candidates": [{
                "content": {"parts": [
                    {"thought": True, "text": "reasoning"},
                    {"text": payload[:10]},
                    {"text": payload[10:]},
                ]},
                "finishReason": "STOP",
            }]}))
        self.assertEqual(200, response.status_code, response.text)
        self.assertEqual(["Phase Diagrams"], response.json()["keywords"])

    def test_prompt_block_is_reported_as_a_declined_request(self):
        self.login()
        stdout = io.StringIO()
        with contextlib.redirect_stdout(stdout):
            response, _ = self.suggest(
                {"title": "T"},
                reply=MockResponse({
                    "promptFeedback": {
                        "blockReason": "SAFETY",
                        "safetyRatings": [{"category": "HARM_CATEGORY_X"}],
                    }}))
        self.assertEqual(502, response.status_code)
        self.assertIn("declined this request", response.json()["error"])
        # The client never sees provider category labels or raw output...
        self.assertNotIn("SAFETY", response.text)
        self.assertNotIn("HARM_CATEGORY", response.text)
        # ...while the server keeps a sanitized breadcrumb (labels only).
        self.assertIn("block=SAFETY", stdout.getvalue())
        self.assertNotIn("HARM_CATEGORY", stdout.getvalue())

    def test_safety_finish_reason_is_reported_as_a_declined_request(self):
        self.login()
        response, _ = self.suggest(
            {"title": "T"},
            reply=MockResponse({"candidates": [{
                "content": {"parts": []},
                "finishReason": "PROHIBITED_CONTENT",
                "safetyRatings": [{"category": "HARM_CATEGORY_Y"}],
            }]}))
        self.assertEqual(502, response.status_code)
        self.assertIn("declined this request", response.json()["error"])
        self.assertNotIn("PROHIBITED_CONTENT", response.text)

    def test_no_candidates_is_distinct_from_a_malformed_answer(self):
        self.login()
        response, _ = self.suggest(
            {"title": "T"}, reply=MockResponse({"candidates": []}))
        self.assertEqual(502, response.status_code)
        self.assertIn("did not return suggestions", response.json()["error"])

    def test_truncated_answer_without_text_is_not_called_unreadable(self):
        # The output budget was spent before the answer: no usable candidate,
        # not a parsing failure.
        self.login()
        response, _ = self.suggest(
            {"title": "T"},
            reply=MockResponse({"candidates": [{
                "content": {"parts": [{"thought": True, "text": "thinking"}]},
                "finishReason": "MAX_TOKENS",
            }]}))
        self.assertEqual(502, response.status_code)
        self.assertIn("did not return suggestions", response.json()["error"])
        self.assertNotIn("thinking", response.text)

    def test_malformed_answer_text_is_reported_as_unreadable(self):
        self.login()
        stdout = io.StringIO()
        with contextlib.redirect_stdout(stdout):
            response, _ = self.suggest(
                {"title": "T"},
                reply=MockResponse({"candidates": [{
                    "content": {"parts": [
                        {"text": "Sure! Here are some keywords: DFT, water"}]},
                    "finishReason": "STOP",
                }]}))
        self.assertEqual(502, response.status_code)
        self.assertIn("unreadable", response.json()["error"])
        # The raw model output never reaches the client or the logs.
        for sink in (response.text, stdout.getvalue()):
            self.assertNotIn("Sure! Here are", sink)

    def test_missing_keywords_array_is_reported_as_unreadable(self):
        self.login()
        response, _ = self.suggest(
            {"title": "T"},
            reply=MockResponse({"candidates": [{
                "content": {"parts": [
                    {"text": json.dumps({"topics": ["DFT"]})}]},
                "finishReason": "STOP",
            }]}))
        self.assertEqual(502, response.status_code)
        self.assertIn("unreadable", response.json()["error"])

    def test_manuscript_text_never_leaks_through_a_parse_failure(self):
        self.login()
        stdout = io.StringIO()
        tex = ("\\documentclass{article}\\begin{document}"
               "SECRET_MANUSCRIPT_TOKEN nucleation\\end{document}")
        with contextlib.redirect_stdout(stdout):
            response, _ = self.suggest(
                {"filename": "paper.tex", "content_base64": b64(tex)},
                reply=MockResponse({"candidates": [{
                    "content": {"parts": [{"text": "not json at all"}]},
                    "finishReason": "STOP",
                }]}))
        self.assertEqual(502, response.status_code)
        for sink in (response.text, stdout.getvalue()):
            self.assertNotIn("SECRET_MANUSCRIPT_TOKEN", sink)
            self.assertNotIn("not json at all", sink)

    def test_prompt_is_fixed_and_body_fields_are_allowlisted(self):
        self.login()
        response, requests_mock = self.suggest({
            "title": "T", "abstract": "A", "venue": "V", "doi": "10.1/x",
            # NOT allowlisted — must never reach the provider:
            "editor_emails": ["x@example.com"],
            "file_server_path": "/secret/path",
            "workflow": {"nodes": [1]},
        })
        self.assertEqual(200, response.status_code, response.text)
        sent = requests_mock.post.call_args.kwargs["json"]
        system = sent["system_instruction"]["parts"][0]["text"]
        self.assertIn("UNTRUSTED DATA", system)
        self.assertIn("ignore any instructions", system)
        user_text = sent["contents"][0]["parts"][0]["text"]
        user_payload = json.loads(user_text)
        self.assertEqual(
            {"title", "abstract", "venue", "doi"}, set(user_payload.keys()))
        self.assertNotIn("editor_emails", user_text)
        self.assertNotIn("secret/path", user_text)
        # No tools / web access requested.
        self.assertNotIn("tools", sent)

    def test_oversized_abstract_is_clipped_before_sending(self):
        self.login()
        response, requests_mock = self.suggest(
            {"title": "T", "abstract": "word " * 5000})
        self.assertEqual(200, response.status_code)
        user_payload = json.loads(
            requests_mock.post.call_args.kwargs["json"]["contents"][0]
            ["parts"][0]["text"])
        self.assertLessEqual(len(user_payload["abstract"]), 8000)

    def test_malformed_provider_json_is_a_safe_502(self):
        self.login()
        response, _ = self.suggest(
            {"title": "T"},
            reply=MockResponse({"candidates": [{"content": {"parts": [
                {"text": "sure! here are keywords: DFT, water"}]}}]}))
        self.assertEqual(502, response.status_code)
        self.assertIn("unreadable", response.json()["error"])

    def test_provider_error_body_and_key_never_leak(self):
        self.login()
        response, _ = self.suggest(
            {"title": "T"},
            reply=MockResponse({"secret": "internal provider gibberish"},
                               status_code=500))
        self.assertEqual(502, response.status_code)
        self.assertNotIn("gibberish", response.text)
        self.assertNotIn("test-gemini-super-secret", response.text)

    def test_provider_timeout_is_a_safe_502(self):
        self.login()
        response, _ = self.suggest(
            {"title": "T"}, responses=RuntimeError("socket timeout details"))
        self.assertEqual(502, response.status_code)
        self.assertNotIn("socket timeout", response.text)

    def test_daily_limit_is_enforced_and_persistent(self):
        os.environ["QRESP_GEMINI_MAX_REQUESTS_PER_USER_PER_DAY"] = "2"
        self.login()
        for _ in range(2):
            response, _ = self.suggest({"title": "T"})
            self.assertEqual(200, response.status_code)
        response, requests_mock = self.suggest({"title": "T"})
        self.assertEqual(429, response.status_code)
        requests_mock.post.assert_not_called()
        # Only email/day/count are persisted — no content — and the REJECTED
        # attempt did not burn quota (compensated back to the limit).
        usage = AssistUsage.objects.first()
        self.assertEqual("curator@example.com", usage.email)
        self.assertEqual(2, usage.count)
        self.assertNotIn("title", usage.to_mongo().to_dict())

    def test_configuration_is_environment_only_never_config_ini(self):
        # Config.get_setting falls back to config.ini; assist must NEVER use
        # it for Gemini. Even if config.ini could supply every GEMINI key, the
        # endpoint must stay unconfigured while the env vars are unset.
        for key in GEMINI_ENV:
            os.environ.pop(key, None)
        self.login()
        with mock.patch("project.config.Config.get_setting",
                        return_value="1"):
            response, requests_mock = self.suggest({"title": "T"})
        self.assertEqual(503, response.status_code)
        requests_mock.post.assert_not_called()

    def test_timeout_is_bounded_even_when_misconfigured(self):
        os.environ["QRESP_GEMINI_TIMEOUT_SECONDS"] = "99999"
        try:
            self.assertEqual(assist.GEMINI_MAX_TIMEOUT,
                             assist._gemini_config()["TIMEOUT"])
        finally:
            os.environ.pop("QRESP_GEMINI_TIMEOUT_SECONDS", None)

    def test_invalid_input_consumes_no_quota(self):
        self.login()
        # Nothing to analyze -> 400 before any quota bookkeeping.
        response, _ = self.suggest({})
        self.assertEqual(400, response.status_code)
        # Unsafe zip -> 400 before any quota bookkeeping.
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, "w") as archive:
            archive.writestr("../evil.tex", "\\documentclass{article}")
        response, _ = self.suggest({
            "filename": "project.zip",
            "content_base64": b64(buffer.getvalue()),
        })
        self.assertEqual(400, response.status_code)
        self.assertEqual(0, AssistUsage.objects.count())

    def test_quota_counts_provider_calls_not_ui_requests(self):
        # A 3-chunk manuscript = 3 provider calls = 3 quota units.
        os.environ["QRESP_GEMINI_MAX_REQUESTS_PER_USER_PER_DAY"] = "3"
        self.login()
        body = "ice nucleation " * 5000  # ~75k chars -> 3 chunks
        tex = ("\\documentclass{article}\\begin{document}%s\\end{document}"
               % body)
        responses = [MockResponse(gemini_reply(["Ice"])),
                     MockResponse(gemini_reply(["Nucleation"])),
                     MockResponse(gemini_reply(["Simulation"]))]
        response, requests_mock = self.suggest(
            {"filename": "paper.tex", "content_base64": b64(tex)},
            responses=responses)
        self.assertEqual(200, response.status_code, response.text)
        self.assertEqual(3, requests_mock.post.call_count)
        self.assertEqual(3, AssistUsage.objects.first().count)
        # The quota is now exhausted: even a cheap 1-call request is denied
        # WITHOUT touching the provider, and without burning further quota.
        response, requests_mock = self.suggest({"title": "T"})
        self.assertEqual(429, response.status_code)
        requests_mock.post.assert_not_called()
        self.assertEqual(3, AssistUsage.objects.first().count)

    def test_multi_chunk_request_cannot_bypass_a_smaller_limit(self):
        os.environ["QRESP_GEMINI_MAX_REQUESTS_PER_USER_PER_DAY"] = "2"
        self.login()
        body = "ice nucleation " * 5000
        tex = ("\\documentclass{article}\\begin{document}%s\\end{document}"
               % body)
        response, requests_mock = self.suggest(
            {"filename": "paper.tex", "content_base64": b64(tex)})
        # 3 planned calls > limit 2: rejected BEFORE any provider call, and
        # the attempt is compensated so nothing was burned.
        self.assertEqual(429, response.status_code)
        requests_mock.post.assert_not_called()
        self.assertEqual(0, AssistUsage.objects.first().count)

    def test_no_tags_are_persisted_anywhere(self):
        self.login()
        self.suggest({"title": "T"})
        # The only collection this feature touches is the usage counter.
        connection = mongoengine.connection.get_db()
        collections = set(connection.list_collection_names())
        self.assertIn("assist_usage", collections)
        self.assertNotIn("papers", collections)


class TestAssistManuscript(AssistTestBase):
    TEX = ("\\documentclass{article}\\begin{document}"
           "We study SECRET_BODY_TOKEN ice nucleation with simulations. "
           "\\begin{thebibliography}{9}\\bibitem{x} CITED_WORK_TOKEN about "
           "unrelated topics \\end{thebibliography}\\end{document}")

    def test_manuscript_text_is_chunked_bibliography_stripped_and_never_leaks(self):
        self.login()
        stdout = io.StringIO()
        with contextlib.redirect_stdout(stdout):
            response, requests_mock = self.suggest({
                "title": "T",
                "filename": "paper.tex",
                "content_base64": b64(self.TEX),
            }, reply=MockResponse(gemini_reply(["ice nucleation"])))
        self.assertEqual(200, response.status_code, response.text)
        sent = requests_mock.post.call_args.kwargs["json"]
        user_payload = json.loads(sent["contents"][0]["parts"][0]["text"])
        # The manuscript body goes to the provider (with consent)...
        self.assertIn("SECRET_BODY_TOKEN", user_payload["manuscript_excerpt"])
        # ...but the bibliography is stripped so cited works cannot dominate.
        self.assertNotIn("CITED_WORK_TOKEN",
                         user_payload["manuscript_excerpt"])
        # And nothing manuscript-derived leaks into our response or logs.
        self.assertNotIn("SECRET_BODY_TOKEN", response.text)
        self.assertNotIn("SECRET_BODY_TOKEN", stdout.getvalue())

    def test_long_manuscripts_are_split_and_aggregated(self):
        self.login()
        body = "ice nucleation " * 5000  # ~75k chars -> capped, 3 chunks
        tex = "\\documentclass{article}\\begin{document}%s\\end{document}" % body
        responses = [
            MockResponse(gemini_reply(["Ice"])),
            MockResponse(gemini_reply(["Nucleation", "ice"])),
            MockResponse(gemini_reply(["Simulation"])),
        ]
        response, requests_mock = self.suggest({
            "filename": "paper.tex",
            "content_base64": b64(tex),
        }, responses=responses)
        self.assertEqual(200, response.status_code, response.text)
        self.assertEqual(3, requests_mock.post.call_count)
        self.assertEqual(["Ice", "Nucleation", "Simulation"],
                         response.json()["keywords"])

    def test_unsafe_zip_is_rejected_before_any_provider_call(self):
        self.login()
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, "w") as archive:
            archive.writestr("../evil.tex", "\\documentclass{article}")
        response, requests_mock = self.suggest({
            "filename": "project.zip",
            "content_base64": b64(buffer.getvalue()),
        })
        self.assertEqual(400, response.status_code)
        requests_mock.post.assert_not_called()

    def test_oversized_upload_rejected(self):
        self.login()
        huge = "A" * ((10 * 1024 * 1024 * 4) // 3 + 4096)
        response, requests_mock = self.suggest({
            "filename": "paper.tex", "content_base64": huge})
        self.assertEqual(400, response.status_code)
        requests_mock.post.assert_not_called()


if __name__ == "__main__":
    unittest.main()
