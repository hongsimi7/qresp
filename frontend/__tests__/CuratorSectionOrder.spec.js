/**
 * The order of the curator's sections.
 *
 * This reads the page source rather than mounting it. Rendering /curator
 * needs auth, a router, the file tree, every artifact form and a live draft;
 * none of that is what this asserts. The claim is about ORDER, the order
 * lives in one JSX block, and a source read catches the accidental reorder
 * that a heavier test would too, without the machinery.
 */
import fs from "fs";
import path from "path";

const source = fs.readFileSync(
  path.join(__dirname, "..", "pages", "curator.js"),
  "utf-8"
);

const at = (tag) => {
  const index = source.indexOf(`<${tag} />`);
  expect(index).toBeGreaterThan(-1);
  return index;
};

describe("where the curation workspace sits", () => {
  it("comes after the file server path it imports from", () => {
    // "Import from RCC" reads that path, so being asked for the folder after
    // the section that uses it is backwards.
    expect(at("FigureWorkspace")).toBeGreaterThan(at("FileServerElement"));
  });

  it("comes before the optional documentation", () => {
    // Curating the record is the work; a README is an extra.
    expect(at("FigureWorkspace")).toBeLessThan(at("DocumentationInfoElement"));
  });

  it("is the first thing after the folder, ahead of the metadata forms", () => {
    expect(at("FigureWorkspace")).toBeLessThan(at("PaperInfoElement"));
    expect(at("FigureWorkspace")).toBeLessThan(at("ReferenceInfoElement"));
  });
});
