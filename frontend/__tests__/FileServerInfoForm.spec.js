import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

jest.mock("axios");
import axios from "axios";

jest.mock("../Utils/Scraper", () => ({ getList: jest.fn() }));
import { getList } from "../Utils/Scraper";

import FileServerInfoForm from "../components/CuratorForms/FileServerInfoForm";
import FileServerElement from "../components/CuratorElements/FileServerElement";
import ServerContext from "../Context/Servers/serverContext";
import AlertContext from "../Context/Alert/alertContext";
import SourceTreeContext from "../Context/SourceTree/SourceTreeContext";
import LoadingContext from "../Context/Loading/loadingContext";
import CuratorContext from "../Context/Curator/curatorContext";
import CuratorHelperContext from "../Context/CuratorHelpers/curatorHelperContext";
import sourceTreeReducer, {
  DEFAULT_CONFIRM_LABEL,
} from "../Context/SourceTree/SourceTreeReducer";
import { SET_SAVE_BUTTON_ACTION, SET_CONFIRM_LABEL } from "../Context/types";

const ROOT = "https://notebook.rcc.uchicago.edu/files";
const FOLDER = `${ROOT}/10.1021.acs.jpcc.5c01077`;

const renderForm = (curator = {}, tree = {}) => {
  const setFileServerPath = jest.fn();
  const editor = jest.fn();
  const setSaveMethod = jest.fn();
  const openSelector = jest.fn();
  const setConfirmLabel = jest.fn();
  const setAlert = jest.fn();
  render(
    <ServerContext.Provider
      value={{
        httpServers: [{ label: "RCC", value: ROOT }],
        setSelectedHttp: jest.fn(),
      }}
    >
      <AlertContext.Provider value={{ setAlert }}>
        <SourceTreeContext.Provider
          value={{
            setTree: jest.fn(),
            openSelector,
            setSaveMethod,
            setConfirmLabel,
            ...tree,
          }}
        >
          <LoadingContext.Provider
            value={{ showLoader: jest.fn(), hideLoader: jest.fn() }}
          >
            <CuratorContext.Provider
              value={{ fileServerPath: "", setFileServerPath, ...curator }}
            >
              <FileServerInfoForm editor={editor} />
            </CuratorContext.Provider>
          </LoadingContext.Provider>
        </SourceTreeContext.Provider>
      </AlertContext.Provider>
    </ServerContext.Provider>
  );
  return { setFileServerPath, editor, setSaveMethod, openSelector, setAlert };
};

const chooseRoot = async (user) => {
  await user.click(screen.getByRole("combobox"));
  await user.click(await screen.findByRole("option", { name: /rcc/i }));
};

// Runs a real Search and hands back the callback the file tree would invoke
// when the curator confirms a folder.
const searchAndGetPicker = async (user, handles) => {
  await chooseRoot(user);
  await user.click(screen.getByRole("button", { name: /^search$/i }));
  await waitFor(() => expect(handles.openSelector).toHaveBeenCalled());
  return handles.setSaveMethod.mock.calls[0][0];
};

describe("FileServerInfoForm", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getList.mockResolvedValue({
      files: [{ label: "folder", value: FOLDER }],
      details: {},
    });
    axios.post.mockResolvedValue({ data: { candidates: {} } });
  });

  it("registers the default File Server radio value without crashing", () => {
    renderForm();

    expect(screen.getByRole("radio", { name: /file server/i })).toBeChecked();
    expect(screen.getByRole("radio", { name: /zenodo/i })).not.toBeChecked();
  });

  it("updates the connection type radio through RHF control", async () => {
    const user = userEvent.setup();
    renderForm();

    await user.click(screen.getByRole("radio", { name: /zenodo/i }));

    expect(screen.getByRole("radio", { name: /zenodo/i })).toBeChecked();
    expect(
      screen.getByPlaceholderText(/enter zenodo record url/i)
    ).toBeInTheDocument();
  });

  it("picking a folder records the choice WITHOUT saving or closing", async () => {
    const user = userEvent.setup();
    const handles = renderForm();
    const pick = await searchAndGetPicker(user, handles);

    pick(FOLDER);

    // The whole point of the repair: no commit, no section close.
    await waitFor(() =>
      expect(screen.getByTestId("selected-folder")).toHaveTextContent(FOLDER)
    );
    expect(handles.setFileServerPath).not.toHaveBeenCalled();
    expect(handles.editor).not.toHaveBeenCalled();
    // The form is still on screen and still offers both next steps.
    expect(
      screen.getByRole("button", { name: /^search$/i })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /save file server/i })
    ).toBeEnabled();
  });

  it("shows nothing selected before a folder is picked, and cannot save", () => {
    renderForm();
    expect(screen.getByTestId("selected-folder")).toHaveTextContent(
      /none yet/i
    );
    expect(
      screen.getByRole("button", { name: /save file server/i })
    ).toBeDisabled();
    expect(
      screen.getByText(/pick a folder before saving the file server path/i)
    ).toBeInTheDocument();
  });

  it("analyzes the UNSAVED selected folder without committing it", async () => {
    const user = userEvent.setup();
    const handles = renderForm();
    const pick = await searchAndGetPicker(user, handles);

    // Not analyzable until something is picked.
    expect(
      screen.getByRole("button", { name: /analyze rcc folder/i })
    ).toBeDisabled();

    pick(FOLDER);
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /analyze rcc folder/i })
      ).toBeEnabled()
    );

    await user.click(screen.getByRole("button", { name: /analyze rcc folder/i }));
    await waitFor(() => expect(axios.post).toHaveBeenCalled());
    expect(axios.post).toHaveBeenCalledWith("/api/curation/analyze-folder", {
      path: FOLDER,
    });
    // Analysis is not a commit.
    expect(handles.setFileServerPath).not.toHaveBeenCalled();
    expect(handles.editor).not.toHaveBeenCalled();
  });

  it("Save File Server is the only action that commits and exits", async () => {
    const user = userEvent.setup();
    const handles = renderForm();
    const pick = await searchAndGetPicker(user, handles);
    pick(FOLDER);
    await waitFor(() =>
      expect(screen.getByTestId("selected-folder")).toHaveTextContent(FOLDER)
    );

    await user.click(screen.getByRole("button", { name: /save file server/i }));

    expect(handles.setFileServerPath).toHaveBeenCalledWith(FOLDER);
    expect(handles.editor).toHaveBeenCalled();
  });

  it("seeds the selection from an already saved path so editing is not empty", () => {
    renderForm({ fileServerPath: FOLDER });
    expect(screen.getByTestId("selected-folder")).toHaveTextContent(FOLDER);
    expect(
      screen.getByRole("button", { name: /analyze rcc folder/i })
    ).toBeEnabled();
  });

  it("a failed search never erases the saved path or the selection", async () => {
    const user = userEvent.setup();
    getList.mockRejectedValue(new Error("unreachable"));
    jest.spyOn(console, "error").mockImplementation(() => {});
    const handles = renderForm({ fileServerPath: FOLDER });

    await user.click(screen.getByRole("button", { name: /^search$/i }));
    await waitFor(() => expect(handles.setAlert).toHaveBeenCalled());

    expect(screen.getByTestId("selected-folder")).toHaveTextContent(FOLDER);
    expect(handles.setFileServerPath).not.toHaveBeenCalled();
    console.error.mockRestore();
  });

  it("starting a new search does not clear the current selection", async () => {
    const user = userEvent.setup();
    const handles = renderForm({ fileServerPath: FOLDER });

    await user.click(screen.getByRole("button", { name: /^search$/i }));
    await waitFor(() => expect(handles.openSelector).toHaveBeenCalled());

    expect(screen.getByTestId("selected-folder")).toHaveTextContent(FOLDER);
    expect(handles.setFileServerPath).not.toHaveBeenCalled();
  });

  it("renames the file tree confirmation for the file-server picker only", async () => {
    const user = userEvent.setup();
    const setConfirmLabel = jest.fn();
    const handles = renderForm({}, { setConfirmLabel });
    await searchAndGetPicker(user, handles);
    expect(setConfirmLabel).toHaveBeenCalledWith("Use selected folder");
  });
});

describe("file tree confirmation label", () => {
  it("defaults to Save and never leaks between selector consumers", () => {
    // The chart/dataset/script/tool/notebook pickers do not opt in, so
    // setting their save method must restore the default wording.
    const initial = { save: null, confirmLabel: DEFAULT_CONFIRM_LABEL };
    expect(DEFAULT_CONFIRM_LABEL).toBe("Save");

    const forFileServer = sourceTreeReducer(
      sourceTreeReducer(initial, {
        type: SET_SAVE_BUTTON_ACTION,
        payload: jest.fn(),
      }),
      { type: SET_CONFIRM_LABEL, payload: "Use selected folder" }
    );
    expect(forFileServer.confirmLabel).toBe("Use selected folder");

    const forChart = sourceTreeReducer(forFileServer, {
      type: SET_SAVE_BUTTON_ACTION,
      payload: jest.fn(),
    });
    expect(forChart.confirmLabel).toBe("Save");
  });
});

describe("File Server display card", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    axios.post.mockResolvedValue({ data: { candidates: {} } });
  });

  const renderElement = (fileServerPath) =>
    render(
      <AlertContext.Provider value={{ setAlert: jest.fn() }}>
        <CuratorContext.Provider
          value={{ fileServerPath, addMany: jest.fn() }}
        >
          <CuratorHelperContext.Provider
            value={{
              editing: { fileServerPathInfo: false },
              setEditing: jest.fn(),
            }}
          >
            <FileServerElement />
          </CuratorHelperContext.Provider>
        </CuratorContext.Provider>
      </AlertContext.Provider>
    );

  it("offers Analyze RCC Folder on the saved path without entering edit mode", async () => {
    renderElement(FOLDER);

    const analyze = await screen.findByRole("button", {
      name: /analyze rcc folder/i,
    });
    expect(analyze).toBeEnabled();
    // Exactly one Analyze button: the form side is unmounted.
    expect(
      screen.getAllByRole("button", { name: /analyze rcc folder/i })
    ).toHaveLength(1);
    // And no editing was required to get here.
    expect(
      screen.queryByRole("button", { name: /save file server/i })
    ).toBeNull();
  });

  it("analyzes the SAVED path from the display card", async () => {
    const user = userEvent.setup();
    renderElement(FOLDER);

    await user.click(
      await screen.findByRole("button", { name: /analyze rcc folder/i })
    );
    await waitFor(() => expect(axios.post).toHaveBeenCalled());
    expect(axios.post).toHaveBeenCalledWith("/api/curation/analyze-folder", {
      path: FOLDER,
    });
  });
});
