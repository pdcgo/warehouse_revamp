import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, waitFor, within } from "storybook/test";

import { REPORT_META, loaded } from "./stories/kit";

// ACCOUNT REPORT — the screen as it is, on a desktop and on a phone: Default and Mobile sit FIRST, straight under
// Report (owner: *"default dan mobile taruh di depan saja"*). The same title also holds the folders below, so
// Storybook draws Report as a folder with these two stories leading it. Its rules are grouped by the part of the
// screen they are about, one file each in ./stories (stories-are-grouped-by-the-part-of-the-screen):
//
//   Header     the title's row — the screen rules, Export (and none while monitoring), and the Periode / Rincian switch
//   Filters    the account, the window and the grain — the search, Clear, the URL, and a phone's sheet
//   Cards      the five cards — what each says, the net change's breakdown, and what moved it
//   Movers     a ranking card's Details › — by account, by provider, and an account's row opening it
//   Periods    the Periode table — every type, newest first, sorted from its heading, a type a line on a phone
//   Breakdown  the Rincian view — where the money is, what changed the balance, one account, on a phone

const meta = {
  title: "Pages/FinancialAccount/Report",
  ...REPORT_META,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

// ── Mobile ─────────────────────────────────────────────────────────────────────────────────────────────────────
//
// The `viewport` global sizes the story's canvas in the test run too (the orders list's phone story asserts on it), so
// these play against the phone layout, not the desktop one shrunk.

// MOBILE (`a-phone-filters-from-a-sheet`, `a-phone-reads-each-line-as-a-block`) — the filters behind one button, the
// five cards two to a row, and every period a block of its own: the date and the close, then the types that moved and
// the net change — never a table to scroll sideways.
export const Mobile: Story = {
  name: "Mobile",
  globals: { viewport: { value: "mobile2" } },
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(canvas.getByTestId("account-report-filters-open")).toBeVisible();
    await expect(canvas.queryByTestId("account-report-account")).toBeNull();
    await waitFor(() => expect(canvas.getByTestId("account-report-by-provider")).toBeVisible());

    const series = canvas.getByTestId("account-report-series");
    await expect(within(series).queryAllByRole("columnheader")).toHaveLength(0);
    const blocks = within(series).getAllByTestId(/^account-report-series-row-/);
    await expect(blocks).toHaveLength(20);
    await expect(canvas.getByTestId("account-report-pager")).toBeVisible();

    // The change sits right under the close, on its right edge — however many type badges wrapped beside them (owner:
    // *"yang perubahan taruh di bawah saldo pas, tidak center dari tiap tipenya"*).
    for (const block of blocks) {
      const at = block.getAttribute("data-testid")!.replace("account-report-series-row-", "");
      const close = within(block).getByTestId(`account-report-series-close-${at}`).getBoundingClientRect();
      const change = within(block).getByTestId(`account-report-series-change-${at}`).getBoundingClientRect();
      await expect(change.top - close.bottom).toBeLessThan(12);
      await expect(change.top).toBeGreaterThanOrEqual(close.bottom - 1);
      await expect(Math.abs(change.right - close.right)).toBeLessThan(2);
    }
  },
};
