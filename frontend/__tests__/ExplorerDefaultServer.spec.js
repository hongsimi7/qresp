/**
 * Explorer opens on RESULTS, not on a node picker.
 *
 * The old flow made every visitor answer a question before seeing anything:
 * pick a node, then search. Picking the wrong one (Duke, currently
 * unreachable) produced a blocking "Search Error!" modal over a page reading
 * "0 Records Available" -- which is indistinguishable from a server that
 * simply has no records.
 *
 * `/explorer` now redirects, server-side, to the results of EVERY federated
 * node at once, so a reader looking for a paper does not have to know which
 * institution hosts it. The list comes from the BACKEND, which is the thing
 * that enforces the federation allowlist; no URL is hardcoded here, and
 * picking servers by hand is still reachable.
 *
 * `default_server` still decides the ORDER -- the deployment's own node leads
 * -- but no longer decides who is in the list.
 */
jest.mock("axios");
import axios from "axios";

import { getServerSideProps } from "../pages/explorer";

const FEDERATION = {
  servers: [
    { qresp_server_url: "https://alpha.example.org", isActive: "Yes" },
    { qresp_server_url: "https://beta.example.org", isActive: "Yes" },
  ],
  default_server: "https://alpha.example.org",
};

const ctx = (query = {}) => ({
  query,
  req: { headers: { host: "qresp.example.org" } },
});

describe("explorer getServerSideProps", () => {
  afterEach(() => jest.resetAllMocks());

  it("redirects to every federated node at once", async () => {
    axios.get.mockResolvedValue({ data: FEDERATION });
    const result = await getServerSideProps(ctx());

    // Both nodes, default first. Opening on one of them left half the
    // federation invisible unless a reader found `?choose=1`.
    expect(result.redirect.destination).toBe(
      `/search?servers=${encodeURIComponent("https://alpha.example.org")},` +
        `${encodeURIComponent("https://beta.example.org")}`
    );
    // A redirect, not a rewrite: back/forward and refresh all land on a real
    // URL that says which servers are being searched.
    expect(result.redirect.permanent).toBe(false);
  });

  it("puts the deployment's own node first", async () => {
    axios.get.mockResolvedValue({
      data: { ...FEDERATION, default_server: "https://beta.example.org" },
    });
    const result = await getServerSideProps(ctx());
    const [first] = decodeURIComponent(
      result.redirect.destination.split("servers=")[1]
    ).split(",");
    expect(first).toBe("https://beta.example.org");
  });

  it("asks the backend, and only the backend, which server that is", async () => {
    axios.get.mockResolvedValue({ data: FEDERATION });
    await getServerSideProps(ctx());

    expect(axios.get).toHaveBeenCalledTimes(1);
    expect(axios.get.mock.calls[0][0]).toMatch(/\/api\/federation\/servers$/);
  });

  it("never contacts a peer while deciding where to go", async () => {
    // The reported failure was Duke being called on a path nobody chose. The
    // only request this page makes is to its OWN backend.
    axios.get.mockResolvedValue({ data: FEDERATION });
    await getServerSideProps(ctx());

    // Searching both nodes is what /search does, one node at a time, AFTER
    // the redirect. This page still asks nobody but its own backend.
    const called = axios.get.mock.calls.map(([url]) => url).join(" ");
    expect(called).not.toMatch(/duke/i);
    expect(called).not.toMatch(/beta\.example\.org/);
  });

  it("falls back to the first published server when no default is named", async () => {
    // An older backend has no `default_server`. The page still opens on
    // results rather than on a picker.
    axios.get.mockResolvedValue({
      data: { servers: FEDERATION.servers },
    });
    const result = await getServerSideProps(ctx());
    expect(result.redirect.destination).toBe(
      `/search?servers=${encodeURIComponent("https://alpha.example.org")},` +
        `${encodeURIComponent("https://beta.example.org")}`
    );
  });

  it("refuses a default the published list does not contain", async () => {
    // Defence in depth: the backend already refuses this, and the page does
    // not take its word for it either.
    axios.get.mockResolvedValue({
      data: {
        servers: FEDERATION.servers,
        default_server: "https://not-listed.example.com",
      },
    });
    const result = await getServerSideProps(ctx());
    // Ignored for ordering, and it adds nothing to the list either.
    expect(result.redirect.destination).toBe(
      `/search?servers=${encodeURIComponent("https://alpha.example.org")},` +
        `${encodeURIComponent("https://beta.example.org")}`
    );
    expect(result.redirect.destination).not.toMatch(/not-listed/);
  });

  it("shows an unavailable page, not a redirect, when federation is empty", async () => {
    axios.get.mockResolvedValue({ data: { servers: [], default_server: "" } });
    const result = await getServerSideProps(ctx());
    expect(result.redirect).toBeUndefined();
    expect(result.props.unavailable).toBe(true);
  });

  it("shows an unavailable page when the backend cannot be reached", async () => {
    axios.get.mockRejectedValue(new Error("ECONNREFUSED"));
    const result = await getServerSideProps(ctx());
    expect(result.redirect).toBeUndefined();
    expect(result.props.unavailable).toBe(true);
  });

  it("still offers the picker when it is explicitly asked for", async () => {
    // Federation is not reduced to one server: choosing nodes by hand stays
    // reachable, it just is not the front door any more.
    axios.get.mockResolvedValue({ data: FEDERATION });
    const result = await getServerSideProps(ctx({ choose: "1" }));
    expect(result.redirect).toBeUndefined();
    expect(result.props.choose).toBe(true);
    // ...and it does not spend a request deciding a default it will not use.
    expect(axios.get).not.toHaveBeenCalled();
  });

  it("hardcodes no server URL and no record count", async () => {
    const source = require("fs").readFileSync(
      require("path").join(__dirname, "..", "pages", "explorer.js"),
      "utf8"
    );
    expect(source).not.toMatch(/paperstack\.uchicago\.edu/i);
    expect(source).not.toMatch(/duke\.edu/i);
    expect(source).not.toMatch(/\b65\b/);
  });
});
