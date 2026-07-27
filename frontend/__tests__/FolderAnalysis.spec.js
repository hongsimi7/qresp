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
        evidence: ["figures/figure1.png is a .png image"],
        needs_input: ["caption", "number"],
        paths: ["figures/figure1.png"],
        proposal: {
          imageFile: "figures/figure1.png",
          files: [],
          notebookFile: "",
          number: 1,
          caption: "",
          properties: ["figure"],
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
          readme: "Files from data/short_traj",
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
        evidence: ["Description taken from the file's own header/docstring"],
        needs_input: [],
        paths: ["scripts/plot_vdos.py"],
        proposal: {
          files: ["scripts/plot_vdos.py"],
          readme: "Plot the vibrational density of states.",
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
    unclassified: ["README.md"],
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
    expect(
      screen.getByText(/pick a file server folder first/i)
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

  it("renders each kind in its own group with confidence and evidence", async () => {
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
      "high confidence"
    );
    expect(
      screen.getByText(/figures\/figure1\.png is a \.png image/i)
    ).toBeInTheDocument();
    // "Needs human input" is explicit, on the chip and on the field itself.
    expect(screen.getByText(/needs your input: caption, number/i))
      .toBeInTheDocument();
    expect(
      screen.getAllByText(/qresp could not determine this/i).length
    ).toBeGreaterThan(0);
  });

  it("selects nothing by default and cannot apply until something is checked", async () => {
    const user = userEvent.setup();
    const { addMany } = renderWith();
    await openAnalysis(user);

    const box = screen.getByRole("checkbox", {
      name: /select figures\/figure1\.png/i,
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
      screen.getByRole("checkbox", { name: /select figures\/figure1\.png/i })
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
        number: "1",
        properties: ["figure"],
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
      screen.getByRole("checkbox", { name: /select figures\/figure1\.png/i })
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
      screen.getByRole("checkbox", { name: /select data\/short_traj/i })
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
      screen.getByRole("checkbox", { name: /select figures\/figure1\.png/i })
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
      screen.getByRole("checkbox", { name: /select figures\/figure1\.png/i })
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

  it("surfaces truncation and warnings honestly", async () => {
    axios.post.mockResolvedValue({
      data: {
        ...analysis,
        truncated: true,
        warnings: ["Only the first 4 folder levels were inspected."],
      },
    });
    const user = userEvent.setup();
    renderWith();
    await openAnalysis(user);
    expect(
      screen.getByText(/only part of the folder was inspected/i)
    ).toBeInTheDocument();
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

describe("Analyze RCC Folder — optional AI descriptions", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    axios.post.mockResolvedValue({ data: analysis });
  });

  const aiButton = () =>
    screen.getByRole("button", {
      name: /generate descriptions and keywords with ai/i,
    });

  const consentBox = () =>
    screen.getByRole("checkbox", {
      name: /send the selected file and folder names to the ai service/i,
    });

  it("requires consent AND a selection before anything is sent", async () => {
    const user = userEvent.setup();
    renderWith();
    await openAnalysis(user);

    expect(consentBox()).not.toBeChecked();
    expect(aiButton()).toBeDisabled();
    expect(
      screen.getByText(/select the candidates you want described first/i)
    ).toBeInTheDocument();

    // A selection alone is not consent.
    await user.click(
      screen.getByRole("checkbox", { name: /select figures\/figure1\.png/i })
    );
    expect(aiButton()).toBeDisabled();

    // Consent alone, with nothing selected, is not a request either.
    expect(axios.post.mock.calls).toHaveLength(1);
  });

  it("sends only allowlisted, relative, locally-extracted context", async () => {
    const user = userEvent.setup();
    renderWith();
    await openAnalysis(user);
    await user.click(screen.getByRole("tab", { name: /scripts \(1\)/i }));
    await user.click(
      screen.getByRole("checkbox", { name: /select scripts\/plot_vdos\.py/i })
    );
    await user.click(consentBox());

    axios.post.mockResolvedValue({
      data: {
        suggestions: {
          "script-0": { description: "Plots the VDOS.", keywords: ["VDOS"] },
        },
      },
    });
    await user.click(aiButton());
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
    // Only the text Qresp already read locally travels as context.
    expect(item.context).toContain("Plot the vibrational density of states.");
  });

  it("fills the editable description field, applying nothing by itself", async () => {
    const user = userEvent.setup();
    const { addMany } = renderWith();
    await openAnalysis(user);
    await user.click(screen.getByRole("tab", { name: /scripts \(1\)/i }));
    await user.click(
      screen.getByRole("checkbox", { name: /select scripts\/plot_vdos\.py/i })
    );
    await user.click(consentBox());

    axios.post.mockResolvedValue({
      data: {
        suggestions: {
          "script-0": { description: "AI text", keywords: ["VDOS"] },
        },
      },
    });
    await user.click(aiButton());

    await waitFor(() =>
      expect(screen.getByLabelText(/^description$/i)).toHaveValue("AI text")
    );
    expect(addMany).not.toHaveBeenCalled();
    // Still editable afterwards.
    await user.clear(screen.getByLabelText(/^description$/i));
    await user.type(screen.getByLabelText(/^description$/i), "Mine");
    expect(screen.getByLabelText(/^description$/i)).toHaveValue("Mine");
  });

  it("is non-blocking when Gemini is not configured", async () => {
    const user = userEvent.setup();
    renderWith();
    await openAnalysis(user);
    // The deterministic candidates are there regardless.
    expect(
      screen.getByRole("checkbox", { name: /select figures\/figure1\.png/i })
    ).toBeInTheDocument();

    await user.click(
      screen.getByRole("checkbox", { name: /select figures\/figure1\.png/i })
    );
    await user.click(consentBox());
    axios.post.mockRejectedValue({
      response: {
        status: 503,
        data: { error: "AI descriptions are not configured on this server." },
      },
    });
    await user.click(aiButton());

    expect(
      await screen.findByText(/not configured on this server/i)
    ).toBeInTheDocument();
    // The whole folder analysis is unaffected and still appliable.
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
      screen.getByRole("checkbox", { name: /select figures\/figure1\.png/i })
    );
    await user.click(
      screen.getByRole("checkbox", { name: /select figures\/figure2\.png/i })
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
