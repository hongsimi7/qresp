import { render, screen, waitFor } from "@testing-library/react";

import ReferenceInfoElement from "../components/CuratorElements/ReferenceElement";
import CuratorContext from "../Context/Curator/curatorContext";
import CuratorHelperContext from "../Context/CuratorHelpers/curatorHelperContext";

jest.mock("../components/CuratorForms/ReferenceInfoForm", () => () => (
  <div data-testid="reference-form">form</div>
));
jest.mock("../components/Paper/ReferenceC", () => () => (
  <div data-testid="reference-display">display</div>
));
jest.mock("../components/switchFade", () => ({ editing, form, display }) =>
  editing ? form : display
);

const renderElement = ({ referenceInfo, editing }) => {
  const setEditing = jest.fn();
  const view = (nextReference, nextEditing) => (
    <CuratorContext.Provider value={{ referenceInfo: nextReference }}>
      <CuratorHelperContext.Provider
        value={{ editing: { referenceInfo: nextEditing }, setEditing }}
      >
        <ReferenceInfoElement />
      </CuratorHelperContext.Provider>
    </CuratorContext.Provider>
  );
  const result = render(view(referenceInfo, editing));
  return { ...result, setEditing, view };
};

describe("ReferenceInfoElement", () => {
  it("opens a blank new bibliography for editing", async () => {
    const { setEditing } = renderElement({
      referenceInfo: { title: "" },
      editing: false,
    });

    await waitFor(() =>
      expect(setEditing).toHaveBeenCalledWith("referenceInfo", true)
    );
  });

  it("does not close an open form when an import fills its title", async () => {
    const { rerender, setEditing, view } = renderElement({
      referenceInfo: { title: "" },
      editing: true,
    });

    rerender(view({ title: "Imported title" }, true));

    await waitFor(() =>
      expect(screen.getByTestId("reference-form")).toBeInTheDocument()
    );
    expect(setEditing).not.toHaveBeenCalledWith("referenceInfo", false);
    expect(screen.queryByTestId("reference-display")).not.toBeInTheDocument();
  });

  it("keeps an already saved bibliography in its display state", () => {
    const { setEditing } = renderElement({
      referenceInfo: { title: "Saved title" },
      editing: false,
    });

    expect(screen.getByTestId("reference-display")).toBeInTheDocument();
    expect(setEditing).not.toHaveBeenCalled();
  });
});
