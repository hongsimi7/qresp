import PropTypes from "prop-types";

import { Box } from "@mui/material";

import {
  EDGE_VERB,
  UNDIRECTED,
  fromStoredEdge,
  prefixOf,
} from "../../Utils/workflowGraph";

// ONE PIECE OF WORK, DRAWN.
//
// The picture shows the SHAPE of the work: which things led to which, and
// where one resource serves several places at once. A tree cannot show the
// last of those without either duplicating a node or hiding an edge.
//
// NO TYPE LANES. An earlier version put datasets on the left, scripts in the
// middle and figures on the right, which quietly asserted that research runs
// one way. It does not: a script writes a dataset, a figure is built from
// another figure. Position now comes from the ARROWS the curator drew -- how
// far along the flow a node sits -- and from nothing else.
//
// NO RELATIONSHIP WORDS ON SCREEN. A node shows its kind and its name; an
// edge shows an arrowhead. The words live in `aria-label` and `<title>`, for
// readers who cannot see the arrow.
//
// WHY NOT vis-network, which the paper page uses: it draws to a canvas, so
// nothing here could be asserted in a test and a screen reader gets nothing
// at all. This is deterministic SVG -- same input, same picture, and every
// node is a real element.

const NODE_W = 154;
const NODE_H = 38;
const GAP_X = 76;
const GAP_Y = 14;
const PAD = 10;
const CHIP_W = 52;

const KIND_SHORT = { c: "Figure", s: "Script", d: "Data", t: "Tool", h: "Ext" };

/**
 * Where every node sits.
 *
 * Depth is "how far along the arrows this node is": a node with nothing
 * pointing at it starts at zero, and every arrow pushes its target one
 * column further right. Relaxed a bounded number of times, so a feedback
 * loop settles instead of running forever.
 */
export const layoutGraph = (ids, edges, name) => {
  const members = (ids || []).slice().sort();
  const present = new Set(members);
  const flows = (edges || [])
    .map(fromStoredEdge)
    .filter((edge) => !UNDIRECTED.includes(edge.type))
    .filter((edge) => present.has(edge.from) && present.has(edge.to));

  const depth = {};
  members.forEach((id) => {
    depth[id] = 0;
  });
  for (let pass = 0; pass < members.length; pass += 1) {
    let moved = false;
    flows.forEach(({ from, to }) => {
      if (depth[to] < depth[from] + 1) {
        depth[to] = depth[from] + 1;
        moved = true;
      }
    });
    if (!moved) break;
  }

  const columns = [];
  members.forEach((id) => {
    const column = depth[id];
    if (!columns[column]) columns[column] = [];
    columns[column].push(id);
  });

  const filled = columns.filter(Boolean);
  const tallest = Math.max(1, ...filled.map((column) => column.length));
  const nodes = {};
  let index = 0;
  columns.forEach((column) => {
    if (!column) return;
    const x = PAD + index * (NODE_W + GAP_X);
    const offset = ((tallest - column.length) * (NODE_H + GAP_Y)) / 2;
    column.forEach((id, row) => {
      nodes[id] = {
        id,
        x,
        y: PAD + offset + row * (NODE_H + GAP_Y),
        w: NODE_W,
        h: NODE_H,
        text: name(id),
        kind: KIND_SHORT[prefixOf(id)] || "Item",
      };
    });
    index += 1;
  });

  const wide = Math.max(1, filled.length);
  return {
    nodes,
    width: PAD * 2 + wide * NODE_W + (wide - 1) * GAP_X,
    height: PAD * 2 + tallest * (NODE_H + GAP_Y),
  };
};

/**
 * The line from one node to another.
 *
 * THE STORED DIRECTION DECIDES THE ARROWHEAD, never the position on screen.
 * A target that happens to sit to the LEFT still gets the arrowhead, so the
 * picture cannot contradict the record.
 */
export const edgePath = (from, to) => {
  const forward = to.x >= from.x;
  const startX = forward ? from.x + from.w : from.x;
  const endX = forward ? to.x : to.x + to.w;
  const startY = from.y + from.h / 2;
  const endY = to.y + to.h / 2;
  if (Math.abs(to.x - from.x) < 1) {
    // Same column: bow out to the side, or the line hides behind the nodes
    // it runs between.
    const bulge = Math.max(startX, endX) + 46;
    return `M ${startX} ${startY} C ${bulge} ${startY}, ${bulge} ${endY}, ${endX} ${endY}`;
  }
  const mid = (startX + endX) / 2;
  return `M ${startX} ${startY} C ${mid} ${startY}, ${mid} ${endY}, ${endX} ${endY}`;
};

const WorkflowLanes = ({ ids, edges, name, onPick, active }) => {
  const { nodes, width, height } = layoutGraph(ids, edges, name);
  const present = new Set(ids || []);

  const drawn = (edges || [])
    .map(fromStoredEdge)
    .filter((edge) => present.has(edge.from) && present.has(edge.to))
    .map((edge) => {
      const from = nodes[edge.from];
      const to = nodes[edge.to];
      if (!from || !to) return null;
      return {
        ...edge,
        fromNode: from,
        toNode: to,
        // The curator's own answer, read back from the edge -- not a guess
        // from the shape of the graph as it stands right now.
        loop: Boolean(edge.feedback),
        undirected: UNDIRECTED.includes(edge.type),
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

        {drawn.map((edge) => (
          <Box
            component="path"
            key={`${edge.from}->${edge.to}-${edge.type}`}
            d={edgePath(edge.fromNode, edge.toNode)}
            fill="none"
            markerEnd="url(#fw-arrow)"
            markerStart={edge.undirected ? "url(#fw-arrow)" : undefined}
            data-testid={`fw-lane-edge-${edge.from}-${edge.to}`}
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
            {/* Words for a reader who cannot see the arrow, and nowhere else. */}
            <title>
              {`${name(edge.from)} ${
                EDGE_VERB[edge.type] || "connects to"
              } ${name(edge.to)}${edge.loop ? " (feedback loop)" : ""}`}
            </title>
          </Box>
        ))}

        {Object.values(nodes).map((node) => (
          <Box
            component="g"
            key={node.id}
            role="button"
            tabIndex={0}
            aria-label={`${node.kind} ${node.text}`}
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
                stroke: theme.palette.divider,
                strokeWidth: 1,
              })}
            />
            {/* The kind, said once, as a chip rather than a sentence. */}
            <Box
              component="rect"
              x={node.x + 6}
              y={node.y + 9}
              width={CHIP_W}
              height={20}
              rx="10"
              sx={(theme) => ({
                fill: theme.palette.action.hover,
                stroke: theme.palette.divider,
                strokeWidth: 1,
              })}
            />
            <Box
              component="text"
              x={node.x + 6 + CHIP_W / 2}
              y={node.y + 23}
              textAnchor="middle"
              fontSize="10"
              sx={(theme) => ({ fill: theme.palette.text.secondary })}
            >
              {node.kind}
            </Box>
            <Box
              component="text"
              x={node.x + CHIP_W + 14}
              y={node.y + 23}
              fontSize="11"
              sx={(theme) => ({ fill: theme.palette.text.primary })}
            >
              {node.text.length > 14 ? `${node.text.slice(0, 13)}…` : node.text}
            </Box>
          </Box>
        ))}
      </Box>
    </Box>
  );
};

WorkflowLanes.propTypes = {
  ids: PropTypes.array.isRequired,
  edges: PropTypes.array.isRequired,
  name: PropTypes.func.isRequired,
  onPick: PropTypes.func,
  active: PropTypes.string,
};

export default WorkflowLanes;
