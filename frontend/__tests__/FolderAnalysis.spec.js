import { useContext, useEffect, useState } from "react";
import {
  render,
  screen,
  waitFor,
  waitForElementToBeRemoved,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";

jest.mock("axios");
import axios from "axios";

import FolderAnalysis from "../components/CuratorElements/FolderAnalysis";
import CuratorState from "../Context/Curator/CuratorState";
import { missingRequired } from "../Utils/artifactFields";
import CuratorContext from "../Context/Curator/curatorContext";
import AlertContext from "../Context/Alert/alertContext";

const FOLDER = "https://notebook.rcc.uchicago.edu/files/10.1021.acs.jpcc.5c01077";

const analysis = {
  root: FOLDER,
  truncated: false,
  warnings: [],
  counts: { files: 12, directories: 8 },
  candidates: {
    charts: [
      {
        id: "chart-0",
        kind: "chart",
        label: "figure1.png",
        file_count: 1,
        confidence: "high",
        evidence: [
          "figures/figure1.png is a .png image",
          "Filename hints (not metadata): figure",
        ],
        needs_input: ["caption", "number", "properties"],
        paths: ["figures/figure1.png"],
        proposal: {
          imageFile: "figures/figure1.png",
          files: [],
          notebookFile: "",
          number: "",
          caption: "",
          properties: [],
          extraFields: [],
        },
      },
    ],
    datasets: [
      {
        id: "dataset-0",
        kind: "dataset",
        label: "short_traj",
        file_count: 2,
        confidence: "medium",
        evidence: ["2 data file(s) in data/short_traj"],
        needs_input: ["readme"],
        paths: ["data/short_traj/traj_1.xyz", "data/short_traj/traj_2.xyz"],
        proposal: {
          files: ["data/short_traj/traj_1.xyz", "data/short_traj/traj_2.xyz"],
          readme: "",
          URLs: [],
          extraFields: [],
        },
      },
    ],
    scripts: [
      {
        id: "script-0",
        kind: "script",
        label: "plot_vdos.py",
        file_count: 1,
        confidence: "high",
        evidence: [
          "scripts/plot_vdos.py is a .py script",
          "Header/docstring found (shown as evidence, not copied into the " +
            "description): Plot the vibrational density of states.",
        ],
        needs_input: ["readme"],
        paths: ["scripts/plot_vdos.py"],
        proposal: {
          files: ["scripts/plot_vdos.py"],
          readme: "",
          URLs: [],
          extraFields: [],
        },
      },
    ],
    tools: [
      {
        id: "tool-0",
        kind: "tool",
        label: "numpy 1.26.4",
        file_count: 1,
        confidence: "high",
        evidence: ["numpy 1.26.4 pinned in requirements.txt"],
        needs_input: ["description"],
        paths: ["requirements.txt"],
        proposal: {
          kind: "software",
          packageName: "numpy",
          version: "1.26.4",
          executableName: "",
          patches: [],
          description: "",
          urls: "",
          extraFields: [],
        },
      },
    ],
    unclassified: [],
    unclassified_total: 1,
    grouped_unclassified: [
      {
        path: "",
        name: "folder root",
        file_count: 1,
        extensions: [".md"],
        sample_names: ["README.md"],
      },
    ],
    boundary_trees: {},
    applied_boundaries: {},
    possible_dependencies: ["ase"],
  },
};

const renderWith = (context = {}) => {
  const addMany = jest.fn();
  const setAlert = jest.fn();
  render(
    <AlertContext.Provider value={{ setAlert }}>
      <CuratorContext.Provider
        value={{ fileServerPath: FOLDER, addMany, ...context }}
      >
        <FolderAnalysis />
      </CuratorContext.Provider>
    </AlertContext.Provider>
  );
  return { addMany, setAlert };
};

const analyzeButton = () =>
  screen.getByRole("button", { name: /analyze rcc folder/i });

const openAnalysis = async (user) => {
  await user.click(analyzeButton());
  await screen.findByRole("tab", { name: /charts \(1\)/i });
};

describe("Analyze RCC Folder", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    axios.post.mockResolvedValue({ data: analysis });
  });

  it("is unavailable until a folder is selected, and sends nothing", () => {
    renderWith({ fileServerPath: "" });
    const button = analyzeButton();
    expect(button).toBeDisabled();
    // The reason rides on the trigger as a tooltip, so the button can sit in
    // a tight action row without a sentence beside it.
    expect(
      screen.getByLabelText(/pick a file server folder first/i)
    ).toBeInTheDocument();
    expect(axios.post).not.toHaveBeenCalled();
  });

  it("an explicit empty path wins over a saved one (nothing picked yet)", () => {
    // The File Server form passes its own selection, so a stale saved path
    // can never be analyzed behind the curator's back.
    render(
      <AlertContext.Provider value={{ setAlert: jest.fn() }}>
        <CuratorContext.Provider
          value={{ fileServerPath: FOLDER, addMany: jest.fn() }}
        >
          <FolderAnalysis path="" />
        </CuratorContext.Provider>
      </AlertContext.Provider>
    );
    expect(analyzeButton()).toBeDisabled();
    expect(axios.post).not.toHaveBeenCalled();
  });

  it("analyzes the SAVED path only — no second URL input exists", async () => {
    const user = userEvent.setup();
    renderWith();
    // The component offers no way to type a different location.
    expect(screen.queryByRole("textbox")).toBeNull();

    await openAnalysis(user);
    expect(axios.post).toHaveBeenCalledWith("/api/curation/analyze-folder", {
      path: FOLDER,
    });
  });

  it("renders each kind in its own group with a compact summary", async () => {
    const user = userEvent.setup();
    renderWith();
    await openAnalysis(user);

    expect(screen.getByRole("tab", { name: /datasets \(1\)/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /scripts \(1\)/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /tools \(1\)/i })).toBeInTheDocument();
    expect(
      screen.getByRole("tab", { name: /unclassified \(1\)/i })
    ).toBeInTheDocument();

    expect(screen.getByTestId("confidence-chart-0")).toHaveTextContent(
      "High evidence"
    );
    expect(
      screen.getByRole("checkbox", { name: /select figure1\.png/i })
    ).toBeInTheDocument();
    // The needs-input chip is a short badge; the field list is its tooltip.
    expect(
      screen.getByText(/^\d+ required fields? missing$/i)
    ).toBeInTheDocument();
  });

  it("uses compact labels per kind and keeps full paths under Details", async () => {
    const user = userEvent.setup();
    renderWith();
    await openAnalysis(user);

    // A short name in the header; the exact path stays in Details.
    expect(screen.getByText("figure1.png")).toBeInTheDocument();
    expect(screen.queryByText(/figure1\.png is a \.png image/i)).toBeNull();

    await user.click(screen.getByRole("button", { name: /^details$/i }));
    // The exact relative path and the evidence live here.
    expect(
      await screen.findByText(/figures\/figure1\.png is a \.png image/i)
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Files: figures\/figure1\.png/i)
    ).toBeInTheDocument();
  });

  it("labels scripts, datasets and tools compactly too", async () => {
    const user = userEvent.setup();
    renderWith();
    await openAnalysis(user);

    await user.click(screen.getByRole("tab", { name: /scripts \(1\)/i }));
    // Basename first, parent directory as secondary text.
    expect(screen.getByText("plot_vdos.py · 1 file")).toBeInTheDocument();
    expect(screen.getByText("scripts")).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: /datasets \(1\)/i }));
    expect(screen.getByText("short_traj · 2 files")).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: /tools \(1\)/i }));
    expect(screen.getByText("numpy 1.26.4")).toBeInTheDocument();
  });

  it("does not render editable fields for unselected candidates", async () => {
    const user = userEvent.setup();
    renderWith();
    await openAnalysis(user);

    // A compact card: no six empty inputs sitting there by default.
    expect(screen.queryByLabelText(/^figure caption ?\*?$/i)).toBeNull();
    expect(screen.queryByLabelText(/^figure image ?\*?$/i)).toBeNull();
    expect(screen.queryAllByRole("textbox")).toHaveLength(0);

    // Selecting reveals them...
    await user.click(
      screen.getByRole("checkbox", { name: /select figure1\.png/i })
    );
    expect(await screen.findByLabelText(/^figure caption ?\*?$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^figure image ?\*?$/i)).toBeInTheDocument();
    expect(
      screen.getAllByText(/required before save\/update and publish/i).length
    ).toBeGreaterThan(0);
  });

  it("Edit proposal opens the fields without selecting the candidate", async () => {
    const user = userEvent.setup();
    renderWith();
    await openAnalysis(user);

    await user.click(screen.getByRole("button", { name: /edit proposal/i }));

    expect(await screen.findByLabelText(/^figure caption ?\*?$/i)).toBeInTheDocument();
    expect(
      screen.getByRole("checkbox", { name: /select figure1\.png/i })
    ).not.toBeChecked();
    expect(
      screen.getByRole("button", { name: /add selected items to curator/i })
    ).toBeDisabled();
  });

  it("keeps candidate actions in their own non-breaking action group", async () => {
    const user = userEvent.setup();
    renderWith();
    await openAnalysis(user);

    const actions = screen.getByTestId("actions-chart-0");
    // The three actions live together, so they wrap as one block rather than
    // the row tearing a label apart.
    ["Details", "Edit Proposal", "Remove"].forEach((label) => {
      expect(actions).toHaveTextContent(label);
    });
    // Multi-word labels must never break word by word.
    expect(
      screen.getByRole("button", { name: "Edit Proposal" })
    ).toHaveStyle("white-space: nowrap");
    // The group wraps its buttons onto another line rather than keeping the
    // full four-button width and pushing the card sideways.
    expect(actions).toHaveStyle("flex-wrap: wrap");
    expect(actions).toHaveStyle("min-width: 0");
  });

  it("separates the editable fields from the header with real spacing", async () => {
    const user = userEvent.setup();
    renderWith();
    await openAnalysis(user);

    // Closed by default...
    expect(screen.queryByTestId("fields-chart-0")).toBeNull();

    await user.click(screen.getByRole("button", { name: "Edit Proposal" }));
    const fields = await screen.findByTestId("fields-chart-0");
    // ...and when open it is a spaced grid, visually detached from the
    // header/evidence above (a divider precedes it).
    expect(fields.previousElementSibling).toHaveClass("MuiDivider-root");
    // The required note is stated ONCE, at the top of the dialog.
    expect(screen.getAllByTestId("required-note")).toHaveLength(1);
    expect(screen.getByLabelText(/^figure caption ?\*?$/i)).toBeInTheDocument();
  });

  it("labels evidence per field, not one badge for the whole card", async () => {
    axios.post.mockResolvedValue({
      data: {
        ...analysis,
        candidates: {
          ...analysis.candidates,
          charts: [
            {
              ...analysis.candidates.charts[0],
              field_evidence: {
                imageFile: "high",
                notebookFile: "medium",
                number: "needs_input",
                caption: "needs_input",
              },
            },
          ],
        },
      },
    });
    const user = userEvent.setup();
    renderWith();
    await openAnalysis(user);
    await user.click(screen.getByRole("button", { name: "Edit Proposal" }));

    // The detected path and the unverifiable figure number must not look
    // alike.
    expect(
      await screen.findByTestId("field-evidence-chart-0-imageFile")
    ).toHaveTextContent("High evidence");
    // A chip only appears on a field that HAS a value. An empty required
    // field is already marked by its asterisk and helper text; an empty
    // optional field says nothing at all.
    expect(
      screen.queryByTestId("field-evidence-chart-0-number")
    ).toBeNull();
    expect(
      screen.queryByTestId("field-evidence-chart-0-notebookFile")
    ).toBeNull();
    expect(
      screen.queryByTestId("field-evidence-chart-0-caption")
    ).toBeNull();
  });

  it("shows filename hints in Details, clearly marked as unverified", async () => {
    axios.post.mockResolvedValue({
      data: {
        ...analysis,
        candidates: {
          ...analysis.candidates,
          charts: [
            {
              ...analysis.candidates.charts[0],
              filename_hints: [
                "Detected from filename (not verified metadata): embedded",
                "Name-similar file, relationship not verified: data/f1.csv",
              ],
            },
          ],
        },
      },
    });
    const user = userEvent.setup();
    renderWith();
    await openAnalysis(user);

    // Not on the card by default.
    expect(screen.queryByTestId("hints-chart-0")).toBeNull();

    await user.click(screen.getByRole("button", { name: /^details$/i }));
    const hints = await screen.findByTestId("hints-chart-0");
    expect(hints).toHaveTextContent(/not verified metadata, never used as a/i);
    expect(hints).toHaveTextContent("embedded");
    expect(hints).toHaveTextContent("data/f1.csv");

    // And still not a field value.
    await user.click(screen.getByRole("button", { name: "Edit Proposal" }));
    // A chart's keywords are STORED in `properties` for compatibility, but
    // every surface calls them Keywords.
    expect(
      screen.getByLabelText(/^keywords/i, { selector: "input" })
    ).toHaveValue("");
  });

  it("a Low evidence candidate still shows its name and path", async () => {
    // Low confidence is about how sure we are it is a Chart — it must never
    // cost the candidate its identity.
    axios.post.mockResolvedValue({
      data: {
        ...analysis,
        candidates: {
          ...analysis.candidates,
          charts: [
            {
              ...analysis.candidates.charts[0],
              id: "chart-9",
              label: "fig9",
              file_count: 2,
              confidence: "low",
              paths: ["charts/fig9/panel_a.png", "charts/fig9/panel_b.png"],
              proposal: {
                ...analysis.candidates.charts[0].proposal,
                imageFile: "",
                files: [],
              },
            },
          ],
        },
      },
    });
    const user = userEvent.setup();
    renderWith();
    await openAnalysis(user);

    expect(screen.getByText("fig9")).toBeInTheDocument();
    expect(screen.getByTestId("confidence-chart-9")).toHaveTextContent(
      "Low evidence"
    );
    expect(
      screen.getByRole("checkbox", { name: /select fig9/i })
    ).toBeInTheDocument();
    // The exact path is reachable, on the header tooltip and in Details.
    expect(screen.getByText("fig9").closest("[title]")).toHaveAttribute(
      "title",
      "charts/fig9/panel_a.png"
    );
  });

  it("names each dataset after its own boundary, never the role root", async () => {
    axios.post.mockResolvedValue({
      data: {
        ...analysis,
        candidates: {
          ...analysis.candidates,
          datasets: [
            {
              ...analysis.candidates.datasets[0],
              id: "dataset-0",
              label: "DFT",
              file_count: 3,
              paths: ["data/DFT/Figure2/a.in"],
              proposal: { files: ["data/DFT"], readme: "", URLs: [],
                extraFields: [] },
            },
            {
              ...analysis.candidates.datasets[0],
              id: "dataset-1",
              label: "other",
              file_count: 1,
              paths: ["data/other/x.dat"],
              proposal: { files: ["data/other"], readme: "", URLs: [],
                extraFields: [] },
            },
            {
              ...analysis.candidates.datasets[0],
              id: "dataset-2",
              label: "loose.csv",
              file_count: 1,
              paths: ["data/loose.csv"],
              proposal: { files: ["data/loose.csv"], readme: "", URLs: [],
                extraFields: [] },
            },
          ],
        },
      },
    });
    const user = userEvent.setup();
    renderWith();
    await openAnalysis(user);
    await user.click(screen.getByRole("tab", { name: /datasets \(3\)/i }));

    // Three distinct names and three real counts — not "data · 1 file"
    // three times over.
    expect(screen.getByText("DFT · 3 files")).toBeInTheDocument();
    expect(screen.getByText("other · 1 file")).toBeInTheDocument();
    expect(screen.getByText("loose.csv · 1 file")).toBeInTheDocument();
    expect(screen.queryByText("data · 1 file")).toBeNull();
  });

  it("a nameless candidate is never rendered, selected, or added", async () => {
    axios.post.mockResolvedValue({
      data: {
        ...analysis,
        candidates: {
          ...analysis.candidates,
          datasets: [
            analysis.candidates.datasets[0],
            // Malformed: no label and no paths. It must not reach the UI.
            {
              id: "dataset-broken",
              kind: "dataset",
              label: "",
              file_count: 0,
              confidence: "low",
              evidence: [],
              needs_input: [],
              paths: [],
              proposal: { files: [], readme: "", URLs: [], extraFields: [] },
            },
          ],
        },
      },
    });
    const user = userEvent.setup();
    const { addMany } = renderWith();
    await openAnalysis(user);

    // The tab counts only what a curator can actually judge.
    expect(
      screen.getByRole("tab", { name: /datasets \(1\)/i })
    ).toBeInTheDocument();
    expect(screen.getAllByRole("checkbox")).toHaveLength(1);

    // Select everything on offer and apply: the broken one cannot ride along.
    await user.click(screen.getByRole("tab", { name: /datasets \(1\)/i }));
    await user.click(
      screen.getByRole("checkbox", { name: /select short_traj/i })
    );
    await user.click(
      screen.getByRole("button", { name: /add selected items to curator/i })
    );
    const [[, records]] = addMany.mock.calls;
    expect(records).toHaveLength(1);
    expect(JSON.stringify(records)).not.toContain("dataset-broken");
  });

  it("nothing is selected by default", async () => {
    const user = userEvent.setup();
    const { addMany } = renderWith();
    await openAnalysis(user);

    screen.getAllByRole("checkbox").forEach((box) => {
      expect(box).not.toBeChecked();
    });
    expect(
      screen.getByRole("button", { name: /add selected items to curator/i })
    ).toBeDisabled();
    expect(addMany).not.toHaveBeenCalled();
  });

  it("collapses a long list behind Show all, discarding nothing", async () => {
    const many = {
      ...analysis,
      candidates: {
        ...analysis.candidates,
        charts: Array.from({ length: 40 }, (unused, index) => ({
          ...analysis.candidates.charts[0],
          id: `chart-${index}`,
          label: `figure${index}.png`,
          // Later ones have weaker evidence, so they sort to the back.
          confidence: index < 5 ? "high" : "medium",
          paths: [`figures/figure${index}.png`],
          proposal: {
            ...analysis.candidates.charts[0].proposal,
            imageFile: `figures/figure${index}.png`,
          },
        })),
      },
    };
    axios.post.mockResolvedValue({ data: many });
    const user = userEvent.setup();
    renderWith();
    await user.click(analyzeButton());
    await screen.findByRole("tab", { name: /charts \(40\)/i });

    // The tab count is honest about the total; the list shows the first 25.
    expect(screen.getAllByRole("checkbox")).toHaveLength(25);
    // Strongest evidence leads.
    expect(screen.getAllByTestId(/^confidence-/)[0]).toHaveTextContent(
      "High evidence"
    );
    // And the rest are explicitly reachable, described as collapsed.
    expect(
      screen.getByText(/15 more with weaker evidence are collapsed, not discarded/i)
    ).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: /show all 40 candidates/i })
    );
    expect(screen.getAllByRole("checkbox")).toHaveLength(40);
    expect(
      screen.queryByRole("button", { name: /show all/i })
    ).toBeNull();
  });

  it("a selected candidate is never hidden by the collapse", async () => {
    const many = {
      ...analysis,
      candidates: {
        ...analysis.candidates,
        charts: Array.from({ length: 30 }, (unused, index) => ({
          ...analysis.candidates.charts[0],
          id: `chart-${index}`,
          label: `figure${index}.png`,
          paths: [`figures/figure${index}.png`],
          proposal: {
            ...analysis.candidates.charts[0].proposal,
            imageFile: `figures/figure${index}.png`,
          },
        })),
      },
    };
    axios.post.mockResolvedValue({ data: many });
    const user = userEvent.setup();
    renderWith();
    await user.click(analyzeButton());
    await screen.findByRole("tab", { name: /charts \(30\)/i });

    await user.click(screen.getByRole("button", { name: /show all 30/i }));
    await user.click(
      screen.getByRole("checkbox", { name: /select figure29\.png/i })
    );
    expect(screen.getAllByRole("checkbox")).toHaveLength(30);
  });

  it("renders grouped folder rows, never a raw path dump", async () => {
    axios.post.mockResolvedValue({
      data: {
        ...analysis,
        candidates: {
          ...analysis.candidates,
          unclassified: [],
          unclassified_total: 141,
          grouped_unclassified: [
            {
              path: "doc",
              name: "doc",
              file_count: 120,
              extensions: [".png", ".md"],
              sample_names: ["logo.png", "guide.md"],
            },
            {
              path: "misc",
              name: "misc",
              file_count: 21,
              extensions: [".dat"],
              sample_names: ["a.dat"],
            },
          ],
        },
      },
    });
    const user = userEvent.setup();
    renderWith();
    await openAnalysis(user);
    await user.click(screen.getByRole("tab", { name: /unclassified \(141\)/i }));

    // The full count is preserved so nothing looks silently discarded.
    expect(
      screen.getByText(/141 file\(s\) were not classified/i)
    ).toBeInTheDocument();
    // One row per folder, with its count and representative extensions.
    expect(screen.getByRole("button", { name: "doc (120)" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "misc (21)" })).toBeInTheDocument();
    expect(screen.getByText(".png .md")).toBeInTheDocument();

    // Names only after an explicit expansion, and only a bounded sample.
    expect(screen.queryByText("logo.png")).toBeNull();
    await user.click(screen.getByRole("button", { name: "doc (120)" }));
    expect(await screen.findByText("logo.png")).toBeInTheDocument();
    expect(screen.getByText(/and 118 more in this folder/i)).toBeInTheDocument();
  });

  it("filters folder rows and caps how many render at once", async () => {
    const rows = Array.from({ length: 30 }, (unused, index) => ({
      path: `f${String(index).padStart(2, "0")}`,
      name: `f${String(index).padStart(2, "0")}`,
      file_count: 2,
      extensions: [".txt"],
      sample_names: ["a.txt"],
    }));
    axios.post.mockResolvedValue({
      data: {
        ...analysis,
        candidates: {
          ...analysis.candidates,
          unclassified: [],
          unclassified_total: 60,
          grouped_unclassified: rows,
        },
      },
    });
    const user = userEvent.setup();
    renderWith();
    await openAnalysis(user);
    await user.click(screen.getByRole("tab", { name: /unclassified \(60\)/i }));

    // 25 rows initially, the rest behind an explicit action.
    expect(screen.getByRole("button", { name: "f24 (2)" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "f25 (2)" })).toBeNull();
    await user.click(
      screen.getByRole("button", { name: /show more \(5 more folders\)/i })
    );
    expect(screen.getByRole("button", { name: "f29 (2)" })).toBeInTheDocument();

    await user.type(
      screen.getByLabelText(/filter unclassified folders/i),
      "f03"
    );
    expect(screen.getByRole("button", { name: "f03 (2)" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "f04 (2)" })).toBeNull();
  });

  it("shows how the folder was read, and why", async () => {
    axios.post.mockResolvedValue({
      data: {
        ...analysis,
        structure_mode: "legacy",
        normalized_roles: { data: "datasets", figures_tables: "charts" },
        structure_issues: [
          {
            path: "figures_tables",
            reason:
              "Read as charts (Qresp Folder Standard name: charts). Nothing " +
              "on the file server is renamed.",
          },
        ],
      },
    });
    const user = userEvent.setup();
    renderWith();
    await openAnalysis(user);

    // The state is one short chip; the long explanation is one click away
    // instead of hanging off it.
    const badge = screen.getByTestId("structure-mode");
    expect(badge).toHaveTextContent("Legacy-compatible");
    expect(badge).not.toHaveTextContent(/Read as charts/);
    expect(screen.queryByTestId("folder-mapping")).toBeNull();

    await user.click(
      screen.getByRole("button", { name: /show folder mapping/i })
    );
    const mapping = await screen.findByTestId("folder-mapping");
    // Every legacy name, and what it was read as.
    expect(mapping).toHaveTextContent("data → datasets");
    expect(mapping).toHaveTextContent("figures_tables → charts");
    expect(mapping).toHaveTextContent(/figures_tables: Read as charts/);
    expect(mapping).toHaveTextContent(/Nothing on the file server is renamed/);
  });

  it("flags a folder that needs reorganizing", async () => {
    axios.post.mockResolvedValue({
      data: {
        ...analysis,
        structure_mode: "invalid",
        structure_issues: [
          { path: "mystery", reason: "Not a Qresp Folder Standard role." },
        ],
      },
    });
    const user = userEvent.setup();
    renderWith();
    await openAnalysis(user);
    expect(screen.getByTestId("structure-mode")).toHaveTextContent(
      "Needs reorganization"
    );
  });

  it("selects nothing by default and cannot apply until something is checked", async () => {
    const user = userEvent.setup();
    const { addMany } = renderWith();
    await openAnalysis(user);

    const box = screen.getByRole("checkbox", {
      name: /select figure1\.png/i,
    });
    expect(box).not.toBeChecked();
    const apply = screen.getByRole("button", {
      name: /add selected items to curator/i,
    });
    expect(apply).toBeDisabled();
    expect(addMany).not.toHaveBeenCalled();
  });

  it("applies only the selected candidates, with the curator's edits", async () => {
    // delay: null — see the note in the field-contract suite below.
    const user = userEvent.setup({ delay: null });
    const { addMany } = renderWith();
    await openAnalysis(user);

    await user.click(
      screen.getByRole("checkbox", { name: /select figure1\.png/i })
    );
    await user.type(screen.getByLabelText(/^figure caption ?\*?$/i), "Density of states");
    await user.click(
      screen.getByRole("button", { name: /add selected items to curator/i })
    );

    expect(addMany).toHaveBeenCalledTimes(1);
    expect(addMany).toHaveBeenCalledWith("chart", [
      expect.objectContaining({
        imageFile: "figures/figure1.png",
        caption: "Density of states",
        number: "",
        properties: [],
        files: [],
        notebookFile: "",
        extraFields: [],
      }),
    ]);
    // No id is invented client-side: the reducer mints collision-safe ids.
    expect(addMany.mock.calls[0][1][0]).not.toHaveProperty("id");
  });

  it("removed candidates cannot be applied", async () => {
    const user = userEvent.setup();
    const { addMany } = renderWith();
    await openAnalysis(user);

    await user.click(
      screen.getByRole("checkbox", { name: /select figure1\.png/i })
    );
    await user.click(screen.getByRole("button", { name: /^remove$/i }));
    expect(screen.getByRole("tab", { name: /charts \(0\)/i })).toBeInTheDocument();

    // Nothing selectable is left, so Apply is disabled again for charts.
    await user.click(screen.getByRole("tab", { name: /tools \(1\)/i }));
    await user.click(
      screen.getByRole("checkbox", { name: /select numpy 1\.26\.4/i })
    );
    await user.click(
      screen.getByRole("button", { name: /add selected items to curator/i })
    );
    const kinds = addMany.mock.calls.map((call) => call[0]);
    expect(kinds).toEqual(["tool"]);
  });

  it("maps tools to the manual Tool form's stored shape", async () => {
    const user = userEvent.setup();
    const { addMany } = renderWith();
    await openAnalysis(user);
    await user.click(screen.getByRole("tab", { name: /tools \(1\)/i }));
    await user.click(
      screen.getByRole("checkbox", { name: /select numpy 1\.26\.4/i })
    );
    await user.click(
      screen.getByRole("button", { name: /add selected items to curator/i })
    );

    expect(addMany).toHaveBeenCalledWith("tool", [
      {
        kind: "software",
        packageName: "numpy",
        version: "1.26.4",
        executableName: "",
        patches: [],
        description: "",
        urls: "",
        extraFields: [],
      },
    ]);
  });

  it("keeps dataset/script paths relative and FileTree-compatible", async () => {
    const user = userEvent.setup();
    const { addMany } = renderWith();
    await openAnalysis(user);
    await user.click(screen.getByRole("tab", { name: /datasets \(1\)/i }));
    await user.click(
      screen.getByRole("checkbox", { name: /select short_traj/i })
    );
    await user.click(
      screen.getByRole("button", { name: /add selected items to curator/i })
    );

    const [[, records]] = addMany.mock.calls;
    expect(records[0].files).toEqual([
      "data/short_traj/traj_1.xyz",
      "data/short_traj/traj_2.xyz",
    ]);
    records[0].files.forEach((path) => {
      expect(path.startsWith("/")).toBe(false);
      expect(path).not.toContain("://");
    });
  });

  it("never publishes or saves — applying only calls addMany", async () => {
    const user = userEvent.setup();
    renderWith();
    await openAnalysis(user);
    await user.click(
      screen.getByRole("checkbox", { name: /select figure1\.png/i })
    );
    await user.click(
      screen.getByRole("button", { name: /add selected items to curator/i })
    );

    const posted = axios.post.mock.calls.map((call) => call[0]);
    expect(posted).toEqual(["/api/curation/analyze-folder"]);
    expect(axios.put).not.toHaveBeenCalled();
  });

  it("cancel applies nothing", async () => {
    const user = userEvent.setup();
    const { addMany } = renderWith();
    await openAnalysis(user);
    await user.click(
      screen.getByRole("checkbox", { name: /select figure1\.png/i })
    );
    await user.click(screen.getByRole("button", { name: /^cancel$/i }));
    expect(addMany).not.toHaveBeenCalled();
  });

  it("shows a readable error instead of candidates when the folder is refused", async () => {
    axios.post.mockRejectedValue({
      response: {
        status: 400,
        data: {
          error:
            "That folder is outside the file server roots this Qresp server " +
            "is allowed to read.",
        },
      },
    });
    const user = userEvent.setup();
    const { addMany } = renderWith();
    await user.click(analyzeButton());
    expect(
      await screen.findByText(/outside the file server roots/i)
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /add selected items to curator/i })
    ).toBeDisabled();
    expect(addMany).not.toHaveBeenCalled();
  });

  it("says plainly that a truncated analysis is partial, and why", async () => {
    axios.post.mockResolvedValue({
      data: {
        ...analysis,
        truncated: true,
        counts: { files: 1971, directories: 260 },
        limits: {
          max_depth: 4,
          max_files: 2000,
          max_directory_listings: 120,
          max_evidence_files: 30,
        },
        warnings: ["Only the first 4 folder levels were inspected."],
      },
    });
    const user = userEvent.setup();
    renderWith();
    await openAnalysis(user);

    // Explicit and non-alarming: what was scanned, that limits stopped it,
    // and that the result is not the whole folder.
    expect(
      screen.getByText(/this is a partial view of the folder/i)
    ).toBeInTheDocument();
    const notice = screen
      .getByText(/this is a partial view of the folder/i)
      .closest(".MuiAlert-root");
    expect(notice).toHaveTextContent("1971 file(s) across 260 folder(s)");
    expect(notice).toHaveTextContent(/built-in safety limits/i);
    expect(notice).toHaveTextContent(/do not represent everything/i);
    // Not styled as an error — it is an expected, safe outcome.
    expect(notice).toHaveClass("MuiAlert-colorInfo");
    expect(notice.className).not.toMatch(/colorError|colorWarning/);
    // ONE summary alert, not one per warning.
    expect(screen.getAllByRole("alert")).toHaveLength(1);

    // The numbers and the specific reason are in the scan details, closed
    // until asked for.
    expect(screen.queryByTestId("scan-details")).toBeNull();
    await user.click(
      screen.getByRole("button", { name: /show scan details/i })
    );
    const details = await screen.findByTestId("scan-details");
    expect(details).toHaveTextContent("at most 4 folder levels, 2000 files");
    expect(details).toHaveTextContent("120 directory listings");
    expect(details).toHaveTextContent("30 manifest/script files");
    expect(details).toHaveTextContent(
      /only the first 4 folder levels were inspected/i
    );
  });

  it("shows import hints as hints, not as tools", async () => {
    const user = userEvent.setup();
    renderWith();
    await openAnalysis(user);
    await user.click(screen.getByRole("tab", { name: /tools \(1\)/i }));
    const hint = screen.getByText(/possible dependencies seen in script imports/i);
    expect(hint).toHaveTextContent("ase");
    expect(hint).toHaveTextContent(/not added as tools/i);
    expect(
      screen.queryByRole("checkbox", { name: /select ase/i })
    ).toBeNull();
  });
});

describe("type-specific RCC imports", () => {
  const TypedHarness = () => {
    const [cache, setCache] = useState({ path: "", data: null });
    const value = {
      fileServerPath: FOLDER,
      addMany: jest.fn(),
      rccAnalysisCache: cache,
      cacheRccAnalysis: (path, data) => setCache({ path, data }),
    };
    return (
      <AlertContext.Provider value={{ setAlert: jest.fn() }}>
        <CuratorContext.Provider value={value}>
          <FolderAnalysis artifactType="chart" />
          <FolderAnalysis artifactType="dataset" />
          <FolderAnalysis artifactType="script" />
          <FolderAnalysis artifactType="tool" />
        </CuratorContext.Provider>
      </AlertContext.Provider>
    );
  };

  beforeEach(() => {
    jest.clearAllMocks();
    axios.post.mockResolvedValue({ data: analysis });
  });

  it("offers one import action beside each artifact type", () => {
    render(<TypedHarness />);
    expect(
      screen.getByRole("button", { name: /import charts from rcc/i })
    ).toBeEnabled();
    expect(
      screen.getByRole("button", { name: /import datasets from rcc/i })
    ).toBeEnabled();
    expect(
      screen.getByRole("button", { name: /import scripts from rcc/i })
    ).toBeEnabled();
    expect(
      screen.getByRole("button", { name: /import tools from rcc/i })
    ).toBeEnabled();
    expect(
      screen.queryByRole("button", { name: /analyze rcc folder/i })
    ).toBeNull();
  });

  it("shows only the requested type and reuses the runtime scan", async () => {
    const user = userEvent.setup();
    render(<TypedHarness />);

    await user.click(
      screen.getByRole("button", { name: /import charts from rcc/i })
    );
    expect(
      await screen.findByRole("heading", { name: /import charts from rcc/i })
    ).toBeInTheDocument();
    expect(screen.queryByRole("tab")).toBeNull();
    expect(screen.getByText("figure1.png")).toBeInTheDocument();
    expect(screen.queryByText("short_traj")).toBeNull();
    expect(axios.post).toHaveBeenCalledTimes(1);

    const chartDialog = screen.getByRole("dialog", {
      name: /import charts from rcc/i,
    });
    await user.click(screen.getByRole("button", { name: /^cancel$/i }));
    await waitForElementToBeRemoved(chartDialog);
    await user.click(
      screen.getByRole("button", { name: /import datasets from rcc/i })
    );
    expect(
      await screen.findByRole("heading", { name: /import datasets from rcc/i })
    ).toBeInTheDocument();
    expect(screen.getAllByText(/short_traj/i).length).toBeGreaterThan(0);
    expect(screen.queryByText("figure1.png")).toBeNull();
    expect(axios.post).toHaveBeenCalledTimes(1);
  });

  it("requires a saved file server path", () => {
    render(
      <AlertContext.Provider value={{ setAlert: jest.fn() }}>
        <CuratorContext.Provider
          value={{ fileServerPath: "", addMany: jest.fn() }}
        >
          <FolderAnalysis artifactType="chart" />
        </CuratorContext.Provider>
      </AlertContext.Provider>
    );
    expect(
      screen.getByRole("button", { name: /import charts from rcc/i })
    ).toBeDisabled();
    expect(axios.post).not.toHaveBeenCalled();
  });
});

describe("Analyze RCC Folder — record boundaries", () => {
  const legacy = {
    ...analysis,
    structure_mode: "legacy",
    boundary_trees: {
      data: {
        role: "datasets",
        nodes: [
          { path: "data/DFT", name: "DFT", level: 1, file_count: 12,
            extensions: [".in"], sample_names: [] },
          { path: "data/DFT/Figure2", name: "Figure2", level: 2,
            file_count: 8, extensions: [".in"], sample_names: [] },
          { path: "data/other", name: "other", level: 1, file_count: 3,
            extensions: [".dat"], sample_names: [] },
        ],
      },
    },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    axios.post.mockResolvedValue({ data: legacy });
  });

  const openPicker = async (user) => {
    await openAnalysis(user);
    await user.click(
      screen.getByRole("button", { name: /choose record boundaries/i })
    );
    return screen.findByTestId("boundary-picker");
  };

  it("explains the choice and starts with nothing selected", async () => {
    const user = userEvent.setup();
    renderWith();
    await openPicker(user);

    expect(
      screen.getByText(/one selected folder becomes one proposed dataset or/i)
    ).toBeInTheDocument();
    expect(
      screen.getByText(/nothing on the file server is changed/i)
    ).toBeInTheDocument();
    screen
      .getAllByRole("checkbox", { name: /use data\//i })
      .forEach((box) => expect(box).not.toBeChecked());
    // Rebuild is pointless until something is chosen.
    expect(
      screen.getByRole("button", { name: /rebuild proposals/i })
    ).toBeDisabled();
  });

  it("selecting a parent excludes its descendants", async () => {
    const user = userEvent.setup();
    renderWith();
    await openPicker(user);

    await user.click(
      screen.getByRole("checkbox", { name: "Use data/DFT as one record" })
    );
    // The child can no longer be chosen at the same time.
    expect(
      screen.getByRole("checkbox", { name: "Use data/DFT/Figure2 as one record" })
    ).toBeDisabled();
    // An unrelated sibling stays available.
    expect(
      screen.getByRole("checkbox", { name: "Use data/other as one record" })
    ).toBeEnabled();
  });

  it("selecting a child excludes its ancestor", async () => {
    const user = userEvent.setup();
    renderWith();
    await openPicker(user);

    await user.click(
      screen.getByRole("checkbox", { name: "Use data/DFT/Figure2 as one record" })
    );
    expect(
      screen.getByRole("checkbox", { name: "Use data/DFT as one record" })
    ).toBeDisabled();
  });

  it("choosing the parent after the child replaces it", async () => {
    const user = userEvent.setup();
    renderWith();
    await openPicker(user);

    const child = screen.getByRole("checkbox", {
      name: "Use data/DFT/Figure2 as one record",
    });
    await user.click(child);
    await user.click(child); // unselect
    await user.click(
      screen.getByRole("checkbox", { name: "Use data/DFT as one record" })
    );
    expect(child).toBeDisabled();
  });

  it("rebuilds through the BACKEND with the chosen boundaries", async () => {
    const user = userEvent.setup();
    renderWith();
    await openPicker(user);

    await user.click(
      screen.getByRole("checkbox", { name: "Use data/DFT/Figure2 as one record" })
    );
    await user.click(
      screen.getByRole("button", { name: /rebuild proposals/i })
    );

    await waitFor(() => expect(axios.post).toHaveBeenCalledTimes(2));
    expect(axios.post.mock.calls[1][1]).toEqual({
      path: FOLDER,
      boundaries: { data: ["data/DFT/Figure2"] },
    });
    // The first analysis carried no boundaries: defaults are the default.
    expect(axios.post.mock.calls[0][1]).toEqual({ path: FOLDER });
  });

  it("Use default boundaries clears the choice and re-analyzes", async () => {
    const user = userEvent.setup();
    renderWith();
    await openPicker(user);

    await user.click(
      screen.getByRole("checkbox", { name: "Use data/DFT as one record" })
    );
    await user.click(
      screen.getByRole("button", { name: /use default boundaries/i })
    );
    await waitFor(() => expect(axios.post).toHaveBeenCalledTimes(2));
    expect(axios.post.mock.calls[1][1]).toEqual({ path: FOLDER });
  });

  it("shows the REAL relative path, spelling and case preserved", async () => {
    axios.post.mockResolvedValue({
      data: {
        ...analysis,
        structure_mode: "legacy",
        normalized_roles: { Datasets: "datasets", Scripts: "scripts" },
        boundary_trees: {
          Datasets: {
            role: "datasets",
            nodes: [
              { path: "Datasets/Run_A", name: "Run_A", level: 1,
                file_count: 4, extensions: [".csv"], sample_names: [] },
            ],
          },
        },
      },
    });
    const user = userEvent.setup();
    renderWith();
    await openPicker(user);

    // The path a boundary must be submitted with, not a prettified name.
    expect(screen.getByText("Datasets/Run_A (4 files)")).toBeInTheDocument();
    expect(
      screen.getByRole("checkbox", { name: "Use Datasets/Run_A as one record" })
    ).toBeInTheDocument();
    expect(screen.getByText("Datasets → datasets")).toBeInTheDocument();
  });

  it("says so when a legacy root has nothing selectable", async () => {
    axios.post.mockResolvedValue({
      data: {
        ...analysis,
        structure_mode: "legacy",
        boundary_trees: { scripts: { role: "scripts", nodes: [] } },
      },
    });
    const user = userEvent.setup();
    renderWith();
    await openPicker(user);

    // Explicit guidance beats a silently hidden control.
    expect(screen.getByTestId("no-boundaries-scripts")).toHaveTextContent(
      /no selectable dataset\/script boundaries were found in scripts/i
    );
    expect(
      screen.getByRole("button", { name: /rebuild proposals/i })
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: /use default boundaries/i })
    ).toBeEnabled();
  });

  it("a standard layout is never asked to pick boundaries", async () => {
    axios.post.mockResolvedValue({
      data: {
        ...analysis,
        structure_mode: "standard",
        // Even if a tree were present, standard layouts do not choose.
        boundary_trees: {
          datasets: { role: "datasets", nodes: [
            { path: "datasets/d1", name: "d1", level: 1, file_count: 1,
              extensions: [".csv"], sample_names: [] },
          ] },
        },
      },
    });
    const user = userEvent.setup();
    renderWith();
    await openAnalysis(user);
    expect(screen.queryByTestId("boundary-picker")).toBeNull();
  });
});

describe("Analyze RCC Folder — capitalized legacy folders", () => {
  // The reported staging screen: Datasets/ Figures/ Scripts/ showed no
  // Legacy-compatible badge, no selector, and three identical
  // "Datasets · 1 file" rows.
  const capitalized = {
    ...analysis,
    structure_mode: "legacy",
    normalized_roles: {
      Datasets: "datasets",
      Figures: "charts",
      Scripts: "scripts",
    },
    structure_issues: [
      { path: "Datasets", reason: "Read as datasets (Qresp Folder Standard name: datasets). Nothing on the file server is renamed." },
    ],
    boundary_trees: {
      Datasets: {
        role: "datasets",
        nodes: [
          { path: "Datasets/Run_A", name: "Run_A", level: 1, file_count: 2,
            extensions: [".csv"], sample_names: [] },
        ],
      },
      Scripts: { role: "scripts", nodes: [] },
    },
    applied_boundaries: {},
    candidates: {
      ...analysis.candidates,
      datasets: [
        { id: "dataset-0", kind: "dataset", label: "Run_A", file_count: 2,
          confidence: "medium", evidence: [], needs_input: ["readme"],
          paths: ["Datasets/Run_A/a.csv", "Datasets/Run_A/a2.csv"],
          proposal: { files: ["Datasets/Run_A"], readme: "", URLs: [],
            extraFields: [] } },
        { id: "dataset-1", kind: "dataset", label: "Run_B", file_count: 1,
          confidence: "medium", evidence: [], needs_input: ["readme"],
          paths: ["Datasets/Run_B/b.csv"],
          proposal: { files: ["Datasets/Run_B"], readme: "", URLs: [],
            extraFields: [] } },
        { id: "dataset-2", kind: "dataset", label: "loose.csv",
          file_count: 1, confidence: "medium", evidence: [],
          needs_input: ["readme"], paths: ["Datasets/loose.csv"],
          proposal: { files: ["Datasets/loose.csv"], readme: "", URLs: [],
            extraFields: [] } },
      ],
    },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    axios.post.mockResolvedValue({ data: capitalized });
  });

  it("shows the Legacy-compatible state and the boundary controls", async () => {
    const user = userEvent.setup();
    renderWith();
    await openAnalysis(user);

    expect(screen.getByTestId("structure-mode")).toHaveTextContent(
      "Legacy-compatible"
    );
    await user.click(
      screen.getByRole("button", { name: /choose record boundaries/i })
    );
    expect(await screen.findByTestId("boundary-picker")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /rebuild proposals/i })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /use default boundaries/i })
    ).toBeInTheDocument();
    // Real spelling and case, and the empty root explains itself.
    expect(screen.getByText("Datasets/Run_A (2 files)")).toBeInTheDocument();
    expect(screen.getByTestId("no-boundaries-Scripts")).toBeInTheDocument();
  });

  it("gives each dataset its own name and count", async () => {
    const user = userEvent.setup();
    renderWith();
    await openAnalysis(user);
    await user.click(screen.getByRole("tab", { name: /datasets \(3\)/i }));

    expect(screen.getByText("Run_A · 2 files")).toBeInTheDocument();
    expect(screen.getByText("Run_B · 1 file")).toBeInTheDocument();
    expect(screen.getByText("loose.csv · 1 file")).toBeInTheDocument();
    // The regression: the role root repeated for every row.
    expect(screen.queryByText("Datasets · 1 file")).toBeNull();
    expect(screen.queryByText("Datasets · 2 files")).toBeNull();
  });

  it("rebuilds with a capitalized boundary path", async () => {
    const user = userEvent.setup();
    renderWith();
    await openAnalysis(user);
    await user.click(
      screen.getByRole("button", { name: /choose record boundaries/i })
    );
    await user.click(
      await screen.findByRole("checkbox", {
        name: "Use Datasets/Run_A as one record",
      })
    );
    await user.click(
      screen.getByRole("button", { name: /rebuild proposals/i })
    );

    await waitFor(() => expect(axios.post).toHaveBeenCalledTimes(2));
    expect(axios.post.mock.calls[1][1]).toEqual({
      path: FOLDER,
      boundaries: { Datasets: ["Datasets/Run_A"] },
    });
  });
});

describe("Analyze RCC Folder — needs reorganization", () => {
  const invalid = {
    ...analysis,
    structure_mode: "invalid",
    structure_issues: [
      {
        path: "mystery_stuff",
        reason:
          "Not a Qresp Folder Standard role (datasets, charts, scripts, " +
          "tools, docs) and not a layout Qresp recognizes.",
      },
    ],
    candidates: {
      charts: [],
      datasets: [],
      scripts: [],
      tools: [],
      unclassified: [],
      unclassified_total: 121,
      grouped_unclassified: [
        {
          path: "mystery_stuff",
          name: "mystery_stuff",
          file_count: 121,
          extensions: [".png", ".csv"],
          sample_names: ["a.png", "b.csv"],
          reason: "Not a Qresp Folder Standard role.",
        },
      ],
      boundary_trees: {},
      possible_dependencies: [],
    },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    axios.post.mockResolvedValue({ data: invalid });
  });

  it("warns, names the folder, and blocks adding anything", async () => {
    const user = userEvent.setup();
    const { addMany } = renderWith();
    await user.click(analyzeButton());
    await screen.findByTestId("structure-mode");

    const badge = screen.getByTestId("structure-mode");
    expect(badge).toHaveTextContent("Needs reorganization");
    // The reason is one click away rather than pasted onto the chip.
    await user.click(
      screen.getByRole("button", { name: /show folder mapping/i })
    );
    const mapping = await screen.findByTestId("folder-mapping");
    expect(mapping).toHaveTextContent(/mystery_stuff:/);
    expect(mapping).toHaveTextContent(/not a layout Qresp recognizes/i);

    // No candidate can be added while the layout cannot be read.
    expect(
      screen.getByRole("button", { name: /add selected items to curator/i })
    ).toBeDisabled();
    expect(addMany).not.toHaveBeenCalled();

    // Grouped summary only — no raw path paragraph.
    await user.click(screen.getByRole("tab", { name: /unclassified \(121\)/i }));
    expect(
      screen.getByRole("button", { name: "mystery_stuff (121)" })
    ).toBeInTheDocument();
    expect(screen.queryByText("a.png")).toBeNull();
  });

  it("offers no boundary picker for an unreadable layout", async () => {
    const user = userEvent.setup();
    renderWith();
    await user.click(analyzeButton());
    await screen.findByTestId("structure-mode");
    expect(screen.queryByTestId("boundary-picker")).toBeNull();
  });
});

describe("Analyze RCC Folder — consent-gated AI enhancement", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    axios.post.mockResolvedValue({ data: analysis });
  });

  // AI is per candidate now: the button lives on the card, and the Add
  // checkboxes no longer decide what gets described.
  const enhanceButton = (id = "chart-0") => screen.getByTestId(`enhance-${id}`);

  const consentBox = () =>
    screen.getByRole("checkbox", {
      name: /i agree to send this evidence to gemini for this request/i,
    });

  const sendButton = () =>
    screen.getByRole("button", { name: /send and get suggestions/i });

  // Opens the consent dialog for ONE candidate. Nothing is selected: the
  // Add checkbox and the AI action are separate concepts.
  const selectAndOpenConsent = async (user, tab, _name, id) => {
    if (tab) {
      await user.click(screen.getByRole("tab", { name: tab }));
    }
    // The candidate id follows the tab unless one is named explicitly.
    const target =
      id || (tab && String(tab).includes("script") ? "script-0" : "chart-0");
    // Open the fields so an accepted suggestion has somewhere visible to
    // land. Selecting the candidate is no longer required to enhance it.
    const edit = screen.queryAllByRole("button", { name: "Edit Proposal" });
    if (edit.length) await user.click(edit[0]);
    await user.click(enhanceButton(target));
    return screen.findByRole("heading", { name: /send .* to gemini\?/i });
  };

  const consentAndSend = async (user, reply) => {
    axios.post.mockResolvedValue({ data: reply });
    await user.click(consentBox());
    await user.click(sendButton());
  };

  it("is available per candidate, without selecting anything", async () => {
    const user = userEvent.setup();
    renderWith();
    await openAnalysis(user);

    // No Add checkbox needs ticking: the two concepts are separate.
    expect(enhanceButton("chart-0")).toBeEnabled();
    expect(
      screen.queryByRole("button", { name: /enhance selected with ai/i })
    ).toBeNull();
    // Only the analyze call has happened.
    expect(axios.post).toHaveBeenCalledTimes(1);
  });

  it("opens a consent dialog that sends nothing by itself", async () => {
    const user = userEvent.setup();
    renderWith();
    await openAnalysis(user);
    await selectAndOpenConsent(
      user, null, /select figure1\.png/i
    );

    // The dialog names the ONE candidate and the exact scope BEFORE
    // anything moves.
    expect(
      screen.getByRole("heading", { name: /send .*figure1\.png.* to gemini\?/i })
    ).toBeInTheDocument();
    expect(screen.getByTestId("ai-consent-fields")).toHaveTextContent(
      /caption and keywords/i
    );
    expect(
      screen.getByText(/relative paths, file names and folder names/i)
    ).toBeInTheDocument();
    expect(
      screen.getByText(/readme, docstring and dependency-manifest excerpts/i)
    ).toBeInTheDocument();
    expect(
      screen.getByText(/raw datasets, image bytes,\s*notebook contents, credentials/i)
    ).toBeInTheDocument();
    expect(
      screen.getByText(/nothing is filled in, added,\s*saved or published/i)
    ).toBeInTheDocument();

    // Unchecked by default, and the send action is blocked.
    expect(consentBox()).not.toBeChecked();
    expect(sendButton()).toBeDisabled();
    // Opening the dialog is not a request.
    expect(axios.post).toHaveBeenCalledTimes(1);
  });

  it("makes NO request when consent is refused", async () => {
    const user = userEvent.setup();
    renderWith();
    await openAnalysis(user);
    await selectAndOpenConsent(user, null, /select figure1\.png/i);

    await user.click(screen.getByRole("button", { name: /^cancel$/i }));

    expect(axios.post).toHaveBeenCalledTimes(1);
    expect(axios.post.mock.calls[0][0]).toBe("/api/curation/analyze-folder");
  });

  it("asks for consent again on every request — it is never remembered", async () => {
    const user = userEvent.setup();
    renderWith();
    await openAnalysis(user);
    await selectAndOpenConsent(user, null, /select figure1\.png/i);
    await consentAndSend(user, {
      suggestions: {
        "chart-0": { description: "d", keywords: [], confidence: "low" },
      },
    });
    await screen.findByTestId("ai-confidence-chart-0");

    // Second run: the box is unchecked again and send is blocked again.
    await user.click(enhanceButton());
    await screen.findByRole("heading", { name: /send .* to gemini\?/i });
    expect(consentBox()).not.toBeChecked();
    expect(sendButton()).toBeDisabled();
  });

  it("sends only the SELECTED candidates and only allowlisted evidence", async () => {
    const user = userEvent.setup();
    renderWith();
    await openAnalysis(user);
    await selectAndOpenConsent(
      user, /scripts \(1\)/i, /select plot_vdos\.py/i
    );
    await consentAndSend(user, {
      suggestions: {
        "script-0": {
          description: "Plots the VDOS.",
          keywords: ["VDOS"],
          confidence: "medium",
          reason: "module docstring",
        },
      },
    });
    await waitFor(() => expect(axios.post).toHaveBeenCalledTimes(2));

    const [url, body] = axios.post.mock.calls[1];
    expect(url).toBe("/api/curation/describe-candidates");
    expect(body.consent).toBe(true);
    expect(body.items).toHaveLength(1);
    const item = body.items[0];
    expect(Object.keys(item).sort()).toEqual([
      "context",
      "id",
      "kind",
      "name",
      "paths",
    ]);
    item.paths.forEach((path) => {
      expect(path.startsWith("/")).toBe(false);
      expect(path).not.toContain("://");
    });
    // Unselected candidates never travel.
    const serialized = JSON.stringify(body.items);
    expect(serialized).not.toContain("chart-0");
    expect(serialized).not.toContain("dataset-0");
    expect(serialized).not.toContain("tool-0");
    expect(serialized).not.toContain("README.md");
  });

  it("shows suggestions in a labelled AI area, applying nothing", async () => {
    const user = userEvent.setup();
    const { addMany } = renderWith();
    await openAnalysis(user);
    await selectAndOpenConsent(
      user, /scripts \(1\)/i, /select plot_vdos\.py/i
    );
    await consentAndSend(user, {
      suggestions: {
        "script-0": {
          description: "AI text",
          keywords: ["md"],
          confidence: "medium",
          reason: "module docstring",
        },
      },
    });

    // The label names the source and its own confidence, distinctly from
    // the deterministic evidence chip.
    const badge = await screen.findByTestId("ai-confidence-script-0");
    expect(badge).toHaveTextContent("AI suggestion: medium");
    expect(screen.getByTestId("ai-reason-script-0")).toHaveTextContent(
      /based on: module docstring/i
    );
    expect(screen.getByText(/not applied/i)).toBeInTheDocument();
    // Nothing was written into the form and nothing was added.
    expect(screen.getByLabelText(/^description ?\*?$/i)).toHaveValue("");
    expect(addMany).not.toHaveBeenCalled();
  });

  it("never shows a numeric percentage for AI confidence", async () => {
    const user = userEvent.setup();
    renderWith();
    await openAnalysis(user);
    await selectAndOpenConsent(
      user, /scripts \(1\)/i, /select plot_vdos\.py/i
    );
    await consentAndSend(user, {
      suggestions: {
        "script-0": { description: "d", keywords: [], confidence: "medium" },
      },
    });
    await screen.findByTestId("ai-confidence-script-0");
    // The dialog is portalled, so check the whole document.
    expect(document.body.textContent).not.toMatch(/\d+\s*%/);
    expect(document.body.textContent).toContain("AI suggestion: medium");
  });

  it("applies a suggestion only on explicit per-field acceptance", async () => {
    const user = userEvent.setup();
    const { addMany } = renderWith();
    await openAnalysis(user);
    await selectAndOpenConsent(
      user, /scripts \(1\)/i, /select plot_vdos\.py/i
    );
    await consentAndSend(user, {
      suggestions: {
        "script-0": {
          description: "AI text",
          keywords: ["md"],
          confidence: "low",
        },
      },
    });
    await screen.findByTestId("ai-confidence-script-0");

    expect(screen.getByLabelText(/^description ?\*?$/i)).toHaveValue("");
    await user.click(screen.getByRole("button", { name: /use as description/i }));
    expect(screen.getByLabelText(/^description ?\*?$/i)).toHaveValue("AI text");

    // Accepting is not adding: Curator state is still untouched.
    expect(addMany).not.toHaveBeenCalled();
  });

  it("refuses to overwrite a value the curator typed", async () => {
    const user = userEvent.setup();
    renderWith();
    await openAnalysis(user);
    await user.click(screen.getByRole("tab", { name: /scripts \(1\)/i }));
    await user.click(
      screen.getByRole("checkbox", { name: /select plot_vdos\.py/i })
    );
    await user.type(screen.getByLabelText(/^description ?\*?$/i), "Mine");
    await user.click(enhanceButton("script-0"));
    await screen.findByRole("heading", { name: /send .* to gemini\?/i });
    await consentAndSend(user, {
      suggestions: {
        "script-0": { description: "AI text", keywords: [], confidence: "low" },
      },
    });
    await screen.findByTestId("ai-confidence-script-0");

    // The suggestion is visible but cannot be applied over the user's text.
    expect(screen.getByText("AI text")).toBeInTheDocument();
    expect(screen.getByLabelText(/^description ?\*?$/i)).toHaveValue("Mine");
    expect(
      screen.getByRole("button", { name: /use as description/i })
    ).toBeDisabled();
    expect(
      screen.getByText(/your text is kept — clear the field to use this instead/i)
    ).toBeInTheDocument();
  });

  it("leaves every restricted factual field untouched", async () => {
    const user = userEvent.setup();
    renderWith();
    await openAnalysis(user);
    await selectAndOpenConsent(user, null, /select figure1\.png/i);
    await consentAndSend(user, {
      suggestions: {
        "chart-0": {
          description: "A nice figure",
          keywords: ["dft"],
          confidence: "medium",
          // A hostile/confused provider trying to set factual fields.
          number: 7,
          imageFile: "invented.png",
          notebookFile: "invented.ipynb",
          files: "invented.csv",
          packageName: "fake",
          version: "9.9",
        },
      },
    });
    await screen.findByTestId("ai-confidence-chart-0");

    expect(screen.getByLabelText(/^figure image ?\*?$/i)).toHaveValue(
      "figures/figure1.png"
    );
    expect(screen.getByLabelText(/figure number/i, { selector: "input" })).toHaveValue("");
    expect(screen.getByLabelText(/^reproduction notebook ?\*?$/i)).toHaveValue("");
    expect(
      screen.getByLabelText(/^input \/ supporting files/i)
    ).toHaveValue("");

    // Only caption/properties are offered, and only on request.
    await user.click(screen.getByRole("button", { name: /use as figure caption/i }));
    expect(screen.getByLabelText(/^figure caption ?\*?$/i)).toHaveValue("A nice figure");
    expect(screen.getByLabelText(/^figure image ?\*?$/i)).toHaveValue(
      "figures/figure1.png"
    );
    expect(screen.getByLabelText(/figure number/i, { selector: "input" })).toHaveValue("");
  });

  it("offers no keyword target where the record type has no keyword field", async () => {
    const user = userEvent.setup();
    renderWith();
    await openAnalysis(user);
    await selectAndOpenConsent(
      user, /scripts \(1\)/i, /select plot_vdos\.py/i
    );
    await consentAndSend(user, {
      suggestions: {
        "script-0": {
          description: "d",
          keywords: ["md", "water"],
          confidence: "low",
        },
      },
    });
    await screen.findByTestId("ai-confidence-script-0");

    expect(screen.getByText("md")).toBeInTheDocument();
    // A script stores keywords in its own field, so the suggestion has
    // somewhere to go and the dead-end message is gone.
    expect(
      screen.queryByText(/this record type has no keyword field/i)
    ).toBeNull();
    expect(
      screen.getByRole("button", { name: /use as keywords/i })
    ).toBeInTheDocument();
    // ...and never into a chart's properties.
    expect(
      screen.queryByRole("button", { name: /use as properties/i })
    ).toBeNull();
  });

  it("offers a kind second-opinion as a NOTE, never a reclassification", async () => {
    const unsure = {
      ...analysis,
      candidates: {
        ...analysis.candidates,
        scripts: [{ ...analysis.candidates.scripts[0], confidence: "medium" }],
      },
    };
    axios.post.mockResolvedValue({ data: unsure });
    const user = userEvent.setup();
    const { addMany } = renderWith();
    await user.click(analyzeButton());
    await screen.findByRole("tab", { name: /charts \(1\)/i });
    await selectAndOpenConsent(
      user, /scripts \(1\)/i, /select plot_vdos\.py/i
    );
    await consentAndSend(user, {
      suggestions: {
        "script-0": {
          description: "d",
          keywords: [],
          kind: "dataset",
          confidence: "low",
        },
      },
    });

    const note = await screen.findByTestId("ai-kind-script-0");
    expect(note).toHaveTextContent(/reads this more like a dataset/i);
    expect(note).toHaveTextContent(/nothing has been moved/i);
    expect(
      screen.getByRole("tab", { name: /scripts \(1\)/i })
    ).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /datasets \(1\)/i })).toBeInTheDocument();
    expect(addMany).not.toHaveBeenCalled();
  });

  it("stays quiet about kind when the deterministic evidence was strong", async () => {
    const user = userEvent.setup();
    renderWith();
    await openAnalysis(user);
    await selectAndOpenConsent(user, null, /select figure1\.png/i);
    await consentAndSend(user, {
      suggestions: {
        "chart-0": {
          description: "d",
          keywords: [],
          kind: "dataset",
          confidence: "low",
        },
      },
    });
    await screen.findByTestId("ai-confidence-chart-0");
    expect(screen.queryByTestId("ai-kind-chart-0")).toBeNull();
  });

  it("an AI response never adds, saves, or publishes on its own", async () => {
    const user = userEvent.setup();
    const { addMany, setAlert } = renderWith();
    await openAnalysis(user);
    await selectAndOpenConsent(user, null, /select figure1\.png/i);
    await consentAndSend(user, {
      suggestions: {
        "chart-0": { description: "x", keywords: [], confidence: "low" },
      },
    });
    await screen.findByTestId("ai-confidence-chart-0");

    expect(addMany).not.toHaveBeenCalled();
    expect(setAlert).not.toHaveBeenCalled();
    expect(axios.put).not.toHaveBeenCalled();
    expect(axios.post.mock.calls.map((call) => call[0])).toEqual([
      "/api/curation/analyze-folder",
      "/api/curation/describe-candidates",
    ]);
  });

  it("Add selected items to Curator still works after an AI review", async () => {
    const user = userEvent.setup();
    const { addMany } = renderWith();
    await openAnalysis(user);
    await selectAndOpenConsent(user, null, /select figure1\.png/i);
    await consentAndSend(user, {
      suggestions: {
        "chart-0": {
          description: "AI caption",
          keywords: [],
          confidence: "medium",
        },
      },
    });
    await screen.findByTestId("ai-confidence-chart-0");
    await user.click(screen.getByRole("button", { name: /use as figure caption/i }));

    // Enhancing does not select anything, so Add is chosen explicitly.
    await user.click(
      screen.getByRole("checkbox", { name: /select figure1\.png/i })
    );
    await user.click(
      screen.getByRole("button", { name: /add selected items to curator/i })
    );
    expect(addMany).toHaveBeenCalledWith("chart", [
      expect.objectContaining({
        imageFile: "figures/figure1.png",
        caption: "AI caption",
      }),
    ]);
  });

  it("enhances exactly one candidate while several stay selected",
     async () => {
    const many = {
      ...analysis,
      candidates: {
        ...analysis.candidates,
        charts: Array.from({ length: 3 }, (unused, index) => ({
          ...analysis.candidates.charts[0],
          id: `chart-${index}`,
          label: `figure${index}.png`,
          paths: [`figures/figure${index}.png`],
          proposal: {
            ...analysis.candidates.charts[0].proposal,
            imageFile: `figures/figure${index}.png`,
          },
        })),
      },
    };
    axios.post.mockResolvedValue({ data: many });
    const user = userEvent.setup();
    renderWith();
    await user.click(analyzeButton());
    await screen.findByRole("tab", { name: /charts \(3\)/i });

    // Three ticked for Add to Curator...
    for (let index = 0; index < 3; index += 1) {
      await user.click(
        screen.getByRole("checkbox", {
          name: new RegExp(`select figure${index}\.png`, "i"),
        })
      );
    }

    // ...and one enhanced, without clearing any of them.
    await user.click(enhanceButton("chart-1"));
    await screen.findByRole("heading", { name: /send .* to gemini\?/i });
    axios.post.mockResolvedValue({
      data: { suggestions: { "chart-1": { description: "d", keywords: [],
                                          confidence: "low" } } },
    });
    await user.click(consentBox());
    await user.click(sendButton());
    await waitFor(() => expect(axios.post).toHaveBeenCalledTimes(2));

    const [url, body] = axios.post.mock.calls[1];
    expect(url).toBe("/api/curation/describe-candidates");
    expect(body.items).toHaveLength(1);
    expect(body.items[0].id).toBe("chart-1");

    // Every Add checkbox is still ticked.
    for (let index = 0; index < 3; index += 1) {
      expect(
        screen.getByRole("checkbox", {
          name: new RegExp(`select figure${index}\.png`, "i"),
        })
      ).toBeChecked();
    }
  }, 30000);

  it("is non-blocking when Gemini is not configured", async () => {
    const user = userEvent.setup();
    renderWith();
    await openAnalysis(user);
    await selectAndOpenConsent(user, null, /select figure1\.png/i);

    axios.post.mockRejectedValue({
      response: {
        status: 503,
        data: { error: "AI descriptions are not configured on this server." },
      },
    });
    await user.click(consentBox());
    await user.click(sendButton());

    expect(
      await screen.findByText(/not configured on this server/i)
    ).toBeInTheDocument();
    // The deterministic review is unaffected and still appliable.
    // The failure is local to that candidate: the rest of the dialog works,
    // and Add becomes available as soon as something is ticked.
    await user.click(
      screen.getByRole("checkbox", { name: /select figure1\.png/i })
    );
    expect(
      screen.getByRole("button", { name: /add selected items to curator/i })
    ).toBeEnabled();
  });
});

// Seeds the saved file server path in real CuratorState.
const Seed = () => {
  const { setFileServerPath } = useContext(CuratorContext);
  useEffect(() => setFileServerPath(FOLDER), []);
  return null;
};

// Real CuratorState: proves applied candidates land in Curator state with
// collision-safe ids and WITHOUT disturbing records the curator already has.
const StateProbe = () => {
  const { charts, tools, add } = useContext(CuratorContext);
  return (
    <div>
      <span data-testid="chart-ids">
        {charts.map((c) => `${c.id}:${c.imageFile}`).join("|") || "none"}
      </span>
      <span data-testid="tool-ids">
        {tools.map((t) => `${t.id}:${t.packageName}`).join("|") || "none"}
      </span>
      <button
        onClick={() =>
          add("chart", { id: "c0", imageFile: "hand-made.png", caption: "Mine" })
        }
      >
        Add manual chart
      </button>
    </div>
  );
};

describe("Analyze RCC Folder applied into real Curator state", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
  });

  const renderLive = () => {
    render(
      <CuratorState draftKey={null}>
        <AlertContext.Provider value={{ setAlert: jest.fn() }}>
          <Seed />
          <FolderAnalysis />
          <StateProbe />
        </AlertContext.Provider>
      </CuratorState>
    );
  };

  it("appends without overwriting existing records and mints unique ids", async () => {
    axios.post.mockResolvedValue({
      data: {
        ...analysis,
        candidates: {
          ...analysis.candidates,
          charts: [
            analysis.candidates.charts[0],
            {
              ...analysis.candidates.charts[0],
              id: "chart-1",
              label: "figure2.png",
              paths: ["figures/figure2.png"],
              proposal: {
                ...analysis.candidates.charts[0].proposal,
                imageFile: "figures/figure2.png",
                number: 2,
              },
            },
          ],
        },
      },
    });
    const user = userEvent.setup();
    renderLive();

    await user.click(screen.getByRole("button", { name: /add manual chart/i }));
    expect(screen.getByTestId("chart-ids")).toHaveTextContent(
      "c0:hand-made.png"
    );

    await user.click(analyzeButton());
    await screen.findByRole("tab", { name: /charts \(2\)/i });
    await user.click(
      screen.getByRole("checkbox", { name: /select figure1\.png/i })
    );
    await user.click(
      screen.getByRole("checkbox", { name: /select figure2\.png/i })
    );
    await user.click(
      screen.getByRole("button", { name: /add selected items to curator/i })
    );

    await waitFor(() =>
      expect(screen.getByTestId("chart-ids")).toHaveTextContent("c2")
    );
    const ids = screen.getByTestId("chart-ids").textContent.split("|");
    // The hand-made chart survives untouched, and the batch gets distinct ids
    // (a naive `c${charts.length}` would have produced c1 twice).
    expect(ids[0]).toBe("c0:hand-made.png");
    expect(ids.map((entry) => entry.split(":")[0])).toEqual(["c0", "c1", "c2"]);
    expect(new Set(ids).size).toBe(3);
  });
});

// The field contract, per record type. Folder analysis is a review step: a
// proposal may be added while required fields are still blank, because the
// curator finishes them in the section afterwards. What must NOT happen is a
// suggestion arriving for a field the record cannot hold, or an optional
// field being reported as missing.
describe("Folder Analysis field contract", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    axios.post.mockResolvedValue({ data: analysis });
  });

  const openFields = async (user, tab, name, id) => {
    await openAnalysis(user);
    if (tab) await user.click(screen.getByRole("tab", { name: tab }));
    await user.click(screen.getByRole("checkbox", { name }));
    return screen.findByTestId(`fields-${id}`);
  };

  const input = (pattern) =>
    screen.getByLabelText(pattern, { selector: "input" });

  it("offers a dataset Files, Description and Keywords -- and no URLs",
     async () => {
    // delay: null — every keystroke re-renders the whole dialog, so the
    // default inter-key delay makes a 25-character phrase the slowest thing
    // in this file. It changes nothing about what is asserted.
    const user = userEvent.setup({ delay: null });
    renderWith();
    await openFields(user, /datasets \(1\)/i, /select short_traj/i,
                     "dataset-0");

    expect(input(/^files/i)).toBeRequired();
    expect(input(/^description/i)).toBeRequired();
    const keywords = input(/^keywords/i);
    expect(keywords).not.toBeRequired();

    // URLs is a legacy storage key. It is preserved on records that have it,
    // but it is not an input on any current surface.
    expect(screen.queryByLabelText(/^urls/i)).toBeNull();

    await user.type(keywords, "silicon");
    expect(keywords).toHaveValue("silicon");
  });

  it("marks only required fields, and says what the marker means", async () => {
    const user = userEvent.setup();
    renderWith();
    await openFields(user, null, /select figure1\.png/i, "chart-0");

    expect(input(/^figure caption ?\*?$/i)).toBeRequired();
    expect(input(/^figure image ?\*?$/i)).toBeRequired();
    // Optional for a chart.
    expect(input(/^reproduction notebook ?\*?$/i)).not.toBeRequired();
    expect(input(/^input \/ supporting files/i)).not.toBeRequired();

    expect(screen.getByTestId("required-note")).toHaveTextContent(
      "* Required before Save/Update and Publish. Folder proposals may be " +
        "added incomplete."
    );
  });

  it("does not call an empty optional field a missing one", async () => {
    const user = userEvent.setup();
    renderWith();
    await openFields(user, /scripts \(1\)/i, /select plot_vdos\.py/i,
                     "script-0");

    // readme is blank and required, so the badge is there...
    expect(screen.getByTestId("needs-input-script-0")).toBeInTheDocument();

    await user.type(input(/^description ?\*?$/i), "Plots the VDOS");

    // ...and it goes once the REQUIRED field is filled, even though Keywords
    // and URLs are still empty.
    await waitFor(() =>
      expect(screen.queryByTestId("needs-input-script-0")).toBeNull()
    );
    expect(input(/^keywords/i)).toHaveValue("");
    expect(screen.queryByLabelText(/^urls/i)).toBeNull();
  });

  it("adds a candidate to the Curator with required fields still blank",
     async () => {
    const user = userEvent.setup();
    const { addMany } = renderWith();
    await openFields(user, /scripts \(1\)/i, /select plot_vdos\.py/i,
                     "script-0");

    // The description is required and deliberately left blank.
    await user.click(
      screen.getByRole("button", { name: /add selected items to curator/i })
    );

    expect(addMany).toHaveBeenCalledTimes(1);
    const [kind, records] = addMany.mock.calls[0];
    expect(kind).toBe("script");
    expect(records).toHaveLength(1);
    expect(records[0].readme).toBe("");
    // ...and it carries the separate keywords list. A brand-new record does
    // not invent an empty legacy URLs array.
    expect(records[0].keywords).toEqual([]);
    expect(records[0]).not.toHaveProperty("URLs");
  });
});

describe("AI proposals land only where the record can hold them", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    axios.post.mockResolvedValue({ data: analysis });
  });

  const input = (pattern) =>
    screen.getByLabelText(pattern, { selector: "input" });

  const suggestForScript = async (user, suggestions) => {
    await openAnalysis(user);
    await user.click(screen.getByRole("tab", { name: /scripts \(1\)/i }));
    await user.click(
      screen.getByRole("checkbox", { name: /select plot_vdos\.py/i })
    );
    await user.click(
      screen.getByTestId("enhance-script-0")
    );
    await screen.findByRole("heading", { name: /send .* to gemini\?/i });
    axios.post.mockResolvedValue({ data: { suggestions } });
    await user.click(
      screen.getByRole("checkbox", {
        name: /i agree to send this evidence to gemini for this request/i,
      })
    );
    await user.click(
      screen.getByRole("button", { name: /send and get suggestions/i })
    );
    return screen.findByTestId("ai-confidence-script-0");
  };

  it("accepts script keywords into the keywords field", async () => {
    const user = userEvent.setup();
    renderWith();
    await suggestForScript(user, {
      "script-0": {
        description: "Plots the VDOS.",
        keywords: ["vibrational spectra", "phonons"],
        confidence: "medium",
      },
    });

    await user.click(screen.getByRole("button", { name: /use as keywords/i }));

    expect(input(/^keywords/i)).toHaveValue("vibrational spectra, phonons");
    expect(screen.queryByLabelText(/^urls/i)).toBeNull();
  });

  it("accepting a suggestion adds, saves and publishes nothing", async () => {
    const user = userEvent.setup();
    const { addMany } = renderWith();
    await suggestForScript(user, {
      "script-0": { description: "Plots the VDOS.", keywords: ["phonons"],
                    confidence: "medium" },
    });

    await user.click(screen.getByRole("button", { name: /use as keywords/i }));

    expect(addMany).not.toHaveBeenCalled();
    expect(axios.put).not.toHaveBeenCalled();
  });

  it("carries an accepted keyword through to the applied record", async () => {
    const user = userEvent.setup();
    const { addMany } = renderWith();
    await suggestForScript(user, {
      "script-0": { description: "Plots the VDOS.", keywords: ["phonons"],
                    confidence: "medium" },
    });

    await user.click(screen.getByRole("button", { name: /use as keywords/i }));
    await user.click(
      screen.getByRole("button", { name: /add selected items to curator/i })
    );

    const [kind, records] = addMany.mock.calls[0];
    expect(kind).toBe("script");
    expect(records[0].keywords).toEqual(["phonons"]);
    expect(records[0]).not.toHaveProperty("URLs");
  });
});
// A Chart stores exactly ONE image, so the unit a curator decides about is the
// image FILE, not the folder. Every image found is listed under the folder it
// really sits in, each with one role, and the boundary panel is the only place
// those roles are chosen — a candidate card shows the resulting Figure Image
// and nothing else.
describe("Charts in the record boundary panel", () => {
  const FIGURE = "figures_tables/figure_S1/figure_S1.png";
  const DIAGRAM = "figures_tables/figure_S1/diagram.png";
  const NOTEBOOK = "figures_tables/figure_S1/figure_S1.ipynb";

  // Verbatim from the real /api/curation/analyze-folder response; the backend
  // route test asserts this exact serialization.
  const CHART_GROUPS = [
    {
      folder: "figures_tables/figure_S1",
      role_root: "figures_tables",
      images: [
        {
          path: DIAGRAM,
          reason: "image found in this chart folder",
          suggested_action: "review",
        },
        {
          path: FIGURE,
          reason: "filename matches the chart folder",
          suggested_action: "chart",
        },
      ],
      notebooks: [{ path: NOTEBOOK }],
    },
  ];

  const chartCandidate = (id, imageFile, extra = {}) => ({
    id,
    kind: "chart",
    label: imageFile.split("/").pop(),
    file_count: 1,
    confidence: "medium",
    evidence: [`One chart: the image ${imageFile}`],
    needs_input: ["caption", "number", "properties"],
    paths: [imageFile],
    proposal: {
      imageFile,
      files: [],
      notebookFile: "",
      number: "",
      caption: "",
      properties: [],
      extraFields: [],
      ...extra,
    },
  });

  const withCharts = (extra = {}) => ({
    ...analysis,
    structure_mode: "standard",
    boundary_trees: {},
    chart_image_groups: CHART_GROUPS,
    applied_chart_plan: [],
    candidates: {
      ...analysis.candidates,
      charts: [chartCandidate("chart-0", FIGURE, { notebookFile: NOTEBOOK })],
    },
    ...extra,
  });

  // A legacy tree, so the Dataset/Script folder picker and the Charts section
  // are on screen together.
  const LEGACY = withCharts({
    structure_mode: "legacy",
    boundary_trees: {
      data: {
        role: "datasets",
        nodes: [
          { path: "data/DFT", name: "DFT", level: 1, file_count: 12,
            extensions: [".in"], sample_names: [] },
        ],
      },
    },
  });

  beforeEach(() => {
    jest.clearAllMocks();
    axios.post.mockResolvedValue({ data: withCharts() });
  });

  const openPanel = async (user) => {
    await openAnalysis(user);
    await user.click(
      screen.getByRole("button", { name: /choose record boundaries/i })
    );
    return screen.findByTestId("chart-plan");
  };

  const roleSelect = (name) =>
    screen.getByLabelText(new RegExp(`^role for ${name}`, "i"));

  const setRole = async (user, name, label) => {
    await user.click(roleSelect(name));
    await user.click(await screen.findByRole("option", { name: label }));
  };

  const rebuild = async (user) =>
    user.click(screen.getByRole("button", { name: /rebuild proposals/i }));

  it("lists every image under the folder it really sits in", async () => {
    const user = userEvent.setup();
    renderWith();
    const panel = await openPanel(user);

    expect(
      screen.getByTestId("chart-folder-figures_tables/figure_S1")
    ).toBeInTheDocument();
    // The real folder path, not a name reconstructed from a candidate.
    expect(panel).toHaveTextContent("figures_tables/figure_S1");
    expect(panel).toHaveTextContent("figure_S1.png");
    // The second image is NOT hidden just because Qresp would not pick it.
    expect(panel).toHaveTextContent("diagram.png");
    expect(panel).toHaveTextContent(/filename matches the chart folder/i);
  });

  it("frames itself as review for folders that already hold several images",
     async () => {
    const user = userEvent.setup();
    renderWith();
    const panel = await openPanel(user);

    // The standard's unit is stated first, so this never reads as a second,
    // looser way to lay out a new paper.
    expect(panel).toHaveTextContent(
      /in the qresp folder standard one charts\/<figure-id>\/ folder is one chart/i
    );
    expect(panel).toHaveTextContent(
      /for reviewing folders that already hold several images/i
    );
    expect(panel).toHaveTextContent(/none is hidden/i);
    expect(panel).toHaveTextContent(/a chart holds exactly one figure image/i);
    expect(panel).toHaveTextContent(/related afterwards in workflow/i);
  });

  it("shows a notebook as an attachment, never as a Chart choice", async () => {
    const user = userEvent.setup();
    renderWith();
    await openPanel(user);

    expect(screen.getByTestId(`chart-notebook-${NOTEBOOK}`)).toHaveTextContent(
      /figure_S1\.ipynb — Reproduction Notebook/i
    );
    // No role control for it: a notebook is never a Chart of its own.
    expect(screen.queryByLabelText(/^role for figure_S1\.ipynb/i)).toBeNull();
    expect(screen.getAllByLabelText(/^role for /i)).toHaveLength(2);
  });

  it("defaults only the folder-named image to Create Chart", async () => {
    const user = userEvent.setup();
    renderWith();
    await openPanel(user);

    expect(roleSelect("figure_S1.png")).toHaveTextContent("Create Chart");
    // Everything else waits for a decision, and says so on screen.
    expect(roleSelect("diagram.png")).toHaveTextContent("Ignore");
    expect(screen.getByTestId(`chart-review-${DIAGRAM}`)).toHaveTextContent(
      "Review"
    );
    expect(screen.queryByTestId(`chart-review-${FIGURE}`)).toBeNull();
  });

  it("offers the three roles, and a Chart target only for a supporting file",
     async () => {
    const user = userEvent.setup();
    renderWith();
    await openPanel(user);

    await user.click(roleSelect("diagram.png"));
    expect(
      screen.getAllByRole("option").map((option) => option.textContent)
    ).toEqual(["Create Chart", "Supporting File", "Ignore"]);
    await user.keyboard("{Escape}");

    expect(screen.queryByLabelText(/^chart for diagram\.png/i)).toBeNull();
    await setRole(user, "diagram.png", "Supporting File");

    const attach = screen.getByLabelText(/^chart for diagram\.png/i);
    // It can only attach to a Chart in the same folder.
    expect(attach).toHaveTextContent("figure_S1.png");
  });

  it("says so when a supporting file has no Chart to attach to", async () => {
    const user = userEvent.setup();
    renderWith();
    await openPanel(user);

    await setRole(user, "figure_S1.png", "Ignore");
    await setRole(user, "diagram.png", "Supporting File");

    expect(
      screen.getByText(/a supporting file needs a Chart in\s+the same folder/i)
    ).toBeInTheDocument();
    // ...and the server is never asked to refuse it.
    expect(
      screen.getByRole("button", { name: /rebuild proposals/i })
    ).toBeDisabled();
  });

  it("sends the folder boundaries AND the chart plan on Rebuild", async () => {
    axios.post.mockResolvedValue({ data: LEGACY });
    const user = userEvent.setup();
    renderWith();
    await openPanel(user);

    await user.click(
      screen.getByRole("checkbox", { name: "Use data/DFT as one record" })
    );
    await setRole(user, "diagram.png", "Supporting File");
    await rebuild(user);

    await waitFor(() => expect(axios.post).toHaveBeenCalledTimes(2));
    expect(axios.post.mock.calls[1][1]).toEqual({
      path: FOLDER,
      boundaries: { data: ["data/DFT"] },
      chart_plan: [
        { path: DIAGRAM, action: "supporting", target: FIGURE },
        { path: FIGURE, action: "chart" },
      ],
    });
    // The first analysis carried neither: defaults are the default.
    expect(axios.post.mock.calls[0][1]).toEqual({ path: FOLDER });
  });

  it("sends a plan with no boundaries when only roles changed", async () => {
    const user = userEvent.setup();
    renderWith();
    await openPanel(user);

    await setRole(user, "diagram.png", "Create Chart");
    await rebuild(user);

    await waitFor(() => expect(axios.post).toHaveBeenCalledTimes(2));
    expect(axios.post.mock.calls[1][1]).toEqual({
      path: FOLDER,
      chart_plan: [
        { path: DIAGRAM, action: "chart" },
        { path: FIGURE, action: "chart" },
      ],
    });
  });

  it("two Create Chart images become two candidates, each with one image",
     async () => {
    const user = userEvent.setup();
    const { addMany } = renderWith();
    await openPanel(user);

    axios.post.mockResolvedValueOnce({
      data: withCharts({
        applied_chart_plan: [
          { path: DIAGRAM, action: "chart", target: "" },
          { path: FIGURE, action: "chart", target: "" },
        ],
        candidates: {
          ...analysis.candidates,
          charts: [
            chartCandidate("chart-0", DIAGRAM),
            chartCandidate("chart-1", FIGURE, { notebookFile: NOTEBOOK }),
          ],
        },
      }),
    });
    await setRole(user, "diagram.png", "Create Chart");
    await rebuild(user);

    await screen.findByRole("tab", { name: /charts \(2\)/i });
    await user.click(
      screen.getByRole("checkbox", { name: /select diagram\.png/i })
    );
    await user.click(
      screen.getByRole("checkbox", { name: /select figure_S1\.png/i })
    );
    await user.click(
      screen.getByRole("button", { name: /add selected items to curator/i })
    );

    const [kind, records] = addMany.mock.calls[0];
    expect(kind).toBe("chart");
    expect(records).toHaveLength(2);
    expect(records.map((record) => record.imageFile)).toEqual([
      DIAGRAM,
      FIGURE,
    ]);
    records.forEach((record) => {
      expect(record).not.toHaveProperty("imageFiles");
      expect(record).not.toHaveProperty("relatedImageFiles");
      // Incomplete on purpose, like any other folder proposal.
      expect(missingRequired("chart", record)).toEqual([
        "number",
        "caption",
        "properties",
      ]);
    });
    // Only the image whose name matches keeps the notebook.
    expect(records[0].notebookFile).toBe("");
    expect(records[1].notebookFile).toBe(NOTEBOOK);
  });

  it("keeps a supporting file in the target Chart's files, not as a Chart",
     async () => {
    const user = userEvent.setup();
    const { addMany } = renderWith();
    await openPanel(user);

    axios.post.mockResolvedValueOnce({
      data: withCharts({
        applied_chart_plan: [
          { path: DIAGRAM, action: "supporting", target: FIGURE },
          { path: FIGURE, action: "chart", target: "" },
        ],
        candidates: {
          ...analysis.candidates,
          charts: [
            chartCandidate("chart-0", FIGURE, {
              files: [DIAGRAM],
              notebookFile: NOTEBOOK,
            }),
          ],
        },
      }),
    });
    await setRole(user, "diagram.png", "Supporting File");
    await rebuild(user);
    await screen.findByRole("tab", { name: /charts \(1\)/i });

    await user.click(
      screen.getByRole("checkbox", { name: /select figure_S1\.png/i })
    );
    await user.click(
      screen.getByRole("button", { name: /add selected items to curator/i })
    );
    const [, records] = addMany.mock.calls[0];
    expect(records).toHaveLength(1);
    expect(records[0].imageFile).toBe(FIGURE);
    expect(records[0].files).toEqual([DIAGRAM]);
  });

  it("shows the applied roles after a rebuild, not the suggestions", async () => {
    const user = userEvent.setup();
    renderWith();
    await openPanel(user);

    axios.post.mockResolvedValueOnce({
      data: withCharts({
        applied_chart_plan: [
          { path: DIAGRAM, action: "supporting", target: FIGURE },
          { path: FIGURE, action: "chart", target: "" },
        ],
      }),
    });
    await setRole(user, "diagram.png", "Supporting File");
    await rebuild(user);
    await screen.findByTestId("chart-plan");

    // What the SERVER applied, not what this component remembered.
    expect(roleSelect("diagram.png")).toHaveTextContent("Supporting File");
    expect(screen.queryByTestId(`chart-review-${DIAGRAM}`)).toBeNull();
  });

  it("Rebuild changes proposals only — nothing is added, saved or published",
     async () => {
    const user = userEvent.setup();
    const { addMany, setAlert } = renderWith();
    await openPanel(user);

    await setRole(user, "diagram.png", "Create Chart");
    await rebuild(user);
    await waitFor(() => expect(axios.post).toHaveBeenCalledTimes(2));

    expect(addMany).not.toHaveBeenCalled();
    expect(setAlert).not.toHaveBeenCalled();
    const posted = axios.post.mock.calls.map((call) => call[0]);
    expect(posted.every((url) => url === "/api/curation/analyze-folder")).toBe(
      true
    );
  });

  it("Use default boundaries clears the roles and sends no plan", async () => {
    const user = userEvent.setup();
    renderWith();
    await openPanel(user);

    await setRole(user, "diagram.png", "Create Chart");
    await user.click(
      screen.getByRole("button", { name: /use default boundaries/i })
    );

    await waitFor(() => expect(axios.post).toHaveBeenCalledTimes(2));
    expect(axios.post.mock.calls[1][1]).toEqual({ path: FOLDER });
    await screen.findByTestId("chart-plan");
    expect(roleSelect("diagram.png")).toHaveTextContent("Ignore");
  });

  it("forgets the roles when the dialog is closed and reopened", async () => {
    const user = userEvent.setup();
    renderWith();
    await openPanel(user);
    await setRole(user, "diagram.png", "Create Chart");
    expect(roleSelect("diagram.png")).toHaveTextContent("Create Chart");

    await user.click(screen.getByRole("button", { name: /^cancel$/i }));
    await user.click(
      await screen.findByRole("button", { name: /analyze rcc folder/i })
    );
    await screen.findByRole("tab", { name: /charts \(1\)/i });
    await user.click(
      screen.getByRole("button", { name: /choose record boundaries/i })
    );

    expect(roleSelect("diagram.png")).toHaveTextContent("Ignore");
    expect(roleSelect("figure_S1.png")).toHaveTextContent("Create Chart");
  });

  it("has no second image-role controller on a candidate card", async () => {
    const user = userEvent.setup();
    renderWith();
    const panel = await openPanel(user);

    await user.click(screen.getByRole("button", { name: "Edit Proposal" }));
    const fields = await screen.findByTestId("fields-chart-0");

    // Every role controller on screen lives in the boundary panel. The card
    // has none: it shows the RESULT, and the panel is the only place a role
    // is decided.
    const roles = screen.getAllByLabelText(/^role for /i);
    expect(roles).toHaveLength(2);
    roles.forEach((control) => expect(panel).toContainElement(control));
    expect(within(fields).queryAllByLabelText(/^role for /i)).toHaveLength(0);
    expect(screen.queryByTestId("image-roles-chart-0")).toBeNull();

    const imageField = within(fields).getByLabelText(
      /^figure image ?\*?$/i,
      { selector: "input" }
    );
    expect(imageField).toHaveValue(FIGURE);
    // A plain text input, not a second chooser.
    expect(imageField.tagName).toBe("INPUT");
  });

  it("still enhances exactly one candidate at a time", async () => {
    const user = userEvent.setup();
    renderWith();
    await openAnalysis(user);

    axios.post.mockResolvedValueOnce({
      data: { suggestions: { "chart-0": { description: "A figure",
                                          keywords: [], confidence: "low" } } },
    });
    await user.click(screen.getByTestId("enhance-chart-0"));
    await user.click(
      screen.getByLabelText(/i agree to send this evidence to gemini/i)
    );
    await user.click(
      screen.getByRole("button", { name: /send and get suggestions/i })
    );

    await waitFor(() => expect(axios.post).toHaveBeenCalledTimes(2));
    const [url, body] = axios.post.mock.calls[1];
    expect(url).toBe("/api/curation/describe-candidates");
    expect(body.items).toHaveLength(1);
    expect(body.items[0].id).toBe("chart-0");
  });

  it("wraps its controls instead of overflowing a narrow dialog", async () => {
    const user = userEvent.setup();
    renderWith();
    await openPanel(user);

    const row = screen.getByTestId(`chart-image-${DIAGRAM}`);
    // The row wraps rather than pushing the dialog sideways...
    expect(row).toHaveStyle("flex-wrap: wrap");
    expect(row).toHaveStyle("max-width: 100%");
    // ...and the long filename breaks instead of widening the row.
    expect(screen.getByText("diagram.png")).toHaveStyle(
      "overflow-wrap: anywhere"
    );
  });
});

// The typed import dialog is a review surface, not a dashboard. The title
// already names the artifact, the state of the scan is one chip, and the
// numbers behind it are one click away. These pin the layout contract so the
// four dialogs cannot drift back into a wall of alerts.
describe("typed import dialog ??readable by default", () => {
  const TypedChart = () => {
    const [cache, setCache] = useState({ path: "", data: null });
    return (
      <AlertContext.Provider value={{ setAlert: jest.fn() }}>
        <CuratorContext.Provider
          value={{
            fileServerPath: FOLDER,
            addMany: jest.fn(),
            rccAnalysisCache: cache,
            cacheRccAnalysis: (path, data) => setCache({ path, data }),
          }}
        >
          <FolderAnalysis artifactType="chart" />
        </CuratorContext.Provider>
      </AlertContext.Provider>
    );
  };

  const legacyAnalysis = {
    ...analysis,
    candidates: {
      ...analysis.candidates,
      charts: [
        {
          ...analysis.candidates.charts[0],
          // Per-field standing, exactly as the backend sends it.
          field_evidence: {
            imageFile: "high",
            files: "needs_input",
            notebookFile: "needs_input",
            number: "needs_input",
            caption: "needs_input",
            properties: "needs_input",
          },
        },
      ],
    },
    structure_mode: "legacy",
    truncated: true,
    counts: { files: 1971, directories: 260 },
    limits: {
      max_depth: 4,
      max_files: 2000,
      max_directory_listings: 120,
      max_evidence_files: 30,
    },
    warnings: ["Only the first 4 folder levels were inspected."],
    normalized_roles: { data: "datasets", figures_tables: "charts" },
    structure_issues: [
      { path: "figures_tables", reason: "Read as charts (Qresp Folder Standard name: charts)." },
    ],
  };

  beforeEach(() => {
    jest.clearAllMocks();
    axios.post.mockResolvedValue({ data: legacyAnalysis });
  });

  const openChartImport = async (user) => {
    render(<TypedChart />);
    await user.click(
      screen.getByRole("button", { name: /import charts from rcc/i })
    );
    return screen.findByRole("dialog", { name: /import charts from rcc/i });
  };

  it("names the type once ??no second Charts (N) heading inside", async () => {
    const user = userEvent.setup();
    const dialog = await openChartImport(user);

    expect(
      screen.getByRole("heading", { name: /import charts from rcc/i })
    ).toBeInTheDocument();
    // The old duplicate: a "Charts (1)" heading under a dialog already
    // titled "Import Charts from RCC".
    expect(
      within(dialog).queryByText(/^charts \(\d+\)$/i)
    ).toBeNull();
    expect(within(dialog).queryByRole("tab")).toBeNull();
    // The count itself is kept, as a count of what is on screen.
    expect(screen.getByTestId("candidate-count")).toHaveTextContent(
      "1 proposal · 0 selected"
    );
  });

  it("opens with one line of guidance and one summary alert", async () => {
    const user = userEvent.setup();
    const dialog = await openChartImport(user);

    expect(within(dialog).getAllByRole("alert")).toHaveLength(1);
    expect(screen.getByTestId("partial-notice")).toHaveTextContent(
      /partial view of the folder/i
    );
    // The long version is not in the way.
    expect(screen.queryByTestId("scan-details")).toBeNull();
    expect(screen.queryByTestId("folder-mapping")).toBeNull();
    // ...and the state is a chip, not a paragraph glued to one.
    const badge = screen.getByTestId("structure-mode");
    expect(badge).toHaveTextContent("Legacy-compatible");
    expect(badge).not.toHaveTextContent(/Read as charts/);
  });

  it("keeps every scan number and every warning behind Show scan details",
     async () => {
    const user = userEvent.setup();
    await openChartImport(user);

    await user.click(
      screen.getByRole("button", { name: /show scan details/i })
    );
    const details = await screen.findByTestId("scan-details");
    expect(details).toHaveTextContent("1971 file(s) across 260 folder(s)");
    expect(details).toHaveTextContent("at most 4 folder levels");
    expect(details).toHaveTextContent("2000 files");
    expect(details).toHaveTextContent("120 directory listings");
    expect(details).toHaveTextContent("30 manifest/script files");
    expect(details).toHaveTextContent(
      /only the first 4 folder levels were inspected/i
    );

    // It closes again, and it is not a scroll container of its own.
    expect(getComputedStyle(details).overflowY).not.toMatch(/auto|scroll/);
    await user.click(
      screen.getByRole("button", { name: /hide scan details/i })
    );
    await waitForElementToBeRemoved(() => screen.queryByTestId("scan-details"));
  });

  it("keeps the whole legacy mapping behind Show folder mapping", async () => {
    const user = userEvent.setup();
    await openChartImport(user);

    await user.click(
      screen.getByRole("button", { name: /show folder mapping/i })
    );
    const mapping = await screen.findByTestId("folder-mapping");
    expect(mapping).toHaveTextContent("data → datasets");
    expect(mapping).toHaveTextContent("figures_tables → charts");
    expect(mapping).toHaveTextContent(/Read as charts/);
    expect(mapping).toHaveTextContent(/Nothing on the file server is renamed/i);
    expect(getComputedStyle(mapping).overflowY).not.toMatch(/auto|scroll/);
  });

  it("groups a candidate's status and actions so they wrap together",
     async () => {
    const user = userEvent.setup();
    await openChartImport(user);

    const identity = screen.getByTestId("identity-chart-0");
    const status = screen.getByTestId("status-chart-0");
    const actions = screen.getByTestId("actions-chart-0");

    // Three regions. The two right-hand ones wrap INTERNALLY and may shrink:
    // a group that refuses to shrink keeps the full width of four buttons in
    // a row and pushes the card sideways at phone width. Measured in Chrome
    // at 390px: with flex-shrink 0 the card was 414px wide inside a 294px
    // column; allowing it to shrink removed the horizontal scroll entirely.
    expect(status).toHaveStyle("flex-wrap: wrap");
    expect(status).toHaveStyle("min-width: 0");
    expect(actions).toHaveStyle("flex-wrap: wrap");
    expect(actions).toHaveStyle("min-width: 0");
    expect(identity).toHaveStyle("min-width: 0");
    // ...while a button's own label never breaks word by word.
    expect(
      within(actions).getByRole("button", { name: /edit proposal/i })
    ).toHaveStyle("white-space: nowrap");
    // A long relative path breaks instead of pushing the buttons away.
    expect(
      within(identity).getByText("figures", { exact: false })
    ).toHaveStyle("overflow-wrap: anywhere");
    // The header row itself wraps, with real gaps between the groups.
    const header = identity.parentElement;
    expect(header).toHaveStyle("flex-wrap: wrap");
    expect(header).toHaveStyle("column-gap: 12px");
    expect(header).toHaveStyle("row-gap: 12px");
  });

  it("separates the proposal form from the header, and gives the first field room",
     async () => {
    const user = userEvent.setup();
    await openChartImport(user);

    await user.click(screen.getByRole("button", { name: /edit proposal/i }));
    const fields = await screen.findByTestId("fields-chart-0");

    // A rule, then real space before the first input.
    const divider = screen.getByTestId("fields-divider-chart-0");
    expect(divider).toHaveClass("MuiDivider-root");
    expect(fields.previousElementSibling).toBe(divider);
    expect(fields).toHaveStyle("padding-top: 20px");
    // 20px between rows, 16px between the two columns. MUI's Grid carries
    // its spacing as custom properties, so that is what is asserted.
    const grid = getComputedStyle(fields);
    expect(grid.getPropertyValue("--Grid-rowSpacing").trim()).toBe("20px");
    expect(grid.getPropertyValue("--Grid-columnSpacing").trim()).toBe("16px");
  });

  it("keeps input, helper text and evidence chip in one field group",
     async () => {
    const user = userEvent.setup();
    await openChartImport(user);

    await user.click(screen.getByRole("button", { name: /edit proposal/i }));
    await screen.findByTestId("fields-chart-0");

    const group = screen.getByTestId("field-group-chart-0-imageFile");
    // One column, one spacing rule: input -> helper text -> evidence chip.
    expect(group).toHaveStyle("display: flex");
    expect(group).toHaveStyle("flex-direction: column");
    expect(group).toHaveStyle("gap: 8px");

    const input = within(group).getByLabelText(/^figure image ?\*?$/i, {
      selector: "input",
    });
    const chip = screen.getByTestId("field-evidence-chart-0-imageFile");
    expect(group).toContainElement(input);
    expect(group).toContainElement(chip);
    // The chip is BELOW the helper text, not pulled up over the input.
    const helper = group.querySelector(".MuiFormHelperText-root");
    expect(helper).toBeInTheDocument();
    expect(
      helper.compareDocumentPosition(chip) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(chip).not.toHaveStyle("margin-top: -12px");
  });

  it("shows no evidence or missing chip on an untouched optional field",
     async () => {
    const user = userEvent.setup();
    await openChartImport(user);

    await user.click(screen.getByRole("button", { name: /edit proposal/i }));
    await screen.findByTestId("fields-chart-0");

    // notebookFile is optional and empty here: no chip of any kind.
    expect(
      screen.queryByTestId("field-evidence-chart-0-notebookFile")
    ).toBeNull();
    // A missing REQUIRED field is said once in the header, and once in that
    // field's own helper text ??never as a third chip.
    expect(screen.getByTestId("needs-input-chart-0")).toHaveTextContent(
      /required field/i
    );
    expect(screen.queryByTestId("field-evidence-chart-0-caption")).toBeNull();
  });

  it("adds exactly what it added before the layout changed", async () => {
    const user = userEvent.setup();
    const addMany = jest.fn();
    const Harness = () => {
      const [cache, setCache] = useState({ path: "", data: null });
      return (
        <AlertContext.Provider value={{ setAlert: jest.fn() }}>
          <CuratorContext.Provider
            value={{
              fileServerPath: FOLDER,
              addMany,
              rccAnalysisCache: cache,
              cacheRccAnalysis: (path, data) => setCache({ path, data }),
            }}
          >
            <FolderAnalysis artifactType="chart" />
          </CuratorContext.Provider>
        </AlertContext.Provider>
      );
    };
    render(<Harness />);
    await user.click(
      screen.getByRole("button", { name: /import charts from rcc/i })
    );
    await screen.findByRole("dialog", { name: /import charts from rcc/i });

    // The request is untouched by the presentation work.
    expect(axios.post).toHaveBeenCalledWith("/api/curation/analyze-folder", {
      path: FOLDER,
    });

    await user.click(
      screen.getByRole("checkbox", { name: /select figure1\.png/i })
    );
    await user.click(
      screen.getByRole("button", { name: /add selected charts to curator/i })
    );

    expect(addMany).toHaveBeenCalledTimes(1);
    expect(addMany).toHaveBeenCalledWith("chart", [
      expect.objectContaining({
        imageFile: "figures/figure1.png",
        number: "",
        caption: "",
        properties: [],
        files: [],
        notebookFile: "",
        extraFields: [],
      }),
    ]);
  });
});
