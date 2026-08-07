"""Pure logic for the Related Research domain-quality evaluation.

No network, no filesystem, no clock, no configuration -- everything here is a
function of its arguments, so the sampling, the exclusions, the field
allowlist, the rating rules and the metrics are all unit-testable without a
live Qresp or a live provider.

The scoring itself is NOT reimplemented here. Anything that decides whether a
candidate is related comes from `project.relatedness` and `project.related`;
this module only feeds them, describes what they decided, and counts.

Privacy: `to_canonical_record` is the single place a public API payload
becomes something this tool works with, and it is an ALLOWLIST. Curator
names/emails, owner and editor fields, RCC URLs, file-server paths, file
names and image files are not copied through it, so they cannot reach a
profile, a JSONL line, a TSV cell or a summary.
"""
import hashlib
import json
import re

from project import relatedness as R

# --------------------------------------------------------------- input shape

# The public /api/search response is built from `Search.__dict__`, so its keys
# arrive name-mangled (`_Search__title`). Newer/other payloads -- notably
# /api/paper/{id} -- use plain names. Both are read HERE and nowhere else, so
# the rest of the tool never sees a legacy key.
SEARCH_FIELD_ALIASES = {
    "id": ("_Search__id", "id", "_id", "paper_id"),
    "title": ("_Search__title", "title"),
    "abstract": ("_Search__abstract", "abstract", "publishedAbstract"),
    "doi": ("_Search__doi", "doi", "DOI"),
    "tags": ("_Search__tags", "tags"),
    "collections": ("_Search__collections", "collections"),
    "publication": ("_Search__publication", "publication", "journal"),
    "year": ("_Search__year", "year"),
    "authors": ("_Search__authors", "authors"),
}

# Artifact fields that carry scientific meaning. Everything else an artifact
# holds -- `files`, `URLs`, `imageFile`, `saveas`, ids -- is a path, a link or
# bookkeeping, and is deliberately absent.
CHART_FIELDS = ("caption", "properties")
ARTIFACT_FIELDS = ("readme", "keywords")
TOOL_FIELDS = ("packageName", "programName", "facilityname", "facilityName",
               "measurement", "readme")


def _first(raw, names):
    for name in names:
        if name in raw and raw[name] not in (None, ""):
            return raw[name]
    return None


def _as_list(value):
    if value is None:
        return []
    if isinstance(value, (list, tuple)):
        return [str(item).strip() for item in value if str(item or "").strip()]
    text = str(value).strip()
    if not text:
        return []
    return [part.strip() for part in text.split(",") if part.strip()]


def _as_int(value):
    try:
        return int(str(value).strip())
    except (TypeError, ValueError):
        return None


def normalize_search_record(raw):
    """Any Qresp record payload -> one canonical, allowlisted dict.

    Legacy `_Search__*` keys and plain keys are both understood, and this is
    the ONLY place either is read.
    """
    raw = raw or {}
    record = {}
    for field, aliases in SEARCH_FIELD_ALIASES.items():
        record[field] = _first(raw, aliases)
    record["id"] = str(record["id"] or "").strip()
    for field in ("title", "abstract", "doi", "publication"):
        record[field] = str(record[field] or "").strip()
    record["tags"] = _as_list(record["tags"])
    record["collections"] = _as_list(record["collections"])
    record["authors"] = _as_list(record["authors"])
    record["year"] = _as_int(record["year"])
    return record


def _artifact_list(raw, fields):
    kept = []
    for item in raw or []:
        if not isinstance(item, dict):
            continue
        entry = {}
        for field in fields:
            value = item.get(field)
            if isinstance(value, (list, tuple)):
                entry[field] = [str(v) for v in value if str(v or "").strip()]
            elif value not in (None, ""):
                entry[field] = str(value)
        if entry:
            kept.append(entry)
    return kept


def to_canonical_record(record, details=None):
    """Canonical `Paper.to_mongo().to_dict()` shape, as the production
    relatedness code expects it.

    `details` is an optional /api/paper/{id} payload, which carries the
    artifact metadata the search projection does not. Only the fields listed
    at the top of this module are copied across -- no curator identity, no
    owner or editor, no file-server path, no file or image name.
    """
    details = details or {}
    normalized = normalize_search_record(record)
    detail_fields = normalize_search_record(details)
    for field in ("title", "abstract", "doi", "publication"):
        if not normalized[field] and detail_fields[field]:
            normalized[field] = detail_fields[field]
    for field in ("tags", "collections", "authors"):
        if not normalized[field] and detail_fields[field]:
            normalized[field] = detail_fields[field]
    if normalized["year"] is None:
        normalized["year"] = detail_fields["year"]

    return {
        "_id": normalized["id"],
        "reference": {
            "title": normalized["title"],
            "publishedAbstract": normalized["abstract"],
            "DOI": normalized["doi"],
            "year": normalized["year"],
            # relatedness._people accepts plain name strings.
            "authors": list(normalized["authors"]),
        },
        "tags": list(normalized["tags"]),
        "collections": list(normalized["collections"]),
        "charts": _artifact_list(details.get("charts"), CHART_FIELDS),
        "datasets": _artifact_list(details.get("datasets"), ARTIFACT_FIELDS),
        "scripts": _artifact_list(details.get("scripts"), ARTIFACT_FIELDS),
        "tools": _artifact_list(details.get("tools"), TOOL_FIELDS),
    }, normalized


# ------------------------------------------------------------- record triage

STATUS_OK = "ok"
STATUS_REVIEW = "review_needed"
STATUS_EXCLUDED = "excluded"

# Titles that announce themselves as scaffolding. Matched as whole words on
# the normalized title so a real paper about, say, "QA/QC of spectra" is
# flagged for a human rather than silently dropped -- which is the whole
# point: nothing here auto-excludes for good.
TEST_TITLE_PATTERNS = (
    r"\bstaging\b", r"\btest\b", r"\btesting\b", r"\bqa\b", r"\bqc\b",
    r"\bplaceholder\b", r"\bdummy\b", r"\bsample record\b", r"\bexample\b",
    r"\buntitled\b", r"\bdelete me\b", r"\bdo not use\b", r"\bfoo\b",
    r"\bbar\b", r"\bbaz\b", r"\blorem\b", r"\bipsum\b", r"\basdf\b",
    r"\bqwerty\b", r"\bxxx+\b",
)
_TEST_TITLE_RE = re.compile("|".join(TEST_TITLE_PATTERNS))

# Keyboard-mash tags are the other obvious scaffolding marker.
_MASH_RE = re.compile(r"^(?:asdf|qwer|zxcv|test|foo|bar|baz|abc|xxx)+\d*$")

MIN_TITLE_TOKENS = 3
MIN_ABSTRACT_TOKENS = 20


def triage_record(normalized):
    """Judge whether a record can carry a relevance rating.

    Returns (status, flags). NOTHING is decided irreversibly here: a flagged
    record is reported with its reason and can be evaluated anyway with
    --include-flagged. The caller decides; this only explains.
    """
    flags = []
    title = normalized.get("title") or ""
    abstract = normalized.get("abstract") or ""
    title_tokens = R.tokenize(title)
    abstract_tokens = R.tokenize(abstract)

    if not title:
        flags.append(("no_title", "the record has no title"))
    elif _TEST_TITLE_RE.search(R.normalize_text(title)):
        flags.append(("test_title",
                      "the title reads like a test or placeholder record"))
    elif len(title_tokens) < MIN_TITLE_TOKENS:
        flags.append(("thin_title",
                      "the title has fewer than %d content words"
                      % MIN_TITLE_TOKENS))

    mashed = [t for t in normalized.get("tags") or []
              if _MASH_RE.match(R.normalize_text(t) or "")]
    if mashed:
        flags.append(("test_tags",
                      "%d tag(s) look like keyboard-mash placeholders"
                      % len(mashed)))

    if not abstract:
        flags.append(("no_abstract",
                      "no abstract, so text similarity cannot be judged"))
    elif len(abstract_tokens) < MIN_ABSTRACT_TOKENS:
        flags.append(("thin_abstract",
                      "the abstract has fewer than %d content words"
                      % MIN_ABSTRACT_TOKENS))

    # Checked INDEPENDENTLY of length: a short abstract must not hide a
    # mismatch, which is the more serious of the two and the exact symptom
    # seen on staging (a title describing one paper over another's abstract).
    # Not proof, so it is a flag and not a deletion.
    if title_tokens and abstract_tokens and not (set(title_tokens)
                                                 & set(abstract_tokens)):
        flags.append(("title_abstract_mismatch",
                      "the title and abstract share no content words, which "
                      "usually means they came from different papers"))

    if not normalized.get("doi"):
        flags.append(("no_doi",
                      "no DOI, so the external lookup must fall back to a "
                      "title match"))

    if not flags:
        return STATUS_OK, []
    blocking = {"no_title", "test_title", "test_tags",
                "title_abstract_mismatch"}
    status = (STATUS_EXCLUDED if any(code in blocking for code, _ in flags)
              else STATUS_REVIEW)
    return status, [{"code": code, "reason": reason} for code, reason in flags]


# ------------------------------------------------------ deterministic sample

def richness(normalized):
    """How much a record gives the gate to work with. Higher is better."""
    score = 0
    if normalized.get("doi"):
        score += 4
    abstract_tokens = len(R.tokenize(normalized.get("abstract") or ""))
    score += min(abstract_tokens // 25, 4)
    if abstract_tokens >= MIN_ABSTRACT_TOKENS:
        score += 2
    score += min(len(R.tokenize(normalized.get("title") or "")), 6) // 2
    score += min(len(normalized.get("tags") or []), 3)
    if normalized.get("collections"):
        score += 1
    if normalized.get("authors"):
        score += 1
    return score


def _stratum(normalized):
    """The axis a sample must not concentrate on. Collections first (Qresp's
    own grouping), then publication, then a catch-all."""
    collections = sorted(normalized.get("collections") or [])
    if collections:
        return "collection:%s" % R.normalize_text(collections[0])
    publication = normalized.get("publication") or ""
    if publication:
        return "publication:%s" % R.normalize_text(publication)
    return "unclassified"


def select_sample(records, size, include_flagged=False):
    """Pick `size` records, deterministically and without concentrating.

    Richer records first WITHIN a stratum, then one stratum at a time in a
    round robin, so twenty records from one collection cannot crowd out the
    rest. No randomness at all: the same input always yields the same sample,
    which is what makes a re-run comparable to the run before it.

    Returns (chosen, skipped) where each entry is
    {record, normalized, status, flags}.
    """
    triaged = []
    for raw in records or []:
        canonical, normalized = to_canonical_record(raw)
        status, flags = triage_record(normalized)
        triaged.append({"record": canonical, "normalized": normalized,
                        "status": status, "flags": flags})

    # Only a record that looks BROKEN (scaffolding title, mash tags, a title
    # and abstract from different papers) is held back, and even that is
    # reversible with include_flagged. A merely thin record -- short abstract,
    # no DOI -- is still evaluated, carrying its flags into the output, since
    # "this one has no DOI" is a finding about the corpus and not a reason to
    # stop looking at it.
    eligible, skipped = [], []
    for entry in triaged:
        usable = entry["status"] != STATUS_EXCLUDED or include_flagged
        if usable and entry["normalized"]["id"]:
            eligible.append(entry)
        else:
            skipped.append(entry)

    buckets = {}
    for entry in eligible:
        buckets.setdefault(_stratum(entry["normalized"]), []).append(entry)
    for bucket in buckets.values():
        bucket.sort(key=lambda e: (-richness(e["normalized"]),
                                   e["normalized"]["id"]))

    chosen = []
    order = sorted(buckets)
    while order and (size is None or len(chosen) < size):
        progressed = False
        for key in list(order):
            if size is not None and len(chosen) >= size:
                break
            bucket = buckets[key]
            if not bucket:
                order.remove(key)
                continue
            chosen.append(bucket.pop(0))
            progressed = True
        if not progressed:
            break

    picked = {id(entry) for entry in chosen}
    skipped.extend(entry for entry in eligible if id(entry) not in picked)
    return chosen, skipped


# --------------------------------------------------------- gate explanations

def gate_components(assessment):
    """The numbers behind one verdict, for a human reading the TSV.

    Read off the Assessment the production gate produced -- the decision is
    never recomputed here.
    """
    strong = [e for e in assessment.evidence if e.strength == R.STRONG]
    medium = [e for e in assessment.evidence if e.strength == R.MEDIUM]
    return {
        "score": round(assessment.score, 4),
        "similarity": round(assessment.similarity, 4),
        "shared_specific_terms": len(assessment.shared_terms),
        "shared_term_weight": round(assessment.shared_weight, 4),
        "strong_signals": len(strong),
        "medium_families": sorted({e.family for e in medium}),
        "families": sorted({e.family for e in assessment.evidence}),
    }


# Stable buckets for the rejection tally. The prose reason carries the actual
# numbers, which makes every string unique -- counting those produced a
# "frequency" table with a count of 1 against 300 distinct sentences.
REJECT_NO_EVIDENCE = "no_evidence"
REJECT_ONE_MEDIUM = "one_medium_family"
REJECT_TOO_FEW_MEDIUMS = "too_few_independent_mediums"


def rejection_code(assessment):
    """Which KIND of rejection this was. Empty when the gate accepted."""
    if assessment.passes:
        return ""
    if not assessment.evidence:
        return REJECT_NO_EVIDENCE
    medium_families = {e.family for e in assessment.evidence
                       if e.strength == R.MEDIUM}
    if len(medium_families) == 1:
        return REJECT_ONE_MEDIUM
    return REJECT_TOO_FEW_MEDIUMS


def rejection_reason(assessment):
    """Why the gate said no, in the gate's own terms, with the numbers a
    person needs to judge whether it was right. Empty when it said yes."""
    if assessment.passes:
        return ""
    medium_families = sorted({e.family for e in assessment.evidence
                              if e.strength == R.MEDIUM})
    if not assessment.evidence:
        return (
            "no evidence at all: %d shared specific terms (strong needs %d), "
            "text similarity %.3f (moderate bar %.2f), no shared author, "
            "no shared tool"
            % (len(assessment.shared_terms), R.STRONG_SHARED_TERM_COUNT,
               assessment.similarity, R.MODERATE_TEXT_SIMILARITY))
    if len(medium_families) == 1:
        return (
            "only one independent medium signal (%s); the gate needs one "
            "strong signal or two independent mediums. Similarity %.3f "
            "(high bar %.2f), %d shared specific terms weighing %.2f "
            "(strong needs %d terms and %.1f)"
            % (medium_families[0], assessment.similarity,
               R.HIGH_TEXT_SIMILARITY, len(assessment.shared_terms),
               assessment.shared_weight, R.STRONG_SHARED_TERM_COUNT,
               R.STRONG_SHARED_TERM_WEIGHT))
    return (
        "no strong signal and fewer than two independent mediums (%s); "
        "similarity %.3f, %d shared specific terms weighing %.2f"
        % (", ".join(medium_families) or "none", assessment.similarity,
           len(assessment.shared_terms), assessment.shared_weight))


# ------------------------------------------------------------- output schema

# The ONLY keys a candidate row may carry. Anything the provider volunteered
# that is not in this list -- openAccessPdf, embeddings, citation counts,
# author ids, homepages -- never reaches a file.
CANDIDATE_KEYS = (
    "pair_id", "stable_key", "source", "rank", "title", "abstract", "year",
    "doi", "provider_paper_id", "gate_score", "gate_components",
    "gate_decision", "rejection_code", "rejection_reason", "reasons",
    "in_top5",
)

RECORD_KEYS = (
    "record_id", "record_title", "record_abstract", "record_year",
    "record_doi", "status", "flags", "internal", "external",
    "provider_outcomes",
)

# Abstracts are carried so a later judgement -- human or machine -- can read
# what the paper actually says instead of guessing from a title. They are
# public bibliographic text, already used for scoring, and are bounded here so
# one pathological record cannot bloat the artifacts.
MAX_ABSTRACT_CHARS = 4000

TSV_COLUMNS = ("pair_id", "record_id", "record_title", "source",
               "candidate_title", "reasons", "gate_score", "gate_decision",
               "human_rating", "human_note")

# The column set before `pair_id` existed. Files already handed to reviewers
# use it, and they must keep working: a format change must never invalidate
# work somebody has already done.
LEGACY_TSV_COLUMNS = ("record_id", "record_title", "source",
                      "candidate_title", "reasons", "gate_score",
                      "gate_decision", "human_rating", "human_note")

VALID_RATINGS = ("related", "partial", "unrelated")


def clip_abstract(value):
    text = re.sub(r"\s+", " ", str(value or "")).strip()
    return text[:MAX_ABSTRACT_CHARS]


def stable_candidate_key(source, profile_key, provider_paper_id, doi, title):
    """The most durable identifier this candidate has.

    Preference order: the Qresp record id or provider paper id (opaque and
    permanent), then the DOI, and only then the normalized title. A title is
    the weakest of the three -- two records can share one -- which is exactly
    why matching on it has to be able to report AMBIGUOUS rather than guess.
    """
    for value in (profile_key, provider_paper_id, doi):
        text = str(value or "").strip()
        if text:
            return text
    return normalize_title_key(title)


def pair_identifier(record_id, source, stable_key):
    """Stable id for one (record, candidate) pair.

    Hashed so it is short, TSV-safe and free of the delimiter problems that
    raw titles bring, while still being a pure function of the three things
    that identify the pair -- the same inputs always give the same id, across
    runs and across machines.
    """
    raw = "%s\x1f%s\x1f%s" % (record_id or "", source or "", stable_key or "")
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:16]


def candidate_row(source, rank, profile, assessment, in_top5,
                  provider_paper_id=None, abstract="", record_id=""):
    """One evaluated candidate, allowlisted."""
    stable_key = stable_candidate_key(
        source, profile.key if source == "internal" else None,
        provider_paper_id, profile.doi, profile.title)
    return {
        "pair_id": pair_identifier(record_id, source, stable_key),
        "stable_key": stable_key,
        "source": source,
        "rank": rank,
        "title": profile.title,
        "abstract": clip_abstract(abstract),
        "year": profile.year,
        "doi": profile.doi or None,
        "provider_paper_id": provider_paper_id or None,
        "gate_score": round(assessment.score, 4),
        "gate_components": gate_components(assessment),
        "gate_decision": "accepted" if assessment.passes else "rejected",
        "rejection_code": rejection_code(assessment),
        "rejection_reason": rejection_reason(assessment),
        "reasons": assessment.reasons(3),
        "in_top5": bool(in_top5),
    }


def _tsv_cell(value):
    """TSV has no escaping worth the name, so control characters are removed
    rather than encoded."""
    text = "" if value is None else str(value)
    return re.sub(r"[\t\r\n]+", " ", text).strip()


def tsv_rows(record_rows, rejected_per_source=5):
    """Human-review rows: what a visitor would actually SEE, plus the
    near-misses just behind it.

    Not "every accepted candidate": on a real, topically homogeneous corpus
    the gate accepts most pairs, and only the top five are ever shown. Asking
    a person to rate 900 rows that nobody will ever look at buys nothing and
    guarantees the review never gets finished.

    So each (record, source) contributes the candidates production would show
    (`in_top5`) and then the best-scoring ones it would not. The second group
    is there ON PURPOSE: without it the exercise can only find false
    positives, and the open question is the opposite one -- whether the gate
    is throwing away papers a physicist would have kept.
    """
    rows = [TSV_COLUMNS]
    for record in record_rows:
        candidates = list(record.get("internal") or [])
        for pool in (record.get("external") or {}).values():
            candidates.extend(pool)
        by_source = {}
        for candidate in candidates:
            by_source.setdefault(candidate["source"], []).append(candidate)
        for source in sorted(by_source):
            shown = [c for c in by_source[source] if c["in_top5"]]
            shown.sort(key=lambda c: (-c["gate_score"], c["title"]))
            near_misses = sorted(
                (c for c in by_source[source] if not c["in_top5"]),
                key=lambda c: (-c["gate_score"], c["title"]))
            for candidate in shown + near_misses[:rejected_per_source]:
                rows.append((
                    _tsv_cell(candidate.get("pair_id")),
                    _tsv_cell(record["record_id"]),
                    _tsv_cell(record["record_title"]),
                    _tsv_cell(candidate["source"]),
                    _tsv_cell(candidate["title"]),
                    _tsv_cell(" | ".join(candidate["reasons"])),
                    _tsv_cell(candidate["gate_score"]),
                    _tsv_cell(candidate["gate_decision"]),
                    "",   # human_rating -- filled in by a person, never here
                    "",   # human_note
                ))
    return rows


def render_tsv(rows):
    return "\n".join("\t".join(row) for row in rows) + "\n"


def parse_tsv(text):
    """Read a reviewed TSV back. Returns (rows, errors).

    Both column sets are accepted. A file written before `pair_id` existed is
    read with an empty `pair_id`, so a reviewer who has already started
    filling one in does not lose that work to a format change.
    """
    lines = [line for line in (text or "").split("\n") if line.strip()]
    if not lines:
        return [], ["the review file is empty"]
    header = tuple(lines[0].split("\t"))
    if header == TSV_COLUMNS:
        columns, legacy = TSV_COLUMNS, False
    elif header == LEGACY_TSV_COLUMNS:
        columns, legacy = LEGACY_TSV_COLUMNS, True
    else:
        return [], ["unexpected header: expected %s (or the legacy %s), "
                    "found %s" % (list(TSV_COLUMNS),
                                  list(LEGACY_TSV_COLUMNS), list(header))]
    rows, errors = [], []
    for number, line in enumerate(lines[1:], start=2):
        parts = line.split("\t")
        if len(parts) != len(columns):
            errors.append("line %d: expected %d columns, found %d"
                          % (number, len(columns), len(parts)))
            continue
        row = dict(zip(columns, parts))
        if legacy:
            row["pair_id"] = ""
        rating = (row["human_rating"] or "").strip().lower()
        if rating and rating not in VALID_RATINGS:
            errors.append("line %d: human_rating %r is not one of %s"
                          % (number, row["human_rating"],
                             ", ".join(VALID_RATINGS)))
            continue
        row["human_rating"] = rating
        rows.append(row)
    return rows, errors


# ------------------------------------------------------------------ metrics

def collection_summary(record_rows, skipped, sample_size, live,
                       api_key_present):
    """What was collected, before anybody has rated anything."""
    pools, rejection_counts = {}, {}
    accepted_total = candidates_total = 0
    zero_candidate_records = 0
    for record in record_rows:
        candidates = list(record.get("internal") or [])
        for pool in (record.get("external") or {}).values():
            candidates.extend(pool)
        if not candidates:
            zero_candidate_records += 1
        for candidate in candidates:
            source = candidate["source"]
            bucket = pools.setdefault(
                source, {"candidates": 0, "accepted": 0, "records": 0,
                         "records_with_candidates": 0})
            bucket["candidates"] += 1
            candidates_total += 1
            if candidate["gate_decision"] == "accepted":
                bucket["accepted"] += 1
                accepted_total += 1
            else:
                code = candidate.get("rejection_code") or "unknown"
                rejection_counts[code] = rejection_counts.get(code, 0) + 1
        for source in {c["source"] for c in candidates}:
            pools[source]["records_with_candidates"] += 1

    for source in pools:
        pools[source]["records"] = len(record_rows)
        pools[source]["coverage"] = _ratio(
            pools[source]["records_with_candidates"], len(record_rows))
        pools[source]["gate_pass_rate"] = _ratio(
            pools[source]["accepted"], pools[source]["candidates"])
        pools[source]["shown"] = sum(
            1 for record in record_rows
            for candidate in (record.get("internal") or []) +
            [c for pool in (record.get("external") or {}).values()
             for c in pool]
            if candidate["source"] == source and candidate["in_top5"])

    # "Set aside" means two very different things and must not be one number:
    # a record HELD BACK because it looks broken is a finding about the
    # corpus, while a record simply not drawn into the sample is not.
    flagged = [e for e in skipped if e.get("flags")]
    # Abstract coverage decides whether a later judgement is reading the
    # papers or guessing from their titles, so it is reported up front rather
    # than discovered when the labelling produces nothing but low confidence.
    records_with_abstract = sum(
        1 for record in record_rows
        if (record.get("record_abstract") or "").strip())
    candidates_with_abstract = 0
    for record in record_rows:
        candidates = list(record.get("internal") or [])
        for pool in (record.get("external") or {}).values():
            candidates.extend(pool)
        candidates_with_abstract += sum(
            1 for c in candidates if (c.get("abstract") or "").strip())

    return {
        "sample_size": len(record_rows),
        "requested_sample_size": sample_size,
        "live": bool(live),
        "api_key_present": bool(api_key_present),
        "abstract_coverage": {
            "records_with_abstract": records_with_abstract,
            "records_total": len(record_rows),
            "records_ratio": _ratio(records_with_abstract, len(record_rows)),
            "candidates_with_abstract": candidates_with_abstract,
            "candidates_total": candidates_total,
            "candidates_ratio": _ratio(candidates_with_abstract,
                                       candidates_total),
            "note": "Pairs where NEITHER side has an abstract are not sent "
                    "to a language model by default; see `ai-label "
                    "--allow-title-only`.",
        },
        "records_not_sampled": len(skipped) - len(flagged),
        "records_flagged": len(flagged),
        "flag_reasons": _flag_counts(flagged),
        "candidates_total": candidates_total,
        "accepted_total": accepted_total,
        "gate_pass_rate": _ratio(accepted_total, candidates_total),
        "records_with_zero_candidates": zero_candidate_records,
        "zero_candidate_ratio": _ratio(zero_candidate_records,
                                       len(record_rows)),
        "pools": pools,
        "rejection_reason_frequency": dict(
            sorted(rejection_counts.items(), key=lambda kv: (-kv[1], kv[0]))),
    }


def _flag_counts(skipped):
    counts = {}
    for entry in skipped:
        for flag in entry.get("flags") or []:
            counts[flag["code"]] = counts.get(flag["code"], 0) + 1
    return dict(sorted(counts.items(), key=lambda kv: (-kv[1], kv[0])))


def _ratio(part, whole):
    return round(part / float(whole), 4) if whole else 0.0


def score_ratings(rows, top5_keys=frozenset()):
    """Turn human ratings into the numbers that answer the question.

    `top5_keys` is the set of (record_id, source, candidate_title) that the
    production gate would actually show, so precision@5 measures what a
    visitor sees rather than everything that was collected.

    Unrated rows are excluded from every metric and counted separately: a
    half-finished review must not silently look like a verdict.
    """
    rated = [r for r in rows if r["human_rating"]]
    unrated = [r for r in rows if not r["human_rating"]]

    def bucket(subset):
        related = sum(1 for r in subset if r["human_rating"] == "related")
        partial = sum(1 for r in subset if r["human_rating"] == "partial")
        unrelated = sum(1 for r in subset if r["human_rating"] == "unrelated")
        total = len(subset)
        return {
            "rated": total,
            "related": related,
            "partial": partial,
            "unrelated": unrelated,
            "precision_strict": _ratio(related, total),
            "precision_lenient": _ratio(related + partial, total),
        }

    shown = [r for r in rated
             if (r["record_id"], r["source"], r["candidate_title"])
             in top5_keys]
    accepted = [r for r in rated if r["gate_decision"] == "accepted"]
    rejected = [r for r in rated if r["gate_decision"] == "rejected"]

    false_positives = [r for r in accepted if r["human_rating"] == "unrelated"]
    false_negatives = [r for r in rejected
                       if r["human_rating"] in ("related", "partial")]
    strict_false_negatives = [r for r in rejected
                              if r["human_rating"] == "related"]

    per_pool = {}
    for source in sorted({r["source"] for r in rated}):
        subset = [r for r in rated if r["source"] == source]
        per_pool[source] = bucket(subset)
        per_pool[source]["accepted"] = sum(
            1 for r in subset if r["gate_decision"] == "accepted")
        per_pool[source]["false_positives"] = sum(
            1 for r in subset if r["gate_decision"] == "accepted"
            and r["human_rating"] == "unrelated")
        per_pool[source]["false_negatives"] = sum(
            1 for r in subset if r["gate_decision"] == "rejected"
            and r["human_rating"] in ("related", "partial"))

    records = {r["record_id"] for r in rows}
    rated_records = {r["record_id"] for r in rated}

    return {
        "rows_total": len(rows),
        "rows_rated": len(rated),
        "rows_unrated": len(unrated),
        "rows_unrated_excluded_from_metrics": len(unrated),
        "precision_at_5": bucket(shown)["precision_strict"],
        "precision_at_5_lenient": bucket(shown)["precision_lenient"],
        "shown_rows_rated": len(shown),
        "accepted": bucket(accepted),
        "rejected": bucket(rejected),
        "false_positives": len(false_positives),
        "false_negatives": len(false_negatives),
        "false_negatives_strict": len(strict_false_negatives),
        "record_coverage": {
            "records_in_review": len(records),
            "records_with_at_least_one_rating": len(rated_records),
            "ratio": _ratio(len(rated_records), len(records)),
        },
        "pools": per_pool,
    }


def dumps(payload):
    return json.dumps(payload, indent=2, sort_keys=True, ensure_ascii=False)
