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
    await user().click(screen.getByTestId("fw-start-dataset"));
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

// EVIDENCE-BASED CONNECTION SUGGESTIONS.
//
// The rules themselves are proved in `workflowSuggestions.spec.js`. What
// matters here is the promise the UI makes: nothing is connected until the
// curator says so, and saying so once cannot happen twice.

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
      within(screen.getByTestId("fw-figure-c0")).getByText(/generated by:/i)
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
    // Attach existing, edit, remove and advanced all survive.
    expect(figure.getByTestId("fw-attach-toggle-c0")).toBeInTheDocument();
    expect(figure.getByTestId("fw-edit-c0")).toBeInTheDocument();
    expect(figure.getByTestId("fw-remove-c0")).toBeInTheDocument();
    expect(figure.getByTestId("fw-advanced-toggle-c0")).toBeInTheDocument();
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
    // "No figures yet" and "Everything is connected to a figure" are not
    // both true of the same paper.
    renderWorkspace();
    expect(screen.getByTestId("fw-unlinked")).not.toHaveTextContent(
      /everything is connected to a figure/i
    );
    expect(screen.getByTestId("fw-unlinked")).toHaveTextContent(/nothing here yet/i);
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
