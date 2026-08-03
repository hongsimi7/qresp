"""Shared Gemini transport for the one AI feature Qresp still has.

This module owns no endpoint of its own. It provides the provider call, the
configuration, the per-user daily quota and the keyword normalizer that
`project/curation.py` uses for RCC folder-candidate descriptions -- the only
place a language model is involved in Qresp.

Bibliography is NOT one of those places: publication metadata comes from the
DOI registry and from what the curator types, never from a model. Qresp
keywords are likewise entered by hand.

Disabled by default; configured EXCLUSIVELY via environment variables
(QRESP_GEMINI_*) -- never config.ini. Google Gemini is the single selected
provider: this is deliberately NOT a multi-provider framework, and the API
host below is fixed in code so no configuration can redirect text somewhere
else.

The credential is a dedicated Google AI Studio / Gemini API key sent in the
x-goog-api-key header. It is completely separate from the Google OAuth
sign-in client (QRESP_GOOGLE_*), which this module never reads: no OAuth
token, user credential, Drive/Gmail scope, grounding, search, URL context,
code execution, or file upload is involved.

Privacy/safety model:
- Callers send bounded, allowlisted payloads only.
- Content stays in memory: never persisted, logged, echoed back, or recorded
  in the usage counter.
- The payload is DATA, not instructions: a fixed prompt asks for a JSON
  answer only; no tools, no web access, no instruction-following.
- Provider errors, keys, and prompts are never exposed to the client.
- A persistent per-user daily request limit protects the shared quota.
"""
import json
import os
import re
from datetime import datetime

import requests

from project.auth import get_current_user

# ---- configuration (environment only) --------------------------------------

# Fixed provider host: never configurable, so no environment mistake can point
# the prompt (and any consented manuscript excerpt) at another host. Only the
# model name is configurable, and it is sanitized before entering the path.
GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta/models"
GEMINI_DEFAULT_MODEL = "gemini-3.6-flash"
# The model lands in the request URL path: allow only plain model tokens so a
# malformed value cannot inject a path segment or query string.
GEMINI_MODEL_RE = re.compile(r"^[A-Za-z0-9._-]+$")
GEMINI_DEFAULT_TIMEOUT = 15
GEMINI_MAX_TIMEOUT = 60
GEMINI_DEFAULT_MAX_MANUSCRIPT_CHARS = 60000
GEMINI_MAX_MANUSCRIPT_CHARS_CEILING = 200000
GEMINI_DEFAULT_DAILY_LIMIT = 20
GEMINI_DEFAULT_MAX_OUTPUT_TOKENS = 256
GEMINI_MAX_OUTPUT_TOKENS_CEILING = 256

MAX_SUGGESTIONS = 8

def _truthy(value):
    return str(value or "").strip().lower() in ("1", "true", "yes", "on")


def _env(key):
    # ENVIRONMENT ONLY, deliberately not Config.get_setting: that helper
    # falls back to config.ini, and Gemini credentials/switches must never be
    # configurable (or accidentally committed) there.
    return os.environ.get("QRESP_" + key)


def _int_env(key, default, ceiling=None):
    try:
        value = int(str(_env(key)).strip())
    except (TypeError, ValueError):
        return default
    if value <= 0:
        return default
    if ceiling is not None:
        return min(value, ceiling)
    return value


def _gemini_config():
    # The model name is the only provider knob; it falls back to the default
    # once the feature is enabled, and anything that is not a plain model
    # token is refused (it would otherwise land in the request URL path).
    model = (_env("GEMINI_MODEL") or "").strip()
    if not model or not GEMINI_MODEL_RE.match(model):
        model = GEMINI_DEFAULT_MODEL
    cfg = {
        "ENABLED": _truthy(_env("GEMINI_ENABLED")),
        # A dedicated Google AI Studio / Gemini API key. Deliberately NOT the
        # Google OAuth client secret used by the sign-in flow: this
        # integration never reads QRESP_GOOGLE_* and never touches OAuth.
        "API_KEY": (_env("GEMINI_API_KEY") or "").strip(),
        "MODEL": model,
        # Bounded even against misconfiguration: a worker must never hang on
        # the provider for minutes.
        "TIMEOUT": _int_env("GEMINI_TIMEOUT_SECONDS", GEMINI_DEFAULT_TIMEOUT,
                            ceiling=GEMINI_MAX_TIMEOUT),
        "MAX_MANUSCRIPT_CHARS": _int_env(
            "GEMINI_MAX_MANUSCRIPT_CHARS",
            GEMINI_DEFAULT_MAX_MANUSCRIPT_CHARS,
            ceiling=GEMINI_MAX_MANUSCRIPT_CHARS_CEILING),
        "DAILY_LIMIT": _int_env(
            "GEMINI_MAX_REQUESTS_PER_USER_PER_DAY",
            GEMINI_DEFAULT_DAILY_LIMIT),
        # Keyword lists are tiny; the cap bounds spend per call.
        "MAX_OUTPUT_TOKENS": _int_env(
            "GEMINI_MAX_OUTPUT_TOKENS", GEMINI_DEFAULT_MAX_OUTPUT_TOKENS,
            ceiling=GEMINI_MAX_OUTPUT_TOKENS_CEILING),
    }
    return cfg


def _gemini_ready(cfg):
    # Both required settings must be present; everything else has a safe
    # default. Anything missing keeps the feature off (503).
    return bool(cfg["ENABLED"] and cfg["API_KEY"])


def _gemini_url(cfg):
    """Native generateContent endpoint for the configured model. The API key
    is NEVER placed in the URL — it rides in the x-goog-api-key header."""
    return "%s/%s:generateContent" % (GEMINI_API_BASE, cfg["MODEL"])


# ---- per-user daily limit (persistent) --------------------------------------

def _consume_daily_quota(email, limit, amount):
    """Count `amount` PROVIDER CALLS against the user's daily quota (a
    chunked manuscript costs one unit per chunk, so multi-call requests
    cannot bypass the intended cost limit). Returns True when allowed; a
    rejected request is compensated back so it does not burn quota. Only
    email/day/count are ever stored — no request content."""
    from project.models import AssistUsage
    day = datetime.utcnow().strftime("%Y-%m-%d")
    AssistUsage.objects(email=email, day=day).update_one(
        inc__count=amount, upsert=True)
    usage = AssistUsage.objects(email=email, day=day).first()
    if usage is not None and usage.count <= limit:
        return True
    AssistUsage.objects(email=email, day=day).update_one(inc__count=-amount)
    return False


# ---- provider call -----------------------------------------------------------

# One outer Markdown fence is tolerated: models sometimes wrap structured
# output even when application/json was requested.
_JSON_FENCE_RE = re.compile(r"^```(?:json)?\s*(.*?)\s*```$", re.DOTALL)

# Candidate terminations that mean "the model refused / was cut off", as
# opposed to a normal STOP with a payload.
_BLOCKING_FINISH_REASONS = {
    "SAFETY", "BLOCKLIST", "PROHIBITED_CONTENT", "SPII", "RECITATION",
}


def _answer_text_from_parts(parts):
    """Concatenate ONLY the answer text of a candidate.

    Gemini 3.x thinking models may emit reasoning parts before the answer:
    parts flagged `thought: true`, and parts carrying only a
    `thoughtSignature`. Those are never part of the structured answer — glueing
    them in front of the JSON is exactly what broke parsing — so they are
    skipped here and never returned, logged, or surfaced.
    """
    chunks = []
    for part in parts or []:
        if not isinstance(part, dict):
            continue
        if part.get("thought"):
            continue
        text = part.get("text")
        if isinstance(text, str) and text.strip():
            chunks.append(text)
    return "".join(chunks).strip()


def call_gemini(cfg, payload, system_prompt, schema, max_output_tokens=None):
    """ONE native Gemini generateContent call — no SDK, no retry (a retried
    paid call is accidental spend), no tools/grounding/search/URL-context/
    code-execution/file uploads, and no OAuth. Structured output is requested
    with a narrow JSON schema and a hard output-token cap. Returns
    (answer_text, None) or (None, error_message); the API key, request headers,
    prompt and provider body never leave this function.

    This is the single provider transport: every AI-assisted feature reuses it
    so the configuration, quota, hardening and error vocabulary stay in one
    place. Callers supply their own system prompt and response schema and
    parse the returned answer text themselves."""
    try:
        response = requests.post(
            _gemini_url(cfg),
            headers={
                # Header auth only: never a ?key= query string, which would
                # leak the credential into proxy/access logs.
                "x-goog-api-key": cfg["API_KEY"],
                "Content-Type": "application/json",
            },
            json={
                "system_instruction": {
                    "parts": [{"text": system_prompt}],
                },
                # The manuscript-derived data rides as a JSON string so it
                # stays data, not conversational instructions.
                "contents": [{
                    "role": "user",
                    "parts": [{"text": json.dumps(payload,
                                                  ensure_ascii=False)}],
                }],
                "generationConfig": {
                    "responseMimeType": "application/json",
                    "responseSchema": schema,
                    "maxOutputTokens": max_output_tokens
                    or cfg["MAX_OUTPUT_TOKENS"],
                    # Keyword extraction needs no deliberation, and thinking
                    # tokens share the output budget — minimal keeps the
                    # answer inside the cap. Thought summaries stay OFF.
                    "thinkingConfig": {"thinkingLevel": "minimal"},
                    # No temperature/top_p/top_k: deprecated for this model
                    # generation, and defaults are fine for keywording.
                },
            },
            timeout=cfg["TIMEOUT"],
        )
    except Exception as e:
        print("AI assist provider unreachable: %s" % type(e).__name__)
        return None, "The AI suggestion service could not be reached."
    if response.status_code == 429:
        print("AI assist provider rate limited")
        return None, ("The AI suggestion service is rate limited right now, "
                      "please try again later.")
    if response.status_code != 200:
        print("AI assist provider error: HTTP %s" % response.status_code)
        return None, "The AI suggestion service returned an error."
    try:
        data = response.json()
        if not isinstance(data, dict):
            raise ValueError("body is not an object")
    except Exception as e:
        print("AI assist response unparseable envelope: %s" % type(e).__name__)
        return None, "The AI suggestion service returned an unreadable answer."

    # Sanitized diagnostics only: shapes and category labels, never response
    # text, prompt text, manuscript content, or credentials.
    feedback = data.get("promptFeedback") or {}
    block_reason = feedback.get("blockReason")
    candidates = data.get("candidates") or []
    first = candidates[0] if candidates and isinstance(candidates[0], dict) \
        else {}
    finish_reason = first.get("finishReason")
    parts = (first.get("content") or {}).get("parts") or []
    answer_text = _answer_text_from_parts(parts)
    print("AI assist response: status=%s candidates=%d finish=%s block=%s "
          "answer_part=%s"
          % (response.status_code, len(candidates), finish_reason or "-",
             block_reason or "-", bool(answer_text)))

    # 1. The prompt itself was blocked upstream.
    if block_reason:
        return None, ("The AI suggestion service declined this request. Try "
                      "again with different text.")
    # 2. Nothing usable came back (no candidate at all).
    if not candidates:
        return None, "The AI suggestion service did not return suggestions."
    # 3. The candidate was terminated by a safety/policy rule.
    if finish_reason and str(finish_reason).upper() in _BLOCKING_FINISH_REASONS:
        return None, ("The AI suggestion service declined this request. Try "
                      "again with different text.")
    # 4. A candidate exists but carries no answer text (e.g. the output budget
    #    was spent before the answer, or only reasoning parts came back).
    if not answer_text:
        return None, "The AI suggestion service did not return suggestions."
    return answer_text, None


def _normalize_keywords(candidates):
    """Trim, bound, deduplicate (case-insensitive, first spelling wins) and
    cap the aggregated suggestions."""
    seen = set()
    result = []
    for candidate in candidates:
        keyword = re.sub(r"\s+", " ", str(candidate or "")).strip(" .,;:\"'")
        if not (2 <= len(keyword) <= 60):
            continue
        key = keyword.lower()
        if key in seen:
            continue
        seen.add(key)
        result.append(keyword)
        if len(result) >= MAX_SUGGESTIONS:
            break
    return result
