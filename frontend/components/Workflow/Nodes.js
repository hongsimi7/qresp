import { IdTypeMap, NodeType } from "./Types";
import { artifactLabel } from "../../Utils/artifactLabel";
import { buildFileUrl } from "../../Utils/fileServerUrl";

const hoverTooltip = (type, id, nodeData) => {
  const maxCaptionLength = 200;
  const displayId = id.charAt(0).toUpperCase() + id.slice(1);
  const displayType = type.charAt(0) + type.slice(1).toLowerCase();
  switch (type) {
    case "CHART":
      return (
        nodeData &&
        `
        <p style="
          max-width:400px;
          white-space:normal;
          text-align:justify;
          word-break:break-all;
          ">
          <img
            src=${buildFileUrl(nodeData["server"], nodeData["imageFile"])}
            style="
              max-width:400px;
              max-height:400px;
              "
            alt="${nodeData.caption}"
            loading="lazy"
          ></img>
          <br>
          <strong>${
            displayType + " " + displayId
          }:</strong> ${nodeData.caption.slice(0, maxCaptionLength)}${
          nodeData.caption.length > maxCaptionLength ? "..." : ""
        }</p>
      `
      );
    case "TOOL":
      if (!nodeData) return "";

      if (nodeData.kind == "software") {
        return `<p>
        <strong>Tool ${displayId}:</strong> Software<br>
        <strong>Package Name:</strong> ${nodeData.packageName}<br>
        <strong>Version:</strong> ${nodeData.version}<br>
        </p>`;
      }

      return `<p>
      <strong>Tool ${displayId}:</strong> Experiment<br>
      <strong>Facility Name:</strong> ${nodeData.facilityName}<br>
      <strong>Measurement:</strong> ${nodeData.measurement}<br>
      </p>`;

    default:
      return (
        nodeData &&
        `<p style="
      max-width:400px;
      white-space:normal;
      text-align:justify;
      word-break:break-all;">
        <strong>${displayType + " " + displayId}:</strong> ${
          nodeData.readme
        }</p>`
      );
  }
};

const createNode = (id, data, showLabels = false, position = {}) => {
  const type = id.charAt(0);
  const nodeData = data[type][id];
  const node = {
    id: id,
    ...NodeType[IdTypeMap[type]], // Set Shape Size and Color
    title: hoverTooltip(IdTypeMap[type], id, nodeData),
    // info: val.details,
    font: {
      multi: true,
      size: 20,
      color: "black",
      bold: {
        color: "black",
      },
    },
    // THE CURATOR'S OWN WORD FOR IT, not `c0`. An id is an internal
    // reference: positional, renumbered when a sibling is deleted, and no
    // kind of name for somebody's own work. It stays in `node.id`, which is
    // what every edge and every lookup actually addresses.
    label: showLabels ? artifactLabel(nodeData, id) : "",
    // A caption is a sentence, and a sentence written on one line runs
    // across its neighbours. Wrapped, a long name costs height -- which
    // this drawing has -- instead of the width it does not.
    widthConstraint: { maximum: 160 },
    ...position,
  };

  return node;
};

export default createNode;
