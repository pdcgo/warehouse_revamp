import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor } from "storybook/test";

import { expectedBalance } from "../../../.storybook/financialAccountFixtures";
import { ACCOUNT_DETAIL_META, BCA_OPS, loaded } from "./stories/kit";

// ACCOUNT DETAIL — the screen as it is, on a desktop and on a phone: Default and Mobile sit FIRST, straight under
// Account (owner: *"default dan mobile taruh di depan saja"*). The same title also holds the folders below, so
// Storybook draws Account as a folder with these two stories leading it. Its rules are grouped by the part of the
// screen they are about, one file each in ./stories (stories-are-grouped-by-the-part-of-the-screen):
//
//   States     below zero, an unknown account, a warehouse's cash box
//   Cards      the balance, last checked and the linked shops — the screen rules, a date's language, pointing a shop here
//   Filters    the statement's types and window — several types, the URL, and a phone's sheet
//   Statement  the statement's rows — the balance explained, a row lighting up, which way in, a phone's row
//   Actions    Match Balance and Capital — a difference, an agreement, a cash box, and who may move money
//   Unknown    an unknown account — what it says, and Set Account: fill in or move in

const meta = {
  title: "Pages/FinancialAccount/Account",
  ...ACCOUNT_DETAIL_META,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

// ── Mobile ──────────────────────────────────────────────────────────────────────────────────────
//
// The `viewport` global sizes the story's canvas in the test run too, so these play against the phone layout.

// MOBILE (owner, `the-account-page-follows-the-screen-rules`) — the header is the name and its ⋯, every action inside
// the menu (`the-phone-header-is-one-row`); the two cards two to a row; the statement's filters behind one button;
// the statement three columns under their headings, the change right under the balance, and a tap opening the rest
// (`a-phone-statement-row-opens-its-detail`).
export const Mobile: Story = {
  name: "Mobile",
  globals: { viewport: { value: "mobile2" } },
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement, expectedBalance["1301"]!);

    // No action buttons on a phone — the ⋯ on the name's row holds them, Transfer and Cocokkan Saldo included.
    await expect(canvas.queryByTestId(`account-reconcile-button-${BCA_OPS.id}`)).toBeNull();
    const heading = canvas.getByTestId("account-name-heading").getBoundingClientRect();
    const menu = canvas.getByTestId(`account-actions-${BCA_OPS.id}`).getBoundingClientRect();
    await expect(menu.top).toBeLessThan(heading.bottom);
    await userEvent.click(canvas.getByTestId(`account-actions-${BCA_OPS.id}`));
    await waitFor(() => expect(screen.getByTestId(`account-reconcile-${BCA_OPS.id}`)).toBeVisible());
    await expect(screen.getByTestId(`account-transfer-${BCA_OPS.id}`)).toBeVisible();
    await userEvent.keyboard("{Escape}");

    // Toko terhubung takes the whole row under the two cards.
    const balanceCard = canvas.getByTestId("account-detail-balance-card").getBoundingClientRect();
    const shops = canvas.getByTestId("account-shops").getBoundingClientRect();
    await expect(shops.top).toBeGreaterThan(balanceCard.bottom);
    await expect(shops.width).toBeGreaterThan(balanceCard.width * 1.8);

    await expect(canvas.getByTestId("account-log-filters-open")).toBeVisible();
    await expect(canvas.getByTestId("account-log-pager")).toBeVisible();
  },
};
