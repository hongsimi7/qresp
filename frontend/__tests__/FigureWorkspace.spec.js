/**
 * The figure-first Curator workspace.
 *
 * It replaces four top-level sections that asked a curator to think in Qresp's
 * storage categories -- Add Charts, Add Tools, Add Datasets, Add Scripts --
 * and then connect them separately. The tests below are mostly about two
 * claims: the figure is the root, and every form opened here is the EXISTING
 * form on the EXISTING model.
 */
import { useState } from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

jest.mock("axios");
import axios from "axios";

// The real forms mount inside the workspace for their dialogs. They pull in
// file-tree and RCC machinery that has nothing to do with these assertions,
// so they are stubbed to the one thing that matters here: they must be
// rendered with their own trigger hidden.
jest.mock("../components/CuratorForms/ChartsInfoForm", () => {
  const Stub = (props) => <div data-testid="stub-chart-form" data-hidden={String(!!props.hideTrigger)} />;
  return Stub;
});
jest.mock("../components/CuratorForms/ScriptsInfoForm", () => {
  const Stub = (props) => <div data-testid="stub-script-form" data-hidden={String(!!props.hideTrigger)} />;
  return Stub;
});
jest.mock("../components/CuratorForms/DatasetsInfoForm", () => {
  const Stub = (props) => <div data-testid="stub-dataset-form" data-hidden={String(!!props.hideTrigger)} />;
  return Stub;
});
jest.mock("../components/CuratorForms/ToolsInfoForm", () => {
  const Stub = (props) => <div data-testid="stub-tool-form" data-hidden={String(!!props.hideTrigger)} />;
  return Stub;
});
jest.mock("../components/CuratorElements/FolderAnalysis", () => {
  const { useMemo } = jest.requireActual("react");
  let mounted = 0;
  const Stub = (props) => {
    const instance = useMemo(() => String((mounted += 1)), []);
    return (
      <div
        data-testid="stub-folder-analysis"
        data-type={props.artifactType || ""}
        data-hidden={String(!!props.hideTrigger)}
        data-auto={String(!!props.autoOpen)}
        data-instance={instance}
      />
    );
  };
  return Stub;
});

import CuratorContext from "../Context/Curator/curatorContext";
import CuratorHelperContext from "../Context/CuratorHelpers/curatorHelperContext";
import FigureWorkspace from "../components/CuratorElements/FigureWorkspace";

const build = (overrides = {}) => ({
  charts: [],
  scripts: [],
  datasets: [],
  tools: [],
  heads: [],
  workflow: { nodes: [], edges: [] },
  addEdge: jest.fn(),
  unlink: jest.fn(),
  del: jest.fn(),
  ...overrides,
});

const buildHelpers = () => ({
  openForm: jest.fn(),
  setDefault: jest.fn(),
  setExternalNodeFormOpen: jest.fn(),
});

const renderWorkspace = (overrides = {}, helpers = buildHelpers()) => {
  const value = build(overrides);
  const view = render(
    <CuratorHelperContext.Provider value={helpers}>
      <CuratorContext.Provider value={value}>
        <FigureWorkspace />
      </CuratorContext.Provider>
    </CuratorHelperContext.Provider>
  );
  const rerenderWith = (next) =>
    view.rerender(
      <CuratorHelperContext.Provider value={helpers}>
        <CuratorContext.Provider value={build({ ...overrides, ...next, addEdge: value.addEdge, unlink: value.unlink, del: value.del })}>
          <FigureWorkspace />
        </CuratorContext.Provider>
      </CuratorHelperContext.Provider>
    );
  return { ...value, helpers, rerenderWith };
};

const user = () => userEvent.setup({ delay: null });

const FIGURE = { id: "c0", caption: "Density of states" };
const SCRIPT = { id: "s0", readme: "plot_dos.py" };

describe("the section that replaced four", () => {
  afterEach(() => jest.resetAllMocks());

  it("is one workspace headed for figures and resources", () => {
    renderWorkspace();
    // MUI's Accordion nests a heading wrapper around the title, so there are
    // two matching nodes for one visible heading.
    expect(
      screen.getAllByRole("heading", { name: /organize figures and resources/i })
        .length
    ).toBeGreaterThan(0);
  });

  it("offers one way in", () => {
    renderWorkspace();
    expect(screen.getByTestId("fw-addlink")).toHaveTextContent(
      /add or link resource/i
    );
  });

  it("shows none of the old per-type top-level Add sections", () => {
    renderWorkspace({ charts: [FIGURE], scripts: [SCRIPT] });
    // The four headings that used to be top-level sections.
    [
      /add charts from your paper/i,
      /add tools/i,
      /add datasets/i,
      /add scripts/i,
    ].forEach((heading) =>
      expect(screen.queryByRole("heading", { name: heading })).not.toBeInTheDocument()
    );
  });

  it("mounts the real forms with their own triggers hidden", () => {
    // The forms are here for their dialogs. Showing their own Add buttons
    // would put a second way to do the same thing beside the contextual one.
    renderWorkspace();
    ["chart", "script", "dataset", "tool"].forEach((kind) =>
      expect(screen.getByTestId(`stub-${kind}-form`)).toHaveAttribute(
        "data-hidden",
        "true"
      )
    );
  });

  it("keeps RCC import reachable from the same place", async () => {
    const u = user();
    renderWorkspace({ fileServerPath: "/proj" });
    await openRccFor(u);
    expect(screen.getByTestId("fw-source-rcc")).toBeInTheDocument();
  });
});

describe("Add Figure reuses the existing Chart model", () => {
  afterEach(() => jest.resetAllMocks());

  it("opens the real Chart form for a NEW chart", async () => {
    const u = user();
    const helpers = buildHelpers();
    renderWorkspace({}, helpers);
    await openAddFor(u, "");
    await u.click(screen.getByTestId("fw-add--chart"));

    expect(helpers.setDefault).toHaveBeenCalledWith("chart", null);
    expect(helpers.openForm).toHaveBeenCalledWith("chart");
  });

  it("creates no artifact and no edge merely by opening the form", async () => {
    // Cancel is the common case, and it must leave nothing behind.
    const u = user();
    const ctx = renderWorkspace();
    await openAddFor(u, "");
    await u.click(screen.getByTestId("fw-add--chart"));
    expect(ctx.addEdge).not.toHaveBeenCalled();
    expect(axios.post).not.toHaveBeenCalled();
    expect(axios.put).not.toHaveBeenCalled();
  });
});

// ---- shared helpers for the outline UI ---------------------------------
// One control, asked one question at a time: these walk it.
const openFlowFor = async (u, id) => {
  await u.click(screen.getByTestId(id ? `fw-addlink-${id}` : "fw-addlink"));
  return screen.findByTestId("fw-flow-menu");
};
const openLinkFor = async (u, id) => {
  await openFlowFor(u, id);
  await u.click(screen.getByTestId(`fw-link-${id}`));
  return screen.findByTestId("fw-link-dialog");
};
const openAddFor = async (u, id) => {
  await openFlowFor(u, id);
  await u.click(screen.getByTestId("fw-flow-new"));
  await u.click(screen.getByTestId("fw-source-manual"));
  return screen.findByTestId("fw-flow-menu");
};
const openRccFor = async (u) => {
  await openFlowFor(u, "");
  await u.click(screen.getByTestId("fw-flow-new"));
  return screen.findByTestId("fw-flow-menu");
};
const openMoreFor = async (u, id) => {
  await u.click(screen.getByTestId(`fw-more-${id}`));
  return screen.findByTestId("fw-more-menu");
};

describe("the figure is the root", () => {
  afterEach(() => jest.resetAllMocks());

  const paper = {
    charts: [FIGURE],
    scripts: [SCRIPT],
    datasets: [{ id: "d0", readme: "spectra" }],
    tools: [{ id: "t0", packageName: "numpy" }],
    workflow: {
      nodes: [],
      edges: [
        { from: "s0", to: "c0", type: "generates" },
        { from: "d0", to: "s0", type: "consumes" },
        { from: "t0", to: "s0", type: "uses_tool" },
      ],
    },
  };

  it("reads as one outline, result first and inputs beneath", () => {
    renderWorkspace(paper);
    const figure = within(screen.getByTestId("fw-group-c0"));

    expect(figure.getByTestId("fw-node-s0")).toBeInTheDocument();
    expect(figure.getByTestId("fw-node-d0")).toBeInTheDocument();
    expect(figure.getByTestId("fw-node-t0")).toBeInTheDocument();
    // The headings that say what each group IS.
    ["Generated by", "Uses input", "Uses tool"].forEach((heading) =>
      expect(figure.getByText(heading)).toBeInTheDocument()
    );
  });

  it("writes the flow direction into every relationship", () => {
    // Indentation says "belongs to"; only the sentence says which way the
    // data actually moved.
    renderWorkspace(paper);
    expect(screen.getByTestId("fw-flow-s0-c0")).toHaveTextContent(
      "plot_dos.py → generates → Density of states"
    );
    expect(screen.getByTestId("fw-flow-d0-s0")).toHaveTextContent(
      "spectra → supplies input to → plot_dos.py"
    );
    expect(screen.getByTestId("fw-flow-t0-s0")).toHaveTextContent(
      "numpy → is used by → plot_dos.py"
    );
  });

  it("gives a bare figure one line and a way forward", () => {
    renderWorkspace({ charts: [FIGURE] });
    expect(screen.getByTestId("fw-empty-c0")).toHaveTextContent(
      /no connected resources yet/i
    );
    expect(screen.getByTestId("fw-addlink-c0")).toBeInTheDocument();
  });

  it("says so plainly when there is nothing yet", () => {
    renderWorkspace();
    expect(screen.getByText(/no workflow yet/i)).toBeInTheDocument();
  });

  it("tells a curator with resources but no links what to do", () => {
    // Artifacts exist; none is joined to anything. That is not "no figures".
    renderWorkspace({ charts: [FIGURE], scripts: [SCRIPT] });
    expect(screen.getByText(/nothing is connected yet/i)).toBeInTheDocument();
  });

  it("keeps one action on the row and the rest behind ⋮", async () => {
    const u = user();
    renderWorkspace({ charts: [FIGURE] });

    expect(screen.getByTestId("fw-addlink-c0")).toHaveTextContent(
      /add or link/i
    );
    // Edit and Remove are not competing with the name.
    expect(screen.queryByTestId("fw-edit-c0")).not.toBeInTheDocument();
    expect(screen.queryByTestId("fw-remove-c0")).not.toBeInTheDocument();

    await openMoreFor(u, "c0");
    expect(screen.getByTestId("fw-edit-c0")).toBeInTheDocument();
    expect(screen.getByTestId("fw-remove-c0")).toBeInTheDocument();
  });
});

describe("a script chain", () => {
  afterEach(() => jest.resetAllMocks());

  const chain = {
    charts: [FIGURE],
    scripts: [SCRIPT, { id: "s1", readme: "preprocess.py" }],
    workflow: {
      nodes: [],
      edges: [
        { from: "s0", to: "c0", type: "generates" },
        { from: "s1", to: "s0", type: "feeds_into" },
      ],
    },
  };

  it("nests preprocess.py under the script it feeds", () => {
    renderWorkspace(chain);
    const generator = within(screen.getByTestId("fw-node-s0"));

    expect(generator.getByTestId("fw-node-s1")).toBeInTheDocument();
    expect(generator.getByText("Receives from script")).toBeInTheDocument();
    expect(screen.getByTestId("fw-flow-s1-s0")).toHaveTextContent(
      "preprocess.py → feeds into → plot_dos.py"
    );
  });

  it("offers the relationship in both directions, as two sentences", async () => {
    const u = user();
    renderWorkspace({ charts: [FIGURE], scripts: [SCRIPT, { id: "s1", readme: "preprocess.py" }] });
    await openLinkFor(u, "s0");

    // Which script is upstream is the curator's to say, so both readings
    // are offered and neither is guessed.
    expect(screen.getByTestId("fw-link-sentence-s1-s0-feeds_into")).toHaveTextContent(
      "Script: preprocess.py → feeds into → Script: plot_dos.py"
    );
    expect(screen.getByTestId("fw-link-sentence-s0-s1-feeds_into")).toHaveTextContent(
      "Script: plot_dos.py → feeds into → Script: preprocess.py"
    );
  });

  it("links a script to a script and nothing else", async () => {
    const u = user();
    const ctx = renderWorkspace({
      charts: [FIGURE],
      scripts: [SCRIPT, { id: "s1", readme: "preprocess.py" }],
    });
    await openLinkFor(u, "s0");
    await u.click(screen.getByTestId("fw-link-option-s1-s0-feeds_into"));
    await u.click(screen.getByTestId("fw-link-apply"));

    expect(ctx.addEdge).toHaveBeenCalledTimes(1);
    expect(ctx.addEdge).toHaveBeenCalledWith({
      from: "s1",
      to: "s0",
      type: "feeds_into",
    });
  });

  it("never offers a script itself", async () => {
    const u = user();
    renderWorkspace({ charts: [FIGURE], scripts: [SCRIPT] });
    await openLinkFor(u, "s0");
    expect(screen.queryByTestId("fw-link-option-s0-s0-feeds_into")).not.toBeInTheDocument();
  });

  it("shows the direction already recorded as made", async () => {
    const u = user();
    renderWorkspace(chain);
    await openLinkFor(u, "s0");
    expect(screen.getByTestId("fw-link-option-s1-s0-feeds_into")).toBeDisabled();
  });

  it("offers a candidate that would close a loop, to be confirmed", async () => {
    // Refinement is real work, so the connection is offered -- and asked
    // about before it is made. See "feedback loops".
    const u = user();
    renderWorkspace({
      charts: [FIGURE],
      scripts: [
        { id: "s0", readme: "a.py" },
        { id: "s1", readme: "b.py" },
        { id: "s2", readme: "c.py" },
      ],
      workflow: {
        nodes: [],
        edges: [
          { from: "s0", to: "s1", type: "feeds_into" },
          { from: "s1", to: "s2", type: "feeds_into" },
        ],
      },
    });
    await openLinkFor(u, "s0");
    expect(screen.getByTestId("fw-link-option-s2-s0-feeds_into")).toBeEnabled();
  });

  it("terminates on a graph that should never have been stored", () => {
    // The server refuses a cycle, so one can only arrive from outside the
    // product. The outline marks a node before descending into it, so it
    // renders rather than hanging.
    renderWorkspace({
      charts: [],
      scripts: [
        { id: "s0", readme: "a.py" },
        { id: "s1", readme: "b.py" },
      ],
      workflow: {
        nodes: [],
        edges: [
          { from: "s0", to: "s1", type: "feeds_into" },
          { from: "s1", to: "s0", type: "feeds_into" },
        ],
      },
    });
    expect(screen.getByTestId("fw-node-s0")).toBeInTheDocument();
    expect(screen.getByTestId("fw-node-s1")).toBeInTheDocument();
  });

  it("joins two scripts and no other same-kind pair", async () => {
    const u = user();
    renderWorkspace({
      charts: [FIGURE, { id: "c1", caption: "Second figure" }],
      datasets: [
        { id: "d0", readme: "one" },
        { id: "d1", readme: "two" },
      ],
    });
    await openLinkFor(u, "d0");

    // A derived dataset is a real relationship that needs a model of its
    // own; it is not this one.
    expect(screen.queryByTestId("fw-link-option-d0-d1")).not.toBeInTheDocument();
    expect(screen.queryByTestId("fw-link-option-d1-d0")).not.toBeInTheDocument();
    await u.click(screen.getByTestId("fw-link-cancel"));
    await openLinkFor(u, "c0");
    expect(screen.queryByTestId("fw-link-option-c0-c1")).not.toBeInTheDocument();
  });
});

describe("a shared resource appears once", () => {
  afterEach(() => jest.resetAllMocks());

  const shared = {
    charts: [FIGURE, { id: "c1", caption: "Band structure" }],
    scripts: [SCRIPT],
    workflow: {
      nodes: [],
      edges: [
        { from: "s0", to: "c0", type: "generates" },
        { from: "s0", to: "c1", type: "generates" },
      ],
    },
  };

  it("renders the real node once and a reference after that", () => {
    renderWorkspace(shared);

    // One editable node for one artifact -- not two.
    expect(screen.getAllByTestId("fw-node-s0")).toHaveLength(1);
    expect(screen.getByTestId("fw-ref-s0-c1")).toBeInTheDocument();
    expect(screen.getByTestId("fw-ref-s0-c1")).toHaveTextContent(
      /shown in full elsewhere/i
    );
  });

  it("says on the real node that it is shared", () => {
    renderWorkspace(shared);
    expect(screen.getByTestId("fw-shared-s0")).toHaveTextContent(/also used by/i);
  });

  it("still states the flow at the reference", () => {
    renderWorkspace(shared);
    expect(screen.getByTestId("fw-flow-s0-c1")).toHaveTextContent(
      "plot_dos.py → generates → Band structure"
    );
  });

  it("offers a way back to the real node", () => {
    renderWorkspace(shared);
    expect(screen.getByTestId("fw-goto-s0-c1")).toHaveAttribute(
      "data-target",
      "fw-anchor-s0"
    );
    expect(screen.getByTestId("fw-node-s0")).toHaveAttribute("id", "fw-anchor-s0");
  });

  it("gives the reference no editing actions of its own", () => {
    // Two editable copies of one artifact is how a curator ends up thinking
    // they have two.
    renderWorkspace(shared);
    const reference = within(screen.getByTestId("fw-ref-s0-c1"));
    expect(reference.queryByTestId("fw-link-s0")).not.toBeInTheDocument();
    expect(reference.queryByTestId("fw-more-s0")).not.toBeInTheDocument();
  });
});

describe("contextual creation", () => {
  afterEach(() => jest.resetAllMocks());

  const saved = (ctx, next) => ctx.rerenderWith(next);

  it("offers only the kinds that can legally join the row", async () => {
    const u = user();
    renderWorkspace({ charts: [FIGURE], tools: [{ id: "t0", packageName: "numpy" }] });

    await openAddFor(u, "c0");
    ["script", "dataset", "head"].forEach((type) =>
      expect(screen.getByTestId(`fw-add-c0-${type}`)).toBeInTheDocument()
    );
    // A tool cannot join a figure, so it is not offered here.
    expect(screen.queryByTestId("fw-add-c0-tool")).not.toBeInTheDocument();
  });

  it("offers a script the kinds a script can hold, including another script", async () => {
    const u = user();
    renderWorkspace({ charts: [FIGURE], scripts: [SCRIPT] });
    await openAddFor(u, "s0");

    ["chart", "script", "tool", "dataset", "head"].forEach((type) =>
      expect(screen.getByTestId(`fw-add-s0-${type}`)).toBeInTheDocument()
    );
  });

  it("opens the real form and creates nothing yet", async () => {
    const u = user();
    const ctx = renderWorkspace({ charts: [FIGURE] });
    await openAddFor(u, "c0");
    await u.click(screen.getByTestId("fw-add-c0-script"));

    expect(ctx.helpers.setDefault).toHaveBeenCalledWith("script", null);
    expect(ctx.helpers.openForm).toHaveBeenCalledWith("script");
    expect(ctx.addEdge).not.toHaveBeenCalled();
  });

  it("creates Script -> Figure only AFTER the form saves", async () => {
    const u = user();
    const ctx = renderWorkspace({ charts: [FIGURE] });
    await openAddFor(u, "c0");
    await u.click(screen.getByTestId("fw-add-c0-script"));
    expect(ctx.addEdge).not.toHaveBeenCalled();

    saved(ctx, { charts: [FIGURE], scripts: [SCRIPT] });
    expect(ctx.addEdge).toHaveBeenCalledWith({
      from: "s0",
      to: "c0",
      type: "generates",
    });
  });

  it("creates Dataset -> Script as consumes after save", async () => {
    const u = user();
    const ctx = renderWorkspace({ charts: [FIGURE], scripts: [SCRIPT] });
    await openAddFor(u, "s0");
    await u.click(screen.getByTestId("fw-add-s0-dataset"));
    saved(ctx, {
      charts: [FIGURE],
      scripts: [SCRIPT],
      datasets: [{ id: "d0", readme: "spectra" }],
    });

    expect(ctx.addEdge).toHaveBeenCalledWith({
      from: "d0",
      to: "s0",
      type: "consumes",
    });
  });

  it("creates Script -> Script as feeds_into after save", async () => {
    const u = user();
    const ctx = renderWorkspace({ charts: [FIGURE], scripts: [SCRIPT] });
    await openAddFor(u, "s0");
    await u.click(screen.getByTestId("fw-add-s0-script"));
    saved(ctx, {
      charts: [FIGURE],
      scripts: [SCRIPT, { id: "s1", readme: "preprocess.py" }],
    });

    // The new script is UPSTREAM of the one it was added from.
    expect(ctx.addEdge).toHaveBeenCalledWith({
      from: "s1",
      to: "s0",
      type: "feeds_into",
    });
  });

  it("connects nothing when the form was cancelled", async () => {
    const u = user();
    const ctx = renderWorkspace({ charts: [FIGURE] });
    await openAddFor(u, "c0");
    await u.click(screen.getByTestId("fw-add-c0-script"));
    // Cancel leaves the lists exactly as they were.
    saved(ctx, { charts: [FIGURE] });

    expect(ctx.addEdge).not.toHaveBeenCalled();
  });
});

describe("link existing", () => {
  afterEach(() => jest.resetAllMocks());

  const paper = {
    charts: [FIGURE],
    scripts: [SCRIPT],
    datasets: [{ id: "d0", readme: "spectra" }],
  };

  it("asks about the row it was opened from", async () => {
    const u = user();
    renderWorkspace(paper);
    await openLinkFor(u, "c0");

    expect(screen.getByTestId("fw-link-dialog")).toHaveTextContent(
      /what existing resource belongs to .*Figure: Density of states/i
    );
  });

  it("shows the exact sentence each tick would create", async () => {
    const u = user();
    renderWorkspace(paper);
    await openLinkFor(u, "c0");

    expect(screen.getByTestId("fw-link-sentence-s0-c0-generates")).toHaveTextContent(
      "Script: plot_dos.py → generates → Figure: Density of states"
    );
    expect(screen.getByTestId("fw-link-sentence-d0-c0-consumes")).toHaveTextContent(
      "Dataset: spectra → supplies input to → Figure: Density of states"
    );
  });

  it("never offers a Tool to a Figure", async () => {
    const u = user();
    renderWorkspace({
      charts: [FIGURE],
      scripts: [SCRIPT],
      tools: [{ id: "t0", packageName: "numpy" }],
    });
    await openLinkFor(u, "c0");

    expect(screen.queryByTestId("fw-link-option-t0-c0")).not.toBeInTheDocument();
    expect(screen.getByTestId("fw-link-option-s0-c0-generates")).toBeInTheDocument();
  });

  it("links one Script to several Figures at once", async () => {
    const u = user();
    const ctx = renderWorkspace({
      charts: [
        FIGURE,
        { id: "c1", caption: "Band structure" },
        { id: "c2", caption: "Phonon spectrum" },
      ],
      scripts: [SCRIPT],
    });
    await openLinkFor(u, "s0");
    await u.click(screen.getByTestId("fw-link-option-s0-c0-generates"));
    await u.click(screen.getByTestId("fw-link-option-s0-c2-generates"));
    await u.click(screen.getByTestId("fw-link-apply"));

    expect(ctx.addEdge).toHaveBeenCalledTimes(2);
    expect(ctx.addEdge).toHaveBeenCalledWith({ from: "s0", to: "c0", type: "generates" });
    expect(ctx.addEdge).toHaveBeenCalledWith({ from: "s0", to: "c2", type: "generates" });
    // One script, two figures, no clone and no form.
    expect(ctx.helpers.openForm).not.toHaveBeenCalled();
    expect(ctx.helpers.setDefault).not.toHaveBeenCalled();
  });

  it("links one Dataset to several Scripts and Figures at once", async () => {
    const u = user();
    const ctx = renderWorkspace({
      charts: [FIGURE],
      scripts: [SCRIPT, { id: "s1", readme: "fit.py" }],
      datasets: [{ id: "d0", readme: "spectra" }],
    });
    await openLinkFor(u, "d0");
    await u.click(screen.getByTestId("fw-link-option-d0-s0-consumes"));
    await u.click(screen.getByTestId("fw-link-option-d0-s1-consumes"));
    await u.click(screen.getByTestId("fw-link-option-d0-c0-consumes"));
    await u.click(screen.getByTestId("fw-link-apply"));

    expect(ctx.addEdge).toHaveBeenCalledTimes(3);
    ["s0", "s1", "c0"].forEach((target) =>
      expect(ctx.addEdge).toHaveBeenCalledWith({
        from: "d0",
        to: target,
        type: "consumes",
      })
    );
    expect(ctx.helpers.openForm).not.toHaveBeenCalled();
  });

  it("links one Tool to several Scripts, and offers no Figure", async () => {
    const u = user();
    const ctx = renderWorkspace({
      charts: [FIGURE],
      scripts: [SCRIPT, { id: "s1", readme: "fit.py" }],
      tools: [{ id: "t0", packageName: "numpy" }],
    });
    await openLinkFor(u, "t0");
    expect(screen.queryByTestId("fw-link-option-t0-c0")).not.toBeInTheDocument();

    await u.click(screen.getByTestId("fw-link-option-t0-s0-uses_tool"));
    await u.click(screen.getByTestId("fw-link-option-t0-s1-uses_tool"));
    await u.click(screen.getByTestId("fw-link-apply"));

    expect(ctx.addEdge).toHaveBeenCalledTimes(2);
    ["s0", "s1"].forEach((target) =>
      expect(ctx.addEdge).toHaveBeenCalledWith({
        from: "t0",
        to: target,
        type: "uses_tool",
      })
    );
  });

  it("links External Data to both a Script and a Figure", async () => {
    const u = user();
    const ctx = renderWorkspace({
      charts: [FIGURE],
      scripts: [SCRIPT],
      heads: [{ id: "h0", URLs: ["https://example.org/set"] }],
    });
    await openLinkFor(u, "h0");
    await u.click(screen.getByTestId("fw-link-option-h0-s0-consumes"));
    await u.click(screen.getByTestId("fw-link-option-h0-c0-consumes"));
    await u.click(screen.getByTestId("fw-link-apply"));

    expect(ctx.addEdge).toHaveBeenCalledTimes(2);
    ["s0", "c0"].forEach((target) =>
      expect(ctx.addEdge).toHaveBeenCalledWith({
        from: "h0",
        to: target,
        type: "consumes",
      })
    );
  });

  it("shows an existing link as made and will not remake it", async () => {
    const u = user();
    const ctx = renderWorkspace({
      ...paper,
      workflow: { nodes: [], edges: [{ from: "s0", to: "c0", type: "generates" }] },
    });
    await openLinkFor(u, "c0");

    const already = screen.getByTestId("fw-link-option-s0-c0-generates");
    expect(already).toBeChecked();
    expect(already).toBeDisabled();
    expect(screen.getByTestId("fw-link-dialog")).toHaveTextContent(/already linked/i);

    await u.click(screen.getByTestId("fw-link-option-d0-c0-consumes"));
    await u.click(screen.getByTestId("fw-link-apply"));
    expect(ctx.addEdge).toHaveBeenCalledTimes(1);
    expect(ctx.addEdge).toHaveBeenCalledWith({
      from: "d0",
      to: "c0",
      type: "consumes",
    });
  });

  it("treats a legacy untyped pair as already linked", async () => {
    const u = user();
    renderWorkspace({ ...paper, workflow: { nodes: [], edges: [["s0", "c0"]] } });
    await openLinkFor(u, "c0");
    expect(screen.getByTestId("fw-link-option-s0-c0-generates")).toBeDisabled();
  });

  it("makes nothing when the dialog is cancelled", async () => {
    const u = user();
    const ctx = renderWorkspace(paper);
    await openLinkFor(u, "c0");
    await u.click(screen.getByTestId("fw-link-option-s0-c0-generates"));
    await u.click(screen.getByTestId("fw-link-cancel"));

    expect(ctx.addEdge).not.toHaveBeenCalled();
    expect(ctx.helpers.openForm).not.toHaveBeenCalled();
    expect(ctx.helpers.setDefault).not.toHaveBeenCalled();
    expect(screen.queryByTestId("fw-link-dialog")).not.toBeInTheDocument();
  });

  it("is offered on every row, not only under a figure", () => {
    renderWorkspace({
      charts: [FIGURE],
      scripts: [SCRIPT],
      datasets: [{ id: "d0", readme: "spectra" }],
      tools: [{ id: "t0", packageName: "numpy" }],
      heads: [{ id: "h0", URLs: ["https://example.org/set"] }],
    });
    ["c0", "s0", "d0", "t0", "h0"].forEach((id) =>
      expect(screen.getByTestId(`fw-addlink-${id}`)).toBeInTheDocument()
    );
  });

  it("says so when there is genuinely nothing to link to", async () => {
    const u = user();
    renderWorkspace({ charts: [FIGURE] });
    await openLinkFor(u, "c0");

    expect(screen.getByTestId("fw-link-apply")).toBeDisabled();
    expect(screen.getByTestId("fw-link-dialog")).toHaveTextContent(
      /nothing in this paper can be linked to this yet/i
    );
  });
});

describe("the local draft between the two saves", () => {
  afterEach(() => jest.resetAllMocks());

  it("keeps a saved artifact visible and linkable before the paper is saved", async () => {
    const u = user();
    const ctx = renderWorkspace({ charts: [FIGURE] });

    ctx.rerenderWith({ charts: [FIGURE], scripts: [SCRIPT] });
    expect(screen.getByTestId("fw-node-s0")).toBeInTheDocument();

    await openLinkFor(u, "s0");
    await u.click(screen.getByTestId("fw-link-option-s0-c0-generates"));
    await u.click(screen.getByTestId("fw-link-apply"));

    expect(ctx.addEdge).toHaveBeenCalledWith({
      from: "s0",
      to: "c0",
      type: "generates",
    });
  });

  it("does not discard an existing artifact when another is added", () => {
    const ctx = renderWorkspace({
      charts: [FIGURE],
      scripts: [SCRIPT],
      workflow: { nodes: [], edges: [{ from: "s0", to: "c0", type: "generates" }] },
    });
    ctx.rerenderWith({
      charts: [FIGURE],
      scripts: [SCRIPT],
      datasets: [{ id: "d0", readme: "spectra" }],
      workflow: { nodes: [], edges: [{ from: "s0", to: "c0", type: "generates" }] },
    });

    expect(screen.getByTestId("fw-group-c0")).toBeInTheDocument();
    expect(screen.getByTestId("fw-node-s0")).toBeInTheDocument();
    // The new one stands on its own until it is linked.
    expect(screen.getByTestId("fw-node-d0")).toBeInTheDocument();
  });
});

describe("editing and unlinking, behind the overflow", () => {
  afterEach(() => jest.resetAllMocks());

  it("opens the artifact's own form seeded with the record", async () => {
    const u = user();
    const ctx = renderWorkspace({ charts: [FIGURE], scripts: [SCRIPT] });
    await openMoreFor(u, "s0");
    await u.click(screen.getByTestId("fw-edit-s0"));

    expect(ctx.helpers.setDefault).toHaveBeenCalledWith("script", SCRIPT);
    expect(ctx.helpers.openForm).toHaveBeenCalledWith("script");
  });

  it("shows the updated label after the artifact changes", () => {
    const ctx = renderWorkspace({ charts: [FIGURE] });
    ctx.rerenderWith({ charts: [{ id: "c0", caption: "Renamed figure" }] });
    expect(screen.getByText("Renamed figure")).toBeInTheDocument();
  });

  it("removes the figure through the existing delete path", async () => {
    const u = user();
    const ctx = renderWorkspace({ charts: [FIGURE] });
    await openMoreFor(u, "c0");
    await u.click(screen.getByTestId("fw-remove-c0"));

    expect(ctx.del).toHaveBeenCalledWith("chart", "c0");
  });

  it("unlinks exactly one edge, leaving both artifacts", async () => {
    const u = user();
    const ctx = renderWorkspace({
      charts: [FIGURE],
      scripts: [SCRIPT],
      workflow: { nodes: [], edges: [{ from: "s0", to: "c0", type: "generates" }] },
    });
    await openMoreFor(u, "s0");
    await u.click(screen.getByTestId("fw-unlink-s0-c0"));

    expect(ctx.unlink).toHaveBeenCalledTimes(1);
    expect(ctx.unlink).toHaveBeenCalledWith("s0", "c0");
    expect(ctx.del).not.toHaveBeenCalled();
  });

  it("offers no unlink on a row that has no parent", async () => {
    const u = user();
    renderWorkspace({ charts: [FIGURE] });
    await openMoreFor(u, "c0");
    expect(screen.queryByTestId(/^fw-unlink-/)).not.toBeInTheDocument();
  });
});

describe("independent resources", () => {
  afterEach(() => jest.resetAllMocks());

  it("lists what is connected to nothing", () => {
    renderWorkspace({
      charts: [FIGURE],
      datasets: [{ id: "d0", readme: "orphan data" }],
    });
    expect(screen.getByTestId("fw-unlinked")).toHaveTextContent("orphan data");
    expect(screen.getByTestId("fw-node-d0")).toBeInTheDocument();
  });

  it("offers adding a resource with no figure relationship", async () => {
    const u = user();
    const helpers = buildHelpers();
    renderWorkspace({}, helpers);
    await openAddFor(u, "");
    await u.click(screen.getByTestId("fw-add--dataset"));
    expect(helpers.setDefault).toHaveBeenCalledWith("dataset", null);
  });

  it("calls them independent, never unlinked", () => {
    // Named by what they LACK, an ordinary dataset that produced no figure
    // read as a defect to go and fix.
    renderWorkspace({
      charts: [FIGURE],
      datasets: [{ id: "d0", readme: "orphan data" }],
    });
    const section = within(screen.getByTestId("fw-unlinked"));
    expect(
      section.getAllByText(/independent resources/i).length
    ).toBeGreaterThan(0);
    expect(screen.queryByText(/unlinked/i)).not.toBeInTheDocument();
  });

  it("names the list for a screen reader too", () => {
    renderWorkspace({
      charts: [FIGURE],
      datasets: [{ id: "d0", readme: "orphan data" }],
    });
    expect(
      screen.getByRole("list", { name: /independent resources/i })
    ).toBeInTheDocument();
  });

  it("says where things stand when nothing is independent", () => {
    renderWorkspace({
      charts: [FIGURE],
      scripts: [SCRIPT],
      workflow: { nodes: [], edges: [{ from: "s0", to: "c0", type: "generates" }] },
    });
    expect(screen.getByTestId("fw-unlinked")).toHaveTextContent(
      /no independent resources — every resource here belongs to a figure/i
    );
  });

  it("tells an empty record that standing alone is allowed", () => {
    // The point of the rename: this is an invitation, not a warning.
    renderWorkspace();
    const text = screen.getByTestId("fw-unlinked").textContent;
    expect(text).toMatch(/no independent resources yet/i);
    expect(text).toMatch(/can stand on its own/i);
    // Nothing here should read as a fault to correct.
    expect(text).not.toMatch(/unlinked|orphan|missing|error|not connected/i);
  });

  it("can link an independent resource later, from its own row", async () => {
    const u = user();
    const ctx = renderWorkspace({
      charts: [FIGURE],
      datasets: [{ id: "d0", readme: "orphan data" }],
    });
    await openLinkFor(u, "d0");
    await u.click(screen.getByTestId("fw-link-option-d0-c0-consumes"));
    await u.click(screen.getByTestId("fw-link-apply"));

    expect(ctx.addEdge).toHaveBeenCalledWith({
      from: "d0",
      to: "c0",
      type: "consumes",
    });
  });
});

describe("external data and legacy graphs", () => {
  afterEach(() => jest.resetAllMocks());

  it("shows label, https link and note", () => {
    renderWorkspace({
      charts: [FIGURE],
      heads: [{
        id: "h0",
        label: "Materials Project",
        readme: "Reference band structure.",
        URLs: ["https://materialsproject.org/x"],
      }],
      workflow: { nodes: [], edges: [{ from: "h0", to: "c0", type: "consumes" }] },
    });
    expect(screen.getByTestId("fw-node-h0")).toHaveTextContent("Materials Project");
    expect(screen.getByTestId("fw-url-h0")).toHaveAttribute(
      "href",
      "https://materialsproject.org/x"
    );
    expect(screen.getByTestId("fw-note-h0")).toHaveTextContent(/reference band/i);
  });

  it("keeps a legacy http head visible and renders no local path", () => {
    renderWorkspace({
      charts: [FIGURE],
      heads: [
        { id: "h0", readme: "legacy note", URLs: ["http://example.org/d"] },
        { id: "h1", label: "Local", URLs: ["/home/curator/secret.h5"] },
      ],
      workflow: {
        nodes: [],
        edges: [
          { from: "h0", to: "c0", type: "consumes" },
          { from: "h1", to: "c0", type: "consumes" },
        ],
      },
    });
    expect(screen.getByTestId("fw-url-h0")).toHaveAttribute(
      "href",
      "http://example.org/d"
    );
    expect(screen.queryByTestId("fw-url-h1")).not.toBeInTheDocument();
  });

  it("states no relationship for a legacy untyped edge", () => {
    renderWorkspace({
      charts: [FIGURE],
      scripts: [SCRIPT],
      workflow: { nodes: [], edges: [["s0", "c0"]] },
    });
    const figure = screen.getByTestId("fw-group-c0");
    // Neither the heading nor the sentence claims a relationship type.
    expect(figure).toHaveTextContent(/Connected to/i);
    expect(figure).toHaveTextContent(/plot_dos\.py → connects to → Density of states/);
    expect(figure).not.toHaveTextContent(/generates|feeds into|supplies input/i);
    expect(figure).not.toHaveTextContent(/generated by:/i);
  });

  it("works on a paper with no workflow at all", () => {
    // No edges means no workflow group: every artifact stands on its own,
    // which is a normal state and not an empty page.
    renderWorkspace({ charts: [FIGURE], scripts: [SCRIPT] });
    const independent = within(screen.getByTestId("fw-unlinked"));
    expect(independent.getByTestId("fw-node-c0")).toBeInTheDocument();
    expect(independent.getByTestId("fw-node-s0")).toBeInTheDocument();
    expect(screen.queryByTestId("fw-group-c0")).not.toBeInTheDocument();
  });
});

// A workspace whose edges are REAL state, so accepting a suggestion actually
// changes what the next render sees. A jest.fn() would let a spent suggestion
// go on looking acceptable forever.
const LiveWorkspace = ({ lists, onEdge = () => {} }) => {
  const [edges, setEdges] = useState([]);
  return (
    <CuratorHelperContext.Provider value={buildHelpers()}>
      <CuratorContext.Provider
        value={{
          ...lists,
          tools: lists.tools || [],
          heads: lists.heads || [],
          workflow: { nodes: [], edges },
          addEdge: (edge) => {
            onEdge(edge);
            setEdges((was) => [...was, edge]);
          },
          unlink: jest.fn(),
          del: jest.fn(),
        }}
      >
        <FigureWorkspace />
      </CuratorContext.Provider>
    </CuratorHelperContext.Provider>
  );
};

describe("suggested connections", () => {
  afterEach(() => jest.resetAllMocks());

  const PROVEN = {
    charts: [
      {
        id: "c0",
        caption: "Density of states",
        notebookFile: "figures/dos.ipynb",
      },
    ],
    scripts: [{ id: "s0", readme: "plot_dos.py", files: ["figures/dos.ipynb"] }],
    datasets: [],
  };

  it("stays out of the way until there is something to suggest", () => {
    renderWorkspace({ charts: [FIGURE], scripts: [SCRIPT] });
    expect(screen.queryByTestId("fw-suggestions-c0")).not.toBeInTheDocument();
  });

  it("appears on the figure it is about, collapsed, counted", () => {
    renderWorkspace(PROVEN);

    const toggle = screen.getByTestId("fw-suggest-toggle-c0");
    expect(toggle).toHaveTextContent("Suggested connections (1)");
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    // Closed means the reason is not on screen yet.
    expect(screen.queryByText(/both reference/i)).not.toBeInTheDocument();
  });

  it("states the relationship and the one fact behind it", async () => {
    const u = user();
    renderWorkspace(PROVEN);
    await u.click(screen.getByTestId("fw-suggest-toggle-c0"));

    expect(
      screen.getByText(
        "Connect plot_dos.py as generating this figure — " +
          "both reference figures/dos.ipynb."
      )
    ).toBeInTheDocument();
  });

  it("Connect makes exactly one typed edge, and the offer is spent", async () => {
    const u = user();
    const onEdge = jest.fn();
    render(<LiveWorkspace lists={PROVEN} onEdge={onEdge} />);

    await u.click(screen.getByTestId("fw-suggest-toggle-c0"));
    await u.click(screen.getByTestId("fw-suggest-connect-s0-c0"));

    expect(onEdge).toHaveBeenCalledTimes(1);
    expect(onEdge).toHaveBeenCalledWith({
      from: "s0",
      to: "c0",
      type: "generates",
    });
    // Accepted, so there is nothing left to accept -- which is also why it
    // cannot be accepted twice.
    expect(screen.queryByTestId("fw-suggestions-c0")).not.toBeInTheDocument();
    // And the connection now shows as an ordinary part of the figure.
    expect(
      within(screen.getByTestId("fw-group-c0")).getByText("Generated by")
    ).toBeInTheDocument();
  });

  it("never offers a connection the paper already holds", () => {
    render(
      <CuratorHelperContext.Provider value={buildHelpers()}>
        <CuratorContext.Provider
          value={build({
            ...PROVEN,
            workflow: {
              nodes: [],
              edges: [{ from: "s0", to: "c0", type: "generates" }],
            },
          })}
        >
          <FigureWorkspace />
        </CuratorContext.Provider>
      </CuratorHelperContext.Provider>
    );
    expect(screen.queryByTestId("fw-suggestions-c0")).not.toBeInTheDocument();
  });

  it("Not now hides it here and changes nothing else", async () => {
    const u = user();
    const ctx = renderWorkspace(PROVEN);

    await u.click(screen.getByTestId("fw-suggest-toggle-c0"));
    await u.click(screen.getByTestId("fw-suggest-dismiss-s0-c0"));

    expect(screen.queryByTestId("fw-suggestions-c0")).not.toBeInTheDocument();
    // Declining is not a fact about the paper, so nothing was written.
    expect(ctx.addEdge).not.toHaveBeenCalled();
    expect(ctx.unlink).not.toHaveBeenCalled();
    expect(ctx.del).not.toHaveBeenCalled();
    expect(axios.post).not.toHaveBeenCalled();
    expect(axios.put).not.toHaveBeenCalled();
  });

  it("asks no provider anything, at any point", async () => {
    const u = user();
    render(<LiveWorkspace lists={PROVEN} />);

    await u.click(screen.getByTestId("fw-suggest-toggle-c0"));
    await u.click(screen.getByTestId("fw-suggest-connect-s0-c0"));

    // No RCC, no Gemini, no Semantic Scholar. The evidence was already in
    // the form the curator filled in.
    expect(axios.get).not.toHaveBeenCalled();
    expect(axios.post).not.toHaveBeenCalled();
    expect(axios.put).not.toHaveBeenCalled();
    expect(axios.delete).not.toHaveBeenCalled();
  });

  it("offers a dataset the figure names as its own input", async () => {
    const u = user();
    renderWorkspace({
      charts: [
        { id: "c0", caption: "Density of states", files: ["data/spectra.csv"] },
      ],
      scripts: [],
      datasets: [
        { id: "d0", readme: "Cryogenic spectra", files: ["data/spectra.csv"] },
      ],
    });
    await u.click(screen.getByTestId("fw-suggest-toggle-c0"));

    expect(
      screen.getByText(
        "Connect Cryogenic spectra as an input to this figure — " +
          "both reference data/spectra.csv."
      )
    ).toBeInTheDocument();
  });

  it("says nothing when only names and words agree", () => {
    // Same words everywhere, no shared saved path.
    renderWorkspace({
      charts: [
        {
          id: "c0",
          caption: "Density of states",
          notebookFile: "figures/dos.ipynb",
        },
      ],
      scripts: [
        { id: "s0", readme: "Density of states", files: ["src/dos.py"] },
      ],
      datasets: [
        { id: "d0", readme: "Density of states", files: ["raw/dos.csv"] },
      ],
    });
    expect(screen.queryByTestId("fw-suggestions-c0")).not.toBeInTheDocument();
  });

  it("re-aims at the artifact holding the evidence, not at the number", async () => {
    // s1 is the match. Deleting s0 renumbers it to s0, and the suggestion has
    // to follow the FILE, not the id it used to have.
    const u = user();
    const ctx = renderWorkspace({
      charts: [
        {
          id: "c0",
          caption: "Density of states",
          notebookFile: "figures/dos.ipynb",
        },
      ],
      scripts: [
        { id: "s0", readme: "unrelated.py", files: ["other/first.py"] },
        { id: "s1", readme: "plot_dos.py", files: ["figures/dos.ipynb"] },
      ],
    });
    await u.click(screen.getByTestId("fw-suggest-toggle-c0"));
    expect(screen.getByTestId("fw-suggest-connect-s1-c0")).toBeInTheDocument();

    ctx.rerenderWith({
      scripts: [
        { id: "s0", readme: "plot_dos.py", files: ["figures/dos.ipynb"] },
      ],
    });

    expect(screen.getByTestId("fw-suggest-connect-s0-c0")).toBeInTheDocument();
    expect(
      screen.queryByTestId("fw-suggest-connect-s1-c0")
    ).not.toBeInTheDocument();
    // Still the same script by name, so nothing was redirected.
    expect(
      screen.getByText(/Connect plot_dos\.py as generating/)
    ).toBeInTheDocument();
  });

  it("leaves the manual paths exactly as they were", () => {
    // PROVEN holds no edges yet, so the figure stands on its own -- and its
    // actions must be there just the same.
    renderWorkspace(PROVEN);
    expect(screen.getByTestId("fw-addlink-c0")).toBeInTheDocument();
    expect(screen.getByTestId("fw-more-c0")).toBeInTheDocument();
  });
});

// STARTING SOMETHING THAT IS NOT A FIGURE.
//
// The record is organised by figures, but plenty of papers hold a dataset or
// a tool that produced none. Those used to be reachable only from a row at
// the very bottom of the page, under a heading that reads like a problem.

// ONE WAY IN, asking one question at a time.
//
// The page carried a primary Add figure, a separate Import from RCC, a row of
// four "+ Type" links and a per-row Add new -- four controls for one
// intention. These pin the one that replaced them.

describe("add or link resource", () => {
  afterEach(() => jest.resetAllMocks());

  it("is a single control at the top of the section", async () => {
    const u = user();
    renderWorkspace();
    expect(screen.getByTestId("fw-addlink")).toHaveTextContent(
      /add or link resource/i
    );
    // And none of the four it replaced.
    expect(screen.queryByTestId("fw-add-figure")).not.toBeInTheDocument();
    expect(screen.queryByTestId("fw-rcc-import")).not.toBeInTheDocument();
    expect(screen.queryByTestId("fw-start-script")).not.toBeInTheDocument();

    await openFlowFor(u, "");
    expect(screen.getByTestId("fw-flow-new")).toHaveTextContent(/add new/i);
  });

  it("offers nothing to link from the top, where there is nothing to link to", async () => {
    const u = user();
    renderWorkspace({ charts: [FIGURE] });
    await openFlowFor(u, "");
    expect(screen.queryByTestId("fw-link-")).not.toBeInTheDocument();
  });

  it("offers linking first on a row, because that is the common act", async () => {
    const u = user();
    renderWorkspace({ charts: [FIGURE], scripts: [SCRIPT] });
    await openFlowFor(u, "c0");

    const items = screen.getAllByRole("menuitem").map((el) => el.textContent.trim());
    expect(items[0]).toMatch(/link existing/i);
    expect(items).toContain("Add new…");
  });

  it("asks where a new resource comes from before asking what it is", async () => {
    const u = user();
    renderWorkspace({ fileServerPath: "/proj" });
    await openFlowFor(u, "");
    await u.click(screen.getByTestId("fw-flow-new"));

    expect(screen.getByTestId("fw-source-rcc")).toHaveTextContent(/from rcc/i);
    expect(screen.getByTestId("fw-source-manual")).toHaveTextContent(
      /enter manually/i
    );
    // The types come only after that choice.
    expect(screen.queryByTestId("fw-add--chart")).not.toBeInTheDocument();
  });

  it("opens the real form for a manually entered figure", async () => {
    const u = user();
    const ctx = renderWorkspace();
    await openAddFor(u, "");
    await u.click(screen.getByTestId("fw-add--chart"));

    expect(ctx.helpers.setDefault).toHaveBeenCalledWith("chart", null);
    expect(ctx.helpers.openForm).toHaveBeenCalledWith("chart");
    // Opening a form creates nothing.
    expect(ctx.addEdge).not.toHaveBeenCalled();
  });

  it("offers every kind by hand at the top of the section", async () => {
    const u = user();
    renderWorkspace();
    await openAddFor(u, "");
    ["chart", "script", "dataset", "tool", "head"].forEach((type) =>
      expect(screen.getByTestId(`fw-add--${type}`)).toBeInTheDocument()
    );
  });

  it("sends External data to its own form, not to openForm", async () => {
    const u = user();
    const ctx = renderWorkspace();
    await openAddFor(u, "");
    await u.click(screen.getByTestId("fw-add--head"));

    expect(ctx.helpers.setExternalNodeFormOpen).toHaveBeenCalledWith(true);
    expect(ctx.helpers.openForm).not.toHaveBeenCalledWith("head");
  });

  it("offers only the kinds that can legally join a row", async () => {
    const u = user();
    renderWorkspace({ charts: [FIGURE], tools: [{ id: "t0", packageName: "numpy" }] });
    await openAddFor(u, "c0");

    ["script", "dataset", "head"].forEach((type) =>
      expect(screen.getByTestId(`fw-add-c0-${type}`)).toBeInTheDocument()
    );
    // A tool cannot join a figure.
    expect(screen.queryByTestId("fw-add-c0-tool")).not.toBeInTheDocument();
  });
});

describe("importing from RCC", () => {
  afterEach(() => jest.resetAllMocks());

  it("offers exactly the four types Folder Analysis can propose", async () => {
    const u = user();
    renderWorkspace({ fileServerPath: "/proj" });
    await openRccFor(u);
    await u.click(screen.getByTestId("fw-source-rcc"));

    const items = screen.getAllByRole("menuitem").map((el) => el.textContent.trim());
    expect(items).toEqual(["Figures", "Datasets", "Scripts", "Tools"]);
  });

  it("opens the existing typed flow for the chosen type", async () => {
    const u = user();
    renderWorkspace({ fileServerPath: "/proj" });

    for (const [choice, type] of [
      ["fw-rcc-script", "script"],
      ["fw-rcc-tool", "tool"],
    ]) {
      await openRccFor(u);
      await u.click(screen.getByTestId("fw-source-rcc"));
      await u.click(screen.getByTestId(choice));
      const importer = screen.getByTestId("stub-folder-analysis");
      // The SAME importer, typed -- not a second one built for this menu.
      expect(importer).toHaveAttribute("data-type", type);
      expect(importer).toHaveAttribute("data-hidden", "true");
      expect(importer).toHaveAttribute("data-auto", "true");
    }
  });

  it("explains itself when no folder has been chosen", async () => {
    const u = user();
    renderWorkspace({ fileServerPath: "" });
    await openRccFor(u);

    expect(screen.getByTestId("fw-source-rcc")).toHaveAttribute(
      "aria-disabled",
      "true"
    );
    expect(screen.getByTestId("fw-rcc-hint")).toHaveTextContent(
      "Choose a File Server Path above to import from RCC."
    );
    // Entering by hand is unaffected.
    expect(screen.getByTestId("fw-source-manual")).not.toHaveAttribute(
      "aria-disabled",
      "true"
    );
  });

  it("drops the explanation once a folder is chosen", async () => {
    const u = user();
    renderWorkspace({ fileServerPath: "/proj" });
    await openRccFor(u);

    expect(screen.queryByTestId("fw-rcc-hint")).not.toBeInTheDocument();
    expect(screen.getByTestId("fw-source-rcc")).not.toHaveAttribute(
      "aria-disabled",
      "true"
    );
  });

  it("reopens when the same type is picked again", async () => {
    const u = user();
    renderWorkspace({ fileServerPath: "/proj" });

    await openRccFor(u);
    await u.click(screen.getByTestId("fw-source-rcc"));
    await u.click(screen.getByTestId("fw-rcc-chart"));
    const first = screen.getByTestId("stub-folder-analysis").dataset.instance;

    await openRccFor(u);
    await u.click(screen.getByTestId("fw-source-rcc"));
    await u.click(screen.getByTestId("fw-rcc-chart"));
    const second = screen.getByTestId("stub-folder-analysis").dataset.instance;

    expect(second).not.toBe(first);
  });

  it("asks the network nothing while rendering", async () => {
    const u = user();
    renderWorkspace({ fileServerPath: "/proj" });
    await openRccFor(u);

    expect(axios.get).not.toHaveBeenCalled();
    expect(axios.post).not.toHaveBeenCalled();
  });

  it("puts imported artifacts in the draft, linkable at once", async () => {
    const u = user();
    const ctx = renderWorkspace({ fileServerPath: "/proj" });

    ctx.rerenderWith({
      fileServerPath: "/proj",
      charts: [{ id: "c0", caption: "Imported figure" }],
      scripts: [{ id: "s0", readme: "imported.py" }],
      datasets: [{ id: "d0", readme: "imported data" }],
      tools: [{ id: "t0", packageName: "numpy" }],
    });

    // Imported and unlinked, so each stands on its own until it is joined.
    const independent = within(screen.getByTestId("fw-unlinked"));
    ["c0", "s0", "d0", "t0"].forEach((id) =>
      expect(independent.getByTestId(`fw-node-${id}`)).toBeInTheDocument()
    );

    // And linkable with no metadata retyped.
    await openLinkFor(u, "s0");
    await u.click(screen.getByTestId("fw-link-option-s0-c0-generates"));
    await u.click(screen.getByTestId("fw-link-apply"));

    expect(ctx.addEdge).toHaveBeenCalledWith({
      from: "s0",
      to: "c0",
      type: "generates",
    });
  });
});

describe("related resources", () => {
  afterEach(() => jest.resetAllMocks());

  const KINDS = [
    ["c", "chart", "charts", "Figures", { id: "c1", caption: "Second figure" }],
    ["s", "script", "scripts", "Scripts", { id: "s1", readme: "other.py" }],
    ["d", "dataset", "datasets", "Datasets", { id: "d1", readme: "other data" }],
    ["t", "tool", "tools", "Tools", { id: "t1", packageName: "scipy" }],
    ["h", "head", "heads", "External data", { id: "h1", URLs: ["https://e.org/b"] }],
  ];

  const pairFor = (prefix) => {
    const base = {
      charts: [FIGURE],
      scripts: [SCRIPT],
      datasets: [{ id: "d0", readme: "spectra" }],
      tools: [{ id: "t0", packageName: "numpy" }],
      heads: [{ id: "h0", URLs: ["https://e.org/a"] }],
    };
    const row = KINDS.find(([p]) => p === prefix);
    return { ...base, [row[2]]: [...base[row[2]], row[4]] };
  };

  it.each(KINDS.map(([p, , , plural]) => [p, plural]))(
    "offers a same-kind partner for %s, under its own heading",
    async (prefix, plural) => {
      const u = user();
      renderWorkspace(pairFor(prefix));
      await openLinkFor(u, `${prefix}0`);

      expect(screen.getByTestId("fw-link-group-related")).toHaveTextContent(
        `Related ${plural}`
      );
      expect(
        screen.getByTestId(`fw-link-option-${prefix}0-${prefix}1-related_to`)
      ).toBeInTheDocument();
    }
  );

  it.each(KINDS.map(([p]) => p))("links a same-kind pair for %s", async (prefix) => {
    const u = user();
    const ctx = renderWorkspace(pairFor(prefix));
    await openLinkFor(u, `${prefix}0`);
    await u.click(
      screen.getByTestId(`fw-link-option-${prefix}0-${prefix}1-related_to`)
    );
    await u.click(screen.getByTestId("fw-link-apply"));

    expect(ctx.addEdge).toHaveBeenCalledTimes(1);
    expect(ctx.addEdge).toHaveBeenCalledWith({
      from: `${prefix}0`,
      to: `${prefix}1`,
      type: "related_to",
    });
    // The pair is associated, not created: no form, no clone.
    expect(ctx.helpers.openForm).not.toHaveBeenCalled();
    expect(ctx.helpers.setDefault).not.toHaveBeenCalled();
  });

  it("reads without a direction, because neither end came first", async () => {
    const u = user();
    renderWorkspace(pairFor("d"));
    await openLinkFor(u, "d0");

    const sentence = screen.getByTestId("fw-link-sentence-d0-d1-related_to");
    expect(sentence).toHaveTextContent(
      "Dataset: spectra ↔ related to ↔ Dataset: other data"
    );
    // No arrows: an arrow would claim one produced the other.
    expect(sentence).not.toHaveTextContent("→");
  });

  it("never offers a partner of a different kind", async () => {
    const u = user();
    renderWorkspace({
      charts: [FIGURE],
      scripts: [SCRIPT],
      datasets: [{ id: "d0", readme: "spectra" }],
    });
    await openLinkFor(u, "c0");

    expect(
      screen.queryByTestId("fw-link-option-c0-s0-related_to")
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("fw-link-option-c0-d0-related_to")
    ).not.toBeInTheDocument();
    // Those two pairs still hold their directed relationships.
    expect(
      screen.getByTestId("fw-link-option-s0-c0-generates")
    ).toBeInTheDocument();
  });

  it("keeps the two classes in separate groups", async () => {
    const u = user();
    renderWorkspace({
      charts: [FIGURE, { id: "c1", caption: "Second figure" }],
      scripts: [SCRIPT],
    });
    await openLinkFor(u, "c0");

    expect(screen.getByTestId("fw-link-group-workflow")).toHaveTextContent(
      "Workflow connection"
    );
    expect(screen.getByTestId("fw-link-group-related")).toHaveTextContent(
      "Related Figures"
    );
  });

  it("shows an existing relation as made, in either stored order", async () => {
    const u = user();
    renderWorkspace({
      ...pairFor("c"),
      // Stored c1 -> c0; the dialog is opened from c0.
      workflow: { nodes: [], edges: [{ from: "c1", to: "c0", type: "related_to" }] },
    });
    await openLinkFor(u, "c0");

    const option = screen.getByTestId("fw-link-option-c0-c1-related_to");
    expect(option).toBeChecked();
    expect(option).toBeDisabled();
  });

  it("never offers an artifact itself", async () => {
    const u = user();
    renderWorkspace(pairFor("t"));
    await openLinkFor(u, "t0");
    expect(
      screen.queryByTestId("fw-link-option-t0-t0-related_to")
    ).not.toBeInTheDocument();
  });

  it("links several partners at once, adding edges to one artifact", async () => {
    const u = user();
    const ctx = renderWorkspace({
      charts: [
        FIGURE,
        { id: "c1", caption: "Second" },
        { id: "c2", caption: "Third" },
      ],
    });
    await openLinkFor(u, "c0");
    await u.click(screen.getByTestId("fw-link-option-c0-c1-related_to"));
    await u.click(screen.getByTestId("fw-link-option-c0-c2-related_to"));
    await u.click(screen.getByTestId("fw-link-apply"));

    expect(ctx.addEdge).toHaveBeenCalledTimes(2);
    ["c1", "c2"].forEach((other) =>
      expect(ctx.addEdge).toHaveBeenCalledWith({
        from: "c0",
        to: other,
        type: "related_to",
      })
    );
    expect(ctx.helpers.openForm).not.toHaveBeenCalled();
  });

  it("shows relations beside the tree, never as children of it", () => {
    renderWorkspace({
      ...pairFor("c"),
      scripts: [SCRIPT],
      workflow: {
        nodes: [],
        edges: [
          { from: "s0", to: "c0", type: "generates" },
          { from: "c0", to: "c1", type: "related_to" },
        ],
      },
    });

    const panel = screen.getByTestId("fw-related-c0");
    expect(panel).toHaveTextContent(/related resources/i);
    expect(screen.getByTestId("fw-relation-c0-c1")).toHaveTextContent(
      "Density of states ↔ related to ↔ Second figure"
    );
    // Not indented into the workflow tree as if it produced something.
    expect(within(panel).queryByTestId("fw-node-c1")).not.toBeInTheDocument();
    expect(screen.getByTestId("fw-goto-related-c0-c1")).toHaveAttribute(
      "data-target",
      "fw-anchor-c1"
    );
  });

  it("does not make the outline recurse", () => {
    // Two figures related to each other is not a cycle and must not be
    // walked as one.
    renderWorkspace({
      charts: [FIGURE, { id: "c1", caption: "Second figure" }],
      workflow: {
        nodes: [],
        edges: [
          { from: "c0", to: "c1", type: "related_to" },
          { from: "c1", to: "c0", type: "related_to" },
        ],
      },
    });
    expect(screen.getByTestId("fw-node-c0")).toBeInTheDocument();
    expect(screen.getByTestId("fw-node-c1")).toBeInTheDocument();
  });

  it("does not block a workflow edge that shares the pair's kinds", async () => {
    // Two scripts can hold BOTH: one feeds the other, and they are related.
    const u = user();
    const ctx = renderWorkspace({ charts: [FIGURE], scripts: [SCRIPT, { id: "s1", readme: "other.py" }] });
    await openLinkFor(u, "s0");

    expect(
      screen.getByTestId("fw-link-option-s1-s0-feeds_into")
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("fw-link-option-s0-s1-related_to")
    ).toBeInTheDocument();

    await u.click(screen.getByTestId("fw-link-option-s1-s0-feeds_into"));
    await u.click(screen.getByTestId("fw-link-option-s0-s1-related_to"));
    await u.click(screen.getByTestId("fw-link-apply"));

    expect(ctx.addEdge).toHaveBeenCalledTimes(2);
    expect(ctx.addEdge).toHaveBeenCalledWith({ from: "s1", to: "s0", type: "feeds_into" });
    expect(ctx.addEdge).toHaveBeenCalledWith({ from: "s0", to: "s1", type: "related_to" });
  });
});

// WHAT A CURATOR CALLS "ONE WORKFLOW" is a connected component of the graph,
// derived on every render. There is no group model to keep in step.

describe("workflow groups", () => {
  afterEach(() => jest.resetAllMocks());

  const twoGroups = {
    charts: [FIGURE, { id: "c1", caption: "Band structure" }],
    scripts: [SCRIPT, { id: "s1", readme: "bands.py" }],
    workflow: {
      nodes: [],
      edges: [
        { from: "s0", to: "c0", type: "generates" },
        { from: "s1", to: "c1", type: "generates" },
      ],
    },
  };

  it("gathers everything joined into one group", () => {
    renderWorkspace({
      charts: [FIGURE],
      scripts: [SCRIPT],
      datasets: [{ id: "d0", readme: "spectra" }],
      workflow: {
        nodes: [],
        edges: [
          { from: "s0", to: "c0", type: "generates" },
          { from: "d0", to: "s0", type: "consumes" },
        ],
      },
    });
    const group = within(screen.getByTestId("fw-group-c0"));
    ["c0", "s0", "d0"].forEach((id) =>
      expect(group.getByTestId(`fw-node-${id}`)).toBeInTheDocument()
    );
  });

  it("keeps two unconnected pieces of work apart", () => {
    renderWorkspace(twoGroups);
    expect(screen.getByTestId("fw-group-c0")).toBeInTheDocument();
    expect(screen.getByTestId("fw-group-c1")).toBeInTheDocument();
  });

  it("merges them the moment they are joined", () => {
    const ctx = renderWorkspace(twoGroups);
    ctx.rerenderWith({
      workflow: {
        nodes: [],
        edges: [
          ...twoGroups.workflow.edges,
          { from: "s0", to: "s1", type: "feeds_into" },
        ],
      },
    });

    expect(screen.getByTestId("fw-group-c0")).toBeInTheDocument();
    expect(screen.queryByTestId("fw-group-c1")).not.toBeInTheDocument();
    const group = within(screen.getByTestId("fw-group-c0"));
    ["c0", "c1", "s0", "s1"].forEach((id) =>
      expect(group.getByTestId(`fw-node-${id}`)).toBeInTheDocument()
    );
  });

  it("splits them again when the joining edge goes", () => {
    const ctx = renderWorkspace({
      ...twoGroups,
      workflow: {
        nodes: [],
        edges: [
          ...twoGroups.workflow.edges,
          { from: "s0", to: "s1", type: "feeds_into" },
        ],
      },
    });
    expect(screen.queryByTestId("fw-group-c1")).not.toBeInTheDocument();

    ctx.rerenderWith({ workflow: { nodes: [], edges: twoGroups.workflow.edges } });
    expect(screen.getByTestId("fw-group-c0")).toBeInTheDocument();
    expect(screen.getByTestId("fw-group-c1")).toBeInTheDocument();
  });

  it("leaves an artifact with no edge standing on its own", () => {
    renderWorkspace({
      ...twoGroups,
      tools: [{ id: "t0", packageName: "numpy" }],
    });
    const independent = within(screen.getByTestId("fw-unlinked"));
    expect(independent.getByTestId("fw-node-t0")).toBeInTheDocument();
    expect(screen.queryByTestId("fw-group-t0")).not.toBeInTheDocument();
  });

  it("says a group with no figure is independent, not broken", () => {
    renderWorkspace({
      scripts: [SCRIPT, { id: "s1", readme: "pre.py" }],
      workflow: { nodes: [], edges: [{ from: "s1", to: "s0", type: "feeds_into" }] },
    });
    expect(screen.getByTestId("fw-stranded-s0")).toHaveTextContent(
      /independent workflow/i
    );
  });
});

describe("the workflow drawing", () => {
  afterEach(() => jest.resetAllMocks());

  const paper = {
    charts: [FIGURE],
    scripts: [SCRIPT],
    datasets: [{ id: "d0", readme: "spectra" }],
    tools: [{ id: "t0", packageName: "numpy" }],
    workflow: {
      nodes: [],
      edges: [
        { from: "s0", to: "c0", type: "generates" },
        { from: "d0", to: "s0", type: "consumes" },
        { from: "t0", to: "s0", type: "uses_tool" },
      ],
    },
  };

  it("draws every artifact in the group once", () => {
    renderWorkspace(paper);
    ["c0", "s0", "d0", "t0"].forEach((id) =>
      expect(screen.getAllByTestId(`fw-lane-node-${id}`)).toHaveLength(1)
    );
  });

  it("reads inputs to figures, left to right", () => {
    renderWorkspace(paper);
    const lanes = within(screen.getByTestId("fw-lanes"));
    ["Inputs", "Process", "Figures"].forEach((lane) =>
      expect(lanes.getByText(lane)).toBeInTheDocument()
    );
  });

  it("draws an edge for every connection in the group", () => {
    renderWorkspace(paper);
    ["s0-c0", "d0-s0", "t0-s0"].forEach((pair) =>
      expect(screen.getByTestId(`fw-lane-edge-${pair}`)).toBeInTheDocument()
    );
  });

  it("draws a feedback loop from what was confirmed", () => {
    renderWorkspace({
      charts: [FIGURE],
      scripts: [SCRIPT, { id: "s1", readme: "preprocess.py" }],
      workflow: {
        nodes: [],
        edges: [
          { from: "s0", to: "c0", type: "generates" },
          { from: "s1", to: "s0", type: "feeds_into" },
          { from: "s0", to: "s1", type: "feeds_into", feedback: true },
        ],
      },
    });
    expect(screen.getByTestId("fw-lane-edge-s0-s1")).toHaveAttribute(
      "data-loop",
      "true"
    );
    expect(screen.getByTestId("fw-lane-edge-s0-c0")).toHaveAttribute(
      "data-loop",
      "false"
    );
    expect(screen.getByTestId("fw-lanes")).toHaveTextContent(
      /dashed line is a feedback loop/i
    );
  });

  it("marks an association as having no direction", () => {
    renderWorkspace({
      charts: [FIGURE, { id: "c1", caption: "Second" }],
      workflow: { nodes: [], edges: [{ from: "c0", to: "c1", type: "related_to" }] },
    });
    const edge = screen.getByTestId("fw-lane-edge-c0-c1");
    expect(edge).toHaveAttribute("data-undirected", "true");
    expect(edge).toHaveAttribute("data-loop", "false");
  });
});

describe("feedback loops", () => {
  afterEach(() => jest.resetAllMocks());

  // preprocess.py already feeds plot_dos.py. Recording that plot_dos.py also
  // feeds preprocess.py closes the loop.
  const closing = {
    charts: [FIGURE],
    scripts: [SCRIPT, { id: "s1", readme: "preprocess.py" }],
    workflow: { nodes: [], edges: [{ from: "s1", to: "s0", type: "feeds_into" }] },
  };

  const pickLoop = async (u) => {
    await openLinkFor(u, "s0");
    await u.click(screen.getByTestId("fw-link-option-s0-s1-feeds_into"));
    await u.click(screen.getByTestId("fw-link-apply"));
    return screen.findByTestId("fw-loop-dialog");
  };

  it("asks before making one, and makes nothing yet", async () => {
    const u = user();
    const ctx = renderWorkspace(closing);
    await pickLoop(u);

    expect(screen.getByTestId("fw-loop-dialog")).toHaveTextContent(
      /make a feedback loop/i
    );
    expect(screen.getByTestId("fw-loop-s0-s1")).toBeInTheDocument();
    expect(ctx.addEdge).not.toHaveBeenCalled();
  });

  it("makes it once the curator says so", async () => {
    const u = user();
    const ctx = renderWorkspace(closing);
    await pickLoop(u);
    await u.click(screen.getByTestId("fw-loop-confirm"));

    expect(ctx.addEdge).toHaveBeenCalledTimes(1);
    // The confirmation is WRITTEN DOWN on the edge. Recomputing it later
    // would lose the answer the moment another edge was removed.
    expect(ctx.addEdge).toHaveBeenCalledWith({
      from: "s0",
      to: "s1",
      type: "feeds_into",
      feedback: true,
    });
  });

  it("makes nothing when the curator declines", async () => {
    const u = user();
    const ctx = renderWorkspace(closing);
    await pickLoop(u);
    await u.click(screen.getByTestId("fw-loop-cancel"));

    expect(ctx.addEdge).not.toHaveBeenCalled();
  });

  it("keeps the other choices when the loop is declined", async () => {
    // Refusing one connection is not a reason to discard the rest.
    const u = user();
    const ctx = renderWorkspace({
      ...closing,
      datasets: [{ id: "d0", readme: "spectra" }],
    });
    await openLinkFor(u, "s0");
    await u.click(screen.getByTestId("fw-link-option-s0-s1-feeds_into"));
    await u.click(screen.getByTestId("fw-link-option-d0-s0-consumes"));
    await u.click(screen.getByTestId("fw-link-apply"));
    await screen.findByTestId("fw-loop-dialog");

    expect(screen.getByTestId("fw-loop-rest")).toHaveTextContent(
      /1 selection will be linked either way/i
    );
    await u.click(screen.getByTestId("fw-loop-cancel"));

    expect(ctx.addEdge).toHaveBeenCalledTimes(1);
    expect(ctx.addEdge).toHaveBeenCalledWith({
      from: "d0",
      to: "s0",
      type: "consumes",
    });
  });

  it("never asks about an association", async () => {
    // There is no direction to loop.
    const u = user();
    const ctx = renderWorkspace({
      charts: [FIGURE, { id: "c1", caption: "Second" }],
      workflow: { nodes: [], edges: [{ from: "c1", to: "c0", type: "related_to" }] },
      scripts: [],
    });
    await openLinkFor(u, "c0");
    // The only remaining candidate for this pair is the directed one.
    await u.click(screen.getByTestId("fw-link-option-c0-c1-feeds_into"));
    await u.click(screen.getByTestId("fw-link-apply"));

    expect(screen.queryByTestId("fw-loop-dialog")).not.toBeInTheDocument();
    expect(ctx.addEdge).toHaveBeenCalledWith({
      from: "c0",
      to: "c1",
      type: "feeds_into",
    });
  });

  it("still refuses an artifact joined to itself", async () => {
    const u = user();
    renderWorkspace({ charts: [FIGURE], scripts: [SCRIPT] });
    await openLinkFor(u, "s0");
    expect(
      screen.queryByTestId("fw-link-option-s0-s0-feeds_into")
    ).not.toBeInTheDocument();
  });

  it("renders a stored loop without recursing forever", () => {
    renderWorkspace({
      charts: [FIGURE],
      scripts: [SCRIPT, { id: "s1", readme: "preprocess.py" }],
      workflow: {
        nodes: [],
        edges: [
          { from: "s0", to: "c0", type: "generates" },
          { from: "s1", to: "s0", type: "feeds_into" },
          { from: "s0", to: "s1", type: "feeds_into" },
        ],
      },
    });
    // Each artifact is one editable node; the second arrival is a reference.
    expect(screen.getAllByTestId("fw-node-s0")).toHaveLength(1);
    expect(screen.getAllByTestId("fw-node-s1")).toHaveLength(1);
  });
});

// STAGING GATE: the two things that have to be true before this is deployed.
describe("a feedback loop is remembered, not recomputed", () => {
  afterEach(() => jest.resetAllMocks());

  // As it comes back from storage on a fresh load.
  const stored = {
    charts: [FIGURE],
    scripts: [SCRIPT, { id: "s1", readme: "preprocess.py" }],
    workflow: {
      nodes: [],
      edges: [
        { from: "s0", to: "c0", type: "generates" },
        { from: "s1", to: "s0", type: "feeds_into" },
        { from: "s0", to: "s1", type: "feeds_into", feedback: true },
      ],
    },
  };

  it("reads the mark back from the record on a fresh load", () => {
    renderWorkspace(stored);
    expect(screen.getByTestId("fw-lane-edge-s0-s1")).toHaveAttribute(
      "data-loop",
      "true"
    );
  });

  it("keeps the mark when the edge that closed the loop is removed", () => {
    // THE POINT. With s1 -> s0 gone there is no cycle left to detect, so a
    // derived marker would vanish. The curator's answer does not.
    const ctx = renderWorkspace(stored);
    ctx.rerenderWith({
      workflow: {
        nodes: [],
        edges: [
          { from: "s0", to: "c0", type: "generates" },
          { from: "s0", to: "s1", type: "feeds_into", feedback: true },
        ],
      },
    });

    expect(screen.getByTestId("fw-lane-edge-s0-s1")).toHaveAttribute(
      "data-loop",
      "true"
    );
    expect(screen.getByTestId("fw-feedback-s0-s1")).toHaveTextContent(
      /feedback loop/i
    );
  });

  it("never marks an edge nobody confirmed, cycle or not", () => {
    // A graph that loops but carries no answer is left alone -- inferring
    // one would be putting words in the curator's mouth.
    renderWorkspace({
      charts: [FIGURE],
      scripts: [SCRIPT, { id: "s1", readme: "preprocess.py" }],
      workflow: {
        nodes: [],
        edges: [
          { from: "s1", to: "s0", type: "feeds_into" },
          { from: "s0", to: "s1", type: "feeds_into" },
        ],
      },
    });
    expect(screen.getByTestId("fw-lane-edge-s0-s1")).toHaveAttribute(
      "data-loop",
      "false"
    );
    expect(screen.queryByTestId("fw-feedback-s0-s1")).not.toBeInTheDocument();
  });
});

describe("the workflow is readable without the drawing", () => {
  afterEach(() => jest.resetAllMocks());

  const paper = {
    charts: [FIGURE, { id: "c1", caption: "Band structure" }],
    scripts: [SCRIPT, { id: "s1", readme: "preprocess.py" }],
    datasets: [{ id: "d0", readme: "spectra" }],
    workflow: {
      nodes: [],
      edges: [
        { from: "s0", to: "c0", type: "generates" },
        { from: "d0", to: "s0", type: "consumes" },
        { from: "s1", to: "s0", type: "feeds_into" },
        { from: "s0", to: "s1", type: "feeds_into", feedback: true },
        { from: "c0", to: "c1", type: "related_to" },
      ],
    },
  };

  it("shows the outline beside the drawing, not instead of it", () => {
    // The wide view gets both: a picture to see the shape, and a DOM outline
    // for a keyboard, a screen reader, and anyone who would rather read.
    renderWorkspace(paper);
    expect(screen.getByTestId("fw-lanes")).toBeInTheDocument();
    ["c0", "s0", "d0", "s1"].forEach((id) =>
      expect(screen.getByTestId(`fw-node-${id}`)).toBeInTheDocument()
    );
  });

  it("states direction, feedback and association in words", () => {
    renderWorkspace(paper);
    expect(screen.getByTestId("fw-flow-s0-c0")).toHaveTextContent(
      "plot_dos.py → generates → Density of states"
    );
    expect(screen.getByTestId("fw-flow-d0-s0")).toHaveTextContent(
      "spectra → supplies input to → plot_dos.py"
    );
    expect(screen.getByTestId("fw-feedback-s0-s1")).toHaveTextContent(
      /feedback loop/i
    );
    expect(screen.getByTestId("fw-relation-c0-c1")).toHaveTextContent(
      "Density of states ↔ related to ↔ Band structure"
    );
  });

  it("puts every row action on a real focusable control", () => {
    renderWorkspace(paper);
    ["c0", "s0", "d0", "s1"].forEach((id) => {
      const add = screen.getByTestId(`fw-addlink-${id}`);
      const more = screen.getByTestId(`fw-more-${id}`);
      [add, more].forEach((el) => {
        expect(el.tagName).toBe("BUTTON");
        expect(el).not.toBeDisabled();
        expect(el).not.toHaveAttribute("tabindex", "-1");
      });
    });
  });

  it("reaches Edit, Link existing, Add new and Remove from the keyboard", async () => {
    const u = user();
    const ctx = renderWorkspace(paper);

    // Tab to the row control and open it with the keyboard alone.
    screen.getByTestId("fw-addlink-s0").focus();
    expect(screen.getByTestId("fw-addlink-s0")).toHaveFocus();
    await u.keyboard("{Enter}");
    await screen.findByTestId("fw-flow-menu");
    expect(screen.getByTestId("fw-link-s0")).toBeInTheDocument();
    expect(screen.getByTestId("fw-flow-new")).toBeInTheDocument();
    await u.keyboard("{Escape}");

    screen.getByTestId("fw-more-s0").focus();
    await u.keyboard("{Enter}");
    await screen.findByTestId("fw-more-menu");
    expect(screen.getByTestId("fw-edit-s0")).toBeInTheDocument();
    expect(screen.getByTestId("fw-remove-s0")).toBeInTheDocument();

    await u.keyboard("{Enter}");
    expect(ctx.helpers.openForm).toHaveBeenCalledWith("script");
  });
});
