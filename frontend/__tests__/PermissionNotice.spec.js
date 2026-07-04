import { render, screen } from "@testing-library/react";

jest.mock("axios");
import axios from "axios";

import AuthContext from "../Context/Auth/authContext";
import PermissionNotice from "../components/Paper/PermissionNotice";

const renderNotice = (authValue) =>
  render(
    <AuthContext.Provider value={authValue}>
      <PermissionNotice paperId="abc123" />
    </AuthContext.Provider>
  );

describe("PermissionNotice", () => {
  afterEach(() => jest.resetAllMocks());

  it("tells owners/admins they can edit (backend decision)", async () => {
    axios.get.mockResolvedValue({
      data: {
        can_edit: true,
        reason: "owner",
        owner_email: "owner@example.com",
        authenticated: true,
        is_admin: false,
      },
    });
    renderNotice({ authenticated: true, loading: false });
    expect(
      await screen.findByText(/you can edit this record/i)
    ).toBeInTheDocument();
    expect(axios.get).toHaveBeenCalledWith("/api/paper/abc123/permissions");
  });

  it("asks anonymous visitors to sign in", async () => {
    axios.get.mockResolvedValue({
      data: {
        can_edit: false,
        reason: "authentication required",
        owner_email: "owner@example.com",
        authenticated: false,
        is_admin: false,
      },
    });
    renderNotice({ authenticated: false, loading: false });
    expect(
      await screen.findByText(/sign in to edit this record/i)
    ).toBeInTheDocument();
  });

  it("explains owner/admin-only for other users", async () => {
    axios.get.mockResolvedValue({
      data: {
        can_edit: false,
        reason: "only the record owner or an admin can edit this record",
        owner_email: "owner@example.com",
        authenticated: true,
        is_admin: false,
      },
    });
    renderNotice({ authenticated: true, loading: false });
    expect(
      await screen.findByText(/only the record owner or an admin/i)
    ).toBeInTheDocument();
  });

  it("renders nothing when the permission fetch fails (e.g. previews)", async () => {
    axios.get.mockRejectedValue({ response: { status: 404 } });
    const { container } = renderNotice({ authenticated: false, loading: false });
    await new Promise((r) => setTimeout(r, 0));
    expect(container).toBeEmptyDOMElement();
  });
});
