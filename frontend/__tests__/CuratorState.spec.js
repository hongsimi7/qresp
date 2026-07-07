import { useContext } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import CuratorState from "../Context/Curator/CuratorState";
import CuratorContext from "../Context/Curator/curatorContext";

const savedDraft = {
  curatorInfo: {
    firstName: "fake",
    middleName: "",
    lastName: "Doe",
    emailId: "john.doe@company.com",
    affiliation: "Department of Chem",
  },
  fileServerPath: "",
  paperInfo: {
    PIs: "",
    collections: [],
    tags: [],
    notebookFile: "",
    notebookPath: "",
  },
  referenceInfo: {
    kind: "",
    doi: "",
    authors: "",
    title: "",
    publication: "",
    year: null,
    url: "",
    abstract: "",
  },
  documentation: "",
  charts: [],
  tools: [],
  datasets: [],
  scripts: [],
  heads: [],
  workflow: { nodes: [], edges: [] },
  license: "",
};

const Probe = () => {
  const { curatorInfo, resumeDraft, resetAll, getSavedDraft } =
    useContext(CuratorContext);
  return (
    <div>
      <span data-testid="first-name">{curatorInfo.firstName || "blank"}</span>
      <span data-testid="has-draft">{getSavedDraft() ? "yes" : "no"}</span>
      <button onClick={resumeDraft}>Resume</button>
      <button onClick={resetAll}>Start blank</button>
    </div>
  );
};

describe("CuratorState draft persistence", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("does not silently restore a saved create draft on mount", () => {
    localStorage.setItem("state", JSON.stringify(savedDraft));
    render(
      <CuratorState>
        <Probe />
      </CuratorState>
    );

    expect(screen.getByTestId("first-name")).toHaveTextContent("blank");
    expect(screen.getByTestId("has-draft")).toHaveTextContent("yes");
  });

  it("restores a saved create draft only when explicitly requested", async () => {
    localStorage.setItem("state", JSON.stringify(savedDraft));
    const user = userEvent.setup();
    render(
      <CuratorState>
        <Probe />
      </CuratorState>
    );

    await user.click(screen.getByRole("button", { name: /resume/i }));

    await waitFor(() =>
      expect(screen.getByTestId("first-name")).toHaveTextContent("fake")
    );
  });

  it("auto-restores a saved create draft when requested by the curator route", async () => {
    localStorage.setItem("state", JSON.stringify(savedDraft));
    render(
      <CuratorState autoResumeDraft={true}>
        <Probe />
      </CuratorState>
    );

    await waitFor(() =>
      expect(screen.getByTestId("first-name")).toHaveTextContent("fake")
    );
  });

  it("clears the saved draft when starting blank", async () => {
    localStorage.setItem("state", JSON.stringify(savedDraft));
    const user = userEvent.setup();
    render(
      <CuratorState>
        <Probe />
      </CuratorState>
    );

    await user.click(screen.getByRole("button", { name: /start blank/i }));

    expect(localStorage.getItem("state")).toBeNull();
    expect(screen.getByTestId("first-name")).toHaveTextContent("blank");
  });

  it("ignores the generic create draft when persistence is disabled", () => {
    localStorage.setItem("state", JSON.stringify(savedDraft));
    render(
      <CuratorState draftKey={null}>
        <Probe />
      </CuratorState>
    );

    expect(screen.getByTestId("first-name")).toHaveTextContent("blank");
    expect(screen.getByTestId("has-draft")).toHaveTextContent("no");
  });
});
