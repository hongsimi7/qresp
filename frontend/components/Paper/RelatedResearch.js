import { Fragment, useEffect, useState } from "react";
import PropTypes from "prop-types";

import axios from "axios";
import Link from "next/link";
import { Box, Chip, Divider, LinearProgress, Typography } from "@mui/material";

import Drawer from "../drawer";

// Related Research, computed by the backend at view time (never pinned into
// the record) from GET /api/paper/{id}/related.
//
// Two independent lists: Qresp records this server holds, and external papers
// proposed by Semantic Scholar. Both are already filtered by the backend's
// quality gate and capped at five, so this component renders exactly what it
// is given and never pads a short list. Every result carries the grounded
// reasons the backend computed; nothing here invents text.
//
// The whole section is opt-in server-side: when the feature is off the
// response says so and this renders nothing at all, leaving the detail page
// exactly as it was.

const EMPTY_MESSAGE = "No sufficiently related papers were found.";
const MAX_REASONS = 3;

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
  if (result.source === "internal" && result.id) {
    return (
      <Link
        href={{
          pathname: `/paperdetails/${result.id}`,
          query: { server: server || "" },
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

  useEffect(() => {
    if (!paperId) return undefined;
    let cancelled = false;
    setLoading(true);
    axios
      .get(`/api/paper/${encodeURIComponent(paperId)}/related`)
      .then((res) => {
        if (!cancelled) setData(res.data);
      })
      .catch(() => {
        // Older backends, previews, or a hidden record: the section simply
        // does not appear. It must never break the page it sits on.
        if (!cancelled) setData(null);
      })
      .then(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [paperId]);

  if (loading) {
    return (
      <Drawer heading="Related Research" defaultOpen>
        <Box sx={{ py: 1 }}>
          <Typography variant="body2" color="secondary" gutterBottom>
            Looking for related research…
          </Typography>
          <LinearProgress aria-label="Loading related research" />
        </Box>
      </Drawer>
    );
  }

  if (!data || data.enabled === false) return null;

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
    <Drawer heading="Related Research" defaultOpen>
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
