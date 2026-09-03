import { useEffect, useState, useRef, Fragment, useContext } from "react";
import PropTypes from "prop-types";

import {
  Network,
  DataSet,
} from "vis-network/standalone";

import createNode from "./Nodes";
import createEdge from "./Edges";
import DetailsDialog from "./Details";

import CuratorHelperContext from "../../Context/CuratorHelpers/curatorHelperContext";
import SpotlightContext from "../../Context/Spotlight/spotlightContext";

// Global Edge Setting
// Enlarge Edge of the node being hovered
const changeChosenEdgeMiddleArrowScale = (values, id, selected, hovering) => {
  if (hovering || selected) {
    values.width = 3;
    values.shadowColor = "#9ea7aa";
    values.blurRadius = 5;
  }
};

// Global Node Setting
// Enlarge the node being hovered
const changeChosenNodeSize = (values, id, selected, hovering) => {
  if (hovering || selected) {
    values.size = 25;
    values.shadowColor = "#000";
  }
};

// Network Settings
const getOptions = (manipulate = {}) => {
  return {
    height: "700px",
    nodes: {
      chosen: {
        label: false,
        node: changeChosenNodeSize,
      },
    },
    edges: {
      arrows: {
        middle: true,
      },
      chosen: {
        label: false,
        edge: changeChosenEdgeMiddleArrowScale,
      },
    },
    physics: {
      minVelocity: 0.5,
    },
    interaction: {
      hover: true,
      dragNodes: true,
      dragView: true,
      tooltipDelay: 500,
      navigationButtons: true,
      zoomView: false,
    },
    layout: {
      improvedLayout: true,
      randomSeed: 1516362197, // Time at which the domain qresp.org was registered,
    },
    ...manipulate,
  };
};

const Graph = ({ workflow, data, manipulate = {} }) => {
  const [details, setDetails] = useState({});
  const [showDetails, setShowDetails] = useState(false);

  const [positions, setPositions] = useState(null);
  // The live node DataSet, so the spotlight can restyle one box without
  // rebuilding the network -- a rebuild would throw away the layout the
  // curator is looking at.
  const nodeSet = useRef(null);
  // Which box is currently lit, and how it looked before it was -- so it
  // can be put back as it was rather than as something guessed.
  const lit = useRef("");
  const litWas = useRef(null);

  const {
    workflowHelper: { fit, showLabels, onClick },
  } = useContext(CuratorHelperContext);
  const { spotlight, setSpotlight } = useContext(SpotlightContext);

  // A reference to the div rendered by this component
  const domNode = useRef(null);

  // A reference to the vis network instance
  const network = useRef(null);
  const workflowNodes = workflow.nodes.map((id) =>
    createNode(
      id,
      data,
      showLabels,
      positions && positions[id] ? positions[id] : {}
    )
  );

  const workflowEdges = workflow.edges.map((pair) => createEdge(pair));

  const showDetailsDialog = (params) => {
    if (params.nodes.length > 0) {
      const id = params.nodes[0];
      const type = id.charAt(0);
      const nodeData = data[type][id];
      setDetails(nodeData);
      setShowDetails(true);
    }
  };

  useEffect(() => {
    // create a network
    const data = {
      nodes: new DataSet(workflowNodes),
      edges: new DataSet(workflowEdges),
    };

    const wflow = new Network(domNode.current, data, getOptions(manipulate));
    network.current = wflow;

    // To Show the Details Dialog Component on click on a node only if not editing
    if (onClick) wflow.on("click", showDetailsDialog);

    if (manipulate != {})
      wflow.on("dragEnd", (params) => {
        if (params.nodes.length > 0)
          setPositions({
            ...positions,
            [params.nodes[0]]: wflow.getPosition(params.nodes[0]),
          });
      });

    // Set positions after simulation
    wflow.on("stabilized", function (params) {
      const pos = {};
      workflowNodes.forEach(
        (node) => (pos[node.id] = network.current.getPosition(node.id))
      );
      setPositions(pos);
      wflow.fit();
    });

    // Change mouse pointer to a small hand
    wflow.on("hoverNode", function (params) {
      wflow.canvas.body.container.style.cursor = "pointer";
      // Tell the resource list which artifact this box is.
      if (setSpotlight) setSpotlight(params.node);
    });
    // Have to set pointer to regular after exiting a node hover
    wflow.on("blurNode", function (params) {
      wflow.canvas.body.container.style.cursor = "default";
      if (setSpotlight) setSpotlight("");
    });
    // A keyboard reaches a node by selecting it, not by hovering.
    wflow.on("selectNode", function (params) {
      if (setSpotlight && params.nodes.length) setSpotlight(params.nodes[0]);
    });
    wflow.on("deselectNode", function () {
      if (setSpotlight) setSpotlight("");
    });

    nodeSet.current = data.nodes;

    if (
      positions == null ||
      Object.keys(positions).length != workflowNodes.length
    ) {
      const pos = {};
      workflowNodes.forEach(
        (node) => (pos[node.id] = wflow.getPosition(node.id))
      );
      setPositions(pos);
    }
  }, [workflow, showLabels, onClick]);

  useEffect(() => {
    network.current.stabilize();
  }, [fit]);

  // POINTED AT FROM THE LIST: light up the matching box.
  //
  // Only the two boxes that change are touched -- the one being let go and
  // the one being lit. Rewriting every node on each pointer move redraws
  // the whole canvas to move one outline.
  //
  // THE FILL IS LEFT ALONE and the OUTLINE is what changes: colour is how a
  // curator tells a Chart from a Tool at a glance, so a highlight that
  // repainted the shape would answer one question by taking away another.
  // A kind's colour is given to vis as a single word -- `orange`, `blue` --
  // which makes the border that colour too, so a thicker border on its own
  // is a thicker invisible line. It is given a dark border explicitly.
  useEffect(() => {
    const nodes = nodeSet.current;
    if (!nodes) return;
    const changes = [];
    if (lit.current && lit.current !== spotlight && litWas.current) {
      // Exactly what it was, not what its kind's default happens to be.
      if (nodes.get(lit.current)) changes.push(litWas.current);
      litWas.current = null;
    }
    if (spotlight && spotlight !== lit.current) {
      const node = nodes.get(spotlight);
      if (node) {
        litWas.current = {
          id: spotlight,
          color: node.color,
          borderWidth: node.borderWidth === undefined ? 1 : node.borderWidth,
          shadow: node.shadow === undefined ? false : node.shadow,
        };
        const fill =
          typeof node.color === "string"
            ? { background: node.color }
            : { ...(node.color || {}) };
        changes.push({
          id: spotlight,
          color: { ...fill, border: "#111111" },
          borderWidth: 5,
          shadow: true,
        });
      }
    }
    lit.current = spotlight;
    if (changes.length) nodes.update(changes);
  }, [spotlight]);

  return (
    <Fragment>
      <DetailsDialog
        showDetails={showDetails}
        details={details}
        setShowDetails={setShowDetails}
      />
      <div ref={domNode} style={{ border: "1px solid lightgrey" }}></div>
    </Fragment>
  );
};

Graph.propTypes = {
  workflow: PropTypes.object,
  data: PropTypes.object,
  manipulate: PropTypes.object,
};

export default Graph;
