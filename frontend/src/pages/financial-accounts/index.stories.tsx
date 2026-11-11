import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";

import { ACCOUNTS_META, BCA_OPS, SHOPEEPAY, loaded } from "./stories/kit";

// ACCOUNTS — the screen as it is, on a desktop and on a phone: Default and Mobile sit FIRST, straight under
// Accounts (owner: *"default dan mobile taruh di depan saja"*). The same title also holds the folders below, so
// Storybook draws Accounts as a folder with these two stories leading it. Its rules are grouped by the part of the
// screen they are about, one file each in ./stories (stories-are-grouped-by-the-part-of-the-screen):
//
//   States   the screen as a warehouse sees it
//   Header   the title and subtitle, the totals under them, and the Archive view the header's button opens
//   Filters  the type tabs, the search, the shop and the options panel — the URL, and a phone's sheet
//   Rows     what a row shows — below zero, the unknown account, provider, linked shops, last checked, the sort, the pager
//   Actions  the row's buttons and ⋯ — transfer, archive, operational, and who may move money
//   Create   the New Account form — the opening balance, the type deciding the provider, a number refused

const meta = {
  title: "Pages/FinancialAccount/Accounts",
  ...ACCOUNTS_META,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

// ── Mobile ─────────────────────────────────────────────────────────────────────────────────────────────────────
//
// The `viewport` global sizes the story's canvas in the test run too (the orders list's phone story asserts on it), so
// these play against the phone layout.

// MOBILE (`a-phone-filters-from-a-sheet`, `a-phone-reads-each-line-as-a-block`) — the search stays in the row and
// everything else is behind the Filter button; every account is a block, its balance and its ⋯ on screen.
//
// Two bugs pinned here (owner: *"deskripsi di mobile bug, actionnya masih bug juga"*, *"di mobile header masih ada"*):
//   the header — the title block took no room, the subtitle shrank to one word a line and Laporan sat on the title;
//   the table — 929px in a 318px screen under its headings, the balance and every action off to the right.
export const Mobile: Story = {
  name: "Mobile",
  globals: { viewport: { value: "mobile2" } },
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    // The subtitle reads as a sentence, and the three actions are one ⋯ on the title's row — not labelled buttons on a
    // row of their own (a-phone-header-action-is-an-icon).
    const heading = canvas.getByTestId("financial-accounts-heading").getBoundingClientRect();
    const subtitle = canvas.getByTestId("financial-accounts-subtitle").getBoundingClientRect();
    const actions = canvas.getByTestId("financial-accounts-actions").getBoundingClientRect();
    await expect(subtitle.width).toBeGreaterThan(250);
    await expect(canvas.queryByRole("button", { name: "Report" })).toBeNull();
    await expect(actions.top).toBeLessThan(heading.bottom);
    await expect(actions.right).toBeLessThanOrEqual(window.innerWidth);

    await expect(canvas.getByTestId("account-search")).toBeVisible();
    await expect(canvas.getByTestId("account-filters-open")).toBeVisible();
    await expect(canvas.queryByTestId("account-shop-filter")).toBeNull();
    await expect(canvas.getByTestId("account-type-tabs")).toBeVisible();

    // A block per account: no headings, the balance and the menu inside the screen.
    const list = canvas.getByTestId("financial-accounts-table");
    await expect(within(list).queryAllByRole("columnheader")).toHaveLength(0);
    const balance = canvas.getByTestId(`account-balance-${BCA_OPS.id}`).getBoundingClientRect();
    await expect(balance.right).toBeLessThanOrEqual(window.innerWidth);
    const menu = canvas.getByTestId(`account-actions-${BCA_OPS.id}`).getBoundingClientRect();
    await expect(menu.right).toBeLessThanOrEqual(window.innerWidth);
    await expect(canvas.getByTestId("account-pager")).toBeVisible();

    // Below zero says the fact alone on a phone — no "check it against the bank" (owner: *"tidak perlu cocokkan dengan
    // bank jika mobile"*).
    const shopeepay = canvas.getByTestId(`account-row-${SHOPEEPAY.id}`);
    await expect(shopeepay).toHaveTextContent("Below zero");
    await expect(shopeepay).not.toHaveTextContent("check it against the bank");
  },
};
