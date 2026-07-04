import { Fragment, useContext } from "react";
import PropTypes from "prop-types";

import Link from "next/link";
import { Typography, Grid, Box, Paper } from "@mui/material";
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
    _Search__publication,
    _Search__tags,
    _Search__title,
    _Search__server,
  } = rowdata;

  const { setQuery } = useContext(TableSearchContext);

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
              <Typography
                variant="subtitle1"
                component="div"
                color="secondary"
                style={{ wordBreak: "break-all" }}
                gutterBottom
              >
                {_Search__authors}
              </Typography>
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
