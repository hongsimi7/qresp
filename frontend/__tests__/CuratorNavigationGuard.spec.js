import { useState } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { CuratorDraftNavigationGuard } from "../pages/curator";
import AlertContext from "../Context/Alert/alertContext";
import AuthContext from "../Context/Auth/authContext";
import CuratorContext from "../Context/Curator/curatorContext";

const mockPush = jest.fn();

jest.mock("yet-another-react-lightbox", () => function Lightbox() {
  return null;
});
jest.mock("yet-another-react-lightbox/plugins/captions", () => ({}));
jest.mock("yet-another-react-lightbox/plugins/thumbnails", () => ({}));

jest.mock("next/router", () => ({
  useRouter: () => ({
    asPath: "/curator",
    push: mockPush,
    query: {},
  }),
}));

const renderGuard = () => {
  const saveDraftToServer = jest.fn(() => Promise.resolve("draft123"));
  const unsetAlert = jest.fn();

  const Harness = () => {
    const [alertContent, setAlertContent] = useState(null);
    return (
      <CuratorContext.Provider
        value={{
          getDraftTitle: jest.fn(() => "Leaving draft"),
          hasUnsavedDraftChanges: jest.fn(() => true),
          hasMeaningfulDraft: jest.fn(() => true),
          saveDraft: jest.fn(),
          draftDirty: true,
          saveDraftToServer,
        }}
      >
        <AuthContext.Provider value={{ authenticated: true }}>
          <AlertContext.Provider
            value={{
              setAlert: jest.fn((title, message, content) =>
                setAlertContent(content)
              ),
              unsetAlert: () => {
                unsetAlert();
                setAlertContent(null);
              },
            }}
          >
            <a href="/explorer">Explorer</a>
            {alertContent ? <div>{alertContent}</div> : null}
            <CuratorDraftNavigationGuard editMode={false} />
          </AlertContext.Provider>
        </AuthContext.Provider>
      </CuratorContext.Provider>
    );
  };

  render(<Harness />);
  return { saveDraftToServer, unsetAlert };
};

describe("CuratorDraftNavigationGuard", () => {
  beforeEach(() => {
    mockPush.mockClear();
  });

  it("asks for a draft name before saving and leaving", async () => {
    const user = userEvent.setup();
    const { saveDraftToServer, unsetAlert } = renderGuard();

    await user.click(screen.getByRole("link", { name: /explorer/i }));
    await user.click(
      screen.getByRole("button", { name: /save draft and leave/i })
    );

    expect(await screen.findByLabelText(/draft name/i)).toHaveValue(
      "Leaving draft"
    );
    await user.clear(screen.getByLabelText(/draft name/i));
    await user.type(screen.getByLabelText(/draft name/i), "Named leave draft");
    await user.click(
      screen.getByRole("button", { name: /save draft and leave/i })
    );

    await waitFor(() =>
      expect(saveDraftToServer).toHaveBeenCalledWith("Named leave draft")
    );
    expect(unsetAlert).toHaveBeenCalledTimes(1);
    expect(mockPush).toHaveBeenCalledWith("/explorer");
  });
});
