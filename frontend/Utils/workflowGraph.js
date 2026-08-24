// The workflow graph's vocabulary, shared by the Curator board, the payload
// converters and the read-only view.
//
// It mirrors backend/project/workflow.py deliberately and exactly. The server
// is the authority -- it refuses a graph it cannot store -- and this half
// exists so a curator is told BEFORE they save, not after. If the two ever
// disagree, the server wins and this file is the one that is wrong.

// Artifact id prefixes, as the Curator mints them (`type.charAt(0)`):
// charts -> c, scripts -> s, datasets -> d, tools -> t, heads -> h.
export const CHART = "c";
export const SCRIPT = "s";
export const DATASET = "d";
export const TOOL = "t";
export const EXTERNAL = "h";

export const CONSUMES = "consumes";
export const USES_TOOL = "uses_tool";
export const GENERATES = "generates";

// Which endpoints each relationship may join, by id prefix.
export const EDGE_RULES = {
  [CONSUMES]: { from: [DATASET, EXTERNAL], to: [SCRIPT, CHART] },
  [USES_TOOL]: { from: [TOOL], to: [SCRIPT] },
  [GENERATES]: { from: [SCRIPT], to: [CHART] },
};

// The three lanes a reader sees. A workflow reads left to right: what went
// in, what was run, what came out.
export const INPUTS = "inputs";
export const PROCESS = "process";
export const OUTPUTS = "outputs";

const LANE_BY_PREFIX = {
  [DATASET]: INPUTS,
  [EXTERNAL]: INPUTS,
  [SCRIPT]: PROCESS,
  [TOOL]: PROCESS,
  [CHART]: OUTPUTS,
};

export const prefixOf = (id) => String(id || "").charAt(0);

/** Which lane an artifact belongs in, or "" for an id this code does not know. */
export const laneOf = (id) => LANE_BY_PREFIX[prefixOf(id)] || "";

/**
 * The relationship two artifacts can have, or "" when they can have none.
 *
 * This is what lets the contextual Add buttons connect things without asking:
 * given "a Script was added while a Chart was selected", the only relationship
 * those two can hold is `generates`, so there is nothing to ask about. It is
 * never a guess -- when a pair could hold more than one relationship, or none,
 * this returns "" and the curator connects them explicitly.
 */
export const inferEdgeType = (fromId, toId) => {
  const from = prefixOf(fromId);
  const to = prefixOf(toId);
  const matches = Object.keys(EDGE_RULES).filter(
    (type) =>
      EDGE_RULES[type].from.includes(from) && EDGE_RULES[type].to.includes(to)
  );
  return matches.length === 1 ? matches[0] : "";
};

/**
 * One stored edge -> {from, to, type}. `type` is "" for a legacy pair.
 *
 * Both shapes arrive: `{from, to, type}` is what V1 writes, `["from", "to"]`
 * is what every earlier record holds. Reading only one of them is the bug
 * this replaces -- a typed edge read as an array yields two undefineds.
 */
export const fromStoredEdge = (edge) => {
  if (Array.isArray(edge)) {
    return { from: edge[0] || "", to: edge[1] || "", type: "" };
  }
  if (edge && typeof edge === "object") {
    return {
      from: edge.from || "",
      to: edge.to || "",
      type: edge.type || "",
    };
  }
  return { from: "", to: "", type: "" };
};

/**
 * {from, to, type} -> what is persisted.
 *
 * A typed edge is written as an object. An UNTYPED one is written back as the
 * pair it arrived as, so opening a legacy record and saving it does not
 * silently rewrite its graph into a shape it never had.
 */
export const toStoredEdge = (edge) =>
  edge && edge.type ? { from: edge.from, to: edge.to, type: edge.type }
                    : [edge.from, edge.to];

/**
 * Why this edge cannot be added, or "" if it can.
 *
 * `knownIds` is every artifact id the paper holds. The checks are the
 * server's, in the same order, so the two give the same answer.
 */
export const edgeProblem = (edge, knownIds, existingEdges = []) => {
  const { from, to, type } = fromStoredEdge(edge);
  if (!from || !to) return "That connection is missing an endpoint.";
  if (from === to) return "A node cannot be connected to itself.";

  const known = new Set(knownIds || []);
  if (!known.has(from) || !known.has(to)) {
    return "That connection refers to something this paper does not have.";
  }
  if (type) {
    const rule = EDGE_RULES[type];
    if (!rule) return `Unknown relationship '${type}'.`;
    if (!rule.from.includes(prefixOf(from)) ||
        !rule.to.includes(prefixOf(to))) {
      return "Those two cannot be connected that way.";
    }
  }
  if (wouldCycle(existingEdges, { from, to })) {
    return "That would loop the workflow back on itself.";
  }
  return "";
};

/** True when adding `candidate` to `edges` would close a cycle. */
export const wouldCycle = (edges, candidate) => {
  const adjacency = new Map();
  const add = (edge) => {
    const { from, to } = fromStoredEdge(edge);
    if (!from || !to) return;
    if (!adjacency.has(from)) adjacency.set(from, []);
    adjacency.get(from).push(to);
  };
  (edges || []).forEach(add);
  if (candidate) add(candidate);

  // Iterative DFS: a graph is curator input, so a long chain must produce an
  // answer rather than a stack overflow.
  const state = new Map(); // 1 = in progress, 2 = done
  for (const start of Array.from(adjacency.keys())) {
    if (state.get(start)) continue;
    const stack = [[start, (adjacency.get(start) || [])[Symbol.iterator]()]];
    state.set(start, 1);
    while (stack.length) {
      const [node, children] = stack[stack.length - 1];
      let advanced = false;
      let step = children.next();
      while (!step.done) {
        const child = step.value;
        const status = state.get(child);
        if (status === 1) return true;
        if (!status) {
          state.set(child, 1);
          stack.push([child, (adjacency.get(child) || [])[Symbol.iterator]()]);
          advanced = true;
          break;
        }
        step = children.next();
      }
      if (!advanced) {
        state.set(node, 2);
        stack.pop();
      }
    }
  }
  return false;
};

/** True when this exact connection is already present, in either shape. */
export const hasEdge = (edges, from, to) =>
  (edges || []).some((edge) => {
    const parsed = fromStoredEdge(edge);
    return parsed.from === from && parsed.to === to;
  });
