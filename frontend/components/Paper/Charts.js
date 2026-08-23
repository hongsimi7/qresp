import { Fragment, useState, useContext } from "react";
import PropTypes from "prop-types";

// simple-react-lightbox is dead (no React >=17 support); replaced with
// yet-another-react-lightbox driven by plain open/index state.
import Lightbox from "yet-another-react-lightbox";
import Captions from "yet-another-react-lightbox/plugins/captions";
import "yet-another-react-lightbox/styles.css";
import "yet-another-react-lightbox/plugins/captions.css";

import { Box, Typography, Button } from "@mui/material";

import RecordTable from "../Table/Table";
import Drawer from "../drawer";
import {
  buildDirectoryUrl,
  buildFileUrl,
  isMixedContent,
} from "../../Utils/fileServerUrl";
import Slider from "../HorizontalSlider";
import StyledTooltip from "../tooltip";
import ChartWorkflow from "./ChartWorkflow";
import { formatData } from "../Workflow/util";

import { useRouter } from "next/router";
import LoadingContext from "../../Context/Loading/loadingContext";
import AlertContext from "../../Context/Alert/alertContext";
import axios from "axios";

const PropsView = ({ rowdata }) => {
  return (
    <Typography variant="body2" color="secondary">
      {rowdata["properties"].join(", ")}
    </Typography>
  );
};

const FilesView = ({ rowdata }) => {
  const fileLinks = rowdata["files"].map((file, index) => {
    file = file.trim();
    if (file[0] === ".") {
      file = file.slice(1);
    }
    return (
      <a
        href={buildFileUrl(rowdata["server"], file)}
        key={index}
        style={{ color: "#007bff" }}
        target="_blank"
        rel="noopener noreferrer"
      >
        {index != 0 ? ", " : null}
        {file.length > 1 ? file.slice(file.lastIndexOf("/") + 1) : null}
      </a>
    );
  });
  return (
    <div
      style={{
        wordBreak: "break-all",
        maxHeight: "10vh",
        overflowY: "auto",
        paddingRight: "8px",
        whiteSpace: "normal",
      }}
    >
      {fileLinks}
    </div>
  );
};

const ChartInfo = ({
  charts,
  fileserverpath,
  downloadPath,
  tools,
  scripts,
  datasets,
  external,
  showWorkflows = true,
  server,
  showSlider = true,
  inDrawer = true,
  editColumn = [],
}) => {
  // Light Box Controls: the open slide index (-1 = closed).
  const [lightboxIndex, setLightboxIndex] = useState(-1);

  // Chart Workflow Controls
  const [chartWorkflow, setChartWorkflow] = useState({});
  const [showChartWorkflow, setShowChartWorkflow] = useState(false);
  const router = useRouter();

  const { showLoader, hideLoader } = useContext(LoadingContext);
  const { setAlert } = useContext(AlertContext);

  const handleClick = async (e, chartid, paperid) => {
    e.preventDefault();
    showLoader();
    try {
      const data = await axios
        .get(`${server}/api/paper/${paperid}/chart/${chartid}`)
        .then((res) => res.data);
      setChartWorkflow(data);
      setShowChartWorkflow(true);
    } catch (error) {
      console.error(error);
      setAlert(
        "Error",
        "There was an error trying to fetch the chart workflow. Please try again later, if problems persist please contact the administrator. ",
        null
      );
    }
    hideLoader();
  };

  const workflowData = showSlider
    ? formatData(charts, tools, external, datasets, scripts)
    : null;

  const FigureView = ({ rowdata }) => {
    const datatreeLink = buildDirectoryUrl(rowdata.server, rowdata.imageFile);
    const imageUrl = buildFileUrl(rowdata.server, rowdata.imageFile);
    // Decided once, from the URL alone -- the browser will block this before
    // any request is made, so it is knowable before the image errors.
    const mixedContent = isMixedContent(imageUrl);

    // Three different reasons produce no URL, and they need three different
    // things from the reader: save the file server, pick an image, or fix a
    // path that cannot be resolved. One shared sentence sent people looking
    // in the wrong place.
    if (!imageUrl) {
      const reason = !rowdata.imageFile
        ? "Figure Image not selected — set it on this chart."
        : !rowdata.server
        ? "File Server path not saved — save it in “Where is the paper”."
        : "Invalid image path — it must be a relative path inside the paper " +
          "folder, with no “..”, backslash or full URL.";
      return (
        <Typography
          variant="caption"
          color="error"
          data-testid="chart-image-missing"
          sx={{ display: "block", p: 1 }}
        >
          {reason}
        </Typography>
      );
    }

    return (
      <Fragment>
        <StyledTooltip title={rowdata.caption} placement="left" arrow>
          <Button focusRipple onClick={() => setLightboxIndex(rowdata.index)}>
            <img
              src={imageUrl}
              style={{ maxWidth: "30vw" }}
              alt={rowdata.caption || rowdata.imageFile}
              loading="lazy"
              data-testid="chart-image"
              onError={(event) => {
                // The server path is right but the file is not reachable:
                // a labelled failure beats a silent empty box.
                event.currentTarget.style.display = "none";
                const note = event.currentTarget.nextElementSibling;
                if (note) note.style.display = "block";
              }}
            ></img>
            {/* The URL is shown verbatim, never re-cased or hidden: the
                reader needs to try it themselves.

                One cause IS knowable from here, and it used to be misnamed.
                An https page cannot load an http sub-resource -- the browser
                refuses it before any request is made -- and that failure
                reaches this handler looking exactly like a 404. Telling the
                reader to trust a certificate then sends them somewhere the
                problem is not: the fix is the saved file-server URL.

                Everything else stays as it was. A missing file and an
                untrusted certificate really are indistinguishable from
                inside the page, so both are named rather than guessed
                between, and the two escape hatches remain. */}
            <Typography
              variant="caption"
              color="error"
              component="span"
              data-testid="chart-image-error"
              sx={{ display: "none", p: 1, overflowWrap: "anywhere" }}
            >
              Remote image could not be loaded:{" "}
              <Box component="span" sx={{ fontFamily: "monospace" }}>
                {imageUrl}
              </Box>{" "}
              {mixedContent
                ? "— this page is served over HTTPS and the file server URL " +
                  "is HTTP, so your browser blocked it. Save the file server " +
                  "path with an https:// URL in “Where is the paper”."
                : "— the file may be missing, or your browser may not trust " +
                  "the RCC certificate."}{" "}
              <a href={imageUrl} rel="noopener noreferrer" target="_blank">
                Open image
              </a>{" "}
              ·{" "}
              <a href={datatreeLink} rel="noopener noreferrer" target="_blank">
                Check file server access
              </a>
            </Typography>
          </Button>
        </StyledTooltip>
        {showSlider && (
          <Slider>
            <a
              href={datatreeLink}
              rel="noopener noreferrer"
              alt="View the data tree"
              target="_blank"
            >
              <img src="/images/datatree.png" className="imgButton" />
            </a>
            {showWorkflows ? (
              <a
                onClick={(e) =>
                  handleClick(e, rowdata.id, router.query.id, rowdata)
                }
                href="showChartWorkflow"
              >
                <img src="/images/workflow-icon.png" className="imgButton" />
              </a>
            ) : null}
            <a
              href={rowdata.downloadPath}
              rel="noopener noreferrer"
              alt="Download data associated to the paper Using Globus"
              target="_blank"
            >
              <img src="/images/download-icon.png" className="imgButton" />
            </a>
            {rowdata.notebookFile ? (
              <a
                href={
                  "https://nbviewer.jupyter.org/url/" +
                  rowdata.server.replace(/(^\w+:|^)\/\//, "") +
                  "/" +
                  rowdata.notebookFile
                }
                rel="noopener noreferrer"
                alt="View Default Notebook File"
                target="_blank"
              >
                <img src="/images/jupyter-icon.png" className="imgButton" />
              </a>
            ) : null}
          </Slider>
        )}
        <style jsx>{`
          .imgButton {
            margin: auto;
            height: 32px;
            width: 32px;
          }
        `}</style>
      </Fragment>
    );
  };

  const columns = [
    {
      label: "Figure/Table",
      name: "figure",
      view: FigureView,
      options: {
        align: "center",
        sort: true,
        searchable: false,
        value: (data) => data.number,
      },
    },
    {
      label: "Properties",
      name: "props",
      view: PropsView,
      options: {
        align: "center",
        sort: true,
        searchable: true,
        value: (data) => data.properties.join(""),
      },
    },
    {
      label: "Files",
      name: "files",
      view: FilesView,
      options: {
        align: "right",
        sort: false,
        searchable: false,
        value: null,
      },
    },
    ...editColumn,
  ];

  const Gallery = [];

  const rows = charts.map((row, index) => {
    row["index"] = index;
    row["server"] = fileserverpath;
    row["downloadPath"] = downloadPath;

    Gallery.push({
      src: buildFileUrl(row["server"], row["imageFile"]),
      description: row["caption"],
    });
    return {
      figure: row,
      props: {
        server: fileserverpath,
        properties: row["properties"],
      },
      files: {
        server: fileserverpath,
        files: row["files"],
      },
    };
  });

  return (
    <Fragment>
      <Lightbox
        open={lightboxIndex >= 0}
        index={lightboxIndex >= 0 ? lightboxIndex : 0}
        close={() => setLightboxIndex(-1)}
        slides={Gallery}
        plugins={[Captions]}
        animation={{ fade: 300 }}
      />
      {inDrawer ? (
        <Drawer heading="Charts">
          <RecordTable rows={rows} columns={columns} />
        </Drawer>
      ) : (
        <RecordTable rows={rows} columns={columns} />
      )}
      {showWorkflows ? (
        <ChartWorkflow
          showChartWorkflow={showChartWorkflow}
          setShowChartWorkflow={setShowChartWorkflow}
          data={workflowData}
          workflow={chartWorkflow}
        />
      ) : null}
    </Fragment>
  );
};

ChartInfo.propTypes = {
  charts: PropTypes.array.isRequired,
  fileserverpath: PropTypes.string.isRequired,
  showSlider: PropTypes.bool,
  downloadPath: PropTypes.string,
  tools: PropTypes.array,
  scripts: PropTypes.array,
  datasets: PropTypes.array,
  external: PropTypes.array,
  server: PropTypes.string,
  showWorkflows: PropTypes.bool,
  inDrawer: PropTypes.bool,
  editColumn: PropTypes.array,
};

export default ChartInfo;
