"""What a script says, in its own code, about the files it reads and writes.

This is a PARSER, not an inference engine. It reads Python source with the
standard library's `ast` module and records one kind of fact:

    this file calls a known I/O function with a literal string path

and nothing else. No model is asked, no name is compared to another name, no
folder layout is interpreted. `dos.py` and `dos.png` are not related by being
called `dos`; they are related when `dos.py` contains `plt.savefig("dos.png")`.

WHY THIS IS DELIBERATELY SMALL. The output becomes a suggested arrow in a
published record of somebody's research. A wrong arrow is worse than a missing
one: the curator has to notice it, and the ones they do not notice become part
of the paper. So every construct whose meaning depends on runtime state --
f-strings, concatenation, variables, config values, environment lookups, glob
patterns, shell commands -- produces NOTHING. Precision is the whole design.

THE CODE IS NEVER RUN. `ast.parse` builds a tree and evaluates none of it, and
this module imports nothing from the source it reads.

A path is only reported when it resolves to a file that the folder scan
actually found, so a literal naming a file that is not there is dropped rather
than guessed at.
"""
import ast
import json
import posixpath

# ---------------------------------------------------------------------------
# WHAT IS UNDERSTOOD
#
# Fully-qualified names, resolved through import aliases (`import pandas as
# pd` makes `pd.read_csv` a `pandas.read_csv`). A call whose name cannot be
# resolved this way is not guessed at.

READ_CALLS = {
    "pandas.read_csv",
    "pandas.read_table",
    "pandas.read_excel",
    "pandas.read_json",
    "pandas.read_parquet",
    "numpy.load",
    "numpy.loadtxt",
    "numpy.genfromtxt",
    "xarray.open_dataset",
    "scipy.io.loadmat",
}

WRITE_CALLS = {
    "matplotlib.pyplot.savefig",
    "numpy.save",
    "numpy.savez",
}

# Methods whose NAME alone is the evidence, whatever they are called on.
#
# `fig.savefig(...)` and `df.to_csv(...)` are the ordinary way these libraries
# are used, and the receiver is a local variable that no static reading can
# resolve. These four names are not used for anything else in practice, and
# the argument is still required to be a literal path that exists in the
# folder -- so a false positive would need a method of the same name, called
# with a literal string, naming a real file in the scan.
WRITE_METHODS = {
    "savefig": "figure.savefig",
    "to_csv": "DataFrame.to_csv",
    "to_parquet": "DataFrame.to_parquet",
    "to_excel": "DataFrame.to_excel",
}

# `open(path)` and `open(path, "r")` are reads. Any mode containing w, a, x or
# + is not reported at all: a file opened for writing through the builtin is
# usually written through a variable further down, and reporting the open as a
# write would claim more than the line says.
READ_OPEN_MODES = ("r", "rb", "rt", "br", "tr")

# ---------------------------------------------------------------------------
# CAPS. A folder is somebody else's; none of these numbers may be exceeded by
# anything it contains.

MAX_SOURCE_CHARS = 200000
MAX_CELLS = 200
MAX_LINKS_PER_FILE = 40
MAX_LINKS_TOTAL = 200

SCRIPT_SUFFIX = ".py"
NOTEBOOK_SUFFIX = ".ipynb"


def _literal_path(node):
    """The string a node IS, or None if it is anything computed.

    `ast.Constant` and only `ast.Constant`. An f-string is a `JoinedStr`, a
    concatenation is a `BinOp`, a variable is a `Name`, a call is a `Call`:
    none of them say what the path is, and each returns None here.
    """
    if isinstance(node, ast.Constant) and isinstance(node.value, str):
        return node.value
    return None


def _usable_relative(raw):
    """A literal cleaned to a root-relative path, or "" if it is not one.

    Refused: URLs, absolute paths, Windows paths, anything that climbs out of
    the folder, and anything with a glob character in it.
    """
    text = (raw or "").strip()
    if not text:
        return ""
    if "://" in text or text.startswith("~"):
        return ""
    if text.startswith("/") or "\\" in text:
        return ""
    # A drive letter is an absolute path on the machine that ran the code.
    if len(text) > 1 and text[1] == ":":
        return ""
    if any(char in text for char in "*?[]"):
        return ""
    normalized = posixpath.normpath(text)
    if normalized in (".", "..", "") or normalized.startswith(".."):
        return ""
    if normalized.startswith("/"):
        return ""
    return normalized


def _resolve_against(script_path, literal, known_files):
    """Which real file this literal names, or "" if that is not certain.

    A path in code is written relative to whatever directory the code was run
    from, and nothing in the file says which that was. Two readings are
    plausible -- the folder root, and the script's own directory -- so both
    are tried against the files the scan actually found:

      exactly one exists -> that is the file
      neither exists     -> the literal names nothing here; drop it
      BOTH exist         -> genuinely ambiguous; drop it

    The last case is why this returns "" instead of picking one. Guessing
    between two real files is exactly the kind of arrow a curator would have
    to catch.
    """
    relative = _usable_relative(literal)
    if not relative:
        return ""

    from_root = relative if relative in known_files else ""

    here = posixpath.dirname(script_path)
    beside = ""
    if here:
        joined = posixpath.normpath(posixpath.join(here, relative))
        if not joined.startswith("..") and joined in known_files:
            beside = joined

    if from_root and beside and from_root != beside:
        return ""
    return from_root or beside


class _Aliases(ast.NodeVisitor):
    """The names this module bound to which libraries.

    `import pandas as pd` -> pd means pandas
    `import matplotlib.pyplot as plt` -> plt means matplotlib.pyplot
    `import scipy.io` -> scipy means scipy
    `from pandas import read_csv as rc` -> rc means pandas.read_csv

    A name bound any other way -- assigned, passed in, star-imported -- is not
    in here, so calls through it resolve to nothing.
    """

    def __init__(self):
        self.modules = {}   # local name -> dotted module
        self.direct = {}    # local name -> dotted callable

    def visit_Import(self, node):
        for alias in node.names:
            if alias.asname:
                self.modules[alias.asname] = alias.name
            else:
                # `import scipy.io` binds `scipy`.
                self.modules[alias.name.split(".")[0]] = alias.name.split(".")[0]
        self.generic_visit(node)

    def visit_ImportFrom(self, node):
        # A relative import (`from . import x`) says nothing about which
        # library it is, so it binds nothing here.
        if node.level or not node.module:
            self.generic_visit(node)
            return
        for alias in node.names:
            if alias.name == "*":
                continue
            local = alias.asname or alias.name
            self.direct[local] = "%s.%s" % (node.module, alias.name)
        self.generic_visit(node)


def _dotted(node, aliases):
    """The fully-qualified name a call's callee refers to, or "".

    Only through the import table: an attribute chain rooted at a name that
    was never imported resolves to nothing.
    """
    parts = []
    current = node
    while isinstance(current, ast.Attribute):
        parts.append(current.attr)
        current = current.value
    if not isinstance(current, ast.Name):
        return ""
    root = current.id
    parts.reverse()

    if not parts:
        return aliases.direct.get(root) or ""

    module = aliases.modules.get(root)
    if not module:
        return ""
    return ".".join([module] + parts)


def _method_name(node):
    """The bare method name of `something.method(...)`, or ""."""
    if isinstance(node, ast.Attribute):
        return node.attr
    return ""


def _open_is_read(call):
    """Whether a builtin `open` call is opening the file to READ it."""
    mode = None
    if len(call.args) > 1:
        mode = _literal_path(call.args[1])
    for keyword in call.keywords:
        if keyword.arg == "mode":
            mode = _literal_path(keyword.value)
    if mode is None:
        return len(call.args) <= 1 or bool(mode is None and not call.args[1:])
    return mode in READ_OPEN_MODES


def _calls_in(tree):
    for node in ast.walk(tree):
        if isinstance(node, ast.Call):
            yield node


def _facts_from_tree(tree, script_path, known_files, cell, line_offset):
    """Every supported call in one parsed unit, as fact dicts."""
    aliases = _Aliases()
    aliases.visit(tree)

    facts = []
    for call in _calls_in(tree):
        if not call.args:
            continue
        literal = _literal_path(call.args[0])
        if literal is None:
            continue

        qualified = _dotted(call.func, aliases)
        mode = ""
        shown = ""

        if qualified in READ_CALLS:
            mode, shown = "read", qualified
        elif qualified in WRITE_CALLS:
            mode, shown = "write", qualified
        elif qualified == "builtins.open" or (
                isinstance(call.func, ast.Name) and call.func.id == "open"
                and "open" not in aliases.direct):
            if _open_is_read(call):
                mode, shown = "read", "open"
        else:
            method = _method_name(call.func)
            if method in WRITE_METHODS and not qualified:
                mode, shown = "write", WRITE_METHODS[method]

        if not mode:
            continue

        target = _resolve_against(script_path, literal, known_files)
        if not target or target == script_path:
            continue

        facts.append({
            "script": script_path,
            "path": target,
            "mode": mode,
            "call": shown,
            "literal": literal,
            "line": getattr(call, "lineno", 0) + line_offset,
            "cell": cell,
        })
        if len(facts) >= MAX_LINKS_PER_FILE:
            break
    return facts


def _scan_python(path, text, known_files):
    try:
        tree = ast.parse(text)
    except (SyntaxError, ValueError, RecursionError):
        # Python 2, a template, a partial file, something that is not Python
        # at all. One unreadable script skips itself and nothing else.
        return []
    return _facts_from_tree(tree, path, known_files, None, 0)


def _notebook_cells(text):
    """The code cells of a notebook, as source strings.

    Only `cell_type == "code"`, and only the `source`. Outputs are never
    looked at: they hold results, images and sometimes credentials, and none
    of that is evidence about which file a script reads.
    """
    try:
        document = json.loads(text)
    except (ValueError, TypeError):
        return []
    if not isinstance(document, dict):
        return []
    cells = document.get("cells")
    if not isinstance(cells, list):
        return []

    out = []
    for cell in cells[:MAX_CELLS]:
        if not isinstance(cell, dict) or cell.get("cell_type") != "code":
            continue
        source = cell.get("source")
        if isinstance(source, list):
            source = "".join(part for part in source
                             if isinstance(part, str))
        if not isinstance(source, str):
            continue
        out.append(source)
    return out


def _scan_notebook(path, text, known_files):
    facts = []
    aliases_so_far = []
    for index, source in enumerate(_notebook_cells(text), start=1):
        # A notebook's imports usually live in the first cell and are used in
        # later ones, so each cell is parsed with the import lines seen so
        # far prepended. The offset puts the reported line back where the
        # curator will find it: line 1 of the cell is line 1.
        prefix = "\n".join(aliases_so_far)
        combined = (prefix + "\n" + source) if prefix else source
        try:
            tree = ast.parse(combined)
        except (SyntaxError, ValueError, RecursionError):
            # One broken cell skips itself; the rest of the notebook still
            # counts. Jupyter magics (`%matplotlib inline`) land here.
            continue
        offset = -len(aliases_so_far) if aliases_so_far else 0
        facts.extend(
            _facts_from_tree(tree, path, known_files, index, offset))
        for line in source.splitlines():
            stripped = line.strip()
            if stripped.startswith("import ") or stripped.startswith("from "):
                aliases_so_far.append(stripped)
        if len(facts) >= MAX_LINKS_PER_FILE:
            break
    return facts[:MAX_LINKS_PER_FILE]


def scan_sources(sources, known_files):
    """Every file fact these sources state, deduplicated and ordered.

    `sources` maps a relative path to that file's text; `known_files` is the
    set of relative paths the folder scan actually found. Returns a list of
    dicts:

        {script, path, mode: "read"|"write", call, literal, line, cell}

    Deterministic: same folder, same list, same order, every time.
    """
    known = set(known_files or ())
    facts = []
    for path in sorted(sources or {}):
        text = sources.get(path) or ""
        if not isinstance(text, str) or len(text) > MAX_SOURCE_CHARS:
            continue
        lowered = path.lower()
        if lowered.endswith(SCRIPT_SUFFIX):
            facts.extend(_scan_python(path, text, known))
        elif lowered.endswith(NOTEBOOK_SUFFIX):
            facts.extend(_scan_notebook(path, text, known))
        if len(facts) >= MAX_LINKS_TOTAL:
            break

    # The same call written twice, or a path read in two cells, is one fact
    # about the pair. The earliest place it appears is the one shown.
    best = {}
    for fact in facts:
        key = (fact["script"], fact["path"], fact["mode"])
        current = best.get(key)
        if current is None or (fact["cell"] or 0, fact["line"]) < (
                current["cell"] or 0, current["line"]):
            best[key] = fact
    return [best[key] for key in sorted(best)][:MAX_LINKS_TOTAL]
