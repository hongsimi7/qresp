"""AI-BASED PROVISIONAL relatedness labelling.

Nothing here contacts a provider: `assist.call_gemini` is stubbed everywhere.
What is pinned is the set of properties that make the output trustworthy as
TRIAGE -- and only as triage.

The two that matter most:

* the provider never sees what the gate decided, so its opinion is
  independent rather than an echo; and
* an automated pass can never write into a file where a person's ratings
  live.
"""
import io
import json
import os
import shutil
import tempfile
import unittest
from unittest import mock

from project.tools import ai_review
from project.tools import eval_core as core
from project.tools import related_eval


# ---------------------------------------------------------------- fixtures

def record(index=0, title=None, abstract=None):
    return {
        "record_id": "rec%02d" % index,
        "record_title": title if title is not None
        else "Rareword resonance of gadgetite lattices",
        "record_abstract": abstract if abstract is not None
        else ("Rareword resonance in gadgetite lattices is probed with a "
              "cryogenic spectrometer and a tunable oscillator."),
        "record_year": 2021,
        "record_doi": "10.1000/rec%02d" % index,
    }


def candidate(title="Rareword resonance in gadgetite single crystals",
              source="internal", gate_decision="accepted", in_top5=True,
              abstract="Rareword resonance of gadgetite lattices measured "
                       "with a cryogenic spectrometer.",
              score=9.0, doi="10.2000/cand"):
    return {
        "source": source,
        "rank": 0,
        "title": title,
        "abstract": abstract,
        "year": 2022,
        "doi": doi,
        "provider_paper_id": "S2-X",
        "gate_score": score,
        "gate_components": {"score": score, "similarity": 0.4},
        "gate_decision": gate_decision,
        "rejection_code": "" if gate_decision == "accepted" else "no_evidence",
        "rejection_reason": "" if gate_decision == "accepted"
        else "no evidence at all: ...",
        "reasons": ["High title and abstract similarity (0.48)"],
        "in_top5": in_top5,
    }


def answer(rating="related", confidence="high", reason="Both study rareword "
                                                       "resonance in gadgetite."):
    return json.dumps({"rating": rating, "confidence": confidence,
                       "reason": reason})


# ---------------------------------------------------------- blind payloads

class TestBlindInput(unittest.TestCase):
    def test_the_gate_decision_never_reaches_the_provider(self):
        payload = ai_review.blind_pair_payload(record(), candidate())
        blob = json.dumps(payload)
        for leaked in ("gate_score", "gate_decision", "gate_components",
                       "rejection_code", "rejection_reason", "reasons",
                       "in_top5", "rank", "source", "accepted", "rejected",
                       "High title and abstract similarity"):
            self.assertNotIn(leaked, blob, leaked)
        self.assertTrue(ai_review.payload_is_blind(payload))

    def test_the_blind_check_catches_a_leak(self):
        leaky = ai_review.blind_pair_payload(record(), candidate())
        leaky["candidate_paper"]["gate_decision"] = "accepted"
        self.assertFalse(ai_review.payload_is_blind(leaky))

    def test_exactly_one_pair_per_payload(self):
        payload = ai_review.blind_pair_payload(record(), candidate())
        self.assertEqual({"task", "reference_paper", "candidate_paper"},
                         set(payload))
        for side in ("reference_paper", "candidate_paper"):
            self.assertIsInstance(payload[side], dict)
            self.assertIn("title", payload[side])

    def test_only_bibliography_is_sent(self):
        payload = ai_review.blind_pair_payload(record(), candidate())
        allowed = {"title", "abstract", "year", "doi", "venue"}
        for side in ("reference_paper", "candidate_paper"):
            self.assertTrue(set(payload[side]) <= allowed,
                            set(payload[side]) - allowed)

    def test_a_missing_abstract_is_absent_rather_than_empty(self):
        payload = ai_review.blind_pair_payload(
            record(abstract=""), candidate(abstract=""))
        self.assertNotIn("abstract", payload["reference_paper"])
        self.assertNotIn("abstract", payload["candidate_paper"])

    def test_metadata_floor(self):
        self.assertTrue(ai_review.has_enough_metadata(record(), candidate()))
        self.assertFalse(
            ai_review.has_enough_metadata(record(title=""), candidate()))
        self.assertFalse(
            ai_review.has_enough_metadata(record(), candidate(title="")))


# ------------------------------------------------------- structured answers

class TestAnswerValidation(unittest.TestCase):
    def test_a_well_formed_answer_is_accepted(self):
        result, error = ai_review.parse_ai_answer(answer())
        self.assertIsNone(error)
        self.assertEqual("related", result["ai_rating"])
        self.assertEqual("high", result["ai_confidence"])
        self.assertTrue(result["ai_reason"])

    def test_every_rating_outside_the_enum_is_refused_not_coerced(self):
        for bad in ("yes", "maybe", "RELATED-ISH", "3", "", None):
            result, error = ai_review.parse_ai_answer(
                json.dumps({"rating": bad, "confidence": "high",
                            "reason": "x"}))
            self.assertIsNone(result, bad)
            self.assertIn("rating", error)

    def test_every_confidence_outside_the_enum_is_refused(self):
        for bad in ("very high", "0.9", "", None):
            result, error = ai_review.parse_ai_answer(
                json.dumps({"rating": "related", "confidence": bad,
                            "reason": "x"}))
            self.assertIsNone(result, bad)
            self.assertIn("confidence", error)

    def test_required_fields_are_enforced(self):
        for missing in ("rating", "confidence", "reason"):
            payload = {"rating": "related", "confidence": "high",
                       "reason": "x"}
            payload.pop(missing)
            result, error = ai_review.parse_ai_answer(json.dumps(payload))
            self.assertIsNone(result, missing)
            self.assertIn(missing, error)

    def test_an_empty_reason_is_refused(self):
        result, error = ai_review.parse_ai_answer(
            json.dumps({"rating": "related", "confidence": "high",
                        "reason": "   "}))
        self.assertIsNone(result)

    def test_unparseable_and_non_object_answers_are_refused(self):
        for bad in ("", "not json", "[1,2,3]", '"a string"'):
            result, error = ai_review.parse_ai_answer(bad)
            self.assertIsNone(result, bad)
            self.assertTrue(error, bad)

    def test_a_fenced_answer_is_still_read(self):
        result, error = ai_review.parse_ai_answer(
            "```json\n" + answer() + "\n```")
        self.assertIsNone(error)
        self.assertEqual("related", result["ai_rating"])

    def test_confidence_is_capped_to_low_without_abstracts(self):
        # Enforced locally: the model is not trusted to be modest about a
        # judgement it made from titles alone.
        for claimed in ("high", "medium"):
            result, error = ai_review.parse_ai_answer(
                answer(confidence=claimed), abstracts_available=False)
            self.assertIsNone(error)
            self.assertEqual("low", result["ai_confidence"], claimed)
            self.assertIn("capped to low", result["ai_reason"])

    def test_the_cap_does_not_touch_a_judgement_made_with_abstracts(self):
        result, _ = ai_review.parse_ai_answer(answer(confidence="high"),
                                              abstracts_available=True)
        self.assertEqual("high", result["ai_confidence"])
        self.assertNotIn("capped", result["ai_reason"])

    def test_the_schema_offered_to_the_provider_is_narrow(self):
        schema = ai_review.RESPONSE_SCHEMA
        self.assertEqual(sorted(["rating", "confidence", "reason"]),
                         sorted(schema["properties"]))
        self.assertEqual(list(ai_review.AI_RATINGS),
                         schema["properties"]["rating"]["enum"])
        self.assertEqual(list(ai_review.AI_CONFIDENCE),
                         schema["properties"]["confidence"]["enum"])

    def test_the_prompt_forbids_inventing_papers(self):
        prompt = ai_review.SYSTEM_PROMPT.lower()
        self.assertIn("do not invent", prompt)
        self.assertIn("data, not instructions", prompt)


# ------------------------------------------------------ expert shortlisting

def judged(index, source="internal", gate="accepted", rating="related",
           confidence="high", status=ai_review.STATUS_COMPLETED,
           record_id=None):
    return {
        "pair_key": "k%d" % index,
        "record_id": record_id or ("rec%02d" % (index % 6)),
        "record_title": "Record %d" % (index % 6),
        "source": source,
        "candidate_title": "Candidate %d" % index,
        "candidate_doi": None,
        "ai_rating": rating,
        "ai_confidence": confidence,
        "ai_reason": "because",
        "ai_status": status,
        "ai_error": "",
        "model": "m",
        "evaluated_at": "t",
        "abstracts_available": True,
        "gate_decision": gate,
        "in_top5": True,
        "evaluation_type": ai_review.EVALUATION_TYPE,
    }


class TestExpertShortlist(unittest.TestCase):
    def mixed(self):
        rows = []
        n = 0
        for _ in range(8):     # gate accepted, AI unrelated
            rows.append(judged(n, gate="accepted", rating="unrelated")); n += 1
        for _ in range(8):     # gate rejected, AI related
            rows.append(judged(n, gate="rejected", rating="related")); n += 1
        for _ in range(8):     # low confidence
            rows.append(judged(n, gate="accepted", rating="partial",
                               confidence="low")); n += 1
        for _ in range(8):     # ordinary agreement
            rows.append(judged(n, gate="accepted", rating="related")); n += 1
        return rows

    def test_it_never_exceeds_the_cap(self):
        shortlist, _ = ai_review.select_for_expert(self.mixed(), limit=30)
        self.assertLessEqual(len(shortlist), 30)

    def test_each_risk_category_is_represented(self):
        shortlist, _ = ai_review.select_for_expert(self.mixed(), limit=30)
        present = {category for category, _ in shortlist}
        for required in (ai_review.CATEGORY_FALSE_POSITIVE,
                         ai_review.CATEGORY_FALSE_NEGATIVE,
                         ai_review.CATEGORY_LOW_CONFIDENCE):
            self.assertIn(required, present, required)

    def test_no_single_category_swamps_the_list(self):
        # 200 false positives and a handful of everything else: the list must
        # still sample the other kinds of disagreement.
        rows = [judged(i, gate="accepted", rating="unrelated")
                for i in range(200)]
        rows += [judged(500 + i, gate="rejected", rating="related")
                 for i in range(4)]
        shortlist, _ = ai_review.select_for_expert(rows, limit=30)
        counts = {}
        for category, _ in shortlist:
            counts[category] = counts.get(category, 0) + 1
        self.assertLessEqual(counts[ai_review.CATEGORY_FALSE_POSITIVE], 26)
        self.assertEqual(4, counts[ai_review.CATEGORY_FALSE_NEGATIVE])

    def test_a_pair_appears_in_exactly_one_category(self):
        shortlist, _ = ai_review.select_for_expert(self.mixed(), limit=30)
        keys = [row["pair_key"] for _, row in shortlist]
        self.assertEqual(len(keys), len(set(keys)))

    def test_internal_external_disagreement_is_detected(self):
        rows = []
        for i in range(4):
            rows.append(judged(i, source="internal", gate="accepted",
                               rating="related", record_id="split"))
        for i in range(4):
            rows.append(judged(10 + i, source="recommendations_default",
                               gate="accepted", rating="unrelated",
                               record_id="split"))
        buckets = ai_review.categorize(rows)
        # The unrelated+accepted rows land in the false-positive bucket first
        # (more diagnostic); the record is still recognised as conflicted.
        self.assertTrue(buckets[ai_review.CATEGORY_FALSE_POSITIVE])
        rows.append(judged(99, source="internal", gate="rejected",
                           rating="partial", record_id="split"))
        buckets = ai_review.categorize(rows)
        self.assertTrue(buckets[ai_review.CATEGORY_SOURCE_CONFLICT])

    def test_unjudged_rows_never_reach_the_expert_file(self):
        rows = self.mixed() + [
            judged(900, status=ai_review.STATUS_PROVIDER_ERROR, rating=""),
            judged(901, status=ai_review.STATUS_INSUFFICIENT, rating=""),
        ]
        shortlist, _ = ai_review.select_for_expert(rows, limit=30)
        for _, row in shortlist:
            self.assertEqual(ai_review.STATUS_COMPLETED, row["ai_status"])

    def test_the_shortlist_is_deterministic(self):
        rows = self.mixed()
        first, _ = ai_review.select_for_expert(rows, limit=30)
        second, _ = ai_review.select_for_expert(list(reversed(rows)), limit=30)
        self.assertEqual([(c, r["pair_key"]) for c, r in first],
                         [(c, r["pair_key"]) for c, r in second])


# --------------------------------------------------------------- end to end

class FakeGemini:
    """Stands in for assist.call_gemini, recording every payload."""

    def __init__(self, answers=None, errors=None):
        self.payloads = []
        self.prompts = []
        self.schemas = []
        self._answers = list(answers or [])
        self._errors = list(errors or [])

    def __call__(self, cfg, payload, system_prompt, schema,
                 max_output_tokens=None):
        self.payloads.append(payload)
        self.prompts.append(system_prompt)
        self.schemas.append(schema)
        if self._errors:
            error = self._errors.pop(0)
            if error:
                return None, error
        if self._answers:
            return self._answers.pop(0), None
        return answer(), None


CONFIGURED = {"QRESP_GEMINI_ENABLED": "1",
              "QRESP_GEMINI_API_KEY": "gemini-super-secret"}


class TestAiLabelCommand(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp(prefix="ai-label-")
        self.write_raw()
        # A human file that must survive everything below untouched.
        self.human = os.path.join(self.dir, "human-review.tsv")
        with io.open(self.human, "w", encoding="utf-8", newline="\n") as f:
            f.write(core.render_tsv([core.TSV_COLUMNS]))
        self.human_bytes = io.open(self.human, encoding="utf-8").read()

    def tearDown(self):
        shutil.rmtree(self.dir, ignore_errors=True)

    def write_raw(self, records=None):
        records = records or [{
            **record(i),
            "status": "ok", "flags": [], "provider_outcomes": {},
            "internal": [candidate(title="Internal candidate %d" % i)],
            "external": {"recommendations_default": [
                candidate(title="External candidate %d" % i,
                          source="recommendations_default",
                          gate_decision="rejected", in_top5=False,
                          score=1.0)]},
        } for i in range(3)]
        path = os.path.join(self.dir, "raw-results.jsonl")
        with io.open(path, "w", encoding="utf-8", newline="\n") as handle:
            for row in records:
                handle.write(json.dumps(row, ensure_ascii=False) + "\n")

    def run_ai(self, gemini=None, argv_extra=(), env=None):
        gemini = gemini or FakeGemini()
        argv = ["ai-label", "--output-dir", self.dir, "--rate-limit", "0"]
        argv.extend(argv_extra)
        with mock.patch.dict("os.environ", env or CONFIGURED):
            with mock.patch("project.assist.call_gemini", gemini):
                code = related_eval.main(argv)
        return code, gemini

    def read(self, name):
        with io.open(os.path.join(self.dir, name), encoding="utf-8") as f:
            return f.read()

    def lines(self, name):
        return [l for l in self.read(name).split("\n") if l]

    # -- core behaviour ---------------------------------------------------

    def test_it_writes_all_four_files(self):
        code, _ = self.run_ai()
        self.assertEqual(0, code)
        for name in ("ai-review.tsv", "ai-review.jsonl", "ai-summary.json",
                     "expert-review.tsv"):
            self.assertTrue(os.path.isfile(os.path.join(self.dir, name)), name)

    def test_one_provider_call_per_pair(self):
        _, gemini = self.run_ai()
        # 3 records x (1 internal + 1 default) = 6 pairs
        self.assertEqual(6, len(gemini.payloads))
        for payload in gemini.payloads:
            self.assertEqual({"task", "reference_paper", "candidate_paper"},
                             set(payload))

    def test_no_payload_ever_carries_a_gate_decision(self):
        _, gemini = self.run_ai()
        blob = json.dumps(gemini.payloads)
        for leaked in ("gate_score", "gate_decision", "rejection_reason",
                       "in_top5", "accepted", "rejected",
                       "High title and abstract similarity"):
            self.assertNotIn(leaked, blob, leaked)

    def test_the_human_review_file_is_never_touched(self):
        self.run_ai()
        self.assertEqual(self.human_bytes,
                         io.open(self.human, encoding="utf-8").read())

    def test_a_provider_failure_does_not_stop_the_run(self):
        gemini = FakeGemini(errors=["the provider is unavailable", None,
                                    None, None, None, None])
        code, gemini = self.run_ai(gemini=gemini)
        self.assertEqual(0, code)
        rows = [json.loads(l) for l in self.lines("ai-review.jsonl")]
        statuses = {r["ai_status"] for r in rows}
        self.assertIn(ai_review.STATUS_PROVIDER_ERROR, statuses)
        self.assertIn(ai_review.STATUS_COMPLETED, statuses)
        self.assertEqual(6, len(rows))

    def test_a_raised_exception_is_contained(self):
        class Exploding(FakeGemini):
            def __call__(self, *args, **kwargs):
                raise RuntimeError("boom")
        code, _ = self.run_ai(gemini=Exploding())
        self.assertEqual(0, code)
        rows = [json.loads(l) for l in self.lines("ai-review.jsonl")]
        self.assertEqual(6, len(rows))
        self.assertTrue(all(r["ai_status"] == ai_review.STATUS_PROVIDER_ERROR
                            for r in rows))

    def test_an_unusable_answer_is_recorded_not_guessed_at(self):
        gemini = FakeGemini(answers=[json.dumps(
            {"rating": "sort of", "confidence": "high", "reason": "x"})])
        self.run_ai(gemini=gemini)
        rows = [json.loads(l) for l in self.lines("ai-review.jsonl")]
        bad = [r for r in rows if r["ai_status"]
               == ai_review.STATUS_PROVIDER_ERROR]
        self.assertTrue(bad)
        self.assertEqual("", bad[0]["ai_rating"])
        self.assertIn("rating", bad[0]["ai_error"])

    # -- cache / resume ---------------------------------------------------

    def test_completed_pairs_are_not_asked_again(self):
        _, first = self.run_ai()
        self.assertEqual(6, len(first.payloads))
        _, second = self.run_ai()
        self.assertEqual(0, len(second.payloads),
                         "a second run must reuse the cache")

    def test_an_interrupted_run_resumes_where_it_stopped(self):
        class StopsHalfway(FakeGemini):
            def __call__(self, *args, **kwargs):
                if len(self.payloads) >= 3:
                    raise KeyboardInterrupt()
                return super().__call__(*args, **kwargs)
        with self.assertRaises(KeyboardInterrupt):
            self.run_ai(gemini=StopsHalfway())
        # Everything judged before the interruption was flushed to disk.
        rows = [json.loads(l) for l in self.lines("ai-review.jsonl")]
        self.assertEqual(3, len(rows))
        _, resumed = self.run_ai()
        self.assertEqual(3, len(resumed.payloads),
                         "only the unjudged pairs are re-asked")

    def test_failures_are_retried_only_when_asked(self):
        self.run_ai(gemini=FakeGemini(errors=["down"] * 6))
        _, again = self.run_ai()
        self.assertEqual(0, len(again.payloads))
        _, retried = self.run_ai(argv_extra=["--retry-errors"])
        self.assertEqual(6, len(retried.payloads))

    # -- metadata handling ------------------------------------------------

    def test_a_pair_without_titles_is_never_sent(self):
        self.write_raw([{
            **record(0, title=""),
            "status": "ok", "flags": [], "provider_outcomes": {},
            "internal": [candidate()], "external": {},
        }])
        _, gemini = self.run_ai()
        self.assertEqual([], gemini.payloads)
        rows = [json.loads(l) for l in self.lines("ai-review.jsonl")]
        self.assertEqual(ai_review.STATUS_INSUFFICIENT, rows[0]["ai_status"])

    def test_a_missing_abstract_forces_low_confidence(self):
        self.write_raw([{
            **record(0, abstract=""),
            "status": "ok", "flags": [], "provider_outcomes": {},
            "internal": [candidate(abstract="")], "external": {},
        }])
        self.run_ai(gemini=FakeGemini(answers=[answer(confidence="high")]))
        rows = [json.loads(l) for l in self.lines("ai-review.jsonl")]
        self.assertEqual("low", rows[0]["ai_confidence"])
        self.assertFalse(rows[0]["abstracts_available"])

    # -- outputs ----------------------------------------------------------

    def test_the_expert_file_is_capped_and_leaves_the_rating_blank(self):
        self.run_ai()
        lines = self.lines("expert-review.tsv")
        self.assertEqual("\t".join(ai_review.EXPERT_REVIEW_COLUMNS), lines[0])
        self.assertLessEqual(len(lines) - 1, 30)
        columns = lines[0].split("\t")
        ri = columns.index("human_rating")
        ni = columns.index("human_note")
        for line in lines[1:]:
            cells = line.split("\t")
            self.assertEqual(len(columns), len(cells))
            self.assertEqual("", cells[ri])
            self.assertEqual("", cells[ni])

    def test_every_output_says_it_is_provisional(self):
        self.run_ai()
        summary = json.loads(self.read("ai-summary.json"))
        self.assertEqual("ai_provisional", summary["evaluation_type"])
        self.assertIn("provisional", summary["disclaimer"].lower())
        for banned in ("ground truth", "validated", "verified"):
            self.assertNotIn(
                banned, summary["disclaimer"].lower().replace(
                    "not expert ground truth", "").replace(
                    "not validated", "").replace("not verified", ""))
        rows = [json.loads(l) for l in self.lines("ai-review.jsonl")]
        self.assertTrue(all(r["evaluation_type"] == "ai_provisional"
                            for r in rows))

    def test_no_secret_reaches_any_output_file(self):
        self.run_ai()
        blob = "".join(self.read(name) for name in
                       ("ai-review.tsv", "ai-review.jsonl",
                        "ai-summary.json", "expert-review.tsv"))
        for secret in ("gemini-super-secret", "x-goog-api-key",
                       "Authorization", "system_instruction"):
            self.assertNotIn(secret, blob, secret)
        # The system prompt itself is not echoed into the artifacts either.
        self.assertNotIn("You judge whether two scientific papers", blob)

    def test_the_run_changes_no_gate_score(self):
        raw_before = self.read("raw-results.jsonl")
        self.run_ai()
        self.assertEqual(raw_before, self.read("raw-results.jsonl"))
        rows = [json.loads(l) for l in self.lines("ai-review.jsonl")]
        # The AI's opinion is recorded ALONGSIDE the gate's, never over it.
        self.assertTrue(all("gate_decision" in r for r in rows))
        self.assertTrue(all(r["gate_decision"] in ("accepted", "rejected")
                            for r in rows))

    def test_it_writes_nothing_to_mongo(self):
        from project.models import RelatedResearchCache
        with mock.patch.object(RelatedResearchCache, "objects") as objects:
            self.run_ai()
            self.assertFalse(objects.called)

    # -- configuration ----------------------------------------------------

    def test_without_a_key_it_refuses_rather_than_pretending(self):
        code, gemini = self.run_ai(
            env={"QRESP_GEMINI_ENABLED": "", "QRESP_GEMINI_API_KEY": ""})
        self.assertEqual(3, code)
        self.assertEqual([], gemini.payloads)

    def test_dry_run_builds_payloads_but_contacts_nobody(self):
        code, gemini = self.run_ai(
            argv_extra=["--dry-run"],
            env={"QRESP_GEMINI_ENABLED": "", "QRESP_GEMINI_API_KEY": ""})
        self.assertEqual(0, code)
        self.assertEqual([], gemini.payloads)

    def test_sources_can_be_restricted(self):
        _, gemini = self.run_ai(argv_extra=["--sources", "internal"])
        self.assertEqual(3, len(gemini.payloads))

    def test_the_pair_limit_is_honoured(self):
        _, gemini = self.run_ai(argv_extra=["--limit", "2"])
        self.assertEqual(2, len(gemini.payloads))


if __name__ == "__main__":
    unittest.main()
