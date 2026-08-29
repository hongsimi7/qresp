import { Fragment } from "react";
import PropTypes from "prop-types";

import { Box, Typography } from "@mui/material";

import {
  CHART,
  EDGE_VERB,
  INPUTS,
  OUTPUTS,
  PROCESS,
  RELATED_TO,
  UNDIRECTED,
  fromStoredEdge,
  laneOf,
  prefixOf,
} from "../../Utils/workflowGraph";

// ONE PIECE OF WORK, DRAWN.
//
// The outline says what belongs to what; this says what the shape of the work
// IS -- which inputs feed which steps, which steps make which figures, and
// where the same resource serves several places at once. A tree cannot show
// the last of those without either duplicating a node or hiding an edge.
//
// WHY NOT vis-network, which the paper page already uses. Two reasons. It
// draws to a canvas, so nothing here could be asserted in a test and a screen
// reader gets nothing at all; and its force layout has no notion of "inputs
// on the left, figures on the right", which is exactly the reading a curator
// needs. This is a deterministic three-lane layout in SVG: same input, same
// picture, every time, and every node is a real element.
//
// The lanes are the ones the vocabulary already names -- `laneOf` maps an id
// prefix to INPUTS, PROCESS or OUTPUTS -- so this drawing and the rest of the
// product cannot drift apart about which side something belongs on.

const LANES = [
  { key: INPUTS, label: "Inputs" },
  { key: PROCESS, label: "Process" },
  { key: OUTPUTS, label: "Figures" },
];

const NODE_W = 150;
const NODE_H = 40;
const GAP_X = 90;
const GAP_Y = 14;
const PAD = 12;
const HEAD = 20;

/** Where every node sits, and how big the drawing has to be. */
export const layoutLanes = (ids, byId, name) => {
  const columns = LANES.map(({ key, label }) => ({
    key,
    label,
    ids: (ids || []).filter((id) => laneOf(id) === key).sort(),
  }));

  const tallest = Math.max(1, ...columns.map((column) => column.ids.length));
  const nodes = {};
  columns.forEach((column, index) => {
    const x = PAD + index * (NODE_W + GAP_X);
    // Centre a short lane against the tallest one, so the flow reads across
    // rather than sinking to the top-left.
    const offset = ((tallest - column.ids.length) * (NODE_H + GAP_Y)) / 2;
    column.ids.forEach((id, row) => {
      nodes[id] = {
        id,
        x,
        y: HEAD + PAD + offset + row * (NODE_H + GAP_Y),
        w: NODE_W,
        h: NODE_H,
        text: name(id),
      };
    });
  });

  return {
    columns,
    nodes,
    width: PAD * 2 + columns.length * NODE_W + (columns.length - 1) * GAP_X,
    height: HEAD + PAD * 2 + tallest * (NODE_H + GAP_Y),
  };
};

/**
 * The path from one node to another.
 *
 * A forward edge leaves the right side and arrives on the left. A BACK EDGE
 * -- one that returns to an earlier lane, which is what a feedback loop looks
 * like -- is routed underneath instead, so it cannot be mistaken for ordinary
 * flow simply by being drawn on top of it.
 */
export const edgePath = (from, to, back) => {
  if (back) {
    const startX = from.x;
    const startY = from.y + from.h / 2;
    const endX = to.x + to.w;
    const endY = to.y + to.h / 2;
    const dip = Math.max(startY, endY) + from.h;
    return `M ${startX} ${startY} C ${startX - 40} ${dip}, ${endX + 40} ${dip}, ${endX} ${endY}`;
  }
  const startX = from.x + from.w;
  const startY = from.y + from.h / 2;
  const endX = to.x;
  const endY = to.y + to.h / 2;
  const mid = (startX + endX) / 2;
  return `M ${startX} ${startY} C ${mid} ${startY}, ${mid} ${endY}, ${endX} ${endY}`;
};

const WorkflowLanes = ({ ids, byId, edges, name, onPick, active }) => {
  const { columns, nodes, width, height } = layoutLanes(ids, byId, name);
  const present = new Set(ids || []);

  const drawn = (edges || [])
    .map(fromStoredEdge)
    .filter((edge) => present.has(edge.from) && present.has(edge.to))
    .map((edge) => {
      const from = nodes[edge.from];
      const to = nodes[edge.to];
      if (!from || !to) return null;
      // The curator's own answer, read back from the edge -- not a guess
      // from the shape of the graph as it stands right now.
      const loop = Boolean(edge.feedback);
      const undirected = UNDIRECTED.includes(edge.type);
      return {
        ...edge,
        from,
        to,
        loop,
        undirected,
        // A back edge is one that returns to a lane it already left.
        back: to.x <= from.x && !undirected,
      };
    })
    .filter(Boolean);

  return (
    <Box sx={{ width: "100%", overflow: "hidden" }} data-testid="fw-lanes">
      <Box
        component="svg"
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label="Workflow diagram"
        sx={{ width: "100%", height: "auto", display: "block" }}
      >
        <defs>
          <marker
            id="fw-arrow"
            viewBox="0 0 8 8"
            refX="7"
            refY="4"
            markerWidth="7"
            markerHeight="7"
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 8 4 L 0 8 z" fill="currentColor" />
          </marker>
        </defs>

        {columns.map((column, index) => (
          <text
            key={column.key}
            x={PAD + index * (NODE_W + GAP_X)}
            y={HEAD - 6}
            fontSize="11"
            fill="currentColor"
            opacity="0.6"
          >
            {column.label}
          </text>
        ))}

        {drawn.map((edge) => (
          <Fragment key={`${edge.from.id}->${edge.to.id}-${edge.type}`}>
            <Box
              component="path"
              d={edgePath(edge.from, edge.to, edge.back)}
              fill="none"
              markerEnd={edge.undirected ? undefined : "url(#fw-arrow)"}
              markerStart={edge.undirected ? "url(#fw-arrow)" : undefined}
              data-testid={`fw-lane-edge-${edge.from.id}-${edge.to.id}`}
              data-loop={String(edge.loop)}
              data-undirected={String(edge.undirected)}
              sx={(theme) => ({
                // A feedback loop is DRAWN differently, because one that looks
                // like ordinary flow reads as a mistake in the picture rather
                // than a claim about the work.
                stroke: edge.loop
                  ? theme.palette.warning.main
                  : theme.palette.text.disabled,
                strokeWidth: edge.loop ? 2 : 1.5,
                strokeDasharray: edge.loop ? "5 3" : undefined,
                color: edge.loop
                  ? theme.palette.warning.main
                  : theme.palette.text.disabled,
              })}
            >
              <title>
                {`${name(edge.from.id)} ${
                  edge.undirected ? "↔" : "→"
                } ${EDGE_VERB[edge.type] || "connects to"} ${
                  edge.undirected ? "↔" : "→"
                } ${name(edge.to.id)}${edge.loop ? " (feedback loop)" : ""}`}
              </title>
            </Box>
          </Fragment>
        ))}

        {Object.values(nodes).map((node) => (
          <Box
            component="g"
            key={node.id}
            role="button"
            tabIndex={0}
            aria-label={node.text}
            data-testid={`fw-lane-node-${node.id}`}
            onClick={() => onPick && onPick(node.id)}
            onKeyDown={(event) => {
              if (onPick && (event.key === "Enter" || event.key === " ")) {
                event.preventDefault();
                onPick(node.id);
              }
            }}
            sx={{ cursor: onPick ? "pointer" : "default" }}
          >
            <Box
              component="rect"
              x={node.x}
              y={node.y}
              width={node.w}
              height={node.h}
              rx="4"
              sx={(theme) => ({
                fill:
                  active === node.id
                    ? theme.palette.action.selected
                    : theme.palette.background.paper,
                stroke:
                  prefixOf(node.id) === CHART
                    ? theme.palette.primary.main
                    : theme.palette.divider,
                strokeWidth: prefixOf(node.id) === CHART ? 2 : 1,
              })}
            />
            <Box
              component="text"
              x={node.x + 8}
              y={node.y + node.h / 2 + 4}
              fontSize="11"
              sx={(theme) => ({ fill: theme.palette.text.primary })}
            >
              {node.text.length > 20 ? `${node.text.slice(0, 19)}…` : node.text}
            </Box>
          </Box>
        ))}
      </Box>

      <Typography variant="caption" color="text.secondary" display="block">
        Inputs on the left, what was run in the middle, figures on the right.
        {drawn.some((edge) => edge.loop)
          ? " A dashed line is a feedback loop."
          : ""}
      </Typography>
    </Box>
  );
};

WorkflowLanes.propTypes = {
  ids: PropTypes.array.isRequired,
  byId: PropTypes.object.isRequired,
  edges: PropTypes.array.isRequired,
  name: PropTypes.func.isRequired,
  onPick: PropTypes.func,
  active: PropTypes.string,
};

export default WorkflowLanes;
