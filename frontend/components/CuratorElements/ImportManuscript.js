import { Fragment, useContext, useState } from "react";
import PropTypes from "prop-types";

import axios from "axios";
import {
  Box,
  Button,
  Checkbox,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  TextField,
  Typography,
} from "@mui/material";

import { RegularStyledButton } from "../button";
import CuratorContext from "../../Context/Curator/curatorContext";
import { namesUtil, referenceUtil } from "../../Utils/utils";

// Auto-Curation Lite phase 1: propose draft metadata from a DOI or a
// manuscript source file (.tex / Overleaf .zip). Everything here is a
// PROPOSAL — the user reviews each field, conflicts show both values, and
// nothing is applied (let alone published) without the explicit Apply
// action. Populated form values are never overwritten unless the user
// checks that field. Separate from (and unrelated to) Upload Metadata JSON.

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

// The publish-time requirements, as a readable checklist. Draft saving never
// requires these — publish validation remains the only gate.
const missingForPublish = (state) => {
  const missing = [];
  const ref = state.referenceInfo || {};
  const info = state.curatorInfo || {};
  const paper = state.paperInfo || {};
  if (!(ref.title || "").trim()) missing.push("Reference title");
  if (!(ref.authors || "").trim()) missing.push("Authors");
  if (!(ref.publication || "").trim() || !ref.year)
    missing.push("Publication and year");
  if (!(info.firstName || "").trim() || !(info.emailId || "").trim())
    missing.push("Curator name and email");
  if (!(paper.collections || []).length) missing.push("Collections");
  if (!(state.license || "").trim()) missing.push("License");
  if (!(state.charts || []).length) missing.push("At least one chart");
  if (!(state.datasets || []).length) missing.push("At least one dataset");
  return missing;
};

const displayValue = (value) => {
  if (value == null) return "";
  if (Array.isArray(value)) {
    if (value.length && typeof value[0] === "object") {
      return namesUtil.set(value);
    }
    return value.join(", ");
  }
  return String(value);
};

// Turn an import result into reviewable rows against the CURRENT draft.
const buildRows = (result, current) => {
  const proposal = result.proposal || {};
  const provenance = result.provenance || {};
  const alternatives = result.alternatives || {};
  const ref = current.referenceInfo || {};
  const paper = current.paperInfo || {};

  const rows = [];
  const push = (key, label, proposed, currentValue, applyValue) => {
    if (proposed == null || proposed === "") return;
    const currentText = (currentValue || "").toString().trim();
    rows.push({
      key,
      label,
      proposedText: displayValue(proposed),
      currentText,
      applyValue,
      source: provenance[key] || provenance[rows.length] || "import",
      alternatives: alternatives[key] || [],
      // Empty fields default to applying; a populated field is NEVER
      // overwritten unless the user explicitly checks it.
      defaultSelected: !currentText,
    });
  };

  push("title", "Title", proposal.title, ref.title, proposal.title);
  if (proposal.authors && proposal.authors.length) {
    const authors = namesUtil.set(proposal.authors);
    push("authors", "Authors", authors, ref.authors, authors);
  }
  push("abstract", "Abstract", proposal.abstract, ref.abstract,
       proposal.abstract);
  push("doi", "DOI", proposal.doi, ref.doi, proposal.doi);
  push("year", "Year", proposal.year, ref.year, proposal.year);
  push("url", "URL", proposal.url, ref.url, proposal.url);
  if (proposal.journal) {
    const publication = referenceUtil.set({
      journal: proposal.journal,
      year: proposal.year || "",
      volume: proposal.volume || "",
      page: proposal.pages || "",
    });
    push("publication", "Publication", publication, ref.publication,
         publication);
  }
  if (proposal.tags && proposal.tags.length) {
    const existing = (paper.tags || []).map((t) => t.toLowerCase());
    const fresh = proposal.tags.filter(
      (t) => !existing.includes(t.toLowerCase()));
    if (fresh.length) {
      rows.push({
        key: "tags",
        label: "Tag suggestions (added to your tags, never replacing them)",
        proposedText: fresh.join(", "),
        currentText: (paper.tags || []).join(", "),
        applyValue: fresh,
        source: provenance.tags || "import",
        alternatives: [],
        defaultSelected: true,
      });
    }
  }
  return rows;
};

const ImportManuscript = ({ open, onClose }) => {
  const { collectDraftState, setAll, remountForms } =
    useContext(CuratorContext);

  const [doi, setDoi] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);
  const [rows, setRows] = useState([]);
  const [selected, setSelected] = useState({});
  const [applied, setApplied] = useState(null); // missing-info checklist

  const reset = () => {
    setDoi("");
    setLoading(false);
    setError("");
    setResult(null);
    setRows([]);
    setSelected({});
    setApplied(null);
  };

  const close = () => {
    reset();
    onClose();
  };

  const showResult = (data) => {
    const current = collectDraftState();
    const nextRows = buildRows(data, current);
    setResult(data);
    setRows(nextRows);
    setSelected(
      nextRows.reduce((acc, row) => {
        acc[row.key] = row.defaultSelected;
        return acc;
      }, {})
    );
  };

  const fail = (err, fallback) => {
    const res = err && err.response;
    setError((res && res.data && res.data.error) || fallback);
  };

  const lookupDoi = () => {
    setLoading(true);
    setError("");
    axios
      .post("/api/import/doi", { doi })
      .then((res) => showResult(res.data))
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
        .then((res) => showResult(res.data))
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

  const apply = () => {
    const current = collectDraftState();
    const ref = { ...current.referenceInfo };
    const paper = { ...current.paperInfo };
    rows.forEach((row) => {
      if (!selected[row.key]) return;
      if (row.key === "tags") {
        paper.tags = [...(paper.tags || []), ...row.applyValue];
      } else {
        ref[row.key] = row.applyValue;
      }
    });
    const next = { ...current, referenceInfo: ref, paperInfo: paper };
    setAll(next);
    // Re-seed the always-mounted forms from the updated state.
    if (remountForms) remountForms();
    setApplied(missingForPublish(next));
  };

  const anySelected = rows.some((row) => selected[row.key]);

  return (
    <Dialog open={open} onClose={close} maxWidth="md" fullWidth>
      <DialogTitle>Import manuscript source</DialogTitle>
      <DialogContent dividers>
        {applied ? (
          <Fragment>
            <Typography color="secondary" gutterBottom>
              The selected proposals were applied to your draft. You can keep
              editing, and Save Draft works even while fields are missing.
            </Typography>
            {applied.length > 0 ? (
              <Fragment>
                <Typography color="secondary" sx={{ mt: 1 }}>
                  Still needed before this record can be published:
                </Typography>
                <ul>
                  {applied.map((item) => (
                    <li key={item}>
                      <Typography color="secondary" component="span">
                        {item}
                      </Typography>
                    </li>
                  ))}
                </ul>
              </Fragment>
            ) : (
              <Typography color="secondary">
                All publish requirements look filled in — review the forms and
                publish when ready.
              </Typography>
            )}
          </Fragment>
        ) : result ? (
          <Fragment>
            <Typography variant="body2" color="secondary" gutterBottom>
              Review the proposed values. Fields that already have a value in
              your draft are unchecked — checking one replaces your current
              value. Nothing is published by this step.
            </Typography>
            {(result.warnings || []).map((warning) => (
              <Typography key={warning} variant="body2" color="error">
                {warning}
              </Typography>
            ))}
            {result.main_file ? (
              <Typography variant="body2" color="secondary">
                Read from: {result.main_file}
                {(result.included_files || []).length
                  ? ` (+ ${result.included_files.join(", ")})`
                  : ""}
              </Typography>
            ) : null}
            {rows.length === 0 ? (
              <Typography color="secondary" sx={{ mt: 2 }}>
                Nothing new to apply was found.
              </Typography>
            ) : (
              rows.map((row) => (
                <Box
                  key={row.key}
                  sx={{
                    display: "flex",
                    alignItems: "flex-start",
                    gap: 1,
                    mt: 2,
                  }}
                >
                  <Checkbox
                    checked={Boolean(selected[row.key])}
                    onChange={(event) =>
                      setSelected((currentSel) => ({
                        ...currentSel,
                        [row.key]: event.target.checked,
                      }))
                    }
                    slotProps={{
                      input: { "aria-label": `apply ${row.label}` },
                    }}
                  />
                  <Box sx={{ flexGrow: 1 }}>
                    <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                      <Typography color="secondary" sx={{ fontWeight: "bold" }}>
                        {row.label}
                      </Typography>
                      <Chip label={row.source} size="small" />
                    </Box>
                    <Typography color="secondary">
                      Proposed: {row.proposedText}
                    </Typography>
                    {row.currentText ? (
                      <Typography variant="body2" color="error">
                        Current value kept unless checked: {row.currentText}
                      </Typography>
                    ) : null}
                    {row.alternatives.map((alt) => (
                      <Typography
                        key={alt.source}
                        variant="body2"
                        color="secondary"
                      >
                        Also found ({alt.source}): {displayValue(alt.value)}
                      </Typography>
                    ))}
                  </Box>
                </Box>
              ))
            )}
            {(result.doi_candidates || []).length ? (
              <Typography variant="body2" color="secondary" sx={{ mt: 2 }}>
                DOIs found in the bibliography (references, not necessarily
                this work): {result.doi_candidates.slice(0, 5).join(", ")}
              </Typography>
            ) : null}
          </Fragment>
        ) : (
          <Fragment>
            <Typography variant="body2" color="secondary" gutterBottom>
              Propose draft metadata from a published DOI or from your
              manuscript source. Your file is inspected in memory only — it is
              never stored, compiled, or sent to third parties — and nothing
              is applied to the draft without your review.
            </Typography>
            <Box sx={{ display: "flex", gap: 1, alignItems: "center", mt: 2 }}>
              <TextField
                label="DOI"
                placeholder="10.1234/abcd or https://doi.org/10.1234/abcd"
                value={doi}
                onChange={(event) => setDoi(event.target.value)}
                fullWidth
                size="small"
                variant="outlined"
              />
              <RegularStyledButton
                onClick={lookupDoi}
                disabled={loading || !doi.trim()}
              >
                Look up DOI
              </RegularStyledButton>
            </Box>
            <Divider sx={{ my: 2 }} />
            <input
              accept=".tex,.zip"
              id="import-manuscript-file"
              type="file"
              style={{ display: "none" }}
              onChange={onFile}
            />
            <label htmlFor="import-manuscript-file">
              <RegularStyledButton component="span" disabled={loading}>
                Choose .tex or Overleaf .zip
              </RegularStyledButton>
            </label>
            <Typography variant="body2" color="secondary" sx={{ mt: 1 }}>
              Direct .tex files and .zip exports from Overleaf are supported
              (10 MB limit). PDF import is not supported yet.
            </Typography>
          </Fragment>
        )}
        {loading ? (
          <Box sx={{ display: "flex", justifyContent: "center", mt: 2 }}>
            <CircularProgress size={28} />
          </Box>
        ) : null}
        {error ? (
          <Typography variant="body2" color="error" sx={{ mt: 2 }}>
            {error}
          </Typography>
        ) : null}
      </DialogContent>
      <DialogActions>
        {applied ? (
          <RegularStyledButton onClick={close}>Close</RegularStyledButton>
        ) : result ? (
          <Fragment>
            <RegularStyledButton onClick={close}>Cancel</RegularStyledButton>
            <RegularStyledButton onClick={reset}>Back</RegularStyledButton>
            <RegularStyledButton onClick={apply} disabled={!anySelected}>
              Apply to draft
            </RegularStyledButton>
          </Fragment>
        ) : (
          <RegularStyledButton onClick={close}>Cancel</RegularStyledButton>
        )}
      </DialogActions>
    </Dialog>
  );
};

ImportManuscript.propTypes = {
  open: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
};

export default ImportManuscript;
