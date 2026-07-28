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
      "my-paper/",
      "figures/",
      "figure-01/",
      "figure-01.png",
      "figure-01.ipynb",
      "figure-01-data.csv",
      "datasets/",
      "bandgap.csv",
      "scripts/",
      "analyze_bandgap.py",
      "README.md",
      "environment.yml",
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
    expect(text).toMatch(/this layout is optional/i);
    expect(text).toMatch(/existing folders are analyzed exactly as they are/i);
    expect(text).toMatch(/no qresp-specific file is ever needed/i);
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
