import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import TopActions from "../components/CuratorElements/TopActions";
import AlertContext from "../Context/Alert/alertContext";
import AuthContext from "../Context/Auth/authContext";
import CuratorContext from "../Context/Curator/curatorContext";
import ServerContext from "../Context/Servers/serverContext";

jest.mock("next/router", () => ({
  useRouter: () => ({ push: jest.fn() }),
}));

const metadata = {
  curatorInfo: { firstName: "A", middleName: "", lastName: "B", emailId: "a@b.co" },
  referenceInfo: { title: "Draft title" },
  paperInfo: { tags: ["draft"] },
  charts: [],
  datasets: [],
  tools: [],
  scripts: [],
  heads: [],
  workflow: { nodes: [], edges: [] },
  license: "",
};

const renderTopActions = ({ hasDraft = true, authenticated = true } = {}) => {
  const setAlert = jest.fn();
  const unsetAlert = jest.fn();
  const resetAll = jest.fn();
  const hasMeaningfulDraft = jest.fn(() => hasDraft);
  const saveDraftToServer = jest.fn(() => Promise.resolve("draft123"));
  render(
    <CuratorContext.Provider
      value={{
        metadata,
        setAll: jest.fn(),
        resetAll,
        getSavedDraft: jest.fn(() => (hasDraft ? metadata : null)),
        resumeDraft: jest.fn(),
        hasMeaningfulDraft,
        saveDraftToServer,
      }}
    >
      <AuthContext.Provider value={{ authenticated }}>
        <AlertContext.Provider value={{ setAlert, unsetAlert }}>
          <ServerContext.Provider
            value={{
              selectedHttp: null,
              setSelectedHttp: jest.fn(),
            }}
          >
            <TopActions />
          </ServerContext.Provider>
        </AlertContext.Provider>
      </AuthContext.Provider>
    </CuratorContext.Provider>
  );
  return { setAlert, unsetAlert, resetAll, saveDraftToServer };
};

describe("TopActions draft controls", () => {
  it("asks what to do with the browser draft before starting from scratch", async () => {
    const user = userEvent.setup();
    const { setAlert, unsetAlert, resetAll } = renderTopActions();

    await user.click(
      screen.getAllByRole("button", {
        name: /clear the session and start afresh/i,
      })[0]
    );

    expect(setAlert).toHaveBeenCalledWith(
      "Start from scratch?",
      "Save this work as a draft in your account before clearing the form, or discard it and start fresh.",
      expect.anything(),
      { hideDismiss: true }
    );

    render(setAlert.mock.calls[0][2]);
    expect(
      screen.getByRole("button", { name: /^cancel$/i })
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: /download metadata/i })
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /save draft and start fresh/i })
    ).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: /discard and start fresh/i })
    );
    expect(resetAll).toHaveBeenCalledWith({ preserveDraft: false });
    expect(unsetAlert).toHaveBeenCalledTimes(1);
  });

  it("can save the account draft before starting from scratch", async () => {
    const user = userEvent.setup();
    const { setAlert, unsetAlert, resetAll, saveDraftToServer } =
      renderTopActions();

    await user.click(
      screen.getAllByRole("button", {
        name: /clear the session and start afresh/i,
      })[0]
    );

    render(setAlert.mock.calls[0][2]);
    await user.click(
      screen.getByRole("button", { name: /save draft and start fresh/i })
    );

    await waitFor(() => expect(saveDraftToServer).toHaveBeenCalledTimes(1));
    expect(resetAll).toHaveBeenCalledWith({ preserveDraft: false });
    expect(unsetAlert).toHaveBeenCalledTimes(1);
  });

  it("leaves the form untouched when cancelling start from scratch", async () => {
    const user = userEvent.setup();
    const { setAlert, unsetAlert, resetAll } = renderTopActions();

    await user.click(
      screen.getAllByRole("button", {
        name: /clear the session and start afresh/i,
      })[0]
    );

    render(setAlert.mock.calls[0][2]);
    await user.click(screen.getByRole("button", { name: /^cancel$/i }));

    expect(resetAll).not.toHaveBeenCalled();
    expect(unsetAlert).toHaveBeenCalledTimes(1);
  });
});
