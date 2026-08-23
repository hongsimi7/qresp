import { Fragment, useContext } from "react";
import PropTypes from "prop-types";

import Link from "next/link";
import { Chip, Typography, Grid, Box, Paper } from "@mui/material";
import { styled } from "@mui/material/styles";

import Tag from "../tag";

import { TableSearchContext } from "../Table/TableSearch";
import { hostedBy } from "../../Utils/recordSources";

const StyledPaper = styled(Paper)({
  backgroundColor: "inherit",
});

const Summary = ({ rowdata }) => {
  const {
    _Search__authors,
    _Search__doi,
    _Search__id,
    _Search__institution,
    _Search__publication,
    _Search__tags,
    _Search__title,
    _Search__server,
    _Search__sources,
  } = rowdata;

  const { setQuery } = useContext(TableSearchContext);

  // Which Qresp node publishes this record. The Explorer lists several nodes
  // at once, so "where did this come from" is a question the card has to
  // answer; a paper published on two nodes carries both tags rather than
  // appearing twice.
  //
  // Older callers pass no `_Search__sources` (a single-node list, or a saved
  // row), so the record's own server is the fallback and the tag is simply
  // absent when there is nothing true to say.
  const sources =
    Array.isArray(_Search__sources) && _Search__sources.length
      ? _Search__sources
      : [];

  return (
    <Fragment>
      <StyledPaper elevation={0}>
        <Grid container justifyContent="flex-start" alignItems="center">
          <Grid container size={12}>
            <Grid size={12}>
              {/* Next 13+ <Link> renders the anchor itself (no child <a>);
                  the resolved pathname+query go straight into href. */}
              <span className="title-link">
                <Link
                  href={{
                    pathname: "/paperdetails/" + _Search__id,
                    query: { server: _Search__server },
                  }}
                >
                  <Typography variant="h6" component="div" gutterBottom>
                    <Box sx={{ fontWeight: "bold" }}>{_Search__title}</Box>
                  </Typography>
                </Link>
              </span>
            </Grid>
            <Grid size={12}>
              {/* The author line, and the two chips that qualify it. Both sit
                  on THIS row, right after the author text, and both wrap
                  rather than overlapping the year column on a narrow
                  viewport.

                  They answer two different questions and are deliberately
                  kept as separate chips so neither can be read as the other:

                    Institution   optional, typed by a curator, about the
                                  RECORD. Absent unless somebody entered it.
                    Hosted by ... automatic and factual, about the SERVER
                                  this copy was read from. Never guessed from
                                  authors, DOIs, collections or hostname
                                  patterns -- see Utils/recordSources. */}
              <Box
                sx={{
                  display: "flex",
                  flexWrap: "wrap",
                  alignItems: "center",
                  columnGap: 1,
                  rowGap: 0.5,
                  mb: 1,
                  minWidth: 0,
                }}
              >
                <Typography
                  variant="subtitle1"
                  component="span"
                  color="secondary"
                  style={{ wordBreak: "break-all" }}
                >
                  {_Search__authors}
                </Typography>
                {_Search__institution ? (
                  <Chip
                    size="small"
                    variant="outlined"
                    label={_Search__institution}
                    aria-label={`Institution: ${_Search__institution}`}
                    data-testid="record-institution"
                    sx={{ maxWidth: "100%" }}
                  />
                ) : null}
                {sources.length ? (
                  // A LIST, so a screen reader hears "2 items" for a paper
                  // published on two nodes. The visible text carries the whole
                  // meaning ("Hosted by Duke University"); colour and position
                  // are not asked to say anything on their own.
                  <Box
                    component="ul"
                    aria-label="Qresp nodes hosting this record"
                    sx={{
                      display: "flex",
                      flexWrap: "wrap",
                      gap: 0.5,
                      listStyle: "none",
                      m: 0,
                      p: 0,
                      minWidth: 0,
                    }}
                  >
                    {sources.map((source) => (
                      <Box component="li" key={source.server} sx={{ minWidth: 0 }}>
                        <Chip
                          size="small"
                          variant="outlined"
                          color="primary"
                          label={hostedBy(source.label)}
                          data-testid="record-source"
                          sx={{ maxWidth: "100%" }}
                        />
                      </Box>
                    ))}
                  </Box>
                ) : null}
              </Box>
            </Grid>
            <Grid size={12}>
              <a
                href={"https://doi.org/" + _Search__doi}
                target="_blank"
                rel="noopener noreferrer"
              >
                <Typography variant="body1" component="div" gutterBottom>
                  {_Search__publication}
                </Typography>
              </a>
            </Grid>
            <Grid size={12}>
              {_Search__tags.map((tag) => (
                <Tag
                  label={tag
                    .slice(0, 32)
                    .trim()
                    .concat(tag.length > 32 ? "..." : "")}
                  key={tag}
                  size="small"
                  onClick={() => {
                    setQuery(tag);
                    window.scrollTo(0, 0);
                  }}
                />
              ))}
            </Grid>
          </Grid>
        </Grid>
      </StyledPaper>
      <style jsx>{`
        a {
          color: #007bff;
        }
        a:hover {
          color: #777777;
        }
        .title-link :global(a) {
          color: #007bff;
          text-decoration: none;
        }
        .title-link :global(a:hover) {
          color: #777777;
        }
        img {
          margin: 8px 0px 0px;
          height: 32px;
          width: 32px;
        }
      `}</style>
    </Fragment>
  );
};

Summary.propTypes = {
  rowdata: PropTypes.object.isRequired,
};

export default Summary;
