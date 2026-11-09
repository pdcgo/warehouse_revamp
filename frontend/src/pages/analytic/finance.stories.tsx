import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";

import { dayKey } from "../../../.storybook/fixtures";
import { asTeam, routedPage } from "../../../.storybook/pageStory";
import { CHANGE_TYPE_FIELDS } from "../../features/analytic/catalogue";
import { AnalyticPage } from "./index";

// FINANCE on the Analytic composer (analytic-gains-a-finance-category, the-finance-prototype-is-accepted) — LIVE: the two
// metrics are served by financial_account_service, and the Storybook stub folds its own ledger (financialAccountStub.ts
// over financialAccountFixtures.ts — Toko Melati's accounts), as the server folds its daily rows.
//
//   Finance › Account changes   metrics/financial_accounts         one signed money field per change type, their net
//                                                                   (`change`), and the balance at each period's two
//                                                                   edges as POSITIONS — opening + changes = closing
//   Finance › Change types      metrics/financial_accounts/types   `amount`, its rows the change types
//
// (financial-accounts-serve-their-changes-and-their-types). A position is never summed (a-position-is-its-own-stat-type):
// a period's opening and closing are its edges, the headline's are the window's, and the accounts add up to the team.

const at = (search: string) => routedPage([{ path: "/analytic", element: <AnalyticPage /> }], `/analytic${search}`);

const CHANGES = "metrics/financial_accounts";
const TYPES = "metrics/financial_accounts/types";
// Relative to today, as the ledger's fixtures are: the last seven days, and the last 45 (every row but BNI Lama's).
const WEEK_DAYS = [6, 5, 4, 3, 2, 1, 0].map(dayKey);
const WEEK = `r=${dayKey(6)}..${dayKey(0)}`;
const OCTOBER = `r=${dayKey(44)}..${dayKey(0)}`;

const Nothing = at(`?g=daily&${WEEK}`);
const ChangesByDay = at(`?g=daily&m=${CHANGES}&${WEEK}`);
const ChangesByAccount = at(`?g=account&m=${CHANGES}&${OCTOBER}&s=${CHANGES}:closing_balance:desc`);
const ChangesByProvider = at(`?g=provider&m=${CHANGES}&${OCTOBER}&s=${CHANGES}:closing_balance:desc`);
const TypesByType = at(`?g=change_type&m=${TYPES}&${OCTOBER}&s=${TYPES}:amount:desc`);
const BothByDay = at(`?g=daily&m=${CHANGES},${TYPES}&${WEEK}`);
const ByAccountTwoPicked = at(`?g=account&m=${CHANGES}&${OCTOBER}&acc=1301,1303&s=${CHANGES}:closing_balance:desc`);
const ChangesByAccountWide = at(`?g=account&m=${CHANGES}&${OCTOBER}&s=${CHANGES}:closing_balance:desc`);

const meta = {
  title: "Pages/Analytic/Finance",
  component: ChangesByDay,
  parameters: { dataRouter: true, signedIn: true },
  beforeEach: [asTeam(12n)],
} satisfies Meta<typeof ChangesByDay>;

export default meta;
type Story = StoryObj<typeof meta>;

async function loaded(canvasElement: HTMLElement) {
  const canvas = within(canvasElement);
  await waitFor(() => expect(canvas.getByTestId("analytic-table")).toBeVisible(), { timeout: 4000 });
  await waitFor(() => expect(canvas.getAllByTestId(/^analytic-row-/).length).toBeGreaterThan(0), { timeout: 4000 });

  return canvas;
}

/** "−Rp 1.240.000" → −1240000 — money as id-ID writes it, the minus a "−". */
const rp = (text: string | null) => {
  const t = text ?? "";
  const n = Number(t.replace(/[^\d]/g, ""));
  return /[−-]/.test(t) ? -n : n;
};

const cell = (canvas: ReturnType<typeof within>, key: string, field: string) =>
  rp(canvas.getByTestId(`analytic-cell-${key}-${field}`).textContent);
const headline = (canvas: ReturnType<typeof within>, field: string) =>
  rp(canvas.getByTestId(`analytic-headline-${field}-value`).textContent);

// THE PICKER — Finance is a category of its own, last, holding the two metrics; ticking Account changes puts its columns
// on the table.
export const FinanceHoldsBothMetrics: Story = {
  render: () => <Nothing />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitFor(() => expect(canvas.getByTestId("analytic-empty")).toBeVisible(), { timeout: 4000 });

    await userEvent.click(canvas.getByTestId("analytic-add-metric"));
    const menu = within(await canvas.findByTestId("analytic-metric-menu"));
    await userEvent.click(menu.getByTestId("analytic-category-finance"));
    await expect(menu.getByTestId("analytic-category-finance")).toHaveTextContent("Finance");

    const list = within(menu.getByTestId("analytic-category-finance-metrics"));
    await expect(list.getByTestId("analytic-metric-metrics-financial_accounts")).toHaveTextContent("Account changes");
    await expect(list.getByTestId("analytic-metric-metrics-financial_accounts-types")).toHaveTextContent("Change types");
    await expect(list.getAllByTestId(/^analytic-metric-[^-]+-[^-]+(-types)?$/)).toHaveLength(2);

    await userEvent.click(list.getByTestId("analytic-metric-metrics-financial_accounts"));
    await waitFor(() => expect(canvas.getByTestId("analytic-chip-metrics-financial_accounts")).toBeVisible());
    await expect(list.getByTestId("analytic-metric-metrics-financial_accounts")).toHaveAttribute("data-state", "checked");
    await waitFor(() => expect(canvas.getByTestId("analytic-sort-closing_balance")).toHaveTextContent("Closing balance"));
    await expect(canvas.getByTestId("analytic-sort-account_opening")).toHaveTextContent("Account opened");
  },
};

// ACCOUNT CHANGES BY DAY — a statement per day: each day opens where the day before closed, and its opening plus its
// changes is its closing. The headline's positions are the WEEK's edges — the first day's opening and the last day's
// closing, never a sum of days; its change is the sum.
export const AccountChangesByDay: Story = {
  render: () => <ChangesByDay />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const days = WEEK_DAYS;

    await expect(canvas.getAllByTestId(/^analytic-row-/)).toHaveLength(7);
    for (const day of days) {
      const types = CHANGE_TYPE_FIELDS.reduce((s, f) => s + cell(canvas, day, f), 0);
      await expect(types).toBe(cell(canvas, day, "change"));
      await expect(cell(canvas, day, "opening_balance") + cell(canvas, day, "change")).toBe(cell(canvas, day, "closing_balance"));
    }
    for (let i = 1; i < days.length; i++) {
      await expect(cell(canvas, days[i]!, "opening_balance")).toBe(cell(canvas, days[i - 1]!, "closing_balance"));
    }
    await expect(cell(canvas, days[0]!, "opening_balance")).toBeGreaterThan(0);

    await expect(headline(canvas, "opening_balance")).toBe(cell(canvas, days[0]!, "opening_balance"));
    await expect(headline(canvas, "closing_balance")).toBe(cell(canvas, days.at(-1)!, "closing_balance"));
    await expect(headline(canvas, "change")).toBe(days.reduce((s, d) => s + cell(canvas, d, "change"), 0));
    // Money out reads with its minus: ShopeePay paid a restock two days ago.
    await expect(cell(canvas, dayKey(2), "restock")).toBe(-400_000);
  },
};

// BY ACCOUNT — each of Toko Melati's accounts a row, named, ranked by its closing balance; the accounts add up to the
// team's headline (a position adds across keys, never across time). A transfer between two of them nets to zero. A
// QUIET account is a row with its balance: Kas Melati opened before the window and never moved in it; BNI Lama, emptied
// and archived before it, still a row at 0.
export const AccountChangesByAccount: Story = {
  render: () => <ChangesByAccount />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    const ids = ["1301", "1302", "1303", "1304", "1305", "1309", "1310"];
    await expect(canvas.getAllByTestId(/^analytic-row-/)).toHaveLength(ids.length);
    await waitFor(() => expect(canvas.getByTestId("analytic-row-1301")).toHaveTextContent("BCA Operasional"));
    await expect(canvas.getByTestId("analytic-row-1303")).toHaveTextContent("ShopeePay Melati");
    await expect(canvas.getByTestId("analytic-row-1309")).toHaveTextContent("Kas Melati");

    // The quiet account: opened 40 days ago, inside the window, and nothing since.
    await expect(cell(canvas, "1309", "account_opening")).toBe(350_000);
    await expect(cell(canvas, "1309", "closing_balance")).toBe(350_000);
    await expect(cell(canvas, "1305", "closing_balance")).toBe(0);
    await expect(cell(canvas, "1301", "closing_balance")).toBe(11_443_500);

    const closings = canvas.getAllByTestId(/^analytic-cell-\d+-closing_balance$/).map((c) => rp(c.textContent));
    await expect([...closings].sort((a, b) => b - a)).toEqual(closings);
    await expect(headline(canvas, "closing_balance")).toBe(ids.reduce((s, id) => s + cell(canvas, id, "closing_balance"), 0));
    await expect(headline(canvas, "opening_balance")).toBe(ids.reduce((s, id) => s + cell(canvas, id, "opening_balance"), 0));
    await expect(ids.reduce((s, id) => s + cell(canvas, id, "transfer"), 0)).toBe(0);
    await expect(canvas.getByTestId("analytic-rows-line")).toHaveTextContent("accounts");
  },
};

// BY PROVIDER — the accounts folded by who holds the money: BCA's two accounts are one row, as the account screens name
// the provider.
export const AccountChangesByProvider: Story = {
  render: () => <ChangesByProvider />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    // BCA (two accounts), BNI (archived), ShopeePay, Lainnya (two), Cash.
    await expect(canvas.getAllByTestId(/^analytic-row-/)).toHaveLength(5);
    await expect(canvas.getByTestId("analytic-row-2")).toHaveTextContent("BCA");
    await expect(canvas.getByTestId("analytic-row-5")).toHaveTextContent("ShopeePay");
    await expect(canvas.getByTestId("analytic-row-1")).toHaveTextContent("Cash");
    // BCA holds the most — it is ranked first.
    await expect(canvas.getAllByTestId(/^analytic-row-/)[0]).toHaveAttribute("data-testid", "analytic-row-2");
    await expect(cell(canvas, "2", "closing_balance")).toBe(11_443_500 + 600_000);
    await expect(headline(canvas, "closing_balance")).toBe(
      ["1", "2", "3", "5", "6"].reduce((s, id) => s + cell(canvas, id, "closing_balance"), 0),
    );
  },
};

// CHANGE TYPES, GROUPED BY CHANGE TYPE — the breakdown as rows, ranked by amount: withdrawals in first, the costs last.
// Their sum is the headline. Account changes cannot be read by change type — a balance belongs to an account, not to a
// type — so the picker greys it and says why.
export const ChangeTypesByChangeType: Story = {
  render: () => <TypesByType />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(canvas.getByTestId("analytic-row-4")).toHaveTextContent("Withdrawal");
    await expect(canvas.getByTestId("analytic-row-5")).toHaveTextContent("Restock");
    await expect(canvas.getByTestId("analytic-row-2")).toHaveTextContent("Ads");
    await expect(canvas.getAllByTestId(/^analytic-row-/)[0]).toHaveAttribute("data-testid", "analytic-row-4");
    // Withdrawals in the window: 3,5 + 4,8 + 1,7 + 2,5 + 2,0 million.
    await expect(cell(canvas, "4", "amount")).toBe(14_500_000);

    const amounts = canvas.getAllByTestId(/^analytic-cell-\d+-amount$/).map((c) => rp(c.textContent));
    await expect([...amounts].sort((a, b) => b - a)).toEqual(amounts);
    await expect(amounts.at(-1)!).toBeLessThan(0);
    await expect(headline(canvas, "amount")).toBe(amounts.reduce((s, a) => s + a, 0));
    await expect(canvas.getByTestId("analytic-sort-amount")).toHaveTextContent("Amount");

    await userEvent.click(canvas.getByTestId("analytic-add-metric"));
    const menu = within(await canvas.findByTestId("analytic-metric-menu"));
    await userEvent.click(menu.getByTestId("analytic-category-finance"));
    await expect(menu.getByTestId("analytic-metric-metrics-financial_accounts")).toHaveAttribute("data-disabled");
    await expect(menu.getByTestId("analytic-metric-metrics-financial_accounts-reason")).toHaveTextContent(
      "Cannot be grouped by change types",
    );
  },
};

// THE TWO METRICS AGREE — side by side by day, a day's Change types amount is its Account changes net.
export const TheTwoMetricsAgree: Story = {
  render: () => <BothByDay />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    for (const row of canvas.getAllByTestId(/^analytic-row-/)) {
      const day = row.getAttribute("data-testid")!.replace("analytic-row-", "");
      await expect(cell(canvas, day, "amount")).toBe(cell(canvas, day, "change"));
    }
  },
};

// THE GRAPH — the movements in Amounts (Rp), the balances in a graph of their own, Positions (Rp).
export const GraphSplitsMovementsFromBalances: Story = {
  render: () => <ChangesByDay />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.click(canvas.getByTestId("analytic-view-graph"));
    await waitFor(() => expect(canvas.getByTestId("analytic-graph-money")).toBeVisible());
    await expect(canvas.getByTestId("analytic-graph-position")).toBeVisible();
  },
};

// ON A PHONE — each account a block of its lines.
export const Mobile: Story = {
  render: () => <ChangesByAccount />,
  globals: { viewport: { value: "mobile2" } },
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(within(canvas.getByTestId("analytic-table")).queryAllByRole("columnheader")).toHaveLength(0);
    await expect(canvas.getByTestId("analytic-row-1301")).toHaveTextContent("BCA Operasional");
    await expect(canvas.getByTestId("analytic-row-1301")).toHaveTextContent("Closing balance");
    await expect(cell(canvas, "1301", "closing_balance")).toBeGreaterThan(0);
  },
};

// THE ACCOUNT FILTER (finance-filters-by-account) — one account or several, under every group: two picked, two rows, and
// the headline is theirs alone. The filter names what is picked.
export const TheAccountFilterNarrowsToThePicked: Story = {
  render: () => <ByAccountTwoPicked />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await waitFor(() => expect(canvas.getAllByTestId(/^analytic-row-/)).toHaveLength(2));
    await expect(canvas.getByTestId("analytic-row-1301")).toBeVisible();
    await expect(canvas.getByTestId("analytic-row-1303")).toBeVisible();
    await expect(headline(canvas, "closing_balance")).toBe(11_443_500 - 150_000);
    await waitFor(() => expect(canvas.getByTestId("analytic-accounts-input")).toHaveAttribute("placeholder", "2 accounts"));

    // Clear: every account again.
    await userEvent.click(canvas.getByTestId("analytic-accounts-clear"));
    await waitFor(() => expect(canvas.getAllByTestId(/^analytic-row-/)).toHaveLength(7));
  },
};

// THE DISPLAY FIXES (the-finance-prototype-is-accepted) at 1440: the highlighted card shows a nine-digit Rp figure whole,
// and the by-account table fits the screen without a sideways scroll.
export const FitsA1440Screen: Story = {
  render: () => <ChangesByAccountWide />,
  globals: { viewport: { value: "desktop1440" } },
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    const card = canvas.getByTestId("analytic-headline-closing_balance-value");
    await expect(card.closest("[data-emphasis]")).not.toBeNull();
    await waitFor(() => expect(card.scrollWidth).toBeLessThanOrEqual(card.clientWidth));

    const table = canvas.getByTestId("analytic-table");
    const scroller = table.parentElement!;
    await expect(scroller.scrollWidth).toBeLessThanOrEqual(scroller.clientWidth + 1);
  },
};
