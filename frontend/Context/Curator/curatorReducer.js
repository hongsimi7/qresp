import {
  SET_CURATOR_STATE,
  SET_CURATORINFO,
  SET_FILESERVERPATH,
  SET_PAPERINFO,
  SET_REFERENCE_AUTHORS,
  SET_REFERENCEINFO,
  SET_LICENSE,
  SET,
  ADD,
  ADD_MANY,
  EDIT,
  DELETE,
  ADD_EDGE,
  DELETE_EDGE,
  UNLINK,
  SET_NODES,
  SET_EDGES,
  SET_DOCUMENTATION,
} from "../types";

import { getNodeNumber, reduceEdgeNodeId } from "../../Utils/graph";

export default (state, action) => {
  switch (action.type) {
    case SET_CURATORINFO:
      return {
        ...state,
        curatorInfo: action.payload,
      };
    case SET_CURATOR_STATE:
      return action.payload;
    case SET_FILESERVERPATH:
      return { ...state, fileServerPath: action.payload };
    case SET_PAPERINFO:
      return { ...state, paperInfo: action.payload };
    case SET_REFERENCE_AUTHORS:
      return {
        ...state,
        referenceInfo: { ...state.referenceInfo, authors: action.payload },
      };
    case SET_REFERENCEINFO:
      return { ...state, referenceInfo: action.payload };
    case SET_DOCUMENTATION:
      return { ...state, documentation: action.payload };
    case SET_LICENSE:
      return { ...state, license: action.payload };
    case SET:
      return { ...state, [action.payload.type]: [...action.payload.value] };
    case ADD:
      return {
        ...state,
        [action.payload.type]: [
          ...state[action.payload.type],
          action.payload.value,
        ],
      };

    // Batch append (folder analysis "Add selected items"). Ids are minted
    // HERE, against the list as it exists at dispatch time, so a batch can
    // never collide with an existing record the way a caller-computed
    // `${prefix}${list.length}` would once several items are added at once.
    case ADD_MANY: {
      const existing = state[action.payload.type] || [];
      const idPrefix = action.payload.type.charAt(0);
      const taken = new Set(existing.map((el) => el.id));
      let next = existing.length;
      const added = (action.payload.values || []).map((value) => {
        while (taken.has(`${idPrefix}${next}`)) {
          next += 1;
        }
        const id = `${idPrefix}${next}`;
        taken.add(id);
        next += 1;
        return { ...value, id };
      });
      return { ...state, [action.payload.type]: [...existing, ...added] };
    }

    case DELETE:
      const prefix = action.payload.type.charAt(0);
      const node_number_to_delete = getNodeNumber(action.payload.id);

      /*
      1st filter removes the edges corresponding to the deleted node.
      2nd filter fixes the node and id mapping, deleting a node causes the node with higher id having incorrect edges
      */
     
      const newEdges = state.workflow.edges
        .filter(
          (edge) =>
            edge.to != action.payload.id && edge.from != action.payload.id
        )
        .map((edge) => reduceEdgeNodeId(node_number_to_delete, prefix, edge));

      return {
        ...state,
        [action.payload.type]: state[action.payload.type]
          .filter((el) => el.id != action.payload.id)
          .map((el, i) => ({
            ...el,
            id: `${prefix}${i}`,
          })),
        workflow: { ...state.workflow, edges: newEdges },
      };

    case EDIT:
      return {
        ...state,
        [action.payload.type]: state[action.payload.type].map((el) =>
          el.id == action.payload.value.id ? action.payload.value : el
        ),
      };

    case SET_NODES:
      return {
        ...state,
        workflow: { ...state.workflow, nodes: [...action.payload] },
      };
    case SET_EDGES:
      return {
        ...state,
        workflow: { ...state.workflow, edges: [...action.payload] },
      };
    case ADD_EDGE:
      return {
        ...state,
        workflow: {
          ...state.workflow,
          edges: [...state.workflow.edges, action.payload],
        },
      };
    case DELETE_EDGE:
      return {
        ...state,
        workflow: {
          ...state.workflow,
          edges: state.workflow.edges.filter(
            (edge) => edge.id != action.payload
          ),
        },
      };
    // Remove exactly ONE connection, named by its endpoints.
    //
    // Only that edge goes. The two artifacts stay, and so does every other
    // connection either of them has -- a script feeding two figures keeps
    // feeding the other one when it is unlinked from the first.
    case UNLINK: {
      const { from, to } = action.payload || {};
      return {
        ...state,
        workflow: {
          ...state.workflow,
          edges: state.workflow.edges.filter((edge) => {
            const source = Array.isArray(edge) ? edge[0] : edge.from;
            const target = Array.isArray(edge) ? edge[1] : edge.to;
            return !(source === from && target === to);
          }),
        },
      };
    }

    default:
      return state;
  }
};
