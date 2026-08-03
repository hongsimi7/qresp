import fs from "fs";
import path from "path";

import {
  ARTIFACT_FIELDS,
  TOOL_EXPERIMENT_FIELDS,
  aiTargets,
  carryLegacy,
  labelFor,
  missingRequired,
  requiredKeys,
  toDraft,
  toRecord,
} from "../Utils/artifactFields";

// Folder Analysis and the Add/Edit forms describe the same fields. They used
// to do it from two separate hardcoded lists, and the lists drifted: the same
// field read "Keywords" in one place and "Properties (comma separated)" in
// the other, an input labelled "Keywords" wrote to `URLs`, and optional
// fields were flagged "Needs input".
//
// There is one contract now. These tests fail the moment a form's visible
// label stops matching it, so the two cannot drift again silently.

const read = (file) =>
  fs.readFileSync(
    path.join(__dirname, "..", "components", "CuratorForms", file),
    "utf8"
  );

const labelsIn = (source) =>
  Array.from(source.matchAll(/label="([^"]+)"/g)).map((match) => match[1]);

describe("the contract itself", () => {
  it("stores a chart's keywords in properties, for compatibility", () => {
    // The storage key must never change: every published record has them
    // under `properties` already.
    const keywords = ARTIFACT_FIELDS.chart.find(
      (field) => field.label === "Keywords"
    );
    expect(keywords.key).toBe("properties");
    expect(keywords.required).toBe(true);
  });

  it("calls a dataset's and a script's description readme", () => {
    ["dataset", "script"].forEach((kind) => {
      const description = ARTIFACT_FIELDS[kind].find(
        (field) => field.label === "Description"
      );
      expect(description.key).toBe("readme");
      expect(description.required).toBe(true);
    });
  });

  it("offers no URL field on a dataset or a script", () => {
    ["dataset", "script"].forEach((kind) => {
      expect(
        ARTIFACT_FIELDS[kind].map((field) => field.key)
      ).not.toContain("URLs");
      expect(
        ARTIFACT_FIELDS[kind].map((field) => field.label)
      ).not.toContain("URLs");
    });
  });

  it("marks exactly the required fields, per type", () => {
    expect(requiredKeys("chart").sort()).toEqual([
      "caption", "imageFile", "number", "properties",
    ]);
    expect(requiredKeys("dataset").sort()).toEqual(["files", "readme"]);
    expect(requiredKeys("script").sort()).toEqual(["files", "readme"]);
    expect(requiredKeys("tool").sort()).toEqual(["packageName", "version"]);
    expect(
      TOOL_EXPERIMENT_FIELDS.filter((field) => field.required).map((f) => f.key)
    ).toEqual(["facilityName", "measurement"]);
  });

  it("leaves the optional fields optional", () => {
    expect(requiredKeys("chart")).not.toContain("files");
    expect(requiredKeys("chart")).not.toContain("notebookFile");
    expect(requiredKeys("dataset")).not.toContain("keywords");
    expect(requiredKeys("script")).not.toContain("keywords");
    ["executableName", "patches", "description", "urls"].forEach((key) =>
      expect(requiredKeys("tool")).not.toContain(key)
    );
  });
});

describe("AI may only propose what the type can hold", () => {
  it("chart: a caption and its keywords, which are properties", () => {
    expect(aiTargets("chart")).toEqual({
      description: "caption",
      keywords: "properties",
    });
  });

  it("dataset and script: a description and keywords", () => {
    ["dataset", "script"].forEach((kind) =>
      expect(aiTargets(kind)).toEqual({
        description: "readme",
        keywords: "keywords",
      })
    );
  });

  it("tool: a description, and no keyword target at all", () => {
    expect(aiTargets("tool")).toEqual({ description: "description" });
    expect(aiTargets("tool").keywords).toBeUndefined();
  });
});

describe("Needs input tracks required fields only", () => {
  it("names a blank required field", () => {
    expect(missingRequired("dataset", { files: "a.txt", readme: "" })).toEqual([
      "readme",
    ]);
  });

  it("says nothing about a blank optional field", () => {
    expect(
      missingRequired("dataset", { files: "a.txt", readme: "r", keywords: "" })
    ).toEqual([]);
    expect(
      missingRequired("chart", {
        imageFile: "i.png", number: "1", caption: "c", properties: "k",
        files: "", notebookFile: "",
      })
    ).toEqual([]);
  });
});

describe("draft and record conversion", () => {
  it("builds a draft in contract order, with lists as text", () => {
    const draft = toDraft("dataset", {
      files: ["a.xyz", "b.xyz"],
      readme: "Geometries",
      keywords: ["silicon"],
      URLs: ["https://example.org"],
    });
    expect(Object.keys(draft)).toEqual(["files", "readme", "keywords"]);
    expect(draft.files).toBe("a.xyz, b.xyz");
    expect(draft.keywords).toBe("silicon");
    // A legacy URL never becomes an editable value.
    expect(draft).not.toHaveProperty("URLs");
  });

  it("builds a record with lists split back out", () => {
    const record = toRecord("script", {
      files: "a.py, b.py",
      readme: "Plots",
      keywords: "phonons, vdos",
    });
    expect(record.files).toEqual(["a.py", "b.py"]);
    expect(record.keywords).toEqual(["phonons", "vdos"]);
    expect(record.readme).toBe("Plots");
    // A brand-new record does not invent an empty legacy field.
    expect(record).not.toHaveProperty("URLs");
  });

  it("stamps software on a tool record", () => {
    expect(toRecord("tool", { packageName: "QE", version: "7.2" }).kind).toBe(
      "software"
    );
  });

  it("carries a legacy URLs list through an edit untouched", () => {
    const previous = { files: ["a.xyz"], readme: "old",
                       URLs: ["https://example.org/a"] };
    const next = toRecord("dataset", { files: "a.xyz", readme: "new",
                                       keywords: "silicon" });
    const merged = carryLegacy("dataset", previous, next);

    expect(merged.URLs).toEqual(["https://example.org/a"]);
    expect(merged.keywords).toEqual(["silicon"]);
    expect(merged.readme).toBe("new");
  });

  it("does not create URLs on a record that never had them", () => {
    const merged = carryLegacy("dataset", { files: ["a.xyz"] },
                               toRecord("dataset", { files: "a.xyz" }));
    expect(merged).not.toHaveProperty("URLs");
  });
});

// The parity check. A form label that stops matching the contract fails here
// rather than being noticed in a screenshot.
describe("the Add/Edit forms show exactly the contract's labels", () => {
  it("chart", () => {
    const labels = labelsIn(read("ChartsInfoForm.js"));
    ARTIFACT_FIELDS.chart.forEach((field) =>
      expect(labels).toContain(field.label)
    );
  });

  it("dataset and script, with no URL input", () => {
    [["DatasetsInfoForm.js", "dataset"], ["ScriptsInfoForm.js", "script"]]
      .forEach(([file, kind]) => {
        const labels = labelsIn(read(file));
        ARTIFACT_FIELDS[kind].forEach((field) =>
          expect(labels).toContain(field.label)
        );
        expect(labels).not.toContain("URLs");
      });
  });

  it("tool, software and experiment", () => {
    const labels = labelsIn(read("ToolsInfoForm.js"));
    ARTIFACT_FIELDS.tool.forEach((field) =>
      expect(labels).toContain(field.label)
    );
    TOOL_EXPERIMENT_FIELDS.forEach((field) =>
      expect(labels).toContain(field.label)
    );
    expect(labels).toContain("Type");
    // A tool has no keyword field anywhere.
    expect(labels).not.toContain("Keywords");
  });

  it("labelFor answers with what the form shows", () => {
    expect(labelFor("chart", "properties")).toBe("Keywords");
    expect(labelFor("chart", "number")).toBe("Figure Number");
    expect(labelFor("dataset", "readme")).toBe("Description");
    expect(labelFor("tool", "packageName")).toBe("Package Name");
  });
});
