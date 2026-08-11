import { Fragment, useEffect, useRef, useState, useContext } from "react";
import PropTypes from "prop-types";

import {
  Collapse,
  Button,
  Grid,
  Typography,
  TextField,
  Box,
} from "@mui/material";
import { Search, ExpandMore, Clear } from "@mui/icons-material";
import Autocomplete from "@mui/material/Autocomplete";

import LoadingContext from "../Context/Loading/loadingContext";
import ServerContext from "../Context/Servers/serverContext";

import { useRouter } from "next/router";
import axios from "axios";

const TextSearchField = ({ title, placeholder, value, onChange, name }) => {
  return (
    <Grid container direction="column" alignItems="stretch" justifyContent="center">
      <Grid size={12}>
        <Typography variant="h6" color="secondary" align="center">
          <Box sx={{ fontWeight: "bold" }}>{title}</Box>
        </Typography>
      </Grid>
      <Grid size={12}>
        <TextField
          variant="outlined"
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(name, e.target.value)}
          size="small"
          fullWidth
        />
      </Grid>
    </Grid>
  );
};

const ChipSearchField = ({
  title,
  onChange,
  options,
  name,
  placeholder,
  value,
}) => {
  return (
    <Grid container direction="column" alignItems="stretch" justifyContent="center">
      <Grid size={12}>
        <Typography variant="h6" color="secondary" align="center">
          <Box sx={{ fontWeight: "bold" }}>{title}</Box>
        </Typography>
      </Grid>
      <Grid size={12}>
        <Autocomplete
          value={value}
          multiple
          options={Array.from(options)}
          filterSelectedOptions
          renderInput={(params) => (
            <TextField
              {...params}
              variant="outlined"
              placeholder={placeholder}
            />
          )}
          ChipProps={{ color: "primary", variant: "outlined" }}
          onChange={(event, values) => onChange(name, values)}
          size="small"
          fullWidth
          limitTags={2}
        />
      </Grid>
    </Grid>
  );
};

// This component runs the search; it does NOT decide what the page says
// about the outcome. It used to do both, and the second half was a global
// `setAlert()` -- an un-dismissable dialog over results the other nodes had
// served perfectly well. The results live in `pages/search.js`, so the status
// that describes them lives there too, and arrives through `onSearchResult`.
const AdvancedSearch = ({
  authors,
  publications,
  tags,
  collections,
  clearSearch,
  onSearchStart,
  onSearchResult,
}) => {
  const [show, setShow] = useState(false);

  const initialState = {
    paperTitle: "",
    doi: "",
    tags: [],
    collectionList: [],
    authorsList: [],
    publicationList: [],
  };

  const [search, setSearch] = useState(initialState);

  const router = useRouter();

  const handleClick = () => {
    setShow(!show);
  };

  const onChange = (name, value) => {
    setSearch({ ...search, [name]: value });
  };

  const { showLoader, hideLoader } = useContext(LoadingContext);
  const { selected } = useContext(ServerContext);

  // A submit in flight must not be started again, and must not report into a
  // page that has since unmounted.
  const running = useRef(false);
  const mounted = useRef(true);
  useEffect(() => () => {
    mounted.current = false;
  }, []);

  // The request each node is asked, built exactly as before -- same parameter
  // names, same order, same joining. Retry re-runs THIS, so a retry is the
  // same question to the same servers rather than whatever is in the form by
  // the time the button is pressed.
  const buildQuery = (criteria) =>
    Object.entries(criteria)
      .map(([key, value]) =>
        Array.isArray(value) ? `${key}=${value.join(",")}` : `${key}=${value}`
      )
      .join("&");

  const runSearch = async (criteria, servers) => {
    if (running.current) return;
    running.current = true;
    if (onSearchStart) onSearchStart();
    showLoader();

    const query = buildQuery(criteria);
    // Staged per server. Nothing reaches the page until every node has been
    // asked, so a late failure cannot arrive after a partial commit.
    const papers = {};
    const failedServers = [];

    try {
      for (let i = 0; i < servers.length; i++) {
        const server = servers[i];
        try {
          const response = await axios
            .get(`${server}/api/search?${query}`)
            .then((res) => res.data);
          papers[server] = response;
        } catch (e) {
          // The thrown error can carry a host, a URL or a stack. It goes to
          // the console; the page is told only WHICH server failed.
          console.error(e);
          failedServers.push(server);
        }
      }
    } finally {
      // Every path, including an unexpected throw: a loader that outlives its
      // request covers the page forever.
      hideLoader();
      running.current = false;
    }

    if (!mounted.current) return;
    if (onSearchResult) {
      onSearchResult({
        papers,
        failedServers,
        // No node answered. The page decides what to do about it -- it is the
        // one that knows whether there were results on screen already.
        totalFailure: Object.keys(papers).length === 0,
        retry: () => runSearch(criteria, servers),
      });
    }
  };

  const onSubmit = (e) => {
    e.preventDefault();
    // A snapshot: the criteria and servers this run is about, so a retry
    // cannot silently become a different search.
    runSearch({ ...search }, [...(selected || [])]);
  };

  const onClear = () => {
    setSearch(initialState);
    clearSearch();
  };

  return (
    <Fragment>
      <Button
        onClick={handleClick}
        fullWidth={false}
        style={{ textTransform: "none" }}
      >
        Advanced Search
        <div className="rotateIcon">
          <ExpandMore />
        </div>
      </Button>
      <style jsx>
        {`
          .rotateIcon {
            display: inherit;
            align-items: inherit;
            justify-content: inherit;
            margin:auto;
            transform: rotate(0deg);
            overflow: hidden;
            transition: all 0.3s linear;
            transform: ${show ? `rotate(180deg)` : ""};          }
          }
        `}
      </style>
      <Collapse in={show}>
        <Box sx={{ m: 2 }}>
          <form onSubmit={onSubmit}>
            <Grid container direction="column" spacing={1} alignItems="center">
              <Grid container direction="row" spacing={1} justifyContent="center" alignItems="stretch" size={12}>
                <Grid size={{ xs: 12, sm: 6, md: 4 }}>
                  <TextSearchField
                    title="Title"
                    placeholder="Enter a title"
                    value={search.paperTitle}
                    onChange={onChange}
                    name="paperTitle"
                  />
                </Grid>
                <Grid size={{ xs: 12, sm: 6, md: 4 }}>
                  <TextSearchField
                    title="DOI"
                    placeholder="Enter a DOI"
                    value={search.doi}
                    onChange={onChange}
                    name="doi"
                  />
                </Grid>
                <Grid size={{ xs: 12, sm: 6, md: 4 }}>
                  <ChipSearchField
                    title="Tags"
                    options={tags}
                    onChange={onChange}
                    name="tags"
                    placeholder="Enter Tag(s)"
                    value={search.tags}
                  />
                </Grid>
                <Grid size={{ xs: 12, sm: 6, md: 4 }}>
                  <ChipSearchField
                    title="Collections"
                    options={collections}
                    onChange={onChange}
                    name="collectionList"
                    placeholder="Enter Collection(s) Name"
                    value={search.collectionList}
                  />
                </Grid>
                <Grid size={{ xs: 12, sm: 6, md: 4 }}>
                  <ChipSearchField
                    title="Paper Authors"
                    options={authors}
                    onChange={onChange}
                    name="authorsList"
                    placeholder="Enter Author(s) name"
                    value={search.authorsList}
                  />
                </Grid>
                <Grid size={{ xs: 12, sm: 6, md: 4 }}>
                  <ChipSearchField
                    title="Publication"
                    options={publications}
                    onChange={onChange}
                    name="publicationList"
                    placeholder="Enter publication(s) name"
                    value={search.publicationList}
                  />
                </Grid>
              </Grid>
              <Grid container spacing={1} justifyContent="center">
                <Grid>
                  <Button
                    variant="contained"
                    endIcon={<Search />}
                    type="submit"
                  >
                    Search
                  </Button>
                </Grid>
                <Grid>
                  <Button
                    variant="contained"
                    endIcon={<Clear />}
                    onClick={onClear}
                  >
                    Clear
                  </Button>
                </Grid>
              </Grid>
            </Grid>
          </form>
        </Box>
      </Collapse>
    </Fragment>
  );
};

AdvancedSearch.propTypes = {
  authors: PropTypes.array.isRequired,
  publications: PropTypes.array.isRequired,
  tags: PropTypes.array.isRequired,
  collections: PropTypes.array.isRequired,
  clearSearch: PropTypes.func.isRequired,
  // The page owns the results and the status; this reports into them.
  onSearchStart: PropTypes.func,
  onSearchResult: PropTypes.func,
};

export default AdvancedSearch;
