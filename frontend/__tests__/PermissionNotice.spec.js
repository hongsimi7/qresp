import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

jest.mock("axios");
import axios from "axios";

const reload = jest.fn();
jest.mock("next/router", () => ({
  useRouter: () => ({ reload }),
}));

import AuthContext from "../Context/Auth/authContext";
import PermissionNotice from "../components/Paper/PermissionNotice";

const renderNotice = (authValue, tags = ["DFT"]) =>
  render(
    <AuthContext.Provider value={authValue}>
      <PermissionNotice paperId="abc123" tags={tags} />
    </AuthContext.Provider>
  );

const mockPermissions = (perm) => {
  axios.get.mockResolvedValue({ data: perm });
};

describe("PermissionNotice", () => {
  afterEach(() => jest.resetAllMocks());

  it("tells owners/admins they can edit and shows the edit action", async () => {
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
    expect(
      screen.getByRole("button", { name: /edit metadata/i })
    ).toBeInTheDocument();
    expect(axios.get).toHaveBeenCalledWith("/api/paper/abc123/permissions");
  });

  it("asks anonymous visitors to sign in and hides the edit action", async () => {
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
      screen.queryByRole("button", { name: /edit metadata/i })
    ).not.toBeInTheDocument();
  });

  it("explains owner/admin-only for other users without the edit action", async () => {
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
      screen.queryByRole("button", { name: /edit metadata/i })
    ).not.toBeInTheDocument();
  });

  it("saves tag edits through PUT /api/paper/{id} and reloads", async () => {
    mockPermissions({
      can_edit: true,
      reason: "owner",
      owner_email: "owner@example.com",
      authenticated: true,
      is_admin: false,
    });
    axios.put.mockResolvedValue({ data: { id: "abc123", success: true } });
    const user = userEvent.setup();
    renderNotice({ authenticated: true, loading: false });
    await user.click(
      await screen.findByRole("button", { name: /edit metadata/i })
    );
    const field = screen.getByLabelText(/tags/i);
    await user.clear(field);
    await user.type(field, "DFT, edited-tag");
    await user.click(screen.getByRole("button", { name: /^save$/i }));
    expect(axios.put).toHaveBeenCalledWith("/api/paper/abc123", {
      tags: ["DFT", "edited-tag"],
    });
    expect(reload).toHaveBeenCalled();
  });

  it("shows the backend reason when saving is forbidden", async () => {
    mockPermissions({
      can_edit: true, // stale permission; backend re-checks on save
      reason: "owner",
      owner_email: "owner@example.com",
      authenticated: true,
      is_admin: false,
    });
    axios.put.mockRejectedValue({
      response: {
        status: 403,
        data: { error: "only the record owner or an admin can edit this record" },
      },
    });
    const user = userEvent.setup();
    renderNotice({ authenticated: true, loading: false });
    await user.click(
      await screen.findByRole("button", { name: /edit metadata/i })
    );
    await user.click(screen.getByRole("button", { name: /^save$/i }));
    expect(
      await screen.findByText(/only the record owner or an admin/i)
    ).toBeInTheDocument();
    expect(reload).not.toHaveBeenCalled();
  });

  it("renders nothing when the permission fetch fails (e.g. previews)", async () => {
    axios.get.mockRejectedValue({ response: { status: 404 } });
    const { container } = renderNotice({ authenticated: false, loading: false });
    await new Promise((r) => setTimeout(r, 0));
    expect(container).toBeEmptyDOMElement();
  });
});
