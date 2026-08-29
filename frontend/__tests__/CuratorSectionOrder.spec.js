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
  it("comes after the metadata a record cannot do without", () => {
    // A record needs its title and its reference whatever else is done to it.
    expect(at("FigureWorkspace")).toBeGreaterThan(at("PaperInfoElement"));
    expect(at("FigureWorkspace")).toBeGreaterThan(at("ReferenceInfoElement"));
  });

  it("comes after the file server path it imports from", () => {
    // "Import from RCC" reads that path, so the two belong in view together.
    expect(at("FigureWorkspace")).toBeGreaterThan(at("FileServerElement"));
  });

  it("comes immediately before the optional documentation", () => {
    // Curating the record is the work; a README is an extra.
    const between = source.slice(
      at("FigureWorkspace"),
      at("DocumentationInfoElement")
    );
    expect(between).toContain("<FigureWorkspace />");
    // Nothing is allowed to slip in between the two.
    expect(between.match(/<[A-Z]\w+ \/>/g)).toEqual(["<FigureWorkspace />"]);
  });

  it("keeps the file server path directly ahead of it", () => {
    const between = source.slice(
      at("FileServerElement"),
      at("FigureWorkspace")
    );
    expect(between.match(/<[A-Z]\w+ \/>/g)).toEqual(["<FileServerElement />"]);
  });
});
