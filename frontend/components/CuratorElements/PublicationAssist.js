import { Fragment, useContext, useState } from "react";
import PropTypes from "prop-types";

import axios from "axios";
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  Typography,
} from "@mui/material";

import CuratorContext from "../../Context/Curator/curatorContext";

// "Suggest missing publication details with AI" — bibliography only, and
// deliberately NOT the keyword feature: keywords belong to Qresp Curation
// Information, and mixing them in here put one concept in two places.
//
// The DOI Fetch button remains the preferred action: it is deterministic and
// authoritative. This fills what is still missing afterwards, as reviewable
// proposals that are never applied on their own.

const FIELD_LABELS = {
  kind: "Kind",
  title: "Title",
  authors: "Authors",
  publication: "Journal Name",
  volume: "Volume",
  page: "Page",
  year: "Year",
  doi: "DOI",
  url: "URL",
  abstract: "Abstract",
};

// The order the review list is shown in.
const FIELD_ORDER = ["kind", "title", "authors", "publication", "page",
                     "abstract", "volume", "year", "doi", "url"];

const PROVENANCE_LABELS = {
  doi_registry: "DOI registry",
  pdf_text: "PDF text",
  tex_text: "TeX source",
  ai: "AI suggestion",
};

// Names that usually belong to supporting information rather than the
// article. Checked in the browser too so the warning appears before anything
// is sent, not only after.
const SUPPLEMENTARY_MARKERS = [
  "_si_", "-si-", "si_", "_si.", "-si.", "supp", "supporting", "supplement",
  "supplementary", "esi", "sup_mat", "supmat",
];

export const looksSupplementary = (filename) => {
  const name = String(filename || "").toLowerCase();
  return SUPPLEMENTARY_MARKERS.some((marker) => name.includes(marker));
};

const PublicationAssist = ({ reference, sourceText, sourceFilename }) => {
  const { setReferenceInfo } = useContext(CuratorContext) || {};

  const [open, setOpen] = useState(false);
  const [consent, setConsent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);
  const [selected, setSelected] = useState({});
  const [applied, setApplied] = useState(false);

  const current = reference || {};
  const supplementary = looksSupplementary(sourceFilename);

  // Useful when there is text to read, or enough of a paper to identify.
  const eligible = Boolean(
    (sourceText || "").trim() ||
      (current.title || "").trim() ||
      (current.abstract || "").trim()
  );

  const close = () => {
    setOpen(false);
    setConsent(false);
    setLoading(false);
    setError("");
    setResult(null);
    setSelected({});
    setApplied(false);
  };

  // Consent is asked fresh every time the dialog opens.
  const start = () => {
    setConsent(false);
    setError("");
    setResult(null);
    setSelected({});
    setApplied(false);
    setOpen(true);
  };

  const request = async () => {
    setLoading(true);
    setError("");
    try {
      // Allowlisted bibliographic state only. No PIs, tags, PaperStack,
      // notebook or RCC paths, no drafts, charts, datasets or account data.
      const response = await axios.post("/api/assist/publication-metadata", {
        consent: true,
        kind: current.kind || "",
        title: current.title || "",
        authors: current.authors || "",
        doi: current.doi || "",
        publication: current.publication || "",
        volume: current.volume || "",
        page: current.page || "",
        year: current.year == null ? "" : String(current.year),
        url: current.url || "",
        abstract: current.abstract || "",
        filename: sourceFilename || "",
        source_text: sourceText || "",
      });
      setResult(response.data || {});
      setSelected({});
    } catch (err) {
      setError(
        (err && err.response && err.response.data && err.response.data.error) ||
          "Publication suggestions could not be generated."
      );
    } finally {
      setLoading(false);
    }
  };

  const proposals = (result && result.proposals) || [];
  const ordered = FIELD_ORDER.map((field) =>
    proposals.find((p) => p.field === field)
  ).filter(Boolean);

  const apply = () => {
    const updates = {};
    ordered.forEach((proposal) => {
      if (!selected[proposal.field]) return;
      // A field the curator already filled is protected: it can only be
      // replaced by ticking it, and it is never ticked by default.
      updates[proposal.field] = proposal.value;
    });
    if (Object.keys(updates).length && setReferenceInfo) {
      // referenceInfo is the ONE canonical bibliographic state. This only
      // updates it in the form; it does not save or publish the record.
      setReferenceInfo({ ...current, ...updates });
    }
    setApplied(true);
  };

  const anySelected = ordered.some((p) => selected[p.field]);

  return (
    <Fragment>
      <Box sx={{ mt: 1 }}>
        <Button size="small" onClick={start} disabled={!eligible}>
          Suggest missing publication details with AI
        </Button>
        <Typography variant="caption" color="text.secondary" display="block">
          {eligible
            ? "Fills gaps left after Fetch DOI. Proposals only — nothing is " +
              "applied, saved or published without you."
            : "Import a manuscript source, or enter a title or abstract, first."}
        </Typography>
      </Box>

      <Dialog open={open} onClose={close} maxWidth="md" fullWidth>
        <DialogTitle>Suggest missing publication details</DialogTitle>
        <DialogContent dividers>
          {supplementary && (
            <Alert severity="warning" sx={{ mb: 2 }} data-testid="supp-warning">
              <strong>
                {sourceFilename} looks like supporting information, not the
                article itself.
              </strong>{" "}
              Bibliographic details read from a supplement usually describe the
              wrong document. Every suggestion will be marked low confidence —
              check each one against the published paper before applying it.
            </Alert>
          )}

          {!result && (
            <Fragment>
              <Typography variant="body2" gutterBottom>
                <strong>Fetch DOI is the better first step.</strong> It is
                deterministic and the registry is authoritative for the DOI,
                title, authors, journal, volume, pages, year and URL. Use this
                only for what is still missing afterwards.
              </Typography>
              <Typography variant="body2" gutterBottom>
                If you continue, Qresp sends to Gemini:
              </Typography>
              <Box component="ul" sx={{ pl: 3, mt: 0, mb: 2 }}>
                <Typography component="li" variant="body2">
                  this paper&rsquo;s bibliographic fields as they stand
                </Typography>
                <Typography component="li" variant="body2">
                  a bounded excerpt of the text already extracted from your
                  manuscript
                </Typography>
              </Box>
              <Typography variant="body2" gutterBottom>
                It does <strong>not</strong> send the source file itself, your
                PIs, keywords, PaperStack, notebook or RCC paths, or any
                account data. Nothing is stored or published, every proposed
                field is reviewed and applied one by one, and a field you have
                already filled in is never overwritten automatically.
              </Typography>
              <FormControlLabel
                control={
                  <Checkbox
                    checked={consent}
                    onChange={(event) => setConsent(event.target.checked)}
                    slotProps={{
                      input: {
                        "aria-label":
                          "I agree to send these details and the extracted text to Gemini",
                      },
                    }}
                  />
                }
                label="Send these details and the extracted text for this request."
              />
            </Fragment>
          )}

          {loading && (
            <Box sx={{ display: "flex", gap: 2, alignItems: "center", mt: 1 }}>
              <CircularProgress size={20} />
              <Typography variant="body2">Reading the manuscript…</Typography>
            </Box>
          )}
          {error && <Alert severity="error" sx={{ mt: 1 }}>{error}</Alert>}

          {result && (
            <Fragment>
              {(result.warnings || []).map((warning) => (
                <Alert key={warning} severity="info" sx={{ mb: 1 }}>
                  {warning}
                </Alert>
              ))}
              {ordered.length === 0 && (
                <Typography variant="body2" data-testid="no-proposals">
                  No reliable value found for the missing fields.
                </Typography>
              )}
              {ordered.map((proposal) => {
                const existing = (current[proposal.field] || "")
                  .toString()
                  .trim();
                return (
                  <Box
                    key={proposal.field}
                    sx={{
                      border: 1,
                      borderColor: "divider",
                      borderRadius: 1,
                      p: 1.5,
                      mb: 1,
                    }}
                    data-testid={`proposal-${proposal.field}`}
                  >
                    <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                      <Checkbox
                        size="small"
                        checked={Boolean(selected[proposal.field])}
                        onChange={(event) =>
                          setSelected((currentSel) => ({
                            ...currentSel,
                            [proposal.field]: event.target.checked,
                          }))
                        }
                        slotProps={{
                          input: {
                            "aria-label": `Apply ${
                              FIELD_LABELS[proposal.field] || proposal.field
                            }`,
                          },
                        }}
                      />
                      <Typography variant="subtitle2" sx={{ flexGrow: 1 }}>
                        {FIELD_LABELS[proposal.field] || proposal.field}
                      </Typography>
                      <Chip
                        size="small"
                        variant={
                          proposal.provenance === "ai" ? "outlined" : "filled"
                        }
                        color={proposal.provenance === "ai" ? "secondary" : "success"}
                        label={`${
                          PROVENANCE_LABELS[proposal.provenance] ||
                          proposal.provenance
                        }${
                          proposal.provenance === "ai"
                            ? `: ${proposal.confidence}`
                            : ""
                        }`}
                      />
                    </Box>
                    <Typography
                      variant="body2"
                      sx={{ pl: 5, overflowWrap: "anywhere" }}
                    >
                      {proposal.value}
                    </Typography>
                    {proposal.evidence ? (
                      <Typography
                        variant="caption"
                        color="text.secondary"
                        display="block"
                        sx={{ pl: 5 }}
                      >
                        Based on: {proposal.evidence}
                      </Typography>
                    ) : null}
                    {existing ? (
                      <Typography
                        variant="caption"
                        color="warning.main"
                        display="block"
                        sx={{ pl: 5 }}
                        data-testid={`protected-${proposal.field}`}
                      >
                        You already entered &ldquo;{existing}&rdquo; — ticking
                        this replaces it.
                      </Typography>
                    ) : null}
                  </Box>
                );
              })}
              {applied && (
                <Alert severity="success" sx={{ mt: 1 }}>
                  The ticked fields were written into Publication Information.
                  Nothing has been saved or published — review them and use
                  Save when you are ready.
                </Alert>
              )}
            </Fragment>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={close}>Close</Button>
          {!result ? (
            <Button
              variant="contained"
              disabled={!consent || loading}
              onClick={request}
            >
              Send and get suggestions
            </Button>
          ) : (
            <Button variant="contained" disabled={!anySelected} onClick={apply}>
              Apply selected fields
            </Button>
          )}
        </DialogActions>
      </Dialog>
    </Fragment>
  );
};

PublicationAssist.propTypes = {
  reference: PropTypes.object,
  sourceText: PropTypes.string,
  sourceFilename: PropTypes.string,
};

export default PublicationAssist;
