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

const renderAssist = () => {
  const onApply = jest.fn();
  const collectDraftState = jest.fn(() => state());
  render(
    <CuratorContext.Provider value={{ collectDraftState }}>
      <KeywordAssist onApply={onApply} />
    </CuratorContext.Provider>
  );
  return { onApply, collectDraftState };
};

describe("KeywordAssist (Suggest Keywords with AI)", () => {
  afterEach(() => jest.resetAllMocks());

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

  it("shows an intelligible message when Qwen is not configured", async () => {
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
