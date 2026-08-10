import { Fragment, useEffect, useState } from "react";
import PropTypes from "prop-types";

import axios from "axios";
import Link from "next/link";
import { Box, Chip, Divider, LinearProgress, Typography } from "@mui/material";

import Drawer from "../drawer";
import { SmallStyledButton } from "../button";

// Related Research, computed by the backend at view time (never pinned into
// the record) from GET /api/paper/{id}/related.
//
// Two independent lists: Qresp records the SOURCE server holds, and external
// papers proposed by Semantic Scholar. Both are already filtered by the
// backend's quality gate and capped at five, so this component renders exactly
// what it is given and never pads a short list. Every result carries the
// grounded reasons the backend computed; nothing here invents text.
//
// The source server is whichever one the detail page is showing: this page can
// be opened on a federated record (`/paperdetails/{id}?server=...`), whose id
// exists on that server and nowhere else. `server` is therefore forwarded to
// the request — without it the backend is asked about an id it cannot have,
// and can only answer 404.
//
// EXISTENCE CONTRACT. On a published detail page, with the feature switched
// on, this section ALWAYS renders. There are exactly four visible states and
// exactly two ways to render nothing:
//
//   loading      the request is in flight
//   results      at least one list has something
//   empty        the backend answered and nothing cleared the quality gate --
//                a real result, not a malfunction
//   unavailable  the request failed, or the backend could not read the source
//                Qresp server -> say THAT, and offer a retry
//
//   (nothing)    `enabled: false` -- the deployment does not have this
//                feature, so there is nothing to explain to a reader
//   (nothing)    no paperId -- there is no record to ask about
//
// An unpublished preview is excluded by the PAGE, which does not mount this
// component at all; there is nothing to compute for a record that is not
// published yet.
//
// The failure state is the point. Catching the error and rendering `null` --
// what this did before -- made a broken request indistinguishable from a
// deployment that never had the feature, and there was no way for a reader
// to tell either from "nothing is related to this paper".

const EMPTY_MESSAGE = "No sufficiently related papers were found.";
const UNAVAILABLE_MESSAGE =
  "Related research is unavailable right now. This is a problem loading the " +
  "suggestions, not a statement about this record.";
const MAX_REASONS = 3;
const HEADING = "Suggested Related Papers";

// Shown on every render, in every state. These suggestions come from
// deterministic metadata similarity, not from a person having checked them,
// and a reader deciding whether to trust a connection needs to know that
// before they act on it.
//
// It deliberately does NOT say "AI" or "AI-assisted". No language model is
// involved in serving this section: candidates come from the Qresp corpus and
// from Semantic Scholar, and the ranking is computed arithmetic. Calling it AI
// would be a false claim about how the answer was produced. If a model ever
// reranks at serve time, that is when the wording changes.
const DISCLAIMER =
  "These suggestions are generated automatically from publication metadata " +
  "and research-similarity signals. They may be incomplete or inaccurate. " +
  "Review each paper before relying on the suggested connection.";

const formatDate = (value) => {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString();
};

const Note = ({ children, color = "secondary" }) => (
  <Typography
    variant="body2"
    color={color}
    sx={{ mt: 1, wordBreak: "break-word" }}
  >
    {children}
  </Typography>
);

const ResultTitle = ({ result, server }) => {
  const style = { fontWeight: "bold", wordBreak: "break-word" };
  // Internal results stay inside Qresp; external ones go to the publisher via
  // the HTTPS DOI link the backend preferred.
  //
  // A result names the Qresp server it lives on. That is what the link must
  // carry: a federated record's id resolves only on its own server, so
  // dropping the origin here would send the reader to a 404 — or, if the id
  // happened to exist locally too, to the wrong paper. `server` (this page's)
  // is the fallback for a backend that predates `result.server`.
  if (result.source === "internal" && result.id) {
    return (
      <Link
        href={{
          pathname: `/paperdetails/${result.id}`,
          query: { server: result.server || server || "" },
        }}
        style={style}
      >
        {result.title}
      </Link>
    );
  }
  if (result.url) {
    return (
      <a
        href={result.url}
        target="_blank"
        rel="noopener noreferrer"
        style={style}
      >
        {result.title}
      </a>
    );
  }
  return <span style={style}>{result.title}</span>;
};

const Result = ({ result, server }) => (
  <Box
    component="li"
    data-testid="related-result"
    sx={{
      listStyle: "none",
      py: 1.5,
      minWidth: 0,
      borderTop: "1px solid rgba(0,0,0,0.08)",
    }}
  >
    <Typography
      variant="subtitle1"
      component="div"
      sx={{ wordBreak: "break-word" }}
    >
      <ResultTitle result={result} server={server} />
    </Typography>
    {result.authors ? (
      <Typography
        variant="body2"
        color="secondary"
        sx={{ wordBreak: "break-word" }}
      >
        {result.authors}
      </Typography>
    ) : null}
    <Box
      sx={{
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: 1,
        mt: 0.5,
        minWidth: 0,
      }}
    >
      {result.year ? <Chip size="small" label={String(result.year)} /> : null}
      {result.doi ? (
        <Typography
          variant="body2"
          component="span"
          sx={{ wordBreak: "break-all", minWidth: 0 }}
        >
          <a
            href={result.url || `https://doi.org/${result.doi}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            {`DOI: ${result.doi}`}
          </a>
        </Typography>
      ) : null}
      {result.source === "external" ? (
        <Chip
          size="small"
          variant="outlined"
          label="Recommended by Semantic Scholar"
          sx={{ maxWidth: "100%" }}
        />
      ) : null}
    </Box>
    {result.reasons && result.reasons.length ? (
      <Box sx={{ mt: 1, minWidth: 0 }}>
        <Typography variant="caption" color="secondary" component="div">
          <Box component="span" sx={{ fontWeight: "bold" }}>
            Why related
          </Box>
        </Typography>
        <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
          {result.reasons.slice(0, MAX_REASONS).map((reason) => (
            <Typography
              key={reason}
              component="li"
              variant="body2"
              color="secondary"
              sx={{ wordBreak: "break-word" }}
            >
              {reason}
            </Typography>
          ))}
        </Box>
      </Box>
    ) : null}
  </Box>
);

const Section = ({ title, children }) => (
  <Box sx={{ mb: 2, minWidth: 0 }}>
    <Typography variant="h6" component="h3" sx={{ wordBreak: "break-word" }}>
      <Box component="span" sx={{ fontWeight: "bold" }}>
        {title}
      </Box>
    </Typography>
    {children}
  </Box>
);

const ResultList = ({ results, server }) => (
  <Box component="ul" sx={{ m: 0, p: 0, minWidth: 0 }}>
    {results.map((result) => (
      <Result
        key={`${result.source}-${result.id || result.doi || result.title}`}
        result={result}
        server={server}
      />
    ))}
  </Box>
);

// The external provider is the one part of this that can be missing, off, or
// broken; each case reads differently so a reader can tell "nothing matched"
// from "we could not ask".
//
// `disabled` is NOT one of those cases: a server running internal-only has no
// external half at all, so the heading is dropped rather than explained. A
// reader should not be told about a feature this deployment does not have.
// The contract, stated once:
//
//   provider answered, nothing to show  -> "No sufficiently related papers
//                                           were found."  (an ANSWER)
//   provider could not be asked/reached -> "unavailable"  (a FAILURE)
//
// `ok` covers both "the provider proposed nothing" and "it proposed
// candidates and none cleared the quality gate". Both are answers, and the
// gate is never relaxed to fill the list, so both read the same to a reader.
// The backend distinguishes them in `external.reason` for operators.
const externalNotice = (external) => {
  if (external.status === "unresolved") {
    return (
      "This record could not be matched in the external index, so no " +
      "external recommendations were requested."
    );
  }
  if (external.status === "unavailable") {
    return (
      "External recommendations are unavailable right now. The Qresp " +
      "results above are unaffected."
    );
  }
  return null;
};

const RelatedResearch = ({ paperId, server }) => {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState(null);
  const [failed, setFailed] = useState(false);
  // Bumped by the retry button. It is the only dependency that changes on a
  // retry, so it is what re-runs the effect.
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!paperId) {
      // Nothing to ask about. Not a failure -- see the guard below.
      setLoading(false);
      return undefined;
    }
    let cancelled = false;
    // Both the record and the server it lives on are dependencies, and both
    // reset the state: the same id on a different Qresp server is a different
    // paper, so showing the previous server's answer while the new one loads
    // would attribute one server's results to another.
    setLoading(true);
    setFailed(false);
    setData(null);
    axios
      .get(`/api/paper/${encodeURIComponent(paperId)}/related`, {
        // Which Qresp server holds this record. Omitted when the page is not
        // federated, so a local record produces the exact request it always
        // did.
        params: server ? { server } : {},
      })
      .then((res) => {
        if (cancelled) return;
        setData(res.data);
        // The backend answered, but could not read the source server. An
        // empty list here would be a claim about the record that nobody
        // actually checked.
        setFailed((res.data || {}).internal?.status === "unavailable");
      })
      .catch(() => {
        // A transport failure, a backend without this endpoint, or a record
        // this server will not serve. The section stays, and says so.
        if (cancelled) return;
        setData(null);
        setFailed(true);
      })
      .then(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [paperId, server, attempt]);

  // No record to ask about: the section has no subject, so it does not exist.
  // Distinct from a failure, which does.
  if (!paperId) return null;

  if (loading) {
    return (
      <Drawer heading={HEADING} defaultOpen>
        <Box sx={{ py: 1 }}>
          <Typography
            variant="body2"
            color="secondary"
            sx={{ mb: 2, wordBreak: "break-word" }}
          >
            {DISCLAIMER}
          </Typography>
          <Typography variant="body2" color="secondary" gutterBottom>
            Looking for related research…
          </Typography>
          <LinearProgress aria-label="Loading related research" />
        </Box>
      </Drawer>
    );
  }

  // The feature is off on this deployment: there is nothing to explain to a
  // reader, so the section does not exist. Checked before the failure state so
  // an explicit "disabled" answer never renders as a problem.
  if (data && data.enabled === false) return null;

  // No answer and not disabled means the request did not succeed. There is no
  // path from here back to rendering nothing: a failure is a state of this
  // section, not its absence.
  if (failed || !data) {
    return (
      <Drawer heading={HEADING} defaultOpen>
        <Box sx={{ py: 1 }}>
          <Note color="error">{UNAVAILABLE_MESSAGE}</Note>
          <Box sx={{ mt: 1.5 }}>
            <SmallStyledButton
              onClick={() => setAttempt((value) => value + 1)}
            >
              Try again
            </SmallStyledButton>
          </Box>
        </Box>
      </Drawer>
    );
  }

  const internal = data.internal || { results: [] };
  const external = data.external || { results: [], status: "disabled" };
  const internalResults = internal.results || [];
  const externalResults = external.results || [];
  const notice = externalNotice(external);
  const staleDate = external.stale ? formatDate(external.updated_at) : null;
  // Internal-only deployment: the external half is not merely empty, it is
  // not part of this server. Render the internal list alone.
  const showExternal = external.status !== "disabled";

  return (
    <Drawer heading={HEADING} defaultOpen>
      <Typography
        variant="body2"
        color="secondary"
        sx={{ mb: 2, wordBreak: "break-word" }}
      >
        {DISCLAIMER}
      </Typography>
      <Section title="Related Qresp Records">
        {internalResults.length ? (
          <ResultList results={internalResults} server={server} />
        ) : (
          <Note>{EMPTY_MESSAGE}</Note>
        )}
      </Section>
      {showExternal ? (
        <Fragment>
          <Divider />
          <Section title="Related External Papers">
            {external.stale ? (
              <Note color="error">
                {staleDate
                  ? `Showing the last successful external results (${staleDate}); refreshing them just failed.`
                  : "Showing the last successful external results; refreshing them just failed."}
              </Note>
            ) : null}
            {externalResults.length ? (
              <Fragment>
                <ResultList results={externalResults} server={server} />
                <Typography variant="caption" color="secondary" component="div">
                  Candidates proposed by Semantic Scholar; shown only when
                  Qresp found evidence they are related.
                </Typography>
              </Fragment>
            ) : (
              <Note
                color={external.status === "unavailable" ? "error" : "secondary"}
              >
                {notice || EMPTY_MESSAGE}
              </Note>
            )}
          </Section>
        </Fragment>
      ) : null}
    </Drawer>
  );
};

RelatedResearch.propTypes = {
  paperId: PropTypes.string,
  server: PropTypes.string,
};

export default RelatedResearch;
