import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { asTeam } from "../../../../.storybook/pageStory";
import { asRole } from "../../../../.storybook/sessionScenario";
import { Role } from "../../../gen/warehouse/role_base/v1/role_pb";
import { ACCOUNTS_META, BCA_GAJI, BCA_OPS, SHOPEEPAY, loaded, openMenu, rp } from "./kit";

// ACCOUNTS — the row's buttons and ⋯ — transfer, archive, operational, and who may move money. The page's stories are grouped by the part of the screen they are about
// (stories-are-grouped-by-the-part-of-the-screen); what they share is ./kit.tsx.

const meta = {
  title: "Pages/FinancialAccount/Accounts/Actions",
  ...ACCOUNTS_META,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

// the-warehouse-admin-equals-the-owner-except-money: the warehouse Admin keeps and reconciles the accounts, and moves
// no money between them — no Transfer, no Capital. Reconcile stays the row's button
// (`transfer-and-reconcile-sit-on-the-row`); the menu never repeats it, so it is looked for on the row.
export const TheWarehouseAdminNeitherTransfersNorAddsCapital: Story = {
  name: "Warehouse admin",
  beforeEach: () => {
    asTeam(11n)();
    asRole(Role.WAREHOUSE_ADMIN)();
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByTestId("account-reconcile-button-1307", {}, { timeout: 4000 })).toBeVisible();
    await expect(canvas.queryByTestId("account-transfer-button-1307")).toBeNull();

    await userEvent.click(canvas.getByTestId("account-actions-1307"));
    await waitFor(() => expect(screen.getByTestId("account-edit-1307")).toBeVisible());
    await expect(screen.queryByTestId("account-transfer-1307")).toBeNull();
    await expect(screen.queryByTestId("account-capital-1307")).toBeNull();
  },
};

// an-account-is-archived-only-at-zero: BCA Gaji holds 600.000, so Archive is offered disabled and says why.
// Transfer the 600.000 out, and Archive opens — then confirms, and the row leaves the live list.
export const ArchiveOnlyAtZero: Story = {
  name: "Archive at zero",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await openMenu(canvas, BCA_GAJI.id);
    const archive = screen.getByTestId(`account-archive-${BCA_GAJI.id}`);
    await expect(archive).toHaveAttribute("data-disabled");
    await expect(archive).toHaveTextContent("only at zero");
    await userEvent.keyboard("{Escape}");

    await userEvent.click(canvas.getByTestId(`account-transfer-button-${BCA_GAJI.id}`));
    const to = await screen.findByTestId("transfer-to");
    await waitFor(() => expect(to).toBeVisible());
    await userEvent.click(to);
    const target = await screen.findByTestId(`transfer-to-option-${BCA_OPS.id}`);
    await waitFor(() => expect(target).toBeVisible());
    await userEvent.click(target);
    await userEvent.type(screen.getByTestId("transfer-amount"), "600000", { delay: 20 });
    await userEvent.click(screen.getByTestId("transfer-save"));

    await waitFor(() => expect(canvas.getByTestId(`account-balance-${BCA_GAJI.id}`)).toHaveTextContent(rp(0)));

    await openMenu(canvas, BCA_GAJI.id);
    const enabled = screen.getByTestId(`account-archive-${BCA_GAJI.id}`);
    await waitFor(() => expect(enabled).not.toHaveAttribute("data-disabled"));
    await userEvent.click(enabled);

    const confirm = await screen.findByTestId("confirm-action");
    await waitFor(() => expect(confirm).toBeVisible());
    await userEvent.click(confirm);

    await waitFor(() => expect(canvas.queryByTestId(`account-row-${BCA_GAJI.id}`)).toBeNull());
  },
};

// Two legs, one act: both balances move, and the team's total does not — it is the team's own money.
export const ATransferMovesBothBalancesNotTheTotal: Story = {
  name: "Transfer",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.click(canvas.getByTestId(`account-transfer-button-${BCA_OPS.id}`));

    const to = await screen.findByTestId("transfer-to");
    await waitFor(() => expect(to).toBeVisible());
    await userEvent.click(to);
    const target = await screen.findByTestId(`transfer-to-option-${SHOPEEPAY.id}`);
    await waitFor(() => expect(target).toBeVisible());
    await userEvent.click(target);
    await userEvent.type(screen.getByTestId("transfer-amount"), "500000", { delay: 20 });
    await expect(screen.getByTestId("transfer-after")).toHaveTextContent(rp(10_943_500));
    await userEvent.click(screen.getByTestId("transfer-save"));

    await waitFor(() => expect(canvas.getByTestId(`account-balance-${SHOPEEPAY.id}`)).toHaveTextContent(rp(350_000)));
    await expect(canvas.getByTestId(`account-balance-${BCA_OPS.id}`)).toHaveTextContent(rp(10_943_500));
    await expect(canvas.getByTestId("account-total-team-value")).toHaveTextContent(rp(16_443_500));
    // ShopeePay is above zero now, so the warning goes with it.
    await waitFor(() => expect(canvas.queryByTestId("below-zero-warning")).toBeNull());
  },
};

// The dialog warns BEFORE a transfer takes an account below zero — and still lets it through.
export const ATransferBelowZeroIsWarnedNotBlocked: Story = {
  name: "Transfer below zero",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.click(canvas.getByTestId(`account-transfer-button-${BCA_GAJI.id}`));
    const to = await screen.findByTestId("transfer-to");
    await waitFor(() => expect(to).toBeVisible());
    await userEvent.click(to);
    const target = await screen.findByTestId(`transfer-to-option-${BCA_OPS.id}`);
    await waitFor(() => expect(target).toBeVisible());
    await userEvent.click(target);
    await userEvent.type(screen.getByTestId("transfer-amount"), "1000000", { delay: 20 });

    await expect(screen.getByTestId("transfer-below-zero")).toBeVisible();
    await expect(screen.getByTestId("transfer-save")).not.toBeDisabled();
    await userEvent.click(screen.getByTestId("transfer-save"));

    await waitFor(() => expect(canvas.getByTestId(`account-balance-${BCA_GAJI.id}-below-zero`)).toBeVisible());
  },
};

/**
 * TRANSFER AND RECONCILE SIT ON THE ROW (owner, `transfer-and-reconcile-sit-on-the-row`) — the menu holds the
 * rest, never a second copy of either.
 */
export const TransferAndReconcileSitOnTheRow: Story = {
  name: "On the row",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(canvas.getByTestId(`account-transfer-button-${BCA_OPS.id}`)).toBeVisible();
    await expect(canvas.getByTestId(`account-reconcile-button-${BCA_OPS.id}`)).toBeVisible();

    await openMenu(canvas, BCA_OPS.id);
    await expect(screen.getByTestId(`account-capital-${BCA_OPS.id}`)).toBeVisible();
    await expect(screen.queryByTestId(`account-transfer-${BCA_OPS.id}`)).toBeNull();
    await expect(screen.queryByTestId(`account-reconcile-${BCA_OPS.id}`)).toBeNull();
  },
};

// operational-accounts-pay-for-operations: marking an account adds it to a restock's Paid from — and it asks
// first (owner, `operational-asks-before-it-changes`), saying what the mark does.
export const MarkAnAccountOperational: Story = {
  name: "Mark operational",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(canvas.queryByTestId(`account-operational-${BCA_GAJI.id}`)).toBeNull();
    await openMenu(canvas, BCA_GAJI.id);
    await userEvent.click(screen.getByTestId(`account-mark-operational-${BCA_GAJI.id}`));

    // Nothing changes until it is confirmed.
    const confirm = await screen.findByTestId("confirm-action");
    await waitFor(() => expect(confirm).toBeVisible());
    await expect(canvas.queryByTestId(`account-operational-${BCA_GAJI.id}`)).toBeNull();
    await expect(screen.getByText(/can then be picked to pay restocks and expenses/)).toBeVisible();
    await userEvent.click(confirm);

    await canvas.findByTestId(`account-operational-${BCA_GAJI.id}`);
  },
};

// seeing-is-team-wide-moving-is-admin-and-up: a CS sees every account and balance — and no button.
export const AMemberSeesButDoesNotMove: Story = {
  name: "Member reads only",
  beforeEach: asRole(Role.SELLING_CS),
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(canvas.getByTestId("account-total-team-value")).toHaveTextContent(rp(16_443_500));
    await expect(canvas.queryByTestId("open-create-account")).toBeNull();
    await expect(canvas.queryByTestId(`account-actions-${BCA_OPS.id}`)).toBeNull();
  },
};
