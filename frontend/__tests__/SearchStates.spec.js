/**
 * What the search page says while it is working, and when a node is down.
 *
 * The reported failure: choosing an unreachable node produced a blocking
 * "Search Error!" dialog on top of a page reading "0 Records Available".
 * Neither statement was useful -- a modal cannot be worked around, and
 * "0 records" is what a healthy but empty node also says. Now Explorer sends
 * everyone here directly, so this page is the first thing a visitor sees and
 * it has to be honest about which of the three states it is in.
 */
import { render, screen, act, within } from "@testing-library/react";

const routerEvents = {
  handlers: {},
  on(name, fn) {
    (this.handlers[name] = this.handlers[name] || []).push(fn);
  },
  off(name, fn) {
    this.handlers[name] = (this.handlers[name] || []).filter((h) => h !== fn);
  },
  emit(name, ...args) {
    (this.handlers[name] || []).forEach((fn) => fn(...args));
  },
};

const reload = jest.fn();
jest.mock("next/router", () => ({
  useRouter: () => ({ reload, events: routerEvents, push: jest.fn() }),
}));

jest.mock("axios");

import AlertContext from "../Context/Alert/alertContext";
import LoadingContext from "../Context/Loading/loadingContext";
import ServerContext from "../Context/Servers/serverContext";
import Search from "../pages/search";

const PAPER = (id, title) => ({
  _Search__id: id,
  _Search__title: title,
  _Search__authors: "Ada Lovelace",
  _Search__tags: ["dft"],
  _Search__year: 2024,
  _Search__abstract: "",
  _Search__doi: "",
  _Search__collections: [],
});

const ALPHA = "https://alpha.example.org";
const BETA = "https://beta.example.org";
// Notices count sources, they do not name them: a Qresp node is shared
// infrastructure, and putting its operator's name beside a failure invites a
// reader to blame an institution for an outage it has nothing to do with.
const ONE_UNAVAILABLE = /one source is unavailable/i;

const dataWith = (papersByServer) => ({
  papers: papersByServer,
  authors: ["Ada Lovelace"],
  collections: [],
  publications: [],
});

const setAlert = jest.fn();

const renderSearch = (props) =>
  render(
    <AlertContext.Provider value={{ setAlert, unsetAlert: jest.fn() }}>
      <LoadingContext.Provider
        value={{ showLoader: jest.fn(), hideLoader: jest.fn() }}
      >
      <ServerContext.Provider
        value={{ setSelected: jest.fn(), selected: [ALPHA] }}
      >
        <Search
          initialdata={dataWith({})}
          error={{ is: false, msg: "", failed: [], total: false }}
          selectedservers={[ALPHA]}
          {...props}
        />
      </ServerContext.Provider>
      </LoadingContext.Provider>
    </AlertContext.Provider>
  );

describe("search page states", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    routerEvents.handlers = {};
  });

  it("renders exactly the records the backend returned", () => {
    renderSearch({
      initialdata: dataWith({
        [ALPHA]: [PAPER("a", "First paper"), PAPER("b", "Second paper")],
      }),
    });
    // The COUNT is whatever arrived; no number is assumed anywhere.
    expect(screen.getByTestId("record-count")).toHaveTextContent(
      "2 Records Available"
    );
    expect(screen.getByText("First paper")).toBeInTheDocument();
  });

  it("never raises a blocking modal for a search failure", () => {
    renderSearch({
      initialdata: dataWith({}),
      error: {
        is: true,
        msg: "Could not fetch data from these servers: " + ALPHA,
        failed: [ALPHA],
        total: true,
      },
    });
    expect(setAlert).not.toHaveBeenCalled();
  });

  it("shows an in-page unavailable state with Retry when every node failed", () => {
    renderSearch({
      initialdata: dataWith({}),
      error: { is: true, msg: "", failed: [ALPHA], total: true },
    });

    const panel = screen.getByTestId("search-unavailable");
    expect(panel).toHaveTextContent(/no records could be loaded/i);
    expect(panel).toHaveTextContent(ONE_UNAVAILABLE);
    expect(panel).not.toHaveTextContent(ALPHA);
    // ...and it does NOT claim the node has no records.
    expect(screen.queryByTestId("record-count")).toBeNull();
    expect(screen.queryByText(/0 +Records Available/i)).toBeNull();

    screen.getByRole("button", { name: /retry/i }).click();
    expect(reload).toHaveBeenCalled();
  });

  it("shows the working sources' records with no warning at all", () => {
    // Federation is plumbing. A visitor did not choose which nodes back this
    // search and can do nothing about one being down, so a warning above a
    // page that is working asks them to worry about a move they do not have.
    renderSearch({
      initialdata: dataWith({ [ALPHA]: [PAPER("a", "From alpha")] }),
      error: { is: true, msg: "", failed: [BETA], total: false },
    });

    expect(screen.getByText("From alpha")).toBeInTheDocument();
    expect(screen.getByTestId("record-count")).toHaveTextContent(
      "1 Records Available"
    );
    expect(screen.queryByTestId("search-partial-failure")).toBeNull();
    expect(screen.queryByText(/records are missing/i)).toBeNull();
    expect(screen.queryByText(/source is unavailable/i)).toBeNull();
    expect(screen.queryByTestId("search-unavailable")).toBeNull();
    expect(setAlert).not.toHaveBeenCalled();
  });

  it("offers no retry when the page is working, only when it is not", () => {
    // There is nothing to retry FROM: the records the reader asked for are
    // on screen. The retry belongs to the total failure, where they are not.
    renderSearch({
      initialdata: dataWith({ [ALPHA]: [PAPER("a", "From alpha")] }),
      error: { is: true, msg: "", failed: [BETA], total: false },
    });
    expect(screen.queryByRole("button", { name: /retry/i })).toBeNull();
  });

  it("names no institution when everything is down either", () => {
    // The registry knows this node as "Duke University". The error a reader
    // DOES see must not put an institution's name on an outage.
    renderSearch({
      initialdata: dataWith({}),
      error: { is: true, msg: "", failed: [BETA], total: true },
      servernames: { [BETA]: "Duke University" },
    });
    const panel = screen.getByTestId("search-unavailable");
    expect(panel).toHaveTextContent(ONE_UNAVAILABLE);
    expect(panel).not.toHaveTextContent(/duke/i);
    expect(panel).not.toHaveTextContent(BETA);
  });

  it("counts the sources when more than one is down", () => {
    renderSearch({
      initialdata: dataWith({}),
      error: { is: true, msg: "", failed: [BETA, "https://gamma.example.org"],
               total: true },
    });
    expect(screen.getByTestId("search-unavailable")).toHaveTextContent(
      /2 sources are unavailable/i
    );
  });

  it("shows a loading state instead of a record count during navigation", () => {
    renderSearch({
      initialdata: dataWith({ [ALPHA]: [PAPER("a", "First")] }),
    });
    expect(screen.getByTestId("record-count")).toBeInTheDocument();

    act(() => routerEvents.emit("routeChangeStart", "/search?servers=x"));

    // The old count is NOT left on screen, and "0 Records Available" is never
    // shown as a stand-in for "still loading".
    expect(screen.queryByTestId("record-count")).toBeNull();
    expect(screen.getByTestId("search-loading")).toBeInTheDocument();
    expect(screen.queryByText(/0 +Records Available/i)).toBeNull();

    act(() => routerEvents.emit("routeChangeComplete", "/search?servers=x"));
    expect(screen.getByTestId("record-count")).toBeInTheDocument();
  });

  it("does not show loading for a navigation away from search", () => {
    renderSearch({
      initialdata: dataWith({ [ALPHA]: [PAPER("a", "First")] }),
    });
    act(() => routerEvents.emit("routeChangeStart", "/curator"));
    expect(screen.queryByTestId("search-loading")).toBeNull();
  });

  it("clears the loading state when a navigation errors", () => {
    renderSearch({
      initialdata: dataWith({ [ALPHA]: [PAPER("a", "First")] }),
    });
    act(() => routerEvents.emit("routeChangeStart", "/search?servers=x"));
    act(() => routerEvents.emit("routeChangeError"));
    expect(screen.queryByTestId("search-loading")).toBeNull();
  });

  it("keeps each record's source server for its detail link", () => {
    renderSearch({
      initialdata: dataWith({
        [ALPHA]: [PAPER("a", "From alpha")],
        [BETA]: [PAPER("b", "From beta")],
      }),
    });
    // Summary builds /paperdetails/<id>?server=<origin>; the origin has to be
    // the one the record actually came from or the detail page reads the
    // wrong node.
    const links = screen.getAllByRole("link");
    const hrefs = links.map((link) => link.getAttribute("href"));
    expect(hrefs.some((href) => href.includes(encodeURIComponent(ALPHA))))
      .toBe(true);
    expect(hrefs.some((href) => href.includes(encodeURIComponent(BETA))))
      .toBe(true);
  });
});

// A node whose records loaded but whose authors list 404'd is not a node
// whose records are missing. Saying so was the reported contradiction:
// records visibly on the page, under a banner claiming they were absent.
describe("search page: record-source vs filter failures", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    routerEvents.handlers = {};
  });

  const withError = (overrides, papers) =>
    renderSearch({
      initialdata: dataWith(papers || { [ALPHA]: [PAPER("a", "From alpha")] }),
      error: { is: true, msg: "", failed: [], filters: {}, total: false,
               ...overrides },
    });

  it("says filters are incomplete, NOT that records are missing", () => {
    withError({ filters: { [ALPHA]: ["authors", "collections"] } });

    // The records are on the page...
    expect(screen.getByText("From alpha")).toBeInTheDocument();
    expect(screen.getByTestId("record-count")).toHaveTextContent(
      "1 Records Available"
    );
    // ...so the notice names the FILTERS that are short -- which is the part
    // a reader can act on -- and not the node, which is not.
    const notice = screen.getByTestId("search-filter-failure");
    expect(notice).toHaveTextContent(/search filters have fewer options/i);
    expect(notice).toHaveTextContent(/authors/);
    expect(notice).toHaveTextContent(/collections/);
    expect(notice).not.toHaveTextContent(ALPHA);
    // The wrong sentence must not appear anywhere.
    expect(screen.queryByText(/records are missing/i)).toBeNull();
    expect(screen.queryByTestId("search-partial-failure")).toBeNull();
    expect(screen.queryByTestId("search-unavailable")).toBeNull();
    expect(setAlert).not.toHaveBeenCalled();
  });

  it("says nothing at all when a node's records are missing but others answered", () => {
    // The distinction this describe block exists for is unchanged: a failed
    // RECORDS endpoint and a failed FILTER endpoint are different events.
    // What changed is that the first no longer warns while the page works.
    withError({ failed: [BETA] });
    expect(screen.queryByTestId("search-partial-failure")).toBeNull();
    expect(screen.queryByTestId("search-filter-failure")).toBeNull();
    expect(screen.getByText("From alpha")).toBeInTheDocument();
  });

  it("keeps the filter notice when both kinds of failure happen together", () => {
    // The filter notice survives because it is about something the reader
    // CAN act on -- a dropdown that is short of options, which changes what
    // they can search for. The missing-records banner does not.
    withError({ failed: [BETA], filters: { [ALPHA]: ["authors"] } });
    expect(screen.queryByTestId("search-partial-failure")).toBeNull();
    expect(screen.getByTestId("search-filter-failure")).toHaveTextContent(
      /authors/
    );
    expect(screen.getByText("From alpha")).toBeInTheDocument();
    expect(screen.queryByTestId("search-unavailable")).toBeNull();
  });

  it("does not mention filters at all when nothing failed", () => {
    renderSearch({
      initialdata: dataWith({ [ALPHA]: [PAPER("a", "From alpha")] }),
    });
    expect(screen.queryByTestId("search-filter-failure")).toBeNull();
    expect(screen.queryByTestId("search-partial-failure")).toBeNull();
  });

  it("shows only the unavailable panel when every node's records failed", () => {
    withError({ failed: [ALPHA], filters: { [ALPHA]: ["authors"] },
                total: true }, {});
    expect(screen.getByTestId("search-unavailable")).toBeInTheDocument();
    // A filter notice beside "nothing loaded" would be noise.
    expect(screen.queryByTestId("search-filter-failure")).toBeNull();
    expect(screen.queryByTestId("record-count")).toBeNull();
  });
});
