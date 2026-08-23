import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import Contact, {
  EMAIL,
  ISSUES,
  MAILTO,
  PULL_REQUESTS,
  REPOSITORY,
} from "../pages/contact";
import Documentation, { DIRECTORY_TEMPLATE } from "../pages/documentation";
import FolderStandardPage from "../pages/documentation/folder-standard";
import {
  TIPS,
  TREE,
  TREE_TEXT,
} from "../components/FolderStandard/content";
import Header from "../components/header";

jest.mock("../components/AuthControls", () => {
  const AuthControls = () => null;
  return AuthControls;
});

describe("the Contact page", () => {
  it("shows the DataDev address as readable text", () => {
    // A bare `mailto:` in the navigation bar showed the address to nobody:
    // it either opened a mail client or, with none configured, did nothing.
    render(<Contact />);
    expect(screen.getAllByText(EMAIL).length).toBeGreaterThan(0);
    expect(EMAIL).toBe("datadev@lists.uchicago.edu");
  });

  it("keeps a one-click Email Qresp button that pre-fills the subject", () => {
    // The list is a shared inbox receiving more than Qresp; the subject is
    // what lets whoever reads it sort this mail without opening it.
    render(<Contact />);
    const button = screen.getByTestId("email-datadev");
    expect(button).toHaveAttribute("href", MAILTO);
    expect(MAILTO).toBe("mailto:datadev@lists.uchicago.edu?subject=Qresp");
    expect(button).toHaveTextContent("Email Qresp");
  });

  it("points at the canonical project repository, never a personal fork", () => {
    render(<Contact />);
    [REPOSITORY, ISSUES, PULL_REQUESTS].forEach((href) => {
      expect(href).toContain("github.com/qresp-code-development/qresp");
      expect(href).not.toMatch(/hongsimi7/i);
    });
  });

  it("says questions, bugs and feature requests all have a home", () => {
    const { container } = render(<Contact />);
    expect(container.textContent).toMatch(/questions about qresp/i);
    expect(container.textContent).toMatch(/bug report/i);
    expect(container.textContent).toMatch(/feature request/i);
  });

  it("links the repository, the issue tracker and pull requests", () => {
    render(<Contact />);
    expect(REPOSITORY).toBe("https://github.com/qresp-code-development/qresp");
    expect(ISSUES).toBe(`${REPOSITORY}/issues`);
    expect(PULL_REQUESTS).toBe(`${REPOSITORY}/pulls`);
    [REPOSITORY, ISSUES, PULL_REQUESTS].forEach((href) => {
      const link = screen
        .getAllByRole("link")
        .find((node) => node.getAttribute("href") === href);
      expect(link).toBeDefined();
    });
  });

  it("names each external link by where it goes", () => {
    // A link read out of context still has to say what it does; "click here"
    // does not.
    render(<Contact />);
    expect(
      screen.getByRole("link", { name: /open an issue in the qresp issue tracker/i })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /open a pull request/i })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /qresp on github/i })
    ).toBeInTheDocument();
  });

  it("opens external links safely and says that they open a new tab", () => {
    render(<Contact />);
    [REPOSITORY, ISSUES, PULL_REQUESTS].forEach((href) => {
      const link = screen
        .getAllByRole("link")
        .find((node) => node.getAttribute("href") === href);
      expect(link).toHaveAttribute("target", "_blank");
      // `noopener` denies the opened page a handle on this one; `noreferrer`
      // keeps the referring URL out of the request.
      expect(link.getAttribute("rel")).toContain("noopener");
      expect(link.getAttribute("rel")).toContain("noreferrer");
      expect(link).toHaveTextContent(/opens in a new tab/i);
    });
  });
});

describe("the navigation entry points", () => {
  it("sends Contact to the page rather than to a mail client", () => {
    render(<Header />);
    const contact = screen.getAllByRole("link", { name: /^contact$/i })[0];
    expect(contact).toHaveAttribute("href", "/contact");
    expect(contact.getAttribute("href")).not.toMatch(/^mailto:/);
  });

  it("sends Documentation to the in-app page", () => {
    render(<Header />);
    const docs = screen.getAllByRole("link", { name: /^documentation$/i })[0];
    expect(docs).toHaveAttribute("href", "/documentation");
  });
});

describe("the documentation directory template", () => {
  const originalClipboard = navigator.clipboard;

  const withClipboard = (clipboard) => {
    Object.defineProperty(navigator, "clipboard", {
      value: clipboard,
      configurable: true,
      writable: true,
    });
  };

  afterEach(() => {
    withClipboard(originalClipboard);
    jest.restoreAllMocks();
  });

  it("shows the template a reader is meant to copy", () => {
    render(<Documentation />);
    const block = screen.getByTestId("directory-template");
    [
      "project/",
      "README.md",
      "data/",
      "raw/",
      "processed/",
      "figures/",
      "scripts/",
      "tools/",
      "docs/",
    ].forEach((entry) => expect(block).toHaveTextContent(entry));
  });

  it("copies exactly what is on screen", async () => {
    const writeText = jest.fn().mockResolvedValue(undefined);
    withClipboard({ writeText });
    render(<Documentation />);
    await userEvent.click(screen.getByTestId("copy-template"));
    expect(writeText).toHaveBeenCalledWith(DIRECTORY_TEMPLATE);
    // What is rendered and what is copied come from the same constant, so
    // they cannot drift apart.
    expect(DIRECTORY_TEMPLATE).toContain("project/");
    expect(DIRECTORY_TEMPLATE).toContain("    processed/");
  });

  it("announces that the copy succeeded", async () => {
    withClipboard({ writeText: jest.fn().mockResolvedValue(undefined) });
    render(<Documentation />);
    await userEvent.click(screen.getByTestId("copy-template"));
    const status = await screen.findByTestId("copy-status");
    expect(status).toHaveAttribute("role", "status");
    expect(status).toHaveAttribute("aria-live", "polite");
    expect(status).toHaveTextContent(/copied to your clipboard/i);
  });

  it("falls back to selecting the text when there is no clipboard API", async () => {
    withClipboard(undefined);
    render(<Documentation />);
    await userEvent.click(screen.getByTestId("copy-template"));
    const status = await screen.findByTestId("copy-status");
    expect(status).toHaveTextContent(/press ctrl\+c/i);
    // Selected, so the keyboard shortcut has something to act on.
    expect(window.getSelection().toString()).toContain("project/");
  });

  it("falls back the same way when the clipboard refuses", async () => {
    // An insecure context or a denied permission rejects rather than throwing
    // at call time; the reader must not be left with a button that did
    // nothing visible.
    withClipboard({ writeText: jest.fn().mockRejectedValue(new Error("no")) });
    render(<Documentation />);
    await userEvent.click(screen.getByTestId("copy-template"));
    const status = await screen.findByTestId("copy-status");
    expect(status).toHaveTextContent(/press ctrl\+c/i);
  });

  it("says so when it cannot copy or select", async () => {
    withClipboard(undefined);
    jest.spyOn(window, "getSelection").mockReturnValue(undefined);
    render(<Documentation />);
    await userEvent.click(screen.getByTestId("copy-template"));
    const status = await screen.findByTestId("copy-status");
    expect(status).toHaveTextContent(/could not be copied/i);
  });

  it("says nothing before the button is pressed", () => {
    render(<Documentation />);
    expect(screen.getByTestId("copy-status")).toHaveTextContent("");
  });
});

// The Folder Standard was reachable only from a dialog inside the Curator --
// the wrong audience and the wrong moment for a researcher laying out a folder
// before anyone curates it. It now has a URL.
describe("the public Folder Standard page", () => {
  it("renders the standard, its tree and its rules", () => {
    render(<FolderStandardPage />);
    expect(
      screen.getByRole("heading", { level: 1, name: /qresp folder standard v1/i })
    ).toBeInTheDocument();
    const tree = screen.getByTestId("folder-guide-tree");
    ["paper-folder/", "datasets/", "charts/", "scripts/", "tools/", "docs/"]
      .forEach((entry) => expect(tree).toHaveTextContent(entry));
    expect(screen.getByTestId("folder-guide-standard")).toBeInTheDocument();
  });

  it("keeps the copy action the Curator guide has", () => {
    render(<FolderStandardPage />);
    expect(
      screen.getByRole("button", { name: /copy standard structure/i })
    ).toBeInTheDocument();
  });

  it("keeps the legacy-folder notes visibly separate from the standard", () => {
    // A compatibility path read as a second, looser layout is how a new paper
    // ends up organized the old way on purpose.
    render(<FolderStandardPage />);
    expect(
      screen.getByRole("heading", { name: /several images in one figure folder/i })
    ).toBeInTheDocument();
    expect(screen.getByTestId("folder-guide-legacy")).toBeInTheDocument();
  });

  it("offers a way back to the documentation index", () => {
    render(<FolderStandardPage />);
    expect(screen.getByTestId("back-to-documentation")).toHaveAttribute(
      "href",
      "/documentation"
    );
  });

  it("renders the SAME standard the Curator dialog does, not a copy", () => {
    // The failure this prevents: a researcher lays a folder out from the
    // public page, then the Curator describes a different layout. Both
    // surfaces import components/FolderStandard/content, so a rule added in
    // one appears in the other or in neither.
    render(<FolderStandardPage />);
    const page = screen.getByTestId("folder-guide-standard").textContent;
    TIPS.forEach((tip) => expect(page).toContain(tip));
    const tree = screen.getByTestId("folder-guide-tree").textContent;
    TREE.forEach((entry) => expect(tree).toContain(entry.name));
    // And the copyable text is derived from the drawn tree, so what lands on
    // a clipboard cannot drift from what was read.
    TREE.forEach((entry) => expect(TREE_TEXT).toContain(entry.name));
  });
});

describe("the documentation index points at the standard", () => {
  it("links the Folder Standard page", () => {
    render(<Documentation />);
    expect(screen.getByTestId("folder-standard-link")).toHaveAttribute(
      "href",
      "/documentation/folder-standard"
    );
  });

  it("does not present the general template as the Folder Standard", () => {
    // Two incompatible layouts on one page is the failure this guards: the
    // general template uses figures/ and data/raw/, which the analyzer does
    // not read as charts/ and datasets/.
    const { container } = render(<Documentation />);
    const callout = screen.getByTestId("folder-standard-callout");
    expect(callout).toHaveTextContent(/qresp folder standard v1/i);
    // The general template is explicitly marked as NOT the standard.
    expect(container.textContent).toMatch(/not.{0,20}the\s+Folder Standard/i);
    // ...and the standard's own tree is not restated here.
    expect(screen.queryByTestId("folder-guide-tree")).toBeNull();
  });
});
