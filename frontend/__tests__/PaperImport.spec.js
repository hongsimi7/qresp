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
  publicationInfo: emptyBiblio(),
  referenceInfo: { ...emptyBiblio(), title: "A Cited Work",
                   doi: "10.9/cited" },
  documentation: "",
  charts: [{ id: "c0" }],
  tools: [],
  datasets: [],
  scripts: [],
  heads: [],
  workflow: { nodes: [], edges: [] },
  license: "CC-BY",
});

const doiResponse = {
  doi: "10.1234/qresp.demo",
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
  provenance: { title: "crossref", kind: "crossref" },
  alternatives: {},
  warnings: [],
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

const fetchDoi = async (user) => {
  await user.type(screen.getByLabelText(/doi/i), "10.1234/qresp.demo");
  await user.click(screen.getByRole("button", { name: /fetch doi/i }));
};

const applyButton = () =>
  screen.getByRole("button", { name: /apply to paper information/i });

describe("PaperImport (inside Add info about your paper)", () => {
  afterEach(() => jest.resetAllMocks());

  it("shows the DOI fetch and manuscript import controls", () => {
    renderImport();
    expect(
      screen.getByText(/import information for this paper/i)
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/doi/i)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /fetch doi/i })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /import manuscript source/i })
    ).toBeInTheDocument();
  });

  it("DOI import writes publicationInfo — never referenceInfo, never setReferenceInfo", async () => {
    axios.post.mockResolvedValue({ data: doiResponse });
    const user = userEvent.setup();
    const { setAll, remountForms, setReferenceInfo, state } = renderImport();

    await fetchDoi(user);
    expect(axios.post).toHaveBeenCalledWith("/api/import/doi", {
      doi: "10.1234/qresp.demo",
    });
    expect(
      await screen.findByText(/proposed: new imported title/i)
    ).toBeInTheDocument();
    expect(setAll).not.toHaveBeenCalled();

    await user.click(applyButton());
    expect(setAll).toHaveBeenCalledTimes(1);
    const applied = setAll.mock.calls[0][0];
    // PRIMARY paper metadata path:
    expect(applied.publicationInfo.title).toBe("New Imported Title");
    expect(applied.publicationInfo.kind).toBe("journal");
    expect(applied.publicationInfo.doi).toBe("10.1234/qresp.demo");
    expect(applied.publicationInfo.authors).toContain("Lovelace");
    expect(applied.publicationInfo.publication).toContain(
      "Journal of Computing"
    );
    // The cited-work slice is byte-identical to what the user had.
    expect(applied.referenceInfo).toEqual(state.referenceInfo);
    expect(applied.referenceInfo.title).toBe("A Cited Work");
    expect(setReferenceInfo).not.toHaveBeenCalled();
    // Untouchable slices stay untouched.
    expect(applied.curatorInfo).toEqual(state.curatorInfo);
    expect(applied.charts).toEqual(state.charts);
    expect(applied.license).toBe("CC-BY");
    expect(applied.paperInfo.collections).toEqual([]);
    expect(applied.paperInfo.notebookFile).toBe("");
    expect(remountForms).toHaveBeenCalled();
  });

  it("authors do NOT become PIs unless the explicit opt-in is checked", async () => {
    axios.post.mockResolvedValue({ data: doiResponse });
    const user = userEvent.setup();
    const { setAll } = renderImport();

    await fetchDoi(user);
    await screen.findByText(/proposed: new imported title/i);
    const optIn = screen.getByRole("checkbox", {
      name: /apply use imported authors as principal investigators/i,
    });
    expect(optIn).not.toBeChecked();

    await user.click(applyButton());
    // Default apply: PIs unchanged.
    expect(setAll.mock.calls[0][0].paperInfo.PIs).toBe("Giulia Galli");
  });

  it("copies authors into PIs when the opt-in IS checked", async () => {
    axios.post.mockResolvedValue({ data: doiResponse });
    const user = userEvent.setup();
    const { setAll } = renderImport();

    await fetchDoi(user);
    await screen.findByText(/proposed: new imported title/i);
    await user.click(
      screen.getByRole("checkbox", {
        name: /apply use imported authors as principal investigators/i,
      })
    );
    await user.click(applyButton());
    expect(setAll.mock.calls[0][0].paperInfo.PIs).toContain("Lovelace");
  });

  it("tags are suggestions: default unchecked, added only when selected", async () => {
    axios.post.mockResolvedValue({ data: doiResponse });
    const user = userEvent.setup();
    const first = renderImport();

    await fetchDoi(user);
    await screen.findByText(/proposed: new imported title/i);
    const tagBox = screen.getByRole("checkbox", {
      name: /apply tag suggestions/i,
    });
    expect(tagBox).not.toBeChecked();
    await user.click(applyButton());
    expect(first.setAll.mock.calls[0][0].paperInfo.tags).toEqual([]);
  });

  it("adds tags after explicit selection", async () => {
    axios.post.mockResolvedValue({ data: doiResponse });
    const user = userEvent.setup();
    const { setAll } = renderImport();

    await fetchDoi(user);
    await screen.findByText(/proposed: new imported title/i);
    await user.click(
      screen.getByRole("checkbox", { name: /apply tag suggestions/i })
    );
    await user.click(applyButton());
    expect(setAll.mock.calls[0][0].paperInfo.tags).toEqual([
      "Materials Science",
    ]);
  });

  it("TeX import without a DOI suggests kind=preprint into publicationInfo", async () => {
    const texContent = "\\title{Zip Title}\\begin{document}\\end{document}";
    axios.post.mockResolvedValue({
      data: {
        proposal: { title: "Zip Title" },
        provenance: { title: "manuscript" },
        alternatives: {},
        warnings: ["No DOI was found in the manuscript itself"],
        main_file: "paper.tex",
        main_candidates: ["paper.tex"],
        included_files: [],
        doi_candidates: [],
      },
    });
    const user = userEvent.setup();
    const { setAll, setReferenceInfo, state } = renderImport();

    const file = new File([texContent], "paper.tex", { type: "text/x-tex" });
    await user.upload(document.getElementById("paper-import-file"), file);

    await waitFor(() =>
      expect(axios.post).toHaveBeenCalledWith("/api/import/manuscript", {
        filename: "paper.tex",
        content_base64: btoa(texContent),
      })
    );
    expect(await screen.findByText(/proposed: zip title/i)).toBeInTheDocument();
    expect(screen.getByText(/^proposed: preprint$/i)).toBeInTheDocument();
    expect(screen.getByText("suggested")).toBeInTheDocument();

    await user.click(applyButton());
    const applied = setAll.mock.calls[0][0];
    expect(applied.publicationInfo.title).toBe("Zip Title");
    expect(applied.publicationInfo.kind).toBe("preprint");
    // Nothing invented, and the cited work stays untouched.
    expect(applied.publicationInfo.doi).toBe("");
    expect(applied.publicationInfo.year).toBeNull();
    expect(applied.referenceInfo).toEqual(state.referenceInfo);
    expect(setReferenceInfo).not.toHaveBeenCalled();
  });

  it("never overwrites a populated primary-paper field unless checked", async () => {
    axios.post.mockResolvedValue({ data: doiResponse });
    const state = baseState();
    state.publicationInfo.title = "My Existing Title";
    const user = userEvent.setup();
    const { setAll } = renderImport({ state });

    await fetchDoi(user);
    await screen.findByText(/proposed: new imported title/i);
    expect(
      screen.getByText(/current value kept unless checked: my existing title/i)
    ).toBeInTheDocument();
    expect(
      screen.getByRole("checkbox", { name: /apply title/i })
    ).not.toBeChecked();

    await user.click(applyButton());
    const applied = setAll.mock.calls[0][0];
    expect(applied.publicationInfo.title).toBe("My Existing Title");
    expect(applied.publicationInfo.doi).toBe("10.1234/qresp.demo");
  });

  it("lists PaperStack and notebook as manual items in the checklist after apply", async () => {
    axios.post.mockResolvedValue({ data: doiResponse });
    const user = userEvent.setup();
    renderImport();

    await fetchDoi(user);
    await screen.findByText(/proposed: new imported title/i);
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
    expect(screen.getByText(/at least one dataset/i)).toBeInTheDocument();
    expect(
      screen.getByText(/save draft works even while fields are missing/i)
    ).toBeInTheDocument();
  });

  it("keeps open-form values by applying on top of the collected draft state", async () => {
    axios.post.mockResolvedValue({ data: doiResponse });
    const state = baseState();
    state.paperInfo.notebookFile = "typed-not-saved.ipynb";
    const user = userEvent.setup();
    const { setAll, collectDraftState } = renderImport({ state });

    await fetchDoi(user);
    await screen.findByText(/proposed: new imported title/i);
    await user.click(applyButton());
    expect(collectDraftState).toHaveBeenCalled();
    expect(setAll.mock.calls[0][0].paperInfo.notebookFile).toBe(
      "typed-not-saved.ipynb"
    );
  });

  it("cancel applies nothing", async () => {
    axios.post.mockResolvedValue({ data: doiResponse });
    const user = userEvent.setup();
    const { setAll } = renderImport();

    await fetchDoi(user);
    await screen.findByText(/proposed: new imported title/i);
    await user.click(screen.getByRole("button", { name: /^cancel$/i }));
    expect(setAll).not.toHaveBeenCalled();
  });

  it("surfaces backend errors clearly", async () => {
    axios.post.mockRejectedValue({
      response: {
        status: 400,
        data: { error: "This DOI was not found in the scholarly metadata registry." },
      },
    });
    const user = userEvent.setup();
    renderImport();
    await fetchDoi(user);
    expect(
      await screen.findByText(/not found in the scholarly metadata registry/i)
    ).toBeInTheDocument();
  });
});
