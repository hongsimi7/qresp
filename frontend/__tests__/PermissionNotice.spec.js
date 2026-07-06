import { render, screen } from "@testing-library/react";

jest.mock("axios");
import axios from "axios";

import AuthContext from "../Context/Auth/authContext";
import PermissionNotice from "../components/Paper/PermissionNotice";

const renderNotice = (authValue) =>
  render(
    <AuthContext.Provider value={authValue}>
      <PermissionNotice paperId="abc123" server="https://localhost:8443" />
    </AuthContext.Provider>
  );

const mockPermissions = (perm) => {
  axios.get.mockResolvedValue({ data: perm });
};

describe("PermissionNotice", () => {
  afterEach(() => jest.resetAllMocks());

  it("tells owners/admins they can edit and links to the curator edit mode", async () => {
    mockPermissions({
      can_edit: true,
      reason: "owner",
      owner_email: "owner@example.com",
      authenticated: true,
      is_admin: false,
    });
    renderNotice({ authenticated: true, loading: false });
    expect(
      await screen.findByText(/you can edit this record/i)
    ).toBeInTheDocument();
    const link = screen.getByRole("link", { name: /edit in curator/i });
    expect(link).toHaveAttribute(
      "href",
      "/curator?edit=abc123&server=https%3A%2F%2Flocalhost%3A8443"
    );
    expect(axios.get).toHaveBeenCalledWith("/api/paper/abc123/permissions");
  });

  it("asks anonymous visitors to sign in and shows no edit link", async () => {
    mockPermissions({
      can_edit: false,
      reason: "authentication required",
      owner_email: "owner@example.com",
      authenticated: false,
      is_admin: false,
    });
    renderNotice({ authenticated: false, loading: false });
    expect(
      await screen.findByText(/sign in to edit this record/i)
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: /edit in curator/i })
    ).not.toBeInTheDocument();
  });

  it("explains owner/admin-only for other users without the edit link", async () => {
    mockPermissions({
      can_edit: false,
      reason: "only the record owner or an admin can edit this record",
      owner_email: "owner@example.com",
      authenticated: true,
      is_admin: false,
    });
    renderNotice({ authenticated: true, loading: false });
    expect(
      await screen.findByText(/only the record owner or an admin/i)
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: /edit in curator/i })
    ).not.toBeInTheDocument();
  });

  it("renders nothing when the permission fetch fails (e.g. previews)", async () => {
    axios.get.mockRejectedValue({ response: { status: 404 } });
    const { container } = renderNotice({ authenticated: false, loading: false });
    await new Promise((r) => setTimeout(r, 0));
    expect(container).toBeEmptyDOMElement();
  });
});
