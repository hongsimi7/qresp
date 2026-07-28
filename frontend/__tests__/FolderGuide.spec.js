import {
  render,
  screen,
  waitForElementToBeRemoved,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import FolderGuide from "../components/CuratorElements/FolderGuide";

// The guide is advice: reachable, optional, and with no power over the
// analysis. These tests mostly pin what it must NOT do.

describe("How to organize an RCC folder", () => {
  it("is reachable and closed until asked for", async () => {
    const user = userEvent.setup();
    render(<FolderGuide />);

    const trigger = screen.getByRole("button", {
      name: /how to organize an rcc folder/i,
    });
    expect(trigger).toBeInTheDocument();
    // Nothing is shown until the curator asks.
    expect(screen.queryByTestId("folder-guide-tree")).toBeNull();

    await user.click(trigger);
    expect(await screen.findByTestId("folder-guide-tree")).toBeInTheDocument();
  });

  it("draws the example as a live tree, not an image of text", async () => {
    const user = userEvent.setup();
    render(<FolderGuide />);
    await user.click(
      screen.getByRole("button", { name: /how to organize an rcc folder/i })
    );

    const tree = await screen.findByTestId("folder-guide-tree");
    // Real, selectable text — every level of the example is present.
    [
      "paper-folder/",
      "README.md",
      "main.ipynb",
      "datasets/",
      "dataset-id/",
      "charts/",
      "figure-id/",
      "preview.png",
      "notebook.ipynb",
      "data/",
      "scripts/",
      "script-id/",
      "tools/",
      "tool-id/",
      "docs/",
    ].forEach((entry) => {
      expect(tree).toHaveTextContent(entry);
    });
    // No bitmap standing in for the diagram.
    expect(tree.querySelector("img")).toBeNull();
    // Icons come from the app's own set (rendered as SVG).
    expect(tree.querySelectorAll("svg").length).toBeGreaterThan(0);
  });

  it("stays scrollable rather than overflowing a narrow dialog", async () => {
    const user = userEvent.setup();
    render(<FolderGuide />);
    await user.click(
      screen.getByRole("button", { name: /how to organize an rcc folder/i })
    );
    expect(await screen.findByTestId("folder-guide-tree")).toHaveStyle(
      "overflow-x: auto"
    );
  });

  it("says the layout is optional and demands no new metadata file", async () => {
    const user = userEvent.setup();
    render(<FolderGuide />);
    await user.click(
      screen.getByRole("button", { name: /how to organize an rcc folder/i })
    );
    await screen.findByTestId("folder-guide-tree");

    const text = document.body.textContent;
    expect(text).toMatch(/all five role folders are optional/i);
    expect(text).toMatch(/existing folders are never renamed/i);
    expect(text).toMatch(
      /no yaml, json, metadata manifest or qresp-specific file is ever required/i
    );
    // The exact standard names, and what a boundary means.
    expect(text).toMatch(/datasets, charts, scripts, tools, docs/i);
    expect(text).toMatch(/each immediate child of datasets\/, charts\/,/i);
    expect(text).toMatch(/docs\/ is ignored by the analysis entirely/i);
    expect(text).toMatch(
      /figure number, caption, scientific description and tool version are never inferred/i
    );
    // It must not invent a manifest requirement.
    expect(text).not.toMatch(/qresp\.ya?ml/i);
    expect(text).not.toMatch(/manifest file/i);
    expect(text).not.toMatch(/you must|required format|will be rejected/i);
  });

  it("warns about secrets and does not over-promise inference", async () => {
    const user = userEvent.setup();
    render(<FolderGuide />);
    await user.click(
      screen.getByRole("button", { name: /how to organize an rcc folder/i })
    );
    await screen.findByTestId("folder-guide-tree");

    expect(
      screen.getByText(/never store secrets, api keys, credentials/i)
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        /does not let qresp\s*infer figure numbers, captions, scientific properties or package\s*versions without evidence/i
      )
    ).toBeInTheDocument();
  });

  it("copies the standard structure as plain text", async () => {
    const user = userEvent.setup();
    const writeText = jest.fn(() => Promise.resolve());
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    render(<FolderGuide />);
    await user.click(
      screen.getByRole("button", { name: /how to organize an rcc folder/i })
    );
    await user.click(
      screen.getByRole("button", { name: /copy standard structure/i })
    );

    expect(writeText).toHaveBeenCalledTimes(1);
    const copied = writeText.mock.calls[0][0];
    expect(copied).toContain("paper-folder/");
    expect(copied).toContain("  datasets/");
    expect(copied).toContain("      preview.png");
    expect(await screen.findByText(/^copied\.$/i)).toBeInTheDocument();
  });

  it("says so when the clipboard is unavailable", async () => {
    const user = userEvent.setup();
    Object.defineProperty(navigator, "clipboard", {
      value: undefined,
      configurable: true,
    });
    render(<FolderGuide />);
    await user.click(
      screen.getByRole("button", { name: /how to organize an rcc folder/i })
    );
    await user.click(
      screen.getByRole("button", { name: /copy standard structure/i })
    );
    expect(
      await screen.findByText(/could not copy — select the tree above/i)
    ).toBeInTheDocument();
  });

  it("closes again and leaves nothing behind", async () => {
    const user = userEvent.setup();
    render(<FolderGuide />);
    await user.click(
      screen.getByRole("button", { name: /how to organize an rcc folder/i })
    );
    await screen.findByTestId("folder-guide-tree");

    await user.click(screen.getByRole("button", { name: /^close$/i }));
    await waitForElementToBeRemoved(() =>
      screen.queryByTestId("folder-guide-tree")
    );
    // Advice only: it stores nothing.
    expect(localStorage.length).toBe(0);
  });
});
