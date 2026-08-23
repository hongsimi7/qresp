import {
  convertReqSchematoState,
  convertStateToUpdatePayload,
} from "../Utils/model";

import paperDoc from "./fixtures/paperDoc.json";

// Conversion layer for the curator edit flow: stored document -> curator
// state -> PUT payload, exercised with the same fixture the backend suite
// uses (a real published-record shape).
describe("convertReqSchematoState", () => {
  const state = convertReqSchematoState(paperDoc);

  it("maps curator/insertedBy info", () => {
    expect(state.curatorInfo.emailId).toBe("john.doe@company.com");
    expect(state.curatorInfo.firstName).toBe("John");
  });

  it("loads the reference block into the canonical primary-paper referenceInfo", () => {
    expect(state.referenceInfo.publication).toContain(
      "Journal of the American Chemical Society"
    );
    expect(state.referenceInfo.publication).toContain("2016");
    expect(state.referenceInfo.title).toBe(paperDoc.reference.title);
    expect(state.referenceInfo.doi).toBe(paperDoc.reference.DOI);
  });

  it("stringifies PI and author names", () => {
    expect(state.paperInfo.PIs).toContain("Giulia");
    expect(state.paperInfo.PIs).toContain("Galli");
    expect(state.referenceInfo.authors).toContain("Gaiduk");
  });

  it("keeps section lists and converts workflow edges to objects", () => {
    expect(state.charts).toHaveLength(paperDoc.charts.length);
    expect(state.datasets).toHaveLength(paperDoc.datasets.length);
    expect(state.tools).toHaveLength(paperDoc.tools.length);
    expect(state.scripts).toHaveLength(paperDoc.scripts.length);
    expect(state.workflow.edges[0]).toEqual({
      from: paperDoc.workflow.edges[0][0],
      to: paperDoc.workflow.edges[0][1],
    });
    expect(state.license).toBe("cc");
  });

  it("tolerates legacy records with missing sections", () => {
    const minimal = convertReqSchematoState({
      reference: { title: "t" },
      collections: ["c"],
      tags: ["x"],
    });
    expect(minimal.referenceInfo.title).toBe("t");
    expect(minimal.charts).toEqual([]);
    expect(minimal.workflow).toEqual({ nodes: [], edges: [] });
    expect(minimal.documentation).toBe("");
  });

  // Optional and record-level: a record published before the field existed
  // has no `institution` key at all, and that must load as "", not throw or
  // surface as undefined in the edit form's text input.
  it("defaults institution to an empty string on a record that predates it", () => {
    expect(state.paperInfo.institution).toBe("");
    const minimal = convertReqSchematoState({ reference: { title: "t" } });
    expect(minimal.paperInfo.institution).toBe("");
  });

  it("loads a curator-entered institution unchanged", () => {
    const withInstitution = convertReqSchematoState({
      ...paperDoc,
      institution: "University of Chicago",
    });
    expect(withInstitution.paperInfo.institution).toBe(
      "University of Chicago"
    );
  });
});

describe("convertStateToUpdatePayload round trip", () => {
  const state = convertReqSchematoState(paperDoc);
  const payload = convertStateToUpdatePayload(state, paperDoc, null);

  it("round-trips reference data", () => {
    expect(payload.reference.title).toBe(paperDoc.reference.title);
    expect(payload.reference.journal.fullName).toBe(
      paperDoc.reference.journal.fullName
    );
    expect(String(payload.reference.volume)).toBe(
      String(paperDoc.reference.volume)
    );
    expect(payload.reference.page).toBe(paperDoc.reference.page);
    expect(payload.reference.DOI).toBe(paperDoc.reference.DOI);
    const names = payload.reference.authors.map(
      (a) => `${a.firstName} ${a.lastName}`
    );
    expect(names).toContain("Alex Gaiduk");
  });

  it("round-trips charts/datasets/tools/scripts and workflow edges", () => {
    expect(payload.charts).toHaveLength(paperDoc.charts.length);
    expect(payload.charts[0].caption).toBe(paperDoc.charts[0].caption);
    expect(payload.datasets).toEqual(paperDoc.datasets);
    expect(payload.tools).toHaveLength(paperDoc.tools.length);
    expect(payload.scripts).toHaveLength(paperDoc.scripts.length);
    expect(payload.workflow.edges).toEqual(paperDoc.workflow.edges);
  });

  it("preserves fields the curator does not manage", () => {
    expect(payload.schema).toBe(paperDoc.schema);
    expect(payload.info.downloadPath).toBe(paperDoc.info.downloadPath);
    expect(payload.info.gitPath).toBe(paperDoc.info.gitPath);
    expect(payload.info.isPublic).toBe(paperDoc.info.isPublic);
    expect(payload.info.insertedBy.emailId).toBe(
      paperDoc.info.insertedBy.emailId
    );
  });

  it("never adds a citedReference block (one paper, one reference record)", () => {
    expect(payload).not.toHaveProperty("citedReference");
    expect(payload).not.toHaveProperty("publicationInfo");
  });

  it("never carries identity/server-owned fields", () => {
    expect(payload).not.toHaveProperty("owner_email");
    expect(payload).not.toHaveProperty("id");
    expect(payload).not.toHaveProperty("_id");
    expect(payload).not.toHaveProperty("version");
    expect(payload).not.toHaveProperty("versions");
  });

  it("round-trips a blank institution as an empty string, not omitted", () => {
    // paperDoc predates the field: the payload must still carry the key so a
    // PUT can clear a previously-set value, rather than the key vanishing.
    expect(payload.institution).toBe("");
  });

  it("round-trips a curator-entered institution", () => {
    const withInstitution = convertReqSchematoState({
      ...paperDoc,
      institution: "University of Chicago",
    });
    const withPayload = convertStateToUpdatePayload(
      withInstitution,
      paperDoc,
      null
    );
    expect(withPayload.institution).toBe("University of Chicago");
  });
});
