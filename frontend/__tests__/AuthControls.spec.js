import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

jest.mock("axios");
import axios from "axios";

import AuthState from "../Context/Auth/AuthState";
import AuthControls from "../components/AuthControls";

const renderControls = () =>
  render(
    <AuthState>
      <AuthControls />
    </AuthState>
  );

describe("AuthControls", () => {
  afterEach(() => jest.resetAllMocks());

  it("shows the dev sign-in entry point when anonymous", async () => {
    axios.get.mockResolvedValue({
      data: { authenticated: false, user: null },
    });
    renderControls();
    expect(
      await screen.findByRole("button", { name: /dev sign in/i })
    ).toBeInTheDocument();
  });

  it("shows the user and a sign-out button when authenticated", async () => {
    axios.get.mockResolvedValue({
      data: {
        authenticated: true,
        user: {
          email: "owner@example.com",
          name: "Owner Example",
          is_admin: true,
          provider: "dev",
        },
      },
    });
    renderControls();
    expect(await screen.findByText(/Owner Example/)).toBeInTheDocument();
    expect(screen.getByText(/\(admin\)/)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /sign out/i })
    ).toBeInTheDocument();
  });

  it("logs out back to the anonymous state", async () => {
    axios.get.mockResolvedValue({
      data: {
        authenticated: true,
        user: { email: "o@e.com", name: "", is_admin: false, provider: "dev" },
      },
    });
    axios.post.mockResolvedValue({ data: { success: true } });
    const user = userEvent.setup();
    renderControls();
    await user.click(await screen.findByRole("button", { name: /sign out/i }));
    expect(axios.post).toHaveBeenCalledWith("/api/auth/logout");
    expect(
      await screen.findByRole("button", { name: /dev sign in/i })
    ).toBeInTheDocument();
  });

  it("reports when dev login is disabled on the server", async () => {
    axios.get.mockResolvedValue({
      data: { authenticated: false, user: null },
    });
    axios.post.mockRejectedValue({ response: { status: 404 } });
    const user = userEvent.setup();
    renderControls();
    await user.click(await screen.findByRole("button", { name: /dev sign in/i }));
    await user.type(screen.getByLabelText(/email/i), "owner@example.com");
    await user.click(screen.getByRole("button", { name: /^sign in$/i }));
    expect(
      await screen.findByText(/development login is unavailable/i)
    ).toBeInTheDocument();
  });
});
