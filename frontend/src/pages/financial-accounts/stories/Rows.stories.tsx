import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { account } from "../../../../.storybook/financialAccountFixtures";
import { FinancialAccountType } from "../../../gen/warehouse/financial_account/v1/financial_account_pb";
import { ACCOUNTS_META, BCA_GAJI, BCA_OPS, SHOPEEPAY, UNKNOWN, loaded, openMenu, rowIds } from "./kit";

// ACCOUNTS — what a row shows — below zero, the unknown account, provider, linked shops, last checked, the sort, the pager. The page's stories are grouped by the part of the screen they are about
// (stories-are-grouped-by-the-part-of-the-screen); what they share is ./kit.tsx.

const meta = {
  title: "Pages/FinancialAccount/Accounts/Rows",
  ...ACCOUNTS_META,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

// below-zero-is-warned-never-refused: the row and the totals say it — in red on the card's line, where the
// banner used to repeat it (the-accounts-page-has-no-banners).
export const BelowZeroIsWarnedNeverRefused: Story = {
  name: "Below zero",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(canvas.getByTestId(`account-balance-${SHOPEEPAY.id}-below-zero`)).toBeVisible();
    await expect(canvas.getByTestId(`account-balance-${BCA_OPS.id}`)).not.toHaveAttribute("data-below-zero");
    // Under the figure, what the banner used to say: allowed, and check it against the bank.
    await expect(canvas.getByTestId(`account-balance-${SHOPEEPAY.id}-below-zero`)).toHaveTextContent(
      "Below zero · check it against the bank",
    );
    // Right-aligned under the right-aligned heading.
    const figure = canvas.getByTestId(`account-balance-${BCA_OPS.id}`);
    const cell = figure.closest("td")!;
    await expect(cell.getBoundingClientRect().right - figure.getBoundingClientRect().right).toBeLessThan(16);
    const count = canvas.getByTestId(`account-total-${FinancialAccountType.WALLET}-below-zero`);
    await expect(count).toHaveTextContent("1 below zero");
    await expect(getComputedStyle(count).color).not.toBe(getComputedStyle(count.parentElement!).color);
    await expect(canvas.queryByTestId("below-zero-warning")).toBeNull();
  },
};

// a-shop-with-no-account-gets-an-unknown-one, read as LAINNYA (owner, `the-unknown-account-reads-lainnya`): shown
// by its shop's name — no "Unknown —", no badge — its provider badge and card saying *Other*, and a warning
// where the holder would be. On the row, Transfer out; in the menu, Set account and Archive
// (`the-unknown-row-warns-and-sets-from-the-menu`) — no reconcile, never operational.
export const AnUnknownAccountIsWarned: Story = {
  name: "Unknown account",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const row = canvas.getByTestId(`account-row-${UNKNOWN.id}`);

    // The server names it by the shop's id; the row shows only the shop's name.
    await expect(row).toHaveTextContent("Melati TikTok");
    await expect(row).not.toHaveTextContent("Unknown");
    await expect(row).not.toHaveTextContent("Bank not named");
    await expect(row).toHaveTextContent("Other");
    await expect(canvas.getByTestId(`account-total-${FinancialAccountType.UNKNOWN}`)).toHaveTextContent("Other");
    await expect(canvas.getByTestId(`account-shop-${UNKNOWN.id}-25`)).toHaveTextContent("Melati TikTok");

    await expect(canvas.getByTestId(`account-not-set-${UNKNOWN.id}`)).toHaveTextContent("No account set yet");
    await expect(canvas.queryByTestId(`account-not-set-${BCA_OPS.id}`)).toBeNull();
    await expect(canvas.queryByTestId(`account-identify-button-${UNKNOWN.id}`)).toBeNull();
    await expect(canvas.getByTestId(`account-transfer-button-${UNKNOWN.id}`)).toHaveTextContent("Transfer Out");
    await expect(canvas.queryByTestId(`account-reconcile-button-${UNKNOWN.id}`)).toBeNull();

    await openMenu(canvas, UNKNOWN.id);
    await expect(screen.getByTestId(`account-archive-${UNKNOWN.id}`)).toBeVisible();
    await expect(screen.getByTestId(`account-identify-${UNKNOWN.id}`)).toHaveTextContent("Set Account");
    await expect(screen.queryByTestId(`account-mark-operational-${UNKNOWN.id}`)).toBeNull();
  },
};

/**
 * THE SORT IS IN THE HEADINGS (owner, `the-accounts-table-sorts-from-its-headings`) — Akun and Penyedia, A to
 * Z first, then flipped; the server orders the whole set.
 */
export const SortsFromItsHeadings: Story = {
  name: "Sort from headings",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const byName = canvas.getByTestId("account-sort-name");

    await userEvent.click(byName);
    await expect(byName).toHaveAttribute("data-sort", "asc");
    await waitFor(() => expect(rowIds(canvas)[0]).toBe(BCA_GAJI.id.toString()));

    await userEvent.click(byName);
    await expect(byName).toHaveAttribute("data-sort", "desc");
    await waitFor(() => expect(rowIds(canvas)[0]).toBe(UNKNOWN.id.toString()));

    await expect(canvas.getByRole("columnheader", { name: "Balance" }).querySelector("button")).toBeNull();

    // Penyedia — the provider's stored word, A to Z: bca first; flipped, "unknown" first — Mandiri Usaha (provider
    // Lainnya) before the Melati TikTok account, the name breaking the tie A to Z as the server does.
    const byProvider = canvas.getByTestId("account-sort-provider");
    await userEvent.click(byProvider);
    await waitFor(() => expect(rowIds(canvas)[0]).toBe(BCA_GAJI.id.toString()));
    await userEvent.click(byProvider);
    await waitFor(() => expect(rowIds(canvas)[0]).toBe(account("Mandiri Usaha").id.toString()));
  },
};

/**
 * THE PROVIDER CELL CARRIES THE NUMBER, AND THE BALANCE IS BOLD (owner, `the-provider-cell-carries-the-number`,
 * `a-balance-is-bold`) — one column for where the money is, the figure the row is read for in bold.
 */
export const TheProviderCellCarriesTheNumber: Story = {
  name: "Provider and number",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(canvas.queryByRole("columnheader", { name: "Number" })).toBeNull();
    const number = canvas.getByTestId(`account-number-${BCA_OPS.id}`);
    await expect(number).toHaveTextContent("1234567890");
    await expect(number.closest("td")).toHaveTextContent("BCA");
    // A cash box has no number — the cell is the badge alone.
    await expect(canvas.queryByTestId(`account-number-${account("Kas Melati").id}`)).toBeNull();

    const figure = canvas.getByTestId(`account-balance-${BCA_OPS.id}`).querySelector("p")!;
    await expect(getComputedStyle(figure).fontWeight).toBe("700");
  },
};

// Every account says when it was last checked — "never" is a state, not a blank.
export const LastCheckedIsAlwaysSaid: Story = {
  name: "Last checked",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(canvas.getByTestId(`account-checked-${BCA_GAJI.id}`)).toHaveTextContent("Never checked");
    await expect(canvas.getByTestId(`account-checked-${BCA_OPS.id}`)).toHaveTextContent("yesterday");
  },
};

/**
 * TERHUBUNG KE — THREE, THEN "+N" (owner, `the-linked-column-shows-three-then-more`). BCA Operasional is
 * operational and three shops withdraw into it: three badges, a +1, and the dialog lists all four.
 */
export const TheLinkedColumnShowsThreeThenMore: Story = {
  name: "Linked, three then +N",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(canvas.getByRole("columnheader", { name: "Linked to" })).toBeVisible();
    await expect(canvas.getByTestId(`account-operational-${BCA_OPS.id}`)).toBeVisible();
    await expect(canvas.getByTestId(`account-shop-${BCA_OPS.id}-22`)).toBeVisible();
    await expect(canvas.queryByTestId(`account-shop-${BCA_OPS.id}-23`)).toBeNull();

    const more = canvas.getByTestId(`account-links-more-${BCA_OPS.id}`);
    await expect(more).toHaveTextContent("+1");
    await userEvent.click(more);

    const dialog = await screen.findByTestId(`account-links-dialog-${BCA_OPS.id}`);
    await waitFor(() => expect(dialog).toBeVisible());
    await expect(within(dialog).getByTestId("account-links-shop-23")).toHaveTextContent("Melati Grosir");
    await expect(dialog).toHaveTextContent("Operational");
    // The row did not open the account's page underneath.
    await expect(canvas.queryByTestId("at-account-detail")).toBeNull();
  },
};

/**
 * THE PAGER GROWS WITH THE PAGES OPENED (owner, `the-accounts-pager-grows-with-the-pages-opened`) — five accounts
 * are one page: ‹ [1] ›, both arrows off, still on screen.
 */
export const ThePagerGrowsWithThePagesOpened: Story = {
  name: "Pager",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(canvas.getByTestId("account-pager-page-1")).toBeVisible();
    await expect(canvas.queryByTestId("account-pager-page-2")).toBeNull();
    await expect(canvas.getByTestId("account-pager-prev")).toBeDisabled();
    await expect(canvas.getByTestId("account-pager-next")).toBeDisabled();
  },
};

// A detail view is a page: the row opens the account.
export const ARowOpensTheAccount: Story = {
  name: "Row opens the account",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.click(canvas.getByText(BCA_OPS.name));
    await canvas.findByTestId("at-account-detail");
  },
};
