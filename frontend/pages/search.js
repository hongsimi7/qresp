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

  const clearSearch = (e) => {
    setData(initialdata);
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
  // EVERY node failed. There is nothing to show and nothing to filter, and
  // saying "0 Records Available" here would be a different, wrong claim.
  const unavailable = Boolean(error && error.total);

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
                ) : (
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
                  setData={setData}
                  clearSearch={clearSearch}
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
  const error = { is: false, msg: "", failed: [], total: false };
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

  const urls = [
    { endpoint: "search", value: "papers" },
    { endpoint: "collections", value: "collections" },
    { endpoint: "authors", value: "authors" },
    { endpoint: "publications", value: "publications" },
  ];
  const servers = query.servers.split(",");

  for (let i = 0; i < servers.length; i++) {
    const server = servers[i];
    const fetchBase = resolveServerSideApiBase(ctx, server);
    for (let j = 0; j < urls.length; j++) {
      const url = urls[j];
      try {
        if (!fetchBase) {
          throw new Error("No server-side API base available");
        }
        var response = await axios
          .get(`${fetchBase}/api/${url.endpoint}`)
          .then((res) => res.data);

        if (url.endpoint === "search") {
          data[url.value][server] = response;
        } else {
          data[url.value].push(...response);
        }
      } catch (e) {
        console.error(e);
        error.is = true;
        if (!error.failed.includes(server)) error.failed.push(server);
        break;
      }
    }
  }

  if (error.is) {
    error.msg =
      "Could not fetch data from these servers: " + error.failed.join(", ");
    // Every node asked for was unreachable: there is nothing partial about
    // it, and the page shows an unavailable state rather than an empty table.
    error.total = error.failed.length >= servers.length;
  }

  return {
    props: { initialdata: data, error: error, selectedservers: servers },
  };
}

export default search;
