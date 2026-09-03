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
  ToggleButton,
  ToggleButtonGroup,
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
  closesLoop,
  EDGE_VERB,
  FEEDS_INTO,
  LINKS_TO,
  RELATED_TO,
  UNDIRECTED,
  edgeFits,
  edgeProblem,
  edgeSentence,
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

// The kinds a curator can create, in the order the menu offers them, and
// whether the RCC importer can propose that kind at all. External data is
// a URL somebody types; there is nothing in a folder to scan for it.
const MENU_TYPES = [
  { type: "chart", label: "Figure", rcc: true },
  { type: "dataset", label: "Dataset", rcc: true },
  { type: "script", label: "Script", rcc: true },
  { type: "tool", label: "Tool", rcc: true },
  { type: "head", label: "External data", rcc: false },
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
// WHICH NODE THIS IS, in the graph below.
//
// The drawing labels its nodes c0, s1, d0 -- and until now nothing on this
// list said which row was which node, so matching a resource to a box in
// the picture meant guessing from the name.
const NodeId = ({ id }) => (
  <Typography
    variant="caption"
    color="text.secondary"
    component="span"
    data-testid={`fw-id-${id}`}
    sx={{ fontFamily: "monospace", flexShrink: 0 }}
  >
    {`(${id})`}
  </Typography>
);

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

/**
 * One candidate: a checkbox, a kind, a name. Nothing else.
 *
 * AT MODULE SCOPE ON PURPOSE. Defined inside the component, this was a new
 * component type on every render, so React unmounted and remounted the whole
 * row for each keystroke of state -- and a remounted checkbox replays its
 * check animation. That was the flash. The fix is not a shorter transition;
 * it is not throwing the element away.
 *
 * NOTHING ANIMATES. Ripple, touch ripple and the icon's transition are all
 * off, and the row grows nothing when it changes, so ticking four boxes is
 * four instant marks rather than four bursts of motion and four small jumps
 * of the list under the pointer. The focus ring stays: that one is not
 * decoration.
 */
const LinkOption = ({ option, name, checked, onToggle }) => (
  <Box component="li" sx={{ minWidth: 0 }}>
    <FormControlLabel
      sx={{ m: 0, py: 0.25, width: "100%", alignItems: "center" }}
      control={
        <Checkbox
          size="small"
          disableRipple
          disableTouchRipple
          disableFocusRipple
          checked={checked}
          onChange={(event) => onToggle(option.key, event.target.checked)}
          slotProps={{
            input: { "data-testid": `fw-link-option-${option.key}` },
          }}
          sx={{
            transition: "none",
            "&:hover": { backgroundColor: "transparent" },
            "& .MuiSvgIcon-root": { transition: "none" },
          }}
        />
      }
      label={
        <Box
          sx={{ display: "flex", alignItems: "center", gap: 0.75, minWidth: 0 }}
        >
          <KindChip id={option.other} />
          <Typography
            variant="body2"
            sx={{ overflowWrap: "anywhere", minWidth: 0 }}
            data-testid={`fw-link-name-${option.key}`}
          >
            {name}
          </Typography>
          <NodeId id={option.other} />
          {/* An association states no order, so it is marked as the
              two-headed thing it is rather than given a direction. */}
          {option.undirected ? (
            <Typography
              variant="caption"
              color="text.secondary"
              data-testid={`fw-link-both-${option.key}`}
            >
              ↔
            </Typography>
          ) : null}
        </Box>
      }
    />
  </Box>
);

/**
 * The connection manager.
 *
 * AT MODULE SCOPE ON PURPOSE. Declared inside FigureWorkspace it was a new
 * component type on every render, so React discarded and rebuilt the entire
 * dialog -- Modal, paper, every checkbox -- each time a box was ticked.
 * That is the flicker, and it is why focus vanished mid-use. Everything it
 * needs arrives as props.
 */
const LinkDialog = ({
  id,
  options,
  reversed,
  setReversed,
  label,
  wantsLinked,
  onToggle,
  onApply,
  onClose,
}) => {
    if (!id) return null;
    // Something to apply when any box disagrees with the record.
    const changed = options.some(
      (option) => wantsLinked(option) !== option.exists
    );
    const me = label(id);

    return (
      <Dialog
        open
        onClose={onClose}
        fullWidth
        maxWidth="sm"
        data-testid="fw-link-dialog"
      >
        <DialogTitle sx={{ pb: 0.5 }}>Link existing</DialogTitle>
        <DialogContent dividers>
          <Box
            sx={{
              display: "flex",
              alignItems: "center",
              gap: 0.75,
              mb: 1,
              minWidth: 0,
            }}
          >
            <Typography variant="caption" color="text.secondary">
              Source
            </Typography>
            <KindChip id={id} />
            <Typography
              variant="body2"
              sx={{ overflowWrap: "anywhere", minWidth: 0 }}
            >
              {me}
            </Typography>
          </Box>

          {/* THE DIRECTION, CHOSEN ONCE. Flipping it offers the same
              artifacts for an arrow the other way, which is a different fact
              and is allowed even when this one already exists. */}
          <Typography variant="caption" color="text.secondary" display="block">
            Arrow direction
          </Typography>
          <ToggleButtonGroup
            exclusive
            size="small"
            value={reversed ? "in" : "out"}
            onChange={(event, next) => {
              if (!next) return;
              // Pending changes are keyed by edge, so they survive.
              setReversed(next === "in");
            }}
            sx={{ mb: 1.5, flexWrap: "wrap" }}
          >
            <ToggleButton
              value="out"
              data-testid="fw-dir-out"
              sx={{ textTransform: "none" }}
            >
              {`${me} → selected`}
            </ToggleButton>
            <ToggleButton
              value="in"
              data-testid="fw-dir-in"
              sx={{ textTransform: "none" }}
            >
              {`selected → ${me}`}
            </ToggleButton>
          </ToggleButtonGroup>

          {options.length ? (
            <Box component="ul" sx={{ listStyle: "none", m: 0, p: 0 }}>
              {options.map((option) => (
                <LinkOption
                  key={option.key}
                  option={option}
                  name={label(option.other)}
                  checked={wantsLinked(option)}
                  onToggle={onToggle}
                />
              ))}
            </Box>
          ) : (
            <Typography variant="body2" color="text.secondary">
              Nothing else in this paper yet. Add a resource first, then link
              it here.
            </Typography>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose} data-testid="fw-link-cancel">
            Cancel
          </Button>
          <RegularStyledButton
            onClick={onApply}
            disabled={!changed}
            data-testid="fw-link-apply"
          >
            Apply changes
          </RegularStyledButton>
        </DialogActions>
      </Dialog>
    );
  };

  /**
   * ONE ROW PER ARTIFACT, in a flat list.
   *
   * This section used to draw the workflow: a figure-rooted tree, shared
   * nodes rendered once with references after them, and an SVG above it.
   * That was a SECOND picture of the same graph, and the two had to be kept
   * in step by hand -- while the tree could not honestly show a cycle, a
   * reversed pair, or many-to-many without either cutting an edge or
   * repeating a node.
   *
   * The graph belongs in "Build your workflow", which already draws it and
   * already lets it be edited. This is a resource manager: what the paper
   * holds, what each thing is joined to, and the four things a curator does
   * to it. No hierarchy is invented, so none can be wrong.
   */

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
  //
  // `anchor` is a TESTID, not an element. This component re-renders on every
  // state change, so an element captured from an event is detached by the
  // time the menu positions itself -- and MUI, handed a detached node, falls
  // back to the top left of the screen. Looking the element up live also
  // keeps the menu beside its trigger after a scroll.
  const [flow, setFlow] = useState({
    id: "",
    anchor: "",
    step: "root",
    source: "",
  });
  const branchTimer = useRef(null);

  const closeFlow = () => {
    if (branchTimer.current) clearTimeout(branchTimer.current);
    setFlow({ id: "", anchor: "", step: "root", source: "" });
  };
  const [moreAnchor, setMoreAnchor] = useState({ id: "", parentId: "", el: null });
  // Links the curator picked that would close a feedback loop, held until
  // they say yes. Nothing is added while this is set.
  const [loopAsk, setLoopAsk] = useState(null);
  // Which rows have had their connections FOLDED AWAY. Open is the default:
  // the connections are the reason to look at a row, and hiding them behind
  // a click puts Unlink one step further from the arrow it undoes.
  const [folded, setFolded] = useState({});
  // Which artifact's connection dialog is open, and what is ticked in it.
  const [connectFor, setConnectFor] = useState("");
  // What the boxes SAY, keyed by edge, holding only the deviations from
  // what the record currently holds. Keyed by edge rather than by row so a
  // change survives flipping the direction.
  const [wanted, setWanted] = useState({});
  // Which way the arrow points. Chosen once, above the list, rather than
  // repeated as a sentence on every row.
  const [reversed, setReversed] = useState(false);
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

  const label = (id) => rowLabel(byId[id], id);
  const named = (id) => `${KIND_LABEL[prefixOf(id)] || "Item"}: ${label(id)}`;

  /**
   * How a relationship reads.
   *
   * A directed one gets arrows and a subject, so the flow is in the words
   * rather than in the indentation. An undirected one gets a double-headed
   * connector and no subject, because neither end came first.
   */
  const namedSentence = (edge) => edgeSentence(edge, named);

  const figureIds = knownIds.filter((id) => prefixOf(id) === CHART).sort();

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
  /**
   * Everything `id` could be linked to, one row per artifact.
   *
   * The dialog used to list one row per RELATIONSHIP, grouped by type, each
   * spelled out as a sentence -- so joining a script to a dataset meant
   * reading four paragraphs of vocabulary to find the one that was allowed.
   * The curator is not choosing a vocabulary word. They are drawing an
   * arrow, and they have already chosen which way it points.
   *
   * So: one row per artifact, and the direction is a single choice above the
   * list. `links_to` fits every pair, so no combination is missing and no
   * combination has to be explained.
   *
   * An EXISTING edge in the chosen direction is shown as made -- of any
   * type, because a second arrow the same way would say what is already
   * said. An edge the OTHER way does not block anything: that is a different
   * fact.
   */
  /**
   * Every connection this row could HAVE, in the chosen direction.
   *
   * The dialog used to list only the connections that did not exist yet and
   * grey out the rest as "Already linked" -- so the one place a curator went
   * to manage a resource's connections was the one place they could not undo
   * one. They had to close it, find the resource in the list, and unlink
   * from there.
   *
   * A row is now the STATE of a connection: ticked means it exists, and the
   * tick is what changes it. `edge` is the edge that would be added, or the
   * stored edge that would be removed -- `unlink` matches on the endpoints
   * as stored, so an association drawn the other way round must be removed
   * by the orientation the record holds, not the one being read.
   */
  const linkCandidates = (id, reversed) => {
    const stored = edges.map(fromStoredEdge);
    const rows = [];

    knownIds
      .filter((other) => other !== id)
      .forEach((other) => {
        const from = reversed ? other : id;
        const to = reversed ? id : other;

        // The arrow in the direction being looked at.
        const flow = stored.find(
          (edge) =>
            !UNDIRECTED.includes(edge.type) &&
            edge.from === from &&
            edge.to === to
        );
        rows.push({
          key: `${from}-${to}`,
          other,
          exists: Boolean(flow),
          // Removing takes the stored edge; adding makes a generic arrow.
          edge: flow || { from, to, type: LINKS_TO },
          undirected: false,
        });

        // An association states no order, so it belongs on screen whichever
        // way the dialog is being read -- and it has to be removable here
        // too, which was the whole complaint.
        const related = stored.find(
          (edge) =>
            UNDIRECTED.includes(edge.type) &&
            ((edge.from === id && edge.to === other) ||
              (edge.from === other && edge.to === id))
        );
        if (related) {
          rows.push({
            key: `${related.from}-${related.to}-${related.type}`,
            other,
            exists: true,
            edge: related,
            undirected: true,
          });
        }
      });

    return rows;
  };

  /** Ticked = the state this row will be in once changes are applied. */
  const wantsLinked = (option) =>
    Object.prototype.hasOwnProperty.call(wanted, option.key)
      ? wanted[option.key]
      : option.exists;

  /**
   * The live element behind a testid, or null.
   *
   * Guarded for the server, which has no document: this page is rendered
   * there first, and an unguarded lookup takes the whole route down with it.
   */
  const elementFor = (testid) =>
    testid && typeof document !== "undefined"
      ? document.querySelector(`[data-testid="${testid}"]`)
      : null;

  const holdBranch = () => {
    if (branchTimer.current) clearTimeout(branchTimer.current);
  };

  const openBranch = (source) => {
    holdBranch();
    // Narrow screens have no hover, so there the pane is replaced instead.
    setFlow((was) => ({ ...was, source, step: narrow ? "kinds" : "root" }));
  };

  const closeBranch = () => {
    holdBranch();
    setFlow((was) => (was.source ? { ...was, source: "" } : was));
  };

  /**
   * Leaving the parent item does NOT close the branch at once.
   *
   * The pointer has to cross the gap between the two menus to reach the
   * child, and a branch that closes on `mouseleave` closes underneath it
   * every time. The child cancels this on entry.
   */
  const closeBranchSoon = () => {
    holdBranch();
    branchTimer.current = setTimeout(closeBranch, 260);
  };

  const branchKeys = (event, source) => {
    if (event.key === "ArrowRight" || event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openBranch(source);
    }
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      closeBranch();
    }
  };

  /**
   * The kinds this way in can produce.
   *
   * External data is a URL somebody types, so there is nothing in a folder
   * to scan for it -- it appears under Enter manually and nowhere else.
   */
  const kindItems = (source) =>
    MENU_TYPES.filter((row) => source !== "rcc" || row.rcc).map(
      ({ type, label: text }) => (
        <MenuItem
          key={type}
          data-testid={
            source === "rcc" ? `fw-rcc-${type}` : `fw-add-${flow.id}-${type}`
          }
          onKeyDown={(event) => {
            if (event.key === "ArrowLeft") {
              event.preventDefault();
              closeBranch();
            }
          }}
          onClick={() => {
            const target = flow.id;
            closeFlow();
            if (source === "rcc") {
              setRccImport((was) => ({ type, nonce: was.nonce + 1 }));
            } else {
              createAttachedTo(type, target);
            }
          }}
        >
          {text}
        </MenuItem>
      )
    );

  const togglePick = (key, on) =>
    setWanted((was) => ({ ...was, [key]: on }));

  const openLink = (id) => {
    setNotice("");
    setWanted({});
    setReversed(false);
    setConnectFor(id);
  };

  /** Cancel: every pending tick is dropped, and nothing was written. */
  const closeLink = () => {
    setConnectFor("");
    setWanted({});
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
  /**
   * Make the graph match what the boxes say.
   *
   * Both directions are considered, not just the one on screen: a tick made
   * before the direction was flipped is still a tick, and `pending` is keyed
   * by edge so it survives the flip.
   *
   * THE DIALOG STAYS OPEN. Applying is not leaving -- a curator managing a
   * resource's connections usually has more than one to make, and closing
   * the window under them costs the place they were working. Clearing
   * `pending` is what makes the new state the baseline.
   */
  const applyChanges = () => {
    const rows = [
      ...linkCandidates(connectFor, false),
      ...linkCandidates(connectFor, true),
    ];
    const seen = new Set();
    const adds = [];
    const removes = [];
    rows.forEach((option) => {
      if (seen.has(option.key)) return;
      seen.add(option.key);
      const want = wantsLinked(option);
      if (want && !option.exists) adds.push(option.edge);
      if (!want && option.exists) removes.push(option.edge);
    });

    if (!adds.length && !removes.length) {
      setNotice("Nothing changed, so nothing was applied.");
      return;
    }

    // Removals first: undoing an arrow can be what makes an addition stop
    // closing a loop, and the curator should not be asked about a loop they
    // have just broken in the same breath.
    removes.forEach((edge) => unlink(edge.from, edge.to));

    const running = edges.filter(
      (edge) =>
        !removes.some((gone) => {
          const parsed = fromStoredEdge(edge);
          return parsed.from === gone.from && parsed.to === gone.to;
        })
    );
    const safe = [];
    const loops = [];
    adds.forEach((edge) => {
      if (closesLoop(running, edge)) loops.push(edge);
      else safe.push(edge);
      running.push(edge);
    });

    if (loops.length) {
      setLoopAsk({ safe, loops });
      return;
    }
    applyEdges(safe);
    setWanted({});
  };

  const confirmLoops = () => {
    setWanted({});
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
  };

  const declineLoops = () => {
    setWanted({});
    // Everything that was NOT a loop still goes in: refusing the loop is not
    // a reason to throw away the other choices.
    if (loopAsk) applyEdges(loopAsk.safe);
    setLoopAsk(null);
  };

  /** The artifacts this one is associated with, in either stored order. */
  /**
   * What a curator does to an artifact: three actions, in one group, always
   * on the row.
   *
   * Edit and Remove used to hide behind a "⋮" that opened a menu somewhere
   * else on the page, so the two commonest operations on a record were both
   * invisible and, once opened, disconnected from the thing they acted on.
   * Nothing here appears on hover either -- an action a curator cannot see
   * is an action they do not know they have.
   */
  const RowActions = ({ node }) => {
    const { id } = node;
    return (
      <Box
        sx={{
          display: "flex",
          flexShrink: 0,
          alignItems: "center",
          flexWrap: "wrap",
        }}
        data-testid={`fw-actions-${id}`}
      >
        <RowAction
          onClick={() =>
            setFlow({
              id,
              anchor: `fw-addlink-${id}`,
              step: "root",
              source: "",
            })
          }
          aria-haspopup="menu"
          data-testid={`fw-addlink-${id}`}
        >
          Add or link
        </RowAction>
        <RowAction
          onClick={() => editArtifact(id)}
          aria-label={`Edit ${label(id)}`}
          data-testid={`fw-edit-${id}`}
        >
          Edit
        </RowAction>
        <RowAction
          onClick={() => removeArtifact(id)}
          aria-label={`Remove ${label(id)}`}
          data-testid={`fw-remove-${id}`}
        >
          Remove
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

  /**
   * A relationship, shown as the ARROW it is.
   *
   * The words -- "generates", "supplies input to", "uses tool" -- were a
   * vocabulary lesson printed beside every row, and they said more than the
   * curator did: an arrow between two things is what they drew. The words
   * survive in `aria-label`, where a reader who cannot see the arrow needs
   * them, and nowhere else.
   *
   * The GLYPH comes from the stored direction, never from what is above or
   * below it on screen.
   */
  const EdgeArrow = ({ edge }) => (
    <Typography
      variant="caption"
      color="text.secondary"
      component="span"
      aria-label={`${label(edge.from)} ${
        EDGE_VERB[edge.type] || "connects to"
      } ${label(edge.to)}`}
      data-testid={`fw-flow-${edge.from}-${edge.to}`}
    >
      {UNDIRECTED.includes(edge.type) ? "↔" : "→"}
    </Typography>
  );

  /** One connection, from whichever end it is being read. */
  const ConnectionLine = ({ edge, id }) => {
    const undirected = UNDIRECTED.includes(edge.type);
    const other = edge.from === id ? edge.to : edge.from;
    return (
      <Box
        component="li"
        sx={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          gap: 0.75,
          minWidth: 0,
        }}
      >
        <EdgeArrow edge={edge} />
        <KindChip id={other} />
        <Typography
          variant="body2"
          sx={{ overflowWrap: "anywhere", minWidth: 0 }}
        >
          {label(other)}
        </Typography>
        <NodeId id={other} />
        {edge.feedback ? (
          <Chip
            label="feedback loop"
            size="small"
            variant="outlined"
            data-testid={`fw-feedback-${edge.from}-${edge.to}`}
            sx={{
              height: 18,
              flexShrink: 0,
              borderColor: "warning.main",
              color: "warning.main",
              "& .MuiChip-label": { px: 0.75, fontSize: 10 },
            }}
          />
        ) : null}
        <UnlinkEdge edge={edge} />
      </Box>
    );
  };

  /**
   * ONE ROW PER ARTIFACT, with what reaches it and what it reaches.
   *
   * Not a tree: no hierarchy is invented, so none can be wrong. What a
   * curator needs standing at one resource is both halves of its
   * neighbourhood, and an edge is reachable from either end -- an arrow
   * you can see but only undo from the other side is the complaint this
   * answers.
   */
  const ResourceRow = ({ id }) => {
    const into = incoming(id).filter(
      (edge) => !UNDIRECTED.includes(edge.type)
    );
    const outOf = outgoing(id).filter(
      (edge) => !UNDIRECTED.includes(edge.type)
    );
    const both = edges
      .map(fromStoredEdge)
      .filter(
        (edge) =>
          UNDIRECTED.includes(edge.type) &&
          (edge.from === id || edge.to === id)
      );
    const total = into.length + outOf.length + both.length;
    const open = !folded[id];

    return (
      <Box
        component="li"
        data-testid={`fw-node-${id}`}
        sx={{ minWidth: 0, py: 0.5, borderBottom: 1, borderColor: "divider" }}
      >
        <Box
          sx={{
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            gap: 0.75,
            minWidth: 0,
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
              variant="body2"
              sx={{ overflowWrap: "anywhere", minWidth: 0 }}
            >
              {label(id)}
            </Typography>
            {/* Which node this is in the drawing below. */}
            <NodeId id={id} />
            {/* The counts are always readable; the lists can be folded. */}
            <RowAction
              onClick={() =>
                setFolded((was) => ({ ...was, [id]: !was[id] }))
              }
              aria-expanded={open}
              data-testid={`fw-state-${id}`}
            >
              {total
                ? `${into.length} in · ${outOf.length} out${
                    both.length ? ` · ${both.length} related` : ""
                  }`
                : "Not connected"}
            </RowAction>
          </Box>
          <RowActions node={{ id }} />
        </Box>

        <Collapse in={open && total > 0} unmountOnExit>
          <Box sx={{ pl: 1.5 }} data-testid={`fw-wiring-${id}`}>
            {into.length ? (
              <Fragment>
                <Typography variant="caption" color="text.secondary" display="block">
                  Incoming
                </Typography>
                <Box component="ul" sx={{ listStyle: "none", m: 0, p: 0 }}>
                  {into.map((edge) => (
                    <ConnectionLine
                      key={`in-${edge.from}-${edge.to}-${edge.type}`}
                      edge={edge}
                      id={id}
                    />
                  ))}
                </Box>
              </Fragment>
            ) : null}
            {outOf.length ? (
              <Fragment>
                <Typography variant="caption" color="text.secondary" display="block">
                  Outgoing
                </Typography>
                <Box component="ul" sx={{ listStyle: "none", m: 0, p: 0 }}>
                  {outOf.map((edge) => (
                    <ConnectionLine
                      key={`out-${edge.from}-${edge.to}-${edge.type}`}
                      edge={edge}
                      id={id}
                    />
                  ))}
                </Box>
              </Fragment>
            ) : null}
            {both.length ? (
              <Fragment>
                <Typography variant="caption" color="text.secondary" display="block">
                  Related
                </Typography>
                <Box component="ul" sx={{ listStyle: "none", m: 0, p: 0 }}>
                  {both.map((edge) => (
                    <ConnectionLine
                      key={`rel-${edge.from}-${edge.to}`}
                      edge={edge}
                      id={id}
                    />
                  ))}
                </Box>
              </Fragment>
            ) : null}
          </Box>
        </Collapse>

        {prefixOf(id) === EXTERNAL ? (
          <Box sx={{ pl: 1.5, minWidth: 0 }}>
            {displayUrl(byId[id]) ? (
              <Typography
                variant="caption"
                component="a"
                href={displayUrl(byId[id])}
                target="_blank"
                rel="noopener noreferrer"
                data-testid={`fw-url-${id}`}
                sx={{ display: "block", overflowWrap: "anywhere" }}
              >
                {displayUrl(byId[id])}
              </Typography>
            ) : null}
            {noteFor(byId[id]) ? (
              <Typography
                variant="caption"
                color="text.secondary"
                display="block"
                data-testid={`fw-note-${id}`}
                sx={{ overflowWrap: "anywhere" }}
              >
                {noteFor(byId[id])}
              </Typography>
            ) : null}
          </Box>
        ) : null}

        {prefixOf(id) === CHART ? <SuggestionPanel id={id} /> : null}
      </Box>
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

  // A stable order: by kind, then by id. The list is a place to FIND a
  // resource, so nothing may move because an edge was drawn.
  const KIND_ORDER = [CHART, SCRIPT, DATASET, TOOL, EXTERNAL];
  const ordered = knownIds.slice().sort((a, b) => {
    const byKind =
      KIND_ORDER.indexOf(prefixOf(a)) - KIND_ORDER.indexOf(prefixOf(b));
    return byKind || (a < b ? -1 : a > b ? 1 : 0);
  });

  return (
    <Drawer heading="Organize figures and resources" defaultOpen={true}>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
        Everything this paper holds. Add resources, link them, and see the
        workflow they make in “Build your workflow” below.
      </Typography>

      {/* ONE place to start anything.

          A figure is the primary action and looks it. The other four sit
          under it as quiet text, so they are visible from the first screen
          without competing with the thing most curators want first. */}
      <Box sx={{ mb: 2 }}>
        <RegularStyledButton
          onClick={() =>
            setFlow({ id: "", anchor: "fw-addlink", step: "root", source: "" })
          }
          aria-haspopup="menu"
          data-testid="fw-addlink"
        >
          Add or link resource
        </RegularStyledButton>
      </Box>

      {/* ONE INTENTION, ASKED AS A CASCADE.
          Link what already exists, or make something new -- and if new, HOW
          it arrives, then WHAT it is. "Add new" was a step that asked
          nothing: every path under it led to the same two ways in, so it was
          a click to reach a click.

          Anchored by a LIVE LOOKUP, not by a captured event target. This
          component re-renders on every state change, so a stored element
          goes stale and MUI, given a detached node, falls back to the top
          left of the screen -- which is where the menu kept appearing. */}
      <Menu
        open={Boolean(flow.anchor)}
        anchorEl={
          typeof document === "undefined"
            ? null
            : () => elementFor(flow.anchor)
        }
        onClose={closeFlow}
        data-testid="fw-flow-menu"
        anchorOrigin={{ vertical: "bottom", horizontal: "left" }}
        transformOrigin={{ vertical: "top", horizontal: "left" }}
      >
        {narrow && flow.step !== "root" ? (
          <MenuItem
            data-testid="fw-flow-back"
            onClick={() => setFlow((was) => ({ ...was, step: "root", source: "" }))}
          >
            ← Back
          </MenuItem>
        ) : null}

        {flow.step === "root"
          ? [
              // Nothing to link TO from the top of the section.
              flow.id ? (
                <MenuItem
                  key="link"
                  data-testid={`fw-link-${flow.id}`}
                  onMouseEnter={closeBranch}
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
                key="manual"
                data-testid="fw-source-manual"
                aria-haspopup="menu"
                aria-expanded={flow.source === "manual"}
                onMouseEnter={() => openBranch("manual")}
                onFocus={() => openBranch("manual")}
                onKeyDown={(event) => branchKeys(event, "manual")}
                onClick={() => openBranch("manual")}
              >
                Enter manually ▸
              </MenuItem>,
              <MenuItem
                key="rcc"
                data-testid="fw-source-rcc"
                disabled={!canImport}
                aria-haspopup="menu"
                aria-expanded={flow.source === "rcc"}
                onMouseEnter={() => openBranch("rcc")}
                onFocus={() => openBranch("rcc")}
                onKeyDown={(event) => branchKeys(event, "rcc")}
                onClick={() => openBranch("rcc")}
              >
                From RCC ▸
              </MenuItem>,
              // A greyed row with no explanation is a dead end. One line,
              // and only where it applies.
              canImport ? null : (
                <MenuItem
                  key="hint"
                  disabled
                  data-testid="fw-rcc-hint"
                  sx={{ whiteSpace: "normal", maxWidth: 260 }}
                >
                  <Typography variant="caption">
                    Choose a File Server Path above, in this page, to import
                    from RCC.
                  </Typography>
                </MenuItem>
              ),
            ].filter(Boolean)
          : null}

        {/* Narrow only: no hover to lean on, so the pane is replaced and a
            Back row leads out. */}
        {narrow && flow.step === "kinds" ? kindItems(flow.source) : null}
      </Menu>

      {/* Wide: the branch, beside its parent and not on top of it. */}
      <Menu
        open={!narrow && Boolean(flow.source) && Boolean(flow.anchor)}
        anchorEl={
          typeof document === "undefined"
            ? null
            : () =>
                elementFor(
                  flow.source === "rcc" ? "fw-source-rcc" : "fw-source-manual"
                )
        }
        onClose={closeBranch}
        data-testid="fw-kind-menu"
        anchorOrigin={{ vertical: "top", horizontal: "right" }}
        transformOrigin={{ vertical: "top", horizontal: "left" }}
        disableAutoFocus
        disableEnforceFocus
        hideBackdrop
        disableScrollLock
        slotProps={{
          // The branch is a Modal, and a Modal's backdrop swallows the
          // pointer: with it in place, moving back to the OTHER parent item
          // did nothing at all. Only the branch's own paper takes events.
          root: { sx: { pointerEvents: "none" } },
          // A gap, so the child does not sit flush against the parent and
          // read as one list. MUI keeps it in the viewport, which is what
          // flips it near the right edge and only there.
          paper: {
            sx: { ml: "6px", pointerEvents: "auto" },
            onMouseEnter: holdBranch,
            onMouseLeave: closeBranchSoon,
          },
        }}
      >
        {kindItems(flow.source)}
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

      {/* THE PAPER'S RESOURCES, in one flat list.
          Sorted by kind so the same thing is always in the same place, and
          not arranged by who produced what -- that is the workflow, and the
          workflow has its own section. */}
      {knownIds.length ? (
        <Box
          component="ul"
          sx={{ listStyle: "none", m: 0, p: 0 }}
          data-testid="fw-resources"
          aria-label="Resources"
        >
          {ordered.map((id) => (
            <ResourceRow key={id} id={id} />
          ))}
        </Box>
      ) : (
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Nothing here yet. Add a figure or a resource to start, or import
          from an RCC folder.
        </Typography>
      )}

      <LinkDialog
        id={connectFor}
        options={connectFor ? linkCandidates(connectFor, reversed) : []}
        reversed={reversed}
        setReversed={setReversed}
        label={label}
        wantsLinked={wantsLinked}
        onToggle={togglePick}
        onApply={applyChanges}
        onClose={closeLink}
      />

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
