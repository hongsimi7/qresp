import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import DatasetsInfoForm from "../components/CuratorForms/DatasetsInfoForm";
import ScriptsInfoForm from "../components/CuratorForms/ScriptsInfoForm";
import CuratorContext from "../Context/Curator/curatorContext";
import CuratorHelperContext from "../Context/CuratorHelpers/curatorHelperContext";
import SourceTreeContext from "../Context/SourceTree/SourceTreeContext";

// Datasets and Scripts each have TWO optional list fields that were long
// conflated: the input labelled "Keywords" wrote to `URLs`, so a curator's
// keywords were stored as links and their links had nowhere to go. They are
// separate fields now, and nothing may leak between them.

const FORMS = [
  ["dataset", DatasetsInfoForm, "datasets"],
  ["script", ScriptsInfoForm, "scripts"],
];

const renderForm = (kind, Form, section, { item = null, items = [] } = {}) => {
  const add = jest.fn();
  const edit = jest.fn();
  const closeForm = jest.fn();
  render(
    <CuratorContext.Provider
      value={{ [section]: items, add, edit, fileServerPath: "" }}
    >
      <CuratorHelperContext.Provider
        value={{
          // The dialog reads { def, open } off its own helper slice.
          [`${section}Helper`]: { def: item, open: true },
          openForm: jest.fn(),
          closeForm,
          setDefault: jest.fn(),
        }}
      >
        <SourceTreeContext.Provider
          value={{
            setSaveMethod: jest.fn(),
            openSelector: jest.fn(),
            HideSelector: jest.fn(),
          }}
        >
          <Form />
        </SourceTreeContext.Provider>
      </CuratorHelperContext.Provider>
    </CuratorContext.Provider>
  );
  return { add, edit };
};

const field = (pattern) => screen.getByPlaceholderText(pattern);

describe.each(FORMS)("%s form: Keywords and URLs are separate", (
  kind,
  Form,
  section
) => {
  beforeEach(() => jest.clearAllMocks());

  it("shows both inputs, and they are different elements", () => {
    renderForm(kind, Form, section);
    const keywords = field(/enter keywords for the/i);
    const urls = field(/enter urls for the/i);
    expect(keywords).not.toBe(urls);
    expect(keywords).toHaveAttribute("name", "keywords");
    expect(urls).toHaveAttribute("name", "URLs");
  });

  it("stores each in its own list on save", async () => {
    const user = userEvent.setup();
    const { add } = renderForm(kind, Form, section);

    await user.type(field(/enter files for the/i), "data/a.xyz, data/b.xyz");
    await user.type(field(/enter descriptions? for/i), "Relaxed geometries");
    await user.type(field(/enter keywords for the/i), "density functional theory, silicon");
    await user.type(field(/enter urls for the/i), "https://example.org/a");
    await user.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() => expect(add).toHaveBeenCalledTimes(1));
    const [, values] = add.mock.calls[0];
    expect(values.keywords).toEqual([
      "density functional theory",
      "silicon",
    ]);
    expect(values.URLs).toEqual(["https://example.org/a"]);
    expect(values.readme).toBe("Relaxed geometries");
  });

  it("round-trips an existing record without mixing the two", async () => {
    const user = userEvent.setup();
    const item = {
      id: "x1",
      files: ["data/a.xyz"],
      readme: "Relaxed geometries",
      keywords: ["silicon"],
      URLs: ["https://example.org/a"],
      extraFields: [],
    };
    const { edit } = renderForm(kind, Form, section, {
      item,
      items: [item],
    });

    expect(field(/enter keywords for the/i)).toHaveValue("silicon");
    expect(field(/enter urls for the/i)).toHaveValue("https://example.org/a");

    await user.click(screen.getByRole("button", { name: /^update$/i }));

    await waitFor(() => expect(edit).toHaveBeenCalledTimes(1));
    const [, values] = edit.mock.calls[0];
    expect(values.keywords).toEqual(["silicon"]);
    expect(values.URLs).toEqual(["https://example.org/a"]);
  });

  it("loads a legacy record with no keywords as empty, keeping its URLs",
     async () => {
    const user = userEvent.setup();
    const legacy = {
      id: "x1",
      files: ["data/a.xyz"],
      readme: "Relaxed geometries",
      URLs: ["https://example.org/a"],
      extraFields: [],
    };
    const { edit } = renderForm(kind, Form, section, {
      item: legacy,
      items: [legacy],
    });

    expect(field(/enter keywords for the/i)).toHaveValue("");
    expect(field(/enter urls for the/i)).toHaveValue("https://example.org/a");

    await user.click(screen.getByRole("button", { name: /^update$/i }));

    await waitFor(() => expect(edit).toHaveBeenCalledTimes(1));
    const [, values] = edit.mock.calls[0];
    expect(values.keywords).toEqual([]);
    // The existing links survive untouched -- they are never converted.
    expect(values.URLs).toEqual(["https://example.org/a"]);
  });

  it("blocks Save while a required field is empty", async () => {
    const user = userEvent.setup();
    const { add } = renderForm(kind, Form, section);

    // Only the optional fields are filled in.
    await user.type(field(/enter keywords for the/i), "silicon");
    await user.type(field(/enter urls for the/i), "https://example.org/a");
    await user.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() =>
      expect(screen.getAllByText(/^required$/i).length).toBeGreaterThan(0)
    );
    expect(add).not.toHaveBeenCalled();
  });

  it("saves with both optional fields left empty", async () => {
    const user = userEvent.setup();
    const { add } = renderForm(kind, Form, section);

    await user.type(field(/enter files for the/i), "data/a.xyz");
    await user.type(field(/enter descriptions? for/i), "Relaxed geometries");
    await user.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() => expect(add).toHaveBeenCalledTimes(1));
    const [, values] = add.mock.calls[0];
    expect(values.keywords).toEqual([]);
    expect(values.URLs).toEqual([]);
  });
});
