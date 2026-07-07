import { useReducer, useEffect, useRef } from "react";
import CuratorReducer from "./curatorReducer";
import CuratorContext from "./curatorContext";

import WebStore from "../../Utils/Persist";
import { summarizeBrowserDraft } from "../../Utils/browserDraft";

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

  const setAll = (data) => dispatch({ type: SET_CURATOR_STATE, payload: data });

  const hasMeaningfulDraft = () => Boolean(summarizeBrowserDraft(state));

  const saveDraft = () => {
    if (!draftKey || !hasMeaningfulDraft()) {
      return false;
    }
    WebStore.set(draftKey, state);
    return true;
  };

  const resetAll = (options = {}) => {
    if (draftKey && options.preserveDraft) {
      saveDraft();
      preserveDraftOnNextReset.current = true;
    } else if (draftKey) {
      WebStore.remove(draftKey);
    }
    dispatch({ type: SET_CURATOR_STATE, payload: initialState });
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
