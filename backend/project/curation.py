"""Deterministic RCC folder analysis for assisted curation.

One endpoint (wired through swagger.yml):
- POST /api/curation/analyze-folder   inventory + classify a file-server folder

The response is an ANALYSIS ONLY: nothing is written to MongoDB, drafts, disk
or published metadata, and no candidate becomes a record until the curator
reviews it in the browser and explicitly applies it.

Safety model:
- The browser never supplies a fetchable URL. It supplies a path that must sit
  under one of the server's OWN allowed file-server roots (scheme + host +
  base path pinned by QRESP_FILESERVER_ROOTS, defaulting to the RCC root the
  curator picker already offers). Anything else — another host, a scheme
  change, credentials in the URL, a query/fragment, `..` or percent-encoded
  traversal — is refused before a single request is made.
- Discovery is bounded: depth, directory requests, file count, per-file bytes
  and a request timeout, with an explicit `truncated` flag when a cap is hit.
- TLS verification is ON by default. The legacy Dtree scraper passes
  verify=False unconditionally; that is deliberately NOT inherited here. A
  narrow, environment-only, default-off, per-host opt-in exists for the one
  known RCC host whose certificate has expired
  (QRESP_FILESERVER_INSECURE_TLS_HOSTS) — never settable from the browser.
- Directory contents and source text are never logged.
"""
import json
import os
import posixpath
import re
from urllib.parse import unquote, urljoin, urlparse

import requests
from lxml import html

from project.auth import csrf_protect, get_current_user

# ---- configuration (environment only) --------------------------------------

DEFAULT_FILESERVER_ROOTS = "https://notebook.rcc.uchicago.edu/files"

# Bounded discovery.
MAX_DEPTH = 4
MAX_DIR_REQUESTS = 120
MAX_FILES = 2000
REQUEST_TIMEOUT = 15
# Text we are willing to read from the server for evidence (manifests,
# READMEs, script headers). Everything else is classified by name only.
MAX_TEXT_FILES = 30
MAX_TEXT_BYTES = 200000
MAX_SCRIPT_HEADER_CHARS = 4000
MAX_EVIDENCE_TEXT_CHARS = 20000

CHART_EXTENSIONS = (".png", ".jpg", ".jpeg", ".gif")
DATASET_EXTENSIONS = (
    ".csv", ".tsv", ".json", ".xyz", ".h5", ".hdf5", ".nc", ".npy", ".npz",
    ".dat", ".txt", ".cube", ".xml", ".yaml", ".yml", ".pdb", ".cif", ".log",
)
SCRIPT_EXTENSIONS = (".py", ".ipynb", ".sh", ".bash", ".r", ".jl", ".m")
NOTEBOOK_EXTENSIONS = (".ipynb",)
PATCH_EXTENSIONS = (".patch", ".diff")

MANIFEST_NAMES = (
    "requirements.txt", "requirements.lock.txt", "environment.yml",
    "environment.yaml", "pyproject.toml", "setup.py", "package.json",
    "package-lock.json", "yarn.lock", "qresp.ini",
)
README_NAMES = ("readme", "readme.md", "readme.txt", "readme.rst")

# Manifest/readme names that are NOT dataset candidates even though the
# extension matches.
NON_DATASET_NAMES = set(MANIFEST_NAMES) | set(README_NAMES)


def _env_list(key, default=""):
    raw = os.environ.get("QRESP_" + key)
    if raw is None:
        raw = default
    return [item.strip() for item in raw.split(",") if item.strip()]


def _allowed_roots():
    """The file-server roots this deployment will read. Environment only."""
    roots = []
    for root in _env_list("FILESERVER_ROOTS", DEFAULT_FILESERVER_ROOTS):
        parsed = urlparse(root)
        if parsed.scheme in ("http", "https") and parsed.netloc:
            roots.append(root.rstrip("/"))
    return roots


def _insecure_tls_hosts():
    """Hosts allowed to skip TLS verification. Default: NONE."""
    return {host.lower() for host in _env_list("FILESERVER_INSECURE_TLS_HOSTS")}


class FolderError(Exception):
    """User-facing analysis failure: the message is safe to return."""


# ---- URL validation --------------------------------------------------------

_TRAVERSAL_RE = re.compile(r"(^|/)\.\.(/|$)")


def resolve_folder_url(raw):
    """Validate a browser-supplied folder path against the allowed roots.

    Returns the normalized absolute URL (no trailing slash) or raises
    FolderError. Nothing is fetched here.
    """
    candidate = str(raw or "").strip()
    if not candidate:
        raise FolderError("Select and save a file server folder first.")
    roots = _allowed_roots()
    if not roots:
        raise FolderError("No file server root is configured on this server.")

    # A relative path is resolved against the FIRST configured root; an
    # absolute URL must match a configured root exactly.
    if "://" in candidate:
        parsed = urlparse(candidate)
        if parsed.scheme not in ("http", "https"):
            raise FolderError("Only http(s) file server paths are allowed.")
        if parsed.username or parsed.password or "@" in parsed.netloc:
            raise FolderError("Credentials are not allowed in the folder URL.")
        if parsed.query or parsed.fragment:
            raise FolderError(
                "Query strings and fragments are not allowed in the folder "
                "URL.")
        normalized = "%s://%s%s" % (parsed.scheme, parsed.netloc, parsed.path)
    else:
        normalized = urljoin(roots[0] + "/", candidate.lstrip("/"))
        parsed = urlparse(normalized)

    # Percent-encoded traversal must be caught after decoding, and the
    # decoded form must not smuggle a new host or scheme either.
    decoded_path = unquote(parsed.path)
    if _TRAVERSAL_RE.search(decoded_path) or _TRAVERSAL_RE.search(parsed.path):
        raise FolderError("Relative parent paths are not allowed.")
    if "://" in decoded_path or "\\" in decoded_path:
        raise FolderError("That folder path is not valid.")

    clean_path = posixpath.normpath(decoded_path)
    if clean_path in ("", "."):
        clean_path = "/"
    normalized = "%s://%s%s" % (parsed.scheme, parsed.netloc, clean_path)
    normalized = normalized.rstrip("/")

    for root in roots:
        if normalized == root or normalized.startswith(root + "/"):
            return normalized
    raise FolderError(
        "That folder is outside the file server roots this Qresp server is "
        "allowed to read.")


def _verify_for(url):
    host = (urlparse(url).hostname or "").lower()
    return host not in _insecure_tls_hosts()


# ---- bounded directory walk ------------------------------------------------

_HEADERS = {"User-Agent": "Qresp/2.0 (curation folder analysis)"}


def _list_directory(url):
    """One Apache-style autoindex listing -> (dirs, files) of names."""
    response = requests.get(url + "/", headers=_HEADERS,
                            timeout=REQUEST_TIMEOUT, verify=_verify_for(url))
    response.raise_for_status()
    tree = html.fromstring(response.content)
    anchors = tree.xpath("//table//tr/td[2]/a") or tree.xpath("//a[@href]")
    dirs, files = [], []
    for anchor in anchors:
        href = (anchor.get("href") or "").strip()
        if not href or href.startswith(("?", "#", "/")) or "://" in href:
            continue
        name = unquote(href)
        if name in ("../", "..") or "Parent Directory" in (
                anchor.text_content() or ""):
            continue
        if name.endswith("/"):
            dirs.append(name.rstrip("/"))
        else:
            files.append(name)
    return dirs, files


def walk_folder(root_url, list_directory=None):
    """Bounded recursive inventory. Returns (files, dirs, warnings, truncated).

    `files`/`dirs` are normalized RELATIVE paths (posix, no leading slash) so
    they line up with the paths the curator forms and FileTree already use.
    """
    lister = list_directory or _list_directory
    files, dirs, warnings = [], [], []
    truncated = False
    requests_made = 0
    queue = [("", 0)]

    while queue:
        relative, depth = queue.pop(0)
        if requests_made >= MAX_DIR_REQUESTS:
            truncated = True
            warnings.append(
                "Stopped after %d directory listings; deeper folders were not "
                "inspected." % MAX_DIR_REQUESTS)
            break
        url = root_url if not relative else root_url + "/" + relative
        try:
            child_dirs, child_files = lister(url)
        except Exception as e:
            # Never echo the server's body; report the shape of the failure.
            print("Folder listing failed (%s) at depth %d"
                  % (type(e).__name__, depth))
            warnings.append("A folder could not be listed and was skipped.")
            continue
        requests_made += 1

        for name in child_files:
            path = ("%s/%s" % (relative, name)) if relative else name
            if len(files) >= MAX_FILES:
                truncated = True
                break
            files.append(path)
        if len(files) >= MAX_FILES:
            truncated = True
            warnings.append(
                "Stopped after %d files; the folder is larger than Qresp will "
                "inspect in one pass." % MAX_FILES)
            break

        for name in child_dirs:
            path = ("%s/%s" % (relative, name)) if relative else name
            dirs.append(path)
            if depth + 1 <= MAX_DEPTH:
                queue.append((path, depth + 1))
            else:
                truncated = True

    if truncated and not warnings:
        warnings.append(
            "Only the first %d folder levels were inspected." % MAX_DEPTH)
    return files, dirs, warnings, truncated


# ---- deterministic classification ------------------------------------------

def _ext(path):
    return posixpath.splitext(path)[1].lower()


def _stem(path):
    return posixpath.splitext(posixpath.basename(path))[0]


def _tokens(name):
    parts = [p for p in re.split(r"[^A-Za-z0-9]+", name) if len(p) > 1]
    return [p for p in parts if not p.isdigit()][:8]


def _related_files(stem, files, exclude):
    """Conservative basename/token matching for a chart's related files."""
    related = []
    stem_lower = stem.lower()
    for path in files:
        if path in exclude or _ext(path) in CHART_EXTENSIONS:
            continue
        other = _stem(path).lower()
        if other == stem_lower or (
                len(stem_lower) >= 4 and (
                    other.startswith(stem_lower)
                    or stem_lower.startswith(other) and len(other) >= 4)):
            related.append(path)
        if len(related) >= 5:
            break
    return related


def _candidate(kind, index, proposal, evidence, confidence, paths,
               needs_input=None):
    return {
        "id": "%s-%d" % (kind, index),
        "kind": kind,
        "confidence": confidence,
        "evidence": evidence,
        "needs_input": needs_input or [],
        "paths": paths,
        "proposal": proposal,
    }


def classify_charts(files):
    """Image files -> chart candidates. Only imageFile is certain."""
    candidates = []
    images = [p for p in files if _ext(p) in CHART_EXTENSIONS]
    notebooks = [p for p in files if _ext(p) in NOTEBOOK_EXTENSIONS]
    for index, path in enumerate(sorted(images)):
        stem = _stem(path)
        related = _related_files(stem, files, exclude={path})
        notebook = ""
        for candidate_nb in notebooks:
            if _stem(candidate_nb).lower() == stem.lower():
                notebook = candidate_nb
                break
        evidence = ["%s is a %s image" % (path, _ext(path))]
        if related:
            evidence.append(
                "Related files matched by name only (verify): %s"
                % ", ".join(related))
        if notebook:
            evidence.append("Notebook with the same basename: %s" % notebook)
        candidates.append(_candidate(
            "chart", index,
            {
                # Deterministic.
                "imageFile": path,
                "files": related,
                "notebookFile": notebook,
                # Proposals the curator must confirm.
                "number": index + 1,
                "caption": "",
                "properties": _tokens(stem),
                "extraFields": [],
            },
            evidence,
            "high" if not related else "medium",
            [path] + related,
            needs_input=["caption", "number"],
        ))
    return candidates


def classify_datasets(files, dirs):
    """Data files grouped conservatively by their directory."""
    candidates = []
    grouped = {}
    for path in files:
        name = posixpath.basename(path).lower()
        if name in NON_DATASET_NAMES or _ext(path) in SCRIPT_EXTENSIONS:
            continue
        if _ext(path) not in DATASET_EXTENSIONS:
            continue
        grouped.setdefault(posixpath.dirname(path), []).append(path)

    for index, (directory, members) in enumerate(sorted(grouped.items())):
        label = directory or "the folder root"
        candidates.append(_candidate(
            "dataset", index,
            {
                "files": sorted(members),
                # Deliberately generic: Qresp never claims scientific meaning
                # it has no evidence for.
                "readme": "Files from %s" % label,
                "URLs": [],
                "extraFields": [],
            },
            ["%d data file(s) in %s: %s"
             % (len(members), label,
                ", ".join(posixpath.basename(m) for m in sorted(members)[:5]))],
            "medium",
            sorted(members),
            needs_input=["readme"],
        ))
    return candidates


def classify_scripts(files, headers=None):
    """Script files; descriptions come from a local docstring when present."""
    headers = headers or {}
    candidates = []
    scripts = [p for p in files if _ext(p) in SCRIPT_EXTENSIONS]
    for index, path in enumerate(sorted(scripts)):
        docstring = headers.get(path) or ""
        if docstring:
            readme = docstring
            evidence = ["Description taken from the file's own header/docstring"]
            needs = []
        else:
            readme = "Script %s" % posixpath.basename(path)
            evidence = ["%s is a %s script; no docstring or header comment "
                        "was found" % (path, _ext(path))]
            needs = ["readme"]
        candidates.append(_candidate(
            "script", index,
            {
                "files": [path],
                "readme": readme,
                "URLs": [],
                "extraFields": [],
            },
            evidence,
            "high",
            [path],
            needs_input=needs,
        ))
    return candidates


# ---- manifest-driven tools -------------------------------------------------

_REQUIREMENT_RE = re.compile(
    r"^\s*([A-Za-z0-9][A-Za-z0-9._-]*)\s*(?:\[[^\]]*\])?\s*==\s*"
    r"([A-Za-z0-9][A-Za-z0-9._+-]*)\s*$")
_CONDA_RE = re.compile(
    r"^\s*-\s*([A-Za-z0-9][A-Za-z0-9._-]*)\s*=+\s*"
    r"([0-9][A-Za-z0-9._+-]*)\s*$")
_PYTHON_IMPORT_RE = re.compile(
    r"^\s*(?:import|from)\s+([A-Za-z_][A-Za-z0-9_]*)", re.MULTILINE)


def parse_manifest(path, text):
    """Manifest text -> [(packageName, version, evidence)] with EXACT versions
    only. Anything without a pinned version is not a tool."""
    name = posixpath.basename(path).lower()
    found = []
    if name in ("requirements.txt", "requirements.lock.txt"):
        for line in (text or "").splitlines():
            if line.strip().startswith("#"):
                continue
            match = _REQUIREMENT_RE.match(line)
            if match:
                found.append((match.group(1), match.group(2),
                              "pinned in %s" % path))
    elif name in ("environment.yml", "environment.yaml"):
        for line in (text or "").splitlines():
            match = _CONDA_RE.match(line)
            if match:
                found.append((match.group(1), match.group(2),
                              "pinned in %s" % path))
    elif name == "package.json":
        try:
            data = json.loads(text or "{}")
        except Exception:
            return found
        for section in ("dependencies", "devDependencies"):
            for package, version in (data.get(section) or {}).items():
                if isinstance(version, str) and version.strip():
                    found.append((package, version.strip(),
                                  "declared in %s (%s)" % (path, section)))
    elif name == "pyproject.toml":
        project = re.search(r"^\s*name\s*=\s*[\"']([^\"']+)[\"']",
                            text or "", re.MULTILINE)
        version = re.search(r"^\s*version\s*=\s*[\"']([^\"']+)[\"']",
                            text or "", re.MULTILINE)
        if project and version:
            found.append((project.group(1), version.group(1),
                          "project metadata in %s" % path))
        for line in (text or "").splitlines():
            match = re.match(r"^\s*[\"']([A-Za-z0-9._-]+)\s*==\s*"
                             r"([A-Za-z0-9._+-]+)[\"']", line)
            if match:
                found.append((match.group(1), match.group(2),
                              "pinned in %s" % path))
    elif name == "setup.py":
        project = re.search(r"name\s*=\s*[\"']([^\"']+)[\"']", text or "")
        version = re.search(r"version\s*=\s*[\"']([^\"']+)[\"']", text or "")
        if project and version:
            found.append((project.group(1), version.group(1),
                          "setup() metadata in %s" % path))
    return found


def classify_tools(manifests, files):
    """Software tools ONLY from explicit machine-readable package+version."""
    candidates = []
    seen = set()
    patches = [p for p in files if _ext(p) in PATCH_EXTENSIONS]
    index = 0
    for path, text in sorted(manifests.items()):
        for package, version, evidence in parse_manifest(path, text):
            key = (package.lower(), version)
            if key in seen:
                continue
            seen.add(key)
            candidates.append(_candidate(
                "tool", index,
                {
                    "kind": "software",
                    "packageName": package,
                    "version": version,
                    "executableName": "",
                    "patches": patches,
                    "description": "",
                    "urls": "",
                    "extraFields": [],
                },
                ["%s %s %s" % (package, version, evidence)],
                "high",
                [path],
                needs_input=["description"],
            ))
            index += 1
    return candidates


def possible_dependency_hints(script_texts):
    """Python imports are a REVIEW HINT only: an import name does not reliably
    identify a distribution package, let alone a version, so it never becomes
    a Tool candidate."""
    modules = set()
    for text in script_texts.values():
        for match in _PYTHON_IMPORT_RE.finditer(text or ""):
            module = match.group(1)
            if module not in ("os", "sys", "re", "json", "math", "time"):
                modules.add(module)
    return sorted(modules)[:20]


# ---- the endpoint ----------------------------------------------------------

def _fetch_text(url):
    response = requests.get(url, headers=_HEADERS, timeout=REQUEST_TIMEOUT,
                            verify=_verify_for(url), stream=True)
    response.raise_for_status()
    content = response.raw.read(MAX_TEXT_BYTES + 1, decode_content=True)
    if content is None:
        content = b""
    return content[:MAX_TEXT_BYTES].decode("utf-8", errors="replace")


def _script_header(text):
    """A leading module docstring or comment block, bounded."""
    snippet = (text or "")[:MAX_SCRIPT_HEADER_CHARS]
    doc = re.search(r'^\s*(?:#!.*\n)?\s*(?:"""|\'\'\')(.*?)(?:"""|\'\'\')',
                    snippet, re.DOTALL)
    if doc:
        return re.sub(r"\s+", " ", doc.group(1)).strip()[:500]
    comments = []
    for line in snippet.splitlines():
        stripped = line.strip()
        if stripped.startswith("#!"):
            continue
        if stripped.startswith("#"):
            comments.append(stripped.lstrip("#").strip())
        elif stripped:
            break
    return re.sub(r"\s+", " ", " ".join(comments)).strip()[:500]


def analyze_folder_tree(files, dirs, texts):
    """Pure classification over an inventory — the unit under test."""
    manifests = {path: text for path, text in texts.items()
                 if posixpath.basename(path).lower() in MANIFEST_NAMES}
    script_texts = {path: text for path, text in texts.items()
                    if _ext(path) in SCRIPT_EXTENSIONS}
    headers = {path: _script_header(text)
               for path, text in script_texts.items()}
    headers = {path: header for path, header in headers.items() if header}

    charts = classify_charts(files)
    datasets = classify_datasets(files, dirs)
    scripts = classify_scripts(files, headers)
    tools = classify_tools(manifests, files)

    claimed = set()
    for group in (charts, datasets, scripts, tools):
        for candidate in group:
            claimed.update(candidate["paths"])
    unclassified = [p for p in sorted(files) if p not in claimed]

    return {
        "charts": charts,
        "datasets": datasets,
        "scripts": scripts,
        "tools": tools,
        "unclassified": unclassified[:200],
        "possible_dependencies": possible_dependency_hints(script_texts),
    }


@csrf_protect
def analyze_folder(body):
    """
    Inventory and classify a file-server folder for assisted curation
    Handler for POST: /api/curation/analyze-folder

    Read-only: nothing is stored, published, or logged beyond counts.
    """
    user = get_current_user()
    if not user:
        return {"error": "authentication required"}, 401

    try:
        root_url = resolve_folder_url((body or {}).get("path"))
    except FolderError as e:
        return {"error": str(e)}, 400

    try:
        files, dirs, warnings, truncated = walk_folder(root_url)
    except Exception as e:
        print("Folder analysis failed: %s" % type(e).__name__)
        return {"error": "The folder could not be read. Check that the path "
                         "is correct and reachable."}, 502

    if not files and not dirs:
        return {"error": "No files were found in that folder."}, 404

    # Bounded evidence reads: manifests first, then script headers.
    texts = {}
    wanted = [p for p in files
              if posixpath.basename(p).lower() in MANIFEST_NAMES]
    wanted += [p for p in files if _ext(p) in SCRIPT_EXTENSIONS
               and _ext(p) != ".ipynb"]
    for path in wanted[:MAX_TEXT_FILES]:
        try:
            texts[path] = _fetch_text(root_url + "/" + path)
        except Exception as e:
            print("Evidence read skipped (%s)" % type(e).__name__)
    if len(wanted) > MAX_TEXT_FILES:
        warnings.append(
            "Only the first %d manifest/script files were read for evidence."
            % MAX_TEXT_FILES)

    result = analyze_folder_tree(files, dirs, texts)
    counts = {key: len(value) for key, value in result.items()
              if isinstance(value, list)}
    print("Folder analysis: files=%d dirs=%d truncated=%s candidates=%s"
          % (len(files), len(dirs), truncated, counts))

    return {
        "root": root_url,
        "counts": dict(counts, files=len(files), directories=len(dirs)),
        "truncated": truncated,
        "warnings": warnings,
        "candidates": result,
    }, 200
