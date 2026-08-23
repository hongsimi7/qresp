import { render, screen, within } from "@testing-library/react";

import Summary from "../components/Paper/Summary";
import { TableSearchContext } from "../components/Table/TableSearch";
import {
  buildServerNames,
  hostedBy,
  hostedByLabel,
  mergeRecordsByServer,
  recordIdentity,
  sourceLabel,
} from "../Utils/recordSources";

const UCHICAGO = "https://paperstack.uchicago.edu";
const DUKE = "https://qresp.hybrid3.duke.edu";

const NAMES = buildServerNames([
  { qresp_server_url: UCHICAGO, qresp_server_name: "UChicago" },
  { qresp_server_url: DUKE, qresp_server_name: "Duke" },
]);

const record = (id, overrides = {}) => ({
  _Search__id: id,
  _Search__title: `Record ${id}`,
  _Search__authors: "Robin Sharedname",
  _Search__doi: `10.1000/${id}`,
  _Search__tags: ["gadgetite"],
  _Search__publication: "Journal of Placeholder Science",
  _Search__year: 2020,
  ...overrides,
});

describe("one list across two repositories", () => {
  it("labels each record with the node that published it", () => {
    const rows = mergeRecordsByServer(
      { [UCHICAGO]: [record("a")], [DUKE]: [record("b")] },
      NAMES,
      [UCHICAGO, DUKE]
    );
    expect(rows).toHaveLength(2);
    expect(rows[0].paper._Search__sources).toEqual([
      { server: UCHICAGO, label: "UChicago" },
    ]);
    expect(rows[1].paper._Search__sources).toEqual([
      { server: DUKE, label: "Duke" },
    ]);
  });

  it("shows a paper on both nodes once, with both tags", () => {
    const shared = record("shared");
    const rows = mergeRecordsByServer(
      { [UCHICAGO]: [shared], [DUKE]: [{ ...shared }] },
      NAMES,
      [UCHICAGO, DUKE]
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].paper._Search__sources.map((s) => s.label)).toEqual([
      "UChicago",
      "Duke",
    ]);
  });

  it("merges on the DOI however it was written", () => {
    const rows = mergeRecordsByServer(
      {
        [UCHICAGO]: [record("a", { _Search__doi: "10.1000/Shared" })],
        [DUKE]: [
          record("b", { _Search__doi: "https://doi.org/10.1000/shared" }),
        ],
      },
      NAMES,
      [UCHICAGO, DUKE]
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].paper._Search__sources).toHaveLength(2);
  });

  it("never merges records that have no DOI", () => {
    // Titles collide; showing two different papers as one is a worse failure
    // than showing one paper twice.
    const rows = mergeRecordsByServer(
      {
        [UCHICAGO]: [record("a", { _Search__doi: "" })],
        [DUKE]: [record("b", { _Search__doi: "" })],
      },
      NAMES,
      [UCHICAGO, DUKE]
    );
    expect(rows).toHaveLength(2);
    expect(recordIdentity({ _Search__doi: "" })).toBe("");
  });

  it("keeps the first node's copy as the one that is linked to", () => {
    // A record's id resolves only on its own server.
    const shared = record("shared");
    const rows = mergeRecordsByServer(
      { [DUKE]: [{ ...shared }], [UCHICAGO]: [shared] },
      NAMES,
      [DUKE, UCHICAGO]
    );
    expect(rows[0].paper._Search__server).toBe(DUKE);
  });

  it("still lists a node whose records arrived but which was not ordered", () => {
    const rows = mergeRecordsByServer(
      { [UCHICAGO]: [record("a")], [DUKE]: [record("b")] },
      NAMES,
      [UCHICAGO]
    );
    expect(rows).toHaveLength(2);
  });

  it("shows the surviving node's records when the other returned none", () => {
    // A node being empty or unreachable costs its own records and nothing
    // else — /search only commits the nodes that answered.
    const rows = mergeRecordsByServer(
      { [UCHICAGO]: [record("a"), record("b")] },
      NAMES,
      [UCHICAGO, DUKE]
    );
    expect(rows).toHaveLength(2);
    rows.forEach((row) =>
      expect(row.paper._Search__sources[0].label).toBe("UChicago")
    );
  });

  it("is an empty list when no node returned anything", () => {
    expect(mergeRecordsByServer({}, NAMES, [UCHICAGO, DUKE])).toEqual([]);
  });

  it("carries the year through for sorting", () => {
    const rows = mergeRecordsByServer(
      { [UCHICAGO]: [record("a", { _Search__year: 1999 })] },
      NAMES,
      [UCHICAGO]
    );
    expect(rows[0].year).toBe(1999);
  });

  describe("labels", () => {
    it("uses the name the federation list published", () => {
      expect(sourceLabel(UCHICAGO, NAMES)).toBe("UChicago");
      expect(sourceLabel(DUKE, NAMES)).toBe("Duke");
    });

    it("falls back to the host rather than inventing a label", () => {
      // A node this deployment holds no name for is still identified — by a
      // fact, not by a guess made from the URL.
      expect(sourceLabel("https://qresp.example.org", NAMES)).toBe(
        "qresp.example.org"
      );
      expect(sourceLabel("https://qresp.example.org", {})).toBe(
        "qresp.example.org"
      );
    });

    it("ignores a trailing slash", () => {
      expect(sourceLabel(`${DUKE}/`, NAMES)).toBe("Duke");
    });

    it("has nothing to say about a missing server", () => {
      expect(sourceLabel("", NAMES)).toBe("");
    });

    // The "Hosted by" wording lives in ONE place, so two components cannot
    // spell the same product decision differently.
    it("builds the hosting badge text from the registry name", () => {
      expect(hostedByLabel(UCHICAGO, NAMES)).toBe("Hosted by UChicago");
      expect(hostedBy("Duke University")).toBe("Hosted by Duke University");
    });

    it("says nothing rather than 'Hosted by' with no node", () => {
      expect(hostedBy("")).toBe("");
      expect(hostedByLabel("", NAMES)).toBe("");
    });

    it("derives the badge from the server, never from the record's fields", () => {
      // A record whose authors, DOI and institution all point elsewhere is
      // still labelled by the node it was READ FROM. The badge is
      // provenance, not a claim about the paper.
      expect(
        hostedByLabel(DUKE, NAMES)
      ).toBe("Hosted by Duke");
      const row = mergeRecordsByServer(
        {
          [DUKE]: [
            record("a", {
              _Search__authors: "Someone At Stanford",
              _Search__doi: "10.1000/uchicago-press",
              _Search__institution: "University of Chicago",
            }),
          ],
        },
        NAMES,
        [DUKE]
      )[0];
      expect(row.paper._Search__sources[0].label).toBe("Duke");
    });
  });
});

// Two chips, two different questions. Conflating them would put a curator's
// optional, hand-typed claim and an automatic fact about the serving node
// into one badge that means neither.
describe("record Institution versus hosting node", () => {
  const inTable = (children) => (
    <TableSearchContext.Provider value={{ query: "", setQuery: () => {} }}>
      {children}
    </TableSearchContext.Provider>
  );

  const cardFor = (overrides, sources) =>
    render(
      inTable(
        <Summary
          rowdata={{ ...record("a", overrides), _Search__sources: sources }}
        />
      )
    );

  it("shows both, as separate chips, when they disagree", () => {
    cardFor({ _Search__institution: "University of Chicago" }, [
      { server: DUKE, label: "Duke University" },
    ]);
    const institution = screen.getByTestId("record-institution");
    const hosted = screen.getByTestId("record-source");
    expect(institution).toHaveTextContent("University of Chicago");
    expect(institution).not.toHaveTextContent("Hosted by");
    expect(hosted).toHaveTextContent("Hosted by Duke University");
    expect(institution).not.toBe(hosted);
  });

  it("shows the hosting badge even when no institution was entered", () => {
    cardFor({}, [{ server: DUKE, label: "Duke University" }]);
    expect(screen.queryByTestId("record-institution")).not.toBeInTheDocument();
    expect(screen.getByTestId("record-source")).toHaveTextContent(
      "Hosted by Duke University"
    );
  });

  it("shows the institution chip even for a card with no source list", () => {
    // A saved row or a single-node list carries no `_Search__sources`; the
    // record's own institution is unaffected by that.
    cardFor({ _Search__institution: "Duke University" }, undefined);
    expect(screen.getByTestId("record-institution")).toHaveTextContent(
      "Duke University"
    );
    expect(screen.queryByTestId("record-source")).not.toBeInTheDocument();
  });
});

describe("the source tag on a record card", () => {
  // Summary reads the table's search context to make a keyword tag
  // clickable. The provider is supplied here so the card can be rendered on
  // its own, which is what these assertions are about.
  const inTable = (children) => (
    <TableSearchContext.Provider value={{ query: "", setQuery: () => {} }}>
      {children}
    </TableSearchContext.Provider>
  );

  const cardFor = (sources) =>
    render(
      inTable(
        <Summary rowdata={{ ...record("a"), _Search__sources: sources }} />
      )
    );

  it("says where the record is hosted, in text rather than by colour", () => {
    cardFor([{ server: UCHICAGO, label: "University of Chicago" }]);
    const tag = screen.getByTestId("record-source");
    // The whole meaning is in the visible text: a bare "University of
    // Chicago" beside a title does not say what the relationship is.
    expect(tag).toHaveTextContent("Hosted by University of Chicago");
  });

  it("renders both tags for a paper published on both nodes", () => {
    cardFor([
      { server: UCHICAGO, label: "University of Chicago" },
      { server: DUKE, label: "Duke University" },
    ]);
    const list = screen.getByRole("list", {
      name: /qresp nodes hosting this record/i,
    });
    const tags = within(list).getAllByTestId("record-source");
    expect(tags).toHaveLength(2);
    expect(tags[0]).toHaveTextContent("Hosted by University of Chicago");
    expect(tags[1]).toHaveTextContent("Hosted by Duke University");
  });

  it("puts the hosting badge on the author row, beside the authors", () => {
    cardFor([{ server: DUKE, label: "Duke University" }]);
    const authorText = screen.getByText("Robin Sharedname");
    const list = screen.getByRole("list", {
      name: /qresp nodes hosting this record/i,
    });
    expect(list.parentElement).toBe(authorText.closest("div"));
  });

  it("falls back to the node's host rather than inventing a name", () => {
    // No display name in the registry: the badge still says something TRUE.
    cardFor([
      { server: "https://qresp.example.org", label: "qresp.example.org" },
    ]);
    expect(screen.getByTestId("record-source")).toHaveTextContent(
      "Hosted by qresp.example.org"
    );
  });

  it("renders no tag when there is nothing true to say", () => {
    render(inTable(<Summary rowdata={record("a")} />));
    expect(screen.queryByTestId("record-source")).not.toBeInTheDocument();
  });
});

// Institution: an optional, record-level fact a curator typed in by hand --
// see project.models.Paper.institution. Distinct from the source-repository
// tags above (which answer where the record is STORED, not what institution
// it is ABOUT), so it sits on the author row instead.
describe("the institution chip on a record card", () => {
  const inTable = (children) => (
    <TableSearchContext.Provider value={{ query: "", setQuery: () => {} }}>
      {children}
    </TableSearchContext.Provider>
  );

  it("shows the curator's exact institution text next to the authors", () => {
    render(
      inTable(
        <Summary
          rowdata={record("a", {
            _Search__institution: "University of Chicago",
          })}
        />
      )
    );
    const chip = screen.getByTestId("record-institution");
    // Never abbreviated -- the curator's own wording, verbatim.
    expect(chip).toHaveTextContent("University of Chicago");
    expect(chip).not.toHaveTextContent("UChicago");
    expect(
      screen.getByLabelText("Institution: University of Chicago")
    ).toBeInTheDocument();
  });

  it("renders no chip for an old record with no institution on file", () => {
    render(inTable(<Summary rowdata={record("a")} />));
    expect(
      screen.queryByTestId("record-institution")
    ).not.toBeInTheDocument();
  });

  it("puts the institution chip on the author row, not the journal line", () => {
    render(
      inTable(
        <Summary
          rowdata={record("a", {
            _Search__institution: "Duke University",
          })}
        />
      )
    );
    const authorText = screen.getByText("Robin Sharedname");
    const chip = screen.getByTestId("record-institution");
    // Same flex row: the chip's own parent is the author text's parent.
    expect(chip.parentElement).toBe(authorText.closest("div"));
  });
});
