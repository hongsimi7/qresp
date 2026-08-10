import { Fragment, useState, useContext, useEffect } from "react";
import { useRouter } from "next/router";

import StyledButton, { SmallStyledButton } from "../components/button";
import SEO from "../components/seo";

import apiEndpoint from "../Context/axios";

import { Box, Typography, Container, TextField } from "@mui/material";
import Autocomplete from "@mui/material/Autocomplete";

import AlertContext from "../Context/Alert/alertContext";

import allServers from "../data/qresp_servers";
import { buildQrespServerList } from "../Utils/qrespServers";

const explorer = ({ error }) => {
  // Turbopack forbids reassigning an imported binding (the old code did
  // `servers = []` on error), so derive a local list instead. On tunneled
  // staging (https://localhost:8443), add the current same-origin node so
  // Explorer searches the staging DB instead of only the production nodes.
  const [servers, setServers] = useState(error ? [] : allServers);
  const { setAlert, unsetAlert } = useContext(AlertContext);

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

  const explorerDescription =
    "The explorer provides a portal for the scientific community to access datasets, explore workflows and download curated data, published in scientific papers.";

  const [selectedServers, setSelectedServers] = useState("");

  // Get the list of selected servers, on change in list
  const handleChange = (event, values) => {
    setSelectedServers(
      values.map((option) => option.qresp_server_url).join(",")
    );
  };

  const router = useRouter();

  const refresh = () => {
    router.reload();
  };

  const searchSelected = () => {
    if (selectedServers.length === 0) {
      const title = "Error, No nodes selected";
      const msg =
        "You didn't select any servers. Did you mean to search on all of them ?";
      const buttons = (
        <SmallStyledButton onClick={searchAll}>Search All</SmallStyledButton>
      );
      setAlert(title, msg, buttons);
      return;
    }
    router.push({
      pathname: "/search",
      query: { servers: selectedServers },
    });
  };

  const searchAll = () => {
    unsetAlert();
    const params = servers.map((option) => option.qresp_server_url).join(",");
    router.push({
      pathname: "/search",
      query: { servers: params },
    });
  };

  const errortitle = "Oops!";
  const errormsg = (
    <Fragment>
      There was an error trying to get the available Qresp nodes! <br />
      If problems persist please contact the administrator
    </Fragment>
  );

  useEffect(() => {
    if (!error && typeof window !== "undefined") {
      setServers(buildQrespServerList(allServers, window.location.origin));
    }
  }, [error]);

  useEffect(() => {
    if (error) {
      setAlert(
        errortitle,
        errormsg,
        <SmallStyledButton onClick={refresh}>Retry</SmallStyledButton>
      );
    }
  }, []);

  return (
    <Fragment>
      <SEO title="Qresp | Explorer" description={explorerDescription} />
      <Container>
        <div>
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
              <StyledButton onClick={searchSelected} disabled={error}>
                Search Selected
              </StyledButton>
            </Box>
            <Box sx={{ m: 1 }}>
              <StyledButton onClick={searchAll} disabled={error}>
                Search All
              </StyledButton>
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
