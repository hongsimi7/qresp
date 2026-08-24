/**
 * The Explorer must offer the servers the BACKEND will actually accept.
 *
 * Two copies of the federation list used to exist -- one shipped with the
 * frontend, one enforced by the backend -- and nothing kept them in step. A
 * server could be offered here and then refused with a 400 by the endpoint
 * that reads it, which a reader has no way to understand. The backend is now
 * the source; the checked-in list is only the offline fallback.
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// `Context/axios` is an axios INSTANCE (axios.create), so mocking the axios
// module itself leaves the instance undefined. Mock the instance.
jest.mock("../Context/axios", () => ({
  __esModule: true,
  default: { get: jest.fn() },
}));
import apiEndpoint from "../Context/axios";

// A STABLE push, so what the picker would navigate to can be asserted.
const push = jest.fn();
jest.mock("next/router", () => ({ useRouter: () => ({ push }) }));

import AlertContext from "../Context/Alert/alertContext";
import Explorer from "../pages/explorer";
import shippedServers from "../data/qresp_servers";

const renderExplorer = () =>
  render(
    <AlertContext.Provider
      value={{ setAlert: jest.fn(), unsetAlert: jest.fn() }}
    >
      <Explorer error={false} />
    </AlertContext.Provider>
  );

// jsdom serves the test page from http://localhost, which is exactly the
// staging shape: a LOCAL origin that the federation registry does not list.
const LOCAL_ORIGIN = "http://localhost";

const pushedServers = () =>
  String((push.mock.calls[0] || [{}])[0].query.servers || "").split(",");

describe("Explorer federation list", () => {
  afterEach(() => jest.resetAllMocks());

  // The node the reader is ON must survive the federation fetch landing.
  // It used to be prepended by a second mount effect, and the fetch's
  // `setServers(published)` replaced the whole list afterwards -- so the
  // origin was dropped the moment the request came back, not merely read
  // too early.
  describe("the same-origin node", () => {
    it("survives the federation answer arriving after mount", async () => {
      const user = userEvent.setup();
      apiEndpoint.get.mockResolvedValue({
        data: {
          servers: [
            { qresp_server_url: "https://alpha.example.org", isActive: "Yes" },
          ],
        },
      });
      renderExplorer();
      // Wait for the fetch to land -- this is the moment that used to lose it.
      await waitFor(() => expect(apiEndpoint.get).toHaveBeenCalled());

      await user.click(screen.getByRole("button", { name: /search all/i }));
      const servers = pushedServers();
      expect(servers).toContain(LOCAL_ORIGIN);
      expect(servers).toContain("https://alpha.example.org");
    });

    it("is offered as a choice, not only searched by Search All", async () => {
      apiEndpoint.get.mockResolvedValue({
        data: {
          servers: [
            { qresp_server_url: "https://alpha.example.org", isActive: "Yes" },
          ],
        },
      });
      const { container } = renderExplorer();
      await waitFor(() => expect(apiEndpoint.get).toHaveBeenCalled());
      // The Autocomplete reads the same derived list, so the reader can pick
      // their own node deliberately. It only renders options once opened.
      await userEvent.click(container.querySelector("input"));
      expect(await screen.findByText(LOCAL_ORIGIN)).toBeInTheDocument();
    });

    it("is still there when the backend cannot be reached at all", async () => {
      const user = userEvent.setup();
      apiEndpoint.get.mockRejectedValue(new Error("no endpoint"));
      renderExplorer();
      await waitFor(() => expect(apiEndpoint.get).toHaveBeenCalled());

      await user.click(screen.getByRole("button", { name: /search all/i }));
      expect(pushedServers()).toContain(LOCAL_ORIGIN);
    });

    it("is not added twice when the registry already lists it", async () => {
      const user = userEvent.setup();
      apiEndpoint.get.mockResolvedValue({
        data: {
          servers: [{ qresp_server_url: LOCAL_ORIGIN, isActive: "Yes" }],
        },
      });
      renderExplorer();
      await waitFor(() => expect(apiEndpoint.get).toHaveBeenCalled());

      await user.click(screen.getByRole("button", { name: /search all/i }));
      const servers = pushedServers();
      expect(servers.filter((o) => o === LOCAL_ORIGIN)).toHaveLength(1);
    });
  });

  it("asks the backend which servers this deployment federates with", async () => {
    apiEndpoint.get.mockResolvedValue({ data: { servers: [] } });
    renderExplorer();
    await waitFor(() =>
      expect(apiEndpoint.get).toHaveBeenCalledWith("/api/federation/servers")
    );
  });

  it("offers the servers the backend published", async () => {
    apiEndpoint.get.mockResolvedValue({
      data: {
        servers: [
          {
            qresp_server_url: "https://published.example.org",
            isActive: "Yes",
            qresp_maintainer_emails: [],
          },
        ],
      },
    });
    const { container } = renderExplorer();
    await waitFor(() => expect(apiEndpoint.get).toHaveBeenCalled());
    // MUI Autocomplete only renders its options once opened.
    await userEvent.click(container.querySelector("input"));
    expect(
      await screen.findByText("https://published.example.org")
    ).toBeInTheDocument();
  });

  it("keeps the shipped list when the backend cannot be reached", async () => {
    // An older backend, or one that is down: the Explorer still works.
    apiEndpoint.get.mockRejectedValue(new Error("Network Error"));
    const { container } = renderExplorer();
    await waitFor(() => expect(apiEndpoint.get).toHaveBeenCalled());
    await userEvent.click(container.querySelector("input"));
    expect(
      await screen.findByText(shippedServers[0].qresp_server_url)
    ).toBeInTheDocument();
  });

  it("respects an empty published list and offers nothing", async () => {
    // An empty list is an ANSWER: the operator set QRESP_FEDERATION_SERVERS
    // to nothing, so this deployment federates with nobody. Offering the
    // shipped peers anyway would show servers the backend refuses with a 400.
    apiEndpoint.get.mockResolvedValue({ data: { servers: [] } });
    const { container } = renderExplorer();
    await waitFor(() => expect(apiEndpoint.get).toHaveBeenCalled());
    await userEvent.click(container.querySelector("input"));
    await waitFor(() =>
      expect(
        screen.queryByText(shippedServers[0].qresp_server_url)
      ).not.toBeInTheDocument()
    );
    for (const server of shippedServers) {
      expect(
        screen.queryByText(server.qresp_server_url)
      ).not.toBeInTheDocument();
    }
  });

  it("keeps the shipped list when the answer is not the documented shape", async () => {
    // Malformed is not the same as empty: it says nothing about what this
    // deployment federates with, so the offline fallback still applies.
    for (const data of [{}, { servers: null }, { servers: "nope" }, null]) {
      apiEndpoint.get.mockResolvedValue({ data });
      const { container, unmount } = renderExplorer();
      await waitFor(() => expect(apiEndpoint.get).toHaveBeenCalled());
      await userEvent.click(container.querySelector("input"));
      expect(
        await screen.findByText(shippedServers[0].qresp_server_url)
      ).toBeInTheDocument();
      unmount();
      apiEndpoint.get.mockClear();
    }
  });
});
