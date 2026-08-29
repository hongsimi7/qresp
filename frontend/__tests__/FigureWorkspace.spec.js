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

  it("offers Add Figure as the way in", () => {
    renderWorkspace();
    expect(screen.getByTestId("fw-add-figure")).toHaveTextContent(/add figure/i);
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

  it("keeps RCC import reachable from the same place", () => {
    renderWorkspace({ fileServerPath: "/proj" });
    expect(screen.getByTestId("fw-rcc-import")).toBeInTheDocument();
  });
});

describe("Add Figure reuses the existing Chart model", () => {
  afterEach(() => jest.resetAllMocks());

  it("opens the real Chart form for a NEW chart", async () => {
    const helpers = buildHelpers();
    renderWorkspace({}, helpers);
    await user().click(screen.getByTestId("fw-add-figure"));

    expect(helpers.setDefault).toHaveBeenCalledWith("chart", null);
    expect(helpers.openForm).toHaveBeenCalledWith("chart");
  });

  it("creates no artifact and no edge merely by opening the form", async () => {
    // Cancel is the common case, and it must leave nothing behind.
    const ctx = renderWorkspace();
    await user().click(screen.getByTestId("fw-add-figure"));
    expect(ctx.addEdge).not.toHaveBeenCalled();
    expect(axios.post).not.toHaveBeenCalled();
    expect(axios.put).not.toHaveBeenCalled();
  });
});

// ---- shared helpers for the outline UI ---------------------------------
const openLinkFor = async (u, id) => {
  await u.click(screen.getByTestId(`fw-link-${id}`));
  return screen.findByTestId("fw-link-dialog");
};
const openAddFor = async (u, id) => {
  await u.click(screen.getByTestId(`fw-add-${id}`));
  return screen.findByTestId("fw-add-menu");
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
    const figure = within(screen.getByTestId("fw-figure-c0"));

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
    expect(screen.getByTestId("fw-link-c0")).toBeInTheDocument();
  });

  it("says so plainly when there are no figures yet", () => {
    renderWorkspace();
    expect(screen.getByText(/no figures yet/i)).toBeInTheDocument();
  });

  it("keeps the two everyday actions on the row and the rest behind ⋮", async () => {
    const u = user();
    renderWorkspace({ charts: [FIGURE] });

    expect(screen.getByTestId("fw-link-c0")).toHaveTextContent(/link existing/i);
    expect(screen.getByTestId("fw-add-c0")).toHaveTextContent(/add new/i);
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
    expect(screen.getByTestId("fw-link-sentence-s1-s0")).toHaveTextContent(
      "Script: preprocess.py → feeds into → Script: plot_dos.py"
    );
    expect(screen.getByTestId("fw-link-sentence-s0-s1")).toHaveTextContent(
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
    await u.click(screen.getByTestId("fw-link-option-s1-s0"));
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
    expect(screen.queryByTestId("fw-link-option-s0-s0")).not.toBeInTheDocument();
  });

  it("does not offer the reverse once one direction exists", async () => {
    // s1 already feeds s0, so s0 feeding s1 would close a loop. The dialog
    // never offers a candidate the server would refuse.
    const u = user();
    renderWorkspace(chain);
    await openLinkFor(u, "s0");

    expect(screen.getByTestId("fw-link-option-s1-s0")).toBeDisabled();
    expect(screen.queryByTestId("fw-link-option-s0-s1")).not.toBeInTheDocument();
  });

  it("does not offer a candidate that would close a longer loop", async () => {
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
    expect(screen.queryByTestId("fw-link-option-s2-s0")).not.toBeInTheDocument();
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

    expect(screen.getByTestId("fw-link-sentence-s0-c0")).toHaveTextContent(
      "Script: plot_dos.py → generates → Figure: Density of states"
    );
    expect(screen.getByTestId("fw-link-sentence-d0-c0")).toHaveTextContent(
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
    expect(screen.getByTestId("fw-link-option-s0-c0")).toBeInTheDocument();
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
    await u.click(screen.getByTestId("fw-link-option-s0-c0"));
    await u.click(screen.getByTestId("fw-link-option-s0-c2"));
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
    await u.click(screen.getByTestId("fw-link-option-d0-s0"));
    await u.click(screen.getByTestId("fw-link-option-d0-s1"));
    await u.click(screen.getByTestId("fw-link-option-d0-c0"));
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

    await u.click(screen.getByTestId("fw-link-option-t0-s0"));
    await u.click(screen.getByTestId("fw-link-option-t0-s1"));
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
    await u.click(screen.getByTestId("fw-link-option-h0-s0"));
    await u.click(screen.getByTestId("fw-link-option-h0-c0"));
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

    const already = screen.getByTestId("fw-link-option-s0-c0");
    expect(already).toBeChecked();
    expect(already).toBeDisabled();
    expect(screen.getByTestId("fw-link-dialog")).toHaveTextContent(/already linked/i);

    await u.click(screen.getByTestId("fw-link-option-d0-c0"));
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
    expect(screen.getByTestId("fw-link-option-s0-c0")).toBeDisabled();
  });

  it("makes nothing when the dialog is cancelled", async () => {
    const u = user();
    const ctx = renderWorkspace(paper);
    await openLinkFor(u, "c0");
    await u.click(screen.getByTestId("fw-link-option-s0-c0"));
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
      expect(screen.getByTestId(`fw-link-${id}`)).toBeInTheDocument()
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
    await u.click(screen.getByTestId("fw-link-option-s0-c0"));
    await u.click(screen.getByTestId("fw-link-apply"));

    expect(ctx.addEdge).toHaveBeenCalledWith({
      from: "s0",
      to: "c0",
      type: "generates",
    });
  });

  it("does not discard an existing artifact when another is added", () => {
    const ctx = renderWorkspace({ charts: [FIGURE], scripts: [SCRIPT] });
    ctx.rerenderWith({
      charts: [FIGURE],
      scripts: [SCRIPT],
      datasets: [{ id: "d0", readme: "spectra" }],
    });

    expect(screen.getByTestId("fw-figure-c0")).toBeInTheDocument();
    expect(screen.getByTestId("fw-node-s0")).toBeInTheDocument();
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
    const helpers = buildHelpers();
    renderWorkspace({}, helpers);
    await user().click(screen.getByTestId("fw-start-dataset"));
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
    await u.click(screen.getByTestId("fw-link-option-d0-c0"));
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
    const figure = screen.getByTestId("fw-figure-c0");
    // Neither the heading nor the sentence claims a relationship type.
    expect(figure).toHaveTextContent(/Connected to/i);
    expect(figure).toHaveTextContent(/plot_dos\.py → connects to → Density of states/);
    expect(figure).not.toHaveTextContent(/generates|feeds into|supplies input/i);
    expect(figure).not.toHaveTextContent(/generated by:/i);
  });

  it("works on a paper with no workflow at all", () => {
    renderWorkspace({ charts: [FIGURE], scripts: [SCRIPT] });
    expect(screen.getByTestId("fw-figure-c0")).toBeInTheDocument();
    expect(screen.getByTestId("fw-unlinked")).toHaveTextContent("plot_dos.py");
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
      within(screen.getByTestId("fw-figure-c0")).getByText("Generated by")
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
    renderWorkspace(PROVEN);
    const figure = within(screen.getByTestId("fw-figure-c0"));
    // The everyday actions and the overflow all survive.
    expect(figure.getByTestId("fw-link-c0")).toBeInTheDocument();
    expect(figure.getByTestId("fw-add-c0")).toBeInTheDocument();
    expect(figure.getByTestId("fw-more-c0")).toBeInTheDocument();
  });
});

// STARTING SOMETHING THAT IS NOT A FIGURE.
//
// The record is organised by figures, but plenty of papers hold a dataset or
// a tool that produced none. Those used to be reachable only from a row at
// the very bottom of the page, under a heading that reads like a problem.

describe("one place to start anything", () => {
  afterEach(() => jest.resetAllMocks());

  it("keeps the figure primary and the rest visible beside it", () => {
    renderWorkspace();
    // The one filled button on the page.
    expect(screen.getByTestId("fw-add-figure")).toHaveTextContent(/add figure/i);
    // And every other kind, on the first screen, without scrolling to a
    // section about what is broken.
    ["script", "dataset", "tool", "head"].forEach((type) => {
      expect(screen.getByTestId(`fw-start-${type}`)).toBeInTheDocument();
    });
  });

  it("opens the real form for each kind it offers", async () => {
    const u = user();
    const helpers = buildHelpers();
    renderWorkspace({}, helpers);

    await u.click(screen.getByTestId("fw-start-script"));
    expect(helpers.openForm).toHaveBeenCalledWith("script");
    await u.click(screen.getByTestId("fw-start-tool"));
    expect(helpers.openForm).toHaveBeenCalledWith("tool");
  });

  it("sends External data to its own form, not to openForm", async () => {
    const helpers = buildHelpers();
    renderWorkspace({}, helpers);
    await user().click(screen.getByTestId("fw-start-head"));

    expect(helpers.setExternalNodeFormOpen).toHaveBeenCalledWith(true);
    expect(helpers.openForm).not.toHaveBeenCalledWith("head");
  });

  it("stops claiming everything is connected when nothing exists", () => {
    // "No figures yet" and "every resource here belongs to a figure" are
    // not both true of the same paper.
    renderWorkspace();
    expect(screen.getByTestId("fw-unlinked")).not.toHaveTextContent(
      /every resource here belongs to a figure/i
    );
    expect(screen.getByTestId("fw-unlinked")).toHaveTextContent(
      /no independent resources yet/i
    );
  });
});

describe("importing from RCC", () => {
  afterEach(() => jest.resetAllMocks());

  it("offers all four types the importer can propose", async () => {
    const u = user();
    renderWorkspace({ fileServerPath: "/proj" });
    await u.click(screen.getByTestId("fw-rcc-import"));

    // Charts were the only one ever mounted; the other three existed in
    // FolderAnalysis and were unreachable.
    ["chart", "dataset", "script", "tool"].forEach((type) => {
      expect(screen.getByTestId(`fw-rcc-${type}`)).toBeInTheDocument();
    });
  });

  it("cannot be opened before a folder is chosen", () => {
    renderWorkspace({ fileServerPath: "" });
    expect(screen.getByTestId("fw-rcc-import")).toBeDisabled();
  });

  it("mounts the importer only once a type is picked, typed to it", async () => {
    const u = user();
    renderWorkspace({ fileServerPath: "/proj" });
    expect(screen.queryByTestId("stub-folder-analysis")).not.toBeInTheDocument();

    await u.click(screen.getByTestId("fw-rcc-import"));
    await u.click(screen.getByTestId("fw-rcc-dataset"));

    const importer = screen.getByTestId("stub-folder-analysis");
    expect(importer).toHaveAttribute("data-type", "dataset");
    // Driven from outside: no second button of its own, and it opens itself.
    expect(importer).toHaveAttribute("data-hidden", "true");
    expect(importer).toHaveAttribute("data-auto", "true");
  });

  it("reopens when the same type is picked again", async () => {
    // A remount is what makes the second choice do anything at all.
    const u = user();
    renderWorkspace({ fileServerPath: "/proj" });

    await u.click(screen.getByTestId("fw-rcc-import"));
    await u.click(screen.getByTestId("fw-rcc-chart"));
    const first = screen.getByTestId("stub-folder-analysis").dataset.instance;

    await u.click(screen.getByTestId("fw-rcc-import"));
    await u.click(screen.getByTestId("fw-rcc-chart"));
    const second = screen.getByTestId("stub-folder-analysis").dataset.instance;

    expect(second).not.toBe(first);
  });
});

describe("the RCC import entry point", () => {
  afterEach(() => jest.resetAllMocks());

  const openMenu = async (u) => {
    await u.click(screen.getByTestId("fw-rcc-import"));
    return screen.findByTestId("fw-rcc-menu");
  };

  it("offers exactly the four types Folder Analysis can propose", async () => {
    const u = user();
    renderWorkspace({ fileServerPath: "/proj" });
    await openMenu(u);

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
      await openMenu(u);
      await u.click(screen.getByTestId(choice));
      const importer = screen.getByTestId("stub-folder-analysis");
      // The SAME importer, typed -- not a second one built for this menu.
      expect(importer).toHaveAttribute("data-type", type);
      expect(importer).toHaveAttribute("data-hidden", "true");
      expect(importer).toHaveAttribute("data-auto", "true");
    }
  });

  it("explains itself when no folder has been chosen", () => {
    renderWorkspace({ fileServerPath: "" });

    expect(screen.getByTestId("fw-rcc-import")).toBeDisabled();
    expect(screen.getByTestId("fw-rcc-hint")).toHaveTextContent(
      "Choose a File Server Path above to import from RCC."
    );
  });

  it("drops the explanation once a folder is chosen", () => {
    renderWorkspace({ fileServerPath: "/proj" });

    expect(screen.getByTestId("fw-rcc-import")).toBeEnabled();
    expect(screen.queryByTestId("fw-rcc-hint")).not.toBeInTheDocument();
  });

  it("asks the network nothing while rendering", async () => {
    const u = user();
    renderWorkspace({ fileServerPath: "/proj" });
    await openMenu(u);

    expect(axios.get).not.toHaveBeenCalled();
    expect(axios.post).not.toHaveBeenCalled();
  });

  it("puts imported figures in the tree and the rest among independent resources", async () => {
    // What an import DOES once the curator accepts it: the artifacts land in
    // the same draft lists a form would have filled, so they are ordinary
    // rows the moment they arrive.
    const u = user();
    const ctx = renderWorkspace({ fileServerPath: "/proj" });

    ctx.rerenderWith({
      fileServerPath: "/proj",
      charts: [{ id: "c0", caption: "Imported figure" }],
      scripts: [{ id: "s0", readme: "imported.py" }],
      datasets: [{ id: "d0", readme: "imported data" }],
      tools: [{ id: "t0", packageName: "numpy" }],
    });

    expect(screen.getByTestId("fw-figure-c0")).toBeInTheDocument();
    const independent = within(screen.getByTestId("fw-unlinked"));
    ["s0", "d0", "t0"].forEach((id) => {
      expect(independent.getByTestId(`fw-node-${id}`)).toBeInTheDocument();
    });

    // And connectable at once, with no metadata retyped.
    await openLinkFor(u, "s0");
    await u.click(screen.getByTestId("fw-link-option-s0-c0"));
    await u.click(screen.getByTestId("fw-link-apply"));

    expect(ctx.addEdge).toHaveBeenCalledWith({
      from: "s0",
      to: "c0",
      type: "generates",
    });
  });
});
