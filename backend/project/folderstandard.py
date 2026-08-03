"""Qresp Folder Standard v1: structure detection and record boundaries.

Why this exists
---------------
The analyzer used to walk the whole tree and turn every matching FILE into a
candidate. On a real paper folder that produces hundreds of Charts, Scripts
and "Unclassified" rows, which is worse than no help at all.

A paper folder already carries the answer in its shape. One immediate child
of a role directory is ONE Qresp record, and everything beneath that child
belongs to it. So instead of guessing per file, we:

  1. decide whether the folder follows the standard, a known legacy layout,
     or neither;
  2. take record boundaries from immediate children;
  3. report anything we will not classify as GROUPED folder rows, never as a
     list of every path.

Nothing here fetches, writes, renames or migrates anything. It operates on a
relative-path inventory the caller already has, and every path it returns
stays relative to the selected paper root.
"""
import posixpath
import re

# ---- the standard ------------------------------------------------------------

ROLE_DATASETS = "datasets"
ROLE_CHARTS = "charts"
ROLE_SCRIPTS = "scripts"
ROLE_TOOLS = "tools"
ROLE_DOCS = "docs"

# The ONLY names a newly organized paper may use, exactly, in lower case.
STANDARD_ROLES = (ROLE_DATASETS, ROLE_CHARTS, ROLE_SCRIPTS, ROLE_TOOLS,
                  ROLE_DOCS)

# Legacy names seen across the public corpus (63 RCC paper folders). Matched
# case-insensitively. Adding a name here is the ONLY thing needed to support
# another historical layout — no path is ever renamed on the server.
LEGACY_ALIASES = {
    ROLE_DATASETS: (
        "data", "datasets", "dataset", "raw_data", "rawdata", "raw-data",
        "data_files", "datafiles",
    ),
    ROLE_CHARTS: (
        "charts", "chart", "figures_tables", "figures-tables", "figurestables",
        "figures", "figure", "figs", "fig", "plots",
    ),
    ROLE_SCRIPTS: (
        "scripts", "script", "plot_scripts", "plotscripts",
        "postprocessing_scripts", "postprocessingscripts", "code", "codes",
        "src",
    ),
    ROLE_DOCS: (
        "doc", "docs", "documentation", "tutorials", "tutorial", "manual",
    ),
    ROLE_TOOLS: ("tools", "tool", "software"),
}

# Root files that are expected and never a structure problem.
OPTIONAL_ROOT_FILES = ("main.ipynb", "readme.md", "readme", "readme.txt",
                       "readme.rst", "license", "license.txt", "license.md")

CHART_PREVIEW_EXTENSIONS = (".png", ".jpeg", ".jpg", ".gif")

# Images that decorate a page rather than being the figure. A folder's own
# figure is never called any of these, and picking one would put a logo in a
# published record.
CHART_DECORATIVE_STEMS = frozenset((
    "logo", "logos", "icon", "icons", "favicon", "banner", "header",
    "footer", "screenshot", "screenshots", "thumbnail", "thumb",
    "graphical_abstract", "graphicalabstract", "graphical-abstract",
    "toc", "toc_graphic", "cover",
))
CHART_PREVIEW_STEM = "preview"
CHART_NOTEBOOK = "notebook.ipynb"
CHART_DATA_DIR = "data"

# A new artifact id must be safe in a URL and readable in a path.
ARTIFACT_ID_RE = re.compile(r"^[A-Za-z0-9._-]+$")

MODE_STANDARD = "standard"
MODE_LEGACY = "legacy"
MODE_INVALID = "invalid"

# Grouped reporting caps. These bound the RESPONSE, not the crawl.
MAX_GROUP_ROWS = 200
MAX_NAMES_PER_GROUP = 20
MAX_TREE_NODES = 200


def _normalized(name):
    return re.sub(r"[^a-z0-9]+", "", (name or "").lower())


def _alias_lookup():
    table = {}
    for role, names in LEGACY_ALIASES.items():
        for name in names:
            table[_normalized(name)] = role
    return table


ALIAS_TABLE = _alias_lookup()


def top_level_dirs(files, dirs):
    """Top-level directory names present in the inventory."""
    tops = set()
    for path in list(dirs) + list(files):
        if "/" in path:
            tops.add(path.split("/", 1)[0])
    return sorted(tops)


def root_files(files):
    return sorted(path for path in files if "/" not in path)


def detect_structure(files, dirs):
    """Decide the analysis mode and map productive roots to roles.

    Returns (mode, roles, issues) where `roles` maps an ACTUAL top-level
    directory name to a standard role. Directories are never renamed; the
    mapping only tells the analyzer how to read them.
    """
    tops = top_level_dirs(files, dirs)
    roles = {}
    unknown = []

    for top in tops:
        if top in STANDARD_ROLES:
            roles[top] = top
            continue
        role = ALIAS_TABLE.get(_normalized(top))
        if role:
            roles[top] = role
        else:
            unknown.append(top)

    issues = []
    if not tops:
        # A flat folder of loose files: nothing to take a boundary from.
        return MODE_INVALID, {}, [{
            "path": "",
            "reason": "This folder has no top-level directories, so Qresp "
                      "cannot tell datasets from charts or scripts.",
        }]

    if unknown:
        return MODE_INVALID, roles, [
            {"path": name,
             "reason": "Not a Qresp Folder Standard role (datasets, charts, "
                       "scripts, tools, docs) and not a layout Qresp "
                       "recognizes."}
            for name in unknown
        ]

    # Every productive root is known. Standard only when every one of them is
    # already the exact lowercase name.
    if all(top == role for top, role in roles.items()):
        mode = MODE_STANDARD
    else:
        mode = MODE_LEGACY
        issues = [
            {"path": top,
             "reason": "Read as %s (Qresp Folder Standard name: %s). Nothing "
                       "on the file server is renamed." % (role, role)}
            for top, role in sorted(roles.items()) if top != role
        ]
    return mode, roles, issues


def validate_artifact_id(name):
    """True when a name is safe as a NEW artifact directory name."""
    return bool(name) and bool(ARTIFACT_ID_RE.match(name))


# ---- boundaries ---------------------------------------------------------------

def _children_of(root, files, dirs):
    """Immediate children of a top-level directory: (folders, files)."""
    prefix = root + "/"
    child_dirs, child_files = set(), []
    for path in dirs:
        if path.startswith(prefix):
            child_dirs.add(prefix + path[len(prefix):].split("/", 1)[0])
    for path in files:
        if not path.startswith(prefix):
            continue
        rest = path[len(prefix):]
        if "/" in rest:
            child_dirs.add(prefix + rest.split("/", 1)[0])
        else:
            child_files.append(path)
    return sorted(child_dirs), sorted(child_files)


def descendants_of(folder, files):
    prefix = folder + "/"
    return [path for path in files if path.startswith(prefix)]


def summarize_folder(folder, files):
    """A grouped row: what is in here, without listing everything."""
    contents = descendants_of(folder, files)
    extensions = {}
    for path in contents:
        ext = posixpath.splitext(path)[1].lower() or "(no extension)"
        extensions[ext] = extensions.get(ext, 0) + 1
    common = sorted(extensions.items(), key=lambda kv: (-kv[1], kv[0]))
    return {
        "path": folder,
        "name": posixpath.basename(folder) or folder,
        "file_count": len(contents),
        "extensions": [ext for ext, _ in common[:6]],
        # Names are for an EXPANDED row only, and bounded.
        "sample_names": [posixpath.basename(p) for p in contents[:MAX_NAMES_PER_GROUP]],
    }


def boundary_tree(root, files, dirs, depth=2):
    """A compact, selectable tree for choosing record boundaries by hand.

    Only folders, only a couple of levels, each with a file count — enough to
    answer "is this one dataset or several?" without rendering the corpus.
    """
    nodes = []
    prefix = root + "/"
    seen = set()
    for path in sorted(set(dirs)):
        if not path.startswith(prefix):
            continue
        relative = path[len(prefix):]
        level = relative.count("/") + 1
        if level > depth or path in seen:
            continue
        seen.add(path)
        summary = summarize_folder(path, files)
        summary["level"] = level
        summary["parent"] = posixpath.dirname(path)
        nodes.append(summary)
        if len(nodes) >= MAX_TREE_NODES:
            break
    return nodes


def group_unclassified(paths, files):
    """Grouped folder rows instead of a list of every path."""
    buckets = {}
    for path in paths:
        folder = posixpath.dirname(path)
        buckets.setdefault(folder, []).append(path)
    rows = []
    for folder, members in sorted(buckets.items()):
        extensions = {}
        for path in members:
            ext = posixpath.splitext(path)[1].lower() or "(no extension)"
            extensions[ext] = extensions.get(ext, 0) + 1
        common = sorted(extensions.items(), key=lambda kv: (-kv[1], kv[0]))
        rows.append({
            "path": folder,
            "name": folder or "folder root",
            "file_count": len(members),
            "extensions": [ext for ext, _ in common[:6]],
            "sample_names": [posixpath.basename(p)
                             for p in members[:MAX_NAMES_PER_GROUP]],
        })
    rows.sort(key=lambda row: (-row["file_count"], row["path"]))
    return rows[:MAX_GROUP_ROWS]


class BoundaryError(Exception):
    """A rejected boundary selection. The message is safe to show."""


def validate_boundaries(raw, roles, files, dirs):
    """Turn a browser-supplied boundary selection into trusted paths.

    A boundary says "treat THIS folder as one record" instead of the default
    immediate children. That is a lot of power to hand a request body, so
    every entry has to survive:

      * its role root must be one the analyzed tree actually has;
      * the path must be a relative POSIX path we SAW in this tree — not a
        URL, not absolute, no `..`, no backslash, no percent-encoding, and
        no path we never listed;
      * it must sit under the role root it was submitted for;
      * a parent and one of its descendants cannot both be selected, because
        the same files would end up in two records.

    Returns {role_root: [paths]} with duplicates collapsed, or raises
    BoundaryError. Nothing here fetches or writes anything.
    """
    if raw is None:
        return {}
    if not isinstance(raw, dict):
        raise BoundaryError("Boundary selection must be an object.")

    known = set(dirs) | set(files)
    selected = {}

    for root, paths in raw.items():
        if root not in roles:
            raise BoundaryError(
                "%r is not a folder in this paper." % str(root)[:80])
        if not isinstance(paths, (list, tuple)):
            raise BoundaryError(
                "Boundaries for %s must be a list of folders." % root)

        cleaned = []
        for entry in paths:
            path = entry if isinstance(entry, str) else ""
            path = path.strip()
            if not path:
                raise BoundaryError("An empty boundary path was submitted.")
            if (path.startswith("/") or "\\" in path or "://" in path
                    or "%" in path or ".." in path.split("/")):
                raise BoundaryError(
                    "%r is not a relative folder inside this paper." % path[:80])
            if path != posixpath.normpath(path):
                raise BoundaryError("%r is not a normalized path." % path[:80])
            if path != root and not path.startswith(root + "/"):
                raise BoundaryError(
                    "%r is not inside %s." % (path[:80], root))
            if path not in known:
                # Only paths this analysis actually listed. A boundary can
                # never point at something we never saw.
                raise BoundaryError(
                    "%r was not found in this folder." % path[:80])
            if path not in cleaned:
                cleaned.append(path)

        for path in cleaned:
            for other in cleaned:
                if other != path and path.startswith(other + "/"):
                    raise BoundaryError(
                        "%s and %s overlap — select the parent or the child, "
                        "not both." % (other, path))
        if cleaned:
            selected[root] = sorted(cleaned)

    return selected


def chart_images(folder, files):
    """Every usable image directly inside `folder`, server spelling intact.

    Decorative images are dropped: a logo is never the figure, and proposing
    one puts it in a published record.
    """
    images = []
    for path in descendants_of(folder, files):
        if posixpath.dirname(path) != folder:
            continue
        stem, ext = posixpath.splitext(posixpath.basename(path))
        if ext.lower() not in CHART_PREVIEW_EXTENSIONS:
            continue
        if stem.lower().replace(" ", "_") in CHART_DECORATIVE_STEMS:
            continue
        images.append(path)
    return sorted(images)


def pick_chart_image(folder, images):
    """The representative image for a chart folder, or "" when the choice is
    genuinely ambiguous.

    The old rule was `preview.png`, or a single image and nothing else. Real
    RCC folders name the figure after the folder -- figure_S1/figure_S1.png
    next to diagram.png -- so a two-image folder proposed no image at all
    while happily proposing its notebook. Named-after-the-folder comes first
    now, and an ambiguous folder proposes nothing rather than guessing.

    Returns (chosen, options): `options` is always every image found, so the
    curator can pick when we decline to.
    """
    if not images:
        return "", []

    name = posixpath.basename(folder)

    def stem(path):
        return posixpath.splitext(posixpath.basename(path))[0]

    # 1. The folder's own name, spelled exactly.
    exact = [p for p in images if stem(p) == name]
    if len(exact) == 1:
        return exact[0], images

    # 2. The same name in a different case. The SERVER's spelling is kept --
    #    the path has to resolve on a case-sensitive file server.
    lowered = [p for p in images if stem(p).lower() == name.lower()]
    if len(lowered) == 1:
        return lowered[0], images

    # 3. The Folder Standard's own preview.png.
    preview = [p for p in images
               if stem(p).lower() == CHART_PREVIEW_STEM]
    if len(preview) == 1:
        return preview[0], images

    # 4. One image and no ambiguity to resolve.
    if len(images) == 1:
        return images[0], images

    # 5. Several images and nothing to choose between them: the curator picks.
    return "", images


def chart_parts(folder, files):
    """preview / data / notebook inside one charts/<child> folder."""
    contents = descendants_of(folder, files)
    images = chart_images(folder, files)
    preview, _options = pick_chart_image(folder, images)

    notebook = ""
    for path in contents:
        if posixpath.basename(path).lower() == CHART_NOTEBOOK:
            notebook = path
            break
    if not notebook:
        notebooks = [p for p in contents
                     if p.lower().endswith(".ipynb")
                     and posixpath.dirname(p) == folder]
        if len(notebooks) == 1:
            notebook = notebooks[0]

    data_dir = "%s/%s" % (folder, CHART_DATA_DIR)
    if any(p.startswith(data_dir + "/") for p in contents):
        data = [data_dir]
    else:
        data = sorted(
            p for p in contents
            if p not in (preview, notebook)
            and posixpath.dirname(p) == folder
            and posixpath.splitext(p)[1].lower() not in CHART_PREVIEW_EXTENSIONS
        )
    return preview, data, notebook
