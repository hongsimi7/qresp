"""What may be shown to a model about a script, and nothing else.

`project/codelinks.py` reads what a script SAYS outright: a literal path in a
known I/O call. Plenty of real work is not written that way --

    python preprocess.py "$INPUT" > data/clean.csv
    python plot.py data/clean.csv figures/result.png

-- and a shell script or a wrapper leaves the static reader with nothing. A
curator can ask a model to look at those lines. This module decides WHAT IT
MAY SEE, which is a much smaller question than what it might be useful for.

THE RULE IS AN ALLOWLIST, not a blocklist. Only these leave the server:

  * the relative path and language of the script's own sources
  * short excerpts from those sources, around the lines that mention a file
  * the line -- or cell and line -- each excerpt came from
  * file-like tokens the static reader could not resolve
  * the id, type and relative path of candidates the folder scan already found

Never: the contents of a dataset, image bytes, notebook OUTPUT, `.env`, a key
of any kind, anything about the account, anything from another folder, or the
paper's text. A line that mentions a credential is dropped whole rather than
trimmed, because a redaction that is 95% right is a leak.

Nothing here calls a provider. It builds a bundle; `curation.py` decides
whether it is ever sent, and only after the curator says so.
"""
import json
import re

PYTHON_SUFFIX = ".py"
NOTEBOOK_SUFFIX = ".ipynb"
SHELL_SUFFIX = ".sh"

SUPPORTED_SUFFIXES = (PYTHON_SUFFIX, NOTEBOOK_SUFFIX, SHELL_SUFFIX)

LANGUAGE = {
    PYTHON_SUFFIX: "python",
    NOTEBOOK_SUFFIX: "notebook",
    SHELL_SUFFIX: "shell",
}

# ---------------------------------------------------------------------------
# CAPS. Every one of these is a number a curator would recognise as small.
# The point is not to fit a budget; it is that a request can never grow into
# "most of somebody's repository".

MAX_SOURCES = 5
MAX_EXCERPTS = 12
MAX_EXCERPT_LINES = 3
MAX_LINE_CHARS = 200
MAX_TOTAL_CHARS = 6000
MAX_TOKENS = 20
MAX_CANDIDATES = 60
MAX_SOURCE_CHARS = 200000
MAX_CELLS = 200

# A line mentioning any of these is not sent, in any form. The word may be in
# a comment, a variable name, a URL or an argument; none of those is worth
# the risk of being wrong about which.
SENSITIVE = (
    "password", "passwd", "secret", "token", "api_key", "apikey",
    "api-key", "access_key", "accesskey", "private_key", "privatekey",
    "credential", "auth", "bearer", "ssh-rsa", "begin rsa", "begin openssh",
    "begin private key", "aws_", "client_id", "client_secret",
)

# A long unbroken run of key-ish characters is replaced wherever it appears.
# This is belt-and-braces behind the line rule above, not the main defence.
LONG_SECRET = re.compile(r"[A-Za-z0-9+/_-]{32,}={0,2}")

# Something shaped like a file: a name with an extension, no spaces. It is
# deliberately loose -- this is what gets ASKED about, never what gets
# believed, and the answer is checked against the real scan afterwards.
PATHY = re.compile(r"[A-Za-z0-9_][A-Za-z0-9_./+-]*\.[A-Za-z0-9]{1,8}\b")

# Tokens that are shaped like files but are not the kind of file this asks
# about: the interpreter, the module, the requirements list.
UNINTERESTING = frozenset((
    "requirements.txt", "setup.py", "setup.cfg", "pyproject.toml",
    "environment.yml", "conda.yml", "makefile", "dockerfile", ".env",
))


def language_of(path):
    """The language a file's name claims, or "" when it is not one we read."""
    lowered = str(path or "").lower()
    for suffix in SUPPORTED_SUFFIXES:
        if lowered.endswith(suffix):
            return LANGUAGE[suffix]
    return ""


def _safe_line(text):
    """One line, or "" if it is not safe to show.

    Dropped whole when it mentions anything credential-shaped. Long key-like
    runs are replaced even in lines that survive, and every line is truncated:
    a 4000-character generated line is not evidence of anything.
    """
    line = str(text or "").replace("\t", "    ").rstrip()
    if not line.strip():
        return ""
    lowered = line.lower()
    if any(word in lowered for word in SENSITIVE):
        return ""
    line = LONG_SECRET.sub("[REDACTED]", line)
    if len(line) > MAX_LINE_CHARS:
        line = line[:MAX_LINE_CHARS - 1] + "…"
    return line


def _tokens_in(line):
    out = []
    for match in PATHY.findall(line or ""):
        token = match.strip(".,;:\"')(")
        if not token or token.lower() in UNINTERESTING:
            continue
        # A URL or an absolute path is not a file in the scanned folder.
        if "://" in line and token in line.split("://", 1)[1][:len(token) + 40]:
            continue
        if token.startswith("/") or token.startswith("~"):
            continue
        out.append(token)
    return out


def _cells_of(text):
    """A notebook's code cells, or None if it is not a notebook we can read."""
    try:
        document = json.loads(text)
    except (ValueError, TypeError):
        return None
    if not isinstance(document, dict):
        return None
    cells = document.get("cells")
    if not isinstance(cells, list):
        return None
    out = []
    for index, cell in enumerate(cells[:MAX_CELLS], start=1):
        if not isinstance(cell, dict) or cell.get("cell_type") != "code":
            continue
        source = cell.get("source")
        if isinstance(source, list):
            source = "".join(part for part in source if isinstance(part, str))
        if not isinstance(source, str):
            continue
        # `source` only. `outputs` holds results, images, and sometimes
        # whatever a notebook printed while debugging a login.
        out.append((index, source))
    return out


def _windows(lines, wanted):
    """Line numbers grouped into small windows around the wanted lines."""
    picked = sorted(set(wanted))
    windows = []
    for number in picked:
        if windows and number - windows[-1][-1] < MAX_EXCERPT_LINES:
            if number not in windows[-1]:
                windows[-1].append(number)
            continue
        windows.append([number])
    return [w[:MAX_EXCERPT_LINES] for w in windows]


def _from_text(path, text, cell, resolved, start_index):
    """Excerpts and tokens from one unit of source."""
    lines = str(text or "").splitlines()
    interesting = []
    tokens = []
    for number, raw in enumerate(lines, start=1):
        safe = _safe_line(raw)
        if not safe:
            continue
        found = [token for token in _tokens_in(safe) if token not in resolved]
        if not found:
            continue
        interesting.append(number)
        tokens.extend(found)

    excerpts = []
    for window in _windows(lines, interesting):
        body = []
        for number in window:
            safe = _safe_line(lines[number - 1])
            if safe:
                body.append(safe)
        if not body:
            continue
        excerpts.append({
            "id": "e%d" % (start_index + len(excerpts) + 1),
            "path": path,
            "line": window[0],
            "cell": cell,
            "text": "\n".join(body),
        })
    return excerpts, tokens


def build_manifest(sources, resolved_paths, candidates):
    """Everything a model may be shown about ONE script, and no more.

    `sources` maps a relative path to its text; `resolved_paths` are the paths
    the static reader already tied down, so the model is asked about what is
    left rather than about what is already known; `candidates` are the files
    the folder scan really found, as {id, type, path}.

    Returns the bundle plus a SUMMARY the curator is shown before any of it
    is sent -- the same numbers, from the same object, so the consent screen
    cannot describe something other than what goes.
    """
    resolved = set(resolved_paths or ())
    excerpts = []
    tokens = []
    used = []

    for path in sorted(sources or {})[:MAX_SOURCES]:
        text = sources.get(path)
        if not isinstance(text, str) or len(text) > MAX_SOURCE_CHARS:
            continue
        language = language_of(path)
        if not language:
            continue
        used.append({"path": path, "language": language})

        if language == "notebook":
            cells = _cells_of(text)
            if cells is None:
                continue
            for cell_number, source in cells:
                found, seen = _from_text(
                    path, source, cell_number, resolved, len(excerpts))
                excerpts.extend(found)
                tokens.extend(seen)
        else:
            found, seen = _from_text(path, text, None, resolved, len(excerpts))
            excerpts.extend(found)
            tokens.extend(seen)

        if len(excerpts) >= MAX_EXCERPTS:
            break

    excerpts = excerpts[:MAX_EXCERPTS]

    # The whole bundle is bounded by characters as well as by count, so one
    # pathological file cannot make a large request on its own.
    total = 0
    bounded = []
    for excerpt in excerpts:
        total += len(excerpt["text"])
        if total > MAX_TOTAL_CHARS:
            break
        bounded.append(excerpt)

    kept = {excerpt["id"] for excerpt in bounded}
    unresolved = sorted({token for token in tokens if token not in resolved})

    manifest = {
        "sources": used,
        "excerpts": bounded,
        "unresolved_paths": unresolved[:MAX_TOKENS],
        # Datasets and figures only, and only ones with a path. A model that
        # is never shown a Tool cannot suggest a relationship to one, which
        # is a cheaper guarantee than checking its answer for that.
        "candidates": [
            {"id": item.get("id", ""), "type": item.get("type", ""),
             "path": item.get("path", "")}
            for item in (candidates or [])[:MAX_CANDIDATES]
            if item and item.get("path")
            and item.get("type") in ("dataset", "chart")
        ],
    }
    summary = {
        "sources": [entry["path"] for entry in used],
        "excerpt_count": len(bounded),
        "candidate_count": len(manifest["candidates"]),
        "unresolved_count": len(manifest["unresolved_paths"]),
        # What the excerpts actually are, so "some code will be sent" can be
        # read rather than taken on trust.
        "excerpts": [
            {"path": entry["path"], "line": entry["line"],
             "cell": entry["cell"], "text": entry["text"]}
            for entry in bounded
        ],
    }
    assert kept == {entry["id"] for entry in bounded}
    return manifest, summary
