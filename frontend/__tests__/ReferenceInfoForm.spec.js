import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

jest.mock("axios");
import axios from "axios";

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

  // Staging regression: the canonical DOI field rejected a pasted
  // https://doi.org/... URL ("Please enter a valid DOI") because the yup rule
  // matched a BARE DOI with no normalization step first.
  describe("DOI normalization", () => {
    // The shared axios mock keeps its call history across tests in this file.
    beforeEach(() => jest.clearAllMocks());

    const BARE = "10.1021/acs.nanolett.7b00283";
    const doiField = () =>
      screen.getByPlaceholderText(/enter doi of the paper/i);

    it.each([
      ["a bare DOI", BARE],
      ["a doi: prefixed DOI", `doi:${BARE}`],
      ["an https doi.org URL", `https://doi.org/${BARE}`],
      ["an http dx.doi.org URL", `http://dx.doi.org/${BARE}`],
      ["a padded resolver URL", `  https://doi.org/${BARE}  `],
    ])("accepts %s and saves the normalized bare DOI", async (_label, typed) => {
      const { setReferenceInfo } = renderForm({ ...filledReference, doi: "" });
      const user = userEvent.setup();
      await user.type(doiField(), typed);
      await user.click(screen.getByRole("button", { name: /^save$/i }));
      await waitFor(() => expect(setReferenceInfo).toHaveBeenCalled());
      expect(setReferenceInfo.mock.calls[0][0].doi).toBe(BARE);
      expect(
        screen.queryByText(/please enter a valid doi/i)
      ).not.toBeInTheDocument();
    });

    it("still rejects a non-DOI URL", async () => {
      const { setReferenceInfo } = renderForm({
        ...filledReference,
        doi: "",
      });
      const user = userEvent.setup();
      await user.type(doiField(), "https://example.com/not-a-doi");
      await user.click(screen.getByRole("button", { name: /^save$/i }));
      expect(
        await screen.findByText(/please enter a valid doi/i)
      ).toBeInTheDocument();
      expect(setReferenceInfo).not.toHaveBeenCalled();
    });

    it("still rejects a doi.org URL whose suffix is not a DOI", async () => {
      const { setReferenceInfo } = renderForm({ ...filledReference, doi: "" });
      const user = userEvent.setup();
      await user.type(doiField(), "https://doi.org/not-a-doi");
      await user.click(screen.getByRole("button", { name: /^save$/i }));
      expect(
        await screen.findByText(/please enter a valid doi/i)
      ).toBeInTheDocument();
      expect(setReferenceInfo).not.toHaveBeenCalled();
    });

    it("fetches with the BARE DOI and rewrites the field to it", async () => {
      axios.get.mockResolvedValue({
        data: {
          title: "Fetched Title",
          "container-title": "Nano Letters",
          page: "1234",
          volume: "17",
          URL: "https://doi.org/" + BARE,
          created: { "date-parts": [[2017]] },
          author: [{ given: "Ada", family: "Lovelace" }],
        },
      });
      renderForm({ ...filledReference, doi: "" });
      const user = userEvent.setup();
      await user.type(doiField(), `https://doi.org/${BARE}`);
      await user.click(screen.getByRole("button", { name: /^fetch$/i }));

      await waitFor(() =>
        expect(axios.get).toHaveBeenCalledWith(
          `https://dx.doi.org/${BARE}`,
          expect.anything()
        )
      );
      // The displayed value is normalized, so it matches what gets saved.
      await waitFor(() => expect(doiField()).toHaveValue(BARE));
      expect(screen.getByPlaceholderText(/enter title/i)).toHaveValue(
        "Fetched Title"
      );
    });

    it("does not call the registry for an invalid DOI", async () => {
      renderForm({ ...filledReference, doi: "" });
      const user = userEvent.setup();
      await user.type(doiField(), "https://example.com/nope");
      await user.click(screen.getByRole("button", { name: /^fetch$/i }));
      expect(axios.get).not.toHaveBeenCalled();
    });
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

// Which bibliographic fields are required depends on the kind of work. The
// form used to demand Journal Name, Page, Volume, Abstract and Year from
// everything, so a preprint or a dissertation could never be saved at fields
// it can never legitimately fill. These rules mirror backend/project/schema.json
// exactly -- see backend/project/tests/test_publish_validation.py.
describe("kind-dependent requirements", () => {
  const base = {
    kind: "preprint",
    doi: "",
    authors: "Alex Gaiduk",
    title: "Photoelectron Spectra",
    // A preprint has a year but no journal, volume or page. This is the
    // shape referenceUtil.set writes for exactly that case.
    publication: " 2016,  ,",
    year: 2016,
    url: "",
    abstract: "An abstract",
  };

  const save = async (user) =>
    user.click(screen.getByRole("button", { name: /^save$/i }));

  it("saves a preprint with no journal, volume or page", async () => {
    const user = userEvent.setup();
    const { setReferenceInfo } = renderForm(base);

    await save(user);

    await waitFor(() => expect(setReferenceInfo).toHaveBeenCalledTimes(1));
    expect(setReferenceInfo.mock.calls[0][0].title).toBe(
      "Photoelectron Spectra"
    );
  });

  it("saves a dissertation with no journal, volume or page", async () => {
    const user = userEvent.setup();
    const { setReferenceInfo } = renderForm({ ...base, kind: "dissertation" });

    await save(user);

    await waitFor(() => expect(setReferenceInfo).toHaveBeenCalledTimes(1));
  });

  it("requires Journal Name for a journal article", async () => {
    const user = userEvent.setup();
    const { setReferenceInfo } = renderForm({ ...base, kind: "journal" });

    await save(user);

    await waitFor(() =>
      expect(
        screen.getByText(/required for a journal article/i)
      ).toBeInTheDocument()
    );
    expect(setReferenceInfo).not.toHaveBeenCalled();
  });

  it("still lets a journal article through without volume or page", async () => {
    const user = userEvent.setup();
    const { setReferenceInfo } = renderForm({
      ...base,
      kind: "journal",
      publication: "JACS 2016, 138 ,6912-6915",
    });

    await save(user);

    await waitFor(() => expect(setReferenceInfo).toHaveBeenCalledTimes(1));
  });

  // The asterisk lives in the field label (FormInputLabel), not on the input.
  const starred = (forId) =>
    document.querySelector(`label[for="${forId}"]`).textContent.includes("*");

  it("moves the Journal Name asterisk with the selected kind", async () => {
    const user = userEvent.setup();
    renderForm(base);
    expect(starred("journal")).toBe(false);

    await user.click(screen.getByRole("radio", { name: /journal/i }));

    await waitFor(() => expect(starred("journal")).toBe(true));
  });

  it("never marks Page or Volume required, for any kind", async () => {
    const user = userEvent.setup();
    renderForm(base);
    expect(starred("page")).toBe(false);
    expect(starred("volume")).toBe(false);

    await user.click(screen.getByRole("radio", { name: /journal/i }));

    await waitFor(() => expect(starred("journal")).toBe(true));
    expect(starred("page")).toBe(false);
    expect(starred("volume")).toBe(false);
  });

  it("still requires kind, title, an author, abstract and year", async () => {
    const user = userEvent.setup();
    const { setReferenceInfo } = renderForm({
      ...base,
      title: "",
      abstract: "",
    });

    await save(user);

    await waitFor(() =>
      expect(screen.getAllByText(/^required$/i).length).toBeGreaterThan(0)
    );
    expect(setReferenceInfo).not.toHaveBeenCalled();
  });
});
