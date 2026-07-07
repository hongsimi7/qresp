import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import TopActions from "../components/CuratorElements/TopActions";
import AlertContext from "../Context/Alert/alertContext";
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

const renderTopActions = ({ hasDraft = true } = {}) => {
  const setAlert = jest.fn();
  const unsetAlert = jest.fn();
  const resetAll = jest.fn();
  render(
    <CuratorContext.Provider
      value={{
        metadata,
        setAll: jest.fn(),
        resetAll,
        getSavedDraft: jest.fn(() => (hasDraft ? metadata : null)),
        resumeDraft: jest.fn(),
      }}
    >
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
    </CuratorContext.Provider>
  );
  return { setAlert, unsetAlert, resetAll };
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
      "This will clear the browser draft currently saved on this device.",
      expect.anything()
    );

    render(setAlert.mock.calls[0][2]);
    expect(
      screen.getByRole("button", { name: /keep draft/i })
    ).toBeInTheDocument();
    expect(
      screen.getAllByRole("link", { name: /download metadata/i }).length
    ).toBeGreaterThan(0);

    await user.click(
      screen.getByRole("button", { name: /discard draft and start/i })
    );
    expect(resetAll).toHaveBeenCalledTimes(1);
    expect(unsetAlert).toHaveBeenCalledTimes(1);
  });
});
