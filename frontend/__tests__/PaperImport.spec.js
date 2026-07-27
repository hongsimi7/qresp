import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

jest.mock("axios");
import axios from "axios";

import PaperImport from "../components/CuratorElements/PaperImport";
import CuratorContext from "../Context/Curator/curatorContext";
import AuthContext from "../Context/Auth/authContext";

const emptyBiblio = () => ({
  kind: "",
  doi: "",
  authors: "",
  title: "",
  publication: "",
  year: null,
  url: "",
  abstract: "",
});

const baseState = () => ({
  curatorInfo: {
    firstName: "",
    middleName: "",
    lastName: "",
    emailId: "",
    affiliation: "",
  },
  fileServerPath: "",
  paperInfo: { PIs: "Giulia Galli", collections: [], tags: [],
               notebookFile: "", notebookPath: "" },
  referenceInfo: emptyBiblio(),
  documentation: "",
  charts: [{ id: "c0" }],
  tools: [],
  datasets: [],
  scripts: [],
  heads: [],
  workflow: { nodes: [], edges: [] },
  license: "CC-BY",
});

const TEX_CONTENT = "\\title{X}\\begin{document}body\\end{document}";

// A rich manuscript-import response (e.g. the manuscript carried its own
// DOI, so the registry filled the bibliographic fields).
const richManuscriptResponse = {
  proposal: {
    kind: "journal",
    title: "New Imported Title",
    authors: [
      { firstName: "Ada", middleName: "B.", lastName: "Lovelace" },
    ],
    journal: "Journal of Computing",
    year: 2021,
    volume: "12",
    pages: "100-110",
    abstract: "Registry abstract.",
    doi: "10.1234/qresp.demo",
    tags: ["Materials Science"],
  },
  provenance: { title: "manuscript", kind: "crossref" },
  alternatives: {},
  warnings: [],
  main_file: "paper.tex",
  main_candidates: ["paper.tex"],
  included_files: [],
  doi_candidates: [],
};

const bareManuscriptResponse = {
  proposal: { title: "Zip Title" },
  provenance: { title: "manuscript" },
  alternatives: {},
  warnings: ["No DOI was found in the manuscript itself"],
  main_file: "paper.tex",
  main_candidates: ["paper.tex"],
  included_files: [],
  doi_candidates: [],
};

const renderImport = ({ state = baseState(), authenticated = true } = {}) => {
  const setAll = jest.fn();
  const remountForms = jest.fn();
  const setReferenceInfo = jest.fn();
  const collectDraftState = jest.fn(() => state);
  render(
    <AuthContext.Provider value={{ authenticated }}>
      <CuratorContext.Provider
        value={{ collectDraftState, setAll, remountForms, setReferenceInfo }}
      >
        <PaperImport />
      </CuratorContext.Provider>
    </AuthContext.Provider>
  );
  return { setAll, remountForms, setReferenceInfo, collectDraftState, state };
};

const importManuscript = async (user, response) => {
  axios.post.mockResolvedValueOnce({ data: response });
  const file = new File([TEX_CONTENT], "paper.tex", { type: "text/x-tex" });
  await user.upload(document.getElementById("paper-import-file"), file);
  await screen.findByText(/review manuscript import/i);
};

const applyButton = () =>
  screen.getByRole("button", { name: /apply to paper information/i });

describe("PaperImport (manuscript source import)", () => {
  afterEach(() => jest.resetAllMocks());

  it("offers ONLY the manuscript chooser — no DOI input or Fetch DOI here", () => {
    renderImport();
    // Case-sensitive: the heading is Title Case, the button is sentence case.
    expect(
      screen.getByText(/^Import Manuscript Source$/)
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /import manuscript source/i })
    ).toBeInTheDocument();
    // The canonical DOI field lives in the Publication Information form.
    expect(screen.queryByLabelText(/doi/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /fetch doi/i })
    ).not.toBeInTheDocument();
    expect(
      screen.getByText(/use the doi field.s fetch button below/i)
    ).toBeInTheDocument();
  });

  it("asks anonymous users to sign in instead of showing controls", () => {
    renderImport({ authenticated: false });
    expect(
      screen.getByText(/sign in to import this paper/i)
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /import manuscript source/i })
    ).not.toBeInTheDocument();
  });

  it("sends the file base64 to the import endpoint and reviews before applying", async () => {
    const user = userEvent.setup();
    const { setAll, remountForms, setReferenceInfo, state } = renderImport();

    await importManuscript(user, richManuscriptResponse);
    expect(axios.post).toHaveBeenCalledWith("/api/import/manuscript", {
      filename: "paper.tex",
      content_base64: btoa(TEX_CONTENT),
    });
    expect(
      await screen.findByText(/proposed: new imported title/i)
    ).toBeInTheDocument();
    expect(setAll).not.toHaveBeenCalled();

    await user.click(applyButton());
    const applied = setAll.mock.calls[0][0];
    // Canonical primary-paper bibliography (publishes as `reference`).
    expect(applied.referenceInfo.title).toBe("New Imported Title");
    expect(applied.referenceInfo.kind).toBe("journal");
    expect(applied.referenceInfo.doi).toBe("10.1234/qresp.demo");
    expect(applied.referenceInfo.authors).toContain("Lovelace");
    expect(setReferenceInfo).not.toHaveBeenCalled();
    // Curation metadata stays manual/untouched.
    expect(applied.paperInfo.PIs).toBe("Giulia Galli");
    expect(applied.paperInfo.collections).toEqual([]);
    expect(applied.paperInfo.notebookFile).toBe("");
    expect(applied.curatorInfo).toEqual(state.curatorInfo);
    expect(applied.license).toBe("CC-BY");
    expect(remountForms).toHaveBeenCalled();
  });

  it("offers a per-author PI picker, all unchecked by default", async () => {
    const user = userEvent.setup();
    const { setAll } = renderImport();

    await importManuscript(user, richManuscriptResponse);
    const authorBox = screen.getByRole("checkbox", {
      name: /add author ada b\. lovelace as principal investigator/i,
    });
    expect(authorBox).not.toBeChecked();

    await user.click(applyButton());
    expect(setAll.mock.calls[0][0].paperInfo.PIs).toBe("Giulia Galli");
  });

  it("appends only the SELECTED authors to the existing PIs", async () => {
    const user = userEvent.setup();
    const { setAll } = renderImport();

    await importManuscript(user, richManuscriptResponse);
    await user.click(
      screen.getByRole("checkbox", {
        name: /add author ada b\. lovelace as principal investigator/i,
      })
    );
    await user.click(applyButton());
    const pis = setAll.mock.calls[0][0].paperInfo.PIs;
    expect(pis).toContain("Giulia Galli");
    expect(pis).toContain("Lovelace");
    expect(pis.indexOf("Giulia Galli")).toBe(0);
  });

  it("tags are suggestions: default unchecked, added only when selected", async () => {
    const user = userEvent.setup();
    const { setAll } = renderImport();

    await importManuscript(user, richManuscriptResponse);
    expect(
      screen.getByRole("checkbox", { name: /apply tag suggestions/i })
    ).not.toBeChecked();
    await user.click(applyButton());
    expect(setAll.mock.calls[0][0].paperInfo.tags).toEqual([]);
  });

  it("adds tags after explicit selection", async () => {
    const user = userEvent.setup();
    const { setAll } = renderImport();

    await importManuscript(user, richManuscriptResponse);
    await user.click(
      screen.getByRole("checkbox", { name: /apply tag suggestions/i })
    );
    await user.click(applyButton());
    expect(setAll.mock.calls[0][0].paperInfo.tags).toEqual([
      "Materials Science",
    ]);
  });

  it("suggests kind=preprint for a manuscript without a DOI", async () => {
    const user = userEvent.setup();
    const { setAll } = renderImport();

    await importManuscript(user, bareManuscriptResponse);
    expect(screen.getByText(/^proposed: preprint$/i)).toBeInTheDocument();
    expect(screen.getByText("suggested")).toBeInTheDocument();

    await user.click(applyButton());
    const applied = setAll.mock.calls[0][0];
    expect(applied.referenceInfo.title).toBe("Zip Title");
    expect(applied.referenceInfo.kind).toBe("preprint");
    expect(applied.referenceInfo.doi).toBe("");
    expect(applied.referenceInfo.year).toBeNull();
  });

  it("never overwrites a populated primary-paper field unless checked", async () => {
    const state = baseState();
    state.referenceInfo.title = "My Existing Title";
    const user = userEvent.setup();
    const { setAll } = renderImport({ state });

    await importManuscript(user, richManuscriptResponse);
    expect(
      screen.getByText(/current value kept unless checked: my existing title/i)
    ).toBeInTheDocument();
    expect(
      screen.getByRole("checkbox", { name: /apply title/i })
    ).not.toBeChecked();

    await user.click(applyButton());
    const applied = setAll.mock.calls[0][0];
    expect(applied.referenceInfo.title).toBe("My Existing Title");
    expect(applied.referenceInfo.doi).toBe("10.1234/qresp.demo");
  });

  it("lists PaperStack and notebook as manual items in the checklist after apply", async () => {
    const user = userEvent.setup();
    renderImport();

    await importManuscript(user, richManuscriptResponse);
    await user.click(applyButton());

    expect(
      await screen.findByText(/still needed before this record can be published/i)
    ).toBeInTheDocument();
    expect(
      screen.getByText(/paperstack \/ collections \(manual\)/i)
    ).toBeInTheDocument();
    expect(
      screen.getByText(/main notebook file \(manual\)/i)
    ).toBeInTheDocument();
  });

  it("keeps open-form values by applying on top of the collected draft state", async () => {
    const state = baseState();
    state.paperInfo.notebookFile = "typed-not-saved.ipynb";
    const user = userEvent.setup();
    const { setAll, collectDraftState } = renderImport({ state });

    await importManuscript(user, richManuscriptResponse);
    await user.click(applyButton());
    expect(collectDraftState).toHaveBeenCalled();
    expect(setAll.mock.calls[0][0].paperInfo.notebookFile).toBe(
      "typed-not-saved.ipynb"
    );
  });

  it("manuscript AI consent defaults OFF, gates the fetch, and speaks of EXCERPTS", async () => {
    const user = userEvent.setup();
    const { setAll } = renderImport();

    await importManuscript(user, bareManuscriptResponse);
    const consent = screen.getByRole("checkbox", {
      name: /analyze extracted manuscript text with ai/i,
    });
    expect(consent).not.toBeChecked();
    // The wording is honest and names the provider: selected metadata plus
    // bounded excerpts, not the full document, never the original file.
    expect(
      screen.getByText(/bounded excerpts of the text extracted/i)
    ).toBeInTheDocument();
    expect(
      screen.getByText(/not the full document and never the original file/i)
    ).toBeInTheDocument();
    expect(screen.getByText(/are sent to Gemini/i)).toBeInTheDocument();
    const fetchButton = screen.getByRole("button", {
      name: /get ai keyword suggestions/i,
    });
    expect(fetchButton).toBeDisabled();
    expect(axios.post).toHaveBeenCalledTimes(1); // only the import call

    axios.post.mockResolvedValueOnce({
      data: { keywords: ["Ice Nucleation"], warnings: [] },
    });
    await user.click(consent);
    await user.click(fetchButton);
    await waitFor(() =>
      expect(axios.post).toHaveBeenLastCalledWith("/api/assist/keywords", {
        title: "Zip Title",
        abstract: "",
        filename: "paper.tex",
        content_base64: btoa(TEX_CONTENT),
      })
    );
    const aiBox = await screen.findByRole("checkbox", {
      name: /apply ai keyword ice nucleation/i,
    });
    expect(aiBox).not.toBeChecked();
    await user.click(aiBox);
    await user.click(applyButton());
    expect(setAll.mock.calls[0][0].paperInfo.tags).toEqual([
      "Ice Nucleation",
    ]);
  });

  it("shows the unconfigured-AI message clearly inside the review", async () => {
    const user = userEvent.setup();
    renderImport();

    await importManuscript(user, bareManuscriptResponse);
    axios.post.mockRejectedValueOnce({
      response: {
        status: 503,
        data: {
          error: "AI keyword suggestions are not configured on this server.",
        },
      },
    });
    await user.click(
      screen.getByRole("checkbox", {
        name: /analyze extracted manuscript text with ai/i,
      })
    );
    await user.click(
      screen.getByRole("button", { name: /get ai keyword suggestions/i })
    );
    expect(
      await screen.findByText(/not configured on this server/i)
    ).toBeInTheDocument();
  });

  it("cancel applies nothing", async () => {
    const user = userEvent.setup();
    const { setAll } = renderImport();

    await importManuscript(user, richManuscriptResponse);
    await user.click(screen.getByRole("button", { name: /^cancel$/i }));
    expect(setAll).not.toHaveBeenCalled();
  });

  it("surfaces backend errors clearly", async () => {
    axios.post.mockRejectedValueOnce({
      response: {
        status: 400,
        data: { error: "The archive contains unsafe relative paths and was rejected." },
      },
    });
    const user = userEvent.setup();
    renderImport();
    const file = new File(["zip"], "project.zip", { type: "application/zip" });
    await user.upload(document.getElementById("paper-import-file"), file);
    expect(
      await screen.findByText(/unsafe relative paths/i)
    ).toBeInTheDocument();
  });
});
