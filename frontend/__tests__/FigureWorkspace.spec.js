/**
 * The figure-first Curator workspace.
 *
 * It replaces four top-level sections that asked a curator to think in Qresp's
 * storage categories -- Add Charts, Add Tools, Add Datasets, Add Scripts --
 * and then connect them separately. The tests below are mostly about two
 * claims: the figure is the root, and every form opened here is the EXISTING
 * form on the EXISTING model.
 */
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
  const Stub = () => <button type="button">Analyze RCC Folder</button>;
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
    renderWorkspace();
    expect(
      screen.getByRole("button", { name: /analyze rcc folder/i })
    ).toBeInTheDocument();
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

describe("the figure is the root", () => {
  afterEach(() => jest.resetAllMocks());

  const wired = {
    charts: [FIGURE],
    scripts: [SCRIPT],
    datasets: [{ id: "d0", readme: "Cryogenic spectra" }],
    tools: [{ id: "t0", packageName: "numpy" }],
    heads: [{ id: "h0", label: "Materials Project" }],
    workflow: {
      nodes: [],
      edges: [
        { from: "s0", to: "c0", type: "generates" },
        { from: "d0", to: "s0", type: "consumes" },
        { from: "t0", to: "s0", type: "uses_tool" },
        { from: "h0", to: "c0", type: "consumes" },
      ],
    },
  };

  it("shows what generated the figure and what that used", () => {
    renderWorkspace(wired);
    const figure = screen.getByTestId("fw-figure-c0");
    expect(figure).toHaveTextContent("Density of states");
    expect(figure).toHaveTextContent(/generated by:/i);
    expect(figure).toHaveTextContent("plot_dos.py");
    expect(figure).toHaveTextContent(/uses tool:/i);
    expect(figure).toHaveTextContent("numpy");
    expect(figure).toHaveTextContent("Cryogenic spectra");
  });

  it("shows data used by the figure directly", () => {
    renderWorkspace(wired);
    expect(screen.getByTestId("fw-figure-c0")).toHaveTextContent(
      "Materials Project"
    );
  });

  it("offers Edit and Remove on the figure", () => {
    renderWorkspace(wired);
    const figure = screen.getByTestId("fw-figure-c0");
    expect(within(figure).getByTestId("fw-edit-c0")).toBeInTheDocument();
    expect(within(figure).getByTestId("fw-remove-c0")).toBeInTheDocument();
  });

  it("says so plainly when there are no figures yet", () => {
    renderWorkspace();
    expect(screen.getByText(/no figures yet/i)).toBeInTheDocument();
  });
});

describe("contextual creation", () => {
  afterEach(() => jest.resetAllMocks());

  it.each([
    ["script", "fw-add-script-for-c0"],
    ["dataset", "fw-add-dataset-for-c0"],
    ["head", "fw-add-head-for-c0"],
  ])("on a figure, + %s opens the real form", async (type, testId) => {
    const helpers = buildHelpers();
    renderWorkspace({ charts: [FIGURE] }, helpers);
    await user().click(screen.getByTestId(testId));

    expect(helpers.setDefault).toHaveBeenCalledWith(type, null);
    if (type === "head") {
      expect(helpers.setExternalNodeFormOpen).toHaveBeenCalledWith(true);
    } else {
      expect(helpers.openForm).toHaveBeenCalledWith(type);
    }
  });

  it("creates Script -> Figure only AFTER the form saves", async () => {
    const ctx = renderWorkspace({ charts: [FIGURE] });
    await user().click(screen.getByTestId("fw-add-script-for-c0"));
    // The form is open; nothing has been saved, so nothing is connected.
    expect(ctx.addEdge).not.toHaveBeenCalled();

    // The form saves and the script appears.
    ctx.rerenderWith({ charts: [FIGURE], scripts: [SCRIPT] });

    expect(ctx.addEdge).toHaveBeenCalledWith({
      from: "s0",
      to: "c0",
      type: "generates",
    });
  });

  it("creates Dataset -> Script as consumes after save", async () => {
    const ctx = renderWorkspace({
      charts: [FIGURE],
      scripts: [SCRIPT],
      workflow: { nodes: [], edges: [{ from: "s0", to: "c0", type: "generates" }] },
    });
    await user().click(screen.getByTestId("fw-add-dataset-for-s0"));
    ctx.rerenderWith({
      charts: [FIGURE],
      scripts: [SCRIPT],
      datasets: [{ id: "d0", readme: "spectra" }],
      workflow: { nodes: [], edges: [{ from: "s0", to: "c0", type: "generates" }] },
    });

    expect(ctx.addEdge).toHaveBeenCalledWith({
      from: "d0",
      to: "s0",
      type: "consumes",
    });
  });

  it("creates Tool -> Script as uses_tool after save", async () => {
    const ctx = renderWorkspace({
      charts: [FIGURE],
      scripts: [SCRIPT],
      workflow: { nodes: [], edges: [{ from: "s0", to: "c0", type: "generates" }] },
    });
    await user().click(screen.getByTestId("fw-add-tool-for-s0"));
    ctx.rerenderWith({
      charts: [FIGURE],
      scripts: [SCRIPT],
      tools: [{ id: "t0", packageName: "numpy" }],
      workflow: { nodes: [], edges: [{ from: "s0", to: "c0", type: "generates" }] },
    });

    expect(ctx.addEdge).toHaveBeenCalledWith({
      from: "t0",
      to: "s0",
      type: "uses_tool",
    });
  });

  it("connects nothing when the form was cancelled", async () => {
    const ctx = renderWorkspace({ charts: [FIGURE] });
    await user().click(screen.getByTestId("fw-add-script-for-c0"));
    // Cancel: the list never grows.
    ctx.rerenderWith({ charts: [FIGURE] });
    expect(ctx.addEdge).not.toHaveBeenCalled();
  });
});

describe("attach existing", () => {
  afterEach(() => jest.resetAllMocks());

  const paper = {
    charts: [FIGURE],
    scripts: [SCRIPT],
    datasets: [{ id: "d0", readme: "spectra" }],
  };

  it("offers only legal, not-yet-connected resources", async () => {
    renderWorkspace(paper);
    await user().click(screen.getByTestId("fw-attach-toggle-c0"));
    const panel = screen.getByTestId("fw-attach-c0");
    expect(within(panel).getByTestId("fw-attach-c0-s0")).toBeInTheDocument();
    expect(within(panel).getByTestId("fw-attach-c0-d0")).toBeInTheDocument();
    expect(within(panel).queryByTestId("fw-attach-c0-c0")).not.toBeInTheDocument();
  });

  it("connects without duplicating the artifact", async () => {
    const ctx = renderWorkspace(paper);
    await user().click(screen.getByTestId("fw-attach-toggle-c0"));
    await user().click(screen.getByTestId("fw-attach-c0-s0"));

    expect(ctx.addEdge).toHaveBeenCalledWith({
      from: "s0",
      to: "c0",
      type: "generates",
    });
    // No form was opened, so no second artifact could be created.
    expect(ctx.helpers.openForm).not.toHaveBeenCalled();
  });

  it("lets one dataset serve a second script", async () => {
    const ctx = renderWorkspace({
      charts: [FIGURE],
      scripts: [SCRIPT, { id: "s1", readme: "fit.py" }],
      datasets: [{ id: "d0", readme: "spectra" }],
      workflow: { nodes: [], edges: [{ from: "d0", to: "s0", type: "consumes" }] },
    });
    await user().click(screen.getByTestId("fw-attach-toggle-s1"));
    await user().click(screen.getByTestId("fw-attach-s1-d0"));

    expect(ctx.addEdge).toHaveBeenCalledWith({
      from: "d0",
      to: "s1",
      type: "consumes",
    });
    expect(ctx.helpers.openForm).not.toHaveBeenCalled();
  });

  it("stops offering a resource once it is attached", async () => {
    renderWorkspace({
      ...paper,
      workflow: { nodes: [], edges: [{ from: "s0", to: "c0", type: "generates" }] },
    });
    await user().click(screen.getByTestId("fw-attach-toggle-c0"));
    const panel = screen.getByTestId("fw-attach-c0");
    expect(within(panel).queryByTestId("fw-attach-c0-s0")).not.toBeInTheDocument();
  });
});

describe("editing from a row", () => {
  afterEach(() => jest.resetAllMocks());

  it("opens the artifact's own form seeded with the record", async () => {
    const helpers = buildHelpers();
    renderWorkspace(
      {
        charts: [FIGURE],
        scripts: [SCRIPT],
        workflow: { nodes: [], edges: [{ from: "s0", to: "c0", type: "generates" }] },
      },
      helpers
    );
    await user().click(screen.getByTestId("fw-edit-s0"));
    expect(helpers.setDefault).toHaveBeenCalledWith("script", SCRIPT);
    expect(helpers.openForm).toHaveBeenCalledWith("script");
  });

  it("shows the updated label after the artifact changes", () => {
    const ctx = renderWorkspace({ charts: [FIGURE] });
    expect(screen.getByTestId("fw-figure-c0")).toHaveTextContent(
      "Density of states"
    );
    ctx.rerenderWith({ charts: [{ id: "c0", caption: "Renamed figure" }] });
    expect(screen.getByTestId("fw-figure-c0")).toHaveTextContent("Renamed figure");
  });

  it("removes the figure through the existing delete path", async () => {
    const ctx = renderWorkspace({ charts: [FIGURE] });
    await user().click(screen.getByTestId("fw-remove-c0"));
    expect(ctx.del).toHaveBeenCalledWith("chart", "c0");
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
  });

  it("offers adding a resource with no figure relationship", async () => {
    const helpers = buildHelpers();
    renderWorkspace({}, helpers);
    await user().click(screen.getByTestId("fw-add-dataset-for-"));
    expect(helpers.setDefault).toHaveBeenCalledWith("dataset", null);
  });

  it("says so when everything is connected", () => {
    renderWorkspace({
      charts: [FIGURE],
      scripts: [SCRIPT],
      workflow: { nodes: [], edges: [{ from: "s0", to: "c0", type: "generates" }] },
    });
    expect(screen.getByTestId("fw-unlinked")).toHaveTextContent(
      /everything is connected to a figure/i
    );
  });

  it("can attach an unlinked resource later", async () => {
    const ctx = renderWorkspace({
      charts: [FIGURE],
      datasets: [{ id: "d0", readme: "orphan data" }],
    });
    await user().click(screen.getByTestId("fw-attach-toggle-c0"));
    await user().click(screen.getByTestId("fw-attach-c0-d0"));
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
    expect(screen.getByTestId("fw-row-h0")).toHaveTextContent("Materials Project");
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
    expect(figure).toHaveTextContent(/connected to:/i);
    expect(figure).not.toHaveTextContent(/generated by:/i);
  });

  it("works on a paper with no workflow at all", () => {
    renderWorkspace({ charts: [FIGURE], scripts: [SCRIPT] });
    expect(screen.getByTestId("fw-figure-c0")).toBeInTheDocument();
    expect(screen.getByTestId("fw-unlinked")).toHaveTextContent("plot_dos.py");
  });
});

describe("advanced connections", () => {
  afterEach(() => jest.resetAllMocks());

  const wired = {
    charts: [FIGURE],
    scripts: [SCRIPT],
    workflow: { nodes: [], edges: [{ from: "s0", to: "c0", type: "generates" }] },
  };

  it("is closed until asked for", () => {
    renderWorkspace(wired);
    expect(screen.queryByTestId("fw-advanced-c0")).not.toBeInTheDocument();
    expect(screen.getByTestId("fw-advanced-toggle-c0")).toHaveAttribute(
      "aria-expanded",
      "false"
    );
  });

  it("unlinks exactly one edge", async () => {
    const ctx = renderWorkspace(wired);
    await user().click(screen.getByTestId("fw-advanced-toggle-c0"));
    await user().click(screen.getByTestId("fw-unlink-s0-c0"));
    expect(ctx.unlink).toHaveBeenCalledTimes(1);
    expect(ctx.unlink).toHaveBeenCalledWith("s0", "c0");
    expect(ctx.del).not.toHaveBeenCalled();
  });
});
