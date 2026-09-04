import {
  codeLinkKey,
  codeSuggestions,
  describeEvidence,
} from "../Utils/codeSuggestions";

// A suggestion here exists because a line of code says so. The backend has
// already refused everything it could not read literally; this is the second
// half of the rule: the path it read has to be EXACTLY a path an artifact in
// the draft stores, at both ends.

const BY_ID = {
  c0: { id: "c0", caption: "Density of states", imageFile: "figures/dos.png" },
  s0: { id: "s0", readme: "plot_dos.py", files: ["scripts/plot_dos.py"] },
  d0: { id: "d0", readme: "raw data", files: ["data/raw.csv"] },
  d1: { id: "d1", readme: "clean data", files: ["data/clean.csv"] },
};

const READ = {
  script: "scripts/plot_dos.py",
  path: "data/raw.csv",
  mode: "read",
  call: "pandas.read_csv",
  literal: "data/raw.csv",
  line: 12,
  cell: null,
};

const WRITES_FIGURE = {
  script: "scripts/plot_dos.py",
  path: "figures/dos.png",
  mode: "write",
  call: "matplotlib.pyplot.savefig",
  literal: "figures/dos.png",
  line: 40,
  cell: null,
};

const WRITES_DATA = {
  script: "scripts/plot_dos.py",
  path: "data/clean.csv",
  mode: "write",
  call: "DataFrame.to_csv",
  literal: "data/clean.csv",
  line: 30,
  cell: null,
};

describe("turning what the code said into an arrow", () => {
  it("reads a dataset into the script that reads it", () => {
    const [item] = codeSuggestions([READ], BY_ID, []);
    expect(item.edge).toEqual({ from: "d0", to: "s0", type: "consumes" });
  });

  it("points a script at the figure it saves", () => {
    const [item] = codeSuggestions([WRITES_FIGURE], BY_ID, []);
    expect(item.edge).toEqual({ from: "s0", to: "c0", type: "generates" });
  });

  it("uses the generic directional edge for a script that writes data", () => {
    // "This script produced this dataset" has no vocabulary of its own in
    // Qresp, and inventing one would put a word in the record that nothing
    // else understands.
    const [item] = codeSuggestions([WRITES_DATA], BY_ID, []);
    expect(item.edge).toEqual({ from: "s0", to: "d1", type: "links_to" });
  });

  it("carries the evidence a curator can check", () => {
    const [item] = codeSuggestions([READ], BY_ID, []);
    expect(item.evidence.script).toBe("scripts/plot_dos.py");
    expect(item.evidence.line).toBe(12);
    expect(item.evidence.cell).toBeNull();
    expect(describeEvidence(item.evidence)).toBe(
      'scripts/plot_dos.py, line 12 — pandas.read_csv("data/raw.csv")'
    );
  });

  it("says which cell, when the evidence is in a notebook", () => {
    const [item] = codeSuggestions(
      [{ ...READ, script: "scripts/prep.ipynb", cell: 3, line: 2 }],
      { ...BY_ID, s0: { id: "s0", files: ["scripts/prep.ipynb"] } },
      []
    );
    expect(describeEvidence(item.evidence)).toBe(
      'scripts/prep.ipynb, cell 3, line 2 — pandas.read_csv("data/raw.csv")'
    );
  });

  it("offers nothing when either end is not an artifact", () => {
    // The script is not in the draft...
    expect(
      codeSuggestions([READ], { d0: BY_ID.d0 }, [])
    ).toEqual([]);
    // ...or the file it reads is not.
    expect(
      codeSuggestions([READ], { s0: BY_ID.s0 }, [])
    ).toEqual([]);
  });

  it("never links two artifacts because their names are alike", () => {
    // `dos.py` and `dos.png` share a name and nothing else. Without a line
    // of code naming one from the other, there is no suggestion.
    const alike = {
      s0: { id: "s0", files: ["scripts/dos.py"] },
      c0: { id: "c0", imageFile: "figures/dos.png" },
    };
    expect(codeSuggestions([], alike, [])).toEqual([]);
    // Even a code fact about a DIFFERENT file makes no link between them.
    expect(
      codeSuggestions(
        [{ ...WRITES_FIGURE, script: "scripts/dos.py",
           path: "figures/other.png" }],
        alike,
        []
      )
    ).toEqual([]);
  });

  it("refuses a path that two artifacts both claim", () => {
    const shared = {
      ...BY_ID,
      d1: { id: "d1", files: ["data/raw.csv"] },
    };
    expect(codeSuggestions([READ], shared, [])).toEqual([]);
  });

  it("does not offer a relationship that already runs that way", () => {
    const edges = [{ from: "d0", to: "s0", type: "consumes" }];
    expect(codeSuggestions([READ], BY_ID, edges)).toEqual([]);
  });

  it("still offers one when only the OPPOSITE direction exists", () => {
    // A reversed pair is a real thing in this graph, and refusing to suggest
    // one because its mirror exists would hide a relationship the code
    // states outright.
    const edges = [{ from: "s0", to: "d0", type: "links_to" }];
    expect(codeSuggestions([READ], BY_ID, edges)).toHaveLength(1);
  });

  it("reads a legacy untyped edge as the arrow it is", () => {
    // Stored as a bare pair, with no type. It still counts as "this already
    // runs that way", and it is not converted or rewritten.
    expect(codeSuggestions([READ], BY_ID, [["d0", "s0"]])).toEqual([]);
  });

  it("is stable: the same draft gives the same list, once each", () => {
    const twice = [READ, { ...READ }];
    const first = codeSuggestions(twice, BY_ID, []);
    const second = codeSuggestions(twice, BY_ID, []);
    expect(first).toHaveLength(1);
    expect(second).toEqual(first);
    expect(codeLinkKey(first[0])).toBe(codeLinkKey(second[0]));
  });

  it("does not treat a figure's input files as something a script makes", () => {
    // A Chart's `files` are its INPUTS. A script writing one of them has not
    // made the figure, so it is not `generates` evidence.
    const withInputs = {
      ...BY_ID,
      c0: { ...BY_ID.c0, files: ["data/for_figure.csv"] },
    };
    expect(
      codeSuggestions(
        [{ ...WRITES_DATA, path: "data/for_figure.csv" }],
        withInputs,
        []
      )
    ).toEqual([]);
  });

  it("handles many scripts and many figures without inventing a pairing", () => {
    const many = {
      s0: { id: "s0", files: ["scripts/a.py"] },
      s1: { id: "s1", files: ["scripts/b.py"] },
      c0: { id: "c0", imageFile: "figures/one.png" },
      c1: { id: "c1", imageFile: "figures/two.png" },
      d0: { id: "d0", files: ["data/shared.csv"] },
    };
    const links = [
      { ...READ, script: "scripts/a.py", path: "data/shared.csv" },
      { ...READ, script: "scripts/b.py", path: "data/shared.csv" },
      { ...WRITES_FIGURE, script: "scripts/a.py", path: "figures/one.png" },
      { ...WRITES_FIGURE, script: "scripts/b.py", path: "figures/two.png" },
    ];
    const out = codeSuggestions(links, many, []);
    expect(out.map((item) => item.edge)).toEqual([
      { from: "d0", to: "s0", type: "consumes" },
      { from: "d0", to: "s1", type: "consumes" },
      { from: "s0", to: "c0", type: "generates" },
      { from: "s1", to: "c1", type: "generates" },
    ]);
    // One dataset feeding two scripts is two arrows to the SAME dataset --
    // nothing is duplicated to make the second one.
    expect(new Set(out.map((item) => item.edge.from)).size).toBe(3);
  });
});
