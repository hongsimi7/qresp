import { useReducer, useCallback, useEffect, useRef, useState } from "react";
import CuratorReducer from "./curatorReducer";
import CuratorContext from "./curatorContext";

import WebStore from "../../Utils/Persist";
import { summarizeBrowserDraft } from "../../Utils/browserDraft";
import { saveServerDraft } from "../../Utils/serverDrafts";

import {
  SET_CURATOR_STATE,
  SET_CURATORINFO,
  SET_FILESERVERPATH,
  SET_PAPERINFO,
  SET_REFERENCE_AUTHORS,
  SET_REFERENCEINFO,
  SET_DOCUMENTATION,
  SET_LICENSE,
  SET,
  ADD,
  EDIT,
  DELETE,
  ADD_EDGE,
  DELETE_EDGE,
  SET_NODES,
  SET_EDGES,
} from "../types";

const CuratorState = (props) => {
  const draftKey = props.draftKey === undefined ? "state" : props.draftKey;
  const firstPersist = useRef(true);
  const autoResumeAttempted = useRef(false);
  const preserveDraftOnNextReset = useRef(false);

  // Server drafts: id of the account draft this form was loaded from (saves
  // update it instead of creating duplicates), a dirty flag for the
  // navigation guard, and a version counter that remounts the form tree on
  // reset so uncontrolled RHF inputs actually blank.
  const [activeDraftId, setActiveDraftId] = useState(null);
  const [activeDraftTitle, setActiveDraftTitle] = useState("");
  // LIVE mirror of the publication form's currently TYPED title/abstract
  // (reported via react-hook-form watch, before the section is saved). This
  // is an availability SIGNAL only — never a second source of truth: the
  // canonical bibliography stays referenceInfo, and snapshots for
  // saving/importing/AI still go through collectDraftState's flushers.
  const [liveBiblio, setLiveBiblio] = useState({ title: "", abstract: "" });
  const [draftDirty, setDraftDirty] = useState(false);
  const [resetVersion, setResetVersion] = useState(0);
  const firstDirtyCheck = useRef(true);
  const skipNextDirty = useRef(false);
  const stateRef = useRef(null);
  const draftFlushers = useRef(new Map());

  const initialState = {
    curatorInfo: {
      firstName: "",
      middleName: "",
      lastName: "",
      emailId: "",
      affiliation: "",
    },
    fileServerPath: "",
    paperInfo: {
      PIs: "",
      collections: [],
      tags: [],
      notebookFile: "",
      notebookPath: "",
    },
    // The PRIMARY paper's bibliography ("Publication Information for This
    // Paper") — the ONE canonical source that publishes as the record's
    // `reference` block (driving search/details/publish/dedup). A Qresp
    // record is one paper; there is no separate cited-works model.
    referenceInfo: {
      kind: "",
      doi: "",
      authors: "",
      title: "",
      publication: "",
      year: null,
      url: "",
      abstract: "",
    },
    documentation: "",
    charts: [],
    tools: [],
    datasets: [],
    scripts: [],
    heads: [],
    workflow: { nodes: [], edges: [] },
    license: "",
  };

  const [state, dispatch] = useReducer(CuratorReducer, initialState);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    firstPersist.current = true;
    autoResumeAttempted.current = false;
  }, [draftKey]);

  useEffect(() => {
    if (!draftKey) {
      return;
    }
    if (firstPersist.current) {
      firstPersist.current = false;
      return;
    }
    if (JSON.stringify(state) === JSON.stringify(initialState)) {
      if (preserveDraftOnNextReset.current) {
        preserveDraftOnNextReset.current = false;
        return;
      }
      WebStore.remove(draftKey);
    } else {
      WebStore.set(draftKey, state);
    }
  }, [state, draftKey]);

  useEffect(() => {
    if (!draftKey || !props.autoResumeDraft || autoResumeAttempted.current) {
      return;
    }
    autoResumeAttempted.current = true;
    const data = WebStore.get(draftKey);
    if (data !== null) {
      setAll(data);
    }
  }, [draftKey, props.autoResumeDraft]);

  useEffect(() => {
    const nextNodes = [
      ...state.charts.map((el) => el.id),
      ...state.scripts.map((el) => el.id),
      ...state.datasets.map((el) => el.id),
      ...state.tools.map((el) => el.id),
      ...state.heads.map((el) => el.id),
    ];
    const currentNodes = state.workflow.nodes || [];
    const nodesChanged =
      nextNodes.length !== currentNodes.length ||
      nextNodes.some((node, index) => node !== currentNodes[index]);
    if (nodesChanged) {
      setNodes(nextNodes);
    }
  }, [
    state.charts,
    state.scripts,
    state.datasets,
    state.tools,
    state.heads,
    state.workflow.nodes,
  ]);

  useEffect(() => {
    if (skipNextDirty.current) {
      skipNextDirty.current = false;
      firstDirtyCheck.current = false;
      return;
    }
    if (firstDirtyCheck.current) {
      firstDirtyCheck.current = false;
      return;
    }
    setDraftDirty(true);
  }, [state]);

  const normalizeState = (data = {}) => ({
    ...initialState,
    ...data,
    curatorInfo: {
      ...initialState.curatorInfo,
      ...(data.curatorInfo || {}),
    },
    paperInfo: {
      ...initialState.paperInfo,
      ...(data.paperInfo || {}),
    },
    // referenceInfo is the canonical primary-paper bibliography. A short-
    // lived intermediate draft shape stored it under `publicationInfo`
    // instead — absorb that back on load (publicationInfo wins when both
    // exist, since that shape treated it as the primary record).
    referenceInfo: {
      ...initialState.referenceInfo,
      ...(data.referenceInfo || {}),
      ...(data.publicationInfo || {}),
    },
    workflow: {
      ...initialState.workflow,
      ...(data.workflow || {}),
    },
    charts: data.charts || initialState.charts,
    tools: data.tools || initialState.tools,
    datasets: data.datasets || initialState.datasets,
    scripts: data.scripts || initialState.scripts,
    heads: data.heads || initialState.heads,
  });

  const setAll = (data) =>
    dispatch({ type: SET_CURATOR_STATE, payload: normalizeState(data) });

  const reportLiveBiblio = useCallback((next = {}) => {
    const title = next.title || "";
    const abstract = next.abstract || "";
    setLiveBiblio((current) =>
      current.title === title && current.abstract === abstract
        ? current
        : { title, abstract }
    );
  }, []);

  const registerDraftFlusher = useCallback((key, flusher) => {
    if (!key || typeof flusher !== "function") {
      return () => {};
    }
    draftFlushers.current.set(key, flusher);
    return () => {
      if (draftFlushers.current.get(key) === flusher) {
        draftFlushers.current.delete(key);
      }
    };
  }, []);

  const collectDraftState = useCallback(() => {
    let nextState = normalizeState(stateRef.current || state);
    draftFlushers.current.forEach((flusher) => {
      const patch = flusher(nextState);
      if (patch && typeof patch === "object") {
        nextState = normalizeState({ ...nextState, ...patch });
      }
    });
    return nextState;
  }, [state]);

  const getDraftTitle = useCallback(() => {
    const summary = summarizeBrowserDraft(collectDraftState());
    return activeDraftTitle || (summary && summary.title) || "Untitled draft";
  }, [activeDraftTitle, collectDraftState]);

  const hasMeaningfulDraft = () =>
    Boolean(summarizeBrowserDraft(collectDraftState()));

  const hasUnsavedDraftChanges = useCallback(() => {
    const draftState = collectDraftState();
    if (!summarizeBrowserDraft(draftState)) {
      return false;
    }
    if (draftDirty) {
      return true;
    }
    return (
      JSON.stringify(draftState) !==
      JSON.stringify(normalizeState(stateRef.current || state))
    );
  }, [collectDraftState, draftDirty, state]);

  const saveDraft = () => {
    const draftState = collectDraftState();
    if (!draftKey || !summarizeBrowserDraft(draftState)) {
      return false;
    }
    WebStore.set(draftKey, draftState);
    return true;
  };

  const resetAll = (options = {}) => {
    if (draftKey && options.preserveDraft) {
      saveDraft();
      preserveDraftOnNextReset.current = true;
    } else if (draftKey) {
      WebStore.remove(draftKey);
    }
    skipNextDirty.current = true;
    setActiveDraftId(null);
    setActiveDraftTitle("");
    setDraftDirty(false);
    // A fresh form must not keep signalling typed-title availability.
    setLiveBiblio({ title: "", abstract: "" });
    // Remount the form tree: context reset alone leaves stale values in the
    // always-mounted uncontrolled form inputs.
    setResetVersion((version) => version + 1);
    dispatch({ type: SET_CURATOR_STATE, payload: initialState });
  };

  // Persist the current form to the signed-in user's account drafts. Updates
  // the loaded draft when there is one, otherwise creates a new draft and
  // starts tracking its id. Resolves to the draft id; rejects on API errors
  // (e.g. 401 when not signed in) so callers can surface them.
  const saveDraftToServer = async (title) => {
    const draftState = collectDraftState();
    const nextTitle = (title || getDraftTitle()).trim() || "Untitled draft";
    const draft = await saveServerDraft(activeDraftId, draftState, nextTitle);
    if (draft && draft.id) {
      setActiveDraftId(draft.id);
    }
    setActiveDraftTitle((draft && draft.title) || nextTitle);
    skipNextDirty.current = true;
    dispatch({ type: SET_CURATOR_STATE, payload: draftState });
    setDraftDirty(false);
    return draft && draft.id;
  };

  // Remount the form tree WITHOUT clearing state: used after programmatic
  // state updates (e.g. applying manuscript-import proposals) so the
  // always-mounted uncontrolled form inputs re-seed from the new values.
  const remountForms = () => setResetVersion((version) => version + 1);

  // Forget the tracked account draft without touching the form (used after
  // the user deletes the draft they published from). Subsequent Save Draft
  // then creates a fresh draft instead of PUTting a deleted id.
  const clearActiveDraft = () => {
    setActiveDraftId(null);
    setActiveDraftTitle("");
  };

  // Used by edit mode (EditModeController) to fill the form from a stored
  // record without marking it dirty — the unsaved-changes guard must only
  // fire on actual user edits after the load.
  const applyLoadedRecord = (data) => {
    skipNextDirty.current = true;
    setAll(data || {});
    setDraftDirty(false);
  };

  // Called by the ?draft=<id> loader after fetching a server draft: fills the
  // form without marking it dirty (nothing is unsaved right after a load).
  const applyServerDraft = (draft) => {
    skipNextDirty.current = true;
    setAll((draft && draft.state) || {});
    setActiveDraftId(draft ? draft.id : null);
    setActiveDraftTitle(draft ? draft.title || "" : "");
    setDraftDirty(false);
  };

  const getSavedDraft = () => (draftKey ? WebStore.get(draftKey) : null);

  const resumeDraft = () => {
    const data = getSavedDraft();
    if (data !== null) {
      setAll(data);
    }
    return data;
  };

  const setCuratorInfo = (info) =>
    dispatch({ type: SET_CURATORINFO, payload: info });

  const setFileServerPath = (path) =>
    dispatch({ type: SET_FILESERVERPATH, payload: path });

  const setPaperInfo = (data) =>
    dispatch({ type: SET_PAPERINFO, payload: data });

  const setReferenceAuthors = (authors) =>
    dispatch({ type: SET_REFERENCE_AUTHORS, payload: authors });

  const setReferenceInfo = (data) =>
    dispatch({ type: SET_REFERENCEINFO, payload: data });

  const setDocumentation = (data) =>
    dispatch({ type: SET_DOCUMENTATION, payload: data });

  const setLicense = (license) =>
    dispatch({ type: SET_LICENSE, payload: license });

  const set = (type, value) =>
    dispatch({ type: SET, payload: { type: type + "s", value } });

  const add = (type, value) =>
    dispatch({ type: ADD, payload: { type: type + "s", value } });

  const edit = (type, value) =>
    dispatch({ type: EDIT, payload: { type: type + "s", value } });

  const del = (type, id) =>
    dispatch({ type: DELETE, payload: { type: type + "s", id } });

  const setNodes = (nodes) => dispatch({ type: SET_NODES, payload: nodes });
  const setEdges = (edges) => dispatch({ type: SET_EDGES, payload: edges });
  const addEdge = (edge) => dispatch({ type: ADD_EDGE, payload: edge });
  const deleteEdge = (edge) => dispatch({ type: DELETE_EDGE, payload: edge });

  return (
    <CuratorContext.Provider
      value={{
        reference: state.reference,
        curatorInfo: state.curatorInfo,
        fileServerPath: state.fileServerPath,
        paperInfo: state.paperInfo,
        referenceInfo: state.referenceInfo,
        documentation: state.documentation,
        charts: state.charts,
        tools: state.tools,
        datasets: state.datasets,
        scripts: state.scripts,
        workflow: state.workflow,
        heads: state.heads,
        license: state.license,
        metadata: state,
        setAll,
        resetAll,
        getSavedDraft,
        resumeDraft,
        saveDraft,
        hasMeaningfulDraft,
        hasUnsavedDraftChanges,
        activeDraftId,
        activeDraftTitle,
        draftDirty,
        resetVersion,
        remountForms,
        collectDraftState,
        getDraftTitle,
        registerDraftFlusher,
        liveBiblio,
        reportLiveBiblio,
        saveDraftToServer,
        applyServerDraft,
        applyLoadedRecord,
        clearActiveDraft,
        setCuratorInfo,
        setFileServerPath,
        setPaperInfo,
        setReferenceAuthors,
        setReferenceInfo,
        setDocumentation,
        set,
        add,
        edit,
        del,
        setNodes,
        setEdges,
        addEdge,
        deleteEdge,
        setLicense,
      }}
    >
      {props.children}
    </CuratorContext.Provider>
  );
};

export default CuratorState;
