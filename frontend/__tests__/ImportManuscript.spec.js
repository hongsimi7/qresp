import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

jest.mock("axios");
import axios from "axios";

import ImportManuscript from "../components/CuratorElements/ImportManuscript";
import CuratorContext from "../Context/Curator/curatorContext";

const baseState = () => ({
  curatorInfo: {
    firstName: "",
    middleName: "",
    lastName: "",
    emailId: "",
    affiliation: "",
  },
  fileServerPath: "",
  paperInfo: { PIs: "", collections: [], tags: [], notebookFile: "",
               notebookPath: "" },
  referenceInfo: { kind: "", doi: "", authors: "", title: "",
                   publication: "", year: null, url: "", abstract: "" },
  documentation: "",
  charts: [],
  tools: [],
  datasets: [],
  scripts: [],
  heads: [],
  workflow: { nodes: [], edges: [] },
  license: "",
});

const doiResponse = {
  doi: "10.1234/qresp.demo",
  proposal: {
    title: "New Imported Title",
    authors: [
      { firstName: "Ada", middleName: "B.", lastName: "Lovelace" },
      { firstName: "Charles", middleName: "", lastName: "Babbage" },
    ],
    journal: "Journal of Computing",
    year: 2021,
    volume: "12",
    pages: "100-110",
    abstract: "Registry abstract.",
    doi: "10.1234/qresp.demo",
    tags: ["Materials Science"],
  },
  provenance: { title: "crossref" },
  alternatives: {},
  warnings: [],
};

const renderDialog = ({ state = baseState(), onClose = jest.fn() } = {}) => {
  const setAll = jest.fn();
  const remountForms = jest.fn();
  const collectDraftState = jest.fn(() => state);
  render(
    <CuratorContext.Provider
      value={{ collectDraftState, setAll, remountForms }}
    >
      <ImportManuscript open onClose={onClose} />
    </CuratorContext.Provider>
  );
  return { setAll, remountForms, collectDraftState, onClose };
};

const lookup = async (user) => {
  await user.type(screen.getByLabelText(/doi/i), "10.1234/qresp.demo");
  await user.click(screen.getByRole("button", { name: /look up doi/i }));
};

describe("ImportManuscript", () => {
  afterEach(() => jest.resetAllMocks());

  it("previews DOI proposals and applies them only on explicit Apply", async () => {
    axios.post.mockResolvedValue({ data: doiResponse });
    const user = userEvent.setup();
    const { setAll, remountForms } = renderDialog();

    await lookup(user);
    expect(axios.post).toHaveBeenCalledWith("/api/import/doi", {
      doi: "10.1234/qresp.demo",
    });
    // Review screen: proposal shown, nothing applied yet.
    expect(
      await screen.findByText(/proposed: new imported title/i)
    ).toBeInTheDocument();
    expect(setAll).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: /apply to draft/i }));
    expect(setAll).toHaveBeenCalledTimes(1);
    const applied = setAll.mock.calls[0][0];
    expect(applied.referenceInfo.title).toBe("New Imported Title");
    expect(applied.referenceInfo.authors).toContain("Lovelace");
    expect(applied.referenceInfo.doi).toBe("10.1234/qresp.demo");
    expect(applied.referenceInfo.publication).toContain(
      "Journal of Computing"
    );
    expect(applied.paperInfo.tags).toEqual(["Materials Science"]);
    // Forms re-seed from the new state.
    expect(remountForms).toHaveBeenCalled();
  });

  it("never overwrites a populated field unless the user checks it", async () => {
    axios.post.mockResolvedValue({ data: doiResponse });
    const state = baseState();
    state.referenceInfo.title = "My Existing Title";
    const user = userEvent.setup();
    const { setAll } = renderDialog({ state });

    await lookup(user);
    // Conflict is visible: both values shown, checkbox defaults OFF.
    expect(
      await screen.findByText(/proposed: new imported title/i)
    ).toBeInTheDocument();
    expect(
      screen.getByText(/current value kept unless checked: my existing title/i)
    ).toBeInTheDocument();
    const titleBox = screen.getByRole("checkbox", { name: /apply title/i });
    expect(titleBox).not.toBeChecked();

    await user.click(screen.getByRole("button", { name: /apply to draft/i }));
    const applied = setAll.mock.calls[0][0];
    expect(applied.referenceInfo.title).toBe("My Existing Title");
    // Empty fields were still filled.
    expect(applied.referenceInfo.doi).toBe("10.1234/qresp.demo");
  });

  it("appends tag suggestions without replacing existing tags", async () => {
    axios.post.mockResolvedValue({
      data: {
        ...doiResponse,
        proposal: { ...doiResponse.proposal, tags: ["existing", "fresh"] },
      },
    });
    const state = baseState();
    state.paperInfo.tags = ["existing"];
    const user = userEvent.setup();
    const { setAll } = renderDialog({ state });

    await lookup(user);
    await screen.findByText(/proposed: new imported title/i);
    await user.click(screen.getByRole("button", { name: /apply to draft/i }));
    expect(setAll.mock.calls[0][0].paperInfo.tags).toEqual([
      "existing",
      "fresh",
    ]);
  });

  it("shows the missing-information checklist after applying", async () => {
    axios.post.mockResolvedValue({ data: doiResponse });
    const user = userEvent.setup();
    renderDialog();

    await lookup(user);
    await screen.findByText(/proposed: new imported title/i);
    await user.click(screen.getByRole("button", { name: /apply to draft/i }));

    expect(
      await screen.findByText(/still needed before this record can be published/i)
    ).toBeInTheDocument();
    expect(screen.getByText(/at least one chart/i)).toBeInTheDocument();
    expect(screen.getByText(/at least one dataset/i)).toBeInTheDocument();
    expect(screen.getByText(/license/i)).toBeInTheDocument();
    // Draft saving is explicitly not blocked.
    expect(
      screen.getByText(/save draft works even while fields are missing/i)
    ).toBeInTheDocument();
  });

  it("cancels without touching the draft", async () => {
    axios.post.mockResolvedValue({ data: doiResponse });
    const user = userEvent.setup();
    const { setAll, onClose } = renderDialog();

    await lookup(user);
    await screen.findByText(/proposed: new imported title/i);
    await user.click(screen.getByRole("button", { name: /^cancel$/i }));
    expect(setAll).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it("imports a .tex file as base64 and previews manuscript proposals", async () => {
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
    const { setAll } = renderDialog();

    const file = new File([texContent], "paper.tex", { type: "text/x-tex" });
    const input = document.getElementById("import-manuscript-file");
    await user.upload(input, file);

    await waitFor(() =>
      expect(axios.post).toHaveBeenCalledWith("/api/import/manuscript", {
        filename: "paper.tex",
        content_base64: btoa(texContent),
      })
    );
    expect(
      await screen.findByText(/proposed: zip title/i)
    ).toBeInTheDocument();
    expect(screen.getByText(/read from: paper\.tex/i)).toBeInTheDocument();
    expect(screen.getByText(/no doi was found/i)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /apply to draft/i }));
    expect(setAll.mock.calls[0][0].referenceInfo.title).toBe("Zip Title");
  });

  it("surfaces backend errors clearly", async () => {
    axios.post.mockRejectedValue({
      response: {
        status: 400,
        data: { error: "The archive contains unsafe relative paths and was rejected." },
      },
    });
    const user = userEvent.setup();
    renderDialog();

    const file = new File(["zipbytes"], "project.zip",
                          { type: "application/zip" });
    await user.upload(document.getElementById("import-manuscript-file"), file);
    expect(
      await screen.findByText(/unsafe relative paths/i)
    ).toBeInTheDocument();
  });
});
