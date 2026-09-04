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

// WHAT THE CODE SAID, matched to what the curator has.
//
// The backend parses each script and notebook and reports plain facts: this
// file calls this I/O function with this literal path, at this line. It knows
// nothing about artifacts. This turns a fact into a proposed arrow, and only
// when BOTH ends are artifacts already in the draft and the path in the code
// is EXACTLY a path one of them stores.
//
// Nothing here compares names. `dos.py` and `dos.png` are not related by
// being called `dos`; they are related when `dos.py` contains
// `plt.savefig("dos.png")`. A resemblance is not evidence, and a suggested
// arrow that a curator accepts becomes part of a published record.

const clean = (value) => String(value == null ? "" : value).trim();

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
    // of those has not made the figure, so it is not `generates` evidence
    // and is deliberately not matched here.
    push(artifact && artifact.imageFile);
  } else {
    (((artifact || {}).files) || []).forEach(push);
  }
  return out;
};

/**
 * The artifact a path belongs to, or "" when it is not exactly one artifact's.
 *
 * Two artifacts storing the same path is a real possibility (a file listed
 * under two datasets), and it makes the arrow ambiguous rather than obvious.
 * An ambiguous arrow is refused.
 */
const ownerOf = (path, byId, kinds) => {
  const wanted = clean(path);
  const owners = Object.keys(byId).filter(
    (id) =>
      kinds.includes(prefixOf(id)) && pathsOf(byId[id], id).includes(wanted)
  );
  return owners.length === 1 ? owners[0] : "";
};

/**
 * The relationship one code fact proposes, or null.
 *
 *   a script READS a dataset's file    Dataset -> Script   consumes
 *   a script WRITES a figure's image   Script  -> Figure   generates
 *   a script WRITES a dataset's file   Script  -> Dataset  links_to
 *
 * The third uses the generic directional edge on purpose: "this script
 * produced this data" has no vocabulary of its own in Qresp, and inventing
 * one would put a word in the record that nothing else understands.
 */
const edgeFor = (link, scriptId, byId) => {
  if (link.mode === "read") {
    const dataset = ownerOf(link.path, byId, [DATASET]);
    if (!dataset) return null;
    return { from: dataset, to: scriptId, type: CONSUMES };
  }
  const chart = ownerOf(link.path, byId, [CHART]);
  if (chart) return { from: scriptId, to: chart, type: GENERATES };
  const dataset = ownerOf(link.path, byId, [DATASET]);
  if (dataset) return { from: scriptId, to: dataset, type: LINKS_TO };
  return null;
};

export const codeLinkKey = (item) =>
  `${item.edge.from}>${item.edge.to}:${item.evidence.script}:${
    item.evidence.cell || 0
  }:${item.evidence.line}`;

/**
 * Suggestions from one analysis, against the artifacts in the draft.
 *
 * `links` is the backend's `code_links`. `byId` maps artifact id -> record.
 * `edges` is the workflow's stored edge list; a relationship that already
 * runs this way is not offered again.
 *
 * Deterministic and derived: nothing is stored, and calling this twice with
 * the same draft returns the same list in the same order.
 */
export const codeSuggestions = (links, byId, edges) => {
  const existing = new Set(
    (edges || [])
      .map(fromStoredEdge)
      .map((edge) => `${edge.from}>${edge.to}`)
  );
  const seen = new Set();
  const out = [];

  (links || []).forEach((link) => {
    if (!link || !link.script || !link.path) return;
    const scriptId = ownerOf(link.script, byId, [SCRIPT]);
    if (!scriptId) return;

    const edge = edgeFor(link, scriptId, byId);
    if (!edge || edge.from === edge.to) return;
    if (existing.has(`${edge.from}>${edge.to}`)) return;

    const item = {
      edge,
      evidence: {
        script: link.script,
        line: link.line,
        cell: link.cell == null ? null : link.cell,
        call: link.call,
        // The path AS WRITTEN in the code, which is what the curator will
        // find when they open the file -- not the resolved one.
        literal: link.literal || link.path,
        path: link.path,
        mode: link.mode,
      },
    };
    const key = codeLinkKey(item);
    if (seen.has(key)) return;
    seen.add(key);
    out.push(item);
  });

  return out;
};

/** Where the evidence is, said the way a curator would look for it. */
export const describeEvidence = (evidence) => {
  const where =
    evidence.cell == null
      ? `line ${evidence.line}`
      : `cell ${evidence.cell}, line ${evidence.line}`;
  return `${evidence.script}, ${where} — ${evidence.call}("${evidence.literal}")`;
};

export default codeSuggestions;
