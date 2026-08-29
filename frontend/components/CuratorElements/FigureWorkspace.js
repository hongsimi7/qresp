import { Fragment, useContext, useEffect, useMemo, useRef, useState } from "react";

import {
  Alert,
  Box,
  Button,
  Chip,
  Checkbox,
  Collapse,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  Menu,
  MenuItem,
  Typography,
} from "@mui/material";
import { ExpandMore } from "@mui/icons-material";

import Drawer from "../drawer";
import { RegularStyledButton } from "../button";
import ChartsInfoForm from "../CuratorForms/ChartsInfoForm";
import ScriptsInfoForm from "../CuratorForms/ScriptsInfoForm";
import DatasetsInfoForm from "../CuratorForms/DatasetsInfoForm";
import ToolsInfoForm from "../CuratorForms/ToolsInfoForm";
import FolderAnalysis from "./FolderAnalysis";

import CuratorContext from "../../Context/Curator/curatorContext";
import CuratorHelperContext from "../../Context/CuratorHelpers/curatorHelperContext";
import { displayUrl, externalLabel, noteFor } from "../../Utils/externalData";
import {
  CHART,
  CONSUMES,
  DATASET,
  EXTERNAL,
  GENERATES,
  SCRIPT,
  TOOL,
  USES_TOOL,
  fromStoredEdge,
  EDGE_GROUP,
  EDGE_VERB,
  FEEDS_INTO,
  edgeProblem,
  hasEdge,
  inferEdgeType,
  prefixOf,
} from "../../Utils/workflowGraph";
import {
  describeSuggestion,
  suggestConnections,
  suggestionKey,
} from "../../Utils/workflowSuggestions";

// ONE place to organise a paper's figures and the resources behind them.
//
// It replaces four separate top-level sections -- Add Charts, Add Tools, Add
// Datasets, Add Scripts -- that asked a curator to think in Qresp's storage
// categories and then, separately, to connect them. Nobody curating a paper
// thinks that way. They think: here is a figure; this script made it; it used
// this data and these tools.
//
// So the figure is the root, and everything else hangs off the question it
// answers. The four artifact MODELS are untouched -- a Figure is the existing
// Chart, and every form opened here is the existing form with its existing
// validation. Only the way in is different.
//
// WHAT A CONTEXTUAL BUTTON DOES. It remembers what the new artifact should be
// attached to, then opens the real form. When the form saves and the artifact
// appears, the edge is created from what the two things ARE -- see
// `inferEdgeType`. Cancel saves nothing, so nothing is attached to nothing.

const KIND_LABEL = {
  [CHART]: "Figure",
  [SCRIPT]: "Script",
  [DATASET]: "Dataset",
  [TOOL]: "Tool",
  [EXTERNAL]: "External data",
};

const TYPE_BY_PREFIX = {
  [CHART]: "chart",
  [SCRIPT]: "script",
  [DATASET]: "dataset",
  [TOOL]: "tool",
  [EXTERNAL]: "head",
};

const LIST_BY_TYPE = {
  chart: "charts",
  script: "scripts",
  dataset: "datasets",
  tool: "tools",
  head: "heads",
};

/** What a row is CALLED. Never a bare id, never an empty chip. */
export const rowLabel = (artifact, id) => {
  if (prefixOf(id) === EXTERNAL) return externalLabel(artifact, id);
  const named =
    (artifact &&
      (artifact.caption ||
        artifact.packageName ||
        artifact.programName ||
        artifact.facilityName ||
        artifact.readme)) ||
    "";
  const text = String(named).replace(/\s+/g, " ").trim();
  if (text) return text.length > 60 ? `${text.slice(0, 59)}…` : text;
  return `Untitled ${KIND_LABEL[prefixOf(id)] || "item"} (${id})`;
};

// The kinds a curator can start from, in the order the page offers them.
//
// A figure is FIRST and stays visually primary, because a Qresp record is
// organised by its figures. But it is not the only way in: plenty of papers
// hold a dataset or a tool that produced no figure, and the previous layout
// left those reachable only through a row at the very bottom of the page.
const STARTABLE = [
  { type: "script", label: "Script" },
  { type: "dataset", label: "Dataset" },
  { type: "tool", label: "Tool" },
  { type: "head", label: "External data" },
];

// The four types the RCC importer can actually propose. It always could --
// `FolderAnalysis` has had a typed mode for each of them -- but only the
// chart one was ever mounted, so three of the four were unreachable.
const IMPORTABLE = [
  { type: "chart", label: "Figures" },
  { type: "dataset", label: "Datasets" },
  { type: "script", label: "Scripts" },
  { type: "tool", label: "Tools" },
];

// What kind of thing a row is, said once, quietly.
//
// Every row used to be the same maroon text at the same size, so a Script, a
// Dataset and a Tool were told apart only by reading their names. A small
// neutral marker in a fixed column makes the kinds scannable without adding
// another colour to the page.
const KindChip = ({ id }) => (
  <Chip
    label={KIND_LABEL[prefixOf(id)] || "Item"}
    size="small"
    variant="outlined"
    sx={{
      height: 20,
      flexShrink: 0,
      borderColor: "divider",
      color: "text.secondary",
      "& .MuiChip-label": { px: 0.75, fontSize: 11 },
    }}
  />
);

// Row-level actions are TEXT, not filled buttons.
//
// A figure with a script, two inputs and a tool carries eight or nine
// actions; rendered as filled buttons they become a wall of maroon that
// hides the thing the curator came to read -- the names of their own
// artifacts. Text keeps the tree scannable and the actions still one tap
// away. The one filled button on the page is the primary way in.
const RowAction = ({ children, ...rest }) => (
  <Button size="small" variant="text" sx={{ minWidth: 0, px: 0.75 }} {...rest}>
    {children}
  </Button>
);

const FigureWorkspace = () => {
  const {
    charts, scripts, datasets, tools, heads,
    fileServerPath, workflow, addEdge, unlink, del,
  } = useContext(CuratorContext);
  const {
    openForm, setDefault, setExternalNodeFormOpen,
  } = useContext(CuratorHelperContext) || {};

  const [notice, setNotice] = useState("");
  // Which row's "Add new" / overflow menu is open, and which shared node was
  // last jumped to from a reference row.
  const [addAnchor, setAddAnchor] = useState({ id: "", el: null });
  const [moreAnchor, setMoreAnchor] = useState({ id: "", parentId: "", el: null });
  const [highlight, setHighlight] = useState("");
  // Which artifact's connection dialog is open, and what is ticked in it.
  const [connectFor, setConnectFor] = useState("");
  const [picked, setPicked] = useState({});
  const [suggestFor, setSuggestFor] = useState("");

  // The RCC import menu, and which typed importer it opened. `nonce` remounts
  // the importer so choosing the same type twice opens it again rather than
  // doing nothing the second time.
  const [rccAnchor, setRccAnchor] = useState(null);
  const [rccImport, setRccImport] = useState({ type: "", nonce: 0 });
  const canImport = Boolean(String(fileServerPath || "").trim());

  // Suggestions the curator has waved away THIS SESSION. Local state, keyed
  // by what the suggestion is about rather than by the ids involved -- see
  // `suggestionKey`. Nothing here is saved, sent, or remembered past this
  // editing session, because "not now" is not a fact about the paper.
  const [dismissed, setDismissed] = useState({});

  // What the next saved artifact should be attached to. Set before the form
  // opens; consumed when the artifact actually appears.
  const pending = useRef(null);

  const byId = useMemo(() => {
    const map = {};
    [charts, scripts, datasets, tools, heads].forEach((list) =>
      (list || []).forEach((item) => {
        if (item && item.id) map[item.id] = item;
      })
    );
    return map;
  }, [charts, scripts, datasets, tools, heads]);

  const knownIds = useMemo(() => Object.keys(byId), [byId]);
  const edges = (workflow && workflow.edges) || [];

  // THE POST-SAVE LINK.
  //
  // The forms create the artifact themselves, so the edge cannot be made at
  // click time -- the id does not exist yet. This watches for the artifact a
  // contextual button was waiting for and connects it once it is really
  // there. A cancelled form adds nothing, so nothing fires.
  const listLengths = [charts, scripts, datasets, tools, heads]
    .map((list) => (list || []).length)
    .join(",");
  useEffect(() => {
    const request = pending.current;
    if (!request) return;
    const list = (
      { charts, scripts, datasets, tools, heads }[LIST_BY_TYPE[request.type]] ||
      []
    );
    if (list.length <= request.before) return;      // nothing saved yet
    const created = list[list.length - 1];
    pending.current = null;
    if (!created || !created.id || !request.target) return;

    const forward = inferEdgeType(created.id, request.target);
    const backward = inferEdgeType(request.target, created.id);
    const edge = forward
      ? { from: created.id, to: request.target, type: forward }
      : backward
      ? { from: request.target, to: created.id, type: backward }
      : null;
    if (edge && !hasEdge(edges, edge.from, edge.to)) addEdge(edge);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listLengths]);

  /** Open the real form for a NEW artifact, remembering what to attach it to. */
  const createAttachedTo = (type, targetId) => {
    setNotice("");
    const list = { charts, scripts, datasets, tools, heads }[LIST_BY_TYPE[type]] || [];
    pending.current = { type, target: targetId || "", before: list.length };
    if (!setDefault) return;
    setDefault(type, null);
    if (type === "head") {
      if (setExternalNodeFormOpen) setExternalNodeFormOpen(true);
      return;
    }
    if (openForm) openForm(type);
  };

  /** Open the real form for an EXISTING artifact. */
  const editArtifact = (id) => {
    const artifact = byId[id];
    if (!artifact || !setDefault) return;
    const type = TYPE_BY_PREFIX[prefixOf(id)];
    setDefault(type, artifact);
    if (type === "head") {
      if (setExternalNodeFormOpen) setExternalNodeFormOpen(true);
      return;
    }
    if (openForm) openForm(type);
  };

  const removeArtifact = (id) => {
    if (del) del(TYPE_BY_PREFIX[prefixOf(id)], id);
  };

  // Recomputed from the CURRENT artifacts every time they change. Holding a
  // suggestion across an edit would let it keep naming an id whose artifact
  // has since been deleted or renumbered.
  const suggestions = useMemo(
    () =>
      suggestConnections({ charts, scripts, datasets, tools, heads }, edges),
    [charts, scripts, datasets, tools, heads, edges]
  );

  const suggestionsFor = (id) =>
    suggestions.filter(
      (item) => item.to === id && !dismissed[suggestionKey(item)]
    );

  /**
   * Accept one suggestion.
   *
   * It goes through the same guard the manual paths use rather than trusting
   * the suggestion it was handed: between rendering and clicking, the curator
   * may have made this very connection by hand.
   */
  const acceptSuggestion = (item) => {
    setNotice("");
    if (hasEdge(edges, item.from, item.to)) return;
    addEdge({ from: item.from, to: item.to, type: item.type });
  };

  const dismissSuggestion = (item) =>
    setDismissed((was) => ({ ...was, [suggestionKey(item)]: true }));

  const incoming = (id) =>
    edges.map(fromStoredEdge).filter((edge) => edge.to === id);
  const outgoing = (id) =>
    edges.map(fromStoredEdge).filter((edge) => edge.from === id);

  // ---- THE OUTLINE -------------------------------------------------------

  // What hangs under a node, and in what order. A figure is a result, so
  // everything below it is what went into it.
  const CHILD_RULES = {
    [CHART]: [GENERATES, CONSUMES, FEEDS_INTO],
    [SCRIPT]: [USES_TOOL, CONSUMES, FEEDS_INTO],
    // Every kind can be built from an earlier one of its own kind, so every
    // kind can have children. Without this a derived dataset was reachable
    // from nothing and fell out of the outline entirely.
    [DATASET]: [FEEDS_INTO],
    [TOOL]: [FEEDS_INTO],
    [EXTERNAL]: [FEEDS_INTO],
  };

  // `feeds_into` means one thing, but a heading reads better in the words of
  // the kind it sits above.
  const SAME_KIND_GROUP = {
    [SCRIPT]: "Receives from script",
    [CHART]: "Built from figure",
    [DATASET]: "Derived from dataset",
    [TOOL]: "Built on tool",
    [EXTERNAL]: "Derived from external data",
  };

  const NEW_TYPES = [
    { type: "chart", label: "Figure", probe: `${CHART}?` },
    { type: "script", label: "Script", probe: `${SCRIPT}?` },
    { type: "dataset", label: "Dataset", probe: `${DATASET}?` },
    { type: "tool", label: "Tool", probe: `${TOOL}?` },
    { type: "head", label: "External data", probe: `${EXTERNAL}?` },
  ];

  /** The kinds it would be legal to create attached to `id`. */
  const addableTo = (id) =>
    NEW_TYPES.filter(
      ({ probe }) =>
        Boolean(inferEdgeType(id, probe)) || Boolean(inferEdgeType(probe, id))
    );

  const anchorOf = (id) => `fw-anchor-${id}`;
  const label = (id) => rowLabel(byId[id], id);
  const named = (id) => `${KIND_LABEL[prefixOf(id)] || "Item"}: ${label(id)}`;

  /** `A → verb → B`, so the direction is in the sentence, not the indent. */
  const sentence = (edge) =>
    `${label(edge.from)} → ${EDGE_VERB[edge.type] || "connects to"} → ${label(
      edge.to
    )}`;

  const figureIds = knownIds.filter((id) => prefixOf(id) === CHART).sort();

  /**
   * The outline.
   *
   * A workflow is a GRAPH, not a tree: one script generates three figures,
   * one dataset feeds five scripts. Drawing it as a tree therefore has to
   * answer what happens when the same artifact is reached twice, and "draw
   * it again, fully editable" is the wrong answer -- a curator editing the
   * second copy has no way to know it is the same thing they already have.
   *
   * So an artifact is a REAL NODE exactly once, where the outline first
   * reaches it, and every later arrival is a reference back to that one.
   * Nothing is duplicated in the data, and nothing is duplicated on screen.
   */
  const buildOutline = () => {
    const placed = new Set();
    const build = (id, parentId, type) => {
      const first = !placed.has(id);
      const node = { id, parentId, type, first, groups: [] };
      if (!first) return node;
      placed.add(id);
      [...(CHILD_RULES[prefixOf(id)] || []), ""].forEach((relation) => {
        const kids = incoming(id)
          .filter((edge) => (relation ? edge.type === relation : !edge.type))
          .map((edge) => build(edge.from, id, relation));
        if (kids.length) node.groups.push({ type: relation, nodes: kids });
      });
      return node;
    };
    const roots = figureIds.map((id) => build(id, "", ""));

    // A workflow does not have to end at a figure yet. Two scripts joined to
    // each other, or a dataset feeding a script, are real work in progress
    // and reachable from no figure at all -- rendering only figure-rooted
    // trees made them vanish from the page while still being in the record.
    const stranded = [];
    const connected = (id) => incoming(id).length || outgoing(id).length;
    let left = knownIds.filter((id) => !placed.has(id) && connected(id));
    while (left.length) {
      // Prefer a node nothing else here feeds into, so the subgraph reads
      // downstream-first like the figures do. A cycle has no such node, and
      // then any member will do -- what matters is that it gets on screen.
      const sink =
        left.find((id) => !outgoing(id).some((edge) => !placed.has(edge.to))) ||
        left[0];
      stranded.push(build(sink, "", ""));
      left = left.filter((id) => !placed.has(id));
    }

    return { roots, stranded };
  };

  const { roots: outline, stranded } = buildOutline();

  /** Everything this artifact feeds, so a shared one can say so. */
  const servesOf = (id) => outgoing(id).map((edge) => edge.to);

  // ---- LINKING -----------------------------------------------------------

  /**
   * Every link that could be made from `id`, as the EDGE it would create.
   *
   * Candidates are edges rather than artifacts because one pair can hold a
   * relationship each way: `preprocess.py feeds into plot.py` and
   * `plot.py feeds into preprocess.py` are different claims, so they are
   * different rows and the curator picks the one they mean.
   *
   * A pair that can hold no relationship never appears. Neither does one
   * that would close a loop -- that is not a choice worth offering. What
   * IS kept is a link that already exists, shown as made, because hiding it
   * would leave a curator hunting for a resource that is already attached.
   */
  const linkCandidates = (id) => {
    const seen = new Set();
    const found = [];
    knownIds
      .filter((other) => other !== id)
      .forEach((other) => {
        [
          [id, other],
          [other, id],
        ].forEach(([from, to]) => {
          const type = inferEdgeType(from, to);
          if (!type) return;
          const key = `${from}-${to}`;
          if (seen.has(key)) return;
          const edge = { from, to, type };
          const linked = hasEdge(edges, from, to);
          if (!linked && edgeProblem(edge, knownIds, edges)) return;
          seen.add(key);
          found.push({ key, edge, other, linked });
        });
      });
    return found;
  };

  const openLink = (id) => {
    setNotice("");
    setPicked({});
    setConnectFor(id);
  };

  const closeLink = () => {
    setConnectFor("");
    setPicked({});
  };

  /**
   * Make every ticked link.
   *
   * One resource legitimately serves many others, and NOTHING IS COPIED to
   * do it: each tick adds an edge to the artifact already in the draft.
   * Each is re-checked against the links accepted earlier in this same
   * batch, so two ticks cannot combine into a loop.
   */
  const linkSelected = () => {
    const running = edges.slice();
    let made = 0;
    linkCandidates(connectFor).forEach((option) => {
      if (!picked[option.key] || option.linked) return;
      if (hasEdge(running, option.edge.from, option.edge.to)) return;
      if (edgeProblem(option.edge, knownIds, running)) return;
      addEdge(option.edge);
      running.push(option.edge);
      made += 1;
    });
    if (!made) setNotice("Nothing was selected, so nothing was linked.");
    closeLink();
  };

  // ---- ROW FURNITURE -----------------------------------------------------

  const KindChip = ({ id }) => (
    <Chip
      label={KIND_LABEL[prefixOf(id)] || "Item"}
      size="small"
      variant="outlined"
      sx={{
        height: 20,
        flexShrink: 0,
        borderColor: "divider",
        color: "text.secondary",
        "& .MuiChip-label": { px: 0.75, fontSize: 11 },
      }}
    />
  );

  /**
   * The two things a curator does to a row, and nothing else.
   *
   * Edit and Remove moved into the overflow because they are rarer than
   * linking and were pushing the names and relationships -- the things the
   * outline exists to show -- off the end of the line.
   */
  const RowActions = ({ node }) => {
    const { id, parentId } = node;
    const addable = addableTo(id);
    return (
      <Box sx={{ display: "flex", flexShrink: 0, alignItems: "center" }}>
        <RowAction onClick={() => openLink(id)} data-testid={`fw-link-${id}`}>
          Link existing
        </RowAction>
        {addable.length ? (
          <RowAction
            onClick={(event) => setAddAnchor({ id, el: event.currentTarget })}
            aria-haspopup="menu"
            data-testid={`fw-add-${id}`}
          >
            Add new
          </RowAction>
        ) : null}
        <RowAction
          onClick={(event) => setMoreAnchor({ id, parentId, el: event.currentTarget })}
          aria-haspopup="menu"
          aria-label={`More actions for ${label(id)}`}
          data-testid={`fw-more-${id}`}
        >
          ⋮
        </RowAction>
      </Box>
    );
  };

  const OutlineRow = ({ node, depth }) => {
    const { id, parentId, type, first } = node;
    const edge = parentId ? { from: id, to: parentId, type } : null;
    const serves = first ? servesOf(id) : [];
    return (
      <Box
        sx={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "flex-start",
          gap: 0.75,
          minWidth: 0,
          py: 0.25,
        }}
      >
        <Box
          sx={{
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            gap: 0.75,
            minWidth: 0,
            flex: { xs: "1 1 100%", sm: "1 1 auto" },
          }}
        >
          <KindChip id={id} />
          <Typography
            variant={depth ? "body2" : "subtitle2"}
            component="span"
            sx={{ overflowWrap: "anywhere", minWidth: 0 }}
          >
            {label(id)}
          </Typography>
          {edge ? (
            <Typography
              variant="caption"
              color="text.secondary"
              component="span"
              sx={{ overflowWrap: "anywhere" }}
              data-testid={`fw-flow-${id}-${parentId}`}
            >
              {sentence(edge)}
            </Typography>
          ) : null}
          {serves.length > 1 ? (
            <Typography
              variant="caption"
              color="text.secondary"
              component="span"
              data-testid={`fw-shared-${id}`}
            >
              {`Also used by ${serves.length - 1} more`}
            </Typography>
          ) : null}
        </Box>
        {first ? (
          <RowActions node={node} />
        ) : (
          <Box sx={{ display: "flex", flexShrink: 0, alignItems: "center" }}>
            <RowAction
              onClick={() => {
                const target = document.getElementById(anchorOf(id));
                if (target && target.scrollIntoView) {
                  target.scrollIntoView({ block: "center" });
                }
                setHighlight(id);
              }}
              data-target={anchorOf(id)}
              data-testid={`fw-goto-${id}-${parentId}`}
            >
              Go to
            </RowAction>
          </Box>
        )}
      </Box>
    );
  };

  const OutlineNode = ({ node, depth = 0 }) => (
    <Box
      component="li"
      id={node.first ? anchorOf(node.id) : undefined}
      data-testid={
        node.first
          ? `fw-node-${node.id}`
          : `fw-ref-${node.id}-${node.parentId}`
      }
      sx={{
        minWidth: 0,
        ...(highlight === node.id && node.first
          ? { bgcolor: "action.selected", borderRadius: 1 }
          : null),
      }}
    >
      <OutlineRow node={node} depth={depth} />
      {node.first ? null : (
        <Typography
          variant="caption"
          color="text.secondary"
          display="block"
          sx={{ pl: 1 }}
        >
          Shown in full elsewhere in this outline.
        </Typography>
      )}
      {node.first && prefixOf(node.id) === EXTERNAL ? (
        <Box sx={{ pl: 1, minWidth: 0 }}>
          {displayUrl(byId[node.id]) ? (
            <Typography
              variant="caption"
              component="a"
              href={displayUrl(byId[node.id])}
              target="_blank"
              rel="noopener noreferrer"
              data-testid={`fw-url-${node.id}`}
              sx={{ display: "block", overflowWrap: "anywhere" }}
            >
              {displayUrl(byId[node.id])}
            </Typography>
          ) : null}
          {noteFor(byId[node.id]) ? (
            <Typography
              variant="caption"
              color="text.secondary"
              display="block"
              data-testid={`fw-note-${node.id}`}
              sx={{ overflowWrap: "anywhere" }}
            >
              {noteFor(byId[node.id])}
            </Typography>
          ) : null}
        </Box>
      ) : null}
      {node.groups.map((group) => (
        <Box
          key={group.type || "legacy"}
          sx={{ ml: 1, pl: 1.5, borderLeft: 2, borderColor: "divider" }}
        >
          <Typography
            variant="caption"
            color="text.secondary"
            display="block"
            sx={{ mt: 0.25 }}
          >
            {(group.type === FEEDS_INTO
              ? SAME_KIND_GROUP[prefixOf(node.id)]
              : EDGE_GROUP[group.type]) || "Connected to"}
          </Typography>
          <Box component="ul" sx={{ listStyle: "none", m: 0, p: 0 }}>
            {group.nodes.map((child) => (
              <OutlineNode
                key={`${child.id}-${child.parentId}`}
                node={child}
                depth={depth + 1}
              />
            ))}
          </Box>
        </Box>
      ))}
      {node.first && !node.groups.length && prefixOf(node.id) === CHART ? (
        <Typography
          variant="caption"
          color="text.secondary"
          display="block"
          sx={{ ml: 1, pl: 1.5 }}
          data-testid={`fw-empty-${node.id}`}
        >
          No connected resources yet.
        </Typography>
      ) : null}
      {node.first && prefixOf(node.id) === CHART ? (
        <SuggestionPanel id={node.id} />
      ) : null}
    </Box>
  );

  const LinkDialog = () => {
    const id = connectFor;
    if (!id) return null;
    const options = linkCandidates(id);
    const open = options.filter((option) => !option.linked);

    return (
      <Dialog
        open
        onClose={closeLink}
        fullWidth
        maxWidth="sm"
        data-testid="fw-link-dialog"
      >
        <DialogTitle sx={{ overflowWrap: "anywhere", pb: 0.5 }}>
          Link existing
          <Typography
            variant="body2"
            color="text.secondary"
            sx={{ overflowWrap: "anywhere" }}
          >
            {`What existing resource belongs to “${named(id)}”?`}
          </Typography>
        </DialogTitle>
        <DialogContent dividers>
          {options.length ? (
            <Box component="ul" sx={{ listStyle: "none", m: 0, p: 0 }}>
              {options.map((option) => (
                <Box component="li" key={option.key} sx={{ minWidth: 0 }}>
                  <FormControlLabel
                    sx={{ alignItems: "flex-start", m: 0, py: 0.25 }}
                    control={
                      <Checkbox
                        size="small"
                        checked={option.linked || Boolean(picked[option.key])}
                        disabled={option.linked}
                        onChange={(event) =>
                          setPicked((was) => ({
                            ...was,
                            [option.key]: event.target.checked,
                          }))
                        }
                        slotProps={{
                          input: { "data-testid": `fw-link-option-${option.key}` },
                        }}
                      />
                    }
                    label={
                      <Box sx={{ minWidth: 0, py: 0.5 }}>
                        {/* The exact sentence this tick would create. */}
                        <Typography
                          variant="body2"
                          sx={{ overflowWrap: "anywhere" }}
                          data-testid={`fw-link-sentence-${option.key}`}
                        >
                          {`${named(option.edge.from)} → ${
                            EDGE_VERB[option.edge.type]
                          } → ${named(option.edge.to)}`}
                        </Typography>
                        {option.linked ? (
                          <Typography
                            variant="caption"
                            color="text.secondary"
                            display="block"
                          >
                            Already linked
                          </Typography>
                        ) : null}
                      </Box>
                    }
                  />
                </Box>
              ))}
            </Box>
          ) : (
            <Typography variant="body2" color="text.secondary">
              Nothing in this paper can be linked to this yet. Add a resource
              first, then link it here.
            </Typography>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={closeLink} data-testid="fw-link-cancel">
            Cancel
          </Button>
          <RegularStyledButton
            onClick={linkSelected}
            disabled={!open.length}
            data-testid="fw-link-apply"
          >
            Link selected
          </RegularStyledButton>
        </DialogActions>
      </Dialog>
    );
  };

  const SuggestionPanel = ({ id }) => {
    const items = suggestionsFor(id);
    if (!items.length) return null;
    const open = suggestFor === id;
    return (
      <Box sx={{ ml: 1, pl: 1.5, mt: 0.5 }} data-testid={`fw-suggestions-${id}`}>
        <RowAction
          onClick={() => setSuggestFor(open ? "" : id)}
          aria-expanded={open}
          data-testid={`fw-suggest-toggle-${id}`}
        >
          {`Suggested connections (${items.length})`}
        </RowAction>
        <Collapse in={open} unmountOnExit>
          <Box component="ul" sx={{ listStyle: "none", m: 0, mt: 0.5, p: 0 }}>
            {items.map((item) => (
              <Box
                component="li"
                key={suggestionKey(item)}
                sx={{ mb: 0.5, minWidth: 0 }}
              >
                <Typography
                  variant="caption"
                  component="span"
                  sx={{ overflowWrap: "anywhere" }}
                >
                  {describeSuggestion(item, (who) => label(who))}
                </Typography>{" "}
                <RowAction
                  onClick={() => acceptSuggestion(item)}
                  data-testid={`fw-suggest-connect-${item.from}-${item.to}`}
                >
                  Connect
                </RowAction>
                <RowAction
                  onClick={() => dismissSuggestion(item)}
                  data-testid={`fw-suggest-dismiss-${item.from}-${item.to}`}
                >
                  Not now
                </RowAction>
              </Box>
            ))}
          </Box>
        </Collapse>
      </Box>
    );
  };

  // Anything with no connection at all. Not hidden and not flagged: a
  // dataset that produced no figure is a normal thing for a paper to hold,
  // and a resource entered before the figure it belongs to is a normal way
  // to work.
  const unlinked = knownIds.filter(
    (id) => !incoming(id).length && !outgoing(id).length && prefixOf(id) !== CHART
  );

  return (
    <Drawer heading="Organize figures and resources" defaultOpen={true}>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
        Each figure, and what produced it. Nothing is saved until you save the
        record.
      </Typography>

      {/* ONE place to start anything.

          A figure is the primary action and looks it. The other four sit
          under it as quiet text, so they are visible from the first screen
          without competing with the thing most curators want first. */}
      <Box sx={{ mb: 2 }}>
        <Box
          sx={{ display: "flex", flexWrap: "wrap", gap: 1, alignItems: "center" }}
        >
          <RegularStyledButton
            onClick={() => createAttachedTo("chart", "")}
            data-testid="fw-add-figure"
          >
            + Add figure
          </RegularStyledButton>
          <Button
            variant="outlined"
            size="small"
            color="inherit"
            endIcon={<ExpandMore />}
            disabled={!canImport}
            onClick={(event) => setRccAnchor(event.currentTarget)}
            data-testid="fw-rcc-import"
            aria-haspopup="menu"
          >
            Import from RCC
          </Button>
        </Box>

        {/* A grey button with no explanation is a dead end. One line, and
            only when it applies -- this is not a place for help text. */}
        {canImport ? null : (
          <Typography
            variant="caption"
            color="text.secondary"
            display="block"
            sx={{ mt: 0.5 }}
            data-testid="fw-rcc-hint"
          >
            Choose a File Server Path above to import from RCC.
          </Typography>
        )}

        <Box sx={{ mt: 1, display: "flex", flexWrap: "wrap", alignItems: "center", gap: 0.5 }}>
          <Typography variant="caption" color="text.secondary" sx={{ mr: 0.5 }}>
            Add a resource
          </Typography>
          {STARTABLE.map(({ type, label: text }) => (
            <RowAction
              key={type}
              onClick={() => createAttachedTo(type, "")}
              data-testid={`fw-start-${type}`}
            >
              {`+ ${text}`}
            </RowAction>
          ))}
        </Box>
      </Box>

      {/* One menu, four typed importers. Mounted only once a type is chosen,
          and remounted per choice so it opens every time. */}
      <Menu
        open={Boolean(rccAnchor)}
        anchorEl={rccAnchor}
        onClose={() => setRccAnchor(null)}
        data-testid="fw-rcc-menu"
      >
        {IMPORTABLE.map(({ type, label: text }) => (
          <MenuItem
            key={type}
            data-testid={`fw-rcc-${type}`}
            onClick={() => {
              setRccAnchor(null);
              setRccImport((was) => ({ type, nonce: was.nonce + 1 }));
            }}
          >
            {text}
          </MenuItem>
        ))}
      </Menu>
      {rccImport.type ? (
        <FolderAnalysis
          key={`${rccImport.type}-${rccImport.nonce}`}
          artifactType={rccImport.type}
          hideTrigger
          autoOpen
        />
      ) : null}

      {/* Add new: only the kinds that can legally join this row. */}
      <Menu
        open={Boolean(addAnchor.el)}
        anchorEl={addAnchor.el}
        onClose={() => setAddAnchor({ id: "", el: null })}
        data-testid="fw-add-menu"
      >
        {(addAnchor.id ? addableTo(addAnchor.id) : []).map(({ type, label: text }) => (
          <MenuItem
            key={type}
            data-testid={`fw-add-${addAnchor.id}-${type}`}
            onClick={() => {
              const target = addAnchor.id;
              setAddAnchor({ id: "", el: null });
              createAttachedTo(type, target);
            }}
          >
            {text}
          </MenuItem>
        ))}
      </Menu>

      {/* The rarer actions, off the line the outline is there to show. */}
      <Menu
        open={Boolean(moreAnchor.el)}
        anchorEl={moreAnchor.el}
        onClose={() => setMoreAnchor({ id: "", parentId: "", el: null })}
        data-testid="fw-more-menu"
      >
        <MenuItem
          data-testid={`fw-edit-${moreAnchor.id}`}
          onClick={() => {
            const target = moreAnchor.id;
            setMoreAnchor({ id: "", parentId: "", el: null });
            editArtifact(target);
          }}
        >
          Edit
        </MenuItem>
        {moreAnchor.parentId ? (
          <MenuItem
            data-testid={`fw-unlink-${moreAnchor.id}-${moreAnchor.parentId}`}
            onClick={() => {
              const { id, parentId } = moreAnchor;
              setMoreAnchor({ id: "", parentId: "", el: null });
              unlink(id, parentId);
            }}
          >
            {`Unlink from ${label(moreAnchor.parentId)}`}
          </MenuItem>
        ) : null}
        <MenuItem
          data-testid={`fw-remove-${moreAnchor.id}`}
          onClick={() => {
            const target = moreAnchor.id;
            setMoreAnchor({ id: "", parentId: "", el: null });
            removeArtifact(target);
          }}
        >
          Remove
        </MenuItem>
      </Menu>

      {notice ? (
        <Alert severity="info" sx={{ mb: 2 }} data-testid="fw-notice">
          {notice}
        </Alert>
      ) : null}

      <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
        Workflow
      </Typography>
      {figureIds.length || stranded.length ? (
        <Box
          component="ul"
          sx={{ listStyle: "none", m: 0, p: 0 }}
          data-testid="fw-figures"
          aria-label="Workflow outline"
        >
          {[...outline, ...stranded].map((node) => (
            <Box
              component="li"
              key={node.id}
              sx={{
                mb: 1.5,
                p: 1.5,
                border: 1,
                borderColor: "divider",
                borderRadius: 1,
                minWidth: 0,
              }}
              data-testid={`fw-figure-${node.id}`}
            >
              {prefixOf(node.id) === CHART ? null : (
                <Typography
                  variant="caption"
                  color="text.secondary"
                  display="block"
                  data-testid={`fw-stranded-${node.id}`}
                >
                  Not connected to a figure yet
                </Typography>
              )}
              <Box component="ul" sx={{ listStyle: "none", m: 0, p: 0 }}>
                <OutlineNode node={node} />
              </Box>
            </Box>
          ))}
        </Box>
      ) : (
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          No figures yet. Add one to start, or import from an RCC folder.
        </Typography>
      )}

      {/* "INDEPENDENT", not "unlinked".
          The old heading named these by what they LACK, so a perfectly
          ordinary dataset -- one that produced no figure, or one entered
          before its figure exists -- was filed under something that reads
          like a list of defects to go and fix. Standing on its own is a
          valid state for a resource, and the heading now says that. */}
      <Box
        sx={{
          mt: 2,
          p: 1.5,
          border: 1,
          borderColor: "divider",
          borderRadius: 1,
          bgcolor: "action.hover",
        }}
        data-testid="fw-unlinked"
      >
        <Typography variant="subtitle2" gutterBottom>
          Independent resources
        </Typography>
        <Box
          component="ul"
          sx={{ listStyle: "none", m: 0, p: 0 }}
          aria-label="Independent resources"
        >
          {unlinked.map((id) => (
            <OutlineNode
              key={id}
              node={{ id, parentId: "", type: "", first: true, groups: [] }}
            />
          ))}
        </Box>
        {/* Neither line is a nudge to go and connect something. The first
            reports where this paper's resources happen to sit; the second
            says out loud that standing alone is allowed. */}
        {unlinked.length === 0 ? (
          <Typography variant="caption" color="text.secondary" display="block">
            {knownIds.length
              ? "No independent resources — every resource here belongs to a figure."
              : "No independent resources yet. A script, dataset, tool or " +
                "external data item can stand on its own here, with no figure."}
          </Typography>
        ) : null}
      </Box>

      <LinkDialog />

      {/* The real forms. Mounted for their dialogs, with their own Add
          buttons hidden -- this section supplies the contextual ones. */}
      <Box sx={{ display: "none" }} aria-hidden="true">
        <ChartsInfoForm hideTrigger />
        <ScriptsInfoForm hideTrigger />
        <DatasetsInfoForm hideTrigger />
        <ToolsInfoForm hideTrigger />
      </Box>
    </Drawer>
  );
};

export default FigureWorkspace;
