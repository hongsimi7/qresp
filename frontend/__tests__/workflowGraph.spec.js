/**
 * The workflow graph's vocabulary, on the client.
 *
 * It mirrors backend/project/workflow.py. These tests exist so the two halves
 * cannot drift apart quietly: the server refuses a graph it cannot store, and
 * this half is what tells a curator before they save rather than after.
 */
import {
  CONSUMES,
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
    expect(inferEdgeType("c0", "c1")).toBe("");
    expect(inferEdgeType("s0", "s1")).toBe("");
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
    expect(
      problem({ from: "c0", to: "s0" }, [
        { from: "s0", to: "c0", type: GENERATES },
      ])
    ).toMatch(/loop/i);
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
