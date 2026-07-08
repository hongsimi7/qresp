import { useContext, useEffect, useState } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import CuratorState from "../Context/Curator/CuratorState";
import CuratorContext from "../Context/Curator/curatorContext";
import { saveServerDraft } from "../Utils/serverDrafts";

jest.mock("../Utils/serverDrafts", () => ({
  saveServerDraft: jest.fn(() =>
    Promise.resolve({ id: "draft123", title: "Saved draft" })
  ),
}));

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
      <button onClick={() => resetAll({ preserveDraft: true })}>
        Save and start blank
      </button>
    </div>
  );
};

const ServerDraftProbe = () => {
  const { registerDraftFlusher, saveDraftToServer } =
    useContext(CuratorContext);

  useEffect(
    () =>
      registerDraftFlusher("open-reference-form", () => ({
        referenceInfo: {
          title: "Unsaved reference title",
          authors: "",
          publication: "",
          year: null,
          doi: "",
          kind: "",
          url: "",
          abstract: "",
        },
      })),
    [registerDraftFlusher]
  );

  return (
    <button onClick={() => saveDraftToServer("Named server draft")}>
      Save server draft
    </button>
  );
};

const UnsavedOpenFormProbe = () => {
  const { registerDraftFlusher, hasUnsavedDraftChanges } =
    useContext(CuratorContext);
  const [status, setStatus] = useState("unknown");

  useEffect(
    () =>
      registerDraftFlusher("open-curator-form", () => ({
        curatorInfo: {
          firstName: "Typed",
          middleName: "",
          lastName: "",
          emailId: "",
          affiliation: "",
        },
      })),
    [registerDraftFlusher]
  );

  return (
    <div>
      <span data-testid="unsaved-status">{status}</span>
      <button
        onClick={() =>
          setStatus(hasUnsavedDraftChanges() ? "unsaved" : "clean")
        }
      >
        Check unsaved
      </button>
    </div>
  );
};

describe("CuratorState draft persistence", () => {
  beforeEach(() => {
    localStorage.clear();
    saveServerDraft.mockClear();
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

    await user.click(screen.getByRole("button", { name: /^start blank$/i }));

    expect(localStorage.getItem("state")).toBeNull();
    expect(screen.getByTestId("first-name")).toHaveTextContent("blank");
  });

  it("can preserve the saved draft while starting a blank form", async () => {
    localStorage.setItem("state", JSON.stringify(savedDraft));
    const user = userEvent.setup();
    render(
      <CuratorState autoResumeDraft={true}>
        <Probe />
      </CuratorState>
    );

    await waitFor(() =>
      expect(screen.getByTestId("first-name")).toHaveTextContent("fake")
    );
    await user.click(
      screen.getByRole("button", { name: /save and start blank/i })
    );

    expect(JSON.parse(localStorage.getItem("state")).curatorInfo.firstName).toBe(
      "fake"
    );
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

  it("saves registered open-form values to account drafts before validation", async () => {
    const user = userEvent.setup();
    render(
      <CuratorState draftKey={null}>
        <ServerDraftProbe />
      </CuratorState>
    );

    await user.click(screen.getByRole("button", { name: /save server draft/i }));

    await waitFor(() =>
      expect(saveServerDraft).toHaveBeenCalledWith(
        null,
        expect.objectContaining({
          referenceInfo: expect.objectContaining({
            title: "Unsaved reference title",
          }),
        }),
        "Named server draft"
      )
    );
  });

  it("treats unsaved open-form values as navigation-worthy changes", async () => {
    const user = userEvent.setup();
    render(
      <CuratorState draftKey={null}>
        <UnsavedOpenFormProbe />
      </CuratorState>
    );

    await user.click(screen.getByRole("button", { name: /check unsaved/i }));

    expect(screen.getByTestId("unsaved-status")).toHaveTextContent("unsaved");
  });
});
