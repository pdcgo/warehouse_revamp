import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { asTeam, marker, routedPage } from "../../../.storybook/pageStory";
import { asRole } from "../../../.storybook/sessionScenario";
import { Role } from "../../gen/warehouse/role_base/v1/role_pb";
import { UsersPage } from "./index";

// The Users page — docs/business/user/context_decision.md. A PROTOTYPE: the screen is built to the
// decisions and the stub (.storybook/userStub.ts) plays them; the running server has not changed yet,
// which is what the page's own "not implemented" strip says.
//
// Gudang Pusat (team 11): Dewi is its Owner, Budi its Admin, Eko and Citra (suspended) its Staff, and
// the person in front of the screen — ani — holds whatever role the story stands as. Fajar is a second
// Root and Gita the System Administrator, both in the root team only. Every play() is one decided rule.

const Routed = routedPage([{ path: "/users", element: <UsersPage /> }, marker("/users/:id", "at-user-detail")], "/users");

const meta = {
  title: "Pages/Users/Users",
  component: Routed,
  parameters: { signedIn: true, dataRouter: true },
  beforeEach: asTeam(11n),
} satisfies Meta<typeof Routed>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Switch to All User and wait for ITS rows — Fajar is in no team, so his row is the all view's own. */
async function allUsers(canvas: ReturnType<typeof within>) {
  await userEvent.click(await canvas.findByTestId("users-tab-all"));
  await waitFor(() => expect(canvas.getByTestId("role-fajar")).toHaveTextContent("Root"), { timeout: 4000 });
}

/** Open the Membership History tab and return its panel. */
async function history(canvas: ReturnType<typeof within>) {
  await userEvent.click(await canvas.findByTestId("users-tab-history"));

  return canvas.findByTestId("member-log");
}

async function loaded(canvasElement: HTMLElement) {
  const canvas = within(canvasElement);
  await waitFor(() => expect(canvas.getByTestId("role-dewi")).toHaveTextContent("Warehouse Owner"), { timeout: 4000 });

  return canvas;
}

/** Open a row's ⋯ menu and return the item test ids it offers. */
async function rowActions(canvas: ReturnType<typeof within>, username: string): Promise<string[]> {
  await userEvent.click(canvas.getByTestId(`row-actions-${username}`));
  const items = await screen.findAllByRole("menuitem");
  await waitFor(() => expect(items[0]).toBeVisible());

  const ids = items.map((i) => i.getAttribute("data-testid") ?? "");
  await userEvent.keyboard("{Escape}");
  await waitFor(() => expect(screen.queryAllByRole("menuitem")).toHaveLength(0));

  return ids;
}

// ── The states worth looking at ─────────────────────────────────────────────────────────────────

export const AsTheWarehouseOwner: Story = { beforeEach: asRole(Role.WAREHOUSE_OWNER) };

export const AsTheWarehouseAdmin: Story = { beforeEach: asRole(Role.WAREHOUSE_ADMIN) };

export const AsASellingOwner: Story = {
  beforeEach: () => {
    asTeam(12n)();
    asRole(Role.SELLING_OWNER)();
  },
};

export const AsRoot: Story = { beforeEach: asRole(Role.ROOT) };

// ── The rules worth failing on ──────────────────────────────────────────────────────────────────

// Each member's role in THIS team is on the row (the MEMBERSHIP slice).
export const EachRowSaysTheRole: Story = {
  beforeEach: asRole(Role.WAREHOUSE_OWNER),
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(canvas.getByTestId("role-budi")).toHaveTextContent("Warehouse Admin");
    await expect(canvas.getByTestId("role-eko")).toHaveTextContent("Warehouse Staff");
    await expect(canvas.getByTestId("role-ani")).toHaveTextContent("Warehouse Owner");
  },
};

// change-role-only-below-your-own — the Owner acts on the Admin and the Staff, never on another Owner
// and never on themselves.
export const AnOwnerActsOnlyBelowThemselves: Story = {
  beforeEach: asRole(Role.WAREHOUSE_OWNER),
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    const onAdmin = await rowActions(canvas, "budi");
    await expect(onAdmin).toContain("change-role-budi");
    await expect(onAdmin).toContain("remove-budi");

    const onStaff = await rowActions(canvas, "eko");
    await expect(onStaff).toContain("change-role-eko");
    await expect(onStaff).toContain("remove-eko");

    const onOwner = await rowActions(canvas, "dewi");
    await expect(onOwner).not.toContain("change-role-dewi");
    await expect(onOwner).not.toContain("remove-dewi");

    const onSelf = await rowActions(canvas, "ani");
    await expect(onSelf).not.toContain("change-role-ani");
    await expect(onSelf).not.toContain("remove-ani");
  },
};

// An Admin removes Staff but cannot change their role — a team has ONE role below Admin, so there is
// nothing to change it to. The Admin never touches the Owner or another Admin.
export const AnAdminRemovesStaffButChangesNoRole: Story = {
  beforeEach: asRole(Role.WAREHOUSE_ADMIN),
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    const onStaff = await rowActions(canvas, "eko");
    await expect(onStaff).toContain("remove-eko");
    await expect(onStaff).not.toContain("change-role-eko");

    const onAdmin = await rowActions(canvas, "budi");
    await expect(onAdmin).not.toContain("remove-budi");

    const onOwner = await rowActions(canvas, "dewi");
    await expect(onOwner).not.toContain("remove-dewi");
  },
};

// Change Role offers what is below the caller and not already held; the change lands in the row AND in
// the history (every-role-change-is-logged).
export const ChangeRoleIsLogged: Story = {
  beforeEach: asRole(Role.WAREHOUSE_OWNER),
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.click(canvas.getByTestId("row-actions-eko"));
    await userEvent.click(await screen.findByTestId("change-role-eko"));

    const dialog = await screen.findByTestId("change-role-dialog");
    await expect(within(dialog).getByTestId("change-role-current")).toHaveTextContent("Warehouse Staff");
    // Staff is what Eko holds and Owner is the caller's own rank — only Admin is left.
    await expect(within(dialog).getByRole("combobox")).toHaveValue("Warehouse Admin");

    await userEvent.click(within(dialog).getByTestId("submit-change-role"));

    await waitFor(() => expect(canvas.getByTestId("role-eko")).toHaveTextContent("Warehouse Admin"));

    const log = await history(canvas);
    await waitFor(() => expect(log).toHaveTextContent("ani changed eko from Warehouse Staff to Warehouse Admin"));
  },
};

// The history is its own tab beside the members (the-history-is-a-tab-beside-the-members): sentences,
// newest first — and a Root's change in a team they are not in is stamped.
export const TheHistoryReadsAsSentences: Story = {
  beforeEach: asRole(Role.WAREHOUSE_OWNER),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    // Not on the members tab — it is a tab of its own.
    await canvas.findByTestId("users-table");
    await expect(canvas.queryByTestId("member-log")).toBeNull();

    const log = await history(canvas);

    await waitFor(() => expect(log).toHaveTextContent("dewi changed budi from Warehouse Staff to Warehouse Admin"));
    await expect(log).toHaveTextContent("san added dewi as Warehouse Owner");
    await expect(log).toHaveTextContent("fajar removed user #69 (Warehouse Staff)");
    await expect(within(log).getByText("override")).toBeInTheDocument();
  },
};

// only-root-and-the-administrator-suspend — read by the person's ROOT-TEAM role: Root suspends the
// Administrator but never another Root; a suspended account may then be erased; nothing is deleted.
export const RootSuspendsAnyoneButARoot: Story = {
  beforeEach: asRole(Role.ROOT),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await allUsers(canvas);
    await expect(canvas.getByTestId("role-gita")).toHaveTextContent("System Administrator");

    const onRoot = await rowActions(canvas, "fajar");
    await expect(onRoot).not.toContain("suspend-fajar");

    const onAdministrator = await rowActions(canvas, "gita");
    await expect(onAdministrator).toContain("suspend-gita");
    await expect(onAdministrator).not.toContain("erase-gita");

    // erase-keeps-the-row — only an account already suspended.
    const onSuspended = await rowActions(canvas, "citra");
    await expect(onSuspended).toContain("erase-citra");

    // a-user-is-never-deleted
    await expect(onSuspended.some((id) => id.startsWith("delete-"))).toBe(false);
  },
};

// The Administrator suspends neither a Root nor another Administrator.
export const TheAdministratorSuspendsBelowThemselves: Story = {
  beforeEach: asRole(Role.ADMINISTRATOR),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await allUsers(canvas);

    await expect(await rowActions(canvas, "fajar")).not.toContain("suspend-fajar");
    await expect(await rowActions(canvas, "gita")).not.toContain("suspend-gita");
    await expect(await rowActions(canvas, "eko")).toContain("suspend-eko");
  },
};

// Erase blanks the person and keeps the row (erase-keeps-the-row): the username is freed.
export const EraseKeepsTheRow: Story = {
  beforeEach: asRole(Role.ROOT),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await allUsers(canvas);
    await userEvent.click(canvas.getByTestId("row-actions-citra"));
    await userEvent.click(await screen.findByTestId("erase-citra"));
    await userEvent.click(await screen.findByTestId("confirm-action"));

    await waitFor(() => expect(canvas.getByTestId("user-row-erased63")).toBeInTheDocument());
    await expect(canvas.queryByTestId("user-row-citra")).toBeNull();

    // A former user reads as one, and is marked Erased rather than Suspended.
    await expect(canvas.getByTestId("user-row-erased63")).toHaveTextContent("Former user #63");
    await expect(canvas.getByTestId("erased-erased63")).toBeInTheDocument();

    // an-erased-account-is-final: nothing on its menu brings it, or its data, back. Erase stays — erasing again
    // retries deleting the photos (erase-deletes-the-photo-file).
    const actions = await rowActions(canvas, "erased63");
    for (const gone of ["edit-erased63", "reset-password-erased63", "suspend-erased63"]) {
      await expect(actions).not.toContain(gone);
    }
    await expect(actions).toContain("erase-erased63");
  },
};

// the-username-is-editable — on someone else's account, not your own.
export const TheUsernameIsEditable: Story = {
  beforeEach: asRole(Role.ROOT),
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.click(canvas.getByTestId("row-actions-budi"));
    await userEvent.click(await screen.findByTestId("edit-budi"));
    const field = await screen.findByTestId("edit-username");
    await userEvent.clear(field);
    await userEvent.type(field, "budis", { delay: 40 });
    await userEvent.click(screen.getByTestId("submit-edit-user"));

    await waitFor(() => expect(canvas.getByTestId("user-row-budis")).toBeInTheDocument());

    await userEvent.click(canvas.getByTestId("row-actions-ani"));
    await userEvent.click(await screen.findByTestId("edit-ani"));
    await screen.findByTestId("edit-name");
    await expect(screen.queryByTestId("edit-username")).toBeNull();
  },
};
