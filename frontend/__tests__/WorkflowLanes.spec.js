/**
 * The workflow drawing.
 *
 * The layout is deterministic on purpose: same input, same picture. That is
 * what makes it assertable at all, and it is why this is SVG rather than the
 * canvas the paper page uses -- a canvas can be neither tested nor read by a
 * screen reader, and a force layout has no notion of "inputs on the left".
 */
import { render, screen, within } from "@testing-library/react";

import WorkflowLanes, { edgePath, layoutLanes } from "../components/CuratorElements/WorkflowLanes";
import { CONSUMES, GENERATES, RELATED_TO, USES_TOOL } from "../Utils/workflowGraph";

const BY_ID = {
  c0: { id: "c0", caption: "Density of states" },
  s0: { id: "s0", readme: "plot_dos.py" },
  d0: { id: "d0", readme: "spectra" },
  t0: { id: "t0", packageName: "numpy" },
};
const NAME = (id) => ({
  c0: "Density of states",
  s0: "plot_dos.py",
  d0: "spectra",
  t0: "numpy",
  c1: "Band structure",
}[id] || id);

const EDGES = [
  { from: "d0", to: "s0", type: CONSUMES },
  { from: "t0", to: "s0", type: USES_TOOL },
  { from: "s0", to: "c0", type: GENERATES },
];

const draw = (ids, edges) =>
  render(
    <WorkflowLanes ids={ids} byId={BY_ID} edges={edges} name={NAME} />
  );

describe("laying out the lanes", () => {
  it("puts inputs left, process in the middle and figures right", () => {
    const { nodes } = layoutLanes(["c0", "s0", "d0", "t0"], BY_ID, NAME);
    expect(nodes.d0.x).toBeLessThan(nodes.s0.x);
    expect(nodes.s0.x).toBeLessThan(nodes.c0.x);
    // A tool is something that was run, so it shares the middle lane.
    expect(nodes.t0.x).toBe(nodes.s0.x);
  });

  it("does not stack two artifacts on one another", () => {
    const { nodes } = layoutLanes(["s0", "t0"], BY_ID, NAME);
    expect(nodes.s0.y).not.toBe(nodes.t0.y);
  });

  it("is the same picture for the same input", () => {
    const first = layoutLanes(["c0", "s0", "d0"], BY_ID, NAME);
    const second = layoutLanes(["c0", "s0", "d0"], BY_ID, NAME);
    expect(second.nodes).toEqual(first.nodes);
  });

  it("sizes the canvas to what it has to hold", () => {
    const small = layoutLanes(["s0"], BY_ID, NAME);
    const big = layoutLanes(["s0", "t0"], BY_ID, NAME);
    expect(big.height).toBeGreaterThan(small.height);
  });
});

describe("routing an edge", () => {
  const from = { x: 0, y: 0, w: 100, h: 40 };
  const to = { x: 200, y: 0, w: 100, h: 40 };

  it("leaves the right of one node and arrives at the left of the next", () => {
    expect(edgePath(from, to, false)).toMatch(/^M 100 20 C/);
  });

  it("routes a back edge underneath, so it cannot be read as forward flow", () => {
    const forward = edgePath(from, to, false);
    const back = edgePath(to, from, true);
    expect(back).not.toBe(forward);
    // It starts on the LEFT of the later node, not the right.
    expect(back).toMatch(/^M 200 20 C/);
  });
});

describe("the drawing itself", () => {
  it("draws one node per artifact and one edge per connection", () => {
    draw(["c0", "s0", "d0", "t0"], EDGES);
    ["c0", "s0", "d0", "t0"].forEach((id) =>
      expect(screen.getAllByTestId(`fw-lane-node-${id}`)).toHaveLength(1)
    );
    ["d0-s0", "t0-s0", "s0-c0"].forEach((pair) =>
      expect(screen.getByTestId(`fw-lane-edge-${pair}`)).toBeInTheDocument()
    );
  });

  it("names every node for a reader who cannot see it", () => {
    draw(["c0", "s0"], [{ from: "s0", to: "c0", type: GENERATES }]);
    expect(
      screen.getByRole("button", { name: "plot_dos.py" })
    ).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /workflow diagram/i })).toBeInTheDocument();
  });

  it("says what each connection means, in words", () => {
    draw(["s0", "c0"], [{ from: "s0", to: "c0", type: GENERATES }]);
    expect(screen.getByTestId("fw-lane-edge-s0-c0")).toHaveTextContent(
      "plot_dos.py → generates → Density of states"
    );
  });

  it("marks a feedback loop from the record, not from the shape", () => {
    // Only the edge the curator confirmed is marked. The other one closes
    // the same loop and is NOT marked, because nobody said it was one.
    draw(["s0", "c0"], [
      { from: "s0", to: "c0", type: GENERATES },
      { from: "c0", to: "s0", type: CONSUMES, feedback: true },
    ]);
    expect(screen.getByTestId("fw-lane-edge-c0-s0")).toHaveAttribute(
      "data-loop",
      "true"
    );
    expect(screen.getByTestId("fw-lane-edge-s0-c0")).toHaveAttribute(
      "data-loop",
      "false"
    );
    expect(screen.getByTestId("fw-lane-edge-c0-s0")).toHaveTextContent(
      /feedback loop/i
    );
    expect(screen.getByTestId("fw-lanes")).toHaveTextContent(
      /dashed line is a feedback loop/i
    );
  });

  it("draws an association without a direction", () => {
    draw(
      ["c0", "c1"],
      [{ from: "c0", to: "c1", type: RELATED_TO }]
    );
    const edge = screen.getByTestId("fw-lane-edge-c0-c1");
    expect(edge).toHaveAttribute("data-undirected", "true");
    expect(edge).toHaveTextContent("↔ related to ↔");
  });

  it("ignores an edge naming something outside this group", () => {
    draw(["s0", "c0"], [...EDGES, { from: "d9", to: "s0", type: CONSUMES }]);
    expect(screen.queryByTestId("fw-lane-edge-d9-s0")).not.toBeInTheDocument();
  });

  it("draws nothing off the canvas", () => {
    const { width, height, nodes } = layoutLanes(
      ["c0", "s0", "d0", "t0"],
      BY_ID,
      NAME
    );
    Object.values(nodes).forEach((node) => {
      expect(node.x + node.w).toBeLessThanOrEqual(width);
      expect(node.y + node.h).toBeLessThanOrEqual(height);
    });
  });
});
