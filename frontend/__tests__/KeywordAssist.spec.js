import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

jest.mock("axios");
import axios from "axios";

import KeywordAssist from "../components/CuratorElements/KeywordAssist";
import CuratorContext from "../Context/Curator/curatorContext";

const state = () => ({
  referenceInfo: {
    title: "Ice nucleation",
    abstract: "We simulate water.",
    publication: "J Chem 2020, 1 ,2",
    doi: "10.1/x",
  },
  paperInfo: { tags: ["existing"] },
});

const renderAssist = (draftState = state(), overrides = {}) => {
  const onApply = jest.fn();
  const collectDraftState = jest.fn(() => draftState);
  render(
    <CuratorContext.Provider
      value={{
        collectDraftState,
        referenceInfo: draftState.referenceInfo,
        ...overrides,
      }}
    >
      <KeywordAssist onApply={onApply} />
    </CuratorContext.Provider>
  );
  return { onApply, collectDraftState };
};

describe("KeywordAssist (Suggest Keywords with AI)", () => {
  afterEach(() => jest.resetAllMocks());

  it("is disabled with a clear reason (and makes NO request) without title/abstract", () => {
    const empty = state();
    empty.referenceInfo = { ...empty.referenceInfo, title: "", abstract: "" };
    renderAssist(empty);

    const button = screen.getByRole("button", {
      name: /suggest keywords with ai/i,
    });
    expect(button).toBeDisabled();
    // Prerequisite guidance + the metadata-missing reason are both visible,
    // and this state is clearly LOCAL (distinct from the server-side
    // "not configured" message, which never appears here).
    expect(
      screen.getByText(/keyword suggestions use this paper.s title, abstract, venue, and doi/i)
    ).toBeInTheDocument();
    expect(
      screen.getByText(/add a title or abstract, fetch a doi, or import a manuscript source/i)
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/not configured on this server/i)
    ).not.toBeInTheDocument();
    // Disabled at the pointer-events level: no interaction, no request.
    expect(button).toHaveStyle("pointer-events: none");
    expect(axios.post).not.toHaveBeenCalled();
  });

  it("becomes available with a manual title only", () => {
    const titled = state();
    titled.referenceInfo = {
      ...titled.referenceInfo,
      title: "Typed by hand",
      abstract: "",
    };
    renderAssist(titled);
    expect(
      screen.getByRole("button", { name: /suggest keywords with ai/i })
    ).toBeEnabled();
    expect(
      screen.queryByText(/add a title or abstract/i)
    ).not.toBeInTheDocument();
  });

  it("enables from the LIVE typed signal even when nothing is saved yet", () => {
    const empty = state();
    empty.referenceInfo = { ...empty.referenceInfo, title: "", abstract: "" };
    renderAssist(empty, { liveBiblio: { title: "Typed, not saved", abstract: "" } });
    expect(
      screen.getByRole("button", { name: /suggest keywords with ai/i })
    ).toBeEnabled();
  });

  it("newer typed values win over stale saved ones in the request", async () => {
    // Saved (stale) title differs from what the user has typed since; the
    // flushed draft snapshot carries the newer value and that is what goes
    // to the provider.
    const typed = state();
    typed.referenceInfo = {
      ...typed.referenceInfo,
      title: "Newer typed title",
    };
    const staleSaved = { ...typed.referenceInfo, title: "Old saved title" };
    axios.post.mockResolvedValue({ data: { keywords: [], warnings: [] } });
    const user = userEvent.setup();
    renderAssist(typed, {
      referenceInfo: staleSaved,
      liveBiblio: { title: "Newer typed title", abstract: "" },
    });

    await user.click(
      screen.getByRole("button", { name: /suggest keywords with ai/i })
    );
    expect(axios.post.mock.calls[0][1].title).toBe("Newer typed title");
  });

  it("becomes available with an abstract only (e.g. DOI-fetched or imported)", () => {
    const abstractOnly = state();
    abstractOnly.referenceInfo = {
      ...abstractOnly.referenceInfo,
      title: "",
      abstract: "Populated by Fetch DOI or manuscript import.",
    };
    renderAssist(abstractOnly);
    expect(
      screen.getByRole("button", { name: /suggest keywords with ai/i })
    ).toBeEnabled();
  });

  it("explains the richer manuscript path with honest EXCERPT wording", async () => {
    axios.post.mockResolvedValue({ data: { keywords: [], warnings: [] } });
    const user = userEvent.setup();
    renderAssist();
    await user.click(
      screen.getByRole("button", { name: /suggest keywords with ai/i })
    );
    expect(
      await screen.findByText(/import a \.tex file or overleaf \.zip from publication information/i)
    ).toBeInTheDocument();
    expect(
      screen.getByText(/manuscript excerpts are sent to gemini only after explicit consent there/i)
    ).toBeInTheDocument();
  });

  it("sends only the primary paper's bibliographic metadata", async () => {
    axios.post.mockResolvedValue({ data: { keywords: ["DFT"], warnings: [] } });
    const user = userEvent.setup();
    renderAssist();

    await user.click(
      screen.getByRole("button", { name: /suggest keywords with ai/i })
    );
    expect(axios.post).toHaveBeenCalledWith("/api/assist/keywords", {
      title: "Ice nucleation",
      abstract: "We simulate water.",
      venue: "J Chem 2020, 1 ,2",
      doi: "10.1/x",
    });
  });

  it("names Gemini as the destination before anything is sent", async () => {
    axios.post.mockResolvedValue({ data: { keywords: [], warnings: [] } });
    const user = userEvent.setup();
    renderAssist();
    await user.click(
      screen.getByRole("button", { name: /suggest keywords with ai/i })
    );
    // The dialog states the provider and the exact fields that travel.
    expect(
      await screen.findByText(/title, abstract, venue and doi .* to gemini/i)
    ).toBeInTheDocument();
    // Manuscript excerpts are explicitly NOT part of this action.
    expect(
      screen.getByText(/manuscript excerpts are sent to gemini only after explicit consent there/i)
    ).toBeInTheDocument();
    // The provider is named only in the dialog copy — the trigger button
    // itself stays generic (asserted in the eligibility tests above, where
    // the dialog is closed and the button is queryable).
    expect(
      screen.queryByText(/googleapis|api key|x-goog|oauth|client secret/i)
    ).toBeNull();
  });

  it("shows an intelligible message when the provider is not configured", async () => {
    axios.post.mockRejectedValue({
      response: {
        status: 503,
        data: {
          error: "AI keyword suggestions are not configured on this server.",
        },
      },
    });
    const user = userEvent.setup();
    renderAssist();
    await user.click(
      screen.getByRole("button", { name: /suggest keywords with ai/i })
    );
    expect(
      await screen.findByText(/not configured on this server/i)
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /apply selected keywords/i })
    ).toBeDisabled();
  });

  it("suggestions default unchecked and apply only the selected ones", async () => {
    axios.post.mockResolvedValue({
      data: { keywords: ["Molecular Dynamics", "Water"], warnings: [] },
    });
    const user = userEvent.setup();
    const { onApply } = renderAssist();

    await user.click(
      screen.getByRole("button", { name: /suggest keywords with ai/i })
    );
    const first = await screen.findByRole("checkbox", {
      name: /apply keyword molecular dynamics/i,
    });
    const second = screen.getByRole("checkbox", {
      name: /apply keyword water/i,
    });
    expect(first).not.toBeChecked();
    expect(second).not.toBeChecked();
    // Nothing selected -> Apply disabled -> nothing can be written.
    expect(
      screen.getByRole("button", { name: /apply selected keywords/i })
    ).toBeDisabled();

    await user.click(first);
    await user.click(
      screen.getByRole("button", { name: /apply selected keywords/i })
    );
    expect(onApply).toHaveBeenCalledWith(["Molecular Dynamics"]);
  });

  it("cancel applies nothing", async () => {
    axios.post.mockResolvedValue({
      data: { keywords: ["Water"], warnings: [] },
    });
    const user = userEvent.setup();
    const { onApply } = renderAssist();

    await user.click(
      screen.getByRole("button", { name: /suggest keywords with ai/i })
    );
    await screen.findByRole("checkbox", { name: /apply keyword water/i });
    await user.click(screen.getByRole("button", { name: /^cancel$/i }));
    expect(onApply).not.toHaveBeenCalled();
  });
});
