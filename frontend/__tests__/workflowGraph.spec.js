/**
 * The workflow graph's vocabulary, on the client.
 *
 * It mirrors backend/project/workflow.py. These tests exist so the two halves
 * cannot drift apart quietly: the server refuses a graph it cannot store, and
 * this half is what tells a curator before they save rather than after.
 */
import {
  CONSUMES,
  DIRECTED,
  edgeFits,
  edgeSentence,
  EDGE_GROUP,
  EDGE_VERB,
  FEEDS_INTO,
  GENERATES,
  INPUTS,
  OUTPUTS,
  PROCESS,
  RELATED_TO,
  USES_TOOL,
  edgeProblem,
  fromStoredEdge,
  hasEdge,
  inferEdgeType,
  laneOf,
  toStoredEdge,
  wouldCycle,
} from "../Utils/workflowGraph";

const ALL = ["c0", "s0", "d0", "t0", "h0"];

describe("lanes", () => {
  it("reads left to right: what went in, what ran, what came out", () => {
    expect(laneOf("d0")).toBe(INPUTS);
    expect(laneOf("h0")).toBe(INPUTS);
    expect(laneOf("s0")).toBe(PROCESS);
    expect(laneOf("t0")).toBe(PROCESS);
    expect(laneOf("c0")).toBe(OUTPUTS);
  });

  it("has no lane for an id it does not recognise", () => {
    expect(laneOf("z9")).toBe("");
    expect(laneOf("")).toBe("");
    expect(laneOf(undefined)).toBe("");
  });
});

// This is what lets an Add button connect things without asking a question.
describe("inferring a relationship", () => {
  it("names the one relationship a pair can hold", () => {
    expect(inferEdgeType("s0", "c0")).toBe(GENERATES);
    expect(inferEdgeType("t0", "s0")).toBe(USES_TOOL);
    expect(inferEdgeType("d0", "s0")).toBe(CONSUMES);
    expect(inferEdgeType("h0", "s0")).toBe(CONSUMES);
    expect(inferEdgeType("d0", "c0")).toBe(CONSUMES);
  });

  it("stays silent when a pair can hold none", () => {
    // Nothing is guessed. A pair with no lawful relationship gets "" and the
    // curator connects them explicitly or not at all.
    expect(inferEdgeType("c0", "s0")).toBe("");
    expect(inferEdgeType("t0", "c0")).toBe("");
    expect(inferEdgeType("c0", "c1")).toBe("");
    expect(inferEdgeType("c0", "d0")).toBe("");
    expect(inferEdgeType("t0", "h0")).toBe("");
  });

  it("is direction-sensitive", () => {
    expect(inferEdgeType("s0", "c0")).toBe(GENERATES);
    expect(inferEdgeType("c0", "s0")).toBe("");
  });
});

describe("reading and writing a stored edge", () => {
  it("reads the typed shape V1 writes", () => {
    expect(fromStoredEdge({ from: "s0", to: "c0", type: GENERATES })).toEqual({
      from: "s0",
      to: "c0",
      type: GENERATES,
    });
  });

  it("reads the pair shape every earlier record holds", () => {
    expect(fromStoredEdge(["s0", "c0"])).toEqual({
      from: "s0",
      to: "c0",
      type: "",
    });
  });

  it("survives junk without throwing", () => {
    expect(fromStoredEdge(null)).toEqual({ from: "", to: "", type: "" });
    expect(fromStoredEdge("s0->c0")).toEqual({ from: "", to: "", type: "" });
    expect(fromStoredEdge([])).toEqual({ from: "", to: "", type: "" });
  });

  it("writes a typed edge as an object and an untyped one as a pair", () => {
    // A legacy graph opened and saved must not be rewritten into a shape it
    // never had.
    expect(toStoredEdge({ from: "s0", to: "c0", type: GENERATES })).toEqual({
      from: "s0",
      to: "c0",
      type: GENERATES,
    });
    expect(toStoredEdge({ from: "s0", to: "c0", type: "" })).toEqual([
      "s0",
      "c0",
    ]);
  });
});

describe("cycles", () => {
  it("sees a two-node loop", () => {
    expect(wouldCycle([["s0", "c0"]], { from: "c0", to: "s0" })).toBe(true);
  });

  it("sees a longer loop", () => {
    expect(
      wouldCycle([["a", "b"], ["b", "c"]], { from: "c", to: "a" })
    ).toBe(true);
  });

  it("allows a diamond, which is not a cycle", () => {
    // One dataset feeding two scripts that both feed one chart is ordinary.
    expect(
      wouldCycle(
        [["d0", "s0"], ["d0", "s1"], ["s0", "c0"]],
        { from: "s1", to: "c0" }
      )
    ).toBe(false);
  });

  it("does not blow the stack on a long chain", () => {
    const edges = [];
    for (let i = 0; i < 3000; i += 1) edges.push([`n${i}`, `n${i + 1}`]);
    expect(wouldCycle(edges, null)).toBe(false);
  });
});

describe("why an edge cannot be added", () => {
  const problem = (edge, edges = []) => edgeProblem(edge, ALL, edges);

  it("accepts the three relationships V1 understands", () => {
    expect(problem({ from: "d0", to: "s0", type: CONSUMES })).toBe("");
    expect(problem({ from: "t0", to: "s0", type: USES_TOOL })).toBe("");
    expect(problem({ from: "s0", to: "c0", type: GENERATES })).toBe("");
  });

  it("refuses a node linked to itself", () => {
    expect(problem({ from: "s0", to: "s0", type: GENERATES })).toMatch(
      /itself/i
    );
  });

  it("refuses an artifact this paper does not have", () => {
    // Which is also how another paper's artifact presents.
    expect(problem({ from: "s0", to: "c9", type: GENERATES })).toMatch(
      /does not have/i
    );
  });

  it("refuses a relationship the endpoints cannot hold", () => {
    expect(problem({ from: "t0", to: "c0", type: GENERATES })).toMatch(
      /cannot be connected/i
    );
  });

  it("refuses an unknown relationship name", () => {
    expect(problem({ from: "s0", to: "c0", type: "produces" })).toMatch(
      /unknown relationship/i
    );
  });

  it("refuses a connection that would close a loop", () => {
    const closing = [{ from: "s0", to: "c0", type: GENERATES }];
    expect(problem({ from: "c0", to: "s0" }, closing)).toMatch(/loop/i);
    expect(wouldCycle(closing, { from: "c0", to: "s0" })).toBe(true);
  });

  it("accepts a legacy untyped edge between real artifacts", () => {
    expect(problem({ from: "d0", to: "s0", type: "" })).toBe("");
  });

  it("refuses an edge missing an endpoint", () => {
    expect(problem({ from: "s0", to: "" })).toMatch(/missing an endpoint/i);
  });
});

describe("finding an existing connection", () => {
  it("matches in either stored shape", () => {
    const edges = [["d0", "s0"], { from: "s0", to: "c0", type: GENERATES }];
    expect(hasEdge(edges, "d0", "s0")).toBe(true);
    expect(hasEdge(edges, "s0", "c0")).toBe(true);
    expect(hasEdge(edges, "c0", "s0")).toBe(false);
    expect(hasEdge([], "d0", "s0")).toBe(false);
  });
});

// Script -> Script, the one relationship joining two of a kind. It mirrors
// backend/project/workflow.py exactly; if the two ever disagree the server
// wins and this file is the one that is wrong.
describe("feeds_into", () => {
  it("is what two SCRIPTS hold, and nothing else", () => {
    expect(inferEdgeType("s0", "s1")).toBe(FEEDS_INTO);
    // A derived dataset, a tool built on a tool and a figure composed of
    // panels each need a model of their own. Sharing a first letter is not
    // a reason to file them under this one.
    expect(edgeFits(FEEDS_INTO, "c", "c")).toBe(false);
    expect(edgeFits(FEEDS_INTO, "d", "d")).toBe(false);
    expect(edgeFits(FEEDS_INTO, "t", "t")).toBe(false);
    expect(edgeFits(FEEDS_INTO, "h", "h")).toBe(false);
  });

  it("refuses two different kinds, so it cannot shadow consumes", () => {
    expect(edgeFits(FEEDS_INTO, "d", "s")).toBe(false);
    expect(inferEdgeType("d0", "s0")).toBe(CONSUMES);
    expect(
      edgeProblem({ from: "d0", to: "s0", type: FEEDS_INTO }, ["d0", "s0"])
    ).toBeTruthy();
  });

  it("does not disturb what the other pairs already inferred", () => {
    expect(inferEdgeType("s0", "c0")).toBe(GENERATES);
    expect(inferEdgeType("d0", "s0")).toBe(CONSUMES);
    expect(inferEdgeType("t0", "s0")).toBe(USES_TOOL);
  });

  it("refuses a script feeding itself", () => {
    expect(
      edgeProblem({ from: "s0", to: "s0", type: FEEDS_INTO }, ["s0"])
    ).toBeTruthy();
  });

  it("refuses a pair of scripts feeding each other", () => {
    // An experiment repeated until it converged belongs in the script's own
    // README, not drawn as a loop in the provenance graph.
    expect(
      edgeProblem({ from: "s1", to: "s0", type: FEEDS_INTO }, ["s0", "s1"], [
        { from: "s0", to: "s1", type: FEEDS_INTO },
      ])
    ).toMatch(/loop/i);
  });

  it("still refuses an artifact joined to itself", () => {
    expect(
      edgeProblem({ from: "s0", to: "s0", type: FEEDS_INTO }, ["s0"])
    ).toBeTruthy();
  });

  it("round-trips through storage as a typed edge", () => {
    const edge = { from: "s1", to: "s0", type: FEEDS_INTO };
    expect(toStoredEdge(edge)).toEqual(edge);
    expect(fromStoredEdge(toStoredEdge(edge))).toEqual(edge);
  });

  it("reads upstream to downstream, in one verb", () => {
    expect(EDGE_VERB[FEEDS_INTO]).toBe("feeds into");
    expect(EDGE_GROUP[FEEDS_INTO]).toBe("Receives from script");
  });
});

// The undirected half of the vocabulary. It says two artifacts belong
// together and nothing else -- no order, no data flow.
describe("related_to", () => {
  it("joins any two of a kind, and only its own kind", () => {
    ["c", "s", "d", "t", "h"].forEach((kind) =>
      expect(edgeFits(RELATED_TO, kind, kind)).toBe(true)
    );
    expect(edgeFits(RELATED_TO, "c", "s")).toBe(false);
    expect(edgeFits(RELATED_TO, "d", "s")).toBe(false);
  });

  it("is never inferred, only chosen", () => {
    // `inferEdgeType` answers "what does this pair PRODUCE". An association
    // is a claim only a curator can make.
    expect(DIRECTED).not.toContain(RELATED_TO);
    expect(inferEdgeType("c0", "c1")).toBe("");
    expect(inferEdgeType("s0", "s1")).toBe(FEEDS_INTO);
  });

  it("refuses an artifact related to itself", () => {
    expect(
      edgeProblem({ from: "c0", to: "c0", type: RELATED_TO }, ["c0"])
    ).toBeTruthy();
  });

  it("refuses the same pair twice, in either order", () => {
    const held = [{ from: "c0", to: "c1", type: RELATED_TO }];
    expect(
      edgeProblem({ from: "c0", to: "c1", type: RELATED_TO }, ["c0", "c1"], held)
    ).toMatch(/already related/i);
    expect(
      edgeProblem({ from: "c1", to: "c0", type: RELATED_TO }, ["c0", "c1"], held)
    ).toMatch(/already related/i);
  });

  it("takes no part in the cycle check", () => {
    // There is no direction to loop.
    const held = [{ from: "c0", to: "c1", type: RELATED_TO }];
    expect(
      edgeProblem({ from: "c1", to: "c0", type: GENERATES }, ["c0", "c1"], held)
    ).not.toMatch(/loop/i);
  });

  it("does not let an association hide a real loop", () => {
    const held = [
      { from: "c0", to: "c1", type: RELATED_TO },
      { from: "s0", to: "c0", type: GENERATES },
    ];
    expect(
      edgeProblem({ from: "c0", to: "s0" }, ["c0", "c1", "s0"], held)
    ).toMatch(/loop/i);
  });

  it("reads without arrows, because neither end came first", () => {
    const name = (id) => id.toUpperCase();
    expect(edgeSentence({ from: "c0", to: "c1", type: RELATED_TO }, name)).toBe(
      "C0 ↔ related to ↔ C1"
    );
    expect(edgeSentence({ from: "s0", to: "c0", type: GENERATES }, name)).toBe(
      "S0 → generates → C0"
    );
  });

  it("round-trips through storage as a typed edge", () => {
    const edge = { from: "d0", to: "d1", type: RELATED_TO };
    expect(fromStoredEdge(toStoredEdge(edge))).toEqual(edge);
  });
});
