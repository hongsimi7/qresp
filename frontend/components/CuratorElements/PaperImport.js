import { Fragment, useContext, useState } from "react";

import axios from "axios";
import {
  Box,
  CircularProgress,
  TextField,
  Typography,
} from "@mui/material";

import { RegularStyledButton } from "../button";
import AuthContext from "../../Context/Auth/authContext";
import ImportReview from "./ImportReview";

// "Import information for this paper" — the compact primary-paper import
// area that lives INSIDE "Add info about your paper". Fetches proposals
// from the existing session-gated endpoints (POST /api/import/doi and
// /api/import/manuscript; CSRF rides the axios interceptor) and hands them
// to the ImportReview dialog, whose destination is the primary-paper
// adapter — never the separate "Add Reference to your paper" workflow.

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

const PaperImport = () => {
  // Defensive default: this renders inside PaperInfoForm, which some tests
  // mount without an AuthContext provider.
  const { authenticated } = useContext(AuthContext) || {};

  const [doi, setDoi] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);

  const fail = (err, fallback) => {
    const res = err && err.response;
    setError((res && res.data && res.data.error) || fallback);
  };

  const fetchDoi = () => {
    setLoading(true);
    setError("");
    axios
      .post("/api/import/doi", { doi })
      .then((res) => setResult({ ...res.data, importSource: "doi" }))
      .catch((err) =>
        fail(err, "The DOI could not be looked up, please try again."))
      .finally(() => setLoading(false));
  };

  const onFile = (event) => {
    const file = event.target.files && event.target.files[0];
    event.target.value = "";
    if (!file) return;
    if (file.size > MAX_UPLOAD_BYTES) {
      setError("The file is too large to import (limit 10 MB).");
      return;
    }
    setLoading(true);
    setError("");
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = String(reader.result).split(",")[1] || "";
      axios
        .post("/api/import/manuscript", {
          filename: file.name,
          content_base64: base64,
        })
        .then((res) =>
          setResult({ ...res.data, importSource: "manuscript" }))
        .catch((err) =>
          fail(err, "The manuscript could not be imported, please try again."))
        .finally(() => setLoading(false));
    };
    reader.onerror = () => {
      setLoading(false);
      setError("The file could not be read.");
    };
    reader.readAsDataURL(file);
  };

  return (
    <Box
      sx={{
        border: 1,
        borderColor: "divider",
        borderRadius: 1,
        p: 1.5,
        mb: 2,
      }}
    >
      <Typography color="secondary" sx={{ fontWeight: "bold" }}>
        Import information for this paper
      </Typography>
      {authenticated ? (
        <Fragment>
          <Typography variant="body2" color="secondary" gutterBottom>
            Propose this paper&rsquo;s metadata from its DOI or from your
            manuscript source (.tex or an Overleaf .zip, 10 MB limit).
            Everything is reviewed before anything is applied; nothing is
            published or overwritten silently.
          </Typography>
          <Box
            sx={{
              display: "flex",
              gap: 1,
              alignItems: "center",
              flexWrap: "wrap",
              mt: 1,
            }}
          >
            <TextField
              label="DOI"
              placeholder="10.1234/abcd or https://doi.org/10.1234/abcd"
              value={doi}
              onChange={(event) => setDoi(event.target.value)}
              size="small"
              variant="outlined"
              sx={{ flexGrow: 1, minWidth: 220 }}
            />
            <RegularStyledButton
              onClick={fetchDoi}
              disabled={loading || !doi.trim()}
            >
              Fetch DOI
            </RegularStyledButton>
            <input
              accept=".tex,.zip"
              id="paper-import-file"
              type="file"
              style={{ display: "none" }}
              onChange={onFile}
            />
            <label htmlFor="paper-import-file">
              <RegularStyledButton component="span" disabled={loading}>
                Import manuscript source
              </RegularStyledButton>
            </label>
            {loading ? <CircularProgress size={24} /> : null}
          </Box>
          {error ? (
            <Typography variant="body2" color="error" sx={{ mt: 1 }}>
              {error}
            </Typography>
          ) : null}
          <ImportReview
            open={Boolean(result)}
            result={result}
            onClose={() => setResult(null)}
          />
        </Fragment>
      ) : (
        <Typography variant="body2" color="secondary">
          Sign in to import this paper&rsquo;s metadata from a DOI or a
          .tex/Overleaf manuscript source.
        </Typography>
      )}
    </Box>
  );
};

export default PaperImport;
