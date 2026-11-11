import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { expectedBalance } from "../../../../.storybook/financialAccountFixtures";
import { ACCOUNT_DETAIL_META, AtUnknown, BCA_GAJI, BCA_OPS, UNKNOWN, firstRow, loaded, rp } from "./kit";

// ACCOUNT DETAIL — an unknown account — what it says, and Set Account: fill in or move in. The page's stories are grouped by the part of the screen they are about
// (stories-are-grouped-by-the-part-of-the-screen); what they share is ./kit.tsx.

const meta = {
  title: "Pages/FinancialAccount/Account/Unknown",
  ...ACCOUNT_DETAIL_META,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

/** Set account — in the menu, not a button (the-unknown-row-warns-and-sets-from-the-menu). */
async function openSetAccount(canvas: ReturnType<typeof within>) {
  await userEvent.click(canvas.getByTestId(`account-actions-${UNKNOWN.id}`));
  const item = await screen.findByTestId(`account-identify-${UNKNOWN.id}`);
  await waitFor(() => expect(item).toBeVisible());
  await expect(item).toHaveTextContent("Set Account");
  await userEvent.click(item);
}

// a-shop-with-no-account-gets-an-unknown-one: the page says how it came to be, offers Set account in its menu
// (the-unknown-row-warns-and-sets-from-the-menu) — and no reconcile, since there is no statement to read.
export const AnUnknownAccountExplainsItself: Story = {
  name: "Explains itself",
  render: () => <AtUnknown />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement, expectedBalance["1304"]!);

    await expect(canvas.getByTestId("account-unknown-explained")).toHaveTextContent("Melati TikTok");
    // Shown by its shop's name, no "Unknown —" (the-unknown-account-reads-lainnya).
    await expect(canvas.getByTestId("account-name-heading")).toHaveTextContent(/^Melati TikTok$/);
    await openSetAccount(canvas);
    await expect(canvas.queryByTestId(`account-reconcile-button-${UNKNOWN.id}`)).toBeNull();
    await expect(canvas.getByTestId("account-detail-checked")).toHaveTextContent("No statement to check");
  },
};

// an-unknown-account-is-filled-in-or-moved-in — FILL IN: the account becomes the real one, rows kept.
export const FillInTheUnknownAccount: Story = {
  name: "Fill in",
  render: () => <AtUnknown />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement, expectedBalance["1304"]!);

    await openSetAccount(canvas);
    const provider = await screen.findByTestId("identify-provider");
    await waitFor(() => expect(provider).toBeVisible());
    await userEvent.click(provider);
    const bca = await screen.findByTestId("identify-provider-option-2");
    await waitFor(() => expect(bca).toBeVisible());
    await userEvent.click(bca);
    await userEvent.type(screen.getByTestId("identify-number"), "7778889990", { delay: 20 });
    await userEvent.type(screen.getByTestId("identify-name"), "BCA TikTok", { delay: 20 });
    await userEvent.click(screen.getByTestId("identify-save"));

    await waitFor(() => expect(canvas.getByTestId("account-name-heading")).toHaveTextContent("BCA TikTok"));
    await expect(canvas.queryByTestId("account-unknown-explained")).toBeNull();
    // The two withdrawals are still its rows, each on its own day.
    await expect(within(canvas.getByTestId("account-log-table")).getAllByRole("row")).toHaveLength(1 + 2);
  },
};

// FILL IN a number that is already recorded is refused — and the refusal points at MOVE IN.
export const FillingInARecordedNumberIsRefused: Story = {
  name: "Number refused",
  render: () => <AtUnknown />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement, expectedBalance["1304"]!);

    await openSetAccount(canvas);
    const provider = await screen.findByTestId("identify-provider");
    await waitFor(() => expect(provider).toBeVisible());
    await userEvent.click(provider);
    const bca = await screen.findByTestId("identify-provider-option-2");
    await waitFor(() => expect(bca).toBeVisible());
    await userEvent.click(bca);
    await userEvent.type(screen.getByTestId("identify-number"), BCA_GAJI.accountNumber, { delay: 20 });
    await userEvent.type(screen.getByTestId("identify-name"), "BCA TikTok", { delay: 20 });
    await userEvent.click(screen.getByTestId("identify-save"));

    await expect(await screen.findByTestId("identify-error")).toHaveTextContent("move the money into it");
  },
};

// MOVE IN: the balance transfers into the real account, the shop re-points, the unknown is archived at zero.
export const MoveTheUnknownAccountIn: Story = {
  name: "Move in",
  render: () => <AtUnknown />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement, expectedBalance["1304"]!);

    await openSetAccount(canvas);
    const move = await screen.findByTestId("identify-move");
    await waitFor(() => expect(move).toBeVisible());
    // What each does on the pill, when to pick it under (set-account-reads-lengkapi-data-or-pindah-saldo).
    await expect(screen.getByTestId("identify-fill")).toHaveTextContent("Complete details");
    await expect(move).toHaveTextContent("Move balance");
    await userEvent.click(move);
    await expect(screen.getByTestId("identify-when")).toHaveTextContent("already in the list");
    await userEvent.click(screen.getByTestId("identify-into"));
    const into = await screen.findByTestId(`identify-into-option-${BCA_OPS.id}`);
    await waitFor(() => expect(into).toBeVisible());
    await userEvent.click(into);
    await expect(screen.getByTestId("identify-move-summary")).toHaveTextContent("Melati TikTok withdraws there");
    await userEvent.click(screen.getByTestId("identify-save"));

    await waitFor(() => expect(canvas.getByTestId("account-detail-balance")).toHaveTextContent(rp(0)));
    await expect(firstRow(canvas)).toHaveTextContent(`To ${BCA_OPS.name}`);
    await expect(canvas.getByText("Archived")).toBeVisible();
  },
};
