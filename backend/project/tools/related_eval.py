"""Related Research domain-quality evaluation — a read-only QA command line.

    python -m project.tools.related_eval collect   --api-base URL ...
    python -m project.tools.related_eval summarize --output-dir DIR

WHY this exists
---------------
The quality gate was calibrated by reasoning, and the one thing nobody has
measured is whether it agrees with a physicist. Its own accept/reject decision
therefore cannot be the answer key. This tool lays the gate's verdicts out
next to the candidates it threw away, so a person can rate them and the gate
can be judged against those ratings -- including the failure that matters
most, a genuinely related paper the gate rejected.

WHAT IT WILL NOT DO
-------------------
* It never writes to Qresp: no Paper, no Draft, no cache, no MongoDB. It
  speaks only to the public read APIs (`/api/search`, `/api/paper/{id}`).
* It never calls `/api/paper/{id}/related`, so the production cache and the
  provider quota behind it are untouched.
* It performs NO external network request unless `--live` is given.
* It never fills a human rating in. `human_rating` is written empty and only
  a person may change it; every metric excludes unrated rows and reports how
  many there were.
* It never emits curator identity, owner/editor fields, RCC URLs, file-server
  paths, file or image names, the API key, or any request header. The
  allowlist that guarantees this is `eval_core.to_canonical_record` and
  `eval_core.CANDIDATE_KEYS`.

The scoring is not reimplemented. Candidate fetching comes from
`project.related`, profiles and the gate from `project.relatedness`.
"""
import argparse
import io
import json
import os
import sys
import time

from project import related
from project import relatedness as R
from project.tools import eval_core as core

# Candidate pools compared side by side. `default` is what production asks
# for; the other two exist to answer "is the gate discarding good candidates,
# or is the provider never offering any?".
POOL_DEFAULT = "recommendations_default"
POOL_ALL_CS = "recommendations_all_cs"
POOL_TITLE = "title_resolution"
EXTERNAL_POOLS = (POOL_DEFAULT, POOL_ALL_CS, POOL_TITLE)
SOURCE_INTERNAL = "internal"

DEFAULT_RATE_LIMIT = 1.0        # requests per second, provider-wide
DEFAULT_MAX_RETRIES = 3
MAX_RETRY_SLEEP = 60


# --------------------------------------------------------------- HTTP client

class PolitesClient(object):
    """A `requests`-shaped object with a rate limit and 429 handling.

    Installed over `project.related.requests` for the duration of a run, which
    is the same seam the unit tests use. Keeping the retry policy HERE rather
    than in `related._get` matters: serving traffic must fail fast and fall
    back to cache, while a QA sweep can afford to wait.
    """

    def __init__(self, session, rate_limit=DEFAULT_RATE_LIMIT,
                 max_retries=DEFAULT_MAX_RETRIES, sleep=time.sleep,
                 clock=time.monotonic):
        self._session = session
        self._min_interval = 1.0 / rate_limit if rate_limit > 0 else 0.0
        self._max_retries = max_retries
        self._sleep = sleep
        self._clock = clock
        self._last_call = None
        self.calls = 0
        self.retries = 0
        self.rate_limited = 0

    def _wait_turn(self):
        if self._min_interval <= 0 or self._last_call is None:
            return
        elapsed = self._clock() - self._last_call
        if elapsed < self._min_interval:
            self._sleep(self._min_interval - elapsed)

    @staticmethod
    def _retry_after(response):
        raw = ""
        headers = getattr(response, "headers", None) or {}
        try:
            raw = headers.get("Retry-After") or ""
        except AttributeError:
            raw = ""
        try:
            seconds = int(str(raw).strip())
        except (TypeError, ValueError):
            return None
        return max(0, min(seconds, MAX_RETRY_SLEEP))

    def get(self, url, params=None, headers=None, timeout=None):
        attempt = 0
        while True:
            self._wait_turn()
            self._last_call = self._clock()
            self.calls += 1
            response = self._session.get(url, params=params, headers=headers,
                                         timeout=timeout)
            if getattr(response, "status_code", None) != 429:
                return response
            self.rate_limited += 1
            if attempt >= self._max_retries:
                # Hand the 429 back and let the production code classify it as
                # the non-answer it is.
                return response
            wait = self._retry_after(response)
            if wait is None:
                wait = min(2 ** attempt, MAX_RETRY_SLEEP)
            attempt += 1
            self.retries += 1
            self._sleep(wait)


class OfflineClient(object):
    """Refuses every request. Installed when --live is absent so an external
    call cannot happen by accident."""

    def __init__(self):
        self.calls = 0
        self.retries = 0
        self.rate_limited = 0

    def get(self, *args, **kwargs):
        raise RuntimeError(
            "external request attempted without --live; this is a bug")


# ------------------------------------------------------------- Qresp reading

class QrespReader(object):
    """Public, read-only access to a Qresp instance."""

    def __init__(self, api_base, session, timeout=20, verify=True):
        self.api_base = api_base.rstrip("/")
        self._session = session
        self._timeout = timeout
        self._verify = verify

    def _get(self, path, params=None):
        url = "%s%s" % (self.api_base, path)
        response = self._session.get(url, params=params or {},
                                     timeout=self._timeout,
                                     verify=self._verify)
        if response.status_code != 200:
            raise RuntimeError("GET %s answered HTTP %s"
                               % (path, response.status_code))
        return response.json()

    def search(self):
        payload = self._get("/api/search")
        return payload if isinstance(payload, list) else []

    def details(self, record_id):
        try:
            payload = self._get("/api/paper/%s" % record_id)
        except Exception as e:
            print("  ! details unavailable for %s: %s"
                  % (record_id, type(e).__name__))
            return {}
        return payload if isinstance(payload, dict) else {}


# ----------------------------------------------------------------- collecting

def _provider_paper_id(candidate):
    """`_normalize_candidate` puts the provider's own id in `key` (falling
    back to the DOI or the title when it has none)."""
    return candidate.get("key") or None


def _evaluate_candidates(current_record, candidates, stats, source):
    """Score every candidate and mark which ones production would show.

    Every candidate is kept, accepted or not: the rejected ones are the
    evidence for the false-negative question.
    """
    profiles = [(candidate, R.build_external_profile(candidate))
                for candidate in candidates]
    current = R.build_internal_profile(current_record)
    shown = {profile.key for profile, _ in R.rank(
        current, [profile for _, profile in profiles], stats,
        frozenset(), related.MAX_RESULTS)}

    rows = []
    for rank_index, (candidate, profile) in enumerate(profiles):
        assessment = R.assess(current, profile, stats)
        rows.append(core.candidate_row(
            source, rank_index, profile, assessment,
            in_top5=profile.key in shown,
            provider_paper_id=_provider_paper_id(candidate)))
    return rows


def _external_pools(current_record, normalized, stats, cfg, live):
    """Collect each pool separately, preserving the raw (pre-gate) candidates.

    Returns (pools, outcomes).
    """
    pools = {pool: [] for pool in EXTERNAL_POOLS}
    outcomes = {}
    if not live:
        for pool in EXTERNAL_POOLS:
            outcomes[pool] = "skipped_no_live"
        return pools, outcomes

    doi = R.normalize_doi(normalized.get("doi"))
    title = normalized.get("title") or ""

    resolutions = {}
    if doi:
        paper_id, outcome = related.resolve_provider_paper(title, doi, cfg)
        resolutions["doi"] = (paper_id, outcome)
    else:
        resolutions["doi"] = (None, "skipped_no_doi")
    # The title path is exercised on purpose even when a DOI exists: it is a
    # separate safety claim (a match must be close enough to trust) and it
    # deserves its own measurement.
    paper_id, outcome = related.resolve_provider_paper(title, None, cfg)
    resolutions["title"] = (paper_id, outcome)
    outcomes["resolution_doi"] = resolutions["doi"][1]
    outcomes["resolution_title"] = resolutions["title"][1]

    plan = (
        (POOL_DEFAULT, resolutions["doi"][0] or resolutions["title"][0], None),
        (POOL_ALL_CS, resolutions["doi"][0] or resolutions["title"][0],
         "all-cs"),
        (POOL_TITLE, resolutions["title"][0], None),
    )
    for pool, provider_id, pool_param in plan:
        if not provider_id:
            outcomes[pool] = "unresolved"
            continue
        candidates, outcome = related.fetch_external_candidates(
            provider_id, cfg, pool=pool_param)
        outcomes[pool] = outcome
        if outcome != related.FOUND or not candidates:
            continue
        candidates = related.dedupe_candidates(candidates, doi, title)
        pools[pool] = _evaluate_candidates(current_record, candidates, stats,
                                           pool)
    return pools, outcomes


def _internal_rows(entry, corpus_entries, stats):
    """Related Qresp Records for one record, with the rejected ones kept.

    Reuses the production ranking for the top five, then explains every other
    corpus record's verdict so a short list can be understood rather than
    merely observed.
    """
    current = R.build_internal_profile(entry["record"])
    others = [(other, R.build_internal_profile(other["record"]))
              for other in corpus_entries
              if other["normalized"]["id"] != entry["normalized"]["id"]]
    shown = {profile.key for profile, _ in R.rank(
        current, [profile for _, profile in others], stats, frozenset(),
        related.MAX_RESULTS)}

    rows = []
    for rank_index, (other, profile) in enumerate(others):
        assessment = R.assess(current, profile, stats)
        row = core.candidate_row(SOURCE_INTERNAL, rank_index, profile,
                                 assessment, in_top5=profile.key in shown)
        row["provider_paper_id"] = None
        rows.append(row)
    rows.sort(key=lambda r: (-r["gate_score"], r["title"]))
    return rows


def collect(args):
    import requests

    session = requests.Session()
    reader = QrespReader(args.api_base, session, timeout=args.timeout,
                         verify=not args.insecure)

    print("Reading records from %s" % reader.api_base)
    try:
        search_records = reader.search()
    except Exception as e:
        print("Could not read /api/search: %s" % type(e).__name__)
        return 2
    print("  %d records visible" % len(search_records))

    if args.ids_file:
        wanted = _read_ids(args.ids_file)
        search_records = [r for r in search_records
                          if core.normalize_search_record(r)["id"] in wanted]
        missing = wanted - {core.normalize_search_record(r)["id"]
                            for r in search_records}
        if missing:
            print("  ! %d requested id(s) are not publicly visible"
                  % len(missing))
        chosen, skipped = core.select_sample(
            search_records, None, include_flagged=True)
    else:
        chosen, skipped = core.select_sample(
            search_records, args.sample_size,
            include_flagged=args.include_flagged)

    if not chosen:
        print("No usable records were selected.")
        return 1
    print("  %d selected, %d set aside" % (len(chosen), len(skipped)))

    # Artifact metadata lives on the details endpoint, not the search
    # projection; without it tools/datasets/charts cannot contribute.
    for entry in chosen:
        details = reader.details(entry["normalized"]["id"])
        canonical, normalized = core.to_canonical_record(
            entry["normalized"], details)
        entry["record"] = canonical
        entry["normalized"] = normalized

    # Corpus rarity must be measured over EVERYTHING the instance publishes,
    # not just the sample, or "specific" would mean something different here
    # than it does in production.
    corpus_entries = []
    for raw in search_records:
        canonical, normalized = core.to_canonical_record(raw)
        if normalized["id"]:
            corpus_entries.append({"record": canonical,
                                   "normalized": normalized})
    by_id = {e["normalized"]["id"]: e for e in corpus_entries}
    for entry in chosen:
        by_id[entry["normalized"]["id"]] = entry
    corpus_entries = list(by_id.values())
    stats = R.CorpusStats([R.build_internal_profile(e["record"])
                           for e in corpus_entries])
    print("  corpus for rarity: %d records" % stats.document_count)

    cfg = related.config()
    api_key_present = bool(cfg["API_KEY"])
    print("  Semantic Scholar API key configured: %s" % api_key_present)
    print("  live external calls: %s" % bool(args.live))

    client = (PolitesClient(session, rate_limit=args.rate_limit,
                            max_retries=args.max_retries)
              if args.live else OfflineClient())

    record_rows = []
    original = related.requests
    related.requests = client
    try:
        for index, entry in enumerate(chosen, start=1):
            normalized = entry["normalized"]
            print("  [%d/%d] %s" % (index, len(chosen), normalized["id"]))
            internal = _internal_rows(entry, corpus_entries, stats)
            pools, outcomes = _external_pools(entry["record"], normalized,
                                              stats, cfg, args.live)
            record_rows.append({
                "record_id": normalized["id"],
                "record_title": normalized["title"],
                "record_year": normalized["year"],
                "record_doi": normalized["doi"] or None,
                "status": entry["status"],
                "flags": entry["flags"],
                "internal": internal,
                "external": pools,
                "provider_outcomes": outcomes,
            })
    finally:
        related.requests = original

    _write_outputs(args, record_rows, skipped, api_key_present, client)
    return 0


def _read_ids(path):
    with io.open(path, encoding="utf-8") as handle:
        return {line.strip() for line in handle
                if line.strip() and not line.startswith("#")}


def _write_outputs(args, record_rows, skipped, api_key_present, client):
    output_dir = args.output_dir
    if not os.path.isdir(output_dir):
        os.makedirs(output_dir)

    raw_path = os.path.join(output_dir, "raw-results.jsonl")
    with io.open(raw_path, "w", encoding="utf-8", newline="\n") as handle:
        for record in record_rows:
            handle.write(json.dumps(
                {key: record[key] for key in core.RECORD_KEYS},
                ensure_ascii=False, sort_keys=True) + "\n")

    tsv_path = os.path.join(output_dir, "human-review.tsv")
    rows = core.tsv_rows(record_rows,
                         rejected_per_source=args.review_rejected)
    with io.open(tsv_path, "w", encoding="utf-8", newline="\n") as handle:
        handle.write(core.render_tsv(rows))

    summary = core.collection_summary(
        record_rows, skipped, args.sample_size, args.live, api_key_present)
    summary["provider_requests"] = {
        "calls": client.calls,
        "retries": client.retries,
        "rate_limited": client.rate_limited,
    }
    summary_path = os.path.join(output_dir, "summary.json")
    with io.open(summary_path, "w", encoding="utf-8", newline="\n") as handle:
        handle.write(core.dumps(summary) + "\n")

    print("\nWrote:")
    print("  %s   (%d records)" % (raw_path, len(record_rows)))
    print("  %s   (%d rows to rate)" % (tsv_path, len(rows) - 1))
    print("  %s" % summary_path)
    print("\nNext: fill in human_rating (related | partial | unrelated) in")
    print("%s, then run:" % tsv_path)
    print("  python -m project.tools.related_eval summarize --output-dir %s"
          % output_dir)


# ---------------------------------------------------------------- summarizing

def summarize(args):
    output_dir = args.output_dir
    tsv_path = os.path.join(output_dir, "human-review.tsv")
    raw_path = os.path.join(output_dir, "raw-results.jsonl")
    if not os.path.isfile(tsv_path):
        print("No review file at %s" % tsv_path)
        return 2

    with io.open(tsv_path, encoding="utf-8") as handle:
        rows, errors = core.parse_tsv(handle.read())
    if errors:
        print("The review file could not be read:")
        for error in errors:
            print("  - %s" % error)
        return 2

    top5_keys = set()
    if os.path.isfile(raw_path):
        with io.open(raw_path, encoding="utf-8") as handle:
            for line in handle:
                if not line.strip():
                    continue
                record = json.loads(line)
                candidates = list(record.get("internal") or [])
                for pool in (record.get("external") or {}).values():
                    candidates.extend(pool)
                for candidate in candidates:
                    if candidate.get("in_top5"):
                        top5_keys.add((record["record_id"],
                                       candidate["source"],
                                       candidate["title"]))

    metrics = core.score_ratings(rows, top5_keys)
    metrics_path = os.path.join(output_dir, "metrics.json")
    with io.open(metrics_path, "w", encoding="utf-8", newline="\n") as handle:
        handle.write(core.dumps(metrics) + "\n")

    print("Rated %d of %d rows (%d still unrated, excluded from every metric)"
          % (metrics["rows_rated"], metrics["rows_total"],
             metrics["rows_unrated"]))
    if not metrics["rows_rated"]:
        print("Nothing to measure yet.")
        return 0
    print("precision@5            %.3f  (related only)"
          % metrics["precision_at_5"])
    print("precision@5 lenient    %.3f  (related + partial)"
          % metrics["precision_at_5_lenient"])
    print("false positives        %d  (gate accepted, human said unrelated)"
          % metrics["false_positives"])
    print("false negatives        %d  (gate rejected, human said related or "
          "partial)" % metrics["false_negatives"])
    print("record coverage        %.3f"
          % metrics["record_coverage"]["ratio"])
    for pool in sorted(metrics["pools"]):
        stats = metrics["pools"][pool]
        print("  %-26s rated=%d strict=%.3f lenient=%.3f fp=%d fn=%d"
              % (pool, stats["rated"], stats["precision_strict"],
                 stats["precision_lenient"], stats["false_positives"],
                 stats["false_negatives"]))
    print("\nWrote %s" % metrics_path)
    return 0


# ---------------------------------------------------------------------- CLI

def build_parser():
    parser = argparse.ArgumentParser(
        prog="python -m project.tools.related_eval",
        description="Read-only domain-quality evaluation for Related "
                    "Research. Never writes to Qresp and never rates "
                    "anything itself.")
    sub = parser.add_subparsers(dest="command")

    collect_parser = sub.add_parser(
        "collect", help="gather candidates and write the review files")
    collect_parser.add_argument(
        "--api-base", required=True,
        help="Base URL of the Qresp instance to read, e.g. "
             "https://qresp.example.org. No URL is hardcoded anywhere.")
    group = collect_parser.add_mutually_exclusive_group()
    group.add_argument("--ids-file",
                       help="file of Qresp record ids, one per line")
    group.add_argument("--sample-size", type=int, default=20,
                       help="how many records to sample deterministically "
                            "(default 20)")
    collect_parser.add_argument("--output-dir", required=True)
    collect_parser.add_argument(
        "--live", action="store_true",
        help="permit external provider requests. Without it NO external "
             "network call is made and the external pools are reported as "
             "skipped.")
    collect_parser.add_argument("--rate-limit", type=float,
                                default=DEFAULT_RATE_LIMIT,
                                help="provider requests per second "
                                     "(default 1.0)")
    collect_parser.add_argument("--max-retries", type=int,
                                default=DEFAULT_MAX_RETRIES,
                                help="retries after HTTP 429 (default 3)")
    collect_parser.add_argument("--review-rejected", type=int, default=5,
                                help="rejected candidates per source to put "
                                     "in the review file (default 5). These "
                                     "are what reveal false negatives.")
    collect_parser.add_argument("--include-flagged", action="store_true",
                                help="also sample records flagged as test or "
                                     "inconsistent")
    collect_parser.add_argument("--timeout", type=int, default=20)
    collect_parser.add_argument("--insecure", action="store_true",
                                help="skip TLS verification (local tunnels "
                                     "with self-signed certificates only)")
    collect_parser.set_defaults(func=collect)

    summarize_parser = sub.add_parser(
        "summarize", help="score a review file a human has filled in")
    summarize_parser.add_argument("--output-dir", required=True)
    summarize_parser.set_defaults(func=summarize)
    return parser


def main(argv=None):
    parser = build_parser()
    args = parser.parse_args(argv)
    if not getattr(args, "func", None):
        parser.print_help()
        return 2
    if getattr(args, "ids_file", None):
        args.sample_size = None
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
