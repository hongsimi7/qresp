import { useContext } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

jest.mock("axios");
import axios from "axios";

// INTEGRATION: real CuratorState + the real Publication form + the real
// KeywordAssist. Proves "Suggest Keywords with AI" reacts to CURRENTLY TYPED
// title/abstract (via the form's live signal + draft flusher) without the
// user ever pressing the section's Save button — and without the AI request
// silently saving anything.
import CuratorState from "../Context/Curator/CuratorState";
import CuratorContext from "../Context/Curator/curatorContext";
import AlertContext from "../Context/Alert/alertContext";
import LoadingContext from "../Context/Loading/loadingContext";
import ReferenceInfoForm from "../components/CuratorForms/ReferenceInfoForm";
import KeywordAssist from "../components/CuratorElements/KeywordAssist";

const SavedTitleProbe = () => {
  const { referenceInfo } = useContext(CuratorContext);
  return (
    <span data-testid="saved-title">{referenceInfo.title || "blank"}</span>
  );
};

const renderLive = () => {
  const onApply = jest.fn();
  render(
    <CuratorState draftKey={null}>
      <AlertContext.Provider value={{ setAlert: jest.fn() }}>
        <LoadingContext.Provider
          value={{ showLoader: jest.fn(), hideLoader: jest.fn() }}
        >
          <ReferenceInfoForm editor={jest.fn()} />
          <KeywordAssist onApply={onApply} />
          <SavedTitleProbe />
        </LoadingContext.Provider>
      </AlertContext.Provider>
    </CuratorState>
  );
  return { onApply };
};

const assistButton = () =>
  screen.getByRole("button", { name: /suggest keywords with ai/i });

describe("KeywordAssist live form integration", () => {
  afterEach(() => jest.resetAllMocks());

  it("starts disabled with the guidance message and never calls the API", () => {
    renderLive();
    expect(assistButton()).toBeDisabled();
    expect(
      screen.getByText(/add a title or abstract, fetch a doi, or import a manuscript source/i)
    ).toBeInTheDocument();
    expect(axios.post).not.toHaveBeenCalled();
  });

  it("enables from a TYPED title (no Save) and sends exactly the typed value", async () => {
    axios.post.mockResolvedValue({ data: { keywords: ["DFT"], warnings: [] } });
    const user = userEvent.setup();
    renderLive();

    await user.type(
      screen.getByPlaceholderText(/^enter title$/i),
      "Typed live title"
    );
    // Enabled immediately — the section's Save button was never pressed.
    await waitFor(() => expect(assistButton()).toBeEnabled());

    await user.click(assistButton());
    await waitFor(() => expect(axios.post).toHaveBeenCalled());
    const payload = axios.post.mock.calls[0][1];
    expect(payload.title).toBe("Typed live title");
    // Only allowlisted bibliographic fields travel.
    expect(Object.keys(payload).sort()).toEqual(
      ["abstract", "doi", "title", "venue"]
    );
  });

  it("enables from a TYPED abstract only and sends it", async () => {
    axios.post.mockResolvedValue({ data: { keywords: [], warnings: [] } });
    const user = userEvent.setup();
    renderLive();

    await user.type(
      screen.getByPlaceholderText(/^enter abstract$/i),
      "Typed live abstract."
    );
    await waitFor(() => expect(assistButton()).toBeEnabled());

    await user.click(assistButton());
    await waitFor(() => expect(axios.post).toHaveBeenCalled());
    expect(axios.post.mock.calls[0][1].abstract).toBe("Typed live abstract.");
    expect(axios.post.mock.calls[0][1].title).toBe("");
  });

  it("requesting suggestions does NOT silently save the publication form", async () => {
    axios.post.mockResolvedValue({ data: { keywords: ["DFT"], warnings: [] } });
    const user = userEvent.setup();
    renderLive();

    await user.type(
      screen.getByPlaceholderText(/^enter title$/i),
      "Typed live title"
    );
    await waitFor(() => expect(assistButton()).toBeEnabled());
    await user.click(assistButton());
    await waitFor(() => expect(axios.post).toHaveBeenCalled());

    // The canonical saved state is still untouched: only the form's Save
    // button persists the section.
    expect(screen.getByTestId("saved-title")).toHaveTextContent("blank");
  });

  it("applying selected suggestions stays opt-in and append-only", async () => {
    axios.post.mockResolvedValue({
      data: { keywords: ["Molecular Dynamics"], warnings: [] },
    });
    const user = userEvent.setup();
    const { onApply } = renderLive();

    await user.type(
      screen.getByPlaceholderText(/^enter title$/i),
      "Typed live title"
    );
    await waitFor(() => expect(assistButton()).toBeEnabled());
    await user.click(assistButton());

    const box = await screen.findByRole("checkbox", {
      name: /apply keyword molecular dynamics/i,
    });
    expect(box).not.toBeChecked();
    expect(
      screen.getByRole("button", { name: /apply selected keywords/i })
    ).toBeDisabled();
    await user.click(box);
    await user.click(
      screen.getByRole("button", { name: /apply selected keywords/i })
    );
    expect(onApply).toHaveBeenCalledWith(["Molecular Dynamics"]);
  });
});
