import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import PaperInfoForm from "../components/CuratorForms/PaperInfoForm";
import CuratorContext from "../Context/Curator/curatorContext";
import SourceTreeContext from "../Context/SourceTree/SourceTreeContext";

// Regression for curator edit mode: state keeps collections/tags as ARRAYS
// (a raw paper loads collections: ["MICCOM"]), while this form edits them as
// comma-separated strings. The missing join for collections made yup fail
// with `collections must be a `string` type` and blocked saving.
const renderForm = (paperInfoOverrides = {}, publicationOverrides = {}) => {
  const setPaperInfo = jest.fn();
  const setPublicationInfo = jest.fn();
  const curator = {
    paperInfo: {
      PIs: "Giulia Galli",
      collections: ["MICCOM"],
      tags: ["DFT"],
      notebookFile: "",
      notebookPath: "",
      ...paperInfoOverrides,
    },
    publicationInfo: {
      kind: "",
      doi: "",
      authors: "",
      title: "",
      publication: "",
      year: null,
      url: "",
      abstract: "",
      ...publicationOverrides,
    },
    setPaperInfo,
    setPublicationInfo,
    setReferenceAuthors: jest.fn(),
    fileServerPath: "",
  };
  const sourceTree = {
    setSaveMethod: jest.fn(),
    openSelector: jest.fn(),
    HideSelector: jest.fn(),
  };
  render(
    <CuratorContext.Provider value={curator}>
      <SourceTreeContext.Provider value={sourceTree}>
        <PaperInfoForm editor={jest.fn()} />
      </SourceTreeContext.Provider>
    </CuratorContext.Provider>
  );
  return { setPaperInfo, setPublicationInfo };
};

describe("PaperInfoForm with array-backed state (edit mode)", () => {
  it("hosts the primary-paper import area inside Add info about your paper", () => {
    renderForm();
    expect(
      screen.getByText(/import information for this paper/i)
    ).toBeInTheDocument();
    // Without an authenticated session the area explains sign-in instead of
    // showing the controls (the controls themselves are covered in
    // PaperImport.spec with an AuthContext provider).
    expect(
      screen.getByText(/sign in to import this paper/i)
    ).toBeInTheDocument();
    // The existing paper-info controls all remain.
    expect(
      screen.getByPlaceholderText(/enter collection to which project belongs/i)
    ).toBeInTheDocument();
    expect(
      screen.getByPlaceholderText(/ener tags for the project/i)
    ).toBeInTheDocument();
    expect(
      screen.getByPlaceholderText(/enter main notebook filename/i)
    ).toBeInTheDocument();
    expect(screen.getAllByPlaceholderText("Enter first name").length)
      .toBeGreaterThan(0);
  });

  it("displays loaded collections and tags as comma-separated strings", () => {
    renderForm({ collections: ["MICCOM", "PARADIM"] });
    // The legacy TextInput overrides InputProps.id, which breaks the MUI
    // label-input pairing, so query by placeholder instead of label.
    expect(
      screen.getByPlaceholderText(/enter collection to which project belongs/i)
    ).toHaveValue("MICCOM, PARADIM");
    expect(screen.getByPlaceholderText(/ener tags for the project/i)).toHaveValue(
      "DFT"
    );
  });

  it("renders one clean row per principal investigator", () => {
    renderForm({ PIs: "Alpha Beta, Gamma Delta" });
    const firstNames = screen.getAllByPlaceholderText("Enter first name");
    expect(firstNames).toHaveLength(2);
    expect(firstNames[0]).toHaveValue("Alpha");
    expect(firstNames[1]).toHaveValue("Gamma");
    expect(screen.getAllByPlaceholderText("Enter last name")).toHaveLength(2);
  });

  it("saves a loaded record without type errors and round-trips arrays", async () => {
    const { setPaperInfo } = renderForm();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /^save$/i }));
    await waitFor(() => expect(setPaperInfo).toHaveBeenCalled());
    expect(setPaperInfo).toHaveBeenCalledWith(
      expect.objectContaining({
        collections: ["MICCOM"],
        tags: ["DFT"],
      })
    );
  });

  it("shows the primary paper's bibliographic fields and saves them via setPublicationInfo", async () => {
    const { setPaperInfo, setPublicationInfo } = renderForm(
      {},
      {
        title: "Loaded Primary Title",
        authors: "Ada Lovelace",
        doi: "10.1/x",
        year: 2016,
      }
    );
    // Imported/loaded primary-paper fields render inside Paper Information.
    expect(
      screen.getByPlaceholderText(/enter the title of this paper/i)
    ).toHaveValue("Loaded Primary Title");
    expect(
      screen.getByPlaceholderText(/enter authors, comma separated/i)
    ).toHaveValue("Ada Lovelace");
    expect(
      screen.getByPlaceholderText(/enter doi \(e\.g\./i)
    ).toHaveValue("10.1/x");
    expect(
      screen.getByPlaceholderText(/enter publication year/i)
    ).toHaveValue("2016");

    const user = userEvent.setup();
    await user.type(
      screen.getByPlaceholderText(/enter url of the paper/i),
      "https://example.org/paper"
    );
    await user.click(screen.getByRole("button", { name: /^save$/i }));
    await waitFor(() => expect(setPublicationInfo).toHaveBeenCalled());
    expect(setPublicationInfo).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Loaded Primary Title",
        year: 2016,
        url: "https://example.org/paper",
      })
    );
    // paperInfo keeps its own fields; publicationInfo values are not mixed in.
    const paperArg = setPaperInfo.mock.calls[0][0];
    expect(paperArg).not.toHaveProperty("publicationInfo");
    expect(paperArg).not.toHaveProperty("title");
  });
});
