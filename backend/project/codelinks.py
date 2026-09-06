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
import re

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

# Methods that write a file -- and the KIND OF OBJECT each one has to be
# called on for that to be what it means.
#
# `fig.savefig(...)` and `df.to_csv(...)` are the ordinary way these libraries
# are used, and the receiver is a local variable. Taking the method name as
# proof was wrong: `savefig` and `to_csv` are ordinary English method names,
# and a project with `class Report: def savefig(self, path)` would have had
# its report writer read as a matplotlib figure and offered to the curator as
# `Script -> Figure`. A name is not provenance.
#
# So the receiver has to be traced back to a call that PRODUCES that kind of
# object, in this same file, through a library that was actually imported.
# Anything else -- a parameter, a loop variable, an attribute, a return value
# from an unknown function -- has no provenance and writes nothing here.
WRITE_METHODS = {
    "savefig": ("figure", "figure.savefig"),
    "to_csv": ("frame", "DataFrame.to_csv"),
    "to_parquet": ("frame", "DataFrame.to_parquet"),
    "to_excel": ("frame", "DataFrame.to_excel"),
}

# The calls that produce each kind. Every one is a fully-qualified name, so it
# only counts when the library it belongs to was imported and the alias
# resolves -- `plt.subplots()` is a figure because `plt` is matplotlib.pyplot,
# not because it is called `plt`.
FIGURE_PRODUCERS = {
    "matplotlib.pyplot.figure",
    "matplotlib.pyplot.subplots",
    "matplotlib.figure.Figure",
}

# A DataFrame comes off a reader or a constructor. Reshaping methods
# (`df.dropna()`, `df.groupby(...).mean()`) are deliberately NOT followed:
# they are calls on an object whose own provenance would have to be carried
# through a chain, and a chain is where a wrong answer would come from.
FRAME_PRODUCERS = {
    "pandas.DataFrame",
    "pandas.Series",
    "pandas.read_csv",
    "pandas.read_table",
    "pandas.read_excel",
    "pandas.read_json",
    "pandas.read_parquet",
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
SHELL_SUFFIX = ".sh"

# ---------------------------------------------------------------------------
# WHAT A SHELL SCRIPT SAYS IT RUNS.
#
# A wrapper is usually the only thing recorded as "the script", and everything
# that actually reads a file is one line down:
#
#     python scripts/plot.py
#
# That line is as literal as any `read_csv`, and reading it is parsing, not
# guessing. What is NOT read is anything the line does not fully state --
# `python "$SCRIPT"`, a glob, an `eval`, a `make` target. Those name a file
# only at run time, and this module's whole rule is that a name has to be in
# the file to be believed.

# Interpreters, with or without a path: `python`, `python3`, `/usr/bin/python`.
_PY_RUNNERS = ("python", "python2", "python3", "ipython", "ipython3")
_SH_RUNNERS = ("bash", "sh", "zsh", "dash", "ksh")

# Anything on a line that means it is decided elsewhere. One of these and the
# line is not read at all -- not the part before it, not the part after.
_DYNAMIC = ("$", "`", "*", "?", "[", "]", "{", "}", "|", ";", "&&", "||",
            ">(", "<(")

# Commands whose argument is a target, a pattern or a program of their own.
_OPAQUE = ("eval", "exec", "source", "make", "find", "xargs", "sudo", "env",
           "docker", "srun", "sbatch", "mpirun", "nohup", "watch", "time",
           "conda", "pipenv", "poetry", "snakemake", "nextflow")

_WORD = re.compile(r"[^\s]+")

# WHY A FILE WAS NOT READ. Both are reported to the curator, because "no
# suggestions" and "no suggestions, and four scripts were never looked at"
# are different answers and a curator acting on the first when the second is
# true has been misled by silence.
SKIP_SIZE = "size_limit"
SKIP_PARSE = "parse_error"


def _basename_of(word):
    """The command a word invokes: `/usr/bin/python3` -> `python3`."""
    return word.rsplit("/", 1)[-1].strip()


def _shell_words(line):
    """The words of a shell line, or None if the line is not fully literal.

    A comment, a control-flow keyword, an assignment, a pipeline, a
    substitution or a wildcard all mean the line does not state what it runs.
    None of them is read.
    """
    text = str(line or "").strip()
    if not text or text.startswith("#"):
        return None
    if any(marker in text for marker in _DYNAMIC):
        return None
    words = _WORD.findall(text)
    if not words:
        return None
    head = _basename_of(words[0])
    if head in ("for", "while", "if", "case", "do", "done", "then", "fi",
                "esac", "function", "."):
        return None
    if "=" in words[0] and not words[0].startswith("/"):
        # `NAME=value command ...`: the environment is set here and the value
        # is not something this reads.
        return None
    if head in _OPAQUE:
        return None
    return words


def _first_argument(words, suffix):
    """The first non-flag word ending in `suffix`, or "".

    Flags and their values are skipped by shape, so `jupyter nbconvert
    --execute notebooks/a.ipynb` finds the notebook and `--to html` does not
    look like one.
    """
    for word in words[1:]:
        if word.startswith("-"):
            continue
        if word.lower().endswith(suffix):
            return word
    return ""


def shell_invocations(path, text, known_files):
    """Every source file a shell script literally says it runs.

    Returns [{"from": path, "to": resolved, "line": n, "command": word}],
    deduplicated, in line order. A target counts only when it resolves --
    exactly, and unambiguously -- to a file the folder scan really found, by
    the same rule every other path in this module goes through.
    """
    out = []
    seen = set()
    for number, line in enumerate(str(text or "").splitlines(), start=1):
        words = _shell_words(line)
        if not words:
            continue
        head = _basename_of(words[0])

        target = ""
        if head in _PY_RUNNERS:
            target = _first_argument(words, SCRIPT_SUFFIX)
            if not target:
                # `python -m module` names no file, and `ipython nb.ipynb`
                # runs a notebook.
                target = _first_argument(words, NOTEBOOK_SUFFIX)
        elif head == "jupyter":
            # `jupyter nbconvert --execute a.ipynb`, `jupyter run a.ipynb`.
            target = _first_argument(words, NOTEBOOK_SUFFIX)
        elif head in _SH_RUNNERS:
            target = _first_argument(words, SHELL_SUFFIX)
        elif words[0].startswith("./") or words[0].startswith("../"):
            # `./scripts/preprocess.sh` -- the file IS the command.
            if words[0].lower().endswith(SHELL_SUFFIX):
                target = words[0]
        elif words[0].lower().endswith(SHELL_SUFFIX):
            target = words[0]

        if not target:
            continue
        resolved = _resolve_against(path, target, known_files)
        if not resolved or resolved == path:
            continue
        if not resolved.lower().endswith(
                (SCRIPT_SUFFIX, NOTEBOOK_SUFFIX, SHELL_SUFFIX)):
            continue
        if resolved in seen:
            continue
        seen.add(resolved)
        out.append({"from": path, "to": resolved, "line": number,
                    "command": head})
    return out


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


# The same rule, for callers that need to know whether a path a client sent
# is one this server will touch: relative, inside the folder, no scheme, no
# drive letter, no glob.
def usable_relative(raw):
    return _usable_relative(raw)


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


# A name that was assigned something we could not identify. It is listed
# rather than simply absent, because "assigned once from a reader" and
# "assigned from a reader here and from something unknown three lines down"
# must not be the same answer.
_UNKNOWN = "?"


def _provenance(tree, aliases):
    """Which local names hold a figure, and which hold a data frame.

    A name earns a kind by being ASSIGNED the result of a call that produces
    that kind:

        fig = plt.figure()            fig is a figure
        fig, ax = plt.subplots()      fig is a figure (ax is not)
        df = pd.read_csv("in.csv")    df is a frame
        df = pd.DataFrame(...)        df is a frame

    A name assigned anything else -- a custom class, an unknown function, a
    parameter, a loop variable -- has no kind, and one assigned BOTH a known
    producer and something unidentified loses the kind it had. Two readings
    of the same name is not one of them being right.
    """
    kinds = {}

    def remember(name, kind):
        if name in kinds and kinds[name] != kind:
            kinds[name] = _UNKNOWN
        else:
            kinds[name] = kind

    def kind_of(value):
        if not isinstance(value, ast.Call):
            return _UNKNOWN
        qualified = _dotted(value.func, aliases)
        if qualified in FIGURE_PRODUCERS:
            return "figure"
        if qualified in FRAME_PRODUCERS:
            return "frame"
        return _UNKNOWN

    for node in ast.walk(tree):
        if not isinstance(node, (ast.Assign, ast.AnnAssign)):
            continue
        targets = node.targets if isinstance(node, ast.Assign) else [node.target]
        value = node.value
        kind = kind_of(value)

        for target in targets:
            if isinstance(target, ast.Name):
                remember(target.id, kind)
            elif isinstance(target, (ast.Tuple, ast.List)):
                # `fig, ax = plt.subplots()`: the FIRST element is the figure
                # and the second is an axes, which savefig does not belong to.
                # Every other unpacking gives its names no kind at all.
                subplots = (
                    isinstance(value, ast.Call)
                    and _dotted(value.func, aliases)
                    == "matplotlib.pyplot.subplots")
                for index, element in enumerate(target.elts):
                    if not isinstance(element, ast.Name):
                        continue
                    remember(element.id,
                             "figure" if (subplots and index == 0)
                             else _UNKNOWN)

    # Names bound any other way are not evidence of anything, and a name that
    # was ever unidentifiable is dropped outright.
    for node in ast.walk(tree):
        if isinstance(node, ast.arg):
            kinds[node.arg] = _UNKNOWN
        elif isinstance(node, ast.For) and isinstance(node.target, ast.Name):
            kinds[node.target.id] = _UNKNOWN
        elif isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef,
                               ast.ClassDef)):
            kinds[node.name] = _UNKNOWN

    return {name: kind for name, kind in kinds.items() if kind != _UNKNOWN}


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
    kinds = _provenance(tree, aliases)

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
            # A write method, on a receiver whose kind was traced back to a
            # library call in this same file. `report.savefig(...)` on a
            # class of the project's own is not a figure being saved.
            method = _method_name(call.func)
            wanted = WRITE_METHODS.get(method)
            receiver = (call.func.value
                        if isinstance(call.func, ast.Attribute) else None)
            if (wanted and not qualified
                    and isinstance(receiver, ast.Name)
                    and kinds.get(receiver.id) == wanted[0]):
                mode, shown = "write", wanted[1]

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


def _scan_python(path, text, known_files, skipped):
    try:
        tree = ast.parse(text)
    except (SyntaxError, ValueError, RecursionError):
        # Python 2, a template, a partial file, something that is not Python
        # at all. One unreadable script skips itself and nothing else -- and
        # SAYS SO, rather than looking exactly like a script with no file I/O
        # in it.
        skipped.append({"path": path, "reason": SKIP_PARSE})
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
        return None
    if not isinstance(document, dict):
        return None
    cells = document.get("cells")
    if not isinstance(cells, list):
        return None

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


def _scan_notebook(path, text, known_files, skipped):
    cells = _notebook_cells(text)
    if cells is None:
        # The document is not a notebook: not JSON, or JSON of another shape.
        skipped.append({"path": path, "reason": SKIP_PARSE})
        return []

    facts = []
    aliases_so_far = []
    for index, source in enumerate(cells, start=1):
        # A notebook's imports usually live in the first cell and are used in
        # later ones, so each cell is parsed with the import lines seen so
        # far prepended. The offset puts the reported line back where the
        # curator will find it: line 1 of the cell is line 1.
        prefix = "\n".join(aliases_so_far)
        combined = (prefix + "\n" + source) if prefix else source
        try:
            tree = ast.parse(combined)
        except (SyntaxError, ValueError, RecursionError):
            # One cell skips itself and the rest of the notebook still counts.
            # This is ORDINARY -- `%matplotlib inline` is not Python and every
            # notebook has some -- so it is not reported as a skipped file.
            # A notebook that cannot be opened at all is, above.
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


def scan(sources, known_files, skipped=None):
    """What these sources state, and what could not be read.

    `sources` maps a relative path to that file's text; `known_files` is the
    set of relative paths the folder scan actually found. `skipped` may carry
    entries decided before this point (a file too large to fetch).

    Returns {"links": [...], "skipped": [{path, reason}]}, where a link is

        {script, path, mode: "read"|"write", call, literal, line, cell}

    Deterministic: same folder, same lists, same order, every time.
    """
    known = set(known_files or ())
    skips = list(skipped or [])
    facts = []
    calls = []
    for path in sorted(sources or {}):
        text = sources.get(path)
        if not isinstance(text, str):
            continue
        if len(text) > MAX_SOURCE_CHARS:
            # Not parsed at ALL. Parsing the first 200 000 characters of a
            # file and reporting what they say would be reporting on a
            # fragment as though it were the file -- and a fragment that ends
            # mid-expression usually just raises SyntaxError, which would
            # have blamed the author for a cut this code made.
            skips.append({"path": path, "reason": SKIP_SIZE})
            continue
        lowered = path.lower()
        if lowered.endswith(SCRIPT_SUFFIX):
            facts.extend(_scan_python(path, text, known, skips))
        elif lowered.endswith(NOTEBOOK_SUFFIX):
            facts.extend(_scan_notebook(path, text, known, skips))
        elif lowered.endswith(SHELL_SUFFIX):
            # A shell script states no file I/O this can read. What it does
            # state is which source it RUNS, and that source's own reads and
            # writes are the ones worth having.
            calls.extend(shell_invocations(path, text, known))
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
    links = [best[key] for key in sorted(best)][:MAX_LINKS_TOTAL]
    ordered = sorted({(entry["path"], entry["reason"]) for entry in skips})
    return {
        "links": links,
        "skipped": [{"path": path, "reason": reason}
                    for path, reason in ordered],
        # Who runs what, so a caller can follow a wrapper to the file that
        # actually reads something. Facts, like the links: no artifact is
        # named here and no relationship is decided.
        "shell_calls": sorted(
            calls, key=lambda call: (call["from"], call["line"], call["to"])),
    }


def scan_sources(sources, known_files):
    """Just the facts, for callers that do not care what was unreadable."""
    return scan(sources, known_files)["links"]
