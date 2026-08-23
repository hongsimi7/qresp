import { useEffect, useContext, Fragment, useState } from "react";

import { useRouter } from "next/router";

import {
  Alert,
  Box,
  CircularProgress,
  Container,
  Divider,
  Typography,
} from "@mui/material";

import SEO from "../components/seo";

import { RegularStyledButton } from "../components/button";
import RecordTable from "../components/Table/Table";
import AdvancedSearch from "../components/AdvancedSearch";
import Summary from "../components/Paper/Summary";

import axios from "axios";
import AlertContext from "../Context/Alert/alertContext";
import ServerContext from "../Context/Servers/serverContext";
import { resolveServerSideApiBase } from "../Utils/serverSideApi";
import { mergeRecordsByServer } from "../Utils/recordSources";

// The four endpoints a Qresp node is asked for are NOT equal, and treating
// them as one list is what let a missing authors list be reported as missing
// records.
//
//   search        -> data.papers[server] -> the results table
//   collections   |
//   authors       |-> AdvancedSearch dropdown options, nothing else
//   publications  |
//
// Losing the first means this node contributed no records. Losing any of the
// others means the records are all there and one filter is short of options.
const CORE_ENDPOINT = "search";
const AUXILIARY_ENDPOINTS = ["collections", "authors", "publications"];

const search = ({
  initialdata,
  error,
  selectedservers,
  servernames = {},
}) => {
  const { setAlert, unsetAlert } = useContext(AlertContext);
  const { setSelected } = useContext(ServerContext);

  const searchDescription =
    "Search allows users to find data on specific Qresp instances using various filters";
  const searchAuthor = "Giulia Galli, Macro Govoni";

  const router = useRouter();
  const refresh = () => {
    router.reload();
    unsetAlert();
  };

  // HOW MANY sources are missing, never WHICH institution runs them.
  //
  // A public notice reading "Duke University could not be reached" puts an
  // institution's name next to a failure it has nothing to do with -- a Qresp
  // node is shared search infrastructure, and a reader has no use for its
  // operator's name. The count is the part they can act on: it says whether
  // the results in front of them are complete.
  //
  // The origins themselves are unchanged in `error.failed`, so an operator
  // reading the response still knows exactly which node failed.
  const sourceCount = (servers) => (servers || []).length;
  const sourcesUnavailable = (servers) => {
    const count = sourceCount(servers);
    return count === 1 ? "one source is unavailable"
                       : `${count} sources are unavailable`;
  };

  const [data, setData] = useState(initialdata);

  // The outcome of the LAST Advanced Search, which is a different thing from
  // the SSR `error` above and must never overwrite it: `error` describes how
  // this page loaded, `runtime` describes a search the curator ran afterwards.
  // null means no Advanced Search has run since the page loaded.
  const [runtime, setRuntime] = useState(null);

  const clearSearch = (e) => {
    setData(initialdata);
    setRuntime(null);
  };

  // A new search invalidates whatever the previous one reported.
  const onSearchStart = () => setRuntime(null);

  const onSearchResult = ({ papers, failedServers, totalFailure, retry }) => {
    // Only the nodes that answered are committed, and only when at least one
    // did. Calling setData({}) on a total failure would replace results that
    // are still perfectly valid with an empty table -- the page would say
    // "0 Records Available" about records it simply failed to refresh.
    if (!totalFailure) setData({ papers });
    if (!failedServers.length) {
      setRuntime(null);
      return;
    }
    setRuntime({
      failed: failedServers,
      total: totalFailure,
      // Whether anything was on screen to keep. Decided HERE because the page
      // is what holds the results.
      keptPrevious: totalFailure && Object.keys(data.papers || {}).length > 0,
      retry,
    });
  };

  const { papers, authors, collections, publications } =
    { ...initialdata, ...data } || {};

  const columns = [
    {
      label: "Record",
      name: "paper",
      view: Summary,
      options: {
        align: "left",
        sort: true,
        searchable: true,
        value: (data) => data._Search__title,
        searchValue: (data) =>
          data._Search__title +
          data._Search__authors +
          data._Search__tags.join(" "),
      },
    },
    {
      label: "Year",
      name: "year",
      view: null,
      options: {
        align: "right",
        sort: true,
        searchable: true,
        value: (data) => data,
      },
    },
  ];

  const taglist = new Set();
  if (initialdata.papers) {
    Object.keys(initialdata.papers).forEach((server) => {
      initialdata.papers[server].forEach((paper) => {
        paper["_Search__tags"].forEach((element) => {
          taglist.add(element.toLowerCase());
        });
      });
    });
  }

  // ONE list across every node that answered, with the same paper shown once.
  //
  // The Explorer now opens on the whole federation, so a paper published on
  // both UChicago and Duke used to appear as two identical rows — searching,
  // sorting and the record count all counted it twice. Merging by DOI is
  // done here, before anything downstream sees the rows, so search, filter,
  // sort and the empty state all operate on the same combined list.
  const rows = mergeRecordsByServer(papers, servernames, selectedservers);

  useEffect(() => {
    setSelected(selectedservers);
  }, []);

  // Explorer sends every visitor straight here, so a navigation to /search is
  // now the front door and its latency is visible. Next keeps the PREVIOUS
  // page mounted while it fetches the next one's props, which would leave a
  // stale record count on screen reading as the new one -- so the count is
  // replaced by an explicit loading state instead. "0 Records Available" is
  // never used to mean "still working": it is what a healthy empty node says.
  const [navigating, setNavigating] = useState(false);
  useEffect(() => {
    const { events } = router;
    if (!events) return undefined;
    const start = (url) => {
      if (String(url || "").startsWith("/search")) setNavigating(true);
    };
    const done = () => setNavigating(false);
    events.on("routeChangeStart", start);
    events.on("routeChangeComplete", done);
    events.on("routeChangeError", done);
    return () => {
      events.off("routeChangeStart", start);
      events.off("routeChangeComplete", done);
      events.off("routeChangeError", done);
    };
  }, [router]);

  const failed = (error && error.failed) || [];
  // Servers whose RECORDS arrived and whose filter metadata is short. A
  // different sentence entirely from `failed`, and the reason the two are
  // separate props: they used to share one, so a node that had served its
  // records perfectly was announced as one whose records were missing.
  const filterFailures = Object.entries((error && error.filters) || {});
  // EVERY node's records failed. There is nothing to show and nothing to
  // filter, and saying "0 Records Available" here would be a different,
  // wrong claim.
  const unavailable = Boolean(error && error.total);
  // The same claim, reached at runtime: an Advanced Search where no node
  // answered AND there was nothing on screen to keep. The count is withheld
  // for the same reason -- nothing came back because the nodes are down, not
  // because they hold no matches. (With previous results kept, the count is
  // still true of what is on screen and stays.)
  const countIsUnknown =
    Boolean(runtime && runtime.total && !runtime.keptPrevious);

  return (
    <Fragment>
      <SEO
        title="Qresp | Search"
        description={searchDescription}
        author={searchAuthor}
      />
      <Container>
        <Box sx={{ display: "flex", flexDirection: "column", m: 2 }}>
          {/* Some nodes answered and some did not. The ones that answered are
              still worth reading, so this is a notice beside the results --
              never a modal over them, which cannot be dismissed past. */}
          {!unavailable && failed.length > 0 ? (
            <Box sx={{ mb: 2 }} data-testid="search-partial-failure">
              <Alert
                severity="warning"
                // Reloading is the only thing that can fix a node that was
                // down when the page was rendered server-side, and without
                // this the reader's only option was to guess that.
                action={
                  <RegularStyledButton onClick={refresh}>
                    Retry
                  </RegularStyledButton>
                }
                // A node URL is long and a phone is narrow.
                sx={{ overflowWrap: "anywhere" }}
              >
                {`Some records are missing from these results — ${sourcesUnavailable(
                  failed
                )}.`}
              </Alert>
            </Box>
          ) : null}

          {/* Records ARE here; some of the dropdowns above the table just
              have fewer options than they should. Announcing that as missing
              records contradicted the rows the reader can see. */}
          {!unavailable && filterFailures.length > 0 ? (
            <Box sx={{ mb: 2 }} data-testid="search-filter-failure">
              <Alert severity="info">
                {/* WHICH filters are short, not which institution's node was
                    short of them. The endpoint names are the actionable part
                    -- they say which dropdown to distrust -- so they stay;
                    the node's name is what goes. */}
                {`Records were loaded, but some search filters have fewer options than usual (${Array.from(
                  new Set(
                    filterFailures.flatMap(([, endpoints]) => endpoints || [])
                  )
                ).join(", ")}) — ${sourcesUnavailable(
                  filterFailures.map(([server]) => server)
                )}.`}
              </Alert>
            </Box>
          ) : null}

          {/* The last Advanced Search, if it had trouble. Separate from the
              two notices above because it describes a DIFFERENT event: those
              are about how the page loaded, this is about a search the
              curator ran on top of it. Both can be true at once. */}
          {runtime ? (
            <Box sx={{ mb: 2 }} data-testid="advanced-search-failure">
              <Alert
                severity={runtime.total ? "error" : "warning"}
                action={
                  <RegularStyledButton onClick={runtime.retry}>
                    Retry
                  </RegularStyledButton>
                }
                // A node URL is long and a phone is narrow; without this the
                // alert pushes the whole page sideways.
                sx={{ overflowWrap: "anywhere" }}
              >
                {runtime.total
                  ? runtime.keptPrevious
                    ? `The search could not be refreshed and the previous results are still shown — ${sourcesUnavailable(
                        runtime.failed
                      )}.`
                    : `The search could not be run — ${sourcesUnavailable(
                        runtime.failed
                      )}.`
                  : `Some matching records are missing from these results — ${sourcesUnavailable(
                      runtime.failed
                    )}.`}
              </Alert>
            </Box>
          ) : null}

          {unavailable ? (
            <Box sx={{ my: 4 }} data-testid="search-unavailable">
              <Alert
                severity="error"
                action={
                  <RegularStyledButton onClick={refresh}>
                    Retry
                  </RegularStyledButton>
                }
              >
                {failed.length
                  ? `No records could be loaded — ${sourcesUnavailable(failed)}.`
                  : "No records could be loaded — no source could be reached."}{" "}
                No records could be loaded — this is a connection problem, not
                an empty node.
              </Alert>
            </Box>
          ) : (
            <Fragment>
              <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", p: 2 }}>
                {navigating ? (
                  <Box
                    sx={{ display: "flex", alignItems: "center", gap: 1.5 }}
                    data-testid="search-loading"
                  >
                    <CircularProgress size={22} />
                    <Typography variant="h6">Searching…</Typography>
                  </Box>
                ) : countIsUnknown ? null : (
                  <Typography variant="h4" data-testid="record-count">
                    <Box sx={{ fontWeight: "bold" }}>
                      {`${rows.length}  Records Available`}
                    </Box>
                  </Typography>
                )}
              </Box>
              <Box>
                <AdvancedSearch
                  collections={collections}
                  authors={authors}
                  publications={publications}
                  tags={Array.from(taglist)}
                  clearSearch={clearSearch}
                  onSearchStart={onSearchStart}
                  onSearchResult={onSearchResult}
                />
              </Box>
              <Divider />
              <RecordTable rows={rows} columns={columns} />
            </Fragment>
          )}
        </Box>
      </Container>
    </Fragment>
  );
};

export async function getServerSideProps(ctx) {
  // Query contains the args from the url
  const { query } = ctx;
  // `failed` and `total` are what the page renders from: WHICH nodes were
  // unreachable, and whether any node answered at all. `is`/`msg` are kept
  // because other callers and tests read them, but "some nodes are down" and
  // "nothing loaded" are different situations and the page must not show the
  // same thing for both.
  // Two DIFFERENT failures, kept apart because they mean different things to
  // a reader:
  //   `failed`  - servers whose RECORDS are missing (the core endpoint died)
  //   `filters` - {server: [endpoint]} whose records are fine and whose
  //               search-filter metadata is incomplete
  // `is`/`msg` stay for older readers; the page renders from the two above.
  const error = { is: false, msg: "", failed: [], filters: {}, total: false };
  const data = {
    papers: {},
    authors: [],
    collections: [],
    publications: [],
  };

  if (!query.servers || query.servers.length == 0) {
    error.is = true;
    error.total = true;
    error["msg"] = "No servers selected to be searched";
    return {
      props: { initialdata: data, error: error, servers: null,
               servernames: {} },
    };
  }

  const servers = query.servers.split(",");

  // The node LABELS, from the one list that is authoritative about them. A
  // failure here costs the friendly name and nothing else: `sourceLabel`
  // falls back to the node's host, so a record is still tagged with where it
  // came from and the results never depend on this request succeeding.
  let servernames = {};
  try {
    const base = resolveServerSideApiBase(ctx, "");
    const { data } = await axios.get(`${base || ""}/api/federation/servers`);
    (data && Array.isArray(data.servers) ? data.servers : []).forEach(
      (entry) => {
        const origin = String((entry || {}).qresp_server_url || "").replace(
          /\/+$/,
          ""
        );
        const name = String((entry || {}).qresp_server_name || "").trim();
        if (origin && name) servernames[origin] = name;
      }
    );
  } catch (e) {
    /* labels fall back to the host; results are unaffected */
  }

  for (let i = 0; i < servers.length; i++) {
    const server = servers[i];
    const fetchBase = resolveServerSideApiBase(ctx, server);
    const get = async (endpoint) => {
      if (!fetchBase) throw new Error("No server-side API base available");
      const response = await axios.get(`${fetchBase}/api/${endpoint}`);
      return response.data;
    };

    // THE CORE ENDPOINT, on its own and first. Its answer is staged in a
    // local until it has actually arrived: committing per-endpoint is how a
    // later failure used to leave records on the page under a banner saying
    // they were missing.
    let records;
    try {
      records = await get(CORE_ENDPOINT);
    } catch (e) {
      console.error(e);
      error.is = true;
      if (!error.failed.includes(server)) error.failed.push(server);
      // No records means no reason to ask this server for filter metadata
      // describing them.
      continue;
    }
    data.papers[server] = records;

    // AUXILIARY ENDPOINTS. Each is asked independently: one of them being
    // down says nothing about the other two, and the old `break` threw away
    // filters that had nothing wrong with them. A failure here does NOT make
    // this server a failed record source -- its records are on the page.
    for (let j = 0; j < AUXILIARY_ENDPOINTS.length; j++) {
      const endpoint = AUXILIARY_ENDPOINTS[j];
      try {
        const values = await get(endpoint);
        data[endpoint].push(...values);
      } catch (e) {
        console.error(e);
        error.is = true;
        error.filters[server] = (error.filters[server] || []).concat(endpoint);
      }
    }
  }

  // Total failure is measured on the CORE endpoint, never on a count of
  // "servers with something wrong". `failed.length >= servers.length` made a
  // single server with one broken filter endpoint look like an outage while
  // its records sat in `data`.
  error.total = Object.keys(data.papers).length === 0;
  if (error.failed.length) {
    error.msg =
      "Could not fetch data from these servers: " + error.failed.join(", ");
  } else if (error.is) {
    error.msg =
      "Some search filters were unavailable from: " +
      Object.keys(error.filters).join(", ");
  }

  return {
    props: {
      initialdata: data,
      error: error,
      selectedservers: servers,
      servernames,
    },
  };
}

export default search;
