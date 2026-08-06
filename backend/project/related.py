"""Related Research: what else in the literature bears on this record.

One read-only endpoint (wired through swagger.yml):
- GET /api/paper/{id}/related

It answers with two independent lists:

* **Related Qresp Records** -- computed here, from the published scientific
  metadata of the active records this server holds. No external service is
  involved and no configuration is required.
* **Related External Papers** -- candidates proposed by the free Semantic
  Scholar Recommendations API, then judged by Qresp's own quality gate. Being
  returned by the provider is NOT a reason to show a paper; the provider's
  ranking is deliberately ignored.

No language model is involved anywhere in this feature. Every ordering,
threshold and "Why related" sentence comes from `project/relatedness.py`,
which is pure and unit-tested.

Nothing here writes to a Paper. Recommendations are a derived view, so they
are never pinned into the canonical record: they are recomputed (internal) or
cached separately with an expiry (external, `RelatedResearchCache`), which is
what lets a new follow-up study show up on a record published years ago.

Configuration is ENVIRONMENT ONLY (QRESP_RELATED_RESEARCH_*,
QRESP_SEMANTIC_SCHOLAR_*), deliberately not `Config.get_setting`: that helper
falls back to config.ini, and neither the credential nor the switch for an
external call should be configurable (or accidentally committed) there. The
feature is OFF by default.

What leaves this server
-----------------------
Only what is needed to identify THIS paper to the provider: its DOI, or --
when it has none -- its published title. Nothing else: no abstract, no
authors, no keywords, no RCC URL, no file path, no file content, no owner,
editor, curator or session data, and no other record. The provider host is a
fixed HTTPS constant in this file; no environment variable or request
parameter can redirect it. The API key, when configured, travels only in the
`x-api-key` header and is never logged, cached, or returned.
"""
import os
import re
from datetime import datetime, timedelta
from urllib.parse import quote

import requests

from project.auth import can_edit_paper, get_current_user
from project.models import Paper, RelatedResearchCache, active_papers
from project.relatedness import (CorpusStats, build_external_profile,
                                 build_internal_profile, normalize_doi,
                                 normalize_title_key, rank, tokenize)

# ---------------------------------------------------------------- provider
#
# FIXED in code. The host is not read from the environment, from config.ini,
# or from the request, so no misconfiguration can point a lookup -- or the API
# key -- at another server. Only the credential and the timeout are settable.
SEMANTIC_SCHOLAR_ORIGIN = "https://api.semanticscholar.org"
SEMANTIC_SCHOLAR_PAPER_URL = SEMANTIC_SCHOLAR_ORIGIN + "/graph/v1/paper/"
SEMANTIC_SCHOLAR_TITLE_MATCH_URL = (
    SEMANTIC_SCHOLAR_ORIGIN + "/graph/v1/paper/search/match")
SEMANTIC_SCHOLAR_RECOMMENDATIONS_URL = (
    SEMANTIC_SCHOLAR_ORIGIN + "/recommendations/v1/papers/forpaper/")
PROVIDER_NAME = "Semantic Scholar"
PROVIDER_KEY = "semantic_scholar"

# Identifies Qresp politely, exactly as the DOI importer does.
PROVIDER_HEADERS = {"User-Agent": "Qresp/2.0 (research data curation)"}

# The MINIMUM metadata the quality gate needs to judge a candidate:
# title/abstract for text similarity and shared terms, authors for the shared
# author signal, year for display and ordering, externalIds for the DOI link
# and for de-duplication, fieldsOfStudy for the "same research area" check.
# Nothing else is requested -- no venue, no citation counts, no embeddings,
# no open-access PDFs.
RECOMMENDATION_FIELDS = "title,abstract,year,authors.name,externalIds,fieldsOfStudy"
# Resolution asks for the paper's identity only, plus the DOIs of what it
# cites, which is the one strong-evidence signal Qresp cannot compute itself.
RESOLUTION_FIELDS_WITH_REFERENCES = "paperId,title,externalIds,references.externalIds"
RESOLUTION_FIELDS = "paperId,title,externalIds"

# Candidates asked of the provider, before Qresp's gate removes most of them.
EXTERNAL_CANDIDATE_LIMIT = 20
# Shown to the user, per list. The lists are never padded to reach it.
MAX_RESULTS = 5

# A title lookup must be an unambiguous match on the paper Qresp holds; below
# this the external list is skipped entirely rather than risk recommending
# from somebody else's paper.
TITLE_MATCH_MIN_OVERLAP = 0.9

DEFAULT_TIMEOUT_SECONDS = 8
MAX_TIMEOUT_SECONDS = 30
DEFAULT_CACHE_DAYS = 7
MAX_CACHE_DAYS = 90
# A provider failure is usually transient, so it is remembered only briefly --
# long enough to stop a hot detail page from hammering a failing (or
# rate-limiting) service, short enough that recovery is quick.
FAILURE_RETRY_SECONDS = 3600

# Response statuses for the external list.
STATUS_OK = "ok"
STATUS_DISABLED = "disabled"
STATUS_UNRESOLVED = "unresolved"
STATUS_UNAVAILABLE = "unavailable"


# ------------------------------------------------------------ configuration

def _truthy(value):
    return str(value or "").strip().lower() in ("1", "true", "yes", "on")


def _env(key):
    # ENVIRONMENT ONLY -- see the module docstring.
    return os.environ.get("QRESP_" + key)


def _int_env(key, default, ceiling):
    try:
        value = int(str(_env(key)).strip())
    except (TypeError, ValueError):
        return default
    if value <= 0:
        return default
    return min(value, ceiling)


def config():
    """Effective configuration. Read per request so a deployment can flip the
    feature without a restart, and so tests can patch the environment."""
    return {
        "ENABLED": _truthy(_env("RELATED_RESEARCH_ENABLED")),
        # Optional. Semantic Scholar serves this API without a key at a lower
        # rate limit; a key raises it. Its absence must never break the page,
        # and never disables the internal list.
        "API_KEY": (_env("SEMANTIC_SCHOLAR_API_KEY") or "").strip(),
        "TIMEOUT": _int_env("SEMANTIC_SCHOLAR_TIMEOUT_SECONDS",
                            DEFAULT_TIMEOUT_SECONDS, MAX_TIMEOUT_SECONDS),
        "CACHE_DAYS": _int_env("RELATED_RESEARCH_CACHE_DAYS",
                               DEFAULT_CACHE_DAYS, MAX_CACHE_DAYS),
    }


def _provider_headers(cfg):
    """Request headers. The credential is sent ONLY as `x-api-key`, and only
    when one is configured -- never in a query string, a URL, or a body, where
    it would land in an access log."""
    headers = dict(PROVIDER_HEADERS)
    if cfg["API_KEY"]:
        headers["x-api-key"] = cfg["API_KEY"]
    return headers


# ------------------------------------------------------------- provider I/O

def _get(url, cfg, params=None):
    """One bounded GET. Returns the decoded body, or None for any failure --
    timeout, connection error, 404, 429, 5xx, or an unreadable body. Provider
    error bodies and headers are never returned or logged; only the failure
    kind and status code are, so a key can never reach a log line."""
    try:
        response = requests.get(url, params=params or {},
                                headers=_provider_headers(cfg),
                                timeout=cfg["TIMEOUT"])
    except Exception as e:
        print("Related research provider unreachable: %s" % type(e).__name__)
        return None
    if response.status_code != 200:
        print("Related research provider error: HTTP %s"
              % response.status_code)
        return None
    try:
        payload = response.json()
    except Exception:
        print("Related research provider returned an unreadable response")
        return None
    if not isinstance(payload, (dict, list)):
        print("Related research provider returned an unexpected shape")
        return None
    return payload


def _title_overlap(left, right):
    """Token overlap of two titles, 0..1. Used to refuse a title lookup that
    landed on a different paper."""
    left_tokens = set(tokenize(left))
    right_tokens = set(tokenize(right))
    if not left_tokens or not right_tokens:
        return 0.0
    return len(left_tokens & right_tokens) / float(
        max(len(left_tokens), len(right_tokens)))


def resolve_provider_paper(title, doi, cfg):
    """Identify THIS paper at the provider.

    DOI first: a DOI is exact, so `DOI:<doi>` needs no confirmation. Without
    one, the provider's official title-match endpoint is used and the answer
    is checked against the stored title here -- an approximate match is
    treated as "not found", because recommendations for the wrong paper are
    worse than none.

    Returns (paper_id, cited_dois) or (None, frozenset()).
    """
    if doi:
        # The slash stays literal: a DOI is written `DOI:10.1000/xyz` in the
        # path, and percent-encoding it (`%2F`) is not what the provider --
        # or an intermediate proxy -- routes on.
        payload = _get(SEMANTIC_SCHOLAR_PAPER_URL + "DOI:" + quote(doi, safe="/"),
                       cfg, {"fields": RESOLUTION_FIELDS_WITH_REFERENCES})
        if not isinstance(payload, dict) or not payload.get("paperId"):
            return None, frozenset()
        return str(payload["paperId"]), _cited_dois(payload)

    if not title:
        return None, frozenset()

    payload = _get(SEMANTIC_SCHOLAR_TITLE_MATCH_URL, cfg,
                   {"query": title, "fields": RESOLUTION_FIELDS})
    matches = (payload or {}).get("data") if isinstance(payload, dict) else None
    if not matches:
        return None, frozenset()
    match = matches[0] or {}
    if not match.get("paperId"):
        return None, frozenset()
    if _title_overlap(title, match.get("title")) < TITLE_MATCH_MIN_OVERLAP:
        # Confidently wrong is worse than silent: skip the external list.
        return None, frozenset()
    return str(match["paperId"]), frozenset()


def _cited_dois(payload):
    """DOIs of the works this paper cites, as far as the provider reports
    them. Used only for the 'directly cited' strong evidence; never inferred
    when absent."""
    dois = set()
    for reference in payload.get("references") or []:
        doi = normalize_doi(((reference or {}).get("externalIds")
                             or {}).get("DOI"))
        if doi:
            dois.add(doi)
    return frozenset(dois)


def _normalize_candidate(raw):
    """Provider result -> the plain dict `build_external_profile` reads.
    Everything else in the payload, including its position in the list, is
    dropped here."""
    if not isinstance(raw, dict):
        return None
    title = re.sub(r"\s+", " ", str(raw.get("title") or "")).strip()
    if not title:
        return None
    doi = normalize_doi((raw.get("externalIds") or {}).get("DOI"))
    year = raw.get("year")
    try:
        year = int(year) if year is not None else None
    except (TypeError, ValueError):
        year = None
    paper_id = str(raw.get("paperId") or "").strip()
    # An HTTPS DOI link is preferred; the provider's own page is the fallback
    # for the (rare) candidate that has no DOI at all.
    if doi:
        url = "https://doi.org/%s" % doi
    elif paper_id:
        url = "https://www.semanticscholar.org/paper/%s" % paper_id
    else:
        url = ""
    return {
        "key": paper_id or doi or title,
        "title": title,
        "abstract": str(raw.get("abstract") or ""),
        "year": year,
        "doi": doi,
        "url": url,
        "authors": [str((a or {}).get("name") or "").strip()
                    for a in (raw.get("authors") or [])
                    if str((a or {}).get("name") or "").strip()],
        "fields": [str(f).strip() for f in (raw.get("fieldsOfStudy") or [])
                   if str(f or "").strip()],
    }


def fetch_external_candidates(paper_id, cfg):
    """At most EXTERNAL_CANDIDATE_LIMIT recommendations for `paper_id`.
    Returns None when the provider could not be used at all (so the caller can
    tell "provider failed" from "provider had nothing")."""
    payload = _get(SEMANTIC_SCHOLAR_RECOMMENDATIONS_URL + quote(paper_id, safe=""),
                   cfg, {"fields": RECOMMENDATION_FIELDS,
                         "limit": EXTERNAL_CANDIDATE_LIMIT})
    if payload is None:
        return None
    raw = payload.get("recommendedPapers") if isinstance(payload, dict) else None
    if raw is None:
        return None
    candidates = []
    for item in raw[:EXTERNAL_CANDIDATE_LIMIT]:
        candidate = _normalize_candidate(item)
        if candidate:
            candidates.append(candidate)
    return candidates


def dedupe_candidates(candidates, current_doi, current_title):
    """Drop the paper itself, repeats, and anything unusable.

    Removed: results with no title, the current paper (by DOI or by title),
    a DOI already seen, and a title already seen. Order is preserved so the
    de-duplication is deterministic and testable.
    """
    current_doi = normalize_doi(current_doi)
    current_title_key = normalize_title_key(current_title)
    seen_dois = set()
    seen_titles = set()
    kept = []
    for candidate in candidates or []:
        title = (candidate.get("title") or "").strip()
        if not title:
            continue
        doi = normalize_doi(candidate.get("doi"))
        title_key = normalize_title_key(title)
        if current_doi and doi and doi == current_doi:
            continue
        if current_title_key and title_key == current_title_key:
            continue
        if doi and doi in seen_dois:
            continue
        if title_key and title_key in seen_titles:
            continue
        if doi:
            seen_dois.add(doi)
        if title_key:
            seen_titles.add(title_key)
        kept.append(candidate)
    return kept


# -------------------------------------------------------------------- cache

def _utcnow():
    return datetime.utcnow()


def _load_cache(paper_id):
    try:
        return RelatedResearchCache.objects(paper_id=str(paper_id)).first()
    except Exception as e:  # a cache problem must never break the page
        print("Related research cache read failed: %s" % type(e).__name__)
        return None


def _store_cache(paper_id, status, results, cfg, previous=None):
    """Persist the external outcome. Only gate-passing public bibliographic
    metadata and the reasons Qresp computed are written -- never the API key,
    a request header, a provider error body, or anything about the user."""
    now = _utcnow()
    if status == STATUS_OK:
        expires_at = now + timedelta(days=cfg["CACHE_DAYS"])
        last_success_at = now
        stored = results
    elif status == STATUS_UNRESOLVED:
        # Not being in the provider's index is a stable fact, not a blip.
        expires_at = now + timedelta(days=cfg["CACHE_DAYS"])
        last_success_at = previous.last_success_at if previous else None
        stored = list(previous.results) if previous else []
    else:
        expires_at = now + timedelta(seconds=FAILURE_RETRY_SECONDS)
        last_success_at = previous.last_success_at if previous else None
        stored = list(previous.results) if previous else []
    try:
        RelatedResearchCache.objects(paper_id=str(paper_id)).update_one(
            set__provider=PROVIDER_KEY,
            set__status=status,
            set__results=stored,
            set__fetched_at=now,
            set__last_success_at=last_success_at,
            set__expires_at=expires_at,
            upsert=True)
    except Exception as e:
        print("Related research cache write failed: %s" % type(e).__name__)
    return stored


# ------------------------------------------------------- recommendation core

def _display_authors(names, limit=8):
    names = [n for n in names or [] if n]
    if len(names) > limit:
        return ", ".join(names[:limit]) + " et al."
    return ", ".join(names)


def _result(profile, assessment, source):
    return {
        "id": profile.key if source == "internal" else None,
        "title": profile.title,
        "authors": _display_authors(profile.authors),
        "year": profile.year,
        "doi": profile.doi or None,
        "url": profile.url or None,
        "source": source,
        "reasons": assessment.reasons(3),
    }


def internal_recommendations(current_record, corpus_records,
                             citation_dois=frozenset()):
    """Related Qresp Records for `current_record`.

    `corpus_records` are the active/published records (the current one
    included, so corpus rarity is measured over everything this server
    holds). The current record is never recommended to itself.
    """
    current = build_internal_profile(current_record)
    profiles = [build_internal_profile(record) for record in corpus_records]
    stats = CorpusStats(profiles)
    candidates = [p for p in profiles if p.key and p.key != current.key]
    ranked = rank(current, candidates, stats, citation_dois, MAX_RESULTS)
    return [_result(profile, assessment, "internal")
            for profile, assessment in ranked], stats


def external_recommendations(current_record, candidates, stats,
                             citation_dois=frozenset()):
    """Apply Qresp's own gate to the provider's candidates.

    The provider's ordering is discarded: candidates are re-ranked by the
    evidence Qresp can name, and the ones that clear the gate are the only
    ones returned. Rarity is still measured against the Qresp corpus, so
    "specific" means the same thing in both lists.
    """
    current = build_internal_profile(current_record)
    profiles = [build_external_profile(candidate) for candidate in candidates]
    ranked = rank(current, profiles, stats, citation_dois, MAX_RESULTS)
    return [_result(profile, assessment, "external")
            for profile, assessment in ranked]


# ----------------------------------------------------------------- endpoint

def _record_dict(paper):
    data = paper.to_mongo().to_dict()
    data["_id"] = str(paper.id)
    return data


def _external_section(status, results, stale=False, updated_at=None):
    return {
        "status": status,
        "provider": PROVIDER_NAME,
        "results": results,
        "count": len(results),
        "stale": bool(stale),
        "updated_at": updated_at.isoformat() if updated_at else None,
    }


def _external_for(paper_id, current_record, stats, cfg):
    """The external list, honouring the cache.

    A cache entry that has not expired is returned as-is and the provider is
    NOT called. An expired entry is refreshed; if the refresh fails, the last
    successful results are returned marked `stale` so the section degrades
    instead of emptying.
    """
    entry = _load_cache(paper_id)
    now = _utcnow()
    if entry and entry.expires_at and entry.expires_at > now:
        return _external_section(entry.status or STATUS_OK,
                                 list(entry.results or []),
                                 stale=False,
                                 updated_at=entry.last_success_at)

    reference = current_record.get("reference") or {}
    doi = normalize_doi(reference.get("DOI"))
    title = str(reference.get("title") or "").strip()

    provider_paper_id, citation_dois = resolve_provider_paper(title, doi, cfg)
    if not provider_paper_id:
        stored = _store_cache(paper_id, STATUS_UNRESOLVED, [], cfg, entry)
        return _external_section(
            STATUS_UNRESOLVED, list(stored),
            stale=bool(stored),
            updated_at=entry.last_success_at if entry else None)

    candidates = fetch_external_candidates(provider_paper_id, cfg)
    if candidates is None:
        stored = _store_cache(paper_id, STATUS_UNAVAILABLE, [], cfg, entry)
        return _external_section(
            STATUS_UNAVAILABLE, list(stored),
            stale=bool(stored),
            updated_at=entry.last_success_at if entry else None)

    candidates = dedupe_candidates(candidates, doi, title)
    results = external_recommendations(current_record, candidates, stats,
                                       citation_dois)
    _store_cache(paper_id, STATUS_OK, results, cfg, entry)
    return _external_section(STATUS_OK, results, stale=False, updated_at=now)


def related_research(id):
    """
    Related Qresp records and related external papers for one record
    Handler for GET: /api/paper/{id}/related

    Read-only: it never changes a Paper, a draft, an ownership field, a
    publication state, or any curation state. The only write it can make is to
    the separate `related_research_cache` collection.
    """
    if not config()["ENABLED"]:
        # Off by default. A 200 with empty sections keeps the detail page
        # rendering exactly as it did before the feature existed.
        return {
            "paper_id": str(id),
            "enabled": False,
            "internal": {"status": STATUS_DISABLED, "results": [], "count": 0},
            "external": _external_section(STATUS_DISABLED, []),
        }, 200

    unavailable = {"error": "This record is not available."}
    try:
        paper = Paper.objects.get(id=str(id))
    except Exception:
        # Same answer for "no such record" and "hidden record": a related
        # lookup must not become an existence probe.
        return unavailable, 404
    if paper.is_active is False:
        allowed, _ = can_edit_paper(paper, get_current_user())
        if not allowed:
            return unavailable, 404

    cfg = config()
    current_record = _record_dict(paper)
    corpus = [_record_dict(record) for record in active_papers()]
    if all(record.get("_id") != current_record["_id"] for record in corpus):
        # A deactivated record its owner is allowed to see: score it against
        # the public corpus without adding it to that corpus.
        corpus = corpus + [current_record]

    internal_results, stats = internal_recommendations(current_record, corpus)

    try:
        external = _external_for(str(paper.id), current_record, stats, cfg)
    except Exception as e:
        # A provider or cache problem degrades this one section; it never
        # becomes a 500 for a page that has perfectly good internal results.
        print("Related research external section failed: %s" % type(e).__name__)
        external = _external_section(STATUS_UNAVAILABLE, [])

    return {
        "paper_id": str(paper.id),
        "enabled": True,
        "internal": {
            "status": STATUS_OK,
            "results": internal_results,
            "count": len(internal_results),
        },
        "external": external,
    }, 200
