import { render, screen, waitFor } from "@testing-library/react";

jest.mock("axios");
import axios from "axios";

const mockReplace = jest.fn();
let query = {};

jest.mock("next/router", () => ({
  useRouter: () => ({ query, replace: mockReplace, asPath: "/login" }),
}));

import AuthState from "../Context/Auth/AuthState";
import LoginPage from "../pages/login";
import safeNext, { providerHref, loginHref } from "../Utils/safeNext";

const renderLogin = () =>
  render(
    <AuthState>
      <LoginPage />
    </AuthState>
  );

const anonymous = () =>
  axios.get.mockResolvedValue({ data: { authenticated: false, user: null } });

describe("/login", () => {
  beforeEach(() => {
    query = {};
  });
  afterEach(() => {
    jest.resetAllMocks();
    mockReplace.mockReset();
  });

  it("offers exactly the two supported providers", async () => {
    anonymous();
    renderLogin();

    const microsoft = await screen.findByRole("link", {
      name: /continue with microsoft/i,
    });
    const google = screen.getByRole("link", { name: /continue with google/i });
    expect(microsoft).toHaveAttribute("href", "/api/auth/microsoft?next=%2F");
    expect(google).toHaveAttribute("href", "/api/auth/google?next=%2F");
    expect(screen.getAllByRole("link")).toHaveLength(2);
  });

  it("describes Microsoft as work/school without over-claiming", async () => {
    anonymous();
    renderLogin();
    expect(
      await screen.findByText(/use your work or school account/i)
    ).toBeInTheDocument();
    // No blanket claim that every university uses Microsoft.
    expect(screen.queryByText(/all universit/i)).toBeNull();
    expect(screen.queryByText(/every universit/i)).toBeNull();
  });

  it("carries a safe same-origin next into both provider flows", async () => {
    query = { next: "/curator" };
    anonymous();
    renderLogin();

    expect(
      await screen.findByRole("link", { name: /continue with microsoft/i })
    ).toHaveAttribute("href", "/api/auth/microsoft?next=%2Fcurator");
    expect(
      screen.getByRole("link", { name: /continue with google/i })
    ).toHaveAttribute("href", "/api/auth/google?next=%2Fcurator");
  });

  it("refuses an external next and falls back to the site root", async () => {
    query = { next: "https://evil.example.com/steal" };
    anonymous();
    renderLogin();

    expect(
      await screen.findByRole("link", { name: /continue with google/i })
    ).toHaveAttribute("href", "/api/auth/google?next=%2F");
  });

  it("shows no CILogon, dev-login, or configuration detail", async () => {
    anonymous();
    const { container } = renderLogin();
    await screen.findByRole("link", { name: /continue with google/i });

    const text = container.textContent.toLowerCase();
    ["cilogon", "institutional login", "dev sign in", "dev login",
     "client id", "client secret", "api key", "redirect uri", "drive",
     "gmail", "scope"].forEach((forbidden) => {
      expect(text).not.toContain(forbidden);
    });
  });

  it("sends an already-authenticated visitor on instead of asking again", async () => {
    query = { next: "/curator" };
    axios.get.mockResolvedValue({
      data: {
        authenticated: true,
        user: { email: "o@e.com", name: "O", is_admin: false,
                provider: "google" },
      },
    });
    renderLogin();

    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith("/curator"));
    expect(
      screen.queryByRole("link", { name: /continue with google/i })
    ).toBeNull();
  });

  it("sends an authenticated visitor with no next to their account", async () => {
    axios.get.mockResolvedValue({
      data: {
        authenticated: true,
        user: { email: "o@e.com", name: "O", is_admin: false,
                provider: "microsoft" },
      },
    });
    renderLogin();
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith("/account"));
  });
});

describe("safeNext", () => {
  it("accepts same-origin paths only", () => {
    expect(safeNext("/curator")).toBe("/curator");
    expect(safeNext("/paperdetails/abc?x=1")).toBe("/paperdetails/abc?x=1");
  });

  it("rejects every off-site shape", () => {
    ["https://evil.com", "//evil.com", "http://evil.com/x", "\\\\evil.com",
     "/\\evil.com", "javascript:alert(1)", "evil.com", "", null, undefined,
     42].forEach((value) => {
      expect(safeNext(value)).toBe("/");
    });
  });

  it("builds encoded provider and login hrefs", () => {
    expect(providerHref("google", "/curator")).toBe(
      "/api/auth/google?next=%2Fcurator"
    );
    expect(providerHref("microsoft", "https://evil.com")).toBe(
      "/api/auth/microsoft?next=%2F"
    );
    expect(loginHref("/explorer")).toBe("/login?next=%2Fexplorer");
    expect(loginHref("//evil.com")).toBe("/login?next=%2F");
  });
});
