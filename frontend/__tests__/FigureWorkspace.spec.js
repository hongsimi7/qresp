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
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
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
jest.mock("../components/CuratorForms/WorkflowInfoForm", () => {
  const Stub = (props) => (
    <div
      data-testid="stub-external-form"
      data-dialog-only={String(!!props.dialogOnly)}
    />
  );
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

// ---- walking the one control -------------------------------------------
//
// "Add or link resource" asks one question at a time. These helpers walk it
// so a test can say what it is about instead of re-describing the menu.
const openFlowFor = async (u, id) => {
  await u.click(screen.getByTestId(id ? `fw-addlink-${id}` : "fw-addlink"));
  return screen.findByTestId("fw-flow-menu");
};
const openManualKinds = async (u, id) => {
  await openFlowFor(u, id);
  await u.hover(screen.getByTestId("fw-source-manual"));
  return screen.findByTestId("fw-kind-menu");
};
const openRccKinds = async (u, id) => {
  await openFlowFor(u, id);
  await u.hover(screen.getByTestId("fw-source-rcc"));
  return screen.findByTestId("fw-kind-menu");
};
const addManually = async (u, id, kind) => {
  await openManualKinds(u, id);
  await u.click(screen.getByTestId(`fw-add-${id}-${kind}`));
};
const openLinkFor = async (u, id) => {
  await openFlowFor(u, id);
  await u.click(screen.getByTestId(`fw-link-${id}`));
  return screen.findByTestId("fw-link-dialog");
};

const CHAIN = {
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

describe("the workspace", () => {
  afterEach(() => jest.resetAllMocks());

  it("is one section, headed for figures and resources", () => {
    renderWorkspace();
    expect(
      screen.getAllByRole("heading", { name: /organize figures and resources/i })
        .length
    ).toBeGreaterThan(0);
  });

  it("mounts the real forms with their own triggers hidden", () => {
    renderWorkspace();
    ["chart", "script", "dataset", "tool"].forEach((kind) =>
      expect(screen.getByTestId(`stub-${kind}-form`)).toHaveAttribute(
        "data-hidden",
        "true"
      )
    );
    // The External Data dialog, which used to be locked inside a section
    // that only appeared once the graph already had nodes.
    expect(screen.getByTestId("stub-external-form")).toHaveAttribute(
      "data-dialog-only",
      "true"
    );
  });

  it("offers one way in", () => {
    renderWorkspace();
    expect(screen.getByTestId("fw-addlink")).toHaveTextContent(
      /add or link resource/i
    );
  });
});

describe("the three actions on a row", () => {
  afterEach(() => jest.resetAllMocks());

  it("keeps them together and always visible", () => {
    renderWorkspace(CHAIN);
    ["c0", "s0", "d0", "t0"].forEach((id) => {
      const group = within(screen.getByTestId(`fw-actions-${id}`));
      expect(group.getByTestId(`fw-addlink-${id}`)).toBeInTheDocument();
      expect(group.getByTestId(`fw-edit-${id}`)).toBeInTheDocument();
      expect(group.getByTestId(`fw-remove-${id}`)).toBeInTheDocument();
    });
  });

  it("no longer hides Edit and Remove behind a menu somewhere else", () => {
    renderWorkspace(CHAIN);
    expect(screen.queryByTestId("fw-more-c0")).not.toBeInTheDocument();
    expect(screen.queryByTestId("fw-more-menu")).not.toBeInTheDocument();
  });

  it("opens the artifact's own form to edit it", async () => {
    const u = user();
    const ctx = renderWorkspace(CHAIN);
    await u.click(screen.getByTestId("fw-edit-s0"));
    expect(ctx.helpers.setDefault).toHaveBeenCalledWith("script", SCRIPT);
    expect(ctx.helpers.openForm).toHaveBeenCalledWith("script");
  });

  it("removes through the existing delete path", async () => {
    const u = user();
    const ctx = renderWorkspace(CHAIN);
    await u.click(screen.getByTestId("fw-remove-c0"));
    expect(ctx.del).toHaveBeenCalledWith("chart", "c0");
  });

  it("names each action for a screen reader", () => {
    renderWorkspace(CHAIN);
    expect(
      screen.getByRole("button", { name: "Edit plot_dos.py" })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Remove plot_dos.py" })
    ).toBeInTheDocument();
  });

  it("gives a shared reference only a way back", () => {
    // A reference is not a second copy of the artifact, so it carries none
    // of the artifact's actions.
    renderWorkspace({
      charts: [FIGURE, { id: "c1", caption: "Band structure" }],
      scripts: [SCRIPT],
      workflow: {
        nodes: [],
        edges: [
          { from: "s0", to: "c0", type: "generates" },
          { from: "s0", to: "c1", type: "generates" },
        ],
      },
    });
    const reference = within(screen.getByTestId("fw-ref-s0-c1"));
    expect(reference.getByTestId("fw-goto-s0-c1")).toBeInTheDocument();
    expect(reference.queryByTestId("fw-actions-s0")).not.toBeInTheDocument();
    expect(reference.queryByTestId("fw-edit-s0")).not.toBeInTheDocument();
    expect(reference.queryByTestId("fw-remove-s0")).not.toBeInTheDocument();
    // And the real node still has all three.
    expect(screen.getAllByTestId("fw-node-s0")).toHaveLength(1);
    expect(screen.getByTestId("fw-actions-s0")).toBeInTheDocument();
  });
});

describe("add or link, one question at a time", () => {
  afterEach(() => jest.resetAllMocks());

  it("offers linking and the two ways in, and no Add new step", async () => {
    const u = user();
    renderWorkspace({ charts: [FIGURE], fileServerPath: "/proj" });
    await openFlowFor(u, "c0");

    expect(screen.getByTestId(`fw-link-c0`)).toHaveTextContent(/link existing/i);
    expect(screen.getByTestId("fw-source-manual")).toHaveTextContent(
      /enter manually/i
    );
    expect(screen.getByTestId("fw-source-rcc")).toHaveTextContent(/from rcc/i);
    // "Add new" asked nothing: every path under it led to these same two.
    expect(screen.queryByTestId("fw-flow-new")).not.toBeInTheDocument();
    expect(screen.queryByText(/^Add new/)).not.toBeInTheDocument();
  });

  it("asks HOW it arrives before WHAT it is", async () => {
    const u = user();
    renderWorkspace({ fileServerPath: "/proj" });
    await openFlowFor(u, "");
    // The first pane asks HOW. The kinds live in the branch, never in it --
    // opening the menu focuses its first item, and focus opens the branch,
    // which is the behaviour a keyboard needs.
    const root = within(screen.getByTestId("fw-flow-menu"));
    expect(root.queryByTestId("fw-add--chart")).not.toBeInTheDocument();
    expect(root.getByTestId("fw-source-manual")).toBeInTheDocument();

    await u.hover(screen.getByTestId("fw-source-manual"));
    const kinds = within(await screen.findByTestId("fw-kind-menu"));
    ["chart", "dataset", "script", "tool", "head"].forEach((kind) =>
      expect(kinds.getByTestId(`fw-add--${kind}`)).toBeInTheDocument()
    );
  });

  it("opens the branch on hover alone, with no click", async () => {
    const u = user();
    renderWorkspace({ fileServerPath: "/proj" });
    await openFlowFor(u, "");
    await u.hover(screen.getByTestId("fw-source-rcc"));
    expect(await screen.findByTestId("fw-kind-menu")).toBeInTheDocument();
  });

  it("keeps the branch open while the pointer crosses into it", async () => {
    // The pointer has to cross a gap to reach the child; a branch that
    // closed on mouseleave closed underneath it every time.
    const u = user();
    renderWorkspace({ fileServerPath: "/proj" });
    await openFlowFor(u, "");
    await u.hover(screen.getByTestId("fw-source-manual"));
    const branch = await screen.findByTestId("fw-kind-menu");

    await u.unhover(screen.getByTestId("fw-source-manual"));
    await u.hover(within(branch).getByTestId("fw-add--script"));
    expect(screen.getByTestId("fw-kind-menu")).toBeInTheDocument();
  });

  it("lets the pointer go back and pick the OTHER way in", async () => {
    // A Menu is a Modal, and its backdrop swallows the pointer. With the
    // branch open, the parent's other item could not be reached at all.
    const u = user();
    renderWorkspace({ fileServerPath: "/proj" });
    await openFlowFor(u, "");

    await u.hover(screen.getByTestId("fw-source-manual"));
    expect(
      within(await screen.findByTestId("fw-kind-menu")).getByTestId(
        "fw-add--head"
      )
    ).toBeInTheDocument();

    await u.hover(screen.getByTestId("fw-source-rcc"));
    const rcc = within(await screen.findByTestId("fw-kind-menu"));
    expect(rcc.getByTestId("fw-rcc-chart")).toBeInTheDocument();
    // External data is not something a folder can be scanned for.
    expect(rcc.queryByTestId("fw-rcc-head")).not.toBeInTheDocument();
  });

  it("keeps the parent pane open beside the child", async () => {
    const u = user();
    renderWorkspace({ fileServerPath: "/proj" });
    await openFlowFor(u, "");
    await u.hover(screen.getByTestId("fw-source-manual"));
    await screen.findByTestId("fw-kind-menu");

    expect(screen.getByTestId("fw-flow-menu")).toBeInTheDocument();
    expect(screen.getByTestId("fw-source-manual")).toBeInTheDocument();
  });

  it("anchors to the control that was pressed, not to the page", async () => {
    // Stored as a testid and looked up live: an element captured from the
    // event goes stale on the next render, and MUI then falls back to the
    // top left of the screen.
    const u = user();
    renderWorkspace({ charts: [FIGURE], scripts: [SCRIPT] });
    await openFlowFor(u, "s0");
    // The menu is built for THIS row: its Link item names s0.
    expect(screen.getByTestId("fw-link-s0")).toBeInTheDocument();
    expect(screen.queryByTestId("fw-link-c0")).not.toBeInTheDocument();
  });

  it("opens and closes a branch from the keyboard", async () => {
    const u = user();
    renderWorkspace({ fileServerPath: "/proj" });
    await openFlowFor(u, "");

    screen.getByTestId("fw-source-manual").focus();
    await u.keyboard("{ArrowRight}");
    expect(await screen.findByTestId("fw-kind-menu")).toBeInTheDocument();

    screen.getByTestId("fw-source-manual").focus();
    await u.keyboard("{ArrowLeft}");
    await waitFor(() =>
      expect(screen.queryByTestId("fw-kind-menu")).not.toBeInTheDocument()
    );
  });

  it("creates by hand through the existing form", async () => {
    const u = user();
    const ctx = renderWorkspace();
    await addManually(u, "", "chart");

    expect(ctx.helpers.setDefault).toHaveBeenCalledWith("chart", null);
    expect(ctx.helpers.openForm).toHaveBeenCalledWith("chart");
    expect(ctx.addEdge).not.toHaveBeenCalled();
  });

  it("sends External data to its own form", async () => {
    const u = user();
    const ctx = renderWorkspace({ fileServerPath: "/proj" });
    await addManually(u, "", "head");

    expect(ctx.helpers.setExternalNodeFormOpen).toHaveBeenCalledWith(true);
    expect(ctx.helpers.openForm).not.toHaveBeenCalledWith("head");
  });

  it("attaches what it creates to the row it was opened from", async () => {
    const u = user();
    const ctx = renderWorkspace({ charts: [FIGURE] });
    await addManually(u, "c0", "script");
    ctx.rerenderWith({ charts: [FIGURE], scripts: [SCRIPT] });

    expect(ctx.addEdge).toHaveBeenCalledWith({
      from: "s0",
      to: "c0",
      type: "generates",
    });
  });

  it("connects nothing when the form was cancelled", async () => {
    const u = user();
    const ctx = renderWorkspace({ charts: [FIGURE] });
    await addManually(u, "c0", "script");
    ctx.rerenderWith({ charts: [FIGURE] });
    expect(ctx.addEdge).not.toHaveBeenCalled();
  });
});

describe("importing from RCC", () => {
  afterEach(() => jest.resetAllMocks());

  it("offers only the four kinds a folder can be scanned for", async () => {
    const u = user();
    renderWorkspace({ fileServerPath: "/proj" });
    const kinds = within(await openRccKinds(u, ""));

    ["chart", "dataset", "script", "tool"].forEach((kind) =>
      expect(kinds.getByTestId(`fw-rcc-${kind}`)).toBeInTheDocument()
    );
    // External data is a URL somebody types.
    expect(kinds.queryByTestId("fw-rcc-head")).not.toBeInTheDocument();
  });

  it("opens the existing typed flow for the chosen kind", async () => {
    const u = user();
    renderWorkspace({ fileServerPath: "/proj" });
    await openRccKinds(u, "");
    await u.click(screen.getByTestId("fw-rcc-tool"));

    const importer = screen.getByTestId("stub-folder-analysis");
    expect(importer).toHaveAttribute("data-type", "tool");
    expect(importer).toHaveAttribute("data-hidden", "true");
    expect(importer).toHaveAttribute("data-auto", "true");
  });

  it("disables only RCC when no folder is chosen, and says why", async () => {
    const u = user();
    renderWorkspace({ fileServerPath: "" });
    await openFlowFor(u, "");

    expect(screen.getByTestId("fw-source-rcc")).toHaveAttribute(
      "aria-disabled",
      "true"
    );
    expect(screen.getByTestId("fw-rcc-hint")).toHaveTextContent(
      /choose a file server path above, in this page/i
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
    await openFlowFor(u, "");
    expect(screen.queryByTestId("fw-rcc-hint")).not.toBeInTheDocument();
  });

  it("asks the network nothing while rendering", async () => {
    const u = user();
    renderWorkspace({ fileServerPath: "/proj" });
    await openRccKinds(u, "");
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

    const independent = within(screen.getByTestId("fw-unlinked"));
    ["c0", "s0", "d0", "t0"].forEach((id) =>
      expect(independent.getByTestId(`fw-node-${id}`)).toBeInTheDocument()
    );

    await openLinkFor(u, "s0");
    await u.click(screen.getByTestId("fw-link-option-s0-c0"));
    await u.click(screen.getByTestId("fw-link-apply"));
    expect(ctx.addEdge).toHaveBeenCalledWith({
      from: "s0",
      to: "c0",
      type: "links_to",
    });
  });
});

describe("drawing an arrow between any two resources", () => {
  afterEach(() => jest.resetAllMocks());

  const PAIR = {
    charts: [FIGURE],
    scripts: [SCRIPT],
    datasets: [{ id: "d0", readme: "spectra" }],
    tools: [{ id: "t0", packageName: "numpy" }],
    heads: [{ id: "h0", URLs: ["https://example.org/set"] }],
  };

  it("names the source and asks which way the arrow points", async () => {
    const u = user();
    renderWorkspace(PAIR);
    await openLinkFor(u, "s0");

    expect(screen.getByTestId("fw-dir-out")).toHaveTextContent(
      "plot_dos.py → selected"
    );
    expect(screen.getByTestId("fw-dir-in")).toHaveTextContent(
      "selected → plot_dos.py"
    );
  });

  it("lists every other artifact once, with no relationship words", async () => {
    const u = user();
    renderWorkspace(PAIR);
    const dialog = within(await openLinkFor(u, "s0"));

    ["c0", "d0", "t0", "h0"].forEach((other) =>
      expect(dialog.getByTestId(`fw-link-option-s0-${other}`)).toBeInTheDocument()
    );
    const text = screen.getByTestId("fw-link-dialog").textContent;
    [
      "Workflow connection",
      "Related Datasets",
      "generates",
      "supplies input to",
      "uses tool",
      "feeds into",
      "related to",
    ].forEach((phrase) => expect(text).not.toContain(phrase));
  });

  it("makes Script -> Dataset, which the old rules forbade", async () => {
    const u = user();
    const ctx = renderWorkspace(PAIR);
    await openLinkFor(u, "s0");
    await u.click(screen.getByTestId("fw-link-option-s0-d0"));
    await u.click(screen.getByTestId("fw-link-apply"));

    expect(ctx.addEdge).toHaveBeenCalledWith({
      from: "s0",
      to: "d0",
      type: "links_to",
    });
  });

  it("makes Dataset -> Script from the same dialog, flipped", async () => {
    const u = user();
    const ctx = renderWorkspace(PAIR);
    await openLinkFor(u, "s0");
    await u.click(screen.getByTestId("fw-dir-in"));
    await u.click(screen.getByTestId("fw-link-option-d0-s0"));
    await u.click(screen.getByTestId("fw-link-apply"));

    expect(ctx.addEdge).toHaveBeenCalledWith({
      from: "d0",
      to: "s0",
      type: "links_to",
    });
  });

  it("offers every artifact type combination", async () => {
    const u = user();
    for (const source of ["c0", "s0", "d0", "t0", "h0"]) {
      const ctx = renderWorkspace(PAIR);
      await openLinkFor(u, source);
      ["c0", "s0", "d0", "t0", "h0"]
        .filter((other) => other !== source)
        .forEach((other) =>
          expect(
            screen.getByTestId(`fw-link-option-${source}-${other}`)
          ).toBeInTheDocument()
        );
      // Never itself.
      expect(
        screen.queryByTestId(`fw-link-option-${source}-${source}`)
      ).not.toBeInTheDocument();
      await u.click(screen.getByTestId("fw-link-cancel"));
      ctx.rerenderWith({});
      cleanup();
    }
  });

  it("links several targets at once without copying anything", async () => {
    const u = user();
    const ctx = renderWorkspace(PAIR);
    await openLinkFor(u, "s0");
    await u.click(screen.getByTestId("fw-link-option-s0-c0"));
    await u.click(screen.getByTestId("fw-link-option-s0-d0"));
    await u.click(screen.getByTestId("fw-link-apply"));

    expect(ctx.addEdge).toHaveBeenCalledTimes(2);
    expect(ctx.helpers.openForm).not.toHaveBeenCalled();
    expect(ctx.helpers.setDefault).not.toHaveBeenCalled();
  });

  it("shows an arrow already drawn as made, and refuses a second", async () => {
    const u = user();
    renderWorkspace({
      ...PAIR,
      workflow: { nodes: [], edges: [{ from: "s0", to: "d0", type: "links_to" }] },
    });
    await openLinkFor(u, "s0");

    const made = screen.getByTestId("fw-link-option-s0-d0");
    expect(made).toBeChecked();
    expect(made).toBeDisabled();
  });

  it("still offers the opposite arrow, which is a different fact", async () => {
    const u = user();
    const ctx = renderWorkspace({
      ...PAIR,
      workflow: { nodes: [], edges: [{ from: "s0", to: "d0", type: "links_to" }] },
    });
    await openLinkFor(u, "s0");
    await u.click(screen.getByTestId("fw-dir-in"));

    const back = screen.getByTestId("fw-link-option-d0-s0");
    expect(back).toBeEnabled();
    await u.click(back);
    await u.click(screen.getByTestId("fw-link-apply"));
    // It closes a loop, so it is asked about rather than refused.
    await u.click(await screen.findByTestId("fw-loop-confirm"));
    expect(ctx.addEdge).toHaveBeenCalledWith({
      from: "d0",
      to: "s0",
      type: "links_to",
      feedback: true,
    });
  });

  it("reads an existing association as a two-headed arrow", async () => {
    const u = user();
    renderWorkspace({
      charts: [FIGURE, { id: "c1", caption: "Band structure" }],
      workflow: { nodes: [], edges: [{ from: "c1", to: "c0", type: "related_to" }] },
    });
    await openLinkFor(u, "c0");

    expect(screen.getByTestId("fw-link-made-c0-c1")).toHaveTextContent("↔");
    expect(screen.getByTestId("fw-link-option-c0-c1")).toBeDisabled();
  });

  it("makes nothing when the dialog is cancelled", async () => {
    const u = user();
    const ctx = renderWorkspace(PAIR);
    await openLinkFor(u, "s0");
    await u.click(screen.getByTestId("fw-link-option-s0-c0"));
    await u.click(screen.getByTestId("fw-link-cancel"));

    expect(ctx.addEdge).not.toHaveBeenCalled();
    expect(ctx.helpers.openForm).not.toHaveBeenCalled();
    expect(screen.queryByTestId("fw-link-dialog")).not.toBeInTheDocument();
  });

  it("ticks a box without moving or animating anything", async () => {
    const u = user();
    renderWorkspace(PAIR);
    await openLinkFor(u, "s0");

    const before = screen.getByTestId("fw-link-dialog").textContent;
    const box = screen.getByTestId("fw-link-option-s0-c0");
    await u.click(box);

    expect(box).toBeChecked();
    // Nothing appeared, so nothing below it moved.
    expect(screen.getByTestId("fw-link-dialog").textContent).toBe(before);
    // The one visual affordance that is not decoration: it stays reachable.
    expect(box).not.toBeDisabled();
    expect(box).not.toHaveAttribute("tabindex", "-1");
  });
});

describe("feedback loops", () => {
  afterEach(() => jest.resetAllMocks());

  const closing = {
    charts: [FIGURE],
    scripts: [SCRIPT],
    workflow: { nodes: [], edges: [{ from: "c0", to: "s0", type: "links_to" }] },
  };

  const pickLoop = async (u) => {
    await openLinkFor(u, "s0");
    await u.click(screen.getByTestId("fw-link-option-s0-c0"));
    await u.click(screen.getByTestId("fw-link-apply"));
    return screen.findByTestId("fw-loop-dialog");
  };

  it("asks before making one, and makes nothing yet", async () => {
    const u = user();
    const ctx = renderWorkspace(closing);
    await pickLoop(u);
    expect(ctx.addEdge).not.toHaveBeenCalled();
  });

  it("writes the answer onto the edge it was asked about", async () => {
    const u = user();
    const ctx = renderWorkspace(closing);
    await pickLoop(u);
    await u.click(screen.getByTestId("fw-loop-confirm"));

    expect(ctx.addEdge).toHaveBeenCalledTimes(1);
    expect(ctx.addEdge).toHaveBeenCalledWith({
      from: "s0",
      to: "c0",
      type: "links_to",
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

  it("shows the mark as a badge, read back from the record", () => {
    renderWorkspace({
      charts: [FIGURE],
      scripts: [SCRIPT],
      workflow: {
        nodes: [],
        edges: [
          { from: "c0", to: "s0", type: "links_to" },
          { from: "s0", to: "c0", type: "links_to", feedback: true },
        ],
      },
    });
    expect(screen.getByTestId("fw-feedback-s0-c0")).toHaveTextContent(
      /feedback loop/i
    );
    expect(screen.getByTestId("fw-lane-edge-s0-c0")).toHaveAttribute(
      "data-loop",
      "true"
    );
    // The other edge closes the same loop and is NOT marked: nobody said so.
    expect(screen.getByTestId("fw-lane-edge-c0-s0")).toHaveAttribute(
      "data-loop",
      "false"
    );
  });

  it("keeps the mark when the edge that closed the loop is removed", () => {
    const ctx = renderWorkspace({
      charts: [FIGURE],
      scripts: [SCRIPT],
      workflow: {
        nodes: [],
        edges: [
          { from: "c0", to: "s0", type: "links_to" },
          { from: "s0", to: "c0", type: "links_to", feedback: true },
        ],
      },
    });
    ctx.rerenderWith({
      workflow: {
        nodes: [],
        edges: [{ from: "s0", to: "c0", type: "links_to", feedback: true }],
      },
    });
    expect(screen.getByTestId("fw-feedback-s0-c0")).toBeInTheDocument();
  });

  it("refuses an artifact joined to itself", async () => {
    const u = user();
    renderWorkspace({ charts: [FIGURE], scripts: [SCRIPT] });
    await openLinkFor(u, "s0");
    expect(
      screen.queryByTestId("fw-link-option-s0-s0")
    ).not.toBeInTheDocument();
  });
});

describe("breaking one relationship", () => {
  afterEach(() => jest.resetAllMocks());

  it("sits beside every arrow that is drawn", () => {
    renderWorkspace(CHAIN);
    ["s0-c0", "d0-s0", "t0-s0"].forEach((pair) => {
      expect(screen.getByTestId(`fw-flow-${pair}`)).toBeInTheDocument();
      expect(screen.getByTestId(`fw-unlink-${pair}`)).toBeInTheDocument();
    });
  });

  it("names both ends and the relationship, for a screen reader", () => {
    renderWorkspace(CHAIN);
    expect(
      screen.getByRole("button", {
        name: "Unlink plot_dos.py generates Density of states",
      })
    ).toBeInTheDocument();
  });

  it("removes one edge of a shared artifact and keeps the rest", () => {
    const ctx = renderWorkspace({
      charts: [FIGURE, { id: "c1", caption: "Band structure" }],
      scripts: [SCRIPT],
      workflow: {
        nodes: [],
        edges: [
          { from: "s0", to: "c0", type: "generates" },
          { from: "s0", to: "c1", type: "generates" },
        ],
      },
    });
    fireEvent.click(screen.getByTestId("fw-unlink-s0-c1"));

    expect(ctx.unlink).toHaveBeenCalledTimes(1);
    expect(ctx.unlink).toHaveBeenCalledWith("s0", "c1");
    expect(ctx.del).not.toHaveBeenCalled();
    expect(ctx.addEdge).not.toHaveBeenCalled();
  });

  it("is a real button a keyboard can reach", () => {
    renderWorkspace(CHAIN);
    const button = screen.getByTestId("fw-unlink-s0-c0");
    expect(button.tagName).toBe("BUTTON");
    expect(button).not.toBeDisabled();
  });
});

describe("what the outline says", () => {
  afterEach(() => jest.resetAllMocks());

  it("shows a kind, a name and an arrow, and no vocabulary", () => {
    renderWorkspace(CHAIN);
    // The outline rows only. The drawing carries the same words in <title>,
    // where a reader who cannot see an arrowhead needs them -- that is the
    // point of putting them there and nowhere else.
    const text = ["c0", "s0", "d0", "t0"]
      .map((id) => screen.getByTestId(`fw-node-${id}`).textContent)
      .join(" ");
    [
      "Inputs",
      "Process",
      "Figures on the right",
      "Generated by",
      "Uses input",
      "generates",
      "supplies input to",
      "uses tool",
      "feeds into",
      "related to",
    ].forEach((phrase) => expect(text).not.toContain(phrase));

    expect(screen.getByTestId("fw-flow-s0-c0")).toHaveTextContent("→");
  });

  it("still describes the relationship to a screen reader", () => {
    renderWorkspace(CHAIN);
    expect(screen.getByTestId("fw-flow-s0-c0")).toHaveAttribute(
      "aria-label",
      "plot_dos.py generates Density of states"
    );
  });

  it("shows an association as a two-headed arrow", () => {
    renderWorkspace({
      charts: [FIGURE, { id: "c1", caption: "Band structure" }],
      workflow: { nodes: [], edges: [{ from: "c0", to: "c1", type: "related_to" }] },
    });
    expect(screen.getByTestId("fw-relation-c0-c1")).toHaveTextContent("↔");
  });

  it("draws the graph beside it on a wide screen", () => {
    renderWorkspace(CHAIN);
    expect(screen.getByTestId("fw-lanes")).toBeInTheDocument();
    ["c0", "s0", "d0", "t0"].forEach((id) =>
      expect(screen.getByTestId(`fw-node-${id}`)).toBeInTheDocument()
    );
  });

  it("carries no lane titles anywhere", () => {
    renderWorkspace(CHAIN);
    const lanes = screen.getByTestId("fw-lanes").textContent;
    ["Inputs", "Process", "Figures"].forEach((lane) =>
      expect(lanes).not.toContain(lane)
    );
  });
});

describe("groups, drafts and independence", () => {
  afterEach(() => jest.resetAllMocks());

  it("leaves an artifact with no edge on its own", () => {
    renderWorkspace({ ...CHAIN, heads: [{ id: "h0", URLs: ["https://e.org/a"] }] });
    const independent = within(screen.getByTestId("fw-unlinked"));
    expect(independent.getByTestId("fw-node-h0")).toBeInTheDocument();
  });

  it("merges two groups the moment they are joined", () => {
    const two = {
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
    const ctx = renderWorkspace(two);
    expect(screen.getByTestId("fw-group-c1")).toBeInTheDocument();

    ctx.rerenderWith({
      workflow: {
        nodes: [],
        edges: [...two.workflow.edges, { from: "s0", to: "s1", type: "links_to" }],
      },
    });
    expect(screen.queryByTestId("fw-group-c1")).not.toBeInTheDocument();
  });

  it("keeps a saved artifact visible and linkable before the paper is saved", async () => {
    const u = user();
    const ctx = renderWorkspace({ charts: [FIGURE] });
    ctx.rerenderWith({ charts: [FIGURE], scripts: [SCRIPT] });
    expect(screen.getByTestId("fw-node-s0")).toBeInTheDocument();

    await openLinkFor(u, "s0");
    await u.click(screen.getByTestId("fw-link-option-s0-c0"));
    await u.click(screen.getByTestId("fw-link-apply"));
    expect(ctx.addEdge).toHaveBeenCalled();
  });

  it("reads a legacy untyped edge without inventing a meaning for it", () => {
    renderWorkspace({
      charts: [FIGURE],
      scripts: [SCRIPT],
      workflow: { nodes: [], edges: [["s0", "c0"]] },
    });
    expect(screen.getByTestId("fw-flow-s0-c0")).toHaveTextContent("→");
    expect(screen.getByTestId("fw-flow-s0-c0")).toHaveAttribute(
      "aria-label",
      "plot_dos.py connects to Density of states"
    );
  });

  it("works on a paper with no workflow at all", () => {
    renderWorkspace({ charts: [FIGURE], scripts: [SCRIPT] });
    const independent = within(screen.getByTestId("fw-unlinked"));
    expect(independent.getByTestId("fw-node-c0")).toBeInTheDocument();
    expect(independent.getByTestId("fw-node-s0")).toBeInTheDocument();
  });
});

// ---- RESTORED COVERAGE -------------------------------------------------
//
// The UI rewrite above replaced how these behaviours are reached, not the
// behaviours themselves. Everything below was asserted before the rewrite
// and is asserted again here against the new contract, so that changing the
// screen did not quietly stop checking the product.

// A workspace whose edges are REAL state, so accepting a suggestion actually
// changes what the next render sees. A jest.fn() would let a spent
// suggestion go on looking acceptable forever.
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

describe("an arrow between two of the same kind", () => {
  afterEach(() => jest.resetAllMocks());

  const PAIRS = [
    ["chart", "charts", "c0", "c1", { id: "c1", caption: "Second figure" }],
    ["script", "scripts", "s0", "s1", { id: "s1", readme: "second.py" }],
    ["dataset", "datasets", "d0", "d1", { id: "d1", readme: "second data" }],
    ["tool", "tools", "t0", "t1", { id: "t1", packageName: "scipy" }],
    ["external", "heads", "h0", "h1", { id: "h1", URLs: ["https://e.org/b"] }],
  ];

  const paperFor = (list, extra) => {
    const base = {
      charts: [FIGURE],
      scripts: [SCRIPT],
      datasets: [{ id: "d0", readme: "spectra" }],
      tools: [{ id: "t0", packageName: "numpy" }],
      heads: [{ id: "h0", URLs: ["https://e.org/a"] }],
    };
    return { ...base, [list]: [...base[list], extra] };
  };

  it.each(PAIRS)(
    "offers another %s as a candidate",
    async (_kind, list, a, b, extra) => {
      const u = user();
      renderWorkspace(paperFor(list, extra));
      await openLinkFor(u, a);
      // Same kind, different artifact: an ordinary candidate, not a special
      // case and not hidden behind a second vocabulary.
      expect(screen.getByTestId(`fw-link-option-${a}-${b}`)).toBeInTheDocument();
    }
  );

  it.each(PAIRS)("draws the arrow between two %ss", async (_kind, list, a, b, extra) => {
    const u = user();
    const ctx = renderWorkspace(paperFor(list, extra));
    await openLinkFor(u, a);
    await u.click(screen.getByTestId(`fw-link-option-${a}-${b}`));
    await u.click(screen.getByTestId("fw-link-apply"));

    expect(ctx.addEdge).toHaveBeenCalledWith({
      from: a,
      to: b,
      type: "links_to",
    });
  });

  it("never offers the artifact itself", async () => {
    const u = user();
    renderWorkspace(paperFor("charts", { id: "c1", caption: "Second" }));
    await openLinkFor(u, "c0");
    expect(screen.queryByTestId("fw-link-option-c0-c0")).not.toBeInTheDocument();
  });

  it("allows the same pair the other way round", async () => {
    const u = user();
    const ctx = renderWorkspace({
      ...paperFor("datasets", { id: "d1", readme: "second data" }),
      workflow: { nodes: [], edges: [{ from: "d0", to: "d1", type: "links_to" }] },
    });
    await openLinkFor(u, "d0");
    // The one already drawn is spent...
    expect(screen.getByTestId("fw-link-option-d0-d1")).toBeDisabled();
    // ...and the reverse is a different fact.
    await u.click(screen.getByTestId("fw-dir-in"));
    await u.click(screen.getByTestId("fw-link-option-d1-d0"));
    await u.click(screen.getByTestId("fw-link-apply"));
    await u.click(await screen.findByTestId("fw-loop-confirm"));

    expect(ctx.addEdge).toHaveBeenCalledWith({
      from: "d1",
      to: "d0",
      type: "links_to",
      feedback: true,
    });
  });

  it("leaves the older relationships to their own endpoints", async () => {
    // A tool still cannot be a figure's `uses_tool`, whatever the generic
    // arrow allows.
    const u = user();
    const ctx = renderWorkspace(paperFor("tools", { id: "t1", packageName: "scipy" }));
    await openLinkFor(u, "t0");
    await u.click(screen.getByTestId("fw-link-option-t0-c0"));
    await u.click(screen.getByTestId("fw-link-apply"));

    expect(ctx.addEdge).toHaveBeenCalledWith({
      from: "t0",
      to: "c0",
      type: "links_to",
    });
    expect(ctx.addEdge).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "uses_tool" })
    );
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

  it("calls them independent, never unlinked", () => {
    // Named by what they LACK, an ordinary dataset that produced no figure
    // read as a defect to go and fix.
    renderWorkspace({
      charts: [FIGURE],
      datasets: [{ id: "d0", readme: "orphan data" }],
    });
    expect(
      within(screen.getByTestId("fw-unlinked")).getAllByText(
        /independent resources/i
      ).length
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

  it("tells an empty record that standing alone is allowed", () => {
    renderWorkspace();
    const text = screen.getByTestId("fw-unlinked").textContent;
    expect(text).toMatch(/no independent resources yet/i);
    expect(text).toMatch(/can stand on its own/i);
    expect(text).not.toMatch(/unlinked|orphan|missing|error|not connected/i);
  });

  it("says where things stand when nothing is independent", () => {
    renderWorkspace(CHAIN);
    expect(screen.getByTestId("fw-unlinked")).toHaveTextContent(
      /every resource here belongs to a figure/i
    );
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
      type: "links_to",
    });
  });
});

describe("external data on a row", () => {
  afterEach(() => jest.resetAllMocks());

  const HEAD = {
    id: "h0",
    label: "Materials Project mp-21276",
    readme: "Reference band structure.",
    URLs: ["https://materialsproject.org/materials/mp-21276"],
  };

  it("shows label, https link and note", () => {
    renderWorkspace({ charts: [FIGURE], heads: [HEAD] });
    const row = within(screen.getByTestId("fw-node-h0"));
    expect(row.getByTestId("fw-url-h0")).toHaveAttribute(
      "href",
      "https://materialsproject.org/materials/mp-21276"
    );
    expect(row.getByTestId("fw-note-h0")).toHaveTextContent(
      /reference band structure/i
    );
  });

  it("keeps a legacy http head visible and renders no local path", () => {
    renderWorkspace({
      charts: [FIGURE],
      heads: [{ id: "h0", label: "Old link", URLs: ["http://example.org/old"] }],
    });
    expect(screen.getByTestId("fw-node-h0")).toBeInTheDocument();
    expect(screen.getByTestId("fw-url-h0")).toHaveAttribute(
      "href",
      "http://example.org/old"
    );
    expect(screen.getByTestId("fw-node-h0").textContent).not.toMatch(
      /^[A-Za-z]:\\|\/home\/|\/Users\//
    );
  });
});

describe("workflow groups, split as well as merged", () => {
  afterEach(() => jest.resetAllMocks());

  const two = {
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

  it("keeps two unconnected pieces of work apart", () => {
    renderWorkspace(two);
    expect(screen.getByTestId("fw-group-c0")).toBeInTheDocument();
    expect(screen.getByTestId("fw-group-c1")).toBeInTheDocument();
  });

  it("splits them again when the joining edge goes", () => {
    const joined = {
      ...two,
      workflow: {
        nodes: [],
        edges: [...two.workflow.edges, { from: "s0", to: "s1", type: "links_to" }],
      },
    };
    const ctx = renderWorkspace(joined);
    expect(screen.queryByTestId("fw-group-c1")).not.toBeInTheDocument();

    ctx.rerenderWith({ workflow: { nodes: [], edges: two.workflow.edges } });
    expect(screen.getByTestId("fw-group-c0")).toBeInTheDocument();
    expect(screen.getByTestId("fw-group-c1")).toBeInTheDocument();
  });

  it("says a group with no figure is independent, not broken", () => {
    renderWorkspace({
      scripts: [SCRIPT, { id: "s1", readme: "pre.py" }],
      workflow: { nodes: [], edges: [{ from: "s1", to: "s0", type: "links_to" }] },
    });
    expect(screen.getByTestId("fw-stranded-s0")).toHaveTextContent(
      /independent workflow/i
    );
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
    expect(screen.getByTestId("fw-node-d0")).toBeInTheDocument();
  });

  it("shows the updated label after the artifact changes", () => {
    const ctx = renderWorkspace({ charts: [FIGURE] });
    ctx.rerenderWith({ charts: [{ id: "c0", caption: "Renamed figure" }] });
    expect(screen.getByText("Renamed figure")).toBeInTheDocument();
  });
});

describe("who owns a feedback mark", () => {
  afterEach(() => jest.resetAllMocks());

  const held = (extra = []) => ({
    charts: [FIGURE],
    scripts: [SCRIPT],
    workflow: {
      nodes: [],
      edges: [{ from: "c0", to: "s0", type: "links_to" }, ...extra],
    },
  });

  it("marks only the edge that was confirmed", async () => {
    const u = user();
    const ctx = renderWorkspace(held());
    await openLinkFor(u, "s0");
    await u.click(screen.getByTestId("fw-link-option-s0-c0"));
    await u.click(screen.getByTestId("fw-link-apply"));
    await u.click(await screen.findByTestId("fw-loop-confirm"));

    expect(ctx.addEdge).toHaveBeenCalledTimes(1);
    // The edge already there is not touched.
    expect(ctx.addEdge).not.toHaveBeenCalledWith(
      expect.objectContaining({ from: "c0", to: "s0" })
    );
  });

  it("shows the mark on that edge and on no other", () => {
    renderWorkspace(
      held([{ from: "s0", to: "c0", type: "links_to", feedback: true }])
    );
    expect(screen.getByTestId("fw-lane-edge-s0-c0")).toHaveAttribute(
      "data-loop",
      "true"
    );
    expect(screen.getByTestId("fw-lane-edge-c0-s0")).toHaveAttribute(
      "data-loop",
      "false"
    );
    expect(screen.queryByTestId("fw-feedback-c0-s0")).not.toBeInTheDocument();
  });

  it("keeps the mark when the OTHER edge of the loop is removed", () => {
    const ctx = renderWorkspace(
      held([{ from: "s0", to: "c0", type: "links_to", feedback: true }])
    );
    ctx.rerenderWith({
      workflow: {
        nodes: [],
        edges: [{ from: "s0", to: "c0", type: "links_to", feedback: true }],
      },
    });
    expect(screen.getByTestId("fw-lane-edge-s0-c0")).toHaveAttribute(
      "data-loop",
      "true"
    );
  });

  it("loses the mark when the feedback edge itself is removed", () => {
    const ctx = renderWorkspace(
      held([{ from: "s0", to: "c0", type: "links_to", feedback: true }])
    );
    ctx.rerenderWith({
      workflow: { nodes: [], edges: [{ from: "c0", to: "s0", type: "links_to" }] },
    });
    expect(screen.queryByTestId(/^fw-feedback-/)).not.toBeInTheDocument();
  });

  it("adds no mark to a cycle nobody was asked about", () => {
    renderWorkspace(held([{ from: "s0", to: "c0", type: "links_to" }]));
    expect(screen.queryByTestId(/^fw-feedback-/)).not.toBeInTheDocument();
  });

  it("adds no mark to a legacy untyped loop", () => {
    renderWorkspace({
      charts: [FIGURE],
      scripts: [SCRIPT],
      workflow: { nodes: [], edges: [["s0", "c0"], ["c0", "s0"]] },
    });
    expect(screen.queryByTestId(/^fw-feedback-/)).not.toBeInTheDocument();
  });

  it("marks nothing when the question is declined", async () => {
    const u = user();
    const ctx = renderWorkspace(held());
    await openLinkFor(u, "s0");
    await u.click(screen.getByTestId("fw-link-option-s0-c0"));
    await u.click(screen.getByTestId("fw-link-apply"));
    await u.click(await screen.findByTestId("fw-loop-cancel"));
    expect(ctx.addEdge).not.toHaveBeenCalled();
  });

  it("keeps the other choices when the loop is declined", async () => {
    // Refusing one connection is not a reason to discard the rest.
    const u = user();
    const ctx = renderWorkspace({
      ...held(),
      datasets: [{ id: "d0", readme: "spectra" }],
    });
    await openLinkFor(u, "s0");
    await u.click(screen.getByTestId("fw-link-option-s0-c0"));
    await u.click(screen.getByTestId("fw-link-option-s0-d0"));
    await u.click(screen.getByTestId("fw-link-apply"));
    await screen.findByTestId("fw-loop-dialog");
    await u.click(screen.getByTestId("fw-loop-cancel"));

    expect(ctx.addEdge).toHaveBeenCalledTimes(1);
    expect(ctx.addEdge).toHaveBeenCalledWith({
      from: "s0",
      to: "d0",
      type: "links_to",
    });
  });

  it("never asks about an association", async () => {
    const u = user();
    const ctx = renderWorkspace({
      charts: [FIGURE, { id: "c1", caption: "Second" }],
      workflow: { nodes: [], edges: [{ from: "c1", to: "c0", type: "related_to" }] },
    });
    await openLinkFor(u, "c0");
    // The association is already there, so the remaining candidate is the
    // directed one, and it closes nothing.
    expect(screen.getByTestId("fw-link-option-c0-c1")).toBeDisabled();
    await u.click(screen.getByTestId("fw-link-cancel"));
    expect(ctx.addEdge).not.toHaveBeenCalled();
  });
});

describe("unlink, from wherever the arrow is drawn", () => {
  afterEach(() => jest.resetAllMocks());

  it("reaches an edge leaving the root of its outline", () => {
    // s0 roots this outline and s1 hangs under it; the edge s0 -> s1 is
    // written on the reference row, and that is where it can be undone.
    const ctx = renderWorkspace({
      scripts: [SCRIPT, { id: "s1", readme: "preprocess.py" }],
      workflow: {
        nodes: [],
        edges: [
          { from: "s1", to: "s0", type: "links_to" },
          { from: "s0", to: "s1", type: "links_to" },
        ],
      },
    });
    expect(screen.getByTestId("fw-unlink-s0-s1")).toBeInTheDocument();
    expect(screen.getByTestId("fw-unlink-s1-s0")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("fw-unlink-s0-s1"));
    expect(ctx.unlink).toHaveBeenCalledWith("s0", "s1");
  });

  it("breaks an association from either end, in its stored direction", () => {
    // Stored c0 -> c1. Read from c1 it says the same thing, and unlinking
    // from there must still name the endpoints the record holds.
    const ctx = renderWorkspace({
      charts: [FIGURE, { id: "c1", caption: "Band structure" }],
      workflow: { nodes: [], edges: [{ from: "c0", to: "c1", type: "related_to" }] },
    });
    const buttons = screen.getAllByTestId("fw-unlink-c0-c1");
    expect(buttons.length).toBe(2);
    fireEvent.click(buttons[1]);
    expect(ctx.unlink).toHaveBeenCalledWith("c0", "c1");
  });

  it("breaks a feedback edge and takes its mark with it", () => {
    const ctx = renderWorkspace({
      charts: [FIGURE],
      scripts: [SCRIPT],
      workflow: {
        nodes: [],
        edges: [
          { from: "c0", to: "s0", type: "links_to" },
          { from: "s0", to: "c0", type: "links_to", feedback: true },
        ],
      },
    });
    expect(screen.getByTestId("fw-feedback-s0-c0")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("fw-unlink-s0-c0"));
    expect(ctx.unlink).toHaveBeenCalledWith("s0", "c0");

    ctx.rerenderWith({
      workflow: { nodes: [], edges: [{ from: "c0", to: "s0", type: "links_to" }] },
    });
    expect(screen.queryByTestId(/^fw-feedback-/)).not.toBeInTheDocument();
  });

  it("offers no unlink where no relationship is written", () => {
    renderWorkspace({ charts: [FIGURE] });
    expect(screen.queryByTestId(/^fw-unlink-/)).not.toBeInTheDocument();
  });
});

describe("reading it without the drawing", () => {
  afterEach(() => jest.resetAllMocks());

  it("shows the outline beside the drawing, not instead of it", () => {
    renderWorkspace(CHAIN);
    expect(screen.getByTestId("fw-lanes")).toBeInTheDocument();
    ["c0", "s0", "d0", "t0"].forEach((id) =>
      expect(screen.getByTestId(`fw-node-${id}`)).toBeInTheDocument()
    );
  });

  it("puts every row action on a real focusable control", () => {
    renderWorkspace(CHAIN);
    ["c0", "s0", "d0", "t0"].forEach((id) => {
      ["fw-addlink", "fw-edit", "fw-remove"].forEach((prefix) => {
        const el = screen.getByTestId(`${prefix}-${id}`);
        expect(el.tagName).toBe("BUTTON");
        expect(el).not.toBeDisabled();
        expect(el).not.toHaveAttribute("tabindex", "-1");
      });
    });
  });

  it("reaches Add or link, Edit and Remove from the keyboard", async () => {
    const u = user();
    const ctx = renderWorkspace(CHAIN);

    screen.getByTestId("fw-addlink-s0").focus();
    expect(screen.getByTestId("fw-addlink-s0")).toHaveFocus();
    await u.keyboard("{Enter}");
    await screen.findByTestId("fw-flow-menu");
    expect(screen.getByTestId("fw-link-s0")).toBeInTheDocument();
    await u.keyboard("{Escape}");

    screen.getByTestId("fw-edit-s0").focus();
    await u.keyboard("{Enter}");
    expect(ctx.helpers.openForm).toHaveBeenCalledWith("script");
  });

  it("keeps a shared artifact to one editable node and a way back", () => {
    renderWorkspace({
      charts: [FIGURE, { id: "c1", caption: "Band structure" }],
      scripts: [SCRIPT],
      workflow: {
        nodes: [],
        edges: [
          { from: "s0", to: "c0", type: "generates" },
          { from: "s0", to: "c1", type: "generates" },
        ],
      },
    });
    expect(screen.getAllByTestId("fw-node-s0")).toHaveLength(1);
    expect(screen.getByTestId("fw-shared-s0")).toHaveTextContent(/also used by/i);
    expect(screen.getByTestId("fw-goto-s0-c1")).toHaveAttribute(
      "data-target",
      "fw-anchor-s0"
    );
  });

  it("does not recurse on a graph that loops", () => {
    renderWorkspace({
      charts: [FIGURE],
      scripts: [SCRIPT],
      workflow: {
        nodes: [],
        edges: [
          { from: "s0", to: "c0", type: "links_to" },
          { from: "c0", to: "s0", type: "links_to" },
        ],
      },
    });
    expect(screen.getAllByTestId("fw-node-s0")).toHaveLength(1);
    expect(screen.getAllByTestId("fw-node-c0")).toHaveLength(1);
  });
});

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
    expect(screen.queryByTestId("fw-suggestions-c0")).not.toBeInTheDocument();
  });

  it("never offers a connection the paper already holds", () => {
    renderWorkspace({
      ...PROVEN,
      workflow: {
        nodes: [],
        edges: [{ from: "s0", to: "c0", type: "generates" }],
      },
    });
    expect(screen.queryByTestId("fw-suggestions-c0")).not.toBeInTheDocument();
  });

  it("Not now hides it here and changes nothing else", async () => {
    const u = user();
    const ctx = renderWorkspace(PROVEN);
    await u.click(screen.getByTestId("fw-suggest-toggle-c0"));
    await u.click(screen.getByTestId("fw-suggest-dismiss-s0-c0"));

    expect(screen.queryByTestId("fw-suggestions-c0")).not.toBeInTheDocument();
    expect(ctx.addEdge).not.toHaveBeenCalled();
    expect(ctx.unlink).not.toHaveBeenCalled();
    expect(ctx.del).not.toHaveBeenCalled();
    expect(axios.post).not.toHaveBeenCalled();
  });

  it("asks no provider anything, at any point", async () => {
    const u = user();
    render(<LiveWorkspace lists={PROVEN} />);
    await u.click(screen.getByTestId("fw-suggest-toggle-c0"));
    await u.click(screen.getByTestId("fw-suggest-connect-s0-c0"));

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
      scripts: [{ id: "s0", readme: "plot_dos.py", files: ["figures/dos.ipynb"] }],
    });
    expect(screen.getByTestId("fw-suggest-connect-s0-c0")).toBeInTheDocument();
    expect(
      screen.queryByTestId("fw-suggest-connect-s1-c0")
    ).not.toBeInTheDocument();
  });

  it("leaves the manual paths exactly as they were", () => {
    renderWorkspace(PROVEN);
    expect(screen.getByTestId("fw-addlink-c0")).toBeInTheDocument();
    expect(screen.getByTestId("fw-edit-c0")).toBeInTheDocument();
    expect(screen.getByTestId("fw-remove-c0")).toBeInTheDocument();
  });
});
