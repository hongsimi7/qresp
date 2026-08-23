import { Fragment, useContext } from "react";
import PropTypes from "prop-types";

import Link from "next/link";
import { Chip, Typography, Grid, Box, Paper } from "@mui/material";
import { styled } from "@mui/material/styles";

import Tag from "../tag";

import { TableSearchContext } from "../Table/TableSearch";

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
  } = rowdata;

  const { setQuery } = useContext(TableSearchContext);

  // `_Search__sources` is still built and still carried on the row -- it is
  // what dedupe uses to merge a paper published on two nodes into one line,
  // and `_Search__server` is what the detail link routes by. It is simply not
  // RENDERED: which node served a copy is infrastructure, not a fact about
  // the paper, and showing it as a badge invited it to be read as one.

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
              {/* The author line and, when a curator entered one, the
                  record's Institution -- right after the author text, and
                  wrapping rather than overlapping the year column.

                  There is deliberately NO badge naming the Qresp node this
                  copy was read from. A node is shared federation and search
                  infrastructure; which one served a record says nothing about
                  who did the work, and a public card reading "Hosted by
                  University of Chicago" beside a paper written elsewhere
                  invites exactly that misreading. The node is still tracked
                  internally -- `_Search__server` still routes the detail
                  link, dedupe still merges copies across nodes, and a node
                  that fails is still reported -- it is just not presented as
                  a property of the paper.

                  Institution is the only institutional claim shown here, it
                  is typed by a curator, and it is never inferred from the
                  server, the authors, a DOI or a collection. */}
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
                  // The visible text carries the whole meaning, so a reader
                  // never has to infer what a bare institution name beside a
                  // title is claiming.
                  <Chip
                    size="small"
                    variant="outlined"
                    label={`Institution: ${_Search__institution}`}
                    data-testid="record-institution"
                    sx={{ maxWidth: "100%" }}
                  />
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
