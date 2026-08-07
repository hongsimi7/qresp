import { render, screen, waitFor, within } from "@testing-library/react";

jest.mock("axios");
import axios from "axios";

import RelatedResearch from "../components/Paper/RelatedResearch";

const internalResult = (overrides = {}) => ({
  id: "internal-1",
  title: "Rareword resonance of gadgetite thin films",
  authors: "Robin Sharedname, Casey Otherperson",
  year: 2021,
  doi: "10.1000/near",
  url: null,
  source: "internal",
  reasons: [
    "High title and abstract similarity (0.48)",
    "Shared specific keywords: rareword resonance",
    "Shared author (Robin Sharedname) on a related topic",
  ],
  ...overrides,
});

const externalResult = (overrides = {}) => ({
  id: null,
  title: "Rareword resonance in gadgetite single crystals",
  authors: "Someone Else",
  year: 2022,
  doi: "10.2000/external-a",
  url: "https://doi.org/10.2000/external-a",
  source: "external",
  reasons: ["Shares 4 specific research terms: gadgetite, rareword"],
  ...overrides,
});

const payload = (overrides = {}) => ({
  paper_id: "abc123",
  enabled: true,
  internal: { status: "ok", results: [internalResult()], count: 1 },
  external: {
    status: "ok",
    provider: "Semantic Scholar",
    results: [externalResult()],
    count: 1,
    stale: false,
    updated_at: "2026-08-01T00:00:00",
  },
  ...overrides,
});

const renderSection = (data, props = {}) => {
  if (data instanceof Error) {
    axios.get.mockRejectedValue(data);
  } else {
    axios.get.mockResolvedValue({ data });
  }
  return render(
    <RelatedResearch paperId="abc123" server="https://localhost:8443" {...props} />
  );
};

const sectionFor = async (name) => {
  const heading = await screen.findByRole("heading", { name });
  return heading.closest("div");
};

describe("RelatedResearch", () => {
  afterEach(() => jest.resetAllMocks());

  it("asks the backend for the record's related research", async () => {
    renderSection(payload());
    await screen.findByRole("heading", { name: /related qresp records/i });
    expect(axios.get).toHaveBeenCalledWith("/api/paper/abc123/related");
  });

  it("shows a loading state before the answer arrives", async () => {
    let resolve;
    axios.get.mockReturnValue(
      new Promise((r) => {
        resolve = r;
      })
    );
    render(<RelatedResearch paperId="abc123" server="s" />);
    expect(screen.getByText(/looking for related research/i)).toBeInTheDocument();
    resolve({ data: payload() });
    await screen.findByRole("heading", { name: /related qresp records/i });
    expect(
      screen.queryByText(/looking for related research/i)
    ).not.toBeInTheDocument();
  });

  it("keeps the internal and external lists separate", async () => {
    renderSection(payload());
    const internal = await sectionFor(/related qresp records/i);
    const external = await sectionFor(/related external papers/i);
    expect(
      within(internal).getByText(/gadgetite thin films/)
    ).toBeInTheDocument();
    expect(
      within(internal).queryByText(/gadgetite single crystals/)
    ).not.toBeInTheDocument();
    expect(
      within(external).getByText(/gadgetite single crystals/)
    ).toBeInTheDocument();
  });

  it("links internal results into Qresp and external results to their DOI", async () => {
    renderSection(payload());
    const internalLink = await screen.findByRole("link", {
      name: /gadgetite thin films/i,
    });
    expect(internalLink).toHaveAttribute(
      "href",
      "/paperdetails/internal-1?server=https%3A%2F%2Flocalhost%3A8443"
    );
    const externalLink = screen.getByRole("link", {
      name: /gadgetite single crystals/i,
    });
    expect(externalLink).toHaveAttribute(
      "href",
      "https://doi.org/10.2000/external-a"
    );
    expect(externalLink).toHaveAttribute("target", "_blank");
    expect(externalLink).toHaveAttribute("rel", expect.stringContaining("noopener"));
  });

  it("shows Why related, capped at three reasons", async () => {
    renderSection(
      payload({
        internal: {
          status: "ok",
          count: 1,
          results: [
            internalResult({
              reasons: ["reason one", "reason two", "reason three", "reason four"],
            }),
          ],
        },
      })
    );
    const internal = await sectionFor(/related qresp records/i);
    expect(within(internal).getByText(/why related/i)).toBeInTheDocument();
    expect(within(internal).getByText("reason one")).toBeInTheDocument();
    expect(within(internal).getByText("reason three")).toBeInTheDocument();
    expect(within(internal).queryByText("reason four")).not.toBeInTheDocument();
  });

  it("marks external results with their provenance and internal results without it", async () => {
    renderSection(payload());
    const external = await sectionFor(/related external papers/i);
    expect(
      within(external).getByText(/recommended by semantic scholar/i)
    ).toBeInTheDocument();
    const internal = await sectionFor(/related qresp records/i);
    expect(
      within(internal).queryByText(/recommended by semantic scholar/i)
    ).not.toBeInTheDocument();
  });

  it("never renders more than five results per list", async () => {
    const many = (source, count) =>
      Array.from({ length: count }, (_, i) =>
        source === "internal"
          ? internalResult({ id: `i${i}`, title: `Internal record ${i}` })
          : externalResult({
              doi: `10.2000/x${i}`,
              url: `https://doi.org/10.2000/x${i}`,
              title: `External paper ${i}`,
            })
      );
    // The backend caps at five; the component must not re-expand the list.
    renderSection(
      payload({
        internal: { status: "ok", count: 5, results: many("internal", 5) },
        external: {
          status: "ok",
          provider: "Semantic Scholar",
          stale: false,
          count: 5,
          results: many("external", 5),
          updated_at: null,
        },
      })
    );
    const internal = await sectionFor(/related qresp records/i);
    const external = await sectionFor(/related external papers/i);
    expect(within(internal).getAllByTestId("related-result")).toHaveLength(5);
    expect(within(external).getAllByTestId("related-result")).toHaveLength(5);
  });

  it("says so plainly when nothing is related enough", async () => {
    renderSection(
      payload({
        internal: { status: "ok", results: [], count: 0 },
        external: {
          status: "ok",
          provider: "Semantic Scholar",
          results: [],
          count: 0,
          stale: false,
          updated_at: null,
        },
      })
    );
    const messages = await screen.findAllByText(
      "No sufficiently related papers were found."
    );
    expect(messages).toHaveLength(2);
  });

  it("keeps the internal list when the external provider fails", async () => {
    renderSection(
      payload({
        external: {
          status: "unavailable",
          provider: "Semantic Scholar",
          results: [],
          count: 0,
          stale: false,
          updated_at: null,
        },
      })
    );
    expect(
      await screen.findByText(/gadgetite thin films/)
    ).toBeInTheDocument();
    expect(
      screen.getByText(/external recommendations are unavailable right now/i)
    ).toBeInTheDocument();
  });

  it("flags stale external results instead of hiding them", async () => {
    renderSection(
      payload({
        external: {
          status: "unavailable",
          provider: "Semantic Scholar",
          results: [externalResult()],
          count: 1,
          stale: true,
          updated_at: "2026-07-01T00:00:00",
        },
      })
    );
    expect(
      await screen.findByText(/showing the last successful external results/i)
    ).toBeInTheDocument();
    expect(screen.getByText(/gadgetite single crystals/)).toBeInTheDocument();
  });

  it("explains an unmatched record differently from a provider outage", async () => {
    renderSection(
      payload({
        external: {
          status: "unresolved",
          provider: "Semantic Scholar",
          results: [],
          count: 0,
          stale: false,
          updated_at: null,
        },
      })
    );
    expect(
      await screen.findByText(/could not be matched in the external index/i)
    ).toBeInTheDocument();
  });

  it("hides the external half entirely on an internal-only server", async () => {
    // The server is running with the external switch off. That is not "we
    // looked and found nothing" — the external half does not exist here, so
    // the reader is not told about a feature this deployment lacks.
    renderSection(
      payload({
        external: {
          status: "disabled",
          provider: "Semantic Scholar",
          results: [],
          count: 0,
          stale: false,
          updated_at: null,
        },
      })
    );
    // The internal list is still shown in full.
    expect(
      await screen.findByRole("heading", { name: /related qresp records/i })
    ).toBeInTheDocument();
    expect(screen.getByText(/gadgetite thin films/)).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: /related external papers/i })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(/recommended by semantic scholar/i)
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(/external recommendations are turned off/i)
    ).not.toBeInTheDocument();
  });

  it("still shows the empty message for the internal list when external is off", async () => {
    renderSection(
      payload({
        internal: { status: "ok", results: [], count: 0 },
        external: {
          status: "disabled",
          provider: "Semantic Scholar",
          results: [],
          count: 0,
          stale: false,
          updated_at: null,
        },
      })
    );
    const messages = await screen.findAllByText(
      "No sufficiently related papers were found."
    );
    expect(messages).toHaveLength(1);
  });

  it("renders nothing at all when the feature is disabled server-side", async () => {
    const { container } = renderSection({
      paper_id: "abc123",
      enabled: false,
      internal: { status: "disabled", results: [], count: 0 },
      external: { status: "disabled", results: [], count: 0, stale: false },
    });
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it("renders nothing when the request fails (previews, older backends)", async () => {
    const { container } = renderSection(new Error("404"));
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });
});
