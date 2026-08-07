/**
 * The Paper Details page must carry the Suggested Related Papers section
 * bottom, and must keep rendering exactly as before when the feature is off
 * or the request fails.
 *
 * The heavy visual children (lightbox gallery, vis-network workflow graph)
 * are stubbed: what is under test here is the page's composition, not those
 * components, which have their own coverage.
 */
import { render, screen, waitFor } from "@testing-library/react";

jest.mock("axios");
import axios from "axios";

jest.mock("../components/Paper/Charts", () => () => <div>charts-stub</div>);
jest.mock("../components/Paper/Workflow", () => () => <div>workflow-stub</div>);
jest.mock("../components/Paper/PermissionNotice", () => () => (
  <div>permission-stub</div>
));
jest.mock("next/router", () => ({ useRouter: () => ({ reload: jest.fn() }) }));

import AlertContext from "../Context/Alert/alertContext";
import PaperDetails from "../pages/paperdetails/[id]";

const paper = {
  id: "abc123",
  title: "Rareword resonance of gadgetite lattices",
  authors: "Robin Sharedname",
  tags: ["rareword resonance"],
  collections: ["MICCOM"],
  PIs: "Robin Sharedname",
  publication: "Journal of Placeholder Science 1, 1-2",
  year: 2020,
  doi: "10.1000/subject",
  cite: "",
  downloadPath: "",
  notebookFile: "",
  notebookPath: "",
  abstract: "Rareword resonance in gadgetite lattices.",
  charts: [],
  fileServerPath: "https://files.example.org/subject",
  datasets: [],
  tools: [],
  scripts: [],
  documentation: "",
  firstName: "Curator",
  middleName: "",
  lastName: "Person",
  emailId: "curator@example.com",
  affiliation: "Somewhere",
  heads: [],
  license: "cc-by",
  workflows: { edges: [], nodes: [] },
};

const related = {
  paper_id: "abc123",
  enabled: true,
  internal: {
    status: "ok",
    count: 1,
    results: [
      {
        id: "internal-1",
        title: "Rareword resonance of gadgetite thin films",
        authors: "Robin Sharedname",
        year: 2021,
        doi: "10.1000/near",
        url: null,
        source: "internal",
        reasons: ["High title and abstract similarity (0.48)"],
      },
    ],
  },
  external: {
    status: "ok",
    provider: "Semantic Scholar",
    count: 0,
    results: [],
    stale: false,
    updated_at: null,
  },
};

const renderPage = (props = {}) =>
  render(
    <AlertContext.Provider value={{ setAlert: jest.fn(), unsetAlert: jest.fn() }}>
      <PaperDetails
        paper={paper}
        error={false}
        query={{ id: "abc123", server: "https://localhost:8443" }}
        {...props}
      />
    </AlertContext.Provider>
  );

describe("Paper Details / Suggested Related Papers", () => {
  afterEach(() => jest.resetAllMocks());

  it("shows Suggested Related Papers below the record's own sections", async () => {
    axios.get.mockResolvedValue({ data: related });
    renderPage();
    expect(
      await screen.findByRole("heading", { name: /related qresp records/i })
    ).toBeInTheDocument();
    expect(axios.get).toHaveBeenCalledWith("/api/paper/abc123/related");
    // The page's own content is still there.
    expect(screen.getByText("charts-stub")).toBeInTheDocument();
    expect(
      screen.getByText(/rareword resonance of gadgetite thin films/i)
    ).toBeInTheDocument();
  });

  it("renders the page unchanged when the feature is off", async () => {
    axios.get.mockResolvedValue({
      data: {
        paper_id: "abc123",
        enabled: false,
        internal: { status: "disabled", results: [], count: 0 },
        external: { status: "disabled", results: [], count: 0, stale: false },
      },
    });
    renderPage();
    await waitFor(() =>
      expect(
        screen.queryByText(/suggested related papers/i)
      ).not.toBeInTheDocument()
    );
    expect(screen.getByText("charts-stub")).toBeInTheDocument();
  });

  it("renders the page unchanged when the related request fails", async () => {
    axios.get.mockRejectedValue(new Error("boom"));
    renderPage();
    await waitFor(() =>
      expect(
        screen.queryByText(/suggested related papers/i)
      ).not.toBeInTheDocument()
    );
    expect(screen.getByText("charts-stub")).toBeInTheDocument();
    expect(
      screen.getAllByText(/gadgetite lattices/i).length
    ).toBeGreaterThan(0);
  });

  it("does not offer Suggested Related Papers for an unpublished preview", async () => {
    axios.get.mockResolvedValue({ data: related });
    renderPage({ preview: true });
    await waitFor(() =>
      expect(screen.getByText(/this is unpublished content/i)).toBeInTheDocument()
    );
    expect(
        screen.queryByText(/suggested related papers/i)
      ).not.toBeInTheDocument();
    expect(axios.get).not.toHaveBeenCalled();
  });
});
