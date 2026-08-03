import { render, screen } from "@testing-library/react";

// The lightbox ships ESM that jest does not transform, and it is irrelevant
// to URL building.
jest.mock("yet-another-react-lightbox", () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock("yet-another-react-lightbox/plugins/captions", () => ({
  __esModule: true,
  default: {},
}));
jest.mock("yet-another-react-lightbox/styles.css", () => ({}), {
  virtual: true,
});
jest.mock("yet-another-react-lightbox/plugins/captions.css", () => ({}), {
  virtual: true,
});
jest.mock("next/router", () => ({
  useRouter: () => ({ query: {}, asPath: "/curator", push: jest.fn() }),
}));

import buildFileUrl, {
  buildDirectoryUrl,
} from "../Utils/fileServerUrl";
import ChartsInfo from "../components/Paper/Charts";
import AlertContext from "../Context/Alert/alertContext";
import LoadingContext from "../Context/Loading/loadingContext";

const ROOT = "https://notebook.rcc.uchicago.edu/files/10.1021.acs.jpcc.5c01077";

describe("file server URL building", () => {
  it("joins a saved root and a relative path", () => {
    expect(buildFileUrl(ROOT, "figures/figure1.png")).toBe(
      `${ROOT}/figures/figure1.png`
    );
  });

  it("normalizes the leading slash the manual picker leaves behind", () => {
    // Utils/Scraper.node strips the server prefix and leaves "/figures/...",
    // which used to produce a double slash.
    expect(buildFileUrl(ROOT, "/figures/figure1.png")).toBe(
      `${ROOT}/figures/figure1.png`
    );
    expect(buildFileUrl(`${ROOT}/`, "/figures/figure1.png")).toBe(
      `${ROOT}/figures/figure1.png`
    );
  });

  it("encodes segments but keeps separators", () => {
    expect(buildFileUrl(ROOT, "my figures/fig #1.png")).toBe(
      `${ROOT}/my%20figures/fig%20%231.png`
    );
  });

  it("does not double-encode an already encoded path", () => {
    expect(buildFileUrl(ROOT, "my%20figures/a.png")).toBe(
      `${ROOT}/my%20figures/a.png`
    );
  });

  it("returns nothing when there is no root or no path", () => {
    // This is the real failure: a chart applied from folder analysis before
    // "Save File Server" had no root, so "" + "/" + path pointed at the
    // Qresp origin and rendered blank.
    expect(buildFileUrl("", "figures/figure1.png")).toBe("");
    expect(buildFileUrl(ROOT, "")).toBe("");
    expect(buildFileUrl(undefined, undefined)).toBe("");
  });

  it("builds the containing directory link", () => {
    expect(buildDirectoryUrl(ROOT, "figures/figure1.png")).toBe(
      `${ROOT}/figures`
    );
    expect(buildDirectoryUrl(ROOT, "/a/b/c.png")).toBe(`${ROOT}/a/b`);
    expect(buildDirectoryUrl("", "a/b.png")).toBe("");
  });
});

const renderCharts = (charts, fileserverpath) =>
  render(
    <AlertContext.Provider value={{ setAlert: jest.fn() }}>
      <LoadingContext.Provider
        value={{ showLoader: jest.fn(), hideLoader: jest.fn() }}
      >
        <ChartsInfo
          charts={charts}
          fileserverpath={fileserverpath}
          showSlider={false}
          inDrawer={false}
        />
      </LoadingContext.Provider>
    </AlertContext.Provider>
  );

const analyzedChart = {
  id: "c0",
  imageFile: "figures/figure1.png",
  caption: "",
  number: "",
  properties: [],
  files: [],
  notebookFile: "",
};

// A chart added the manual way: Scraper.node leaves a leading slash.
const manualChart = {
  id: "c1",
  imageFile: "/figures/figure2.png",
  caption: "Hand written caption",
  number: "2",
  properties: ["dft"],
  files: [],
  notebookFile: "",
};

describe("Chart image rendering", () => {
  it("renders a folder-analysis chart against the saved file server path", () => {
    renderCharts([analyzedChart], ROOT);
    const image = screen.getByTestId("chart-image");
    expect(image).toHaveAttribute("src", `${ROOT}/figures/figure1.png`);
  });

  it("renders a manually curated chart exactly as before", () => {
    renderCharts([manualChart], ROOT);
    const image = screen.getByTestId("chart-image");
    // Same URL, now without the stray double slash.
    expect(image).toHaveAttribute("src", `${ROOT}/figures/figure2.png`);
    expect(image).toHaveAttribute("alt", "Hand written caption");
  });

  it("explains itself instead of rendering a blank chart with no server path", () => {
    renderCharts([analyzedChart], "");
    expect(screen.queryByTestId("chart-image")).toBeNull();
    expect(screen.getByTestId("chart-image-missing")).toHaveTextContent(
      /file server path not saved/i
    );
  });

  it("says so when the chart has no image file at all", () => {
    renderCharts([{ ...analyzedChart, imageFile: "" }], ROOT);
    expect(screen.getByTestId("chart-image-missing")).toHaveTextContent(
      /image file not selected/i
    );
  });

  it("shows a labelled failure when the image cannot be loaded", () => {
    renderCharts([analyzedChart], ROOT);
    const image = screen.getByTestId("chart-image");
    const note = screen.getByTestId("chart-image-error");
    expect(note).not.toBeVisible();

    // Simulate the browser failing to fetch the file.
    image.dispatchEvent(new Event("error", { bubbles: false }));
    expect(note).toHaveTextContent(/could not be loaded/i);
  });
});

// Each way an image can fail needs a different thing from the reader, so each
// says something different. A browser refusing the RCC certificate looks
// exactly like a 404 from the page's side -- both are named rather than
// guessed between, and the URL is shown verbatim so it can be tried by hand.
describe("image failures are told apart", () => {
  const CASES = [
    ["File Server path not saved", { imageFile: "figures/f1.png" }, ""],
    ["Image File not selected", { imageFile: "" }, ROOT],
    ["Invalid image path", { imageFile: "../../etc/passwd" }, ROOT],
    ["Invalid image path", { imageFile: "https://elsewhere.example/x.png" },
     ROOT],
    ["Invalid image path",
     { imageFile: "figures" + String.fromCharCode(92) + "f1.png" },
     ROOT],
  ];

  it.each(CASES)("says %s", (expected, overrides, server) => {
    renderCharts([{ ...analyzedChart, ...overrides }], server);
    expect(screen.queryByTestId("chart-image")).toBeNull();
    expect(screen.getByTestId("chart-image-missing")).toHaveTextContent(
      expected
    );
  });

  it("names both remote possibilities, with the URL and two actions", () => {
    renderCharts([analyzedChart], ROOT);
    const note = screen.getByTestId("chart-image-error");

    expect(note).toHaveTextContent(/remote image could not be loaded/i);
    expect(note).toHaveTextContent(/may not trust the rcc certificate/i);
    // Verbatim, never re-cased or hidden.
    expect(note).toHaveTextContent(
      `${ROOT}/${analyzedChart.imageFile}`.replace(/ /g, "%20")
    );
    // The note starts hidden and is revealed by the img onError handler, so
    // its links are read from the node rather than by page role.
    const links = Array.from(note.querySelectorAll("a")).map((anchor) => ({
      text: anchor.textContent.trim(),
      href: anchor.getAttribute("href"),
    }));
    expect(links.map((link) => link.text)).toEqual([
      "Open image",
      "Check file server access",
    ]);
    expect(links[0].href).toBe(
      `${ROOT}/${analyzedChart.imageFile}`.replace(/ /g, "%20")
    );
  });
});
