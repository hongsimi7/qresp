import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axios from "axios";

import Publish, {
  getPublishErrorMessage,
} from "../components/CuratorElements/Publish";
import AlertContext from "../Context/Alert/alertContext";
import CuratorContext from "../Context/Curator/curatorContext";
import CuratorHelperContext from "../Context/CuratorHelpers/curatorHelperContext";
import LoadingContext from "../Context/Loading/loadingContext";
import ServerContext from "../Context/Servers/serverContext";
import { convertReqSchematoState } from "../Utils/model";
import paperDoc from "./fixtures/paperDoc.json";

jest.mock("axios", () => ({
  post: jest.fn(),
}));

const renderPublish = ({ setAlert = jest.fn() } = {}) => {
  const metadata = convertReqSchematoState(paperDoc);
  const showLoader = jest.fn();
  const hideLoader = jest.fn();
  render(
    <CuratorContext.Provider value={{ metadata }}>
      <CuratorHelperContext.Provider value={{ editing: {} }}>
        <ServerContext.Provider value={{ selectedHttp: null }}>
          <AlertContext.Provider value={{ setAlert }}>
            <LoadingContext.Provider value={{ showLoader, hideLoader }}>
              <Publish />
            </LoadingContext.Provider>
          </AlertContext.Provider>
        </ServerContext.Provider>
      </CuratorHelperContext.Provider>
    </CuratorContext.Provider>
  );
  return { setAlert, showLoader, hideLoader };
};

describe("Publish", () => {
  let consoleError;

  beforeEach(() => {
    axios.post.mockResolvedValue({ data: {} });
    consoleError = jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleError.mockRestore();
    jest.clearAllMocks();
  });

  it("submits immediately after validation without the stale warning dialog", async () => {
    const user = userEvent.setup();
    const { setAlert, showLoader, hideLoader } = renderPublish();

    await user.click(screen.getByRole("button", { name: /^publish$/i }));

    await waitFor(() => expect(axios.post).toHaveBeenCalledTimes(1));
    expect(axios.post.mock.calls[0][0]).toMatch(/\/api\/publish$/);
    expect(showLoader).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(hideLoader).toHaveBeenCalledTimes(1));
    expect(setAlert).not.toHaveBeenCalledWith(
      "Warning",
      expect.anything(),
      null
    );
  });

  it("extracts useful publish errors from current and legacy backend shapes", () => {
    expect(
      getPublishErrorMessage({ response: { data: { msg: "schema failed" } } })
    ).toBe("schema failed");
    expect(
      getPublishErrorMessage({ response: { data: { error: "CSRF failed" } } })
    ).toBe("CSRF failed");
    expect(
      getPublishErrorMessage({ response: { data: "Internal Server Error" } })
    ).toBe("Internal Server Error");
  });
});
