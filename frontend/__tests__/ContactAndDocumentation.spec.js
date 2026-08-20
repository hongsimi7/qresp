import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import Contact, {
  EMAIL,
  ISSUES,
  PULL_REQUESTS,
  REPOSITORY,
} from "../pages/contact";
import Documentation, { DIRECTORY_TEMPLATE } from "../pages/documentation";
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

  it("keeps a one-click Email DataDev button", () => {
    render(<Contact />);
    const button = screen.getByTestId("email-datadev");
    expect(button).toHaveAttribute("href", `mailto:${EMAIL}`);
    expect(button).toHaveTextContent("Email DataDev");
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
