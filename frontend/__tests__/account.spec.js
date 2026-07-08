import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

jest.mock("axios");
import axios from "axios";

import AccountPage from "../pages/account";
import AuthContext from "../Context/Auth/authContext";

const renderAccount = (auth) =>
  render(
    <AuthContext.Provider value={auth}>
      <AccountPage />
    </AuthContext.Provider>
  );

const authedUser = {
  loading: false,
  authenticated: true,
  user: {
    email: "owner@example.com",
    name: "Owner Example",
    is_admin: false,
    provider: "google",
  },
};

const mockAccountApi = ({ papers = [], drafts = [] } = {}) => {
  axios.get.mockImplementation((url) => {
    if (url === "/api/account/papers") {
      return Promise.resolve({ data: { count: papers.length, papers } });
    }
    if (url === "/api/account/drafts") {
      return Promise.resolve({ data: { count: drafts.length, drafts } });
    }
    return Promise.reject(new Error(`Unexpected URL: ${url}`));
  });
};

describe("Account page", () => {
  afterEach(() => {
    jest.resetAllMocks();
    localStorage.clear();
  });

  it("prompts anonymous visitors to sign in and fetches nothing", () => {
    renderAccount({ loading: false, authenticated: false, user: null });
    expect(
      screen.getByText(/sign in to see your account/i)
    ).toBeInTheDocument();
    expect(axios.get).not.toHaveBeenCalled();
  });

  it("shows the profile and the user's records with view/edit links", async () => {
    mockAccountApi({
      papers: [
        {
          id: "abc123",
          title: "Photoelectron Spectra",
          authors: "Alex Gaiduk",
          year: 2016,
          tags: ["DFT"],
          collections: ["MICCOM"],
          owner_email: "owner@example.com",
        },
      ],
    });
    renderAccount(authedUser);
    expect(screen.getByText("Owner Example")).toBeInTheDocument();
    expect(screen.getByText("owner@example.com")).toBeInTheDocument();
    expect(screen.getByText(/signed in with google/i)).toBeInTheDocument();
    expect(
      await screen.findByText(/photoelectron spectra \(2016\)/i)
    ).toBeInTheDocument();
    expect(axios.get).toHaveBeenCalledWith("/api/account/papers");
    expect(axios.get).toHaveBeenCalledWith("/api/account/drafts");
    const view = screen.getByRole("link", { name: /^view$/i });
    expect(view.getAttribute("href")).toContain("/paperdetails/abc123");
    const edit = screen.getByRole("link", { name: /edit in curator/i });
    expect(edit.getAttribute("href")).toContain("/curator?edit=abc123");
  });

  it("shows the admin badge for admins", async () => {
    mockAccountApi();
    renderAccount({
      ...authedUser,
      user: { ...authedUser.user, is_admin: true },
    });
    expect(screen.getByText("admin")).toBeInTheDocument();
    expect(
      await screen.findByText(/no published records yet/i)
    ).toBeInTheDocument();
  });

  it("surfaces a browser draft with Resume and Clear", async () => {
    mockAccountApi();
    localStorage.setItem(
      "state",
      JSON.stringify({
        referenceInfo: { title: "My draft paper" },
        charts: [{ id: "c0" }],
      })
    );
    const user = userEvent.setup();
    renderAccount(authedUser);
    expect(await screen.findByText("My draft paper")).toBeInTheDocument();
    expect(screen.getByText(/contains: charts/i)).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /resume/i })
    ).toHaveAttribute("href", "/curator?resumeDraft=1");

    await user.click(screen.getByRole("button", { name: /clear/i }));
    expect(screen.queryByText("My draft paper")).not.toBeInTheDocument();
    expect(localStorage.getItem("state")).toBeNull();
    expect(
      screen.getByText(/no local recovery draft/i)
    ).toBeInTheDocument();
  });

  it("lists multiple account drafts with resume and delete actions", async () => {
    mockAccountApi({
      drafts: [
        {
          id: "draft1",
          title: "First draft",
          updated_at: "2026-07-08T12:00:00",
        },
        {
          id: "draft2",
          title: "Second draft",
          updated_at: "2026-07-08T13:00:00",
        },
      ],
    });
    axios.delete.mockResolvedValue({ data: { success: true } });
    const user = userEvent.setup();

    renderAccount(authedUser);

    expect(await screen.findByText("First draft")).toBeInTheDocument();
    expect(screen.getByText("Second draft")).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: /resume/i })[0]).toHaveAttribute(
      "href",
      "/curator?draft=draft1"
    );

    await user.click(screen.getAllByRole("button", { name: /delete/i })[0]);

    await waitFor(() =>
      expect(axios.delete).toHaveBeenCalledWith("/api/account/drafts/draft1")
    );
    expect(screen.queryByText("First draft")).not.toBeInTheDocument();
    expect(screen.getByText("Second draft")).toBeInTheDocument();
  });
});
