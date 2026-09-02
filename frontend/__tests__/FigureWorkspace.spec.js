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
const openKindsFor = async (u, id) => {
  await openFlowFor(u, id);
  await u.click(screen.getByTestId("fw-flow-new"));
  return screen.findByTestId("fw-kind-menu");
};
const openSourcesFor = async (u, id, kind) => {
  await openKindsFor(u, id);
  await u.click(screen.getByTestId(`fw-kind-${kind}`));
  return screen.findByTestId("fw-source-menu");
};
const addManually = async (u, id, kind) => {
  await openSourcesFor(u, id, kind);
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

  it("offers linking first on a row, and only Add new at the top", async () => {
    const u = user();
    renderWorkspace({ charts: [FIGURE] });

    await openFlowFor(u, "c0");
    expect(screen.getByTestId("fw-link-c0")).toHaveTextContent(/link existing/i);
    expect(screen.getByTestId("fw-flow-new")).toHaveTextContent(/add new/i);
  });

  it("asks for the KIND before the way it arrives", async () => {
    const u = user();
    renderWorkspace({ fileServerPath: "/proj" });

    const kinds = within(await openKindsFor(u, ""));
    ["chart", "dataset", "script", "tool", "head"].forEach((kind) =>
      expect(kinds.getByTestId(`fw-kind-${kind}`)).toBeInTheDocument()
    );
    // How it arrives comes after.
    expect(screen.queryByTestId("fw-source-menu")).not.toBeInTheDocument();

    const sources = within(await openSourcesFor(u, "", "dataset"));
    expect(sources.getByTestId("fw-add--dataset")).toHaveTextContent(
      /enter manually/i
    );
    expect(sources.getByTestId("fw-rcc-dataset")).toHaveTextContent(/from rcc/i);
  });

  it("keeps the parent menu open beside the child", async () => {
    // A cascade, not a replacement: the path taken stays visible.
    const u = user();
    renderWorkspace({ fileServerPath: "/proj" });
    await openSourcesFor(u, "", "script");

    expect(screen.getByTestId("fw-flow-menu")).toBeInTheDocument();
    expect(screen.getByTestId("fw-kind-menu")).toBeInTheDocument();
    expect(screen.getByTestId("fw-source-menu")).toBeInTheDocument();
  });

  it("opens a submenu from the keyboard", async () => {
    const u = user();
    renderWorkspace({ fileServerPath: "/proj" });
    await openFlowFor(u, "");

    screen.getByTestId("fw-flow-new").focus();
    await u.keyboard("{ArrowRight}");
    expect(await screen.findByTestId("fw-kind-menu")).toBeInTheDocument();

    screen.getByTestId("fw-kind-tool").focus();
    await u.keyboard("{ArrowRight}");
    expect(await screen.findByTestId("fw-source-menu")).toBeInTheDocument();
  });

  it("closes a submenu with ArrowLeft", async () => {
    const u = user();
    renderWorkspace({ fileServerPath: "/proj" });
    await openKindsFor(u, "");

    screen.getByTestId("fw-kind-tool").focus();
    await u.keyboard("{ArrowLeft}");
    await waitFor(() =>
      expect(screen.getByTestId("fw-kind-menu")).toHaveAttribute(
        "aria-hidden",
        "true"
      )
    );
  });

  it("creates by hand through the existing form", async () => {
    const u = user();
    const ctx = renderWorkspace();
    await addManually(u, "", "chart");

    expect(ctx.helpers.setDefault).toHaveBeenCalledWith("chart", null);
    expect(ctx.helpers.openForm).toHaveBeenCalledWith("chart");
    // Opening a form creates nothing.
    expect(ctx.addEdge).not.toHaveBeenCalled();
  });

  it("sends External data to its own form and offers it no RCC", async () => {
    const u = user();
    const ctx = renderWorkspace({ fileServerPath: "/proj" });
    const sources = within(await openSourcesFor(u, "", "head"));

    // There is nothing in a folder to scan for a URL somebody types.
    expect(sources.queryByTestId("fw-rcc-head")).not.toBeInTheDocument();
    await u.click(screen.getByTestId("fw-add--head"));
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

  it("offers RCC on the four kinds it can propose", async () => {
    const u = user();
    renderWorkspace({ fileServerPath: "/proj" });
    for (const kind of ["chart", "dataset", "script", "tool"]) {
      const sources = within(await openSourcesFor(u, "", kind));
      expect(sources.getByTestId(`fw-rcc-${kind}`)).toBeEnabled();
      await u.keyboard("{Escape}");
    }
  });

  it("opens the existing typed flow for the chosen kind", async () => {
    const u = user();
    renderWorkspace({ fileServerPath: "/proj" });
    await openSourcesFor(u, "", "tool");
    await u.click(screen.getByTestId("fw-rcc-tool"));

    const importer = screen.getByTestId("stub-folder-analysis");
    expect(importer).toHaveAttribute("data-type", "tool");
    expect(importer).toHaveAttribute("data-hidden", "true");
    expect(importer).toHaveAttribute("data-auto", "true");
  });

  it("disables only RCC when no folder is chosen, and says why", async () => {
    const u = user();
    renderWorkspace({ fileServerPath: "" });
    const sources = within(await openSourcesFor(u, "", "script"));

    expect(sources.getByTestId("fw-rcc-script")).toHaveAttribute(
      "aria-disabled",
      "true"
    );
    expect(sources.getByTestId("fw-rcc-hint")).toHaveTextContent(
      /choose a file server path above, in this page/i
    );
    // Entering by hand is unaffected.
    expect(sources.getByTestId("fw-add--script")).not.toHaveAttribute(
      "aria-disabled",
      "true"
    );
  });

  it("drops the explanation once a folder is chosen", async () => {
    const u = user();
    renderWorkspace({ fileServerPath: "/proj" });
    await openSourcesFor(u, "", "script");
    expect(screen.queryByTestId("fw-rcc-hint")).not.toBeInTheDocument();
  });

  it("asks the network nothing while rendering", async () => {
    const u = user();
    renderWorkspace({ fileServerPath: "/proj" });
    await openSourcesFor(u, "", "chart");
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
