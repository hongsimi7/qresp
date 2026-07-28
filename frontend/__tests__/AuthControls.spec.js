import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

jest.mock("axios");
import axios from "axios";

const mockPush = jest.fn();

jest.mock("next/router", () => ({
  useRouter: () => ({ asPath: "/explorer", push: mockPush }),
}));

import AuthState from "../Context/Auth/AuthState";
import AuthControls from "../components/AuthControls";
import Header from "../components/header";

const renderControls = () =>
  render(
    <AuthState>
      <AuthControls />
    </AuthState>
  );

const anonymous = () =>
  axios.get.mockResolvedValue({ data: { authenticated: false, user: null } });

describe("AuthControls", () => {
  afterEach(() => {
    jest.resetAllMocks();
    mockPush.mockReset();
  });

  it("offers ONE sign-in entry point when anonymous, not provider buttons", async () => {
    anonymous();
    renderControls();

    const signIn = await screen.findByRole("link", { name: /^sign in$/i });
    // It leads to the choice page, carrying the current page as a
    // same-origin return path.
    expect(signIn).toHaveAttribute("href", "/login?next=%2Fexplorer");

    // No provider branding, and no staging-only login, in the header.
    expect(screen.queryByRole("link", { name: /google/i })).toBeNull();
    expect(screen.queryByRole("link", { name: /microsoft/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /dev sign in/i })).toBeNull();
    expect(screen.queryByText(/institution/i)).toBeNull();
    expect(screen.queryByText(/cilogon/i)).toBeNull();
  });

  it("shows the user, admin label and a sign-out button when authenticated", async () => {
    axios.get.mockResolvedValue({
      data: {
        authenticated: true,
        user: {
          email: "owner@example.com",
          name: "Owner Example",
          is_admin: true,
          provider: "microsoft",
        },
      },
    });
    renderControls();
    expect(await screen.findByText(/Owner Example/)).toBeInTheDocument();
    expect(screen.getByText(/\(admin\)/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Owner Example/ })).toHaveAttribute(
      "href",
      "/account"
    );
    expect(
      screen.getByRole("button", { name: /sign out/i })
    ).toBeInTheDocument();
    // The sign-in entry point is gone while signed in.
    expect(screen.queryByRole("link", { name: /^sign in$/i })).toBeNull();
  });

  it("logs out back to the anonymous state and returns home", async () => {
    axios.get.mockResolvedValue({
      data: {
        authenticated: true,
        user: {
          email: "o@e.com",
          name: "",
          is_admin: false,
          provider: "google",
        },
      },
    });
    axios.post.mockResolvedValue({ data: { success: true } });
    const user = userEvent.setup();
    renderControls();
    await user.click(await screen.findByRole("button", { name: /sign out/i }));
    expect(axios.post).toHaveBeenCalledWith("/api/auth/logout");
    expect(mockPush).toHaveBeenCalledWith("/");
    expect(
      await screen.findByRole("link", { name: /^sign in$/i })
    ).toBeInTheDocument();
  });
});

describe("Header sign-in availability", () => {
  afterEach(() => {
    jest.resetAllMocks();
    mockPush.mockReset();
  });

  const renderHeader = () =>
    render(
      <AuthState>
        <Header />
      </AuthState>
    );

  it("keeps exactly one Sign in control, outside the drawer, at any width", async () => {
    anonymous();
    renderHeader();

    const signIn = await screen.findAllByRole("link", { name: /^sign in$/i });
    // One control only — it is not duplicated into the collapsible drawer.
    expect(signIn).toHaveLength(1);
    expect(signIn[0]).toHaveAttribute("href", "/login?next=%2Fexplorer");
    // It must not wrap out of the header row.
    expect(signIn[0]).toHaveStyle("white-space: nowrap");

    // The hamburger is a sibling, not its container: opening the drawer is
    // never required to reach sign-in.
    const menu = screen.getByRole("button", { name: "" });
    expect(menu).not.toContainElement(signIn[0]);
  });

  it("never moves or duplicates Sign in into the navigation drawer", async () => {
    anonymous();
    const user = userEvent.setup();
    renderHeader();
    await screen.findByRole("link", { name: /^sign in$/i });

    await user.click(screen.getByRole("button", { name: "" }));

    // The drawer carries navigation only. The one sign-in control stays in
    // the header bar (the open modal hides it from the a11y tree, hence
    // hidden: true) — it is never relocated behind the hamburger.
    const drawer = await screen.findByRole("presentation");
    expect(drawer).not.toHaveTextContent(/sign in/i);
    expect(drawer).toHaveTextContent(/explorer/i);
    expect(
      screen.getAllByRole("link", { name: /^sign in$/i, hidden: true })
    ).toHaveLength(1);
  });

  it("shows the signed-in identity in the header at any width", async () => {
    axios.get.mockResolvedValue({
      data: {
        authenticated: true,
        user: {
          email: "prof@uchicago.edu",
          name: "Prof Example",
          is_admin: false,
          provider: "microsoft",
        },
      },
    });
    renderHeader();
    expect(await screen.findByText(/Prof Example/)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /sign out/i })
    ).toBeInTheDocument();
  });
});
