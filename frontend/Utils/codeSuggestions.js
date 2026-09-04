import {
  CHART,
  CONSUMES,
  DATASET,
  GENERATES,
  LINKS_TO,
  SCRIPT,
  fromStoredEdge,
  prefixOf,
} from "./workflowGraph";

// WHAT ONE SCRIPT SAYS ABOUT ITS OWN FILES.
//
// The backend parses each script and notebook and reports plain facts: this
// file calls this I/O function with this literal path, at this line. It knows
// nothing about artifacts. This turns those facts into what a curator is
// asked about, for ONE script at a time -- the script whose row they pressed.
//
// Nothing here compares names. `dos.py` and `dos.png` are not related by both
// being called `dos`; they are related when `dos.py` contains
// `plt.savefig("dos.png")`. A resemblance is not evidence, and a suggested
// arrow that a curator accepts becomes part of a published record.

const clean = (value) => String(value == null ? "" : value).trim();

/** Extensions the backend can actually read. Anything else has no source. */
const SOURCE_SUFFIXES = [".py", ".ipynb"];

/**
 * The RCC source file of a Script artifact, or "" if it has none.
 *
 * A Script typed in by hand has no `files` at all, and one whose files are a
 * Fortran program or a shell script has nothing this can parse. Both are
 * ordinary, and both mean there is nothing to detect.
 */
export const sourceOf = (artifact) => {
  const files = ((artifact || {}).files) || [];
  const found = files
    .map((value) => clean(value).replace(/^\.\//, ""))
    .filter((path) =>
      SOURCE_SUFFIXES.some((suffix) => path.toLowerCase().endsWith(suffix))
    );
  return found[0] || "";
};

/** Every stored path of one artifact, normalised for exact comparison. */
const pathsOf = (artifact, id) => {
  const kind = prefixOf(id);
  const out = [];
  const push = (value) => {
    const text = clean(value).replace(/^\.\//, "");
    if (text) out.push(text);
  };
  if (kind === CHART) {
    // The figure's own image. `files` are its INPUTS -- a script writing one
    // of those has not made the figure, so it is not `generates` evidence.
    push(artifact && artifact.imageFile);
  } else {
    (((artifact || {}).files) || []).forEach(push);
  }
  return out;
};

/**
 * The artifact a path belongs to, or "" when it is not exactly one artifact's.
 *
 * Two artifacts storing the same path is a real possibility, and it makes the
 * arrow ambiguous rather than obvious. An ambiguous arrow is refused.
 */
export const ownerOf = (path, byId, kinds) => {
  const wanted = clean(path);
  const owners = Object.keys(byId || {}).filter(
    (id) =>
      kinds.includes(prefixOf(id)) && pathsOf(byId[id], id).includes(wanted)
  );
  return owners.length === 1 ? owners[0] : "";
};

// What a written file is TAKEN to be, by the only thing that can say so
// without guessing: the call that wrote it. `savefig` writes an image;
// `to_csv`, `to_parquet`, `to_excel`, `numpy.save` and `numpy.savez` write
// data. The file's extension is deliberately NOT consulted -- a `.dat` from
// savefig is still a figure, and a `.png` from to_csv would be a mistake
// worth showing rather than silently reclassifying.
const FIGURE_WRITERS = ["savefig"];

const writesAnImage = (call) =>
  FIGURE_WRITERS.some((name) => String(call || "").endsWith(name));

export const GROUP_INPUT = "input_datasets";
export const GROUP_FIGURE = "output_figures";
export const GROUP_OUTPUT = "output_datasets";

export const GROUP_LABEL = {
  [GROUP_INPUT]: "Input datasets",
  [GROUP_FIGURE]: "Output figures",
  [GROUP_OUTPUT]: "Output datasets",
};

export const detectionKey = (item) =>
  `${item.group}:${item.path}:${item.evidence.cell || 0}:${item.evidence.line}`;

/** The name to show for a file nothing in the draft has claimed yet. */
export const fileName = (path) => String(path || "").split("/").pop() || path;

/**
 * What this one script's code says, grouped the way a curator reads it.
 *
 * `links` is the backend's `code_links`; `scriptId` is the Script artifact
 * whose row was pressed; `byId` maps artifact id -> record; `edges` is the
 * stored edge list, so a relationship that already runs this way is not
 * offered again.
 *
 * Every item carries the direction the edge would be STORED in. For a file
 * the draft already holds, that is a complete edge. For one it does not, the
 * other end does not exist yet and `edge` is null -- the artifact has to be
 * made first, and it is made only if the curator asks.
 */
export const detectionsFor = (links, scriptId, byId, edges) => {
  const script = (byId || {})[scriptId];
  const source = sourceOf(script);
  if (!source) return [];

  const existing = new Set(
    (edges || []).map(fromStoredEdge).map((edge) => `${edge.from}>${edge.to}`)
  );
  const seen = new Set();
  const out = [];

  (links || []).forEach((link) => {
    if (!link || link.script !== source || !link.path) return;

    const evidence = {
      script: link.script,
      line: link.line,
      cell: link.cell == null ? null : link.cell,
      call: link.call,
      // The path AS WRITTEN in the code, which is what the curator will find
      // when they open the file -- not the resolved one.
      literal: link.literal || link.path,
    };

    let group;
    let kind;
    if (link.mode === "read") {
      group = GROUP_INPUT;
      kind = "dataset";
    } else if (writesAnImage(link.call)) {
      group = GROUP_FIGURE;
      kind = "chart";
    } else {
      group = GROUP_OUTPUT;
      kind = "dataset";
    }

    const existingId = ownerOf(
      link.path, byId, [kind === "chart" ? CHART : DATASET]);

    // The arrow, in the order it will be stored. `links_to` for a dataset a
    // script produced is the generic directional edge on purpose: "this
    // script made this data" has no vocabulary of its own in Qresp, and
    // inventing one would put a word in the record nothing else understands.
    const type =
      group === GROUP_INPUT
        ? CONSUMES
        : group === GROUP_FIGURE
        ? GENERATES
        : LINKS_TO;
    const from = group === GROUP_INPUT ? existingId : scriptId;
    const to = group === GROUP_INPUT ? scriptId : existingId;

    if (existingId) {
      if (existingId === scriptId) return;
      if (existing.has(`${from}>${to}`)) return;
    }

    const item = {
      group,
      kind,
      path: link.path,
      name: fileName(link.path),
      existingId,
      direction: group === GROUP_INPUT ? "into" : "outOf",
      type,
      edge: existingId ? { from, to, type } : null,
      evidence,
    };
    const key = detectionKey(item);
    if (seen.has(key)) return;
    seen.add(key);
    out.push(item);
  });

  return out;
};

/** The three groups, in reading order, with empty ones dropped. */
export const groupDetections = (items) =>
  [GROUP_INPUT, GROUP_FIGURE, GROUP_OUTPUT]
    .map((group) => ({
      group,
      label: GROUP_LABEL[group],
      items: (items || []).filter((item) => item.group === group),
    }))
    .filter((entry) => entry.items.length > 0);

/** Where the evidence is, said the way a curator would look for it. */
export const describeEvidence = (evidence) => {
  const where =
    evidence.cell == null
      ? `line ${evidence.line}`
      : `cell ${evidence.cell}, line ${evidence.line}`;
  return `${evidence.script}, ${where} — ${evidence.call}("${evidence.literal}")`;
};

/** The draft a proposed artifact starts from: what the code already told us. */
export const proposalSeed = (item) =>
  item.kind === "chart"
    ? { imageFile: item.path }
    : { files: item.path };

export const SCRIPT_KIND = SCRIPT;

export default detectionsFor;
