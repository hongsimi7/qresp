import { render, screen, waitFor, within } from "@testing-library/react";
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

const mockAccountApi = ({
  papers = [],
  drafts = [],
  adminPapers = [],
  ownerless = [],
} = {}) => {
  axios.get.mockImplementation((url) => {
    if (url === "/api/account/papers") {
      return Promise.resolve({ data: { count: papers.length, papers } });
    }
    if (url === "/api/account/drafts") {
      return Promise.resolve({ data: { count: drafts.length, drafts } });
    }
    if (url === "/api/admin/papers") {
      return Promise.resolve({
        data: { count: adminPapers.length, papers: adminPapers },
      });
    }
    if (url === "/api/admin/ownerless-papers") {
      return Promise.resolve({
        data: { count: ownerless.length, papers: ownerless },
      });
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

  it("hides View and offers Reactivate for a deactivated record", async () => {
    mockAccountApi({
      papers: [
        {
          id: "p1",
          title: "Hidden Paper",
          authors: "A. Author",
          year: 2020,
          is_active: false,
        },
      ],
    });
    renderAccount(authedUser);
    expect(await screen.findByText(/hidden paper/i)).toBeInTheDocument();
    expect(screen.getByText("deactivated")).toBeInTheDocument();
    // No View link that would land on the public 404 detail page.
    expect(
      screen.queryByRole("link", { name: /^view$/i })
    ).not.toBeInTheDocument();
    // Edit stays available; Reactivate is offered.
    expect(
      screen.getByRole("link", { name: /edit in curator/i })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /reactivate/i })
    ).toBeInTheDocument();
  });

  it("shows View and Deactivate for an active record", async () => {
    mockAccountApi({
      papers: [
        {
          id: "p1",
          title: "Active Paper",
          authors: "A. Author",
          year: 2020,
          is_active: true,
        },
      ],
    });
    renderAccount(authedUser);
    expect(await screen.findByText(/active paper/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /^view$/i })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /deactivate/i })
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /reactivate/i })
    ).not.toBeInTheDocument();
  });

  it("deactivates a record via the confirm dialog and updates the UI", async () => {
    mockAccountApi({
      papers: [
        {
          id: "p1",
          title: "Active Paper",
          authors: "A. Author",
          year: 2020,
          is_active: true,
        },
      ],
    });
    axios.put.mockResolvedValue({
      data: { id: "p1", is_active: false, success: true },
    });
    const user = userEvent.setup();
    renderAccount(authedUser);
    await screen.findByText(/active paper/i);
    await user.click(screen.getByRole("button", { name: /deactivate/i }));
    const dialog = screen.getByRole("dialog");
    // Wording makes clear this is a soft, reversible hide (not a hard delete).
    expect(within(dialog).getByText(/not deleted/i)).toBeInTheDocument();
    await user.click(
      within(dialog).getByRole("button", { name: /deactivate/i })
    );
    await waitFor(() =>
      expect(axios.put).toHaveBeenCalledWith("/api/paper/p1/active", {
        active: false,
      })
    );
    // findByRole polls past the dialog's close animation (which keeps the
    // background aria-hidden briefly) before the row roles become queryable.
    expect(
      await screen.findByRole("button", { name: /reactivate/i })
    ).toBeInTheDocument();
    expect(screen.getByText("deactivated")).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: /^view$/i })
    ).not.toBeInTheDocument();
  });

  it("reactivates a record via the confirm dialog and updates the UI", async () => {
    mockAccountApi({
      papers: [
        {
          id: "p1",
          title: "Hidden Paper",
          authors: "A. Author",
          year: 2020,
          is_active: false,
        },
      ],
    });
    axios.put.mockResolvedValue({
      data: { id: "p1", is_active: true, success: true },
    });
    const user = userEvent.setup();
    renderAccount(authedUser);
    await screen.findByText(/hidden paper/i);
    await user.click(screen.getByRole("button", { name: /reactivate/i }));
    const dialog = screen.getByRole("dialog");
    await user.click(
      within(dialog).getByRole("button", { name: /reactivate/i })
    );
    await waitFor(() =>
      expect(axios.put).toHaveBeenCalledWith("/api/paper/p1/active", {
        active: true,
      })
    );
    expect(
      await screen.findByRole("link", { name: /^view$/i })
    ).toBeInTheDocument();
    expect(screen.queryByText("deactivated")).not.toBeInTheDocument();
  });

  it("marks editor records edit-only: editor chip, no manage buttons", async () => {
    mockAccountApi({
      papers: [
        {
          id: "p1",
          title: "Shared Paper",
          authors: "A. Author",
          year: 2021,
          is_active: true,
          role: "editor",
          editor_emails: ["owner@example.com"],
        },
      ],
    });
    renderAccount(authedUser);
    expect(await screen.findByText(/shared paper/i)).toBeInTheDocument();
    expect(screen.getByText("editor")).toBeInTheDocument();
    // Editors can view and edit, but never manage.
    expect(screen.getByRole("link", { name: /^view$/i })).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /edit in curator/i })
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /deactivate/i })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /editors/i })
    ).not.toBeInTheDocument();
  });

  it("lets the owner manage editors through the Editors dialog", async () => {
    mockAccountApi({
      papers: [
        {
          id: "p1",
          title: "My Paper",
          authors: "A. Author",
          year: 2021,
          is_active: true,
          role: "owner",
          editor_emails: ["old@example.com"],
        },
      ],
    });
    axios.put.mockResolvedValue({
      data: {
        id: "p1",
        editor_emails: ["old@example.com", "new@example.com"],
        success: true,
      },
    });
    const user = userEvent.setup();
    renderAccount(authedUser);
    await screen.findByText(/my paper/i);
    await user.click(screen.getByRole("button", { name: /editors/i }));

    const dialog = screen.getByRole("dialog");
    const input = within(dialog).getByLabelText(/editor emails/i);
    expect(input).toHaveValue("old@example.com");
    // Pasted, not typed key by key: the editor list is controlled by
    // page-level state, so each character re-rendered the whole account page
    // and 31 of them took ~4s of the 5s budget. What this test is about is
    // the list that reaches the API, not the keystrokes -- and pasting a
    // list of addresses is what a curator does with one anyway.
    await user.clear(input);
    await user.paste("old@example.com, new@example.com");
    await user.click(within(dialog).getByRole("button", { name: /save/i }));

    await waitFor(() =>
      expect(axios.put).toHaveBeenCalledWith("/api/paper/p1/editors", {
        editor_emails: ["old@example.com", "new@example.com"],
      })
    );
  });

  it("shows the backend error inline when the editor update fails", async () => {
    mockAccountApi({
      papers: [
        {
          id: "p1",
          title: "My Paper",
          authors: "A. Author",
          year: 2021,
          is_active: true,
          role: "owner",
          editor_emails: [],
        },
      ],
    });
    axios.put.mockRejectedValue({
      response: {
        status: 400,
        data: { error: "invalid editor email: not-an-email" },
      },
    });
    const user = userEvent.setup();
    renderAccount(authedUser);
    await screen.findByText(/my paper/i);
    await user.click(screen.getByRole("button", { name: /editors/i }));
    const dialog = screen.getByRole("dialog");
    await user.type(
      within(dialog).getByLabelText(/editor emails/i),
      "not-an-email"
    );
    await user.click(within(dialog).getByRole("button", { name: /save/i }));
    expect(
      await within(dialog).findByText(/invalid editor email/i)
    ).toBeInTheDocument();
  });

  it("labels a Microsoft session on the profile", async () => {
    mockAccountApi();
    renderAccount({
      ...authedUser,
      user: { ...authedUser.user, provider: "microsoft" },
    });
    expect(
      screen.getByText(/signed in with microsoft/i)
    ).toBeInTheDocument();
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

  it("gives admins the All records section, listing records they do not own", async () => {
    mockAccountApi({
      adminPapers: [
        {
          id: "x1",
          title: "Foreign Paper",
          authors: "Someone Else",
          year: 2018,
          owner_email: "someone@example.com",
          editor_emails: [],
          is_active: true,
        },
      ],
    });
    renderAccount({
      ...authedUser,
      user: { ...authedUser.user, is_admin: true },
    });
    expect(
      screen.getByText(/all records \(admin\)/i)
    ).toBeInTheDocument();
    // A record the admin neither owns nor edits appears (it is NOT in the
    // "My published records" list, which is empty here).
    expect(await screen.findByText(/foreign paper/i)).toBeInTheDocument();
    expect(axios.get).toHaveBeenCalledWith("/api/admin/papers");
  });

  it("hides the admin sections from non-admins", async () => {
    mockAccountApi();
    renderAccount(authedUser);
    await screen.findByText(/no published records yet/i);
    expect(
      screen.queryByText(/all records \(admin\)/i)
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(/ownerless records \(admin\)/i)
    ).not.toBeInTheDocument();
    expect(axios.get).not.toHaveBeenCalledWith("/api/admin/papers");
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

    // Delete is confirmed in a dialog before anything is removed.
    await user.click(screen.getAllByRole("button", { name: /^delete$/i })[0]);
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText(/first draft/i)).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: /^delete$/i }));

    await waitFor(() =>
      expect(axios.delete).toHaveBeenCalledWith("/api/account/drafts/draft1")
    );
    expect(screen.queryByText("First draft")).not.toBeInTheDocument();
    expect(screen.getByText("Second draft")).toBeInTheDocument();
  });

  it("renames an account draft through the rename dialog", async () => {
    mockAccountApi({
      drafts: [
        { id: "draft1", title: "Old name", updated_at: "2026-07-08T12:00:00" },
      ],
    });
    axios.put.mockResolvedValue({
      data: {
        id: "draft1",
        title: "New name",
        updated_at: "2026-07-08T14:00:00",
      },
    });
    const user = userEvent.setup();

    renderAccount(authedUser);
    await screen.findByText("Old name");
    await user.click(screen.getByRole("button", { name: /rename/i }));

    const dialog = screen.getByRole("dialog");
    const input = within(dialog).getByLabelText(/draft name/i);
    await user.clear(input);
    await user.type(input, "New name");
    await user.click(within(dialog).getByRole("button", { name: /save/i }));

    await waitFor(() =>
      expect(axios.put).toHaveBeenCalledWith("/api/account/drafts/draft1", {
        title: "New name",
      })
    );
    expect(await screen.findByText("New name")).toBeInTheDocument();
  });
});
