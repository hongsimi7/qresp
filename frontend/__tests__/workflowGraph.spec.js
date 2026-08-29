/**
 * The workflow graph's vocabulary, on the client.
 *
 * It mirrors backend/project/workflow.py. These tests exist so the two halves
 * cannot drift apart quietly: the server refuses a graph it cannot store, and
 * this half is what tells a curator before they save rather than after.
 */
import {
  CONSUMES,
  edgeFits,
  EDGE_GROUP,
  EDGE_VERB,
  FEEDS_INTO,
  GENERATES,
  INPUTS,
  OUTPUTS,
  PROCESS,
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
    // Same-kind pairs DO hold one now -- `feeds_into`, covered below. What
    // still holds nothing is a pair of different kinds with no rule for it.
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

  it("no longer refuses a connection that closes a loop", () => {
    // Refinement loops back. `wouldCycle` still REPORTS one -- the Workflow
    // board warns with a "save anyway" -- but storage no longer refuses it.
    const closing = [{ from: "s0", to: "c0", type: GENERATES }];
    expect(problem({ from: "c0", to: "s0" }, closing)).toBe("");
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
  it("is what any two of a kind hold", () => {
    // One rule at every level: what came first feeds what came after.
    expect(inferEdgeType("s0", "s1")).toBe(FEEDS_INTO);
    expect(inferEdgeType("c0", "c1")).toBe(FEEDS_INTO);
    expect(inferEdgeType("d0", "d1")).toBe(FEEDS_INTO);
    expect(inferEdgeType("t0", "t1")).toBe(FEEDS_INTO);
    expect(inferEdgeType("h0", "h1")).toBe(FEEDS_INTO);
  });

  it("refuses two different kinds, so it cannot shadow consumes", () => {
    // A dataset reaching a script is `consumes`, and stays only that.
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

  it("allows a pair of scripts feeding each other", () => {
    // A refinement loop is work being described, not a mistake.
    expect(
      edgeProblem({ from: "s1", to: "s0", type: FEEDS_INTO }, ["s0", "s1"], [
        { from: "s0", to: "s1", type: FEEDS_INTO },
      ])
    ).toBe("");
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
