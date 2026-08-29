"""Workflow V1 graph validation.

The graph is curator input, so every test here is about what it REFUSES and
what it must keep accepting. The second half matters as much as the first: a
record written before V1 has untyped edges and no workflow at all, and neither
may become unstorable.
"""

import unittest

from project.workflow import (
    CONSUMES,
    FEEDS_INTO,
    GENERATES,
    USES_TOOL,
    WorkflowError,
    artifact_ids,
    artifact_types,
    normalize_edge,
    validate_workflow,
)


def paper(edges=None, **overrides):
    """A paper holding one of each artifact, so ids c0/s0/d0/t0/h0 all exist."""
    data = {
        "charts": [{"id": "c0"}],
        "scripts": [{"id": "s0"}],
        "datasets": [{"id": "d0"}],
        "tools": [{"id": "t0"}],
        "heads": [{"id": "h0"}],
    }
    data.update(overrides)
    if edges is not None:
        data["workflow"] = {"nodes": sorted(artifact_ids(data)),
                            "edges": edges}
    return data


def edge(source, target, kind=None):
    built = {"from": source, "to": target}
    if kind:
        built["type"] = kind
    return built


class TestAcceptedGraphs(unittest.TestCase):
    def test_a_paper_with_no_workflow_at_all(self):
        # The overwhelmingly common legacy record.
        validate_workflow({"charts": [{"id": "c0"}]})
        validate_workflow(paper())

    def test_an_empty_workflow(self):
        validate_workflow(paper(edges=[]))
        validate_workflow({"workflow": {"nodes": [], "edges": []}})

    def test_the_three_relationships_v1_understands(self):
        validate_workflow(paper(edges=[
            edge("d0", "s0", CONSUMES),
            edge("h0", "s0", CONSUMES),
            edge("t0", "s0", USES_TOOL),
            edge("s0", "c0", GENERATES),
        ]))

    def test_data_may_be_consumed_by_a_chart_directly(self):
        # Not every figure goes through a script.
        validate_workflow(paper(edges=[edge("d0", "c0", CONSUMES)]))

    def test_legacy_untyped_pairs_are_still_accepted(self):
        # What every record written before V1 holds. Nothing infers a type
        # for one; it is stored exactly as it is.
        validate_workflow(paper(edges=[["s0", "c0"], ["d0", "s0"]]))

    def test_typed_and_untyped_edges_can_coexist(self):
        # A curator who edits half an old graph does not have to finish it.
        validate_workflow(paper(edges=[["d0", "s0"],
                                       edge("s0", "c0", GENERATES)]))

    def test_one_artifact_may_serve_several_figures(self):
        # A script feeding two charts is ordinary, not a duplicate.
        data = paper()
        data["charts"] = [{"id": "c0"}, {"id": "c1"}]
        data["workflow"] = {"nodes": [], "edges": [
            edge("s0", "c0", GENERATES),
            edge("s0", "c1", GENERATES),
            edge("d0", "s0", CONSUMES),
        ]}
        validate_workflow(data)


class TestRefusedGraphs(unittest.TestCase):
    def refuses(self, edges, fragment, **overrides):
        with self.assertRaises(WorkflowError) as caught:
            validate_workflow(paper(edges=edges, **overrides))
        self.assertIn(fragment, str(caught.exception).lower())

    def test_a_node_linked_to_itself(self):
        self.refuses([edge("s0", "s0", GENERATES)], "itself")
        # ...in the legacy shape too.
        self.refuses([["c0", "c0"]], "itself")

    def test_an_artifact_this_paper_does_not_have(self):
        self.refuses([edge("s0", "c9", GENERATES)], "not part of this paper")

    def test_another_paper_s_artifact(self):
        # A cross-paper reference presents exactly as a dangling one: an id
        # this paper's artifact lists do not contain.
        self.refuses([edge("s0", "c0", GENERATES)], "not part of this paper",
                     charts=[])

    def test_a_direct_two_node_cycle_is_allowed(self):
        # Fit, adjust, fit again. Storage does not require a one-way graph.
        validate_workflow(paper([edge("s0", "c0", GENERATES), ["c0", "s0"]]))

    def test_a_longer_cycle_is_allowed(self):
        data = paper()
        data["scripts"] = [{"id": "s0"}, {"id": "s1"}]
        data["workflow"] = {"nodes": [], "edges": [
            ["s0", "s1"], ["s1", "c0"], ["c0", "s0"],
        ]}
        validate_workflow(data)

    def test_an_artifact_still_may_not_join_itself(self):
        # The one shape with no reading at all, cycles or not.
        self.refuses([["s0", "s0"]], "itself")

    def test_a_relationship_its_endpoints_cannot_hold(self):
        # A tool does not generate a figure, and a chart does not consume.
        self.refuses([edge("t0", "c0", GENERATES)], "cannot be connected")
        self.refuses([edge("c0", "s0", CONSUMES)], "cannot be connected")
        self.refuses([edge("d0", "c0", USES_TOOL)], "cannot be connected")

    def test_an_id_whose_prefix_lies_about_its_type(self):
        # A `c` id stored among the datasets is a corrupt reference. The edge
        # would describe a relationship between things that are not what the
        # graph says they are, so the prefix is CHECKED rather than trusted.
        data = {
            "charts": [],
            "scripts": [{"id": "s0"}],
            "datasets": [{"id": "c0"}],       # a chart id, in the wrong list
            "workflow": {"nodes": [], "edges": [
                {"from": "s0", "to": "c0", "type": GENERATES}]},
        }
        with self.assertRaises(WorkflowError) as caught:
            validate_workflow(data)
        self.assertIn("holds it in datasets", str(caught.exception))

    def test_an_id_with_a_prefix_qresp_does_not_use(self):
        data = {
            "charts": [{"id": "c0"}],
            "scripts": [{"id": "x9"}],        # not one of c/s/d/t/h
            "workflow": {"nodes": [], "edges": [["x9", "c0"]]},
        }
        with self.assertRaises(WorkflowError) as caught:
            validate_workflow(data)
        self.assertIn("not a kind of artifact", str(caught.exception))

    def test_a_relationship_name_v1_does_not_know(self):
        self.refuses([edge("s0", "c0", "produces")], "unknown workflow")

    def test_an_edge_with_a_missing_endpoint(self):
        self.refuses([{"from": "s0"}], "missing its endpoints")
        self.refuses([["s0"]], "missing its endpoints")
        self.refuses([{}], "missing its endpoints")

    def test_a_workflow_that_is_not_an_object(self):
        with self.assertRaises(WorkflowError):
            validate_workflow({"workflow": ["s0", "c0"]})

    def test_edges_that_are_not_a_list(self):
        with self.assertRaises(WorkflowError):
            validate_workflow({"workflow": {"edges": "s0->c0"}})


class TestHelpers(unittest.TestCase):
    def test_artifact_types_says_where_each_id_was_found(self):
        types = artifact_types(paper())
        self.assertEqual("charts", types["c0"])
        self.assertEqual("heads", types["h0"])
        self.assertEqual("tools", types["t0"])

    def test_artifact_ids_reads_all_five_lists(self):
        self.assertEqual({"c0", "s0", "d0", "t0", "h0"},
                         artifact_ids(paper()))

    def test_artifact_ids_tolerates_missing_lists(self):
        self.assertEqual(set(), artifact_ids({}))
        self.assertEqual({"c0"}, artifact_ids({"charts": [{"id": "c0"}]}))

    def test_normalize_edge_reads_both_shapes(self):
        self.assertEqual(("s0", "c0", GENERATES),
                         normalize_edge(edge("s0", "c0", GENERATES)))
        self.assertEqual(("s0", "c0", None), normalize_edge(["s0", "c0"]))
        self.assertIsNone(normalize_edge("s0->c0"))
        self.assertIsNone(normalize_edge(None))

    def test_a_deep_chain_does_not_blow_the_stack(self):
        # The walk is iterative on purpose: a graph is curator input, and a
        # long chain must produce a verdict rather than a crash.
        depth = 3000
        charts = [{"id": "c%d" % i} for i in range(depth)]
        edges = [["c%d" % i, "c%d" % (i + 1)] for i in range(depth - 1)]
        validate_workflow({"charts": charts,
                           "workflow": {"nodes": [], "edges": edges}})


class FeedsIntoTest(unittest.TestCase):
    """Script -> Script, the one relationship joining two of a kind.

    Analysis is written in stages: one script prepares what the next one
    plots. Every OTHER same-type pair stays refused, and the two guards that
    make this safe -- no self-edge, no cycle -- are the ones already there.
    """

    def two_scripts(self, edges=None):
        return paper(edges, scripts=[{"id": "s0"}, {"id": "s1"}])

    def test_a_script_may_feed_another(self):
        validate_workflow(self.two_scripts([edge("s1", "s0", FEEDS_INTO)]))

    def test_a_chain_of_scripts_is_fine(self):
        data = paper([edge("s0", "s1", FEEDS_INTO),
                      edge("s1", "s2", FEEDS_INTO),
                      edge("s2", "c0", GENERATES)],
                     scripts=[{"id": "s0"}, {"id": "s1"}, {"id": "s2"}])
        validate_workflow(data)

    def test_a_script_may_not_feed_itself(self):
        with self.assertRaises(WorkflowError) as caught:
            validate_workflow(self.two_scripts([edge("s0", "s0", FEEDS_INTO)]))
        self.assertIn("itself", str(caught.exception))

    def test_two_scripts_may_feed_each_other(self):
        # A refinement loop between two stages is a real thing to record.
        validate_workflow(self.two_scripts([
            edge("s0", "s1", FEEDS_INTO),
            edge("s1", "s0", FEEDS_INTO),
        ]))

    def test_a_longer_loop_is_allowed(self):
        validate_workflow(paper([edge("s0", "s1", FEEDS_INTO),
                                 edge("s1", "s2", FEEDS_INTO),
                                 edge("s2", "s0", FEEDS_INTO)],
                                scripts=[{"id": "s0"}, {"id": "s1"},
                                         {"id": "s2"}]))

    def test_every_kind_may_feed_its_own_kind(self):
        # One rule at every level: what came first feeds what came after.
        pairs = (
            ("charts", "c0", "c1"),
            ("scripts", "s0", "s1"),
            ("datasets", "d0", "d1"),
            ("tools", "t0", "t1"),
            ("heads", "h0", "h1"),
        )
        for key, first, second in pairs:
            data = paper([edge(first, second, FEEDS_INTO)],
                         **{key: [{"id": first}, {"id": second}]})
            validate_workflow(data)

    def test_it_refuses_two_different_kinds(self):
        # A dataset reaching a script is `consumes`. Letting `feeds_into` say
        # it too would leave the graph with two names for one fact.
        for source, target in (("d0", "s0"), ("t0", "s0"), ("s0", "c0"),
                               ("h0", "s0"), ("c0", "s0")):
            with self.assertRaises(WorkflowError) as caught:
                validate_workflow(paper([edge(source, target, FEEDS_INTO)]))
            self.assertIn("same kind", str(caught.exception))

    def test_the_other_relationships_keep_their_own_endpoints(self):
        # Opening feeds_into up did not loosen anything else.
        pairs = (
            ("charts", "c0", "c1", GENERATES),
            ("datasets", "d0", "d1", CONSUMES),
            ("tools", "t0", "t1", USES_TOOL),
        )
        for key, first, second, kind in pairs:
            data = paper([edge(first, second, kind)],
                         **{key: [{"id": first}, {"id": second}]})
            with self.assertRaises(WorkflowError):
                validate_workflow(data)


if __name__ == "__main__":
    unittest.main()
