import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import ReferenceInfoForm from "../components/CuratorForms/ReferenceInfoForm";
import CuratorContext from "../Context/Curator/curatorContext";
import AlertContext from "../Context/Alert/alertContext";
import LoadingContext from "../Context/Loading/loadingContext";

// Regression: with a prefilled reference (curator edit mode, or re-opening a
// saved section), kind/title/doi/url/abstract lived only in defaultValue
// attrs — never in RHF state — so Save silently failed their required
// checks even though every field looked filled.
const filledReference = {
  kind: "journal",
  doi: "10.1021/jacs.6b00225",
  authors: "Alex Gaiduk",
  title: "Photoelectron Spectra",
  publication: "JACS 2016, 138 ,6912-6915",
  year: 2016,
  url: "",
  abstract: "An abstract",
};

const renderForm = (referenceInfo, editor = jest.fn()) => {
  const setReferenceInfo = jest.fn();
  render(
    <CuratorContext.Provider value={{ referenceInfo, setReferenceInfo }}>
      <AlertContext.Provider value={{ setAlert: jest.fn() }}>
        <LoadingContext.Provider
          value={{ showLoader: jest.fn(), hideLoader: jest.fn() }}
        >
          <ReferenceInfoForm editor={editor} />
        </LoadingContext.Provider>
      </AlertContext.Provider>
    </CuratorContext.Provider>
  );
  return { setReferenceInfo, editor };
};

describe("ReferenceInfoForm", () => {
  it("renders exactly ONE primary-paper DOI input (the canonical field with Fetch)", () => {
    renderForm(filledReference);
    // The section heading says what it is, and hosts the manuscript import.
    expect(
      screen.getByText(/publication information for this paper/i)
    ).toBeInTheDocument();
    expect(
      screen.getByText(/^import manuscript source$/i)
    ).toBeInTheDocument();
    // One canonical DOI input with its Fetch button...
    expect(
      screen.getAllByPlaceholderText(/enter doi of the paper/i)
    ).toHaveLength(1);
    expect(screen.getByRole("button", { name: /^fetch$/i })).toBeInTheDocument();
    // ...and no duplicate DOI entry point in the import card.
    expect(
      screen.queryByPlaceholderText(/10\.1234\/abcd/i)
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /fetch doi/i })
    ).not.toBeInTheDocument();
  });

  it("saves a prefilled reference without retyping anything", async () => {
    const { setReferenceInfo, editor } = renderForm(filledReference);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /^save$/i }));
    await waitFor(() => expect(setReferenceInfo).toHaveBeenCalled());
    expect(setReferenceInfo).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "journal",
        title: "Photoelectron Spectra",
        doi: "10.1021/jacs.6b00225",
        abstract: "An abstract",
        year: 2016,
      })
    );
    expect(editor).toHaveBeenCalled();
    expect(screen.queryAllByText("Required")).toHaveLength(0);
  });

  it("an empty optional DOI/URL does not block saving", async () => {
    const { setReferenceInfo } = renderForm({
      ...filledReference,
      doi: "",
      url: "",
    });
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /^save$/i }));
    await waitFor(() => expect(setReferenceInfo).toHaveBeenCalled());
  });

  it("still blocks saving and shows errors when required fields are missing", async () => {
    const { setReferenceInfo, editor } = renderForm({
      kind: "",
      doi: "",
      authors: "",
      title: "",
      publication: "",
      year: null,
      url: "",
      abstract: "",
    });
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /^save$/i }));
    await waitFor(() =>
      expect(screen.queryAllByText("Required").length).toBeGreaterThan(0)
    );
    expect(setReferenceInfo).not.toHaveBeenCalled();
    expect(editor).not.toHaveBeenCalled();
  });
});
