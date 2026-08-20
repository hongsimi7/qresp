import { render, screen, within } from "@testing-library/react";

import Summary from "../components/Paper/Summary";
import { TableSearchContext } from "../components/Table/TableSearch";
import {
  buildServerNames,
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

  it("names the repository in text, not by colour", () => {
    cardFor([{ server: UCHICAGO, label: "UChicago" }]);
    const tag = screen.getByTestId("record-source");
    expect(tag).toHaveTextContent("UChicago");
  });

  it("gives the tag an accessible label that says what it is", () => {
    cardFor([{ server: DUKE, label: "Duke" }]);
    expect(
      screen.getByLabelText("Source repository: Duke")
    ).toBeInTheDocument();
  });

  it("renders both tags for a paper published on both nodes", () => {
    cardFor([
      { server: UCHICAGO, label: "UChicago" },
      { server: DUKE, label: "Duke" },
    ]);
    const list = screen.getByRole("list", {
      name: /repositories publishing this record/i,
    });
    expect(within(list).getAllByTestId("record-source")).toHaveLength(2);
  });

  it("renders no tag when there is nothing true to say", () => {
    render(inTable(<Summary rowdata={record("a")} />));
    expect(screen.queryByTestId("record-source")).not.toBeInTheDocument();
  });
});
