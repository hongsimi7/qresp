import {
  cappedSources,
  detectionKey,
  detectionsFor,
  describeEvidence,
  groupDetections,
  evidenceAt,
  parsedSourcesOf,
  proposalSeed,
  sourcesOf,
} from "../Utils/codeSuggestions";

// A suggestion exists because a line of code says so. The backend has already
// refused everything it could not read literally; this is the second half of
// the rule: the path it read has to be EXACTLY a path an artifact stores, or
// else the artifact does not exist yet and has to be proposed.

const BY_ID = {
  c0: { id: "c0", caption: "Density of states", imageFile: "figures/dos.png" },
  s0: { id: "s0", readme: "plot_dos.py", files: ["scripts/plot_dos.py"] },
  d0: { id: "d0", readme: "raw data", files: ["data/raw.csv"] },
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

const SAVES = {
  script: "scripts/plot_dos.py",
  path: "figures/dos.png",
  mode: "write",
  call: "matplotlib.pyplot.savefig",
  literal: "figures/dos.png",
  line: 40,
  cell: null,
};

const WRITES = {
  script: "scripts/plot_dos.py",
  path: "derived/clean.csv",
  mode: "write",
  call: "DataFrame.to_csv",
  literal: "derived/clean.csv",
  line: 30,
  cell: null,
};

describe("which scripts can be looked at", () => {
  it("finds EVERY source a script records, not the first one", () => {
    // A pipeline split in two, or a driver beside the notebook it came from.
    // Taking only the first meant a figure written in the second file did
    // not exist as far as this was concerned.
    expect(
      sourcesOf({ files: ["scripts/b.py", "notebooks/a.ipynb", "notes.txt"] })
    ).toEqual(["notebooks/a.ipynb", "scripts/b.py"]);
  });

  it("reads the same record the same way every time", () => {
    const one = sourcesOf({ files: ["b.py", "a.py", "b.py"] });
    const two = sourcesOf({ files: ["b.py", "b.py", "a.py"] });
    expect(one).toEqual(["a.py", "b.py"]);
    expect(two).toEqual(one);
  });

  it("finds none on a script typed in by hand", () => {
    expect(sourcesOf({ readme: "I described this myself" })).toEqual([]);
    expect(sourcesOf(undefined)).toEqual([]);
  });

  it("counts a shell script as a source, and not as a parsable one", () => {
    // A shell line builds its paths at run time, so the parser finds nothing
    // in it -- which is exactly the case the optional second opinion is for.
    // The row's action has to stay live, or there is no way to ask.
    expect(sourcesOf({ files: ["src/main.f90", "run.sh"] })).toEqual(
      ["run.sh"]
    );
    expect(parsedSourcesOf({ files: ["src/main.f90", "run.sh"] })).toEqual([]);
    expect(parsedSourcesOf({ files: ["run.sh", "plot.py"] })).toEqual(
      ["plot.py"]
    );
  });

  it("finds none in a language it cannot read at all", () => {
    expect(sourcesOf({ files: ["src/main.f90", "Makefile"] })).toEqual([]);
  });

  it("names what it will not look at rather than dropping it", () => {
    const many = {
      files: Array.from({ length: 23 }, (unused, i) =>
        `scripts/step_${String(i).padStart(2, "0")}.py`),
    };
    const capped = cappedSources(many);
    expect(capped).toHaveLength(3);
    expect(capped[0]).toEqual({
      path: "scripts/step_20.py", reason: "source_cap",
    });
    // A record inside the bound has nothing to report.
    expect(cappedSources(BY_ID.s0)).toEqual([]);
  });
});

describe("what one script's code says", () => {
  it("reads a dataset into the script that reads it", () => {
    const [item] = detectionsFor([READ], "s0", BY_ID, []);
    expect(item.group).toBe("input_datasets");
    expect(item.existingId).toBe("d0");
    expect(item.edge).toEqual({ from: "d0", to: "s0", type: "consumes" });
  });

  it("points the script at the figure it saves", () => {
    const [item] = detectionsFor([SAVES], "s0", BY_ID, []);
    expect(item.group).toBe("output_figures");
    expect(item.edge).toEqual({ from: "s0", to: "c0", type: "generates" });
  });

  it("uses the generic directional edge for data a script writes", () => {
    // "This script produced this dataset" has no vocabulary of its own in
    // Qresp, and inventing one would put a word in the record that nothing
    // else understands.
    const [item] = detectionsFor(
      [{ ...WRITES, path: "data/raw.csv", literal: "data/raw.csv" }],
      "s0", BY_ID, []
    );
    expect(item.group).toBe("output_datasets");
    expect(item.edge).toEqual({ from: "s0", to: "d0", type: "links_to" });
  });

  it("classifies a written file by the CALL, not by its extension", () => {
    // A `.dat` written by savefig is still a figure, and a `.png` written by
    // to_csv would be a mistake worth showing rather than reclassifying.
    const [odd] = detectionsFor(
      [{ ...SAVES, path: "figures/plot.dat", literal: "figures/plot.dat" }],
      "s0", BY_ID, []
    );
    expect(odd.kind).toBe("chart");
    const [other] = detectionsFor(
      [{ ...WRITES, path: "derived/thing.png", literal: "derived/thing.png" }],
      "s0", BY_ID, []
    );
    expect(other.kind).toBe("dataset");
  });

  it("proposes an artifact for a file the draft does not hold", () => {
    const [item] = detectionsFor([WRITES], "s0", BY_ID, []);
    expect(item.existingId).toBe("");
    // No edge yet: the other end does not exist, and nothing is invented.
    expect(item.edge).toBeNull();
    expect(item.name).toBe("clean.csv");
    expect(item.path).toBe("derived/clean.csv");
    expect(proposalSeed(item)).toEqual({ files: "derived/clean.csv" });
  });

  it("seeds a proposed figure with the image the code saved", () => {
    const [item] = detectionsFor(
      [{ ...SAVES, path: "figures/new.png", literal: "figures/new.png" }],
      "s0", BY_ID, []
    );
    expect(proposalSeed(item)).toEqual({ imageFile: "figures/new.png" });
  });

  it("only reads the script that was asked about", () => {
    const other = { ...READ, script: "scripts/other.py" };
    expect(detectionsFor([other], "s0", BY_ID, [])).toEqual([]);
  });

  it("says nothing for a script with no source at all", () => {
    const manual = { ...BY_ID, s0: { id: "s0", readme: "by hand" } };
    expect(detectionsFor([READ], "s0", manual, [])).toEqual([]);
  });

  it("carries the evidence a curator can check", () => {
    const [item] = detectionsFor([READ], "s0", BY_ID, []);
    expect(item.evidences).toHaveLength(1);
    expect(describeEvidence(item.evidences[0])).toBe(
      'scripts/plot_dos.py, line 12 — pandas.read_csv("data/raw.csv")'
    );
  });

  it("says which cell, when the evidence is in a notebook", () => {
    const byId = {
      ...BY_ID,
      s0: { id: "s0", files: ["notebooks/prep.ipynb"] },
    };
    const [item] = detectionsFor(
      [{ ...READ, script: "notebooks/prep.ipynb", cell: 3, line: 2 }],
      "s0", byId, []
    );
    expect(describeEvidence(item.evidences[0])).toBe(
      'notebooks/prep.ipynb, cell 3, line 2 — pandas.read_csv("data/raw.csv")'
    );
    expect(evidenceAt(item.evidences[0])).toBe(
      "notebooks/prep.ipynb:cell 3:2"
    );
  });

  it("never links two artifacts because their names are alike", () => {
    // `dos.py` and `dos.png` share a name and nothing else. Only a line of
    // code relates them, and there is none here.
    const alike = {
      s0: { id: "s0", files: ["scripts/dos.py"] },
      c0: { id: "c0", imageFile: "figures/dos.png" },
    };
    expect(detectionsFor([], "s0", alike, [])).toEqual([]);
  });

  it("refuses a path that two artifacts both claim", () => {
    const shared = { ...BY_ID, d1: { id: "d1", files: ["data/raw.csv"] } };
    const [item] = detectionsFor([READ], "s0", shared, []);
    // Ambiguous: it is proposed as new rather than attached to a guess.
    expect(item.existingId).toBe("");
  });

  it("does not offer a relationship that already runs that way", () => {
    const edges = [{ from: "d0", to: "s0", type: "consumes" }];
    expect(detectionsFor([READ], "s0", BY_ID, edges)).toEqual([]);
  });

  it("still offers one when only the OPPOSITE direction exists", () => {
    const edges = [{ from: "s0", to: "d0", type: "links_to" }];
    expect(detectionsFor([READ], "s0", BY_ID, edges)).toHaveLength(1);
  });

  it("reads a legacy untyped edge as the arrow it is", () => {
    // Stored as a bare pair, with no type. It still counts as "this already
    // runs that way", and it is not converted or rewritten.
    expect(detectionsFor([READ], "s0", BY_ID, [["d0", "s0"]])).toEqual([]);
  });

  it("is stable: the same draft gives the same list, once each", () => {
    const twice = [READ, { ...READ }];
    const first = detectionsFor(twice, "s0", BY_ID, []);
    expect(first).toHaveLength(1);
    expect(detectionsFor(twice, "s0", BY_ID, [])).toEqual(first);
    expect(detectionKey(first[0])).toBe("input_datasets:data/raw.csv");
  });

  it("does not treat a figure's input files as something a script makes", () => {
    // A Chart's `files` are its INPUTS. A script writing one of them has not
    // made the figure.
    const withInputs = {
      ...BY_ID,
      c0: { ...BY_ID.c0, files: ["data/for_figure.csv"] },
    };
    const [item] = detectionsFor(
      [{ ...SAVES, path: "data/for_figure.csv",
         literal: "data/for_figure.csv" }],
      "s0", withInputs, []
    );
    expect(item.existingId).toBe("");
  });
});

describe("the three groups", () => {
  it("keeps them in reading order and drops the empty ones", () => {
    const groups = groupDetections(
      detectionsFor([WRITES, SAVES, READ], "s0", BY_ID, [])
    );
    expect(groups.map((entry) => entry.label)).toEqual([
      "Input datasets",
      "Output figures",
      "Output datasets",
    ]);
    const onlyReads = groupDetections(detectionsFor([READ], "s0", BY_ID, []));
    expect(onlyReads.map((entry) => entry.label)).toEqual(["Input datasets"]);
  });

  it("is empty when the code named nothing", () => {
    expect(groupDetections(detectionsFor([], "s0", BY_ID, []))).toEqual([]);
  });
});


// A Script artifact is one RECORD, not one file. It may hold a driver and the
// notebook it grew out of, or a pipeline split in two, and what the second
// file says is exactly as true as what the first one says.
describe("a script recorded as several files", () => {
  const TWO = {
    ...BY_ID,
    s0: {
      id: "s0",
      readme: "the whole pipeline",
      files: ["notebooks/rerun.ipynb", "scripts/plot_dos.py"],
    },
  };

  const FROM_NOTEBOOK = {
    script: "notebooks/rerun.ipynb",
    path: "figures/dos.png",
    mode: "write",
    call: "matplotlib.pyplot.savefig",
    literal: "figures/dos.png",
    line: 4,
    cell: 7,
  };

  it("reads what every one of them says", () => {
    // The first file reads a dataset; the second saves the figure. Both
    // relationships are the script's.
    const found = detectionsFor([READ, FROM_NOTEBOOK], "s0", TWO, []);
    expect(found.map((item) => item.edge)).toEqual([
      { from: "d0", to: "s0", type: "consumes" },
      { from: "s0", to: "c0", type: "generates" },
    ]);
  });

  it("does not need them in any particular order", () => {
    const forwards = detectionsFor([READ, FROM_NOTEBOOK], "s0", TWO, []);
    const backwards = detectionsFor([FROM_NOTEBOOK, READ], "s0", TWO, []);
    expect(backwards.map((i) => detectionKey(i)).sort()).toEqual(
      forwards.map((i) => detectionKey(i)).sort()
    );
  });

  it("offers ONE arrow when two files state the same relationship", () => {
    // Two scripts of the same record reading one dataset is one arrow with
    // two reasons -- not two identical proposals to notice are the same.
    const alsoReads = {
      ...READ, script: "notebooks/rerun.ipynb", line: 9, cell: 2,
    };
    const found = detectionsFor([READ, alsoReads], "s0", TWO, []);
    expect(found).toHaveLength(1);
    expect(found[0].edge).toEqual({ from: "d0", to: "s0",
                                   type: "consumes" });
    // ...and both places are kept, so either can be checked.
    expect(found[0].evidences.map(evidenceAt)).toEqual([
      "notebooks/rerun.ipynb:cell 2:9",
      "scripts/plot_dos.py:12",
    ]);
  });

  it("does not repeat the same place twice", () => {
    const found = detectionsFor([READ, { ...READ }], "s0", TWO, []);
    expect(found[0].evidences).toHaveLength(1);
  });

  it("still refuses a relationship the record already has", () => {
    const alsoReads = { ...READ, script: "notebooks/rerun.ipynb", line: 9 };
    const edges = [{ from: "d0", to: "s0", type: "consumes" }];
    expect(detectionsFor([READ, alsoReads], "s0", TWO, edges)).toEqual([]);
  });

  it("keeps what the readable files said when one was not read", () => {
    // The folder scan could not open the notebook. That is reported
    // elsewhere; here, the script's other source still answers.
    const found = detectionsFor([READ], "s0", TWO, []);
    expect(found.map((item) => item.path)).toEqual(["data/raw.csv"]);
  });

  it("looks at no more than the cap, and only the first by path", () => {
    const many = {
      ...BY_ID,
      s0: {
        id: "s0",
        files: Array.from({ length: 22 }, (unused, i) =>
          `scripts/step_${String(i).padStart(2, "0")}.py`),
      },
    };
    const inside = {
      ...READ, script: "scripts/step_00.py",
    };
    const outside = {
      ...READ, script: "scripts/step_21.py",
      path: "derived/clean.csv", literal: "derived/clean.csv",
    };
    const found = detectionsFor([inside, outside], "s0", many, []);
    expect(found.map((item) => item.path)).toEqual(["data/raw.csv"]);
    // And the ones it did not look at are named rather than dropped.
    expect(cappedSources(many.s0).map((entry) => entry.path)).toEqual([
      "scripts/step_20.py",
      "scripts/step_21.py",
    ]);
  });
});
