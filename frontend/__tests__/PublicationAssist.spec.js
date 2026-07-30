import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

jest.mock("axios");
import axios from "axios";

import PublicationAssist, {
  looksSupplementary,
} from "../components/CuratorElements/PublicationAssist";
import ImportReview from "../components/CuratorElements/ImportReview";
import CuratorContext from "../Context/Curator/curatorContext";

const reference = (overrides = {}) => ({
  kind: "",
  doi: "",
  authors: "",
  title: "",
  publication: "",
  volume: "",
  page: "",
  year: null,
  url: "",
  abstract: "",
  ...overrides,
});

const renderAssist = ({ ref = reference(), text = "Published in J. Chem. Phys. 158, 014101 (2023).", filename = "paper.pdf" } = {}) => {
  const setReferenceInfo = jest.fn();
  render(
    <CuratorContext.Provider value={{ setReferenceInfo }}>
      <PublicationAssist
        reference={ref}
        sourceText={text}
        sourceFilename={filename}
      />
    </CuratorContext.Provider>
  );
  return { setReferenceInfo };
};

const trigger = () =>
  screen.getByRole("button", {
    name: /suggest missing publication details with ai/i,
  });

const consentBox = () =>
  screen.getByRole("checkbox", {
    name: /i agree to send these details and the extracted text to gemini/i,
  });

const openAndSend = async (user, data) => {
  await user.click(trigger());
  axios.post.mockResolvedValue({ data });
  await user.click(consentBox());
  await user.click(
    screen.getByRole("button", { name: /send and get suggestions/i })
  );
  await waitFor(() => expect(axios.post).toHaveBeenCalled());
};

describe("Suggest missing publication details with AI", () => {
  beforeEach(() => jest.clearAllMocks());

  it("requires consent and sends nothing before it", async () => {
    const user = userEvent.setup();
    renderAssist();

    await user.click(trigger());
    expect(consentBox()).not.toBeChecked();
    expect(
      screen.getByRole("button", { name: /send and get suggestions/i })
    ).toBeDisabled();
    // Fetch DOI is named as the better first step.
    expect(screen.getByText(/fetch doi is the better first step/i))
      .toBeInTheDocument();
    expect(axios.post).not.toHaveBeenCalled();
  });

  it("states exactly what travels and what does not", async () => {
    const user = userEvent.setup();
    renderAssist();
    await user.click(trigger());

    const text = document.body.textContent;
    expect(text).toMatch(/bibliographic fields as they stand/i);
    expect(text).toMatch(/bounded excerpt/i);
    expect(text).toMatch(/does not send the source file itself/i);
    expect(text).toMatch(/pis, keywords, paperstack, notebook or rcc paths/i);
    expect(text).toMatch(/nothing is stored or published/i);
    expect(text).toMatch(/never overwritten automatically/i);
  });

  it("sends only allowlisted bibliographic fields", async () => {
    const user = userEvent.setup();
    renderAssist({ ref: reference({ title: "Known", doi: "10.1/x" }) });
    await openAndSend(user, { proposals: [], warnings: [] });

    const [url, payload] = axios.post.mock.calls[0];
    expect(url).toBe("/api/assist/publication-metadata");
    expect(Object.keys(payload).sort()).toEqual([
      "abstract", "authors", "consent", "doi", "filename", "kind", "page",
      "publication", "source_text", "title", "url", "volume", "year",
    ]);
    expect(payload.consent).toBe(true);
  });

  it("shows each field with provenance and applies only ticked ones", async () => {
    const user = userEvent.setup();
    const { setReferenceInfo } = renderAssist();
    await openAndSend(user, {
      proposals: [
        { field: "publication", value: "J. Chem. Phys.", provenance: "ai",
          confidence: "medium", evidence: "Published in J. Chem. Phys." },
        { field: "year", value: "2023", provenance: "ai",
          confidence: "low", evidence: "(2023)" },
      ],
      warnings: [],
    });

    // Nothing is ticked by default.
    const journal = screen.getByRole("checkbox", { name: /apply journal name/i });
    const year = screen.getByRole("checkbox", { name: /apply year/i });
    expect(journal).not.toBeChecked();
    expect(year).not.toBeChecked();
    expect(
      screen.getByRole("button", { name: /apply selected fields/i })
    ).toBeDisabled();

    // Provenance and confidence are visible.
    expect(screen.getByText("AI suggestion: medium")).toBeInTheDocument();
    expect(screen.getByText("AI suggestion: low")).toBeInTheDocument();
    expect(screen.getByText(/based on: published in/i)).toBeInTheDocument();

    await user.click(journal);
    await user.click(
      screen.getByRole("button", { name: /apply selected fields/i })
    );
    // Only referenceInfo is touched, and only with the ticked field.
    expect(setReferenceInfo).toHaveBeenCalledTimes(1);
    const written = setReferenceInfo.mock.calls[0][0];
    expect(written.publication).toBe("J. Chem. Phys.");
    expect(written.year).toBeNull();
    // No save/publish request of any kind.
    expect(axios.put).not.toHaveBeenCalled();
    expect(axios.post).toHaveBeenCalledTimes(1);
  });

  it("protects a value the curator already entered", async () => {
    const user = userEvent.setup();
    renderAssist({ ref: reference({ publication: "My own journal" }) });
    await openAndSend(user, {
      proposals: [
        { field: "publication", value: "Something else", provenance: "ai",
          confidence: "medium", evidence: "x" },
      ],
      warnings: [],
    });

    expect(
      screen.getByRole("checkbox", { name: /apply journal name/i })
    ).not.toBeChecked();
    expect(screen.getByTestId("protected-publication")).toHaveTextContent(
      /you already entered .*my own journal.* ticking this replaces it/i
    );
  });

  it("derives the URL from the DOI and labels it as the registry, not AI", async () => {
    const user = userEvent.setup();
    renderAssist({ ref: reference({ doi: "10.1021/x" }) });
    await openAndSend(user, {
      proposals: [
        { field: "url", value: "https://doi.org/10.1021/x",
          provenance: "doi_registry", confidence: "high",
          evidence: "Derived from the DOI; not generated by AI." },
      ],
      warnings: [],
    });
    expect(screen.getByTestId("proposal-url")).toHaveTextContent(
      "https://doi.org/10.1021/x"
    );
    expect(screen.getByText("DOI registry")).toBeInTheDocument();
  });

  it("says so plainly when nothing could be established", async () => {
    const user = userEvent.setup();
    renderAssist();
    await openAndSend(user, {
      proposals: [],
      warnings: ["No reliable value was found for the missing fields."],
    });
    expect(screen.getByTestId("no-proposals")).toHaveTextContent(
      /no reliable value found/i
    );
  });

  it("is DISABLED for Supporting Information, with an actionable reason", () => {
    // The old behavior ran the request and returned an empty result, which
    // blamed the text for a decision we had made.
    renderAssist({ filename: "nl7b00283_si_001.pdf" });
    expect(trigger()).toBeDisabled();
    expect(screen.getByTestId("assist-availability")).toHaveTextContent(
      "This appears to be Supporting Information. Use the main article PDF " +
        "or DOI Fetch for publication details."
    );
    expect(axios.post).not.toHaveBeenCalled();
  });

  it("an SI override is a distinct action and still warns in the dialog",
     async () => {
    const user = userEvent.setup();
    renderAssist({ filename: "paper_si_v2.pdf" });

    await user.click(screen.getByTestId("si-override"));
    expect(trigger()).toBeEnabled();
    await user.click(trigger());
    expect(screen.getByTestId("supp-warning")).toHaveTextContent(
      /looks like supporting information, not the article itself/i
    );
    expect(screen.getByTestId("supp-warning")).toHaveTextContent(
      /marked low confidence/i
    );
    // Still nothing sent without consent.
    expect(axios.post).not.toHaveBeenCalled();
  });

  it("explains accurately when there is no extracted text, and sends nothing",
     () => {
    renderAssist({ ref: reference({ title: "Typed by hand" }), text: "",
                   filename: "" });
    expect(trigger()).toBeDisabled();
    expect(screen.getByTestId("assist-availability")).toHaveTextContent(
      /import a .pdf, .tex or overleaf .zip manuscript source first/i
    );
    expect(axios.post).not.toHaveBeenCalled();
  });

  it("is enabled for a main-article PDF that has extracted text", () => {
    renderAssist({ filename: "nl7b00283.pdf", text: "Abstract: we show ..." });
    expect(trigger()).toBeEnabled();
    expect(screen.getByTestId("assist-availability")).toHaveTextContent(
      /fills gaps left after fetch doi/i
    );
  });

  it("never mentions or requests keywords", async () => {
    const user = userEvent.setup();
    renderAssist();
    await openAndSend(user, { proposals: [], warnings: [] });
    expect(document.body.textContent).not.toMatch(/keyword/i);
    axios.post.mock.calls.forEach(([url]) => {
      expect(url).not.toBe("/api/assist/keywords");
    });
  });
});

describe("the AI action never acts on the form", () => {
  beforeEach(() => jest.clearAllMocks());

  // MUI Buttons default to type="submit". Inside the Publication Information
  // form that made every click on the assist submit the section: it saved and
  // collapsed, hiding the fields the curator was about to fill.
  const renderInForm = (ref = reference()) => {
    const onSubmit = jest.fn((event) => event.preventDefault());
    const setReferenceInfo = jest.fn();
    const remountForms = jest.fn();
    render(
      <CuratorContext.Provider value={{ setReferenceInfo, remountForms }}>
        <form onSubmit={onSubmit}>
          <input aria-label="Volume" defaultValue="" />
          <PublicationAssist
            reference={ref}
            sourceText="Published in J. Chem. Phys. 158, 014101 (2023)."
            sourceFilename="paper.pdf"
          />
        </form>
      </CuratorContext.Provider>
    );
    return { onSubmit, setReferenceInfo, remountForms };
  };

  it("uses non-submit buttons throughout", async () => {
    const user = userEvent.setup();
    renderInForm();
    expect(trigger()).toHaveAttribute("type", "button");
    await user.click(trigger());
    screen.getAllByRole("button").forEach((button) => {
      expect(button).toHaveAttribute("type", "button");
    });
  });

  it("opening it submits nothing and writes nothing", async () => {
    const user = userEvent.setup();
    const { onSubmit, setReferenceInfo } = renderInForm();

    await user.click(trigger());
    expect(onSubmit).not.toHaveBeenCalled();
    expect(setReferenceInfo).not.toHaveBeenCalled();
    expect(axios.post).not.toHaveBeenCalled();
  });

  it("requesting and closing submits nothing and writes nothing", async () => {
    const user = userEvent.setup();
    const { onSubmit, setReferenceInfo } = renderInForm();

    await openAndSend(user, {
      proposals: [
        { field: "year", value: "2023", provenance: "ai",
          confidence: "medium", evidence: "(2023)" },
      ],
      warnings: [],
    });
    await user.click(screen.getByRole("button", { name: /^close$/i }));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(setReferenceInfo).not.toHaveBeenCalled();
  });

  it("keeps a typed, unsaved value across open and close", async () => {
    const user = userEvent.setup();
    renderInForm();
    const volume = screen.getByLabelText("Volume");

    await user.type(volume, "158");
    await user.click(trigger());
    await user.click(screen.getByRole("button", { name: /^close$/i }));

    expect(volume).toHaveValue("158");
  });

  it("returns focus to the action after closing", async () => {
    const user = userEvent.setup();
    renderInForm();

    await user.click(trigger());
    await user.click(screen.getByRole("button", { name: /^close$/i }));

    await waitFor(() => expect(trigger()).toHaveFocus());
  });

  it("only Apply writes to referenceInfo", async () => {
    const user = userEvent.setup();
    const { onSubmit, setReferenceInfo, remountForms } = renderInForm();

    await openAndSend(user, {
      proposals: [
        { field: "year", value: "2023", provenance: "ai",
          confidence: "medium", evidence: "(2023)" },
      ],
      warnings: [],
    });
    expect(setReferenceInfo).not.toHaveBeenCalled();

    await user.click(screen.getByRole("checkbox", { name: /apply year/i }));
    await user.click(
      screen.getByRole("button", { name: /apply selected fields/i })
    );

    expect(setReferenceInfo).toHaveBeenCalledTimes(1);
    expect(remountForms).toHaveBeenCalledTimes(1);
    // Applying writes the form state; it does not save or publish.
    expect(onSubmit).not.toHaveBeenCalled();
    expect(axios.put).not.toHaveBeenCalled();
  });

  it("summarises which fields had evidence and which had none", async () => {
    const user = userEvent.setup();
    renderInForm();

    await openAndSend(user, {
      proposals: [
        { field: "title", value: "A Title", provenance: "pdf_text",
          confidence: "high", evidence: "front matter" },
        { field: "abstract", value: "An abstract.", provenance: "pdf_text",
          confidence: "high", evidence: "abstract heading" },
      ],
      warnings: [],
    });

    const status = screen.getByTestId("field-status");
    expect(status).toHaveTextContent(/found from source:.*title.*abstract/i);
    expect(status).toHaveTextContent(
      /no reliable source evidence:.*journal name.*volume/i
    );
    // Field names only -- no manuscript text.
    expect(status).not.toHaveTextContent(/published in j\. chem\. phys/i);
  });
});

describe("looksSupplementary", () => {
  it("recognizes the usual supplement names", () => {
    ["paper_si_v2.pdf", "acs-si-2023.pdf", "supporting-information.pdf",
     "supp_material.pdf", "ESI.pdf", "paper_supplementary.pdf"].forEach(
      (name) => expect(looksSupplementary(name)).toBe(true)
    );
  });

  it("leaves an ordinary manuscript alone", () => {
    ["paper.pdf", "manuscript.tex", "overleaf.zip", ""].forEach((name) =>
      expect(looksSupplementary(name)).toBe(false)
    );
  });
});

describe("Review manuscript import — keywords removed", () => {
  beforeEach(() => jest.clearAllMocks());

  const renderReview = () =>
    render(
      <CuratorContext.Provider
        value={{
          collectDraftState: () => ({ referenceInfo: reference(),
            paperInfo: { tags: [] } }),
          setAll: jest.fn(),
          remountForms: jest.fn(),
        }}
      >
        <ImportReview
          open
          onClose={jest.fn()}
          result={{
            importSource: "manuscript",
            manuscriptFile: { filename: "paper.pdf", content_base64: "AAA" },
            proposal: { title: "A title from the manuscript" },
            provenance: { title: "manuscript" },
            alternatives: {},
            warnings: [],
          }}
        />
      </CuratorContext.Provider>
    );

  it("offers no AI keyword action at all", () => {
    renderReview();
    const text = document.body.textContent;
    expect(text).not.toMatch(/ai keyword suggestions/i);
    expect(text).not.toMatch(/analyze extracted manuscript text with ai/i);
    expect(
      screen.queryByRole("button", { name: /get ai keyword suggestions/i })
    ).toBeNull();
  });

  it("never calls the keyword endpoint", async () => {
    const user = userEvent.setup();
    renderReview();
    // Interact with everything on offer; none of it may reach /assist/keywords.
    const boxes = screen.queryAllByRole("checkbox");
    for (const box of boxes) {
      await user.click(box);
    }
    axios.post.mock.calls.forEach(([url]) => {
      expect(url).not.toBe("/api/assist/keywords");
    });
  });
});
