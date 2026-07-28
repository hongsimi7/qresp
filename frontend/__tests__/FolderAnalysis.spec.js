import { useContext, useEffect } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

jest.mock("axios");
import axios from "axios";

import FolderAnalysis from "../components/CuratorElements/FolderAnalysis";
import CuratorState from "../Context/Curator/CuratorState";
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
      screen.getByRole("checkbox", { name: /select figures \/ figure1\.png/i })
    ).toBeInTheDocument();
    // The needs-input chip is a short badge; the field list is its tooltip.
    expect(screen.getByText(/^needs input$/i)).toBeInTheDocument();
  });

  it("uses compact labels per kind and keeps full paths under Details", async () => {
    const user = userEvent.setup();
    renderWith();
    await openAnalysis(user);

    // Chart: parent folder / image file — not the whole relative path.
    expect(screen.getByText("figures / figure1.png")).toBeInTheDocument();
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
    expect(screen.getByText("plot_vdos.py")).toBeInTheDocument();
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
    expect(screen.queryByLabelText(/^caption$/i)).toBeNull();
    expect(screen.queryByLabelText(/^image file$/i)).toBeNull();
    expect(screen.queryAllByRole("textbox")).toHaveLength(0);

    // Selecting reveals them...
    await user.click(
      screen.getByRole("checkbox", { name: /select figures \/ figure1\.png/i })
    );
    expect(await screen.findByLabelText(/^caption$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^image file$/i)).toBeInTheDocument();
    expect(
      screen.getAllByText(/qresp could not determine this/i).length
    ).toBeGreaterThan(0);
  });

  it("Edit proposal opens the fields without selecting the candidate", async () => {
    const user = userEvent.setup();
    renderWith();
    await openAnalysis(user);

    await user.click(screen.getByRole("button", { name: /edit proposal/i }));

    expect(await screen.findByLabelText(/^caption$/i)).toBeInTheDocument();
    expect(
      screen.getByRole("checkbox", { name: /select figures \/ figure1\.png/i })
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
    // The action group does not shrink into the label.
    expect(actions).toHaveStyle("flex-shrink: 0");
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
    expect(screen.getByLabelText(/^caption$/i)).toBeInTheDocument();
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
    expect(
      screen.getByTestId("field-evidence-chart-0-notebookFile")
    ).toHaveTextContent("Medium evidence");
    expect(
      screen.getByTestId("field-evidence-chart-0-number")
    ).toHaveTextContent("Needs input");
    expect(
      screen.getByTestId("field-evidence-chart-0-caption")
    ).toHaveTextContent("Needs input");
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
    expect(screen.getByLabelText(/^properties/i)).toHaveValue("");
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
      screen.getByRole("checkbox", { name: /select figures \/ figure29\.png/i })
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

    const badge = screen.getByTestId("structure-mode");
    expect(badge).toHaveTextContent("Legacy-compatible");
    expect(badge).toHaveTextContent(/figures_tables: Read as charts/);
    expect(badge).toHaveTextContent(/Nothing on the file server is renamed/);
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
      name: /select figures \/ figure1\.png/i,
    });
    expect(box).not.toBeChecked();
    const apply = screen.getByRole("button", {
      name: /add selected items to curator/i,
    });
    expect(apply).toBeDisabled();
    expect(addMany).not.toHaveBeenCalled();
  });

  it("applies only the selected candidates, with the curator's edits", async () => {
    const user = userEvent.setup();
    const { addMany } = renderWith();
    await openAnalysis(user);

    await user.click(
      screen.getByRole("checkbox", { name: /select figures \/ figure1\.png/i })
    );
    await user.type(screen.getByLabelText(/^caption$/i), "Density of states");
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
      screen.getByRole("checkbox", { name: /select figures \/ figure1\.png/i })
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
      screen.getByRole("checkbox", { name: /select figures \/ figure1\.png/i })
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
      screen.getByRole("checkbox", { name: /select figures \/ figure1\.png/i })
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
        limits: { max_depth: 4, max_files: 2000 },
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
    expect(notice).toHaveTextContent("at most 4 folder levels, 2000 files");
    expect(notice).toHaveTextContent(/do not represent everything/i);
    // Not styled as an error — it is an expected, safe outcome.
    expect(notice).toHaveClass("MuiAlert-colorInfo");
    expect(notice.className).not.toMatch(/colorError|colorWarning/);
    // The specific reason is still listed.
    expect(
      screen.getByText(/only the first 4 folder levels were inspected/i)
    ).toBeInTheDocument();
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

  it("a standard layout is never asked to pick boundaries", async () => {
    axios.post.mockResolvedValue({
      data: { ...analysis, structure_mode: "standard", boundary_trees: {} },
    });
    const user = userEvent.setup();
    renderWith();
    await openAnalysis(user);
    expect(screen.queryByTestId("boundary-picker")).toBeNull();
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
    expect(badge).toHaveTextContent(/mystery_stuff:/);
    expect(badge).toHaveTextContent(/not a layout Qresp recognizes/i);

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

  const enhanceButton = () =>
    screen.getByRole("button", { name: /enhance selected with ai/i });

  const consentBox = () =>
    screen.getByRole("checkbox", {
      name: /i agree to send this evidence to gemini for this request/i,
    });

  const sendButton = () =>
    screen.getByRole("button", { name: /send and get suggestions/i });

  // Selects a candidate in the given tab and opens the consent dialog.
  const selectAndOpenConsent = async (user, tab, name) => {
    if (tab) {
      await user.click(screen.getByRole("tab", { name: tab }));
    }
    await user.click(screen.getByRole("checkbox", { name }));
    await user.click(enhanceButton());
    return screen.findByRole("heading", { name: /send .* to gemini\?/i });
  };

  const consentAndSend = async (user, reply) => {
    axios.post.mockResolvedValue({ data: reply });
    await user.click(consentBox());
    await user.click(sendButton());
  };

  it("is disabled until at least one candidate is selected", async () => {
    const user = userEvent.setup();
    renderWith();
    await openAnalysis(user);

    expect(enhanceButton()).toBeDisabled();
    expect(
      screen.getByText(/select the candidates you want described first/i)
    ).toBeInTheDocument();
    // Only the analyze call has happened.
    expect(axios.post).toHaveBeenCalledTimes(1);

    await user.click(
      screen.getByRole("checkbox", { name: /select figures \/ figure1\.png/i })
    );
    expect(enhanceButton()).toBeEnabled();
  });

  it("opens a consent dialog that sends nothing by itself", async () => {
    const user = userEvent.setup();
    renderWith();
    await openAnalysis(user);
    await selectAndOpenConsent(
      user, null, /select figures \/ figure1\.png/i
    );

    // The dialog states the count and the exact scope BEFORE anything moves.
    expect(
      screen.getByRole("heading", { name: /send 1 selected item\(s\) to gemini\?/i })
    ).toBeInTheDocument();
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
    await selectAndOpenConsent(user, null, /select figures \/ figure1\.png/i);

    await user.click(screen.getByRole("button", { name: /^cancel$/i }));

    expect(axios.post).toHaveBeenCalledTimes(1);
    expect(axios.post.mock.calls[0][0]).toBe("/api/curation/analyze-folder");
  });

  it("asks for consent again on every request — it is never remembered", async () => {
    const user = userEvent.setup();
    renderWith();
    await openAnalysis(user);
    await selectAndOpenConsent(user, null, /select figures \/ figure1\.png/i);
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
    expect(screen.getByLabelText(/^description$/i)).toHaveValue("");
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

    expect(screen.getByLabelText(/^description$/i)).toHaveValue("");
    await user.click(screen.getByRole("button", { name: /use as description/i }));
    expect(screen.getByLabelText(/^description$/i)).toHaveValue("AI text");

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
    await user.type(screen.getByLabelText(/^description$/i), "Mine");
    await user.click(enhanceButton());
    await screen.findByRole("heading", { name: /send .* to gemini\?/i });
    await consentAndSend(user, {
      suggestions: {
        "script-0": { description: "AI text", keywords: [], confidence: "low" },
      },
    });
    await screen.findByTestId("ai-confidence-script-0");

    // The suggestion is visible but cannot be applied over the user's text.
    expect(screen.getByText("AI text")).toBeInTheDocument();
    expect(screen.getByLabelText(/^description$/i)).toHaveValue("Mine");
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
    await selectAndOpenConsent(user, null, /select figures \/ figure1\.png/i);
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

    expect(screen.getByLabelText(/^image file$/i)).toHaveValue(
      "figures/figure1.png"
    );
    expect(screen.getByLabelText(/figure number/i)).toHaveValue("");
    expect(screen.getByLabelText(/^notebook file$/i)).toHaveValue("");
    expect(screen.getByLabelText(/^files/i)).toHaveValue("");

    // Only caption/properties are offered, and only on request.
    await user.click(screen.getByRole("button", { name: /use as caption/i }));
    expect(screen.getByLabelText(/^caption$/i)).toHaveValue("A nice figure");
    expect(screen.getByLabelText(/^image file$/i)).toHaveValue(
      "figures/figure1.png"
    );
    expect(screen.getByLabelText(/figure number/i)).toHaveValue("");
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
    expect(
      screen.getByText(/this record type has no keyword field/i)
    ).toBeInTheDocument();
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
    await selectAndOpenConsent(user, null, /select figures \/ figure1\.png/i);
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
    await selectAndOpenConsent(user, null, /select figures \/ figure1\.png/i);
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
    await selectAndOpenConsent(user, null, /select figures \/ figure1\.png/i);
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
    await user.click(screen.getByRole("button", { name: /use as caption/i }));

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

  it("refuses an oversized batch locally, without any request", async () => {
    const many = {
      ...analysis,
      candidates: {
        ...analysis.candidates,
        charts: Array.from({ length: 11 }, (unused, index) => ({
          ...analysis.candidates.charts[0],
          id: `chart-${index}`,
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
    await screen.findByRole("tab", { name: /charts \(11\)/i });

    for (let index = 0; index < 11; index += 1) {
      await user.click(
        screen.getByRole("checkbox", {
          name: new RegExp(`select figures / figure${index}\\.png`, "i"),
        })
      );
    }
    await user.click(enhanceButton());
    await screen.findByRole("heading", { name: /send .* to gemini\?/i });
    await user.click(consentBox());
    await user.click(sendButton());

    expect(
      await screen.findByText(/at most 10 candidates — you have 11 selected/i)
    ).toBeInTheDocument();
    expect(axios.post).toHaveBeenCalledTimes(1);
  }, 30000);

  it("is non-blocking when Gemini is not configured", async () => {
    const user = userEvent.setup();
    renderWith();
    await openAnalysis(user);
    await selectAndOpenConsent(user, null, /select figures \/ figure1\.png/i);

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
      screen.getByRole("checkbox", { name: /select figures \/ figure1\.png/i })
    );
    await user.click(
      screen.getByRole("checkbox", { name: /select figures \/ figure2\.png/i })
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
