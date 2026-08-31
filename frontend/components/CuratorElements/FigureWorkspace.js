import { Fragment, useContext, useEffect, useMemo, useRef, useState } from "react";

import {
  Alert,
  Box,
  Button,
  Chip,
  useMediaQuery,
  useTheme,
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

import Drawer from "../drawer";
import { RegularStyledButton } from "../button";
import ChartsInfoForm from "../CuratorForms/ChartsInfoForm";
import ScriptsInfoForm from "../CuratorForms/ScriptsInfoForm";
import DatasetsInfoForm from "../CuratorForms/DatasetsInfoForm";
import ToolsInfoForm from "../CuratorForms/ToolsInfoForm";
import FolderAnalysis from "./FolderAnalysis";
import WorkflowLanes from "./WorkflowLanes";

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
  DIRECTED,
  EDGE_GROUP,
  closesLoop,
  componentsOf,
  EDGE_VERB,
  FEEDS_INTO,
  RELATED_TO,
  edgeFits,
  edgeProblem,
  edgeSentence,
  hasEdge,
  hasRelation,
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

// What a group of a kind is called, for the "Related …" heading.
const KIND_PLURAL = {
  c: "Figures",
  s: "Scripts",
  d: "Datasets",
  t: "Tools",
  h: "External data",
};

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
  // ONE WAY IN, asking one question at a time.
  //
  // The page carried a primary Add figure, a separate Import from RCC, a row
  // of four "+ Type" links and a per-row Add new -- four controls for one
  // intention. This is that intention: link something that already exists,
  // or make something new; and if new, from the RCC folder or by hand.
  //
  // `id` is the row it was opened from, or "" at the top of the section,
  // where there is nothing yet to link TO.
  const [flow, setFlow] = useState({ id: "", el: null, step: "root", source: "" });
  const closeFlow = () =>
    setFlow({ id: "", el: null, step: "root", source: "" });
  const [moreAnchor, setMoreAnchor] = useState({ id: "", parentId: "", el: null });
  const [highlight, setHighlight] = useState("");
  // Links the curator picked that would close a feedback loop, held until
  // they say yes. Nothing is added while this is set.
  const [loopAsk, setLoopAsk] = useState(null);
  // Which artifact's connection dialog is open, and what is ticked in it.
  const [connectFor, setConnectFor] = useState("");
  const [picked, setPicked] = useState({});
  const [suggestFor, setSuggestFor] = useState("");

  // The RCC import menu, and which typed importer it opened. `nonce` remounts
  // the importer so choosing the same type twice opens it again rather than
  // doing nothing the second time.
  const [rccImport, setRccImport] = useState({ type: "", nonce: 0 });
  const canImport = Boolean(String(fileServerPath || "").trim());

  const theme = useTheme();
  // The same graph, two readings. A drawing is the clearest way to see the
  // shape of the work and the worst way to read it on a phone or with a
  // screen reader, so the narrow view gets the outline instead.
  const narrow = useMediaQuery(theme.breakpoints.down("md"));

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
    [CHART]: [GENERATES, CONSUMES],
    [SCRIPT]: [USES_TOOL, CONSUMES, FEEDS_INTO],
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

  /**
   * How a relationship reads.
   *
   * A directed one gets arrows and a subject, so the flow is in the words
   * rather than in the indentation. An undirected one gets a double-headed
   * connector and no subject, because neither end came first.
   */
  const sentence = (edge) => edgeSentence(edge, label);
  const namedSentence = (edge) => edgeSentence(edge, named);

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
  const buildOutline = (scope) => {
    const placed = new Set();
    const build = (id, parentId, type, feedback) => {
      const first = !placed.has(id);
      const node = { id, parentId, type, feedback, first, groups: [] };
      if (!first) return node;
      placed.add(id);
      [...(CHILD_RULES[prefixOf(id)] || []), ""].forEach((relation) => {
        const kids = incoming(id)
          .filter((edge) => (relation ? edge.type === relation : !edge.type))
          .map((edge) => build(edge.from, id, relation, edge.feedback));
        if (kids.length) node.groups.push({ type: relation, nodes: kids });
      });
      return node;
    };
    const roots = (scope || figureIds)
      .filter((id) => prefixOf(id) === CHART)
      .sort()
      .map((id) => build(id, "", ""));

    // A workflow does not have to end at a figure yet. Two scripts joined to
    // each other, or a dataset feeding a script, are real work in progress
    // and reachable from no figure at all -- rendering only figure-rooted
    // trees made them vanish from the page while still being in the record.
    const stranded = [];
    const connected = (id) => incoming(id).length || outgoing(id).length;
    let left = (scope || knownIds).filter(
      (id) => !placed.has(id) && connected(id)
    );
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

  // WHAT A CURATOR CALLS "ONE WORKFLOW" is a connected component of the
  // graph. It is DERIVED here on every render from the artifacts and edges
  // that exist -- there is no group model and nothing to migrate. Joining two
  // groups merges them because they become one component; removing the last
  // edge between them splits them again for the same reason.
  const { connected: components, alone } = componentsOf(knownIds, edges);

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
    const workflow = [];
    const related = [];
    const seen = new Set();

    knownIds
      .filter((other) => other !== id)
      .forEach((other) => {
        // FLOW. Both orderings are considered because one pair can hold a
        // relationship each way -- `preprocess feeds into plot` and `plot
        // feeds into preprocess` are different claims, so they are different
        // rows and the curator picks the one they mean.
        [
          [id, other],
          [other, id],
        ].forEach(([from, to]) => {
          DIRECTED.forEach((type) => {
            if (!edgeFits(type, prefixOf(from), prefixOf(to))) return;
            const key = `${from}-${to}-${type}`;
            if (seen.has(key)) return;
            const edge = { from, to, type };
            const linked = hasEdge(edges, from, to);
            if (!linked && edgeProblem(edge, knownIds, edges)) return;
            seen.add(key);
            workflow.push({ key, edge, other, linked });
          });
        });

        // ASSOCIATION. Same kind only, one row per pair, no direction to
        // choose -- so the pair is stored one way and read either way.
        if (edgeFits(RELATED_TO, prefixOf(id), prefixOf(other))) {
          const edge = { from: id, to: other, type: RELATED_TO };
          related.push({
            key: `${id}-${other}-${RELATED_TO}`,
            edge,
            other,
            linked: hasRelation(edges, id, other, RELATED_TO),
          });
        }
      });

    return { workflow, related };
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
  /** Add these edges, in order, skipping any that has become impossible. */
  const applyEdges = (chosen) => {
    const running = edges.slice();
    let made = 0;
    chosen.forEach((edge) => {
      if (edgeProblem(edge, knownIds, running)) return;
      addEdge(edge);
      running.push(edge);
      made += 1;
    });
    return made;
  };

  /**
   * Link what was ticked -- and ASK FIRST about anything that closes a loop.
   *
   * A feedback loop is real work (fit, adjust, fit again) and also the shape
   * a mistake takes, and the two are indistinguishable from the graph alone.
   * Only the curator can tell them apart, so they are asked, once, with the
   * loop written out.
   */
  const linkSelected = () => {
    const { workflow, related } = linkCandidates(connectFor);
    const chosen = [...workflow, ...related]
      .filter((option) => picked[option.key] && !option.linked)
      .map((option) => option.edge);

    if (!chosen.length) {
      setNotice("Nothing was selected, so nothing was linked.");
      closeLink();
      return;
    }

    const running = edges.slice();
    const safe = [];
    const loops = [];
    chosen.forEach((edge) => {
      if (closesLoop(running, edge)) loops.push(edge);
      else safe.push(edge);
      running.push(edge);
    });

    if (loops.length) {
      setLoopAsk({ safe, loops });
      return;
    }
    applyEdges(safe);
    closeLink();
  };

  const confirmLoops = () => {
    if (loopAsk) {
      applyEdges([
        ...loopAsk.safe,
        // Marked HERE, where the curator answered. Recomputing it later from
        // the shape of the graph would lose the answer the moment another
        // edge was removed.
        ...loopAsk.loops.map((edge) => ({ ...edge, feedback: true })),
      ]);
    }
    setLoopAsk(null);
    closeLink();
  };

  const declineLoops = () => {
    // Everything that was NOT a loop still goes in: refusing the loop is not
    // a reason to throw away the other choices.
    if (loopAsk) applyEdges(loopAsk.safe);
    setLoopAsk(null);
    closeLink();
  };

  /** The artifacts this one is associated with, in either stored order. */
  /**
   * The associations this artifact is part of, as {other, edge}.
   *
   * The EDGE comes back too, in the orientation it is stored in. An
   * association reads the same from either end but is stored one way round,
   * and `unlink` matches on the stored endpoints.
   */
  const relatedOf = (id) =>
    edges
      .map(fromStoredEdge)
      .filter((edge) => edge.type === RELATED_TO)
      .map((edge) => {
        if (edge.from === id) return { other: edge.to, edge };
        if (edge.to === id) return { other: edge.from, edge };
        return null;
      })
      .filter(Boolean);

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
    return (
      <Box sx={{ display: "flex", flexShrink: 0, alignItems: "center" }}>
        <RowAction
          onClick={(event) =>
            setFlow({ id, el: event.currentTarget, step: "root", source: "" })
          }
          aria-haspopup="menu"
          data-testid={`fw-addlink-${id}`}
        >
          Add or link
        </RowAction>
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

  /**
   * Break ONE relationship.
   *
   * Unlink is an EDGE action, not a node action. It used to hang off the
   * child's overflow menu, which meant a relationship was only reachable
   * from one of its two ends -- and an edge running from a node that happens
   * to be the root of its outline down to a child had no row offering it at
   * all, so it could not be broken from the screen.
   *
   * It goes beside the sentence instead. Wherever a relationship is written
   * out, the way to undo that relationship is next to it.
   *
   * `edge` carries the STORED orientation, which is what `unlink` matches on
   * -- passing the endpoints in reading order would silently remove nothing
   * for an association drawn from its other end.
   */
  const UnlinkEdge = ({ edge }) => (
    <RowAction
      onClick={() => unlink(edge.from, edge.to)}
      aria-label={`Unlink ${label(edge.from)} ${
        EDGE_VERB[edge.type] || "connects to"
      } ${label(edge.to)}`}
      data-testid={`fw-unlink-${edge.from}-${edge.to}`}
    >
      Unlink
    </RowAction>
  );

  const OutlineRow = ({ node, depth }) => {
    const { id, parentId, type, feedback, first } = node;
    const edge = parentId
      ? { from: id, to: parentId, type, feedback }
      : null;
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
          {edge ? <UnlinkEdge edge={edge} /> : null}
          {edge && edge.feedback ? (
            <Typography
              variant="caption"
              component="span"
              data-testid={`fw-feedback-${id}-${parentId}`}
              sx={{ color: "warning.main" }}
            >
              feedback loop
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
            {EDGE_GROUP[group.type] || "Connected to"}
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
      {/* ASSOCIATIONS ARE NOT CHILDREN.
          Indenting them under a node would say one produced the other, which
          is the one thing `related_to` does not claim. They sit beside the
          tree as a flat reference list instead, and never recurse. */}
      {node.first && relatedOf(node.id).length ? (
        <Box
          sx={{ ml: 1, pl: 1.5, mt: 0.25 }}
          data-testid={`fw-related-${node.id}`}
        >
          <Typography variant="caption" color="text.secondary" display="block">
            Related resources
          </Typography>
          <Box component="ul" sx={{ listStyle: "none", m: 0, p: 0 }}>
            {relatedOf(node.id).map(({ other, edge }) => (
              <Box
                component="li"
                key={other}
                sx={{
                  display: "flex",
                  flexWrap: "wrap",
                  alignItems: "center",
                  gap: 0.75,
                  minWidth: 0,
                }}
              >
                <KindChip id={other} />
                <Typography
                  variant="body2"
                  component="span"
                  sx={{ overflowWrap: "anywhere", minWidth: 0 }}
                >
                  {label(other)}
                </Typography>
                <Typography
                  variant="caption"
                  color="text.secondary"
                  component="span"
                  sx={{ overflowWrap: "anywhere" }}
                  data-testid={`fw-relation-${node.id}-${other}`}
                >
                  {sentence({ from: node.id, to: other, type: RELATED_TO })}
                </Typography>
                <UnlinkEdge edge={edge} />
                <RowAction
                  onClick={() => {
                    const target = document.getElementById(anchorOf(other));
                    if (target && target.scrollIntoView) {
                      target.scrollIntoView({ block: "center" });
                    }
                    setHighlight(other);
                  }}
                  data-target={anchorOf(other)}
                  data-testid={`fw-goto-related-${node.id}-${other}`}
                >
                  Go to
                </RowAction>
              </Box>
            ))}
          </Box>
        </Box>
      ) : null}
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

  /** One candidate row: a checkbox and the exact sentence it would create. */
  const LinkOption = ({ option }) => (
    <Box component="li" sx={{ minWidth: 0 }}>
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
            <Typography
              variant="body2"
              sx={{ overflowWrap: "anywhere" }}
              data-testid={`fw-link-sentence-${option.key}`}
            >
              {namedSentence(option.edge)}
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
  );

  const LinkDialog = () => {
    const id = connectFor;
    if (!id) return null;
    const { workflow, related } = linkCandidates(id);
    const anything = [...workflow, ...related].some((option) => !option.linked);

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
            {`What existing resource belongs to \u201C${named(id)}\u201D?`}
          </Typography>
        </DialogTitle>
        <DialogContent dividers>
          {/* TWO KINDS OF ANSWER, kept apart.
              One says what produced what and reads in a direction; the other
              says only that two things belong together. Mixing them in one
              list would leave a curator unsure which claim they were making. */}
          {workflow.length ? (
            <Box sx={{ mb: related.length ? 1.5 : 0 }}>
              <Typography
                variant="caption"
                color="text.secondary"
                display="block"
                data-testid="fw-link-group-workflow"
              >
                Workflow connection
              </Typography>
              <Box component="ul" sx={{ listStyle: "none", m: 0, p: 0 }}>
                {workflow.map((option) => (
                  <LinkOption key={option.key} option={option} />
                ))}
              </Box>
            </Box>
          ) : null}

          {related.length ? (
            <Box>
              <Typography
                variant="caption"
                color="text.secondary"
                display="block"
                data-testid="fw-link-group-related"
              >
                {`Related ${KIND_PLURAL[prefixOf(id)] || "resources"}`}
              </Typography>
              <Box component="ul" sx={{ listStyle: "none", m: 0, p: 0 }}>
                {related.map((option) => (
                  <LinkOption key={option.key} option={option} />
                ))}
              </Box>
            </Box>
          ) : null}

          {workflow.length || related.length ? null : (
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
            disabled={!anything}
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
  // An artifact with no edge at all stands on its own. That is exactly a
  // one-member component, so it comes from the same derivation as the groups
  // rather than a second rule that could disagree with it.
  const unlinked = alone;

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
        <RegularStyledButton
          onClick={(event) =>
            setFlow({ id: "", el: event.currentTarget, step: "root", source: "" })
          }
          aria-haspopup="menu"
          data-testid="fw-addlink"
        >
          Add or link resource
        </RegularStyledButton>
      </Box>

      {/* THE ONE MENU, in up to three steps.
          Link what exists, or make something new; and if new, from the RCC
          folder or by hand. Each step asks one thing. */}
      <Menu
        open={Boolean(flow.el)}
        anchorEl={flow.el}
        onClose={closeFlow}
        data-testid="fw-flow-menu"
      >
        {flow.step === "root"
          ? [
              // Nothing to link TO from the top of the section.
              flow.id ? (
                <MenuItem
                  key="link"
                  data-testid={`fw-link-${flow.id}`}
                  onClick={() => {
                    const target = flow.id;
                    closeFlow();
                    openLink(target);
                  }}
                >
                  Link existing…
                </MenuItem>
              ) : null,
              <MenuItem
                key="new"
                data-testid="fw-flow-new"
                onClick={() => setFlow((was) => ({ ...was, step: "source" }))}
              >
                Add new…
              </MenuItem>,
            ].filter(Boolean)
          : null}

        {flow.step === "source"
          ? [
              <MenuItem
                key="rcc"
                data-testid="fw-source-rcc"
                disabled={!canImport}
                onClick={() =>
                  setFlow((was) => ({ ...was, step: "type", source: "rcc" }))
                }
              >
                From RCC
              </MenuItem>,
              // A greyed row with no explanation is a dead end. One line,
              // and only when it applies.
              canImport ? null : (
                <MenuItem
                  key="hint"
                  disabled
                  data-testid="fw-rcc-hint"
                  sx={{ whiteSpace: "normal", maxWidth: 260 }}
                >
                  <Typography variant="caption">
                    Choose a File Server Path above to import from RCC.
                  </Typography>
                </MenuItem>
              ),
              <MenuItem
                key="manual"
                data-testid="fw-source-manual"
                onClick={() =>
                  setFlow((was) => ({ ...was, step: "type", source: "manual" }))
                }
              >
                Enter manually
              </MenuItem>,
            ].filter(Boolean)
          : null}

        {flow.step === "type" && flow.source === "rcc"
          ? IMPORTABLE.map(({ type, label: text }) => (
              <MenuItem
                key={type}
                data-testid={`fw-rcc-${type}`}
                onClick={() => {
                  closeFlow();
                  setRccImport((was) => ({ type, nonce: was.nonce + 1 }));
                }}
              >
                {text}
              </MenuItem>
            ))
          : null}

        {flow.step === "type" && flow.source === "manual"
          ? (flow.id ? addableTo(flow.id) : NEW_TYPES).map(
              ({ type, label: text }) => (
                <MenuItem
                  key={type}
                  data-testid={`fw-add-${flow.id}-${type}`}
                  onClick={() => {
                    const target = flow.id;
                    closeFlow();
                    createAttachedTo(type, target);
                  }}
                >
                  {text}
                </MenuItem>
              )
            )
          : null}
      </Menu>

      {rccImport.type ? (
        <FolderAnalysis
          key={`${rccImport.type}-${rccImport.nonce}`}
          artifactType={rccImport.type}
          hideTrigger
          autoOpen
        />
      ) : null}

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
      {components.length ? (
        <Box
          component="ul"
          sx={{ listStyle: "none", m: 0, p: 0 }}
          data-testid="fw-figures"
          aria-label="Workflow"
        >
          {components.map((members) => {
            const { roots, stranded } = buildOutline(members);
            const figures = members.filter((id) => prefixOf(id) === CHART);
            return (
              <Box
                component="li"
                key={members[0]}
                sx={{
                  mb: 1.5,
                  p: 1.5,
                  border: 1,
                  borderColor: "divider",
                  borderRadius: 1,
                  minWidth: 0,
                }}
                data-testid={`fw-group-${members[0]}`}
              >
                {figures.length ? null : (
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    display="block"
                    data-testid={`fw-stranded-${members[0]}`}
                  >
                    Independent workflow
                  </Typography>
                )}

                {/* The SAME graph, twice over. Wide: a drawing, because the
                    shape of the work is what a picture is for. Narrow: the
                    outline, because a drawing is the worst thing to read on
                    a phone or with a screen reader. */}
                {narrow ? null : (
                  <WorkflowLanes
                    ids={members}
                    byId={byId}
                    edges={edges}
                    name={label}
                    onPick={(id) => setHighlight(id)}
                    active={highlight}
                  />
                )}

                <Box component="ul" sx={{ listStyle: "none", m: 0, p: 0 }}>
                  {[...roots, ...stranded].map((node) => (
                    <OutlineNode key={node.id} node={node} />
                  ))}
                </Box>
              </Box>
            );
          })}
        </Box>
      ) : (
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {knownIds.length
            ? "Nothing is connected yet. Link two resources below and they " +
              "become a workflow here."
            : "No workflow yet. Add a figure or a resource to start, or " +
              "import from an RCC folder."}
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

      {/* ASKED, NOT REFUSED, AND NOT ASSUMED.
          A loop is both a real way of working and the shape a mistake takes,
          and the graph cannot tell them apart. So the curator is shown the
          exact connection and asked once. Saying no keeps everything else
          they picked -- declining the loop is not a reason to discard the
          rest. */}
      <Dialog
        open={Boolean(loopAsk)}
        onClose={declineLoops}
        fullWidth
        maxWidth="sm"
        data-testid="fw-loop-dialog"
      >
        <DialogTitle sx={{ pb: 0.5 }}>
          Make a feedback loop?
          <Typography variant="body2" color="text.secondary">
            This connection sends the workflow back to something earlier in
            it. That is a real way to work — fit, adjust, fit again — so Qresp
            will keep it and mark it as a feedback loop.
          </Typography>
        </DialogTitle>
        <DialogContent dividers>
          <Box component="ul" sx={{ listStyle: "none", m: 0, p: 0 }}>
            {(loopAsk ? loopAsk.loops : []).map((edge) => (
              <Box
                component="li"
                key={`${edge.from}-${edge.to}-${edge.type}`}
                sx={{ minWidth: 0 }}
              >
                <Typography
                  variant="body2"
                  sx={{ overflowWrap: "anywhere" }}
                  data-testid={`fw-loop-${edge.from}-${edge.to}`}
                >
                  {namedSentence(edge)}
                </Typography>
              </Box>
            ))}
          </Box>
          {loopAsk && loopAsk.safe.length ? (
            <Typography
              variant="caption"
              color="text.secondary"
              display="block"
              sx={{ mt: 1 }}
              data-testid="fw-loop-rest"
            >
              {`Your other ${loopAsk.safe.length} selection${
                loopAsk.safe.length === 1 ? "" : "s"
              } will be linked either way.`}
            </Typography>
          ) : null}
        </DialogContent>
        <DialogActions>
          <Button onClick={declineLoops} data-testid="fw-loop-cancel">
            Don't make the loop
          </Button>
          <RegularStyledButton onClick={confirmLoops} data-testid="fw-loop-confirm">
            Make feedback loop
          </RegularStyledButton>
        </DialogActions>
      </Dialog>

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
