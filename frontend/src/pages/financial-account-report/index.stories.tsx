import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { account } from "../../../.storybook/financialAccountFixtures";
import { asTeam, marker, routedPage } from "../../../.storybook/pageStory";
import {
  FinancialAccountChangeType as T,
  FinancialAccountProvider as P,
} from "../../gen/warehouse/financial_account/v1/financial_account_pb";
import { formatRupiahNumber } from "../../lib/money";
import { FinancialAccountReportPage } from "./index";

// The account report — five cards and one table of periods (owner, `the-report-is-five-cards-and-one-table`), the
// owner's six metrics (context.md lines 126–131) delivered the settlement way (analytics-are-delivered-the-settlement-way).
//
// Toko Melati over the last 30 days (today and the 29 before), from .storybook/financialAccountFixtures.ts:
//   opened at 11.300.000 · withdrawals +11.000.000 · expenses −3.600.000 · team payment −1.500.000 ·
//   capital +1.000.000 · ads −900.000 · restocks −850.000 · the bank fee −6.500 · transfers net 0
//   → +5.143.500 → closed at 16.443.500 — exactly what the accounts page's total says.

const BCA_OPS = account("BCA Operasional");
const BNI = account("BNI Lama");
const MELATI_TIKTOK = account("Unknown — shop #25");

const signed = (n: number) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${formatRupiahNumber(Math.abs(n))}`.replace(/\s/g, " ");
const rp = (n: number) => formatRupiahNumber(n).replace(/\s/g, " ");

const Routed = routedPage(
  [{ path: "/financial-accounts/report", element: <FinancialAccountReportPage /> }, marker("/financial-accounts/:accountId", "at-account-detail")],
  "/financial-accounts/report",
);

const meta = {
  title: "Pages/FinancialAccount/Report",
  component: Routed,
  parameters: { signedIn: true, dataRouter: true },
  beforeEach: asTeam(12n),
} satisfies Meta<typeof Routed>;

export default meta;
type Story = StoryObj<typeof meta>;

async function loaded(canvasElement: HTMLElement) {
  const canvas = within(canvasElement);
  await waitFor(() => expect(canvas.getByTestId("account-report-close-value")).toHaveTextContent(rp(16_443_500)), {
    timeout: 4000,
  });

  return canvas;
}

async function pickAccount(canvas: ReturnType<typeof within>, id: bigint) {
  await userEvent.click(canvas.getByTestId("account-report-account"));
  const option = await canvas.findByTestId(`account-report-account-option-${id}`);
  await waitFor(() => expect(option).toBeVisible());
  await userEvent.click(option);
}

export const Default: Story = {};

// ── Mobile ─────────────────────────────────────────────────────────────────────────────────────────────────────
//
// The `viewport` global sizes the story's canvas in the test run too (the orders list's phone story asserts on it), so
// these play against the phone layout, not the desktop one shrunk.

// MOBILE (`a-phone-filters-from-a-sheet`, `a-phone-reads-each-line-as-a-block`) — the filters behind one button, the
// five cards two to a row, and every period a block of its own: the date and the close, then the types that moved and
// the net change — never a table to scroll sideways.
export const Mobile: Story = {
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

// Mobile: the account, the window and the grain open from the Filter button, full width, in a bottom sheet.
export const MobileFiltersAreASheet: Story = {
  globals: { viewport: { value: "mobile2" } },
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.click(canvas.getByTestId("account-report-filters-open"));
    const sheet = await screen.findByTestId("account-report-filters-sheet");
    await waitFor(() => expect(sheet).toBeVisible());
    await expect(within(sheet).getByTestId("account-report-account")).toBeVisible();
    await expect(within(sheet).getByTestId("account-report-range")).toBeVisible();
    await expect(within(sheet).getByTestId("account-report-grain")).toBeVisible();

    await userEvent.click(within(sheet).getByTestId("account-report-filters-done"));
    await waitFor(() => expect(screen.queryByTestId("account-report-filters-sheet")).toBeNull());
  },
};

// Mobile: a card's "Details ›" still opens its breakdown — by account here, every account and the Total — as a list,
// the net change right under the closing balance (owner: *"perubahan bersih taruh saja di bawah saldo akhir"*).
export const MobileBreakdownOpens: Story = {
  globals: { viewport: { value: "mobile2" } },
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await waitFor(() => expect(canvas.getByTestId("account-report-by-account-detail")).toBeVisible());
    await userEvent.click(canvas.getByTestId("account-report-by-account-detail"));
    const dialog = await screen.findByTestId("movers-account");
    await waitFor(() => expect(dialog).toBeVisible());
    const rows = within(dialog).getAllByTestId(/^movers-row-/);
    await expect(rows).toHaveLength(7);
    await expect(within(dialog).queryAllByRole("columnheader")).toHaveLength(0);
    for (const row of rows) {
      const id = row.getAttribute("data-testid")!.replace("movers-row-", "");
      const close = within(row).getByTestId(`movers-close-${id}`).getBoundingClientRect();
      const change = within(row).getByTestId(`movers-change-${id}`).getBoundingClientRect();
      await expect(change.top).toBeGreaterThanOrEqual(close.bottom - 1);
      await expect(change.top - close.bottom).toBeLessThan(12);
      await expect(Math.abs(change.right - close.right)).toBeLessThan(2);
    }
    await expect(within(dialog).getByTestId("movers-total-account")).toHaveTextContent(rp(16_443_500));
  },
};

// The window in its numbers: opening + net change = closing — and the close is the accounts page's total, because
// the daily row is written with the log row (the-daily-row-is-written-with-the-log-row).
export const TheWindowAddsUp: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(canvas.getByTestId("account-report-open-value")).toHaveTextContent(rp(11_300_000));
    await expect(canvas.getByTestId("account-report-change-value")).toHaveTextContent(signed(5_143_500));
    await expect(canvas.getByTestId("account-report-close")).toHaveAttribute("data-emphasis");
  },
};

// Each card says what its figure is (owner): the opening's day, the move against it, the close as their sum.
export const EachCardSaysWhatItIs: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(canvas.getByTestId("account-report-open")).toHaveTextContent("At the start of");
    await expect(canvas.getByTestId("account-report-change")).toHaveTextContent("+45.5% of the opening balance");
    await expect(canvas.getByTestId("account-report-close")).toHaveTextContent("At the end of");
    await expect(canvas.getByTestId("account-report-close-note")).toHaveTextContent("Opening balance + net change");
  },
};

// What the net change is made of (owner: *"perubahan bersih, kasih modal detail, penarikan modal restock dsb itu"*) —
// "Details ›" on the card: in first, largest first, then out, summing to the net change. A transfer between the team's
// own accounts nets to nothing, so it is not a line of the team's breakdown.
export const TheNetChangeOpensItsBreakdown: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.click(canvas.getByTestId("account-report-change-detail"));
    const dialog = await screen.findByTestId("change-detail");
    await waitFor(() => expect(dialog).toBeVisible());

    const rows = within(dialog).getAllByTestId(/^change-detail-\d+$/);
    await expect(rows[0]).toHaveTextContent("Withdrawal");
    await expect(rows[0]).toHaveTextContent(signed(11_000_000));
    await expect(within(dialog).getByTestId(`change-detail-${T.RESTOCK}`)).toHaveTextContent(signed(-850_000));
    await expect(within(dialog).queryByTestId(`change-detail-${T.TRANSFER}`)).toBeNull();
    await expect(within(dialog).getByTestId("change-detail-total")).toHaveTextContent(signed(5_143_500));
    await expect(within(dialog).getByTestId("change-detail-bridge")).toHaveTextContent(rp(11_300_000));
    await expect(within(dialog).getByTestId("change-detail-bridge")).toHaveTextContent(rp(16_443_500));
  },
};

// The account filter SEARCHES — typing "BCA" leaves the two BCA accounts. It looked like a search and searched nothing:
// Ark's list collection filters only when given a matcher.
export const TheAccountFilterSearches: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.click(canvas.getByTestId("account-report-account"));
    await userEvent.type(canvas.getByTestId("account-report-account"), "BCA", { delay: 40 });
    await waitFor(() => expect(canvas.queryByTestId(`account-report-account-option-${MELATI_TIKTOK.id}`)).toBeNull());
    await expect(canvas.getByTestId(`account-report-account-option-${BCA_OPS.id}`)).toBeVisible();
  },
};

// One account: its own open and close, and its transfers show in the breakdown — they left IT, even if not the team.
export const OneAccount: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await pickAccount(canvas, BCA_OPS.id);
    await waitFor(() => expect(canvas.getByTestId("account-report-close-value")).toHaveTextContent(rp(11_443_500)));
    await expect(canvas.getByTestId("account-report-open-value")).toHaveTextContent(rp(10_750_000));

    await userEvent.click(canvas.getByTestId("account-report-change-detail"));
    const dialog = await screen.findByTestId("change-detail");
    await waitFor(() => expect(within(dialog).getByTestId(`change-detail-${T.TRANSFER}`)).toHaveTextContent(signed(-3_500_000)));
  },
};

// What moved it, as two cards (owner, account first): the one that moved most, out of how many — Melati TikTok's
// account, the Lainnya provider as its coloured badge — after the three balances.
export const WhatMovedItByAccountAndProvider: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await waitFor(() => expect(canvas.getByTestId("account-report-by-account-value")).toHaveTextContent(signed(4_200_000)));
    await expect(canvas.getByTestId("account-report-by-account")).toHaveTextContent("Melati TikTok");
    await expect(canvas.getByTestId("account-report-by-account")).toHaveTextContent("Biggest of 7 accounts");
    await expect(canvas.getByTestId("account-report-by-provider-value")).toHaveTextContent(signed(4_200_000));
    await expect(canvas.getByTestId("account-report-by-provider")).toHaveTextContent("Biggest of 5 providers");
    await expect(within(canvas.getByTestId("account-report-by-provider")).getByText("Other").closest(".chakra-badge")).not.toBeNull();

    const cards = Array.from(canvas.getByTestId("account-report-totals").children).map((el) => el.getAttribute("data-testid"));
    await expect(cards).toEqual([
      "account-report-open",
      "account-report-change",
      "account-report-close",
      "account-report-by-account",
      "account-report-by-provider",
    ]);
  },
};

// account-grouped-joins-the-metrics: by account, the largest movement first — named by its shop, the server's
// "Unknown — shop #25" read as Melati TikTok — an archived account still listed and marked, because its past happened,
// and the Total row the team's own figures.
export const ByAccount: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await waitFor(() => expect(canvas.getByTestId("account-report-by-account-detail")).toBeVisible());
    await userEvent.click(canvas.getByTestId("account-report-by-account-detail"));
    const dialog = await screen.findByTestId("movers-account");
    await waitFor(() => expect(dialog).toBeVisible());

    const rows = within(dialog).getAllByTestId(/^movers-row-/);
    await expect(rows).toHaveLength(7);
    await expect(rows[0]).toHaveTextContent("Melati TikTok");
    await expect(rows[0]).not.toHaveTextContent("Unknown");
    await expect(within(dialog).getByTestId(`movers-row-accountId-${BNI.id}`)).toHaveTextContent("Archived");
    await expect(within(dialog).getByTestId(`movers-row-accountId-${BCA_OPS.id}`)).toHaveTextContent(rp(11_443_500));
    await expect(within(dialog).getByTestId("movers-total-account")).toHaveTextContent("Total");
    await expect(within(dialog).getByTestId("movers-total-account")).toHaveTextContent(signed(5_143_500));
    await expect(within(dialog).getByTestId("movers-total-account")).toHaveTextContent(rp(16_443_500));
  },
};

// By provider: BCA's two accounts are one line, the provider its coloured badge.
export const ByProvider: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await waitFor(() => expect(canvas.getByTestId("account-report-by-provider-detail")).toBeVisible());
    await userEvent.click(canvas.getByTestId("account-report-by-provider-detail"));
    const dialog = await screen.findByTestId("movers-provider");
    await waitFor(() => expect(dialog).toBeVisible());

    const bca = within(dialog).getByTestId(`movers-row-provider-${P.BCA}`);
    await expect(bca).toHaveTextContent(signed(1_293_500));
    await expect(bca).toHaveTextContent(rp(12_043_500));
    await expect(within(bca).getByText("BCA").closest(".chakra-badge")).not.toBeNull();
  },
};

// An account's row in the breakdown opens that account's page — its statement.
export const AnAccountRowOpensTheAccount: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await waitFor(() => expect(canvas.getByTestId("account-report-by-account-detail")).toBeVisible());
    await userEvent.click(canvas.getByTestId("account-report-by-account-detail"));
    const dialog = await screen.findByTestId("movers-account");
    await waitFor(() => expect(dialog).toBeVisible());

    await userEvent.click(within(dialog).getByTestId(`movers-row-accountId-${BCA_OPS.id}`));
    await expect(await canvas.findByTestId("at-account-detail")).toBeVisible();
  },
};

// Both go while one account is picked (owner: *"keduanya jadi tidak perlu muncul kalau ada filter akun"*) — one account
// has nothing to rank, and the contract's ranking is always the team's.
export const OneAccountHasNothingToRank: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await waitFor(() => expect(canvas.getByTestId("account-report-by-provider")).toBeVisible());

    await pickAccount(canvas, MELATI_TIKTOK.id);
    await waitFor(() => expect(canvas.getByTestId("account-report-close-value")).toHaveTextContent(rp(4_200_000)));
    await expect(canvas.queryByTestId("account-report-by-account")).toBeNull();
    await expect(canvas.queryByTestId("account-report-by-provider")).toBeNull();
    await expect(canvas.getByTestId("account-report-totals").children).toHaveLength(3);
  },
};

// The table holds every type (owner: *"full data untuk tabelnya saja"*): Periode held on the left, Saldo akhir on the
// right, and a row lights up under the pointer, its held cells with it (owner: *"tabel report kasih hover per row"*).
//
// ⚠ HOVER IS DRIVEN BY `data-hover`, which Chakra's `_hover` honours — a synthetic pointer event sets no CSS `:hover`,
// so `userEvent.hover` alone would assert nothing.
export const TheTableHoldsEveryType: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    const table = canvas.getByTestId("account-report-series");
    const headers = within(table).getAllByRole("columnheader");
    await expect(headers).toHaveLength(12);
    await expect(getComputedStyle(headers[0]!).position).toBe("sticky");
    await expect(getComputedStyle(headers[11]!).position).toBe("sticky");

    const row = within(table).getAllByRole("row")[1]!;
    const cells = within(row).getAllByRole("cell");
    const resting = getComputedStyle(cells[11]!).backgroundColor;
    row.setAttribute("data-hover", "");
    await waitFor(() => expect(getComputedStyle(cells[11]!).backgroundColor).not.toBe(resting));
    await expect(getComputedStyle(cells[11]!).backgroundColor).toBe(getComputedStyle(cells[5]!).backgroundColor);
    await expect(getComputedStyle(cells[0]!).backgroundColor).toBe(getComputedStyle(cells[5]!).backgroundColor);
  },
};

// Daily, newest first, every day a row — today's is quiet and still carries the balance.
export const DailyNewestFirst: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    const rows = within(canvas.getByTestId("account-report-series")).getAllByRole("row");
    await expect(rows).toHaveLength(1 + 20);
    await expect(rows[1]).toHaveTextContent(rp(16_443_500));
    await expect(canvas.getByTestId("account-report-pager")).toBeVisible();
  },
};

// SORTED FROM THE HEADING (`a-table-sorts-from-its-headings`) — newest first, flipped from Periode by the server.
export const SortsFromItsHeading: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    const byPeriod = canvas.getByTestId("account-report-sort-period");
    await expect(byPeriod).toHaveAttribute("data-sort", "desc");
    const firstBefore = within(canvas.getByTestId("account-report-series")).getAllByRole("row")[1]!.textContent;
    await userEvent.click(byPeriod);
    await expect(byPeriod).toHaveAttribute("data-sort", "asc");
    await waitFor(() =>
      expect(within(canvas.getByTestId("account-report-series")).getAllByRole("row")[1]!.textContent).not.toBe(firstBefore),
    );
  },
};

// THE REPORT FOLLOWS THE SCREEN RULES (`the-report-follows-the-screen-rules`) — the subtitle under the title, the filters
// in the shared FilterBar, no account picked reading "All accounts" as the shop filter reads "All shops".
export const TheReportFollowsTheScreenRules: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    const title = canvas.getByRole("heading", { name: "Account Report" });
    const subtitle = canvas.getByTestId("account-report-subtitle");
    await expect(subtitle.getBoundingClientRect().top - title.getBoundingClientRect().bottom).toBeLessThan(12);

    await expect(canvas.getByTestId("account-report-filters")).toBeVisible();
    await expect(canvas.getByTestId("account-report-account")).toHaveAttribute("placeholder", "All accounts");
  },
};

// Export is on the screen and marked (owner: *"sama action export, kasih warning unimplemented"*) — the button on the
// title's row with its ⚠ number, and the folded strip at the top saying what is not built.
export const ExportIsMarkedNotBuilt: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    const exportButton = canvas.getByTestId("account-report-export");
    await expect(exportButton).toHaveTextContent("Export");
    await expect(within(exportButton).getByTestId("not-implemented-export")).toHaveTextContent("1");
    await expect(canvas.getByTestId("not-implemented-summary")).toBeVisible();
  },
};

// The grain picker's pick is rose, and stays rose under the pointer — never black; a segment not picked turns the same
// rose when pointed at (`a-segmented-choice-is-in-the-main-tone`). Driven by `data-hover`, as the table's row is.
export const TheGrainPickStaysInTheMainTone: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    const daily = canvas.getByTestId("account-report-grain-day");
    const monthly = canvas.getByTestId("account-report-grain-month");
    const picked = getComputedStyle(daily).color;
    const resting = getComputedStyle(monthly).color;
    await expect(picked).not.toBe(resting);

    daily.setAttribute("data-hover", "");
    monthly.setAttribute("data-hover", "");
    await waitFor(() => expect(getComputedStyle(monthly).color).toBe(picked));
    await expect(getComputedStyle(daily).color).toBe(picked);
  },
};

/** Clear puts the account, the window and the grain back — red and bold while anything is narrowed. */
export const ClearPutsTheFiltersBack: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(canvas.queryByTestId("account-report-filters-clear")).toBeNull();
    await pickAccount(canvas, BCA_OPS.id);
    await waitFor(() => expect(canvas.getByTestId("account-report-close-value")).toHaveTextContent(rp(11_443_500)));

    await userEvent.click(canvas.getByTestId("account-report-filters-clear"));
    await waitFor(() => expect(canvas.getByTestId("account-report-close-value")).toHaveTextContent(rp(16_443_500)));
  },
};
