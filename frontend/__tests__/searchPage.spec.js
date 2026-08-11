jest.mock("axios");
import axios from "axios";

import { getServerSideProps } from "../pages/search";

const endpointData = {
  search: [{ _Search__id: "paper-1", _Search__title: "STAGING TEST" }],
  collections: ["MICCOM"],
  authors: ["Giulia Galli"],
  publications: ["Journal"],
};

const mockEndpointResponses = () => {
  axios.get.mockImplementation((url) => {
    const endpoint = url.split("/api/")[1];
    return Promise.resolve({ data: endpointData[endpoint] || [] });
  });
};

describe("search getServerSideProps", () => {
  const originalInternalApi = process.env.QRESP_INTERNAL_API_URL;

  afterEach(() => {
    jest.resetAllMocks();
    if (originalInternalApi === undefined) {
      delete process.env.QRESP_INTERNAL_API_URL;
    } else {
      process.env.QRESP_INTERNAL_API_URL = originalInternalApi;
    }
  });

  it("uses the internal backend for localhost staging while keeping the public server key", async () => {
    process.env.QRESP_INTERNAL_API_URL = "http://backend:5000";
    mockEndpointResponses();

    const result = await getServerSideProps({
      query: { servers: "https://localhost:8443" },
      req: { headers: { host: "localhost:8443" } },
    });

    expect(axios.get).toHaveBeenCalledWith("http://backend:5000/api/search");
    expect(axios.get).toHaveBeenCalledWith(
      "http://backend:5000/api/collections"
    );
    expect(result.props.error.is).toBe(false);
    expect(result.props.selectedservers).toEqual(["https://localhost:8443"]);
    expect(result.props.initialdata.papers).toEqual({
      "https://localhost:8443": endpointData.search,
    });
  });

  it("keeps external federation nodes unchanged", async () => {
    process.env.QRESP_INTERNAL_API_URL = "http://backend:5000";
    mockEndpointResponses();

    await getServerSideProps({
      query: { servers: "https://paperstack.uchicago.edu" },
      req: { headers: { host: "localhost:8443" } },
    });

    expect(axios.get).toHaveBeenCalledWith(
      "https://paperstack.uchicago.edu/api/search"
    );
  });
});


// One Qresp server is asked for four endpoints, and they are not equal:
//
//   /api/search       -> data.papers[server] -> the results table   CORE
//   /api/collections  |
//   /api/authors      |-> AdvancedSearch dropdown options          AUXILIARY
//   /api/publications |
//
// The loop used to `break` on the first failure of either kind and mark the
// whole SERVER failed. So a server whose records had already loaded, but whose
// authors list 404'd, was reported as "records are missing" -- and because
// `total` was `failed.length >= servers.length`, a single such server turned
// the whole page into an unavailable state while its records sat in `data`.
describe("search getServerSideProps: core vs auxiliary endpoints", () => {
  const A = "https://alpha.example.org";
  const B = "https://beta.example.org";

  const responder = (failures) =>
    axios.get.mockImplementation((url) => {
      const endpoint = url.split("/api/")[1];
      // The base is rewritten per server, so the server is identified by
      // which base the helper produced.
      const server = url.startsWith(A) ? A : url.startsWith(B) ? B : A;
      if ((failures[server] || []).includes(endpoint)) {
        return Promise.reject(new Error(`${endpoint} is down`));
      }
      return Promise.resolve({ data: endpointData[endpoint] || [] });
    });

  const run = (servers, failures = {}) => {
    responder(failures);
    return getServerSideProps({
      query: { servers: servers.join(",") },
      req: { headers: { host: "qresp.example.org" } },
    });
  };

  it("reports nothing when every endpoint answers", async () => {
    const { props } = await run([A]);
    expect(props.error.is).toBe(false);
    expect(props.error.failed).toEqual([]);
    expect(props.error.filters).toEqual({});
    expect(props.error.total).toBe(false);
    expect(props.initialdata.papers[A]).toHaveLength(1);
  });

  it("keeps the records when only an auxiliary endpoint fails", async () => {
    const { props } = await run([A], { [A]: ["authors"] });

    // The records loaded, so this server is NOT a failed record source...
    expect(props.initialdata.papers[A]).toHaveLength(1);
    expect(props.error.failed).toEqual([]);
    expect(props.error.total).toBe(false);
    // ...and the auxiliary failure is recorded as exactly what it is.
    expect(props.error.filters).toEqual({ [A]: ["authors"] });
  });

  it("does not let one auxiliary failure skip the others", async () => {
    // The old `break` meant a failing `collections` also lost `authors` and
    // `publications`, which had nothing wrong with them.
    const { props } = await run([A], { [A]: ["collections"] });
    expect(props.error.filters).toEqual({ [A]: ["collections"] });
    expect(props.initialdata.authors.length).toBeGreaterThan(0);
    expect(props.initialdata.publications.length).toBeGreaterThan(0);
  });

  it("records several auxiliary failures on one server", async () => {
    const { props } = await run([A], { [A]: ["authors", "collections"] });
    expect(props.error.filters[A].sort()).toEqual(["authors", "collections"]);
    expect(props.error.failed).toEqual([]);
  });

  it("drops the records and skips the filters when the core fails", async () => {
    const { props } = await run([A], { [A]: ["search"] });
    expect(props.initialdata.papers[A]).toBeUndefined();
    expect(props.error.failed).toEqual([A]);
    expect(props.error.total).toBe(true);
    // No point asking a server that could not serve its records.
    expect(props.error.filters[A]).toBeUndefined();
  });

  it("keeps a healthy server's records when another server's core fails", async () => {
    const { props } = await run([A, B], { [B]: ["search"] });
    expect(props.initialdata.papers[A]).toHaveLength(1);
    expect(props.initialdata.papers[B]).toBeUndefined();
    expect(props.error.failed).toEqual([B]);
    expect(props.error.total).toBe(false);
  });

  it("separates a core failure on one server from a filter failure on another", async () => {
    const { props } = await run([A, B], {
      [A]: ["authors"],
      [B]: ["search"],
    });
    expect(props.initialdata.papers[A]).toHaveLength(1);
    expect(props.error.failed).toEqual([B]);
    expect(props.error.filters).toEqual({ [A]: ["authors"] });
    expect(props.error.total).toBe(false);
  });

  it("is total only when every server's CORE failed", async () => {
    const { props } = await run([A, B], {
      [A]: ["search"],
      [B]: ["search"],
    });
    expect(props.error.total).toBe(true);
    expect(props.error.failed.sort()).toEqual([A, B].sort());
  });

  it("is not total when every server merely lost a filter", async () => {
    // The bug this pins: `failed.length >= servers.length` made one server
    // with one broken auxiliary endpoint look like a total outage.
    const { props } = await run([A], { [A]: ["publications"] });
    expect(props.error.total).toBe(false);
    expect(props.initialdata.papers[A]).toHaveLength(1);
  });

  it("keeps error.is and error.msg for older readers", async () => {
    const { props } = await run([A, B], { [B]: ["search"] });
    expect(props.error.is).toBe(true);
    expect(props.error.msg).toContain(B);
    expect(props.error.msg).not.toContain(A);
  });
});
