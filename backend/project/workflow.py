"""Workflow graph validation.

A paper's workflow says how inputs and software produced a figure. It is
OPTIONAL: a record with no workflow, or with the untyped `[from, to]` edges
every record written before this module used, is valid and is left alone.

WHAT AN EDGE MEANS
==================
V1 gives edges a semantic type, so a graph states a relationship rather than
just a line between two boxes:

    consumes    Dataset or External Data  ->  Script or Chart
    uses_tool   Tool                      ->  Script
    generates   Script                    ->  Chart

An edge with no type is a LEGACY edge. It is accepted and preserved exactly as
stored; nothing here rewrites one, because guessing what an old curator meant
is not this module's business.

WHAT IS REFUSED
===============
Only things that are wrong however you read them:

  * an edge from a node to itself;
  * an edge naming an artifact this paper does not have (which is also how a
    cross-paper reference presents -- another paper's ids are simply not in
    this paper's artifact list);
  * a cycle, which would claim a figure helped produce itself;
  * a typed edge whose endpoints cannot hold that relationship.

WHEN IT RUNS
============
Only when the caller actually submits a workflow. A metadata edit that does
not mention one must not be refused because a record written years ago holds
an edge this module would not accept today -- that would make legacy papers
uneditable, which is a worse outcome than an old graph staying as it is.
"""

# Artifact id prefixes, as the Curator mints them (`type.charAt(0)`):
# charts -> c, scripts -> s, datasets -> d, tools -> t, heads -> h.
CHART = "c"
SCRIPT = "s"
DATASET = "d"
TOOL = "t"
EXTERNAL = "h"

CONSUMES = "consumes"
USES_TOOL = "uses_tool"
GENERATES = "generates"

# Which endpoints each relationship is allowed to join, by id prefix.
EDGE_RULES = {
    CONSUMES: ({DATASET, EXTERNAL}, {SCRIPT, CHART}),
    USES_TOOL: ({TOOL}, {SCRIPT}),
    GENERATES: ({SCRIPT}, {CHART}),
}

EDGE_TYPES = frozenset(EDGE_RULES)


class WorkflowError(ValueError):
    """A workflow that cannot be stored, with a reason fit to show a curator."""


def artifact_ids(paper):
    """Every artifact id this paper holds, whatever shape it arrived in.

    Reads the same five lists the Curator derives workflow nodes from. A
    missing list is an empty one -- a paper with no tools is not malformed.
    """
    ids = set()
    for key in ("charts", "scripts", "datasets", "tools", "heads"):
        for item in (paper.get(key) or []):
            if isinstance(item, dict):
                value = str(item.get("id") or "").strip()
            else:
                value = str(getattr(item, "id", "") or "").strip()
            if value:
                ids.add(value)
    return ids


def normalize_edge(edge):
    """One stored edge -> (from, to, type or None), or None if unreadable.

    Accepts both shapes on purpose: `{"from": .., "to": .., "type": ..}` is
    what V1 writes, `["from", "to"]` is what every earlier record holds.
    """
    if isinstance(edge, dict):
        source = str(edge.get("from") or "").strip()
        target = str(edge.get("to") or "").strip()
        kind = str(edge.get("type") or "").strip() or None
    elif isinstance(edge, (list, tuple)) and len(edge) >= 2:
        source = str(edge[0] or "").strip()
        target = str(edge[1] or "").strip()
        kind = None
    else:
        return None
    if not source or not target:
        return None
    return source, target, kind


def _has_cycle(edges):
    """True when the directed edges contain a cycle.

    Iterative depth-first search with an explicit stack: a graph is curator
    input, and a recursive walk would turn a long chain into a crash rather
    than a validation error.
    """
    adjacency = {}
    for source, target, _kind in edges:
        adjacency.setdefault(source, []).append(target)

    UNVISITED, IN_PROGRESS, DONE = 0, 1, 2
    state = {}

    for start in list(adjacency):
        if state.get(start, UNVISITED) != UNVISITED:
            continue
        stack = [(start, iter(adjacency.get(start, ())))]
        state[start] = IN_PROGRESS
        while stack:
            node, children = stack[-1]
            advanced = False
            for child in children:
                status = state.get(child, UNVISITED)
                if status == IN_PROGRESS:
                    return True          # back edge: a cycle
                if status == UNVISITED:
                    state[child] = IN_PROGRESS
                    stack.append((child, iter(adjacency.get(child, ()))))
                    advanced = True
                    break
            if not advanced:
                state[node] = DONE
                stack.pop()
    return False


def validate_workflow(paper):
    """Raise WorkflowError if `paper`'s workflow cannot be stored.

    `paper` is the plain dict a request carries. Returns silently for a paper
    with no workflow, an empty one, or one holding only legacy untyped edges
    that still point at artifacts this paper has.
    """
    workflow = paper.get("workflow")
    if not workflow:
        return
    if not isinstance(workflow, dict):
        raise WorkflowError("Workflow must be an object.")

    raw_edges = workflow.get("edges") or []
    if not isinstance(raw_edges, (list, tuple)):
        raise WorkflowError("Workflow edges must be a list.")

    known = artifact_ids(paper)
    edges = []
    for raw in raw_edges:
        edge = normalize_edge(raw)
        if edge is None:
            raise WorkflowError(
                "A workflow connection is missing its endpoints.")
        source, target, kind = edge

        if source == target:
            raise WorkflowError(
                "A workflow connection cannot join %s to itself." % source)

        # A dangling reference and a cross-paper reference are the same
        # failure from here: an id this paper does not have.
        for endpoint in (source, target):
            if endpoint not in known:
                raise WorkflowError(
                    "Workflow connection refers to %s, which is not part of "
                    "this paper." % endpoint)

        if kind is not None:
            if kind not in EDGE_TYPES:
                raise WorkflowError("Unknown workflow relationship '%s'." % kind)
            allowed_sources, allowed_targets = EDGE_RULES[kind]
            if source[:1] not in allowed_sources or \
                    target[:1] not in allowed_targets:
                raise WorkflowError(
                    "%s cannot be connected to %s as '%s'."
                    % (source, target, kind))
        edges.append((source, target, kind))

    if _has_cycle(edges):
        raise WorkflowError(
            "This workflow loops back on itself. A figure cannot help produce "
            "the thing that produced it.")
