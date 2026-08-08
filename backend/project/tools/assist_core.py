"""Pure logic for the AI-assist benchmarks.

No network, no filesystem, no clock, no database, no provider. Everything
here is a function of its arguments, so leakage prevention, path matching,
sampling and the metrics are all testable without touching Qresp, RCC or
Gemini.

The product's own contracts are IMPORTED, never restated: the field
allowlists, prompts, schemas and parsers come from `project.assist` and
`project.curation`. A benchmark that reimplements what it measures ends up
measuring the reimplementation.

Two things this module exists to guarantee:

* the record being evaluated cannot see its own answer -- not through the
  vocabulary, not through the artifact context, not through the payload; and
* an RCC candidate is only ever compared with a human artifact when the two
  are the SAME file, established by exact path, never by resemblance.
"""
import hashlib
import json
import re

from project import assist
from project import curation

# ------------------------------------------------------------- input shapes

# The public /api/search response is name-mangled (`_Search__title`); the
# details endpoint is not. Both are read here and nowhere else.
SEARCH_FIELD_ALIASES = {
    "id": ("_Search__id", "id", "_id"),
    "title": ("_Search__title", "title"),
    "abstract": ("_Search__abstract", "abstract", "publishedAbstract"),
    "doi": ("_Search__doi", "doi", "DOI"),
    "tags": ("_Search__tags", "tags"),
    "collections": ("_Search__collections", "collections"),
    "publication": ("_Search__publication", "publication"),
    "year": ("_Search__year", "year"),
    "fileServerPath": ("_Search__fileServerPath", "fileServerPath"),
}

# Where a HUMAN-authored description actually lives on the wire, canonical
# first. Traced through models.py, schema.json, ToolsInfoForm.js and a real
# published record (project/tests/data.json), because guessing here would
# make an artifact look undescribed when the curator had described it:
#
#   chart    caption
#   dataset  readme          (schema.json + model agree)
#   script   readme
#   tool     description     (schema.json and every published record);
#                            `readme` is the mongoengine field name and shows
#                            up on some legacy documents
ARTIFACT_DESCRIPTION_FIELDS = {
    "charts": ("caption",),
    "datasets": ("readme", "description"),
    "scripts": ("readme", "description"),
    "tools": ("description", "readme"),
}
ARTIFACT_KEYWORD_FIELDS = {
    "charts": ("properties",),
    "datasets": ("keywords",),
    "scripts": ("keywords",),
    "tools": (),                       # a Tool has no keyword field
}
ARTIFACT_FACILITY_FIELDS = ("facilityName", "facilityname")

MAX_ABSTRACT_CHARS = 8000
MAX_TEXT_CHARS = 2000


def _first(raw, names):
    for name in names:
        if name in raw and raw[name] not in (None, ""):
            return raw[name]
    return None


def _text(value, limit=MAX_TEXT_CHARS):
    return re.sub(r"\s+", " ", str(value or "")).strip()[:limit]


def _as_list(value):
    if value is None:
        return []
    if isinstance(value, (list, tuple)):
        return [_text(item) for item in value if _text(item)]
    text = _text(value)
    return [part.strip() for part in text.split(",") if part.strip()]


def normalize_search_record(raw):
    """Any Qresp record payload -> one canonical, allowlisted dict."""
    raw = raw or {}
    record = {}
    for field, aliases in SEARCH_FIELD_ALIASES.items():
        record[field] = _first(raw, aliases)
    record["id"] = str(record["id"] or "").strip()
    for field in ("title", "doi", "publication", "fileServerPath"):
        record[field] = _text(record[field])
    record["abstract"] = _text(record["abstract"], MAX_ABSTRACT_CHARS)
    record["tags"] = _as_list(record["tags"])
    record["collections"] = _as_list(record["collections"])
    try:
        record["year"] = int(str(record["year"]).strip())
    except (TypeError, ValueError):
        record["year"] = None
    return record


def _artifact(entry, kind):
    """One stored artifact, reduced to what a benchmark may look at.

    Paths and file names are kept ONLY as match keys -- they are never put in
    a provider payload, which is why they live beside the payload fields
    rather than inside them.
    """
    if not isinstance(entry, dict):
        return None

    def first(names):
        """The first name that carries a value, and which one it was."""
        for name in names:
            value = entry.get(name)
            if value not in (None, "", [], ()):
                return value, name
        return None, (names[0] if names else "")

    description, description_field = first(
        ARTIFACT_DESCRIPTION_FIELDS.get(kind, ("readme",)))
    keywords, keyword_field = first(ARTIFACT_KEYWORD_FIELDS.get(kind, ()))
    facility, _ = first(ARTIFACT_FACILITY_FIELDS)
    item = {
        "kind": kind,
        "id": _text(entry.get("id"), 64),
        "human_description": _text(description),
        "human_description_field": description_field,
        "human_keywords": _as_list(keywords) if keyword_field else [],
        "human_keyword_field": keyword_field or "",
        # Match keys only.
        "files": [_text(f, 300) for f in (entry.get("files") or [])],
        "image_file": _text(entry.get("imageFile"), 300),
        "notebook_file": _text(entry.get("notebookFile"), 300),
        # Tool identity fields, which the AI must never invent.
        "package_name": _text(entry.get("packageName"), 300),
        "facility_name": _text(facility, 300),
        "measurement": _text(entry.get("measurement"), 300),
    }
    return item


def to_benchmark_record(search_row, details=None):
    """Canonical benchmark record: bibliography, hidden reference tags, and
    the human-authored artifacts, with no curator identity or RCC URL."""
    details = details or {}
    record = normalize_search_record(search_row)
    detail = normalize_search_record(details)
    for field in ("title", "abstract", "doi", "publication",
                  "fileServerPath"):
        if not record[field] and detail[field]:
            record[field] = detail[field]
    if not record["tags"] and detail["tags"]:
        record["tags"] = detail["tags"]
    if record["year"] is None:
        record["year"] = detail["year"]

    artifacts = {}
    for kind in ("charts", "datasets", "scripts", "tools"):
        reduced = []
        for entry in (details.get(kind) or []):
            item = _artifact(entry, kind)
            if item:
                reduced.append(item)
        artifacts[kind] = reduced

    return {
        "record_id": record["id"],
        "title": record["title"],
        "abstract": record["abstract"],
        "publication": record["publication"],
        "doi": record["doi"],
        "year": record["year"],
        "collections": record["collections"],
        # THE ANSWER. Hidden from every payload; see build_keyword_payload.
        "reference_tags": record["tags"],
        # Kept only to key RCC analyses; never sent anywhere.
        "file_server_path": record["fileServerPath"],
        "artifacts": artifacts,
    }


# -------------------------------------------------- leave-one-out vocabulary

def build_vocabulary(records, exclude_record_id=None):
    """The Qresp keyword vocabulary, with ONE record held out.

    The product builds this from every active record. A benchmark that did
    the same would hand the model the exact answer it is being asked to
    produce, and the score would measure copying.

    So the record under evaluation contributes nothing. A tag that ALSO
    appears on another record legitimately stays -- it is genuinely part of
    the site's language, and removing it would model a Qresp that does not
    exist. Only this record's sole claim to a term is withheld.

    Returns (display list, known set) with the same shape and bound as
    `assist._qresp_taxonomy`.
    """
    counts, display = {}, {}
    for record in records or []:
        if exclude_record_id and record.get("record_id") == exclude_record_id:
            continue
        for tag in (record.get("reference_tags") or []):
            term = re.sub(r"\s+", " ", str(tag or "")).strip()
            if not (2 <= len(term) <= 60):
                continue
            key = term.lower()
            counts[key] = counts.get(key, 0) + 1
            display.setdefault(key, term)
    ordered = sorted(counts, key=lambda key: (-counts[key], key))
    return ([display[key] for key in ordered[:assist.MAX_TAXONOMY_TERMS]],
            set(counts))


MODE_PUBLICATION_ONLY = "publication_only"
MODE_WITH_ARTIFACTS = "publication_plus_artifacts"
KEYWORD_MODES = (MODE_PUBLICATION_ONLY, MODE_WITH_ARTIFACTS)


def _artifact_request_entry(item, hide_terms=()):
    """One artifact under the field names the CURATOR'S STATE actually uses.

    Deliberately the STORED names -- `readme`, `facilityName` -- not the ones
    `assist.CONTEXT_FIELDS` reads. Passing this through the product's own
    `_reviewed_context` therefore reproduces exactly what does and does not
    reach the model, including the fields whose names the allowlist does not
    match. Renaming them here would measure a product that does not exist.

    `hide_terms` are the record's held-out tags. A curator often repeats a
    paper tag in a chart's `properties`, and handing that to the model would
    be handing it the answer -- so those exact values are dropped, and the
    caller counts how many, because it makes this mode weaker than production.
    """
    hidden = {normalize_keyword(term) for term in hide_terms or ()}
    hidden.discard("")

    def keep(values):
        return [v for v in values if normalize_keyword(v) not in hidden]

    kind = item["kind"]
    entry = {}
    if kind == "charts":
        entry["caption"] = item["human_description"]
        entry["properties"] = ", ".join(keep(item["human_keywords"]))
    elif kind in ("datasets", "scripts"):
        entry["readme"] = item["human_description"]
        entry["keywords"] = ", ".join(keep(item["human_keywords"]))
    elif kind == "tools":
        entry["packageName"] = item["package_name"]
        entry["description"] = item["human_description"]
        entry["facilityName"] = item["facility_name"]
        entry["measurement"] = item["measurement"]
    return {key: value for key, value in entry.items() if value}


def count_hidden_artifact_keywords(record):
    """How many artifact keywords had to be withheld because they repeat one
    of the paper's held-out tags. Reported so the artifacts mode is read as
    the slightly handicapped comparison it is."""
    hidden = {normalize_keyword(t) for t in record.get("reference_tags") or ()}
    total = 0
    for items in (record.get("artifacts") or {}).values():
        for item in items:
            total += sum(1 for k in item["human_keywords"]
                         if normalize_keyword(k) in hidden)
    return total


def build_keyword_payload(record, mode, vocabulary):
    """The payload the product would send, minus the answer.

    `reference_tags` never appears, and nothing else can carry them back:
    the vocabulary is leave-one-out, and any artifact keyword that repeats a
    held-out tag is withheld too.
    """
    publication = {
        "kind": "",
        "title": _text(record.get("title")),
        "abstract": _text(record.get("abstract"), MAX_ABSTRACT_CHARS),
        "publication": _text(record.get("publication")),
        "doi": _text(record.get("doi"), 200),
        "year": "" if record.get("year") is None else str(record["year"]),
    }
    publication = {k: v for k, v in publication.items() if v}

    payload = {"publication": publication}
    if mode == MODE_WITH_ARTIFACTS:
        hide = record.get("reference_tags") or []
        request_body = {}
        for kind, items in (record.get("artifacts") or {}).items():
            entries = [_artifact_request_entry(item, hide) for item in items]
            entries = [e for e in entries if e]
            if entries:
                request_body[kind] = entries
        # The PRODUCT's own reducer, bounds and allowlist.
        context = assist._reviewed_context(request_body)
        if context:
            payload["reviewed_artifacts"] = context
    if vocabulary:
        payload["qresp_vocabulary"] = vocabulary
    return payload


def _flatten_labels(value):
    if isinstance(value, (list, tuple)):
        out = []
        for item in value:
            out.extend(_flatten_labels(item))
        return out
    return [part.strip() for part in str(value or "").split(",")
            if part.strip()]


def payload_label_fields(payload):
    """The parts of a keyword payload that are CURATED LABELS.

    The paper's own title and abstract are excluded on purpose. A tag that
    can be read out of the abstract is precisely what the keyword AI exists
    to find, and treating that as leakage would restrict the benchmark to
    papers whose tags are unguessable from their own text -- which is to say,
    to papers the feature was never meant to help with.

    What IS a label: the site vocabulary, an artifact's curated keyword list,
    and any `tags` field, which should not be in a payload at all.
    """
    labels = _flatten_labels(payload.get("qresp_vocabulary") or [])
    for entries in (payload.get("reviewed_artifacts") or {}).values():
        for entry in entries or []:
            for field in ("properties", "keywords"):
                labels.extend(_flatten_labels(entry.get(field)))
    for stray in ("tags", "keywords", "reference_tags"):
        if stray in payload:
            labels.extend(_flatten_labels(payload[stray]))
    return labels


def artifact_label_fields(payload):
    """Only the artifact keyword lists -- this record's OWN curated labels."""
    labels = []
    for entries in (payload.get("reviewed_artifacts") or {}).values():
        for entry in entries or []:
            for field in ("properties", "keywords"):
                labels.extend(_flatten_labels(entry.get(field)))
    return labels


def exclusive_tags(record, records):
    """Tags this record alone carries — exactly what leave-one-out removes.

    A tag another record also uses stays in the vocabulary by design: it is
    genuinely part of the site's language, and deleting it would model a
    Qresp that does not exist. Only a term this record is the sole source of
    could have come from the held-out answer.
    """
    mine = {normalize_keyword(t) for t in record.get("reference_tags") or ()}
    mine.discard("")
    for other in records or []:
        if other.get("record_id") == record.get("record_id"):
            continue
        mine -= {normalize_keyword(t)
                 for t in other.get("reference_tags") or ()}
    return mine


def payload_leaks(payload, reference_tags, exclusive):
    """Every way the held-out answer could still be visible. Empty is good.

    Two different rules, because two different things would be wrong:

    * a tag ONLY this record carries must appear nowhere as a label -- if it
      did, it can only have come from the record being scored; and
    * any of this record's tags inside an ARTIFACT keyword list is the
      curator's own labelling of the same work, whether or not another record
      shares the term.
    """
    problems = []
    exclusive = {normalize_keyword(t) for t in exclusive or ()}
    exclusive.discard("")
    for label in payload_label_fields(payload):
        if normalize_keyword(label) in exclusive:
            problems.append("a tag only this record carries (%r) is present "
                            "as a label" % label)
    hidden = {normalize_keyword(t) for t in reference_tags or ()}
    hidden.discard("")
    for label in artifact_label_fields(payload):
        if normalize_keyword(label) in hidden:
            problems.append("an artifact keyword repeats the held-out tag "
                            "%r" % label)
    return sorted(set(problems))


def payload_hides_reference_tags(payload, reference_tags, exclusive=None):
    """Convenience wrapper. When `exclusive` is not supplied every reference
    tag is treated as exclusive, which is the strict reading."""
    return not payload_leaks(
        payload, reference_tags,
        reference_tags if exclusive is None else exclusive)


def keyword_context_gaps(records):
    """Human artifact text the product's allowlist cannot actually reach.

    `assist.CONTEXT_FIELDS` reads `description` for datasets and scripts and
    `facility` for tools, but those artifacts store `readme` and
    `facilityName`. The values therefore never reach the keyword model. This
    counts what is being lost so the "with artifacts" mode is read for what
    it is, rather than as evidence that artifacts do not help.
    """
    gaps = {}
    for record in records or []:
        for kind, items in (record.get("artifacts") or {}).items():
            for item in items:
                # Through the PRODUCT's own reducer: whatever comes out the
                # other side is what the model would see.
                entry = _artifact_request_entry(item)
                delivered = assist._reviewed_context({kind: [entry]})
                sent = (delivered.get(kind) or [{}])[0] if delivered else {}
                for label, present in (
                        ("description", bool(item["human_description"])),
                        ("keywords", bool(item["human_keywords"])),
                        ("facility", bool(item["facility_name"])
                         if kind == "tools" else None)):
                    if present is None or not present:
                        continue
                    bucket = gaps.setdefault("%s.%s" % (kind, label),
                                             {"stored": 0, "reaches_ai": 0})
                    bucket["stored"] += 1
                    if _reaches_payload(label, sent):
                        bucket["reaches_ai"] += 1
    for value in gaps.values():
        value["lost"] = value["stored"] - value["reaches_ai"]
    return dict(sorted(gaps.items()))


def _reaches_payload(label, sent):
    if label == "description":
        return bool(sent.get("caption") or sent.get("description"))
    if label == "keywords":
        return bool(sent.get("properties") or sent.get("keywords"))
    if label == "facility":
        return bool(sent.get("facility"))
    return False


# ------------------------------------------------------- keyword comparison

def normalize_keyword(value):
    """Case-folded, whitespace-collapsed, punctuation-trimmed."""
    return re.sub(r"\s+", " ", str(value or "")).strip(" .,;:\"'").lower()


def _singular(term):
    if len(term) > 4 and term.endswith("s") and not term.endswith(
            ("ss", "us", "is", "as", "os")):
        return term[:-1]
    return term


def concept_key(value):
    """A coarse key for spotting two spellings of one concept.

    Deliberately shallow -- singular/plural and spacing only. No synonym
    dictionary is hardcoded: deciding that "DFT" and "density functional
    theory" are one concept is a domain judgement, and a benchmark that
    guessed at it would be inventing its own answer key.
    """
    term = normalize_keyword(value)
    term = re.sub(r"[^a-z0-9 ]+", " ", term)
    words = [_singular(word) for word in term.split() if word]
    return " ".join(words)


def acronym_of(value):
    words = [w for w in re.split(r"[^A-Za-z0-9]+", str(value or "")) if w]
    if len(words) < 2:
        return ""
    return "".join(word[0] for word in words).lower()


def suspected_duplicate_concepts(keywords):
    """Pairs that look like one concept written twice: same singular form, or
    an acronym beside its expansion. Flagged for a human, never merged."""
    pairs, seen = [], {}
    for keyword in keywords:
        key = concept_key(keyword)
        if key and key in seen and seen[key] != keyword:
            pairs.append({"a": seen[key], "b": keyword, "why": "same "
                          "normalized form (case, spacing or plural)"})
        elif key:
            seen.setdefault(key, keyword)
    normalized = {normalize_keyword(k): k for k in keywords}
    for keyword in keywords:
        initials = acronym_of(keyword)
        if initials and initials in normalized \
                and normalized[initials] != keyword:
            pairs.append({"a": normalized[initials], "b": keyword,
                          "why": "acronym beside its likely expansion"})
    return pairs


# Words too generic to be a useful research keyword. Reuses the product's own
# folder-noise list and adds paper-level filler; kept short on purpose.
GENERIC_KEYWORDS = frozenset(curation.AI_KEYWORD_STOPWORDS) | frozenset((
    "study", "research", "science", "method", "methods", "simulation",
    "simulations", "computation", "experiment", "experimental", "theory",
    "model", "modeling", "modelling", "paper", "article", "work", "project",
    "material", "materials", "property", "properties", "system", "systems",
))


def keyword_metrics(suggested, reference, known_vocabulary):
    """Exact-match precision/recall/F1 against the held-out tags.

    A LOWER BOUND, and labelled as one everywhere it is reported. Exact
    string matching cannot see that "DFT" and "density functional theory" are
    the same answer, so a low score here is a prompt to look, not a verdict.
    """
    suggested_keys = []
    for keyword in suggested:
        key = normalize_keyword(keyword)
        if key and key not in suggested_keys:
            suggested_keys.append(key)
    reference_keys = {normalize_keyword(tag) for tag in reference
                      if normalize_keyword(tag)}

    hits = [key for key in suggested_keys if key in reference_keys]
    precision = len(hits) / float(len(suggested_keys)) if suggested_keys else 0.0
    recall = len(hits) / float(len(reference_keys)) if reference_keys else 0.0
    f1 = (2 * precision * recall / (precision + recall)
          if (precision + recall) else 0.0)

    known = {normalize_keyword(term) for term in known_vocabulary or ()}
    reused = [key for key in suggested_keys if key in known]
    generic = [key for key in suggested_keys
               if key in GENERIC_KEYWORDS or concept_key(key) in
               GENERIC_KEYWORDS]

    concept_hits = {concept_key(key) for key in suggested_keys} & {
        concept_key(key) for key in reference_keys}

    return {
        "suggested": len(suggested_keys),
        "reference": len(reference_keys),
        "exact_hits": len(hits),
        "exact_precision": round(precision, 4),
        "exact_recall": round(recall, 4),
        "exact_f1": round(f1, 4),
        "normalized_concept_hits": len(concept_hits),
        "vocabulary_reuse": len(reused),
        "vocabulary_reuse_rate": round(
            len(reused) / float(len(suggested_keys)), 4)
        if suggested_keys else 0.0,
        "new_terms": len(suggested_keys) - len(reused),
        "duplicate_rate_after_normalization": round(
            1 - (len(set(concept_key(k) for k in suggested_keys))
                 / float(len(suggested_keys))), 4) if suggested_keys else 0.0,
        "generic_suggestions": generic,
        "matched": sorted(hits),
        "missed_reference": sorted(reference_keys - set(suggested_keys)),
        "metric_note": "Exact string match is a LOWER BOUND. Synonyms, "
                       "acronyms and expansions are not resolved; a miss "
                       "here is a question for a domain expert.",
    }


# ------------------------------------------------------- RCC path matching

MATCH_EXACT_PATH = "exact_path"
UNMATCHED_NO_PATH = "candidate_has_no_usable_path"
UNMATCHED_NOT_FOUND = "no_artifact_with_this_exact_path"
UNMATCHED_AMBIGUOUS = "path_matches_more_than_one_artifact"
UNMATCHED_KIND_MISMATCH = "matched_artifact_is_a_different_kind"
UNMATCHED_CASE_MISMATCH = "path_case_mismatch"
# Shapes that are not a relative path inside the record's folder at all.
REJECT_ABSOLUTE = "path_is_absolute"
REJECT_URL = "path_is_a_url"
REJECT_TRAVERSAL = "path_contains_a_parent_reference"
REJECT_QUERY = "path_carries_a_query_or_fragment"
REJECT_PERCENT = "path_is_percent_encoded"

_PERCENT_RE = re.compile(r"%[0-9A-Fa-f]{2}")


def path_rejection(value):
    """Why this string cannot be used as a match key, or "" when it can.

    Refused rather than cleaned up: a URL, an absolute path or a `..` segment
    means the candidate is not describing a file inside the record's own
    folder, and silently rewriting it into something that matches would be
    inventing the match.
    """
    text = str(value or "").strip()
    if not text:
        return UNMATCHED_NO_PATH
    if "://" in text:
        return REJECT_URL
    if _PERCENT_RE.search(text):
        return REJECT_PERCENT
    if "?" in text or "#" in text:
        return REJECT_QUERY
    candidate = text.replace("\\", "/")
    if candidate.startswith("/") or re.match(r"^[A-Za-z]:/", candidate):
        return REJECT_ABSOLUTE
    if ".." in [segment for segment in candidate.split("/")]:
        return REJECT_TRAVERSAL
    return ""


def normalize_relative_path(value):
    """The match key: POSIX separators, no `./`, no duplicate or trailing `/`.

    **Case is preserved.** RCC serves Linux paths, where `Figure.png` and
    `figure.png` are two different files; folding case would let a benchmark
    score an AI description against the wrong one and never notice. The only
    separator normalization is the Windows backslash, which is a spelling of
    the same character rather than a different name.

    Returns "" for anything `path_rejection` refuses.
    """
    if path_rejection(value):
        return ""
    text = str(value or "").strip().replace("\\", "/")
    while text.startswith("./"):
        text = text[2:]
    text = re.sub(r"/{2,}", "/", text)
    return text.rstrip("/")


def _artifact_paths(item):
    paths = set()
    for value in list(item.get("files") or []) + [item.get("image_file"),
                                                  item.get("notebook_file")]:
        key = normalize_relative_path(value)
        if key:
            paths.add(key)
    return paths


CANDIDATE_KIND_TO_ARTIFACTS = {
    "chart": "charts", "dataset": "datasets",
    "script": "scripts", "tool": "tools",
}


def match_candidate(candidate, record):
    """Pair one RCC candidate with the human artifact for the SAME file.

    Exact relative-path identity only. Title and basename resemblance are
    refused outright: "figure2.png" appears in half the records on a server,
    and a benchmark that scored an AI description against somebody else's
    figure would report a number that means nothing.

    Returns (artifact, reason). `artifact` is None when the pair cannot be
    established, and `reason` says why so the exclusion is auditable.
    """
    kind = str(candidate.get("kind") or "").strip().lower()
    bucket = CANDIDATE_KIND_TO_ARTIFACTS.get(kind)
    if not bucket:
        return None, UNMATCHED_KIND_MISMATCH

    raw_paths = list(candidate.get("paths") or [])
    candidate_paths = set()
    rejections = []
    for path in raw_paths:
        reason = path_rejection(path)
        if reason:
            rejections.append(reason)
            continue
        candidate_paths.add(normalize_relative_path(path))
    candidate_paths.discard("")
    if not candidate_paths:
        # Report the specific refusal when there was one, so the exclusion is
        # auditable rather than a generic "no path".
        return None, (rejections[0] if rejections else UNMATCHED_NO_PATH)

    items = (record.get("artifacts") or {}).get(bucket) or []
    hits = [item for item in items
            if _artifact_paths(item) & candidate_paths]
    if len(hits) > 1:
        return None, UNMATCHED_AMBIGUOUS
    if hits:
        return hits[0], MATCH_EXACT_PATH

    # Nothing matched exactly. If something matches when case is ignored, say
    # so specifically: on a case-sensitive file server those are different
    # files, and "we found a near-miss" is a very different finding from
    # "this file is not in the record".
    folded = {p.lower() for p in candidate_paths}
    for item in items:
        if {p.lower() for p in _artifact_paths(item)} & folded:
            return None, UNMATCHED_CASE_MISMATCH
    return None, UNMATCHED_NOT_FOUND


def build_artifact_payload(candidate, artifact):
    """The product's own request shape for exactly one candidate, with the
    human answer removed.

    `curation._sanitize_ai_items` does the allowlisting, the clipping and the
    absolute-path/URL rejection, so this cannot drift from what the endpoint
    sends. The target description and keywords are stripped from `context`
    first -- an evaluation that let the model read the answer out of its own
    evidence would measure nothing.
    """
    context = _text(candidate.get("context"), curation.MAX_AI_CONTEXT_CHARS)
    for secret in [artifact.get("human_description")] + list(
            artifact.get("human_keywords") or []):
        text = _text(secret)
        if len(text) >= 4:
            context = re.sub(re.escape(text), " ", context,
                             flags=re.IGNORECASE)
    context = re.sub(r"\s+", " ", context).strip()

    items = curation._sanitize_ai_items([{
        "id": str(candidate.get("id") or ""),
        "kind": candidate.get("kind"),
        "name": candidate.get("name"),
        "paths": candidate.get("paths") or [],
        "context": context,
    }])
    return items[0] if items else None


def payload_is_safe(payload):
    """No absolute path, no URL, no image bytes, no credential.

    `_sanitize_ai_items` already drops absolute paths and URLs from `paths`;
    this re-checks the WHOLE payload, because a value that arrives through
    `context` or `name` is not covered by that filter.
    """
    blob = json.dumps(payload or {}, ensure_ascii=False)
    problems = []
    if "://" in blob:
        problems.append("payload contains a URL")
    if re.search(r'"[A-Za-z]:[\\/]', blob) or re.search(r'"\s*/[A-Za-z]',
                                                        blob):
        problems.append("payload contains an absolute path")
    if re.search(r"data:image/|base64,", blob):
        problems.append("payload contains inline image bytes")
    if re.search(r"[\w.+-]+@[\w-]+\.[\w.]+", blob):
        problems.append("payload contains an email address")
    return problems


# --------------------------------------------------- artifact comparison

def token_set(value):
    return {t for t in re.split(r"[^a-z0-9]+", str(value or "").lower()) if
            len(t) > 2}


def text_similarity(left, right):
    """Jaccard over content tokens. A RESEMBLANCE score, not a correctness
    score: two good descriptions of one dataset can share few words."""
    a, b = token_set(left), token_set(right)
    if not a or not b:
        return 0.0
    return round(len(a & b) / float(len(a | b)), 4)


# Fields the product says the model must never produce.
FORBIDDEN_PATTERNS = (
    ("path_or_filename", re.compile(
        r"\b[\w-]+\.(?:py|ipynb|csv|dat|h5|png|jpg|jpeg|txt|json|xyz|in|out)\b",
        re.IGNORECASE)),
    ("url", re.compile(r"https?://|www\.", re.IGNORECASE)),
    ("version_number", re.compile(r"\bv?\d+\.\d+(?:\.\d+)?\b")),
    ("figure_number", re.compile(r"\bfig(?:ure)?\.?\s*\d+\b", re.IGNORECASE)),
)


def forbidden_field_hits(text):
    """Which forbidden things a suggested description actually contains."""
    hits = []
    for label, pattern in FORBIDDEN_PATTERNS:
        if pattern.search(str(text or "")):
            hits.append(label)
    return hits


def unsupported_claim_terms(description, evidence):
    """Content words in the description that appear nowhere in the evidence.

    A heuristic for "did it invent something", not a verdict: paraphrase is
    legitimate. Reported as a review list, and the CHART case is the one that
    matters -- the model gets no image bytes and no paper text, so a specific
    figure caption has to have come from somewhere.
    """
    described = token_set(description)
    supported = token_set(evidence)
    return sorted(described - supported - token_set(" ".join(
        GENERIC_KEYWORDS)))


def type_contract_violations(kind, suggestion):
    """Where an answer breaks the record type it is for."""
    problems = []
    keywords = suggestion.get("keywords") or []
    if kind == "tool" and keywords:
        problems.append("keywords returned for a Tool, which has no keyword "
                        "field")
    if kind in ("chart", "dataset", "script") and not isinstance(
            keywords, list):
        problems.append("keywords is not a list")
    description = suggestion.get("description") or ""
    for label in forbidden_field_hits(description):
        problems.append("description contains a %s" % label)
    return problems


# ---------------------------------------------------------- provider cache

def fingerprint(model, system_prompt, payload):
    """Cache key: the model, the prompt and the exact input.

    All three, because a changed prompt or a changed payload is a different
    question -- reusing an answer across either would silently compare things
    that were never asked the same way.
    """
    blob = json.dumps({
        "model": model,
        "prompt": hashlib.sha256(
            (system_prompt or "").encode("utf-8")).hexdigest(),
        "payload": payload,
    }, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(blob.encode("utf-8")).hexdigest()[:32]


# ------------------------------------------------------ deterministic sample

def stratified_sample(items, limit, strata_key, seed=0):
    """A spread-out, reproducible handful.

    Round-robins across strata, preferring an unused group at each step, and
    breaks every tie on a stable key. `seed` only rotates the starting
    stratum, so the same seed always yields the same sample and a different
    one yields a different but equally balanced sample. No RNG.
    """
    buckets = {}
    for item in items or []:
        buckets.setdefault(strata_key(item), []).append(item)
    for bucket in buckets.values():
        bucket.sort(key=lambda entry: str(entry.get("sort_key") or
                                          entry.get("id") or ""))
    order = sorted(buckets)
    if order:
        offset = int(seed) % len(order)
        order = order[offset:] + order[:offset]

    chosen, index = [], {key: 0 for key in order}
    while order and len(chosen) < limit:
        progressed = False
        for key in list(order):
            if len(chosen) >= limit:
                break
            bucket = buckets[key]
            if index[key] >= len(bucket):
                order.remove(key)
                continue
            entry = dict(bucket[index[key]])
            entry["stratum"] = key
            chosen.append(entry)
            index[key] += 1
            progressed = True
        if not progressed:
            break
    return chosen


def dumps(payload):
    return json.dumps(payload, indent=2, sort_keys=True, ensure_ascii=False)
