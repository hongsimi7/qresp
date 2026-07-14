import { Fragment, useContext, useState } from "react";

import axios from "axios";
import {
  Box,
  CircularProgress,
  Typography,
} from "@mui/material";

import { RegularStyledButton } from "../button";
import AuthContext from "../../Context/Auth/authContext";
import ImportReview from "./ImportReview";

// "Import Manuscript Source" — the compact manuscript-import area inside
// "Publication Information for This Paper". Reads the file client-side,
// fetches proposals from the session-gated POST /api/import/manuscript
// (CSRF rides the axios interceptor) and hands them to the ImportReview
// dialog, whose destination is the canonical primary-paper bibliography.
// There is deliberately NO DOI input here: the section's single canonical
// DOI field (with its Fetch button) lives in the form right below.

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

const PaperImport = () => {
  // Defensive default: this renders inside PaperInfoForm, which some tests
  // mount without an AuthContext provider.
  const { authenticated } = useContext(AuthContext) || {};

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);

  const fail = (err, fallback) => {
    const res = err && err.response;
    setError((res && res.data && res.data.error) || fallback);
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
          setResult({
            ...res.data,
            importSource: "manuscript",
            // Kept in memory only, for the OPT-IN AI keyword analysis in the
            // review dialog (sent again only after explicit consent).
            manuscriptFile: { filename: file.name, content_base64: base64 },
          }))
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
        Import Manuscript Source
      </Typography>
      {authenticated ? (
        <Fragment>
          <Typography variant="body2" color="secondary" gutterBottom>
            Propose this paper&rsquo;s fields from your manuscript source
            (.tex or an Overleaf .zip, 10 MB limit). Everything is reviewed
            before anything is applied; nothing is published or overwritten
            silently. To fill fields from a published DOI instead, use the
            DOI field&rsquo;s Fetch button below.
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
          Sign in to import this paper&rsquo;s metadata from a .tex/Overleaf
          manuscript source.
        </Typography>
      )}
    </Box>
  );
};

export default PaperImport;
