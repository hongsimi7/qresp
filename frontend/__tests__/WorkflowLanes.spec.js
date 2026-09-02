/**
 * The workflow drawing.
 *
 * NO TYPE LANES. Position comes from the arrows the curator drew, not from
 * what kind each artifact is -- a script writes a dataset as readily as a
 * dataset feeds a script, and a layout that asserts otherwise is wrong about
 * the work before a single edge is read.
 *
 * The layout is deterministic on purpose: same input, same picture. That is
 * what makes it assertable at all, and why this is SVG rather than the
 * canvas the paper page uses.
 */
import { render, screen } from "@testing-library/react";

import WorkflowLanes, {
  edgePath,
  layoutGraph,
} from "../components/CuratorElements/WorkflowLanes";
import {
  CONSUMES,
  GENERATES,
  LINKS_TO,
  RELATED_TO,
  USES_TOOL,
} from "../Utils/workflowGraph";

const NAME = (id) =>
  ({
    c0: "Density of states",
    c1: "Band structure",
    s0: "plot_dos.py",
    d0: "spectra",
    t0: "numpy",
  }[id] || id);

const EDGES = [
  { from: "d0", to: "s0", type: CONSUMES },
  { from: "t0", to: "s0", type: USES_TOOL },
  { from: "s0", to: "c0", type: GENERATES },
];

const draw = (ids, edges) =>
  render(<WorkflowLanes ids={ids} edges={edges} name={NAME} />);

describe("laying the graph out", () => {
  it("places a node by the arrows into it, not by its kind", () => {
    const { nodes } = layoutGraph(["c0", "s0", "d0", "t0"], EDGES, NAME);
    // d0 and t0 have nothing pointing at them; s0 has two; c0 has one more.
    expect(nodes.d0.x).toBeLessThan(nodes.s0.x);
    expect(nodes.t0.x).toBeLessThan(nodes.s0.x);
    expect(nodes.s0.x).toBeLessThan(nodes.c0.x);
  });

  it("puts a dataset downstream when the arrow says so", () => {
    // The reverse of the shape above, which the old lane layout could not
    // draw at all: the script WROTE the dataset.
    const { nodes } = layoutGraph(
      ["s0", "d0"],
      [{ from: "s0", to: "d0", type: LINKS_TO }],
      NAME
    );
    expect(nodes.s0.x).toBeLessThan(nodes.d0.x);
  });

  it("does not stack two artifacts on one another", () => {
    const { nodes } = layoutGraph(["s0", "t0"], [], NAME);
    expect(nodes.s0.y).not.toBe(nodes.t0.y);
  });

  it("is the same picture for the same input", () => {
    const first = layoutGraph(["c0", "s0", "d0"], EDGES, NAME);
    const second = layoutGraph(["c0", "s0", "d0"], EDGES, NAME);
    expect(second.nodes).toEqual(first.nodes);
  });

  it("settles on a graph that loops instead of running forever", () => {
    const { nodes } = layoutGraph(
      ["s0", "c0"],
      [
        { from: "s0", to: "c0", type: LINKS_TO },
        { from: "c0", to: "s0", type: LINKS_TO },
      ],
      NAME
    );
    expect(Object.keys(nodes).sort()).toEqual(["c0", "s0"]);
  });

  it("ignores an association when deciding position", () => {
    // It states no order, so it cannot push anything downstream.
    const { nodes } = layoutGraph(
      ["c0", "c1"],
      [{ from: "c0", to: "c1", type: RELATED_TO }],
      NAME
    );
    expect(nodes.c0.x).toBe(nodes.c1.x);
  });

  it("draws nothing off the canvas", () => {
    const { width, height, nodes } = layoutGraph(
      ["c0", "s0", "d0", "t0"],
      EDGES,
      NAME
    );
    Object.values(nodes).forEach((node) => {
      expect(node.x + node.w).toBeLessThanOrEqual(width);
      expect(node.y + node.h).toBeLessThanOrEqual(height);
    });
  });
});

describe("routing an edge", () => {
  const left = { x: 0, y: 0, w: 100, h: 40 };
  const right = { x: 200, y: 0, w: 100, h: 40 };

  it("leaves one node and arrives at the next", () => {
    expect(edgePath(left, right)).toMatch(/^M 100 20 C/);
  });

  it("keeps the arrowhead on the target even when it sits to the left", () => {
    // The STORED direction decides, never the position, or the picture would
    // contradict the record.
    expect(edgePath(right, left)).toMatch(/^M 200 20 C/);
  });
});

describe("the drawing itself", () => {
  it("draws one node per artifact and one line per connection", () => {
    draw(["c0", "s0", "d0", "t0"], EDGES);
    ["c0", "s0", "d0", "t0"].forEach((id) =>
      expect(screen.getAllByTestId(`fw-lane-node-${id}`)).toHaveLength(1)
    );
    ["d0-s0", "t0-s0", "s0-c0"].forEach((pair) =>
      expect(screen.getByTestId(`fw-lane-edge-${pair}`)).toBeInTheDocument()
    );
  });

  it("shows a kind and a name on a node, and nothing else", () => {
    draw(["s0", "c0"], [{ from: "s0", to: "c0", type: GENERATES }]);
    const node = screen.getByTestId("fw-lane-node-s0");
    expect(node).toHaveTextContent("Script");
    expect(node).toHaveTextContent("plot_dos.py");
    expect(node).not.toHaveTextContent(/generates/i);
  });

  it("carries no lane titles", () => {
    draw(["c0", "s0", "d0"], EDGES);
    const text = screen.getByTestId("fw-lanes").textContent;
    ["Inputs", "Process", "on the left", "in the middle"].forEach((phrase) =>
      expect(text).not.toContain(phrase)
    );
  });

  it("names a node for a reader who cannot see it", () => {
    draw(["c0", "s0"], [{ from: "s0", to: "c0", type: GENERATES }]);
    expect(
      screen.getByRole("button", { name: "Script plot_dos.py" })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("img", { name: /workflow diagram/i })
    ).toBeInTheDocument();
  });

  it("describes a connection in words only where they cannot be seen", () => {
    draw(["s0", "c0"], [{ from: "s0", to: "c0", type: GENERATES }]);
    // In the <title>, which is the accessible name of the line.
    expect(screen.getByTestId("fw-lane-edge-s0-c0")).toHaveTextContent(
      "plot_dos.py generates Density of states"
    );
  });

  it("marks a feedback loop from the record, not from the shape", () => {
    draw(["s0", "c0"], [
      { from: "s0", to: "c0", type: LINKS_TO },
      { from: "c0", to: "s0", type: LINKS_TO, feedback: true },
    ]);
    expect(screen.getByTestId("fw-lane-edge-c0-s0")).toHaveAttribute(
      "data-loop",
      "true"
    );
    // The other edge closes the same loop and is NOT marked: nobody said so.
    expect(screen.getByTestId("fw-lane-edge-s0-c0")).toHaveAttribute(
      "data-loop",
      "false"
    );
    expect(screen.getByTestId("fw-lane-edge-c0-s0")).toHaveTextContent(
      /feedback loop/i
    );
  });

  it("draws an association with a head at each end", () => {
    draw(["c0", "c1"], [{ from: "c0", to: "c1", type: RELATED_TO }]);
    expect(screen.getByTestId("fw-lane-edge-c0-c1")).toHaveAttribute(
      "data-undirected",
      "true"
    );
  });

  it("ignores an edge naming something outside this group", () => {
    draw(["s0", "c0"], [...EDGES, { from: "d9", to: "s0", type: CONSUMES }]);
    expect(screen.queryByTestId("fw-lane-edge-d9-s0")).not.toBeInTheDocument();
  });
});
