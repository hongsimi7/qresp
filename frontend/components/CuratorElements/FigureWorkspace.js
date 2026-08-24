import { Fragment, useContext, useEffect, useMemo, useRef, useState } from "react";

import {
  Alert,
  Box,
  Button,
  Chip,
  Collapse,
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
    workflow, addEdge, unlink, del,
  } = useContext(CuratorContext);
  const {
    openForm, setDefault, setExternalNodeFormOpen,
  } = useContext(CuratorHelperContext) || {};

  const [notice, setNotice] = useState("");
  const [advancedFor, setAdvancedFor] = useState("");
  const [attachFor, setAttachFor] = useState("");
  const [suggestFor, setSuggestFor] = useState("");

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

  const sourcesOf = (id, kinds, type) =>
    incoming(id)
      .filter((edge) => (type ? edge.type === type : true))
      .filter((edge) => kinds.includes(prefixOf(edge.from)))
      .map((edge) => edge.from);

  /** Existing artifacts that may legally join `id` and are not joined yet. */
  const attachable = (id) =>
    knownIds.filter((other) => {
      if (other === id) return false;
      if (!inferEdgeType(id, other) && !inferEdgeType(other, id)) return false;
      return !hasEdge(edges, id, other) && !hasEdge(edges, other, id);
    });

  const attachExisting = (id, otherId) => {
    setNotice("");
    const forward = inferEdgeType(id, otherId);
    const backward = inferEdgeType(otherId, id);
    const edge = forward
      ? { from: id, to: otherId, type: forward }
      : { from: otherId, to: id, type: backward };
    if (!edge.type) {
      setNotice("Those two cannot be connected directly.");
      return;
    }
    addEdge(edge);
    setAttachFor("");
  };

  const AddButtons = ({ id, kinds }) => (
    <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5, mt: 0.5 }}>
      {kinds.map((kind) => (
        <RowAction
          key={kind}
          onClick={() => createAttachedTo(TYPE_BY_PREFIX[kind], id)}
          data-testid={`fw-add-${TYPE_BY_PREFIX[kind]}-for-${id}`}
        >
          {`+ ${KIND_LABEL[kind]}`}
        </RowAction>
      ))}
      <RowAction
        onClick={() => setAttachFor(attachFor === id ? "" : id)}
        data-testid={`fw-attach-toggle-${id}`}
      >
        Attach existing
      </RowAction>
    </Box>
  );

  /** One resource line: what it is, what it is called, and how to change it. */
  const ResourceRow = ({ id, relation, depth = 1 }) => (
    <Box
      component="li"
      data-testid={`fw-row-${id}`}
      sx={{ pl: depth * 1.5, mt: 0.5, minWidth: 0 }}
    >
      <Box sx={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 0.5, minWidth: 0 }}>
        <Typography variant="caption" color="text.secondary" component="span">
          {relation}
        </Typography>
        <Typography variant="body2" component="span" sx={{ overflowWrap: "anywhere" }}>
          {rowLabel(byId[id], id)}
        </Typography>
        <RowAction onClick={() => editArtifact(id)} data-testid={`fw-edit-${id}`}>
          Edit
        </RowAction>
      </Box>
      {prefixOf(id) === EXTERNAL ? (
        <Box sx={{ pl: 1, minWidth: 0 }}>
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
            <Typography variant="caption" color="text.secondary" display="block"
                        data-testid={`fw-note-${id}`} sx={{ overflowWrap: "anywhere" }}>
              {noteFor(byId[id])}
            </Typography>
          ) : null}
        </Box>
      ) : null}
      {prefixOf(id) === SCRIPT ? (
        <Box component="ul" sx={{ listStyle: "none", m: 0, p: 0 }}>
          {sourcesOf(id, [TOOL], USES_TOOL).map((toolId) => (
            <ResourceRow key={toolId} id={toolId} relation="uses tool:" depth={depth + 1} />
          ))}
          {sourcesOf(id, [DATASET, EXTERNAL], CONSUMES).map((dataId) => (
            <ResourceRow key={dataId} id={dataId} relation="uses:" depth={depth + 1} />
          ))}
          <Box component="li" sx={{ pl: (depth + 1) * 1.5 }}>
            <AddButtons id={id} kinds={[TOOL, DATASET, EXTERNAL]} />
            <AttachPanel id={id} />
          </Box>
        </Box>
      ) : null}
    </Box>
  );

  const AttachPanel = ({ id }) =>
    attachFor === id ? (
      <Box sx={{ mt: 0.5 }} data-testid={`fw-attach-${id}`}>
        {attachable(id).length ? (
          <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5 }}>
            {attachable(id).map((other) => (
              <Chip
                key={other}
                size="small"
                variant="outlined"
                label={rowLabel(byId[other], other)}
                onClick={() => attachExisting(id, other)}
                data-testid={`fw-attach-${id}-${other}`}
                sx={{ maxWidth: "100%" }}
              />
            ))}
          </Box>
        ) : (
          <Typography variant="caption" color="text.secondary">
            Nothing else can be attached here yet.
          </Typography>
        )}
      </Box>
    ) : null;

  /**
   * Connections this paper's own saved fields already prove.
   *
   * Closed, and absent entirely when there is nothing to show -- an empty
   * "Suggested connections" row on every figure would be four words of
   * furniture per figure saying nothing.
   *
   * Nothing here is applied. Each row states the one fact behind it and waits
   * to be accepted.
   */
  const SuggestionPanel = ({ id }) => {
    const items = suggestionsFor(id);
    if (!items.length) return null;
    const open = suggestFor === id;
    return (
      <Box sx={{ pl: 1.5, mt: 0.5 }} data-testid={`fw-suggestions-${id}`}>
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
                  {describeSuggestion(item, (who) => rowLabel(byId[who], who))}
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

  const figureIds = knownIds.filter((id) => prefixOf(id) === CHART).sort();

  // Anything with no connection at all. Not hidden: a dataset nobody has
  // wired up yet is a normal mid-curation state.
  const unlinked = knownIds.filter(
    (id) => !incoming(id).length && !outgoing(id).length && prefixOf(id) !== CHART
  );

  return (
    <Drawer heading="Organize figures and resources" defaultOpen={true}>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
        Start from a figure, then add what produced it. Nothing is saved until
        you save the record.
      </Typography>

      <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1, mb: 2 }}>
        <RegularStyledButton
          onClick={() => createAttachedTo("chart", "")}
          data-testid="fw-add-figure"
        >
          + Add Figure
        </RegularStyledButton>
        {/* RCC import stays exactly what it was; it just leads here now. */}
        <FolderAnalysis artifactType="chart" />
      </Box>

      {notice ? (
        <Alert severity="info" sx={{ mb: 2 }} data-testid="fw-notice">
          {notice}
        </Alert>
      ) : null}

      {figureIds.length ? (
        <Box component="ul" sx={{ listStyle: "none", m: 0, p: 0 }}
             data-testid="fw-figures" aria-label="Figures">
          {figureIds.map((id) => (
            <Box
              component="li"
              key={id}
              data-testid={`fw-figure-${id}`}
              sx={{ mb: 2, pb: 1.5, borderBottom: 1, borderColor: "divider", minWidth: 0 }}
            >
              <Box sx={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 0.5, minWidth: 0 }}>
                <Typography variant="subtitle2" sx={{ overflowWrap: "anywhere" }}>
                  {rowLabel(byId[id], id)}
                </Typography>
                <RowAction onClick={() => editArtifact(id)} data-testid={`fw-edit-${id}`}>
                  Edit
                </RowAction>
                <RowAction onClick={() => removeArtifact(id)} data-testid={`fw-remove-${id}`}>
                  Remove
                </RowAction>
              </Box>

              <Box component="ul" sx={{ listStyle: "none", m: 0, p: 0 }}>
                {sourcesOf(id, [SCRIPT], GENERATES).map((scriptId) => (
                  <ResourceRow key={scriptId} id={scriptId} relation="generated by:" />
                ))}
                {sourcesOf(id, [DATASET, EXTERNAL], CONSUMES).map((dataId) => (
                  <ResourceRow key={dataId} id={dataId} relation="uses:" />
                ))}
                {/* A legacy edge states no relationship, so neither does this. */}
                {incoming(id).filter((edge) => !edge.type).map((edge) => (
                  <ResourceRow key={edge.from} id={edge.from} relation="connected to:" />
                ))}
              </Box>

              <Box sx={{ pl: 1.5 }}>
                <AddButtons id={id} kinds={[SCRIPT, DATASET, EXTERNAL]} />
                <AttachPanel id={id} />
              </Box>

              <SuggestionPanel id={id} />

              {/* The unusual cases, and unlinking. The normal path never
                  needs this, so it is closed. */}
              <Box sx={{ pl: 1.5, mt: 0.5 }}>
                <RowAction
                  onClick={() => setAdvancedFor(advancedFor === id ? "" : id)}
                  aria-expanded={advancedFor === id}
                  data-testid={`fw-advanced-toggle-${id}`}
                >
                  Advanced connections
                </RowAction>
                <Collapse in={advancedFor === id} unmountOnExit>
                  <Box sx={{ mt: 0.5 }} data-testid={`fw-advanced-${id}`}>
                    {incoming(id).length ? (
                      <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
                        {incoming(id).map((edge) => (
                          <Box component="li" key={`${edge.from}-${edge.to}`}>
                            <Typography variant="caption" component="span">
                              {`${rowLabel(byId[edge.from], edge.from)} → ${rowLabel(byId[id], id)}`}
                              {edge.type ? ` (${edge.type.replace("_", " ")})` : ""}
                            </Typography>{" "}
                            <RowAction
                              onClick={() => unlink(edge.from, edge.to)}
                              data-testid={`fw-unlink-${edge.from}-${edge.to}`}
                            >
                              Unlink
                            </RowAction>
                          </Box>
                        ))}
                      </Box>
                    ) : (
                      <Typography variant="caption" color="text.secondary">
                        Nothing is connected to this figure yet.
                      </Typography>
                    )}
                  </Box>
                </Collapse>
              </Box>
            </Box>
          ))}
        </Box>
      ) : (
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          No figures yet. Add one to start, or import from an RCC folder.
        </Typography>
      )}

      {/* Resources that do not belong to a figure yet. Adding one here is a
          normal thing to do -- not everything in a paper produced a figure. */}
      <Box sx={{ mt: 2 }} data-testid="fw-unlinked">
        <Typography variant="subtitle2" gutterBottom>
          Unlinked resources
        </Typography>
        <Box component="ul" sx={{ listStyle: "none", m: 0, p: 0 }}>
          {unlinked.map((id) => (
            <ResourceRow key={id} id={id} relation="" depth={0} />
          ))}
        </Box>
        {unlinked.length === 0 ? (
          <Typography variant="caption" color="text.secondary" display="block">
            Everything is connected to a figure.
          </Typography>
        ) : null}
        <AddButtons id="" kinds={[SCRIPT, DATASET, TOOL, EXTERNAL]} />
      </Box>

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
