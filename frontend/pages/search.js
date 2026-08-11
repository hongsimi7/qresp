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

const search = ({ initialdata, error, selectedservers }) => {
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

  const rows = Object.keys(papers)
    .map((server) => {
      return papers[server].map((paper) => {
        paper["_Search__server"] = server;
        return {
          paper: paper,
          year: paper["_Search__year"],
        };
      });
    })
    .flat();

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
              <Alert severity="warning">
                Some Qresp nodes could not be reached, so their records are
                missing from these results: {failed.join(", ")}.
              </Alert>
            </Box>
          ) : null}

          {/* Records ARE here; some of the dropdowns above the table just
              have fewer options than they should. Announcing that as missing
              records contradicted the rows the reader can see. */}
          {!unavailable && filterFailures.length > 0 ? (
            <Box sx={{ mb: 2 }} data-testid="search-filter-failure">
              <Alert severity="info">
                Records were loaded, but some search filters are unavailable
                from:{" "}
                {filterFailures
                  .map(([server, endpoints]) =>
                    `${server} (${(endpoints || []).join(", ")})`
                  )
                  .join("; ")}
                .
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
                    ? "The search could not be refreshed. The previous " +
                      "results are still shown. These Qresp nodes could not " +
                      "be searched: "
                    : "These Qresp nodes could not be searched: "
                  : "Some Qresp nodes could not be searched, so their " +
                    "matching records are missing from these results: "}
                {runtime.failed.join(", ")}
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
                  ? `These Qresp nodes could not be reached: ${failed.join(
                      ", "
                    )}.`
                  : "No Qresp node could be reached."}{" "}
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
      props: { initialdata: data, error: error, servers: null },
    };
  }

  const servers = query.servers.split(",");

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
    props: { initialdata: data, error: error, selectedservers: servers },
  };
}

export default search;
