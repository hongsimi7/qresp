"""Auto-Curation Lite, phase 1: DOI lookup + manuscript-source import.

Two authenticated, CSRF-protected endpoints (wired through swagger.yml):
- POST /api/import/doi         Crossref metadata for a pasted DOI
- POST /api/import/manuscript  proposals extracted from a .tex file or an
                               Overleaf .zip export

Both PROPOSE metadata only — nothing is published, saved, or overwritten
here; the frontend shows a review dialog and the user explicitly applies
selected fields to their draft. Uploaded manuscript content is processed in
memory only: it is never persisted to MongoDB/disk/Git, never logged, never
echoed back in responses, and never sent to any external service. TeX is
parsed with conservative regex/brace scanning — it is NEVER compiled or
executed, and archive members are never extracted to the filesystem.
"""
import base64
import io
import posixpath
import re
import zipfile
from urllib.parse import quote

import requests

from project.auth import csrf_protect, get_current_user

CROSSREF_API = "https://api.crossref.org/works/"
CROSSREF_TIMEOUT = 8
# Identifies Qresp politely to Crossref (no key, no secret).
CROSSREF_HEADERS = {"User-Agent": "Qresp/2.0 (research data curation)"}

DOI_RE = re.compile(r"^10\.\d{4,9}/\S+$")
DOI_IN_TEXT_RE = re.compile(
    r"(?:\bdoi[:\s]+|https?://(?:dx\.)?doi\.org/)(10\.\d{4,9}/[^\s{}\"'<>]+)",
    re.IGNORECASE)
BIB_DOI_RE = re.compile(
    r"doi\s*=\s*[{\"']?\s*(?:https?://(?:dx\.)?doi\.org/)?"
    r"(10\.\d{4,9}/[^\s,}\"']+)", re.IGNORECASE)
INPUT_RE = re.compile(r"\\(?:input|include)\s*\{([^}]+)\}")

# ---- conservative safety limits (clear errors, no partial bypasses) --------
MAX_UPLOAD_BYTES = 10 * 1024 * 1024        # decoded upload (tex or zip)
MAX_TEX_CHARS = 2 * 1024 * 1024            # per TeX file we read
MAX_BIB_BYTES = 1 * 1024 * 1024            # per .bib file we read
MAX_ZIP_ENTRIES = 200
MAX_ZIP_TOTAL_UNCOMPRESSED = 50 * 1024 * 1024
MAX_ZIP_DEPTH = 10
MAX_INCLUDED_FILES = 20
MAX_INCLUDE_DEPTH = 3
MAX_BIB_FILES = 10
MAX_TAGS = 15
MAX_DOI_CANDIDATES = 25


class ImportError_(Exception):
    """User-facing import failure: message is safe to return verbatim."""


def _require_session():
    user = get_current_user()
    if not user:
        return {"error": "authentication required"}, 401
    return None


# ---------------------------------------------------------------- DOI layer

def normalize_doi(raw):
    """Strip common prefixes/whitespace and validate the DOI shape.
    Returns the normalized (lowercased) DOI or None."""
    value = (raw or "").strip()
    value = re.sub(r"^https?://(dx\.)?doi\.org/", "", value,
                   flags=re.IGNORECASE)
    value = re.sub(r"^doi:\s*", "", value, flags=re.IGNORECASE)
    value = value.strip().strip(".,;")
    if not value or not DOI_RE.match(value):
        return None
    return value.lower()


def _split_person(full_name):
    """'First [Middles] Last' -> the curator person triple (same convention
    as the frontend namesUtil)."""
    parts = [p for p in (full_name or "").split() if p]
    if not parts:
        return None
    person = {"firstName": parts[0], "middleName": "", "lastName": ""}
    if len(parts) >= 3:
        person["middleName"] = " ".join(parts[1:-1])
        person["lastName"] = parts[-1]
    elif len(parts) == 2:
        person["lastName"] = parts[1]
    return person


def _strip_jats(text):
    """Crossref abstracts arrive as JATS XML; keep the plain text only."""
    text = re.sub(r"<[^>]+>", " ", text or "")
    return re.sub(r"\s+", " ", text).strip()


def _crossref_fields(message):
    """Map a Crossref work message onto proposal fields. Optional metadata
    may be missing — never fail because of it."""
    fields = {}
    titles = message.get("title") or []
    if titles and str(titles[0]).strip():
        fields["title"] = re.sub(r"\s+", " ", str(titles[0])).strip()

    authors = []
    for author in message.get("author") or []:
        given = (author.get("given") or "").strip()
        family = (author.get("family") or "").strip()
        if not given and not family:
            continue
        given_parts = given.split()
        authors.append({
            "firstName": given_parts[0] if given_parts else "",
            "middleName": " ".join(given_parts[1:]) if len(given_parts) > 1
                          else "",
            "lastName": family,
        })
    if authors:
        fields["authors"] = authors

    containers = message.get("container-title") or []
    if containers and str(containers[0]).strip():
        fields["journal"] = str(containers[0]).strip()

    issued = (message.get("issued") or {}).get("date-parts") or []
    if issued and issued[0] and issued[0][0]:
        try:
            fields["year"] = int(issued[0][0])
        except (TypeError, ValueError):
            pass

    for source_key, target in (("volume", "volume"), ("issue", "issue"),
                               ("page", "pages")):
        value = message.get(source_key)
        if value is not None and str(value).strip():
            fields[target] = str(value).strip()

    abstract = _strip_jats(message.get("abstract") or "")
    if abstract:
        fields["abstract"] = abstract

    if message.get("DOI"):
        fields["doi"] = str(message["DOI"]).strip().lower()
    if message.get("URL"):
        fields["url"] = str(message["URL"]).strip()

    subjects = [str(s).strip() for s in (message.get("subject") or [])
                if str(s).strip()]
    if subjects:
        fields["tags"] = subjects[:MAX_TAGS]
    return fields


def _crossref_lookup(doi):
    """Fetch Crossref metadata. Returns (fields, None) on success or
    (None, (message, status)) on failure. Provider error bodies are never
    surfaced to the client."""
    try:
        response = requests.get(CROSSREF_API + quote(doi, safe="/()"),
                                timeout=CROSSREF_TIMEOUT,
                                headers=CROSSREF_HEADERS)
    except Exception as e:
        print("DOI provider unreachable: %s" % type(e).__name__)
        return None, ("The DOI lookup service could not be reached, please "
                      "try again later.", 502)
    if response.status_code == 404:
        return None, ("This DOI was not found in the scholarly metadata "
                      "registry.", 404)
    if response.status_code != 200:
        print("DOI provider error: HTTP %s" % response.status_code)
        return None, ("The DOI lookup service returned an error, please try "
                      "again later.", 502)
    try:
        message = response.json().get("message") or {}
    except Exception:
        return None, ("The DOI lookup service returned an unreadable "
                      "response.", 502)
    return _crossref_fields(message), None


@csrf_protect
def lookup_doi(body):
    """
    Propose bibliographic metadata for a DOI
    Handler for POST: /api/import/doi
    """
    denied = _require_session()
    if denied:
        return denied

    doi = normalize_doi((body or {}).get("doi"))
    if not doi:
        return {"error": "That does not look like a valid DOI (expected "
                         "something like 10.1234/abcd)."}, 400

    fields, failure = _crossref_lookup(doi)
    if failure:
        message, status = failure
        return {"error": message}, status

    return {
        "doi": doi,
        "proposal": fields,
        "provenance": {key: "crossref" for key in fields},
        "alternatives": {},
        "warnings": [],
    }, 200


# ------------------------------------------------------------ TeX extraction

def _strip_comments(text):
    """Drop % comments (keeping escaped \\%)."""
    return re.sub(r"(?<!\\)%[^\n]*", "", text)


def _brace_argument(text, command):
    """Return the balanced {...} argument of the FIRST \\command occurrence,
    tolerating an optional [...] between. Pure scanning — nothing executed."""
    for match in re.finditer(r"\\%s\b\s*(\[[^\]]*\]\s*)?" % re.escape(command),
                             text):
        index = match.end()
        if index >= len(text) or text[index] != "{":
            continue
        depth = 0
        for end in range(index, len(text)):
            char = text[end]
            if char == "{":
                depth += 1
            elif char == "}":
                depth -= 1
                if depth == 0:
                    return text[index + 1:end]
    return None


def _drop_command_with_arg(text, command):
    """Remove every \\command{...} including its balanced argument."""
    result = []
    cursor = 0
    pattern = re.compile(r"\\%s\b\s*" % re.escape(command))
    while True:
        match = pattern.search(text, cursor)
        if not match:
            result.append(text[cursor:])
            break
        result.append(text[cursor:match.start()])
        index = match.end()
        if index < len(text) and text[index] == "{":
            depth = 0
            end = index
            for end in range(index, len(text)):
                if text[end] == "{":
                    depth += 1
                elif text[end] == "}":
                    depth -= 1
                    if depth == 0:
                        break
            cursor = end + 1
        else:
            cursor = match.end()
    return "".join(result)


_UNWRAP_COMMANDS = ("textbf", "textit", "emph", "textsc", "texttt", "textrm",
                    "text", "mbox", "textsuperscript", "textsubscript",
                    "underline", "uppercase", "lowercase", "mathrm")
_DROP_COMMANDS = ("thanks", "footnote", "affiliation", "affil", "inst",
                  "email", "orcidlink", "fnref", "label", "cite", "citep",
                  "citet", "ref", "vspace", "hspace")


def _clean_tex(text):
    """Conservatively reduce ordinary TeX markup to plain text. Unknown
    commands are removed, not interpreted; nothing is invented."""
    if not text:
        return ""
    for command in _DROP_COMMANDS:
        text = _drop_command_with_arg(text, command)
    for _ in range(4):  # unwrap nested formatting a few levels deep
        new = text
        for command in _UNWRAP_COMMANDS:
            new = re.sub(r"\\%s\b\s*\{([^{}]*)\}" % command, r"\1", new)
        if new == text:
            break
        text = new
    text = text.replace("\\\\", " ").replace("~", " ")
    text = re.sub(r"\\[,;!:]", " ", text)
    text = re.sub(r"\$([^$]*)\$", r"\1", text)
    text = re.sub(r"\\[a-zA-Z@]+\*?(\[[^\]]*\])?", " ", text)
    text = text.replace("{", "").replace("}", "")
    return re.sub(r"\s+", " ", text).strip()


def _extract_authors(text):
    people = []
    # revtex and friends allow several \author{} commands; collect them all.
    remaining = text
    while True:
        block = _brace_argument(remaining, "author")
        if block is None:
            break
        remaining = remaining.replace("\\author{%s}" % block, "", 1)
        for chunk in re.split(r"\\and\b|,|;", block):
            cleaned = _clean_tex(chunk)
            cleaned = re.sub(r"[\d*†‡§]+$", "", cleaned).strip()
            person = _split_person(cleaned)
            if person:
                people.append(person)
        if len(people) > 50:
            break
    return people


def _extract_from_tex(text):
    """Conservative proposals from common TeX patterns. Missing values stay
    missing — nothing is guessed."""
    text = _strip_comments(text)
    fields = {}

    title = _clean_tex(_brace_argument(text, "title") or "")
    if title:
        fields["title"] = title

    authors = _extract_authors(text)
    if authors:
        fields["authors"] = authors

    abstract_match = re.search(
        r"\\begin\{abstract\}(.*?)\\end\{abstract\}", text, re.DOTALL)
    if abstract_match:
        abstract = _clean_tex(abstract_match.group(1))
        if abstract:
            fields["abstract"] = abstract

    keywords_raw = (_brace_argument(text, "keywords")
                    or _brace_argument(text, "keyword"))
    if keywords_raw:
        keywords = [_clean_tex(k) for k in re.split(r"[,;]", keywords_raw)]
        keywords = [k for k in keywords if k]
        if keywords:
            fields["tags"] = keywords[:MAX_TAGS]

    doi = normalize_doi(_brace_argument(text, "doi") or "")
    if not doi:
        in_text = DOI_IN_TEXT_RE.search(text)
        if in_text:
            doi = normalize_doi(in_text.group(1))
    if doi:
        fields["doi"] = doi

    return fields


# ------------------------------------------------------------- ZIP handling

def _safe_zip_entries(archive):
    """Validate every entry BEFORE reading anything. Raises ImportError_ on
    traversal, absolute paths, symlinks, depth, count, or size abuse."""
    entries = archive.infolist()
    if len(entries) > MAX_ZIP_ENTRIES:
        raise ImportError_("The archive contains too many files "
                           "(limit %d)." % MAX_ZIP_ENTRIES)
    total_uncompressed = 0
    safe = []
    for info in entries:
        name = info.filename
        if "\\" in name:
            name = name.replace("\\", "/")
        if name.startswith("/") or re.match(r"^[A-Za-z]:", name):
            raise ImportError_("The archive contains absolute paths and was "
                               "rejected.")
        parts = [p for p in name.split("/") if p not in ("", ".")]
        if ".." in parts:
            raise ImportError_("The archive contains unsafe relative paths "
                               "and was rejected.")
        if len(parts) > MAX_ZIP_DEPTH:
            raise ImportError_("The archive nests folders too deeply and was "
                               "rejected.")
        # Symlinks could point outside the archive — never follow them.
        if (info.external_attr >> 16) & 0o170000 == 0o120000:
            raise ImportError_("The archive contains symbolic links and was "
                               "rejected.")
        total_uncompressed += info.file_size
        if total_uncompressed > MAX_ZIP_TOTAL_UNCOMPRESSED:
            raise ImportError_("The archive expands beyond the size limit "
                               "and was rejected.")
        if not info.is_dir():
            safe.append((posixpath.normpath("/".join(parts)), info))
    return safe


def _read_member(archive, info, limit):
    with archive.open(info) as handle:
        data = handle.read(limit + 1)
    if len(data) > limit:
        raise ImportError_("A file inside the archive is too large to "
                           "inspect safely.")
    return data.decode("utf-8", errors="replace")


def _choose_main_tex(tex_contents):
    """Score candidates on \\documentclass / \\begin{document}; deterministic
    tie-break by size then name. Returns (path, ranked candidate paths)."""
    scored = []
    for path, content in tex_contents.items():
        score = 0
        if "\\documentclass" in content:
            score += 2
        if "\\begin{document}" in content:
            score += 3
        if score:
            scored.append((-score, -len(content), path))
    if not scored:
        raise ImportError_(
            "No usable TeX document was found (nothing contains "
            "\\documentclass or \\begin{document}).")
    scored.sort()
    ranked = [entry[2] for entry in scored]
    return ranked[0], ranked


def _inline_includes(main_path, tex_contents):
    """Inline \\input/\\include references that resolve INSIDE the archive.
    Bounded depth and file count; unresolved references are left alone."""
    included = []

    def resolve(reference, base_dir):
        candidates = []
        ref = reference.strip().replace("\\", "/")
        for name in (ref, ref + ".tex"):
            candidates.append(posixpath.normpath(posixpath.join(base_dir,
                                                                name)))
            candidates.append(posixpath.normpath(name))
        for candidate in candidates:
            if candidate.startswith(".."):
                continue
            if candidate in tex_contents:
                return candidate
        return None

    def expand(path, depth):
        content = tex_contents[path]
        if depth >= MAX_INCLUDE_DEPTH:
            return content
        base_dir = posixpath.dirname(path)

        def replace(match):
            target = resolve(match.group(1), base_dir)
            if (target is None or target == path
                    or len(included) >= MAX_INCLUDED_FILES
                    or target in included):
                return match.group(0)
            included.append(target)
            return "\n" + expand(target, depth + 1) + "\n"

        return INPUT_RE.sub(replace, content)

    return expand(main_path, 0), included


def _process_zip(data):
    try:
        archive = zipfile.ZipFile(io.BytesIO(data))
    except zipfile.BadZipFile:
        raise ImportError_("This file is not a readable ZIP archive.")
    with archive:
        entries = _safe_zip_entries(archive)

        tex_contents = {}
        bib_texts = []
        for path, info in entries:
            lower = path.lower()
            if lower.endswith(".tex"):
                tex_contents[path] = _read_member(archive, info,
                                                  MAX_TEX_CHARS)
            elif lower.endswith(".bib") and len(bib_texts) < MAX_BIB_FILES:
                bib_texts.append(_read_member(archive, info, MAX_BIB_BYTES))

        main_path, candidates = _choose_main_tex(tex_contents)
        combined, included = _inline_includes(main_path, tex_contents)

    doi_candidates = []
    for bib in bib_texts:
        for match in BIB_DOI_RE.finditer(bib):
            doi = normalize_doi(match.group(1))
            if doi and doi not in doi_candidates:
                doi_candidates.append(doi)
            if len(doi_candidates) >= MAX_DOI_CANDIDATES:
                break

    return combined, {
        "main_file": main_path,
        "main_candidates": candidates,
        "included_files": included,
        "bib_files": len(bib_texts),
        "doi_candidates": doi_candidates,
    }


# --------------------------------------------------------------- the merge

# Fields where the manuscript's own text wins over registry metadata.
_MANUSCRIPT_PREFERRED = ("title", "authors", "abstract")


def _merge_with_crossref(fields, crossref_fields):
    """Source import prefers manuscript title/authors/abstract; DOI metadata
    fills the missing bibliographic fields. Conflicts are surfaced as
    alternatives, never silently resolved."""
    provenance = {key: "manuscript" for key in fields}
    alternatives = {}
    for key, value in crossref_fields.items():
        if key == "tags":
            merged = list(fields.get("tags") or [])
            seen = {t.lower() for t in merged}
            for tag in value:
                if tag.lower() not in seen:
                    merged.append(tag)
                    seen.add(tag.lower())
            fields["tags"] = merged[:MAX_TAGS]
            provenance.setdefault("tags", "manuscript+crossref")
            continue
        if key not in fields:
            fields[key] = value
            provenance[key] = "crossref"
        elif key in _MANUSCRIPT_PREFERRED and fields[key] != value:
            alternatives[key] = [{"source": "crossref", "value": value}]
    return fields, provenance, alternatives


@csrf_protect
def import_manuscript(body):
    """
    Propose draft metadata from a .tex file or Overleaf .zip export
    Handler for POST: /api/import/manuscript

    The upload is processed in memory only and discarded; nothing is stored,
    logged, executed, or sent to third parties (the only outbound call is
    the DOI registry lookup for a DOI found in the manuscript itself).
    """
    denied = _require_session()
    if denied:
        return denied

    body = body or {}
    filename = str(body.get("filename") or "").strip()
    encoded = body.get("content_base64") or ""
    if not filename or not encoded:
        return {"error": "filename and content_base64 are required"}, 400
    if len(encoded) > (MAX_UPLOAD_BYTES * 4) // 3 + 1024:
        return {"error": "The file is too large to import (limit %d MB)."
                         % (MAX_UPLOAD_BYTES // (1024 * 1024))}, 400
    try:
        data = base64.b64decode(encoded, validate=True)
    except Exception:
        return {"error": "The upload could not be decoded."}, 400
    if len(data) > MAX_UPLOAD_BYTES:
        return {"error": "The file is too large to import (limit %d MB)."
                         % (MAX_UPLOAD_BYTES // (1024 * 1024))}, 400

    lower = filename.lower()
    details = {"main_file": filename, "main_candidates": [filename],
               "included_files": [], "bib_files": 0, "doi_candidates": []}
    try:
        if lower.endswith(".tex"):
            combined = data.decode("utf-8", errors="replace")
            if len(combined) > MAX_TEX_CHARS:
                return {"error": "The TeX file is too large to inspect "
                                 "safely."}, 400
        elif lower.endswith(".zip"):
            combined, details = _process_zip(data)
        else:
            return {"error": "Unsupported file type: upload a .tex file or "
                             "an Overleaf .zip export."}, 400
        fields = _extract_from_tex(combined)
    except ImportError_ as e:
        return {"error": str(e)}, 400
    except Exception as e:
        # Never echo manuscript content or parser internals to the client.
        print("Manuscript import failed: %s" % type(e).__name__)
        return {"error": "The manuscript could not be parsed."}, 400

    warnings = []
    provenance = {key: "manuscript" for key in fields}
    alternatives = {}

    manuscript_doi = fields.get("doi")
    if manuscript_doi:
        crossref_fields, failure = _crossref_lookup(manuscript_doi)
        if failure:
            warnings.append("A DOI was found in the manuscript but the "
                            "registry lookup failed; only manuscript fields "
                            "are proposed.")
        else:
            fields, provenance, alternatives = _merge_with_crossref(
                fields, crossref_fields)
    else:
        warnings.append("No DOI was found in the manuscript itself; if this "
                        "work is published, paste its DOI to fill the "
                        "bibliographic fields.")

    if not fields:
        warnings.append("Nothing recognizable was found: no \\title, "
                        "\\author, abstract, keywords, or DOI patterns.")

    # Bib DOIs belong to REFERENCES, not this manuscript — offered only as
    # candidates for the user to look up deliberately.
    doi_candidates = [d for d in details["doi_candidates"]
                      if d != manuscript_doi]

    return {
        "proposal": fields,
        "provenance": provenance,
        "alternatives": alternatives,
        "doi_candidates": doi_candidates,
        "main_file": details["main_file"],
        "main_candidates": details["main_candidates"],
        "included_files": details["included_files"],
        "bib_files": details["bib_files"],
        "warnings": warnings,
    }, 200
