import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

jest.mock("axios");
import axios from "axios";

import ReferenceInfoForm from "../components/CuratorForms/ReferenceInfoForm";
import ImportReview from "../components/CuratorElements/ImportReview";
import CuratorContext from "../Context/Curator/curatorContext";
import AlertContext from "../Context/Alert/alertContext";
import LoadingContext from "../Context/Loading/loadingContext";

// Publication metadata is factual data. It comes from the DOI registry and
// from what is printed in the manuscript -- never from a language model.
// These tests keep the AI proposal step out of this section, and keep the
// section from saving itself behind the curator's back.

const reference = (overrides = {}) => ({
  kind: "journal",
  doi: "",
  authors: "Ada Lovelace",
  title: "A Title",
  publication: "Journal of Computing 2021, 12 ,100-110",
  year: 2021,
  url: "",
  abstract: "An abstract",
  ...overrides,
});

const renderForm = (overrides = {}, editor = jest.fn()) => {
  const setReferenceInfo = jest.fn();
  render(
    <CuratorContext.Provider
      value={{ referenceInfo: reference(overrides), setReferenceInfo }}
    >
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

describe("Publication Information offers no AI", () => {
  beforeEach(() => jest.clearAllMocks());

  it("does not render the publication AI action", () => {
    renderForm();
    expect(
      screen.queryByRole("button", {
        name: /suggest missing publication details with ai/i,
      })
    ).toBeNull();
    expect(document.body.textContent).not.toMatch(
      /suggest missing publication details/i
    );
  });

  it("offers only DOI Fetch and manuscript import", () => {
    renderForm();
    expect(screen.getByRole("button", { name: /^fetch$/i })).toBeInTheDocument();
    expect(screen.getByText(/^import manuscript source$/i)).toBeInTheDocument();
    // The section mentions no AI at all.
    expect(document.body.textContent).not.toMatch(/\bgemini\b/i);
  });

  it("never posts to a publication AI endpoint", async () => {
    const user = userEvent.setup();
    renderForm();
    for (const button of screen.getAllByRole("button")) {
      if (!button.disabled) await user.click(button);
    }
    axios.post.mock.calls.forEach(([url]) => {
      expect(url).not.toMatch(/assist\/publication/);
    });
  });
});

describe("nothing but Save commits the section", () => {
  beforeEach(() => jest.clearAllMocks());

  const CROSSREF = {
    title: "Registry Title",
    "container-title": "Journal of Computing",
    page: "100-110",
    volume: "12",
    issued: { "date-parts": [[2021]] },
    URL: "https://doi.org/10.1021/jacs.6b00225",
    DOI: "10.1021/jacs.6b00225",
    author: [{ given: "Ada", family: "Lovelace" }],
  };

  it("DOI Fetch fills the inputs and leaves the form open and unsaved",
     async () => {
    const user = userEvent.setup();
    axios.get.mockResolvedValue({ data: CROSSREF });
    const { setReferenceInfo, editor } = renderForm({ kind: "journal" });

    await user.type(
      screen.getByPlaceholderText(/enter doi of the paper/i),
      "10.1021/jacs.6b00225"
    );
    await user.click(screen.getByRole("button", { name: /^fetch$/i }));

    // The fetched values are visible in the inputs...
    await waitFor(() =>
      expect(screen.getByPlaceholderText(/enter title/i)).toHaveValue(
        "Registry Title"
      )
    );
    expect(
      screen.getByPlaceholderText(/enter full journal name/i)
    ).toHaveValue("Journal of Computing");
    // ...but nothing has been committed and the section is still editable.
    expect(setReferenceInfo).not.toHaveBeenCalled();
    expect(editor).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /^save$/i })).toBeInTheDocument();
  });

  it("commits and switches to display mode only on Save", async () => {
    const user = userEvent.setup();
    const { setReferenceInfo, editor } = renderForm();

    expect(setReferenceInfo).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() => expect(setReferenceInfo).toHaveBeenCalledTimes(1));
    expect(editor).toHaveBeenCalledTimes(1);
  });

  it("every auxiliary button is type=button", () => {
    renderForm();
    screen.getAllByRole("button").forEach((button) => {
      const type = button.getAttribute("type");
      const isSave = /^save$/i.test(button.textContent.trim());
      if (!isSave) {
        expect(type === "button" || type === null).toBe(true);
      }
    });
    // Save is the one control allowed to submit.
    expect(screen.getByRole("button", { name: /^save$/i })).toHaveAttribute(
      "type",
      "submit"
    );
  });
});

describe("Import Review carries no AI block", () => {
  beforeEach(() => jest.clearAllMocks());

  const renderReview = (onClose = jest.fn()) => {
    const setAll = jest.fn();
    render(
      <CuratorContext.Provider
        value={{
          collectDraftState: () => ({
            referenceInfo: reference({ title: "", abstract: "" }),
            paperInfo: { tags: [] },
          }),
          setAll,
          remountForms: jest.fn(),
        }}
      >
        <ImportReview
          open
          onClose={onClose}
          result={{
            importSource: "manuscript",
            manuscriptFile: { filename: "paper.pdf", content_base64: "AAA" },
            proposal: {
              title: "A title from the manuscript",
              abstract: "A printed abstract.",
            },
            provenance: { title: "manuscript", abstract: "manuscript" },
            alternatives: {},
            warnings: [],
          }}
        />
      </CuratorContext.Provider>
    );
    return { setAll, onClose };
  };

  it("shows no AI keyword or AI publication UI", () => {
    renderReview();
    const text = document.body.textContent;
    expect(text).not.toMatch(/ai keyword suggestions/i);
    expect(text).not.toMatch(/suggest missing publication details/i);
    expect(text).not.toMatch(/analyze extracted manuscript text with ai/i);
    expect(
      screen.queryByRole("button", { name: /get ai keyword suggestions/i })
    ).toBeNull();
  });

  it("calls no assist endpoint however it is used", async () => {
    const user = userEvent.setup();
    renderReview();
    for (const box of screen.queryAllByRole("checkbox")) {
      await user.click(box);
    }
    axios.post.mock.calls.forEach(([url]) => {
      expect(url).not.toMatch(/\/api\/assist\//);
    });
  });

  it("keeps provenance visible and applies only ticked fields", async () => {
    const user = userEvent.setup();
    const { setAll } = renderReview();

    // Provenance is shown, and nothing is ticked for the curator.
    expect(document.body.textContent).toMatch(/manuscript/i);

    const boxes = screen.queryAllByRole("checkbox");
    expect(boxes.length).toBeGreaterThan(0);
    await user.click(boxes[0]);
    await user.click(
      screen.getByRole("button", { name: /apply to paper information/i })
    );

    // Apply writes form state. It is not a save: no publish, no PUT.
    expect(setAll).toHaveBeenCalledTimes(1);
    expect(axios.put).not.toHaveBeenCalled();
  });
});
