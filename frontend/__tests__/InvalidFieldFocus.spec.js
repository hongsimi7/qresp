import fs from "fs";
import path from "path";

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import ChartsInfoForm from "../components/CuratorForms/ChartsInfoForm";
import DatasetsInfoForm from "../components/CuratorForms/DatasetsInfoForm";
import ScriptsInfoForm from "../components/CuratorForms/ScriptsInfoForm";
import ToolsInfoForm from "../components/CuratorForms/ToolsInfoForm";
import CuratorContext from "../Context/Curator/curatorContext";
import CuratorHelperContext from "../Context/CuratorHelpers/curatorHelperContext";
import SourceTreeContext from "../Context/SourceTree/SourceTreeContext";
import {
  controlFor,
  firstInvalidControl,
  revealControl,
} from "../Utils/invalidField";

// Pressing Save with a required field empty used to do nothing a curator
// could see: the form refused to submit and left them to find the offender,
// which on a long dialog is usually scrolled off the top.
//
// Now the form sends them to the FIRST invalid field in the form's own order
// — not the first key the resolver happened to report, and not whichever one
// is nearest the button — scrolls it to the middle, and focuses it. Nothing
// is saved until every required field is filled, which is exactly the rule
// that was already enforced; only the feedback changed.

const FORMS = {
  chart: ChartsInfoForm,
  dataset: DatasetsInfoForm,
  script: ScriptsInfoForm,
  tool: ToolsInfoForm,
};

const HELPER_KEY = {
  chart: "chartsHelper",
  dataset: "datasetsHelper",
  script: "scriptsHelper",
  tool: "toolsHelper",
};

const STATE_KEY = {
  chart: "charts",
  dataset: "datasets",
  script: "scripts",
  tool: "tools",
};

const renderForm = (kind, { def = null, records = [] } = {}) => {
  const Form = FORMS[kind];
  const add = jest.fn();
  const edit = jest.fn();
  const closeForm = jest.fn();
  const view = render(
    <CuratorContext.Provider
      value={{ [STATE_KEY[kind]]: records, add, edit }}
    >
      <CuratorHelperContext.Provider
        value={{
          [HELPER_KEY[kind]]: { def, open: true },
          openForm: jest.fn(),
          closeForm,
          setDefault: jest.fn(),
        }}
      >
        <SourceTreeContext.Provider
          value={{
            setSaveMethod: jest.fn(),
            openSelector: jest.fn(),
            setMultiple: jest.fn(),
          }}
        >
          <Form />
        </SourceTreeContext.Provider>
      </CuratorHelperContext.Provider>
    </CuratorContext.Provider>
  );
  return { add, edit, closeForm, unmount: view.unmount };
};

const save = async (user) =>
  user.click(screen.getByRole("button", { name: /^(save|update)$/i }));

// jsdom has no layout, so scrollIntoView is not implemented there.
let scrollSpy;
beforeEach(() => {
  scrollSpy = jest.fn();
  Element.prototype.scrollIntoView = scrollSpy;
});

describe("a failed Save goes to the first missing field", () => {
  it("chart: the topmost required field, not the last error reported", async () => {
    const user = userEvent.setup({ delay: null });
    const { add, edit } = renderForm("chart");

    await save(user);

    // Figure Caption is the first control in the form, and four fields are
    // required — only the first one is touched.
    const caption = screen.getByPlaceholderText(/enter the figure caption/i);
    await waitFor(() => expect(caption).toHaveFocus());
    expect(scrollSpy).toHaveBeenCalledTimes(1);
    expect(scrollSpy).toHaveBeenCalledWith(
      expect.objectContaining({ block: "center" })
    );
    // Nothing was saved, and the reducer was never touched.
    expect(add).not.toHaveBeenCalled();
    expect(edit).not.toHaveBeenCalled();
  });

  it("moves to the NEXT remaining error on the next Save", async () => {
    const user = userEvent.setup({ delay: null });
    renderForm("chart");

    await save(user);
    const caption = screen.getByPlaceholderText(/enter the figure caption/i);
    await waitFor(() => expect(caption).toHaveFocus());

    await user.type(caption, "Density of states");
    await save(user);

    // Figure Number is prefilled from the record count, so the next gap is
    // the Figure Image.
    const image = screen.getByPlaceholderText(/enter chart image file name/i);
    await waitFor(() => expect(image).toHaveFocus());
    expect(scrollSpy).toHaveBeenCalledTimes(2);

    await user.type(image, "figures/f1.png");
    await save(user);
    const keywords = screen.getByPlaceholderText(/enter keywords/i);
    await waitFor(() => expect(keywords).toHaveFocus());
    expect(scrollSpy).toHaveBeenCalledTimes(3);
  });

  it("saves normally, and scrolls nothing, once the form is complete",
     async () => {
    const user = userEvent.setup({ delay: null });
    const { add } = renderForm("chart");

    await user.type(
      screen.getByPlaceholderText(/enter the figure caption/i),
      "Density of states"
    );
    await user.type(
      screen.getByPlaceholderText(/enter chart image file name/i),
      "figures/f1.png"
    );
    await user.type(screen.getByPlaceholderText(/enter keywords/i), "silicon");
    await save(user);

    await waitFor(() => expect(add).toHaveBeenCalled());
    expect(add).toHaveBeenCalledWith(
      "chart",
      expect.objectContaining({
        caption: "Density of states",
        imageFile: "figures/f1.png",
      })
    );
    expect(scrollSpy).not.toHaveBeenCalled();
  });

  it("dataset: the first required field", async () => {
    const user = userEvent.setup({ delay: null });
    const { add } = renderForm("dataset");

    await save(user);

    await waitFor(() =>
      expect(
        screen.getByPlaceholderText(/enter files for the dataset/i)
      ).toHaveFocus()
    );
    expect(scrollSpy).toHaveBeenCalledTimes(1);
    expect(add).not.toHaveBeenCalled();
  });

  it("script: the first required field", async () => {
    const user = userEvent.setup({ delay: null });
    const { add } = renderForm("script");

    await save(user);

    await waitFor(() =>
      expect(
        screen.getByPlaceholderText(/enter files for the scripts/i)
      ).toHaveFocus()
    );
    expect(add).not.toHaveBeenCalled();
  });

  it("tool: the first required field of the selected type", async () => {
    const user = userEvent.setup({ delay: null });
    const { add } = renderForm("tool");

    await save(user);

    await waitFor(() =>
      expect(
        screen.getByPlaceholderText(/enter name of the software package/i)
      ).toHaveFocus()
    );
    expect(add).not.toHaveBeenCalled();
  });

  it("marks the field it lands on invalid, and says why", async () => {
    const user = userEvent.setup({ delay: null });
    renderForm("dataset");

    await save(user);
    const files = screen.getByPlaceholderText(/enter files for the dataset/i);
    await waitFor(() => expect(files).toHaveFocus());

    // The message survives the focus it was just given, and is announced with
    // the field rather than sitting loose beside it.
    expect(files).toHaveAttribute("aria-invalid", "true");
    const describedBy = files.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy)).toHaveTextContent("Required");
  });

  it("respects prefers-reduced-motion", async () => {
    const matchMedia = jest.fn().mockReturnValue({
      matches: true,
      addListener: jest.fn(),
      removeListener: jest.fn(),
    });
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      configurable: true,
      value: matchMedia,
    });
    const user = userEvent.setup({ delay: null });
    renderForm("dataset");

    await save(user);
    await waitFor(() => expect(scrollSpy).toHaveBeenCalled());
    expect(scrollSpy).toHaveBeenCalledWith({
      behavior: "auto",
      block: "center",
    });

    delete window.matchMedia;
  });

  it("uses smooth scrolling when no such preference is set", async () => {
    const user = userEvent.setup({ delay: null });
    renderForm("dataset");

    await save(user);
    await waitFor(() => expect(scrollSpy).toHaveBeenCalled());
    expect(scrollSpy).toHaveBeenCalledWith({
      behavior: "smooth",
      block: "center",
    });
  });
});

// The target is chosen from the DOM, so the same rule holds for a radio
// group, a select and a picker-driven field without any form naming its own
// fields here.
describe("choosing the control to focus", () => {
  const mount = (html) => {
    const form = document.createElement("form");
    form.innerHTML = html;
    document.body.appendChild(form);
    return form;
  };

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("takes the first control in DOM order, whatever order the errors are in",
     () => {
    const form = mount(`
      <input name="first" />
      <input name="second" />
      <input name="third" />
    `);
    // Reported last-first: the answer is still the topmost one.
    const target = firstInvalidControl(form, { third: {}, first: {}, second: {} });
    expect(target).toBe(form.querySelector('[name="first"]'));
  });

  it("keeps that order when a two-column row wraps to one column", () => {
    // Columns are a painting decision; the DOM order is the form's order.
    const form = mount(`
      <div style="display:flex;flex-direction:column">
        <input name="left" />
        <input name="right" />
      </div>
    `);
    expect(firstInvalidControl(form, { right: {}, left: {} })).toBe(
      form.querySelector('[name="left"]')
    );
  });

  it("focuses the first radio of a group, or the chosen one", () => {
    const form = mount(`
      <input type="radio" name="kind" value="software" />
      <input type="radio" name="kind" value="experiment" />
    `);
    expect(controlFor(form, "kind")).toBe(
      form.querySelector('[value="software"]')
    );

    form.querySelector('[value="experiment"]').checked = true;
    expect(controlFor(form, "kind")).toBe(
      form.querySelector('[value="experiment"]')
    );
  });

  it("focuses a select's trigger, never its hidden native input", () => {
    const form = mount(`
      <div class="MuiFormControl-root">
        <div role="combobox" tabindex="0" id="trigger">Pick one</div>
        <input name="server" class="MuiSelect-nativeInput" aria-hidden="true" />
      </div>
    `);
    expect(controlFor(form, "server")).toBe(form.querySelector("#trigger"));
  });

  it("focuses the picker button when the field itself cannot be typed in",
     () => {
    const form = mount(`
      <div class="MuiFormControl-root">
        <input name="imageFile" readonly />
        <button type="button" id="picker">Pick a file</button>
      </div>
    `);
    expect(controlFor(form, "imageFile")).toBe(form.querySelector("#picker"));
  });

  it("finds an array field's own inputs", () => {
    const form = mount(`
      <input name="extraFields.0.label" />
      <input name="extraFields.0.value" />
    `);
    expect(controlFor(form, "extraFields")).toBe(
      form.querySelector('[name="extraFields.0.label"]')
    );
  });

  it("does nothing when there is nothing to focus", () => {
    const form = mount(`<input name="known" />`);
    expect(firstInvalidControl(form, { unknown: {} })).toBeNull();
    expect(firstInvalidControl(null, { known: {} })).toBeNull();
    expect(revealControl(null)).toBeNull();
  });
});

// react-hook-form focuses the first errored field itself, AFTER the invalid
// handler runs, unless it is told not to. Left on, it would land on whichever
// element it holds a ref for — the hidden native input of a select, not the
// trigger; the text field, not the picker button — and its plain .focus()
// would scroll that element into view its own way, undoing the
// block: "center" placement this feature exists to give. The custom handler
// is the only thing that moves focus.

// jsdom exposes HTMLElement.focus through an accessor, which jest.spyOn
// cannot replace, so the counter is installed by hand.
const watchFocus = () => {
  const original = HTMLElement.prototype.focus;
  const instances = [];
  Object.defineProperty(HTMLElement.prototype, "focus", {
    configurable: true,
    writable: true,
    value: function focus(...args) {
      instances.push(this);
      return original.apply(this, args);
    },
  });
  return {
    instances,
    on: (element) => instances.filter((instance) => instance === element).length,
    restore: () =>
      Object.defineProperty(HTMLElement.prototype, "focus", {
        configurable: true,
        writable: true,
        value: original,
      }),
  };
};

describe("only one thing moves the focus", () => {

  it("focuses the target exactly once, and nothing focuses it later",
     async () => {
    const focusSpy = watchFocus();
    const user = userEvent.setup({ delay: null });
    renderForm("chart");

    await save(user);
    const caption = screen.getByPlaceholderText(/enter the figure caption/i);
    await waitFor(() => expect(caption).toHaveFocus());

    expect(focusSpy.on(caption)).toBe(1);
    expect(scrollSpy).toHaveBeenCalledTimes(1);

    // react-hook-form's own focus runs after the invalid callback, and MUI
    // transitions settle on a timer; neither may add a second one.
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(focusSpy.on(caption)).toBe(1);
    expect(scrollSpy).toHaveBeenCalledTimes(1);
    expect(caption).toHaveFocus();

    focusSpy.restore();
  });

  it("does not focus the field react-hook-form would have picked instead",
     async () => {
    const focusSpy = watchFocus();
    const user = userEvent.setup({ delay: null });
    renderForm("chart");

    await save(user);
    const caption = screen.getByPlaceholderText(/enter the figure caption/i);
    await waitFor(() => expect(caption).toHaveFocus());

    // Every other invalid field is left alone: one jump, one field.
    ["enter chart image file name", "enter keywords"].forEach((placeholder) => {
      const other = screen.getByPlaceholderText(new RegExp(placeholder, "i"));
      expect(focusSpy.on(other)).toBe(0);
      expect(other).not.toHaveFocus();
    });

    focusSpy.restore();
  });

  it("moves nothing at all when the form is valid", async () => {
    const focusSpy = watchFocus();
    const user = userEvent.setup({ delay: null });
    const { add } = renderForm("chart");

    const caption = screen.getByPlaceholderText(/enter the figure caption/i);
    await user.type(caption, "Density of states");
    await user.type(
      screen.getByPlaceholderText(/enter chart image file name/i),
      "figures/f1.png"
    );
    await user.type(screen.getByPlaceholderText(/enter keywords/i), "silicon");
    const focusesBefore = focusSpy.instances.length;
    await save(user);

    await waitFor(() => expect(add).toHaveBeenCalled());
    expect(scrollSpy).not.toHaveBeenCalled();
    // The Save button takes focus from the click; nothing else moves.
    expect(focusSpy.instances.length - focusesBefore).toBeLessThanOrEqual(1);

    focusSpy.restore();
  });

  it("holds for every artifact form, not just charts", async () => {
    const targets = {
      dataset: /enter files for the dataset/i,
      script: /enter files for the scripts/i,
      tool: /enter name of the software package/i,
    };
    for (const [kind, placeholder] of Object.entries(targets)) {
      const focusSpy = watchFocus();
      const user = userEvent.setup({ delay: null });
      const { unmount } = renderForm(kind);

      // eslint-disable-next-line no-await-in-loop
      await save(user);
      const field = screen.getByPlaceholderText(placeholder);
      // eslint-disable-next-line no-await-in-loop
      await waitFor(() => expect(field).toHaveFocus());
      // eslint-disable-next-line no-await-in-loop
      await new Promise((resolve) => setTimeout(resolve, 120));
      expect(focusSpy.on(field)).toBe(1);

      focusSpy.restore();
      unmount();
      scrollSpy.mockClear();
    }
  });

  it("states the contract in every form's useForm call", () => {
    // A form that forgets this gets two focus owners again, and the symptom
    // (a jump that lands somewhere else, or scrolls the field to the edge
    // instead of the middle) is easy to mistake for a broken selector.
    ["ChartsInfoForm", "DatasetsInfoForm", "ScriptsInfoForm", "ToolsInfoForm"]
      .forEach((file) => {
        const source = fs.readFileSync(
          path.join(__dirname, "..", "components", "CuratorForms", `${file}.js`),
          "utf8"
        );
        expect(source).toMatch(/shouldFocusError:\s*false/);
        expect(source).toMatch(/handleSubmit\(onSubmit,\s*focusFirstInvalid\)/);
      });
  });
});
