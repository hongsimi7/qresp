import { Fragment, useState, useContext, useEffect } from "react";
import { useRouter } from "next/router";

import axios from "axios";

import StyledButton, { SmallStyledButton } from "../components/button";
import SEO from "../components/seo";

import apiEndpoint from "../Context/axios";

import { Alert, Box, Typography, Container, TextField } from "@mui/material";
import Autocomplete from "@mui/material/Autocomplete";

import AlertContext from "../Context/Alert/alertContext";

import allServers from "../data/qresp_servers";
import { buildQrespServerList } from "../Utils/qrespServers";
import { resolveServerSideApiBase } from "../Utils/serverSideApi";

const explorerDescription =
  "The explorer provides a portal for the scientific community to access datasets, explore workflows and download curated data, published in scientific papers.";

// Explorer is a front door, not a form.
//
// It used to open on "Select Qresp node to search", so every visitor had to
// answer a question before seeing anything -- and answering it wrong (Duke,
// currently unreachable) produced a blocking "Search Error!" modal over a page
// reading "0 Records Available", which is indistinguishable from a node that
// genuinely has no records. The overwhelmingly common intent is "show me the
// records", so that is what the URL now does.
//
// Which server is NOT decided here. `/api/federation/servers` is the
// authoritative list -- it is the same set the backend enforces `?server=`
// against -- and it now publishes `default_server` alongside it. Nothing in
// this file names a host: a hardcoded default would be a second copy of the
// federation config, and the first copy already drifted once.
//
// Choosing servers by hand is still reachable at `/explorer?choose=1`;
// federation is not reduced to a single node, it just stops being a toll gate.
export async function getServerSideProps(ctx) {
  const { query } = ctx;

  // An explicit request for the picker skips the whole redirect, and does not
  // spend a request deciding a default it will not use.
  if (query.choose) {
    return { props: { choose: true, unavailable: false } };
  }

  const base = resolveServerSideApiBase(ctx, "");
  try {
    const { data } = await axios.get(
      `${base || ""}/api/federation/servers`
    );
    const listed = (data && Array.isArray(data.servers) ? data.servers : [])
      .map((entry) => (entry || {}).qresp_server_url)
      .filter(Boolean);
    // EVERY federated node, not just the default one.
    //
    // The Explorer is "show me the records", and a reader looking for a paper
    // does not know or care which institution hosts it. Opening on one node
    // meant half the federation was invisible unless somebody found
    // `?choose=1` -- so the front door now searches the whole list and each
    // record carries a tag saying where it came from.
    //
    // A node being down does NOT cost the others: /search asks each node
    // independently and renders a notice beside the results it did get. That
    // behaviour already existed; this change is what makes it matter.
    //
    // `default_server` is still honoured for ORDER: it goes first, so the
    // deployment's own node leads the list. It no longer decides who is in it.
    const published = (data || {}).default_server;
    const ordered =
      published && listed.includes(published)
        ? [published, ...listed.filter((origin) => origin !== published)]
        : listed;

    if (ordered.length) {
      return {
        redirect: {
          destination: `/search?servers=${ordered
            .map(encodeURIComponent)
            .join(",")}`,
          permanent: false,
        },
      };
    }
  } catch (err) {
    // Backend unreachable, or an answer we do not recognize. Fall through to
    // the in-page unavailable state below rather than redirecting somewhere
    // arbitrary.
  }

  // Federation is empty or the backend could not be asked. Either way there is
  // no server to search, and saying so on the page beats a redirect into a
  // search that will fail.
  return { props: { choose: false, unavailable: true } };
}

// The manual picker. Reached at /explorer?choose=1, and rendered as the
// unavailable state's escape hatch.
const explorer = ({ choose = false, unavailable = false }) => {
  const [servers, setServers] = useState(allServers);
  const { setAlert, unsetAlert } = useContext(AlertContext) || {};
  const router = useRouter();

  // The backend owns the federation list: it is the thing that enforces it,
  // and a server offered here but refused there (or the reverse) is a bug a
  // reader has no way to understand.
  //
  // An EMPTY published list is an answer, not a failure. An operator who set
  // QRESP_FEDERATION_SERVERS to nothing has switched federation off, and
  // offering the shipped peers anyway would present servers the backend will
  // refuse with a 400. The checked-in list is the fallback for exactly two
  // cases: the request failed (no endpoint, backend down), or the answer was
  // not the documented shape.
  useEffect(() => {
    let cancelled = false;
    apiEndpoint
      .get("/api/federation/servers")
      .then((res) => {
        if (cancelled) return;
        const published = (res.data || {}).servers;
        if (Array.isArray(published)) {
          setServers(published);
        }
        // Not an array: a malformed answer. Keep the shipped list.
      })
      .catch(() => {
        /* no endpoint, or unreachable: keep the shipped list */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (typeof window !== "undefined") {
      setServers((current) =>
        buildQrespServerList(current, window.location.origin)
      );
    }
  }, []);

  const [selectedServers, setSelectedServers] = useState("");

  const handleChange = (event, values) => {
    setSelectedServers(
      values.map((option) => option.qresp_server_url).join(",")
    );
  };

  const searchAll = () => {
    if (unsetAlert) unsetAlert();
    const params = servers.map((option) => option.qresp_server_url).join(",");
    router.push({ pathname: "/search", query: { servers: params } });
  };

  const searchSelected = () => {
    if (selectedServers.length === 0) {
      if (setAlert) {
        setAlert(
          "Error, No nodes selected",
          "You didn't select any servers. Did you mean to search on all of them ?",
          <SmallStyledButton onClick={searchAll}>Search All</SmallStyledButton>
        );
      }
      return;
    }
    router.push({ pathname: "/search", query: { servers: selectedServers } });
  };

  return (
    <Fragment>
      <SEO title="Qresp | Explorer" description={explorerDescription} />
      <Container>
        <div>
          {unavailable ? (
            // In the page, never a modal over an empty table. The distinction
            // that matters is "no server is configured / reachable" versus
            // "this server has no records", and a blocking dialog over a
            // 0-row table says neither.
            <Box sx={{ mb: 3 }} data-testid="explorer-unavailable">
              <Alert
                severity="warning"
                action={
                  <SmallStyledButton onClick={() => router.reload()}>
                    Retry
                  </SmallStyledButton>
                }
              >
                No Qresp node is available to search right now. This deployment
                may not be federated with any server yet, or the server list
                could not be read.
              </Alert>
            </Box>
          ) : null}
          <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", m: 2 }}>
            <Typography variant="h3">
              <Box sx={{ fontWeight: "bold" }}>Select Qresp node to search</Box>
            </Typography>
          </Box>
          <Autocomplete
            multiple
            options={servers}
            getOptionLabel={(option) => option.qresp_server_url}
            filterSelectedOptions
            renderInput={(params) => (
              <TextField
                {...params}
                variant="outlined"
                label="Select one or more nodes!"
              />
            )}
            fullWidth
            ChipProps={{ color: "primary", variant: "outlined" }}
            onChange={handleChange}
          />
          <Box sx={{ display: "flex", flexDirection: "row", justifyContent: "center", m: 4 }}>
            <Box sx={{ m: 1 }}>
              <StyledButton onClick={searchSelected}>
                Search Selected
              </StyledButton>
            </Box>
            <Box sx={{ m: 1 }}>
              <StyledButton onClick={searchAll}>Search All</StyledButton>
            </Box>
          </Box>
          <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", m: 4 }}>
            <Typography variant="h5" align="center">
              <Box sx={{ fontWeight: "bolder" }}>
                Qresp | Explorer allows you to search for paper contents and to
                view and download the data organized in the paper.
              </Box>
            </Typography>
          </Box>
        </div>
      </Container>
      <style jsx>
        {`
          div {
            border-width: thin;
            border-style: solid;
            border-radius: 5px;
            border-color: rgba(0, 0, 0, 0.125);
            margin: 40px 4px;
            padding: 40px;
          }
        `}
      </style>
    </Fragment>
  );
};

export default explorer;
