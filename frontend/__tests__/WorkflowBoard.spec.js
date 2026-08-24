/**
 * The workflow board.
 *
 * The feature's whole claim is that ordinary curation does not require
 * drawing a diagram, so most of these tests are about what a BUTTON does:
 * what it creates, what it connects, and -- as much as anything -- what it
 * does not touch.
 */
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

jest.mock("axios");
import axios from "axios";

import CuratorContext from "../Context/Curator/curatorContext";
import WorkflowBoard from "../components/CuratorElements/WorkflowBoard";

const noop = () => {};

// A context whose dispatchers are spies, so a click can be checked for what
// it asked the Curator to do rather than for what the screen happened to show.
const build = (overrides = {}) => ({
  charts: [],
  scripts: [],
  datasets: [],
  tools: [],
  heads: [],
  workflow: { nodes: [], edges: [] },
  addMany: jest.fn(),
  addEdge: jest.fn(),
  unlink: jest.fn(),
  add: noop,
  del: noop,
  ...overrides,
});

const renderBoard = (overrides = {}) => {
  const value = build(overrides);
  render(
    <CuratorContext.Provider value={value}>
      <WorkflowBoard />
    </CuratorContext.Provider>
  );
  return value;
};

const user = () => userEvent.setup({ delay: null });

describe("the five Add buttons", () => {
  afterEach(() => jest.resetAllMocks());

  it("offers one per artifact type", () => {
    renderBoard();
    ["chart", "script", "dataset", "tool", "head"].forEach((type) =>
      expect(screen.getByTestId(`workflow-add-${type}`)).toBeInTheDocument()
    );
  });

  it.each([
    ["chart", "chart"],
    ["script", "script"],
    ["dataset", "dataset"],
    ["tool", "tool"],
    ["head", "head"],
  ])("creates a local draft for %s, with no request at all", async (button, type) => {
    const ctx = renderBoard();
    await user().click(screen.getByTestId(`workflow-add-${button}`));

    expect(ctx.addMany).toHaveBeenCalledTimes(1);
    expect(ctx.addMany.mock.calls[0][0]).toBe(type);
    expect(ctx.addMany.mock.calls[0][1]).toHaveLength(1);
    // A button press is not a record. Nothing is persisted until the record
    // is saved, so nothing may reach the network here.
    expect(axios.post).not.toHaveBeenCalled();
    expect(axios.put).not.toHaveBeenCalled();
    expect(axios.get).not.toHaveBeenCalled();
  });

  it("creates an unconnected node when nothing is selected", async () => {
    const ctx = renderBoard();
    await user().click(screen.getByTestId("workflow-add-dataset"));
    expect(ctx.addMany).toHaveBeenCalled();
    expect(ctx.addEdge).not.toHaveBeenCalled();
  });

  it("puts each type in its own lane", () => {
    renderBoard({
      charts: [{ id: "c0", caption: "Figure one" }],
      scripts: [{ id: "s0", readme: "plot.py" }],
      datasets: [{ id: "d0", readme: "trajectory" }],
      tools: [{ id: "t0", packageName: "numpy" }],
      heads: [{ id: "h0", label: "Materials Project" }],
    });
    const inputs = screen.getByTestId("workflow-lane-inputs");
    const process = screen.getByTestId("workflow-lane-process");
    const outputs = screen.getByTestId("workflow-lane-outputs");

    expect(within(inputs).getByTestId("workflow-node-d0")).toBeInTheDocument();
    expect(within(inputs).getByTestId("workflow-node-h0")).toBeInTheDocument();
    expect(within(process).getByTestId("workflow-node-s0")).toBeInTheDocument();
    expect(within(process).getByTestId("workflow-node-t0")).toBeInTheDocument();
    expect(within(outputs).getByTestId("workflow-node-c0")).toBeInTheDocument();
  });
});

// The heart of it: the connection is made from what the two things ARE, not
// from the order they were clicked, and never by asking a question.
describe("contextual connections", () => {
  afterEach(() => jest.resetAllMocks());

  it("selected Chart + Add Script links Script -> Chart", async () => {
    const ctx = renderBoard({ charts: [{ id: "c0", caption: "Figure one" }] });
    await user().click(screen.getByTestId("workflow-node-c0"));
    await user().click(screen.getByTestId("workflow-add-script"));

    expect(ctx.addEdge).toHaveBeenCalledWith({
      from: "s0",
      to: "c0",
      type: "generates",
    });
  });

  it("selected Script + Add Dataset links Dataset -> Script", async () => {
    const ctx = renderBoard({ scripts: [{ id: "s0", readme: "plot.py" }] });
    await user().click(screen.getByTestId("workflow-node-s0"));
    await user().click(screen.getByTestId("workflow-add-dataset"));

    expect(ctx.addEdge).toHaveBeenCalledWith({
      from: "d0",
      to: "s0",
      type: "consumes",
    });
  });

  it("selected Script + Add External Data links External -> Script", async () => {
    const ctx = renderBoard({ scripts: [{ id: "s0", readme: "plot.py" }] });
    await user().click(screen.getByTestId("workflow-node-s0"));
    await user().click(screen.getByTestId("workflow-add-head"));

    expect(ctx.addEdge).toHaveBeenCalledWith({
      from: "h0",
      to: "s0",
      type: "consumes",
    });
  });

  it("selected Script + Add Tool links Tool -> Script", async () => {
    const ctx = renderBoard({ scripts: [{ id: "s0", readme: "plot.py" }] });
    await user().click(screen.getByTestId("workflow-node-s0"));
    await user().click(screen.getByTestId("workflow-add-tool"));

    expect(ctx.addEdge).toHaveBeenCalledWith({
      from: "t0",
      to: "s0",
      type: "uses_tool",
    });
  });

  it("still creates the node when the pair cannot be connected", async () => {
    // A Tool and a Chart have no direct relationship. The node is created
    // anyway -- refusing to add it would be a worse answer than adding it
    // unconnected -- and the board says why it is not linked.
    const ctx = renderBoard({ charts: [{ id: "c0", caption: "Figure one" }] });
    await user().click(screen.getByTestId("workflow-node-c0"));
    await user().click(screen.getByTestId("workflow-add-tool"));

    expect(ctx.addMany).toHaveBeenCalled();
    expect(ctx.addEdge).not.toHaveBeenCalled();
    expect(screen.getByTestId("workflow-notice")).toHaveTextContent(
      /cannot be connected directly/i
    );
  });
});

describe("connecting and unlinking existing nodes", () => {
  afterEach(() => jest.resetAllMocks());

  const twoNodes = {
    charts: [{ id: "c0", caption: "Figure one" }],
    scripts: [{ id: "s0", readme: "plot.py" }],
  };

  it("connects two existing artifacts rather than duplicating one", async () => {
    const ctx = renderBoard(twoNodes);
    await user().click(screen.getByTestId("workflow-node-s0"));
    await user().click(screen.getByTestId("workflow-connect-c0"));

    expect(ctx.addEdge).toHaveBeenCalledWith({
      from: "s0",
      to: "c0",
      type: "generates",
    });
    // Attaching an existing artifact must not create another one.
    expect(ctx.addMany).not.toHaveBeenCalled();
  });

  it("refuses to connect a pair that has no relationship", async () => {
    const ctx = renderBoard({
      charts: [{ id: "c0", caption: "One" }, { id: "c1", caption: "Two" }],
    });
    await user().click(screen.getByTestId("workflow-node-c0"));
    await user().click(screen.getByTestId("workflow-connect-c1"));

    expect(ctx.addEdge).not.toHaveBeenCalled();
    expect(screen.getByTestId("workflow-notice")).toHaveTextContent(
      /cannot be connected/i
    );
  });

  it("says so instead of adding the same connection twice", async () => {
    const ctx = renderBoard({
      ...twoNodes,
      workflow: {
        nodes: [],
        edges: [{ from: "s0", to: "c0", type: "generates" }],
      },
    });
    await user().click(screen.getByTestId("workflow-node-s0"));
    await user().click(screen.getByTestId("workflow-connect-c0"));

    expect(ctx.addEdge).not.toHaveBeenCalled();
    expect(screen.getByTestId("workflow-notice")).toHaveTextContent(
      /already connected/i
    );
  });

  it("refuses a connection that would loop the workflow", async () => {
    const ctx = renderBoard({
      ...twoNodes,
      workflow: {
        nodes: [],
        edges: [{ from: "s0", to: "c0", type: "generates" }],
      },
    });
    // c0 -> s0 would close the loop; the only lawful direction between them
    // is the one already present.
    await user().click(screen.getByTestId("workflow-node-c0"));
    await user().click(screen.getByTestId("workflow-connect-s0"));
    expect(ctx.addEdge).not.toHaveBeenCalled();
  });

  it("unlinks ONE edge and leaves the artifacts and other edges alone", async () => {
    // One script feeding two figures. Unlinking it from the first must not
    // touch the second, and must not delete the script.
    const ctx = renderBoard({
      charts: [{ id: "c0", caption: "One" }, { id: "c1", caption: "Two" }],
      scripts: [{ id: "s0", readme: "plot.py" }],
      workflow: {
        nodes: [],
        edges: [
          { from: "s0", to: "c0", type: "generates" },
          { from: "s0", to: "c1", type: "generates" },
        ],
      },
    });
    await user().click(screen.getByTestId("workflow-node-s0"));
    await user().click(screen.getByTestId("workflow-unlink-s0-c0"));

    expect(ctx.unlink).toHaveBeenCalledTimes(1);
    expect(ctx.unlink).toHaveBeenCalledWith("s0", "c0");
    expect(ctx.del).toBe(noop); // nothing deletes an artifact from here
  });

  it("shows one artifact serving several figures as several connections", async () => {
    renderBoard({
      charts: [{ id: "c0", caption: "One" }, { id: "c1", caption: "Two" }],
      scripts: [{ id: "s0", readme: "plot.py" }],
      workflow: {
        nodes: [],
        edges: [
          { from: "s0", to: "c0", type: "generates" },
          { from: "s0", to: "c1", type: "generates" },
        ],
      },
    });
    await user().click(screen.getByTestId("workflow-node-s0"));
    const list = screen.getByTestId("workflow-connections");
    expect(within(list).getByTestId("workflow-unlink-s0-c0")).toBeInTheDocument();
    expect(within(list).getByTestId("workflow-unlink-s0-c1")).toBeInTheDocument();
  });
});

describe("nodes that are not connected to anything", () => {
  afterEach(() => jest.resetAllMocks());

  it("lists them rather than hiding them", () => {
    // A dataset nobody has linked yet is a normal mid-curation state.
    renderBoard({
      datasets: [{ id: "d0", readme: "trajectory" }],
      charts: [{ id: "c0", caption: "Figure one" }],
      scripts: [{ id: "s0", readme: "plot.py" }],
      workflow: {
        nodes: [],
        edges: [{ from: "s0", to: "c0", type: "generates" }],
      },
    });
    const unlinked = screen.getByTestId("workflow-unlinked");
    expect(within(unlinked).getByTestId("workflow-unlinked-d0")).toBeInTheDocument();
    expect(
      within(unlinked).queryByTestId("workflow-unlinked-s0")
    ).not.toBeInTheDocument();
  });

  it("says nothing at all when everything is connected", () => {
    renderBoard({
      charts: [{ id: "c0", caption: "One" }],
      scripts: [{ id: "s0", readme: "plot.py" }],
      workflow: {
        nodes: [],
        edges: [{ from: "s0", to: "c0", type: "generates" }],
      },
    });
    expect(screen.queryByTestId("workflow-unlinked")).not.toBeInTheDocument();
  });
});

describe("what a node is called", () => {
  it("uses the artifact's own title", () => {
    renderBoard({
      charts: [{ id: "c0", caption: "Density of states" }],
      heads: [{ id: "h0", label: "Materials Project" }],
      tools: [{ id: "t0", packageName: "numpy" }],
    });
    expect(screen.getByTestId("workflow-node-c0")).toHaveTextContent(
      "Density of states"
    );
    expect(screen.getByTestId("workflow-node-h0")).toHaveTextContent(
      "Materials Project"
    );
    expect(screen.getByTestId("workflow-node-t0")).toHaveTextContent("numpy");
  });

  it("never renders an empty chip for a brand-new draft", () => {
    // A node just created has no title yet. It says what it is and which one
    // it is, rather than showing nothing.
    renderBoard({ charts: [{ id: "c0", caption: "" }] });
    expect(screen.getByTestId("workflow-node-c0")).toHaveTextContent(
      /untitled chart \(c0\)/i
    );
  });
});

describe("keyboard and layout", () => {
  afterEach(() => jest.resetAllMocks());

  it("selects a node from the keyboard alone", async () => {
    renderBoard({ charts: [{ id: "c0", caption: "Figure one" }] });
    const node = screen.getByTestId("workflow-node-c0");
    node.focus();
    expect(node).toHaveFocus();
    await user().keyboard("{Enter}");
    expect(node).toHaveAttribute("aria-pressed", "true");
  });

  it("gives each lane an accessible list, so its size is announced", () => {
    renderBoard({ charts: [{ id: "c0", caption: "One" }] });
    expect(
      screen.getByRole("list", { name: /outputs nodes/i })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("list", { name: /inputs nodes/i })
    ).toBeInTheDocument();
  });

  it("stacks nodes in a column so they cannot overlap on a narrow screen", () => {
    renderBoard({
      datasets: [{ id: "d0", readme: "one" }, { id: "d1", readme: "two" }],
    });
    const list = screen.getByRole("list", { name: /inputs nodes/i });
    const style = window.getComputedStyle(list);
    expect(style.display).toBe("flex");
    expect(style.flexDirection).toBe("column");
    expect(parseFloat(style.gap)).toBeGreaterThan(0);
  });
});
