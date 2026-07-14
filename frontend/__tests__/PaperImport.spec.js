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

describe("PaperImport (Publication Information for This Paper)", () => {
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

  it("asks anonymous users to sign in instead of showing controls", () => {
    renderImport({ authenticated: false });
    expect(
      screen.getByText(/sign in to import this paper/i)
    ).toBeInTheDocument();
    expect(screen.queryByLabelText(/doi/i)).not.toBeInTheDocument();
  });

  it("DOI import writes the canonical primary-paper record, never the form setter", async () => {
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
    // Canonical primary-paper bibliography (publishes as `reference`).
    expect(applied.referenceInfo.title).toBe("New Imported Title");
    expect(applied.referenceInfo.kind).toBe("journal");
    expect(applied.referenceInfo.doi).toBe("10.1234/qresp.demo");
    expect(applied.referenceInfo.authors).toContain("Lovelace");
    expect(applied.referenceInfo.publication).toContain(
      "Journal of Computing"
    );
    // The Reference form's setter is never used; only setAll via the adapter.
    expect(setReferenceInfo).not.toHaveBeenCalled();
    // Curation metadata stays manual/untouched.
    expect(applied.paperInfo.PIs).toBe("Giulia Galli");
    expect(applied.paperInfo.collections).toEqual([]);
    expect(applied.paperInfo.notebookFile).toBe("");
    expect(applied.curatorInfo).toEqual(state.curatorInfo);
    expect(applied.charts).toEqual(state.charts);
    expect(applied.license).toBe("CC-BY");
    expect(remountForms).toHaveBeenCalled();
  });

  it("offers a per-author PI picker, all unchecked by default", async () => {
    axios.post.mockResolvedValue({ data: doiResponse });
    const user = userEvent.setup();
    const { setAll } = renderImport();

    await fetchDoi(user);
    await screen.findByText(/proposed: new imported title/i);
    expect(
      screen.getByText(/add selected paper authors as principal investigators/i)
    ).toBeInTheDocument();
    const authorBox = screen.getByRole("checkbox", {
      name: /add author ada b\. lovelace as principal investigator/i,
    });
    expect(authorBox).not.toBeChecked();

    await user.click(applyButton());
    // Default apply: PIs unchanged.
    expect(setAll.mock.calls[0][0].paperInfo.PIs).toBe("Giulia Galli");
  });

  it("appends only the SELECTED authors to the existing PIs", async () => {
    axios.post.mockResolvedValue({ data: doiResponse });
    const user = userEvent.setup();
    const { setAll } = renderImport();

    await fetchDoi(user);
    await screen.findByText(/proposed: new imported title/i);
    await user.click(
      screen.getByRole("checkbox", {
        name: /add author ada b\. lovelace as principal investigator/i,
      })
    );
    await user.click(applyButton());
    const pis = setAll.mock.calls[0][0].paperInfo.PIs;
    // Appended, never replacing the existing PI.
    expect(pis).toContain("Giulia Galli");
    expect(pis).toContain("Lovelace");
    expect(pis.indexOf("Giulia Galli")).toBe(0);
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

  it("TeX import without a DOI suggests kind=preprint into the canonical record", async () => {
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
    const { setAll, setReferenceInfo } = renderImport();

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
    expect(applied.referenceInfo.title).toBe("Zip Title");
    expect(applied.referenceInfo.kind).toBe("preprint");
    // Nothing invented.
    expect(applied.referenceInfo.doi).toBe("");
    expect(applied.referenceInfo.year).toBeNull();
    expect(applied.referenceInfo.publication).toBe("");
    expect(setReferenceInfo).not.toHaveBeenCalled();
  });

  it("never overwrites a populated primary-paper field unless checked", async () => {
    axios.post.mockResolvedValue({ data: doiResponse });
    const state = baseState();
    state.referenceInfo.title = "My Existing Title";
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
    expect(applied.referenceInfo.title).toBe("My Existing Title");
    expect(applied.referenceInfo.doi).toBe("10.1234/qresp.demo");
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
