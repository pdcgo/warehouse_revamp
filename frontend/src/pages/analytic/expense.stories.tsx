import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { expenseMetricCalls, expensePersonCalls } from "../../../.storybook/expenseAnalyticStub";
import { asTeam, besideTheOpenSidebar, routedPage } from "../../../.storybook/pageStory";
import { asPlatformOnly, asRole } from "../../../.storybook/sessionScenario";
import {
  EXPENSES_AS_SERVED,
  EXPENSE_KIND_FIELDS,
  EXPENSE_METRICS,
  EXPENSE_TYPE_FIELDS,
  METRICS,
  catalogueMetrics,
  metricById,
} from "../../features/analytic/catalogue";
import { addSampleFactsForStory } from "../../features/analytic/sample";
import { ROOT_TEAM_ID } from "../../features/team/TeamContext";
import { GroupType } from "../../gen/warehouse/analytic_base/v1/analytic_pb";
import { AdsExpenseMetricSchema, ExpensesMetricSchema } from "../../gen/warehouse/expense/v1/expense_analytic_pb";
import { Role } from "../../gen/warehouse/role_base/v1/role_pb";
import { AnalyticPage } from "./index";

// EXPENSE on the Analytic composer — SERVED by expense_service (expense_analytic.proto, the-expense-prototype-is-accepted)
// and answered here over the stub transport by .storybook/expenseAnalyticStub.ts from sample.ts's expense facts, scoped
// as the server scopes (each team its own, root every team's). Drawn as a prototype (backlog #22, 2026-11-06), accepted,
// and moved live the same day; the stories are the accepted design, now through the real wire path
// (docs/business/analytic/rpc_provide_decision.md):
//
//   Ads expense   `amount`; filters team, shop, user, date range; groups seller, warehouse, created by, time, and shop
//                 (expense-has-ads-and-expenses, the-expense-metrics-follow-the-decisions-already-made).
//   Expenses      one field per TYPED kind — Ads, Payroll, Operational, Other — the total, and one field per expense
//                 TYPE in Biaya's words (backlog #107) — 23 figures; NO Stock loss
//                 (stock-loss-stays-out-of-analytic-expenses), and not the three #99 summaries money in, Prive and
//                 Setoran modal, which the answer still carries (the-expense-metric-shows-each-type-not-the-three-
//                 summaries). The same filters and groups without shop. A warehouse team's expense sits under
//                 Warehouse. The total moves as Biaya's month total: Prive raises it, Setoran modal and money in lower
//                 it (acceptance analytic/expense_metric.md givens 6–22).
//
// A correction counts ON THE DAY IT IS MADE (an-expense-correction-counts-on-the-day-it-is-made) and for THE PERSON WHO
// MADE IT (an-expense-correction-counts-for-who-made-it): Toko Sinar's Rp 500.000 ad of 14 Oct, typed by Budi, is
// corrected by Dewi by −Rp 450.000 on 20 Oct — 14 Oct keeps Rp 500.000, 20 Oct reads −Rp 450.000 under Dewi, October
// nets Rp 50.000; its Rp 200.000 of 16 Oct is cancelled by Budi on the 17th. Every team reads its own (CS included),
// root every team's. The sample's teams: Toko Melati (12) — ads, payroll, rent, utilities, other; Toko Kenanga (13) —
// rent and payroll; Gudang Pusat (11, a warehouse) — payroll, rent and power, packing supplies.

const at = (search: string) => routedPage([{ path: "/analytic", element: <AnalyticPage /> }], `/analytic${search}`);

const ADS = "metrics/ads";
const EXPENSES = "metrics/expenses";
const OCTOBER = "r=2026-10-01..2026-10-31";
const QUARTER = "r=2026-08-01..2026-10-31";
/** The typed kinds' labels, then the total's — the Expenses columns, in order. */
const KIND_LABELS = ["Ads", "Payroll", "Operational", "Other", "Total expenses"];

const Nothing = at(`?g=daily&${OCTOBER}`);
const NothingByShop = at(`?g=shop&${OCTOBER}`);
const AdsByShop = at(`?g=shop&m=${ADS}&${OCTOBER}&s=${ADS}:amount:desc`);
const AdsDaily = at(`?g=daily&m=${ADS}&r=2026-10-01..2026-10-07`);
const AdsCorrected = at(`?g=daily&m=${ADS}&shop=16&r=2026-10-13..2026-10-20`);
const AdsCorrectedMonthly = at(`?g=monthly&m=${ADS}&shop=16&r=2026-09-01..2026-10-31`);
const AdsByCreator = at(`?g=user&m=${ADS}&${OCTOBER}&s=${ADS}:amount:desc`);
const AdsOfTheCorrector = at(`?g=daily&m=${ADS}&user=64&r=2026-10-14..2026-10-20`);
const ExpensesMonthly = at(`?g=monthly&m=${EXPENSES}&${QUARTER}`);
const ExpensesDaily = at(`?g=daily&m=${EXPENSES}&r=2026-10-01..2026-10-10`);
const ExpensesByWarehouse = at(`?g=warehouse&m=${EXPENSES}&${OCTOBER}&s=${EXPENSES}:total:desc`);
const ExpensesBySeller = at(`?g=team&m=${EXPENSES}&${OCTOBER}&s=${EXPENSES}:total:desc`);
const AdsAndExpensesMonthly = at(`?g=monthly&m=${ADS},${EXPENSES}&${QUARTER}`);
const AdsForSinar = at(`?g=daily&m=${ADS}&shop=16&r=2026-10-13..2026-10-20`);
const ExpensesOctoberMonthly = at(`?g=monthly&m=${EXPENSES}&${OCTOBER}`);
const BothByCreator = at(`?g=user&m=${ADS},${EXPENSES}&${OCTOBER}&s=${EXPENSES}:total:desc`);
const ExpensesOnThe15th = at(`?g=daily&m=${EXPENSES}&r=2026-10-15..2026-10-15`);

const meta = {
  title: "Pages/Analytic/Expense",
  component: AdsByShop,
  parameters: { dataRouter: true, signedIn: true },
  beforeEach: [
    asTeam(12n),
    () => {
      expenseMetricCalls.length = 0;
      expensePersonCalls.length = 0;
    },
  ],
} satisfies Meta<typeof AdsByShop>;

export default meta;
type Story = StoryObj<typeof meta>;

async function loaded(canvasElement: HTMLElement) {
  const canvas = within(canvasElement);
  await waitFor(() => expect(canvas.getByTestId("analytic-table")).toBeVisible(), { timeout: 4000 });
  await waitFor(() => expect(canvas.getAllByTestId(/^analytic-row-/).length).toBeGreaterThan(0), { timeout: 4000 });

  return canvas;
}

/** "Rp 1.240.000" / "Rp 19.550,001" / "−Rp 450.000" → 1240000 / 19550.001 / −450000 — a figure as id-ID writes it. */
const rupiah = (text: string | null) => {
  const t = (text ?? "").trim();
  const value = Number(t.replace(/[^\d,]/g, "").replace(",", "."));

  return /^[−-]/.test(t) ? -value : value;
};

const cell = (canvas: ReturnType<typeof within>, key: string, field: string) =>
  rupiah(canvas.getByTestId(`analytic-cell-${key}-${field}`).textContent);

const column = (canvas: ReturnType<typeof within>, field: string): number[] =>
  canvas.getAllByTestId(new RegExp(`^analytic-cell-[\\d-]+-${field}$`)).map((c: HTMLElement) => rupiah(c.textContent));

const headline = (canvas: ReturnType<typeof within>, field: string) =>
  rupiah(canvas.getByTestId(`analytic-headline-${field}-value`).textContent);

const rowKeys = (canvas: ReturnType<typeof within>) =>
  canvas.getAllByTestId(/^analytic-row-/).map((r: HTMLElement) => r.getAttribute("data-testid")!.replace("analytic-row-", ""));

const sum = (values: number[]) => values.reduce((s, a) => s + a, 0);

/** A heading's words as written — the table holds some of their spaces unbreakable (inTwoLines, headings.stories.tsx). */
const headingText = (h: HTMLElement) => (h.textContent ?? "").replace(/\s+/g, " ").trim();

/** No Stock loss anywhere — no column, no cell, no headline card (stock-loss-stays-out-of-analytic-expenses). */
async function noStockLoss(canvas: ReturnType<typeof within>) {
  await expect(canvas.queryByTestId("analytic-sort-stock_loss")).toBeNull();
  await expect(canvas.queryAllByTestId(/-stock_loss(-value)?$/)).toHaveLength(0);
  await expect(canvas.getByTestId("analytic-page")).not.toHaveTextContent("Stock loss");
}

/** Pick a table group in the composer's Group by. */
async function groupBy(canvas: ReturnType<typeof within>, group: string) {
  await userEvent.click(canvas.getByTestId("analytic-group"));
  await waitFor(() => expect(canvas.getByTestId(`analytic-group-option-${group}`)).toBeVisible());
  await userEvent.click(canvas.getByTestId(`analytic-group-option-${group}`));
}

// THE PICKER — Expense holds Warehouse fee, Ads expense and Expenses. Ads expense adds ONE column, Ads spend (the tree's
// `amount`); Expenses adds a column per typed kind and the total — no Stock loss.
export const ExpenseHoldsAdsAndExpenses: Story = {
  render: () => <Nothing />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitFor(() => expect(canvas.getByTestId("analytic-empty")).toBeVisible(), { timeout: 4000 });

    await userEvent.click(canvas.getByTestId("analytic-add-metric"));
    const menu = within(await canvas.findByTestId("analytic-metric-menu"));
    await userEvent.click(menu.getByTestId("analytic-category-expense"));
    const leaves = within(menu.getByTestId("analytic-category-expense-metrics"));

    await expect(leaves.getByTestId("analytic-metric-metrics-warehouse_fee")).toHaveTextContent("Warehouse fee");
    const ads = leaves.getByTestId("analytic-metric-metrics-ads");
    const expenses = leaves.getByTestId("analytic-metric-metrics-expenses");
    await expect(ads).toHaveTextContent(/^Ads expense$/);
    await expect(expenses).toHaveTextContent(/^Expenses$/);

    await userEvent.click(ads);
    await waitFor(() => expect(canvas.getByTestId("analytic-chip-metrics-ads")).toHaveTextContent("Ads expense"));
    await expect(ads).toHaveAttribute("data-state", "checked");
    await waitFor(() => expect(canvas.getByTestId("analytic-sort-amount")).toHaveTextContent("Ads spend"));

    await userEvent.click(expenses);
    await waitFor(() => expect(canvas.getByTestId("analytic-chip-metrics-expenses")).toBeVisible());
    await expect(expenses).toHaveAttribute("data-state", "checked");
    for (const [i, field] of [...EXPENSE_KIND_FIELDS, "total"].entries()) {
      await waitFor(() => expect(canvas.getByTestId(`analytic-sort-${field}`)).toHaveTextContent(KIND_LABELS[i]!));
    }
    await noStockLoss(canvas);
    // Read off the served messages — one of each id in the catalogue.
    await expect(metricById(ADS)?.fields.map((f) => f.name)).toEqual(["amount"]);
    // The four kinds and the total — then one field per expense type (backlog #107); not the three #99 summaries.
    const names = metricById(EXPENSES)?.fields.map((f) => f.name).join(",");
    await expect(names).toBe(["ads", "payroll", "operational", "other", "total", ...EXPENSE_TYPE_FIELDS].join(","));
    await expect(catalogueMetrics().filter((m) => m.metricId === ADS)).toHaveLength(1);
  },
};

// THE GROUPS AND FILTERS AS DECIDED (the-expense-metrics-follow-the-decisions-already-made) — both read by seller,
// warehouse, created by and time; only Ads expense by shop, so under Shop the picker says Expenses cannot follow.
// Filters: Ads expense team, shop, user, date; Expenses the same without shop.
export const TheGroupsAndFiltersAsDecided: Story = {
  render: () => <NothingByShop />,
  play: async ({ canvasElement }) => {
    await expect(metricById(ADS)?.supportedGroupBy).toEqual(["summary", "shop", "team", "warehouse", "user", "daily", "weekly", "monthly", "yearly"]);
    await expect(metricById(EXPENSES)?.supportedGroupBy).toEqual(["summary", "team", "warehouse", "user", "daily", "weekly", "monthly", "yearly"]);
    await expect(metricById(ADS)?.supportedFilters).toEqual(["dateRange", "shop", "team", "user"]);
    await expect(metricById(EXPENSES)?.supportedFilters).toEqual(["dateRange", "team", "user"]);

    const canvas = within(canvasElement);
    await waitFor(() => expect(canvas.getByTestId("analytic-empty")).toBeVisible(), { timeout: 4000 });
    await userEvent.click(canvas.getByTestId("analytic-add-metric"));
    const menu = within(await canvas.findByTestId("analytic-metric-menu"));
    await userEvent.click(menu.getByTestId("analytic-category-expense"));

    await expect(menu.queryByTestId("analytic-metric-metrics-ads-reason")).toBeNull();
    await expect(menu.getByTestId("analytic-metric-metrics-expenses-reason")).toHaveTextContent("shops");
    await expect(menu.getByTestId("analytic-metric-metrics-expenses")).toHaveAttribute("data-disabled");
  },
};

// ADS BY SHOP — the shops that cost the most in ads first, the headline their sum. Toko Sinar's October nets Rp 50.000
// (500.000 − 450.000, and 200.000 cancelled), so it is a row at the bottom; Toko Satria buys no ads and is no row.
export const AdsByShopRanked: Story = {
  render: () => <AdsByShop />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(rowKeys(canvas)).toHaveLength(4);
    await expect(canvas.getByTestId("analytic-row-11")).toHaveTextContent("Toko Maryam");
    await expect(canvas.getByTestId("analytic-row-16")).toHaveTextContent("Toko Sinar");
    await expect(canvas.queryByTestId("analytic-row-13")).toBeNull();
    await expect(rowKeys(canvas).at(-1)).toBe("16");
    await expect(cell(canvas, "16", "amount")).toBe(50_000);

    const amounts = column(canvas, "amount");
    await expect([...amounts].sort((a, b) => b - a)).toEqual(amounts);
    await expect(headline(canvas, "amount")).toBe(sum(amounts));
    await expect(canvas.getByTestId("analytic-rows-line")).toHaveTextContent("Rows: shops with ads expense in this period");
    // The tree's filters: team, shop, user and the date range — no warehouse.
    for (const f of ["shop", "team", "user"]) await expect(canvas.getByTestId(`analytic-filter-${f}`)).toBeVisible();
    await expect(canvas.queryByTestId("analytic-filter-warehouse")).toBeNull();
  },
};

// ADS DAILY — every day of the window a row, a quiet one included, newest first; the week's headline is the sum.
export const AdsDailyNewestFirst: Story = {
  render: () => <AdsDaily />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(rowKeys(canvas)).toEqual(["2026-10-07", "2026-10-06", "2026-10-05", "2026-10-04", "2026-10-03", "2026-10-02", "2026-10-01"]);
    const amounts = column(canvas, "amount");
    await expect(amounts.some((a) => a > 0)).toBe(true);
    await expect(headline(canvas, "amount")).toBe(sum(amounts));
  },
};

// A CORRECTION COUNTS ON THE DAY IT IS MADE (an-expense-correction-counts-on-the-day-it-is-made) — Toko Sinar: the
// Rp 500.000 of 14 Oct keeps reading Rp 500.000; the −Rp 450.000 correction reads on the 20th, the day it was made; the
// Rp 200.000 of the 16th is taken back on the 17th, the cancel day. The week nets Rp 50.000.
export const ACorrectionCountsOnTheDayItIsMade: Story = {
  render: () => <AdsCorrected />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(rowKeys(canvas)).toHaveLength(8);
    await expect(cell(canvas, "2026-10-14", "amount")).toBe(500_000);
    await expect(cell(canvas, "2026-10-20", "amount")).toBe(-450_000);
    await expect(canvas.getByTestId("analytic-cell-2026-10-20-amount")).toHaveTextContent(/^[−-]\s?Rp\s?450\.000$/);
    await expect(cell(canvas, "2026-10-16", "amount")).toBe(200_000);
    await expect(cell(canvas, "2026-10-17", "amount")).toBe(-200_000);
    for (const day of ["2026-10-13", "2026-10-15", "2026-10-18", "2026-10-19"]) {
      await expect(cell(canvas, day, "amount")).toBe(0);
    }
    await expect(headline(canvas, "amount")).toBe(50_000);
  },
};

// A MONTH NETS THE CORRECTION — Toko Sinar by month: October reads Rp 50.000 (500.000 − 450.000 + 200.000 − 200.000);
// September, before any of it, reads Rp 0 — past periods never change.
export const AMonthNetsTheCorrection: Story = {
  render: () => <AdsCorrectedMonthly />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(rowKeys(canvas)).toEqual(["2026-10-01", "2026-09-01"]);
    await expect(cell(canvas, "2026-10-01", "amount")).toBe(50_000);
    await expect(cell(canvas, "2026-09-01", "amount")).toBe(0);
    await expect(headline(canvas, "amount")).toBe(50_000);
  },
};

// CREATED BY COUNTS THE CORRECTOR (an-expense-correction-counts-for-who-made-it) — October's ads by who made each entry:
// Budi typed Sinar's two ads and cancelled one (500.000 + 200.000 − 200.000); Dewi only corrected, so she reads
// −Rp 450.000, the last row. Named by UserByIDs.
export const CreatedByCountsTheCorrector: Story = {
  render: () => <AdsByCreator />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(rowKeys(canvas)).toHaveLength(4);
    await waitFor(() => expect(canvas.getByTestId("analytic-row-61")).toHaveTextContent("Ani Rahayu"));
    await expect(canvas.getByTestId("analytic-row-62")).toHaveTextContent("Budi Santoso");
    await expect(canvas.getByTestId("analytic-row-64")).toHaveTextContent("Dewi Lestari");
    await expect(canvas.getByTestId("analytic-row-65")).toHaveTextContent("Eko Prasetyo");
    await expect(cell(canvas, "62", "amount")).toBe(500_000);
    await expect(cell(canvas, "64", "amount")).toBe(-450_000);
    await expect(rowKeys(canvas).at(-1)).toBe("64");
    await expect(headline(canvas, "amount")).toBe(sum(column(canvas, "amount")));
  },
};

// A CORRECTOR'S NEGATIVE DAY — Dewi's ads, day by day: −Rp 450.000 on 20 Oct, the day she corrected Budi's ad; nothing
// on the 14th, which stays Budi's. Accepted by the owner: it shows who changed what.
export const ACorrectorReadsNegativeOnTheirDay: Story = {
  render: () => <AdsOfTheCorrector />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(rowKeys(canvas)).toHaveLength(7);
    await expect(cell(canvas, "2026-10-20", "amount")).toBe(-450_000);
    for (const day of ["2026-10-14", "2026-10-15", "2026-10-16", "2026-10-17", "2026-10-18", "2026-10-19"]) {
      await expect(cell(canvas, day, "amount")).toBe(0);
    }
    await expect(headline(canvas, "amount")).toBe(-450_000);
  },
};

/** Open the "created by" field and wait for its options — they are portalled, so read off `screen`. */
async function openPeople(canvas: ReturnType<typeof within>) {
  const field = await canvas.findByTestId("analytic-filter-user", {}, { timeout: 4000 });
  await userEvent.click(within(field).getByRole("combobox"));
  await waitFor(() => expect(screen.getAllByRole("option").length).toBeGreaterThan(0), { timeout: 4000 });
}

/** The ids the "created by" field offers, in its order. */
const offered = () =>
  screen.getAllByTestId(/^person-filter-option-\d+$/).map((o: HTMLElement) => o.getAttribute("data-testid")!.replace("person-filter-option-", ""));

// CREATED BY OFFERS THE EXPENSE PEOPLE (a-who-filter-lists-the-people-on-its-rows) — with ONLY expense metrics on the
// table, the field lists who typed or corrected Toko Melati's expenses, as expense_service's ExpensePersonList answers:
// Ani, Budi, Dewi (who only corrected) and Eko, each named — never Toko Kenanga's Ani Lestari. Picking Dewi narrows the
// table to her row: her −Rp 450.000 correction.
export const CreatedByOffersTheExpensePeople: Story = {
  render: () => <BothByCreator />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await expect(rowKeys(canvas)).toHaveLength(4);

    await openPeople(canvas);
    await waitFor(() => expect(offered().sort()).toEqual(["61", "62", "64", "65"]));
    await expect(screen.getByTestId("person-filter-option-61")).toHaveTextContent("Ani Rahayu");
    await expect(screen.getByTestId("person-filter-option-62")).toHaveTextContent("Budi Santoso");
    await expect(screen.getByTestId("person-filter-option-64")).toHaveTextContent("Dewi Lestari");
    await expect(screen.getByTestId("person-filter-option-65")).toHaveTextContent("Eko Prasetyo");
    await expect(screen.queryByTestId("person-filter-option-68")).toBeNull();
    await expect(expensePersonCalls.at(-1)).toEqual({ teamId: 12n, metricIds: [ADS, EXPENSES] });

    await userEvent.click(screen.getByTestId("person-filter-option-64"));
    await waitFor(() => expect(rowKeys(canvas)).toEqual(["64"]));
    await expect(cell(canvas, "64", "total")).toBe(-450_000);
    await expect(headline(canvas, "total")).toBe(-450_000);
  },
};

// ADS EXPENSE ALONE asks for its ads' people only — the service leaves out whoever typed only payroll or rent.
export const CreatedByForAdsAloneAsksForTheAdsPeople: Story = {
  render: () => <AdsByCreator />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await openPeople(canvas);

    await waitFor(() => expect(offered().sort()).toEqual(["61", "62", "64", "65"]));
    await expect(expensePersonCalls.at(-1)).toEqual({ teamId: 12n, metricIds: [ADS] });
  },
};

// A WAREHOUSE TEAM IS OFFERED ITS OWN PEOPLE — Gudang Pusat's Dewi, Budi and Eko, who typed its payroll, rent and
// supplies; Toko Melati's Ani is on none of its rows.
export const AWarehouseIsOfferedItsOwnPeople: Story = {
  render: () => <ExpensesMonthly />,
  beforeEach: [asTeam(11n)],
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await openPeople(canvas);

    await waitFor(() => expect(offered().sort()).toEqual(["62", "64", "65"]));
    await expect(screen.getByTestId("person-filter-option-64")).toHaveTextContent("Dewi Lestari");
    await expect(screen.queryByTestId("person-filter-option-61")).toBeNull();
  },
};

// ROOT IS OFFERED EVERY TEAM'S PEOPLE — Toko Melati's, Gudang Pusat's and Toko Kenanga's Ani Lestari, each once.
export const RootIsOfferedEveryTeamsPeople: Story = {
  render: () => <ExpensesMonthly />,
  beforeEach: [asTeam(ROOT_TEAM_ID), asPlatformOnly(Role.ROOT)],
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await openPeople(canvas);

    await waitFor(() => expect(offered().sort()).toEqual(["61", "62", "64", "65", "68"]));
    await expect(screen.getByTestId("person-filter-option-68")).toHaveTextContent("Ani Lestari");
    await expect(expensePersonCalls.at(-1)?.teamId).toBe(ROOT_TEAM_ID);
  },
};

// EXPENSES BY KIND, MONTHLY — a column per typed kind and the total: each month's total is its kinds' sum, payroll is
// filed under the month it pays for (Rp 7.500.000 on each last day), rent and utilities under Operational. No Stock loss.
export const ExpensesByKindMonthly: Story = {
  render: () => <ExpensesMonthly />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(rowKeys(canvas)).toEqual(["2026-10-01", "2026-09-01", "2026-08-01"]);
    for (const month of rowKeys(canvas)) {
      const kinds = EXPENSE_KIND_FIELDS.map((f) => cell(canvas, month, f));
      await expect(cell(canvas, month, "total")).toBe(sum(kinds));
      await expect(cell(canvas, month, "payroll")).toBe(7_500_000);
      await expect(cell(canvas, month, "operational")).toBeGreaterThan(2_500_000);
      await expect(cell(canvas, month, "ads")).toBeGreaterThan(0);
    }
    // The headline: a card per kind and the total, each the quarter's sum.
    for (const f of [...EXPENSE_KIND_FIELDS, "total"]) await expect(headline(canvas, f)).toBe(sum(column(canvas, f)));
    await noStockLoss(canvas);
  },
};

// EXPENSES DAILY — the days the money belongs to: rent on the 1st, utilities on the 10th, ads most days.
export const ExpensesByDay: Story = {
  render: () => <ExpensesDaily />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(rowKeys(canvas)).toHaveLength(10);
    await expect(cell(canvas, "2026-10-01", "operational")).toBe(2_500_000);
    await expect(cell(canvas, "2026-10-10", "operational")).toBeGreaterThan(450_000 - 1);
    await expect(cell(canvas, "2026-10-05", "operational")).toBe(0);
    for (const day of rowKeys(canvas)) {
      await expect(cell(canvas, day, "total")).toBe(sum(EXPENSE_KIND_FIELDS.map((f) => cell(canvas, day, f))));
    }
  },
};

// EACH EXPENSE TYPE IS A COLUMN, IN BIAYA'S WORDS (backlog #107; acceptance analytic/expense_metric.md givens 6–22 —
// *<type> shown*) — after the total, the eighteen types in Biaya's order, each headed with the words Biaya's
// month card uses. Toko Melati's utilities on the 10th sit under Electricity and its ads under Marketplace ads; the rent
// on the 1st reads as a row from before the types: Operational and the total hold it, no type does.
const TYPE_WORDS = [
  "Marketplace ads",
  "Content · endorsement",
  "Basic salary",
  "Bonus",
  "Contributions (BPJS)",
  "Electricity",
  "Internet · data package",
  "Kitchen · team meals",
  "Tools",
  "Equipment",
  "Bank fee",
  "Discrepancy · unrecorded transaction",
  "Outside debt paid",
  "Outside receivable received",
  "Prive · owner takes capital",
  "Deposit · owner adds capital",
  "Other money out",
  "Other money in",
];

const OPERATIONAL_TYPES = ["electricity", "internet", "kitchen", "tools", "equipment", "bank_fee", "discrepancy"];

export const EachTypeIsAColumnInBiayasWords: Story = {
  render: () => <ExpensesDaily />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    // The headings, in order: period, the kinds and total, then the types in Biaya's words.
    const headings = within(canvas.getByTestId("analytic-table")).getAllByRole("columnheader").map(headingText);
    await expect(headings.slice(-EXPENSE_TYPE_FIELDS.length).join("|")).toBe(TYPE_WORDS.join("|"));
    await expect(headings).toHaveLength(1 + EXPENSE_KIND_FIELDS.length + 1 + TYPE_WORDS.length);
    for (const [i, field] of EXPENSE_TYPE_FIELDS.entries()) {
      await expect(canvas.getByTestId(`analytic-sort-${field}`)).toHaveTextContent(TYPE_WORDS[i]!);
      await expect(headline(canvas, field)).toBe(sum(column(canvas, field)));
    }

    // The 10th: the utilities are Electricity's, the ads Marketplace ads'.
    await expect(cell(canvas, "2026-10-10", "electricity")).toBe(cell(canvas, "2026-10-10", "operational"));
    await expect(cell(canvas, "2026-10-10", "electricity")).toBeGreaterThan(450_000 - 1);
    for (const day of rowKeys(canvas)) {
      await expect(cell(canvas, day, "ads_marketplace")).toBe(cell(canvas, day, "ads"));
    }

    // The 1st: the rent is Operational's and the total's, no type's.
    await expect(cell(canvas, "2026-10-01", "operational")).toBe(2_500_000);
    for (const field of OPERATIONAL_TYPES) await expect(cell(canvas, "2026-10-01", field)).toBe(0);
    const typed = sum(EXPENSE_TYPE_FIELDS.map((f) => cell(canvas, "2026-10-01", f)));
    await expect(cell(canvas, "2026-10-01", "total")).toBe(typed + 2_500_000);
    await noStockLoss(canvas);
  },
};

// THE TOTAL MOVES AS BIAYA'S MONTH TOTAL (givens 17–22) — on 15 Oct Toko Melati also pays an outside debt of 1.000.000,
// takes a prive of 2.000.000, deposits 1.000.000, receives an outside receivable of 500.000 and other money of 100.000.
// Each type shows in its own column, money in and Setoran modal minus as on Biaya; the total is the spending − money in
// + Prive − Setoran modal: up by the debt and the prive, down by the deposit and the money in. The kinds stay spending.
// The answer also carries the three #99 summaries (money in 600.000, Prive 2.000.000, Setoran modal 1.000.000); the
// screen shows none of them (the-expense-metric-shows-each-type-not-the-three-summaries).
const THE_15TH = "2026-10-15";

/** The three #99 summaries the answer carries and the screen does not offer — written out, never read off the catalogue. */
const THE_THREE = ["money_in", "capital_out", "capital_in"];

const capitalAndMoneyIn = () =>
  addSampleFactsForStory(
    EXPENSES,
    ...([
      { other: 1_000_000, outside_debt_paid: 1_000_000, total: 1_000_000 },
      { capital_out: 2_000_000, prive: 2_000_000, total: 2_000_000 },
      { capital_in: 1_000_000, capital_deposit: -1_000_000, total: -1_000_000 },
      { money_in: 500_000, outside_receivable_received: -500_000, total: -500_000 },
      { money_in: 100_000, other_in: -100_000, total: -100_000 },
    ] as Record<string, number>[]).map((values) => ({ day: THE_15TH, team: "12", user: "61", owner: "12", values })),
  );

export const TheTotalMovesAsBiayasMonthTotal: Story = {
  render: () => <ExpensesOnThe15th />,
  beforeEach: [capitalAndMoneyIn],
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(rowKeys(canvas)).toEqual([THE_15TH]);
    const at15 = (field: string) => cell(canvas, THE_15TH, field);

    // Each type shown, signed as Biaya shows it.
    await expect(at15("outside_debt_paid")).toBe(1_000_000);
    await expect(at15("prive")).toBe(2_000_000);
    await expect(at15("capital_deposit")).toBe(-1_000_000);
    await expect(at15("outside_receivable_received")).toBe(-500_000);
    await expect(at15("other_in")).toBe(-100_000);
    await expect(canvas.getByTestId(`analytic-cell-${THE_15TH}-capital_deposit`)).toHaveTextContent(/^−Rp/);

    // No cell of the three summaries; the kinds stay spending (the debt is Other's).
    for (const f of THE_THREE) await expect(canvas.queryByTestId(`analytic-cell-${THE_15TH}-${f}`)).toBeNull();
    const spending = sum(EXPENSE_KIND_FIELDS.map(at15));
    await expect(at15("other")).toBeGreaterThan(1_000_000 - 1);

    // THE TOTAL: spending − money in + Prive − Setoran modal — the type columns summed.
    await expect(at15("total")).toBe(spending - 600_000 + 2_000_000 - 1_000_000);
    await expect(at15("total")).toBe(sum(EXPENSE_TYPE_FIELDS.map(at15)));
    await expect(headline(canvas, "total")).toBe(at15("total"));
  },
};

// NOT THE THREE #99 SUMMARIES (the-expense-metric-shows-each-type-not-the-three-summaries) — on the 15th the answer still
// carries money in, Prive and Setoran modal (the proto keeps them; the stub answers them as expense_service does, from
// EXPENSES_AS_SERVED), but the screen offers the four groups, the total and the eighteen types — 23 figures: 23 headline
// cards, 23 columns after the period, 23 sorts, and no card, column, cell or sort of the three. Each is read through its
// type instead. Beside the open sidebar at 1440, as the app draws it: the table may scroll in its own box, the page not.
const SHOWN_FIELDS = [...EXPENSE_KIND_FIELDS, "total", ...EXPENSE_TYPE_FIELDS];

const AT_1440 = { viewport: { value: "desktop1440" } };

/** The id words of the Expenses columns — the kinds and the total, then the types as Biaya words them. */
const KIND_LABELS_ID = ["Iklan", "Gaji", "Operasional", "Lainnya", "Total biaya"];
const TYPE_WORDS_ID = [
  "Iklan marketplace",
  "Konten · endorse",
  "Gaji pokok",
  "Bonus",
  "Iuran (BPJS)",
  "Listrik",
  "Internet · paket data",
  "Dapur · makan tim",
  "Alat",
  "Perlengkapan",
  "Biaya bank",
  "Selisih · transaksi tak tercatat",
  "Utang luar dibayar",
  "Piutang luar diterima",
  "Prive · ambil modal",
  "Setoran modal",
  "Uang keluar lain",
  "Uang masuk lain",
];

const testIdsOf = (els: HTMLElement[], strip: RegExp) => els.map((e) => e.getAttribute("data-testid")!.replace(strip, ""));

/** The 23 and only the 23 — headline, columns in `words`, sorts — and the page fits beside the sidebar. */
async function onlyTheTwentyThree(canvasElement: HTMLElement, words: string[]) {
  const canvas = await loaded(canvasElement);
  await expect(window.innerWidth).toBe(1440);

  // The catalogue offers the 23; the served message still has the three.
  await expect(SHOWN_FIELDS).toHaveLength(23);
  await expect(metricById(EXPENSES)?.fields.map((f) => f.name).join(",")).toBe(SHOWN_FIELDS.join(","));
  const served = EXPENSES_AS_SERVED.fields.map((f) => f.name);
  for (const f of THE_THREE) await expect(served).toContain(f);

  // A headline card per figure, in order.
  const cards = testIdsOf(canvas.getAllByTestId(/^analytic-headline-[a-z_]+-value$/), /^analytic-headline-|-value$/g);
  await expect(cards.join(",")).toBe(SHOWN_FIELDS.join(","));

  // The period, then the 23 headed in the screen's words — a sort on each.
  const table = within(canvas.getByTestId("analytic-table"));
  const headings = table.getAllByRole("columnheader").map(headingText);
  await expect(headings.slice(1).join("|")).toBe(words.join("|"));
  const sorts = testIdsOf(table.getAllByTestId(/^analytic-sort-/), /^analytic-sort-/).filter((k) => k !== "key");
  await expect(sorts.join(",")).toBe(SHOWN_FIELDS.join(","));

  // None of the three anywhere: no card, column, cell or sort.
  for (const f of THE_THREE) {
    await expect(canvas.queryAllByTestId(new RegExp(`-${f}(-value|-note)?$`))).toHaveLength(0);
  }

  // The page fits at 1440 beside the open sidebar; only the table's own box may scroll.
  const page = canvas.getByTestId("analytic-page");
  await expect(page.scrollWidth).toBeLessThanOrEqual(page.clientWidth);

  return headings;
}

export const NotTheThreeSummaries: Story = {
  name: "Not the three summaries · English",
  render: () => <ExpensesOnThe15th />,
  decorators: [besideTheOpenSidebar],
  globals: AT_1440,
  beforeEach: [capitalAndMoneyIn],
  play: async ({ canvasElement }) => {
    const headings = await onlyTheTwentyThree(canvasElement, [...KIND_LABELS, ...TYPE_WORDS]);
    for (const word of ["Money in", "Prive", "Capital deposit"]) await expect(headings).not.toContain(word);
  },
};

// IN INDONESIAN — the duplicate goes: *Setoran modal* heads ONE column, the type's; no *Uang masuk*, no bare *Prive*.
export const NotTheThreeSummariesInIndonesian: Story = {
  name: "Not the three summaries · Indonesian",
  render: () => <ExpensesOnThe15th />,
  decorators: [besideTheOpenSidebar],
  globals: { ...AT_1440, locale: "id" },
  beforeEach: [capitalAndMoneyIn],
  play: async ({ canvasElement }) => {
    const headings = await onlyTheTwentyThree(canvasElement, [...KIND_LABELS_ID, ...TYPE_WORDS_ID]);
    await expect(headings.filter((h) => h === "Setoran modal")).toHaveLength(1);
    for (const word of ["Uang masuk", "Prive"]) await expect(headings).not.toContain(word);
  },
};

// A LINK SORTED BY ONE OF THE THREE opens on the default sort — Expenses' first figure, Ads, largest first — never an
// error and never the summary's column (parseSort finds no such field in the catalogue).
const SortedByASummary = at(`?g=team&m=${EXPENSES}&${OCTOBER}&s=${EXPENSES}:capital_in:desc`);

export const ALinkSortedByASummaryOpensOnTheDefault: Story = {
  name: "A link sorted by a summary opens on the default sort",
  render: () => <SortedByASummary />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(rowKeys(canvas)).toEqual(["12"]);
    await expect(canvas.getByTestId("analytic-sort-ads")).toHaveAttribute("data-sort", "desc");
    await expect(canvas.queryByTestId("analytic-sort-capital_in")).toBeNull();
  },
};

// ADS EXPENSE AND EXPENSES AGREE — one table, by month: Ads expense's Ads spend is Expenses' Ads, month by month
// (October's nets Sinar's correction in both).
export const AdsExpenseIsExpensesAds: Story = {
  render: () => <AdsAndExpensesMonthly />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    for (const month of rowKeys(canvas)) {
      await expect(cell(canvas, month, "amount")).toBe(cell(canvas, month, "ads"));
    }
    // Both list team and user; only Ads expense lists shop — so the pair shows no shop filter.
    await expect(canvas.getByTestId("analytic-filter-team")).toBeVisible();
    await expect(canvas.getByTestId("analytic-filter-user")).toBeVisible();
    await expect(canvas.queryByTestId("analytic-filter-shop")).toBeNull();
  },
};

// ADDING EXPENSES REMOVES THE SHOP FILTER (a-new-metric-removes-the-filters-it-cannot-use) — only an ads expense names a
// shop (an-expense-names-a-shop-only-for-ads), so Toko Sinar's days lose their shop filter, and the toast says why.
export const AddingExpensesRemovesTheShopFilter: Story = {
  render: () => <AdsForSinar />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await expect(canvas.getByTestId("analytic-filter-shop")).toBeVisible();
    await expect(headline(canvas, "amount")).toBe(50_000);

    await userEvent.click(canvas.getByTestId("analytic-add-metric"));
    const menu = within(await canvas.findByTestId("analytic-metric-menu"));
    await userEvent.click(menu.getByTestId("analytic-category-expense"));
    await userEvent.click(menu.getByTestId("analytic-metric-metrics-expenses"));

    await waitFor(() => expect(canvas.queryByTestId("analytic-filter-shop")).toBeNull());
    await expect(canvas.getByTestId("analytic-chip-metrics-expenses")).toBeVisible();
    await waitFor(() => expect(headline(canvas, "amount")).toBeGreaterThan(50_000));
  },
};

// A WAREHOUSE TEAM'S EXPENSES SIT UNDER WAREHOUSE (the-expense-metrics-follow-the-decisions-already-made) — Gudang Pusat
// reads its own typed expenses, by Warehouse: one row, its payroll, rent and power, packing supplies; no ads, no Stock
// loss, none of Toko Melati's. By Seller it is no row — a warehouse is not a seller.
export const AWarehouseTeamsExpensesSitUnderWarehouse: Story = {
  render: () => <ExpensesByWarehouse />,
  beforeEach: [asTeam(11n)],
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(rowKeys(canvas)).toEqual(["11"]);
    await waitFor(() => expect(canvas.getByTestId("analytic-row-11")).toHaveTextContent("Gudang Pusat"));
    await expect(cell(canvas, "11", "ads")).toBe(0);
    await expect(cell(canvas, "11", "payroll")).toBe(6_000_000);
    await expect(cell(canvas, "11", "operational")).toBeGreaterThan(3_600_000 - 1);
    await expect(cell(canvas, "11", "other")).toBeGreaterThan(0);
    await expect(cell(canvas, "11", "total")).toBe(sum(EXPENSE_KIND_FIELDS.map((f) => cell(canvas, "11", f))));
    await expect(headline(canvas, "total")).toBe(cell(canvas, "11", "total"));
    await expect(canvas.getByTestId("analytic-rows-line")).toHaveTextContent("warehouses");
    await noStockLoss(canvas);

    await groupBy(canvas, "team");
    await waitFor(() => expect(canvas.getByTestId("analytic-table-empty")).toBeVisible());
    await expect(canvas.getByTestId("analytic-chip-metrics-expenses")).toBeVisible();
  },
};

// ROOT READS EVERY TEAM'S — by Seller, Toko Melati and Toko Kenanga side by side; by Warehouse, Gudang Pusat. A team
// reading the same table sees its own only (ExpensesByKindMonthly, AWarehouseTeamsExpensesSitUnderWarehouse).
export const RootReadsEveryTeamsExpenses: Story = {
  render: () => <ExpensesBySeller />,
  beforeEach: [asTeam(ROOT_TEAM_ID), asPlatformOnly(Role.ROOT)],
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(rowKeys(canvas)).toEqual(["12", "13"]);
    await waitFor(() => expect(canvas.getByTestId("analytic-row-12")).toHaveTextContent("Toko Melati"));
    await waitFor(() => expect(canvas.getByTestId("analytic-row-13")).toHaveTextContent("Toko Kenanga"));
    await expect(cell(canvas, "13", "total")).toBe(5_500_000);
    await expect(cell(canvas, "13", "ads")).toBe(0);

    // THE HEADLINE EQUALS THE ROWS (the-expense-prototype-is-accepted): by Seller, the two sellers' — Gudang Pusat's own
    // expenses, which no Seller row shows, are not in it. The table's group reached the wire as `rowsGroup`.
    await waitFor(() => expect(headline(canvas, "total")).toBe(sum(column(canvas, "total"))));
    await expect(expenseMetricCalls.some((c) => c.groupBy === GroupType.SUMMARY && c.rowsGroup === GroupType.TEAM)).toBe(true);

    await groupBy(canvas, "warehouse");
    await waitFor(() => expect(rowKeys(canvas)).toEqual(["11"]));
    await waitFor(() => expect(canvas.getByTestId("analytic-row-11")).toHaveTextContent("Gudang Pusat"));
    await expect(cell(canvas, "11", "payroll")).toBe(6_000_000);
    // By Warehouse, the headline is the warehouse's.
    await waitFor(() => expect(headline(canvas, "total")).toBe(cell(canvas, "11", "total")));
  },
};

// UNGROUPED, THE HEADLINE IS EVERYTHING ROOT CAN SEE — by month, October's row and the headline hold the sellers' AND
// Gudang Pusat's expenses: more than the two sellers' alone. No table group narrows a time table's headline.
export const RootsHeadlineByTimeIsEveryTeams: Story = {
  render: () => <ExpensesOctoberMonthly />,
  beforeEach: [asTeam(ROOT_TEAM_ID), asPlatformOnly(Role.ROOT)],
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(rowKeys(canvas)).toEqual(["2026-10-01"]);
    await expect(headline(canvas, "total")).toBe(cell(canvas, "2026-10-01", "total"));
    // Toko Kenanga's 5.500.000 and Gudang Pusat's payroll are both in it, beside Toko Melati's own.
    await expect(cell(canvas, "2026-10-01", "payroll")).toBe(7_500_000 + 4_000_000 + 6_000_000);
    await expect(expenseMetricCalls.some((c) => c.groupBy === GroupType.SUMMARY && c.rowsGroup === GroupType.MONTHLY)).toBe(true);
  },
};

// EVERY MEMBER READS ITS TEAM'S, CS INCLUDED (every-member-reads-every-metric-of-their-team) — a Toko Melati CS reads the
// same Expenses as its owner, payroll included.
export const ACsReadsItsTeamsExpenses: Story = {
  render: () => <ExpensesMonthly />,
  beforeEach: [asRole(Role.SELLING_CS)],
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(rowKeys(canvas)).toEqual(["2026-10-01", "2026-09-01", "2026-08-01"]);
    for (const month of rowKeys(canvas)) await expect(cell(canvas, month, "payroll")).toBe(7_500_000);
    await expect(headline(canvas, "total")).toBe(sum(column(canvas, "total")));
  },
};

// ON A PHONE — Ads expense by shop: each shop a block with its spend.
export const Mobile: Story = {
  render: () => <AdsByShop />,
  globals: { viewport: { value: "mobile2" } },
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(within(canvas.getByTestId("analytic-table")).queryAllByRole("columnheader")).toHaveLength(0);
    await expect(canvas.getByTestId("analytic-row-11")).toHaveTextContent("Toko Maryam");
    await expect(canvas.getByTestId("analytic-row-11")).toHaveTextContent("Ads spend");
  },
};

// ON A PHONE — Expenses by month: each month a block of its figures — the kinds, the total, every type — no Stock loss.
export const MobileExpensesByKind: Story = {
  render: () => <ExpensesMonthly />,
  globals: { viewport: { value: "mobile2" } },
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(within(canvas.getByTestId("analytic-table")).queryAllByRole("columnheader")).toHaveLength(0);
    const october = canvas.getByTestId("analytic-row-2026-10-01");
    for (const label of KIND_LABELS) await expect(october).toHaveTextContent(label);
    // …and every type in Biaya's words, each a line of the block (backlog #107).
    for (const label of TYPE_WORDS) await expect(october).toHaveTextContent(label);
    await expect(october).not.toHaveTextContent("Stock loss");
  },
};

// THE LIVE PICKER SERVES THEM — the catalogue is METRICS with no prototype on, and Expense's two leaves are read off
// expense_service's messages: Ads expense's one field `amount` (Ads spend), Expenses' four kinds and the total, the
// decided filters and groups. The old samples' `ads_spend` / `expense_total` are gone.
export const TheLivePickerServesThem: Story = {
  render: () => <Nothing />,
  play: async ({ canvasElement }) => {
    await expect(catalogueMetrics()).toBe(METRICS);
    await expect(metricById(ADS)).toBe(EXPENSE_METRICS[0]);
    await expect(metricById(ADS)?.schema).toBe(AdsExpenseMetricSchema);
    await expect(metricById(EXPENSES)?.schema).toBe(ExpensesMetricSchema);
    await expect(metricById(ADS)?.service).toBe("expense");
    await expect(METRICS.flatMap((m) => m.fields.map((f) => f.name))).not.toContain("ads_spend");
    await expect(METRICS.flatMap((m) => m.fields.map((f) => f.name))).not.toContain("expense_total");

    const canvas = within(canvasElement);
    await waitFor(() => expect(canvas.getByTestId("analytic-empty")).toBeVisible(), { timeout: 4000 });
    await userEvent.click(canvas.getByTestId("analytic-add-metric"));
    const menu = within(await canvas.findByTestId("analytic-metric-menu"));
    await userEvent.click(menu.getByTestId("analytic-category-expense"));
    await userEvent.click(menu.getByTestId("analytic-metric-metrics-ads"));
    await waitFor(() => expect(canvas.getByTestId("analytic-sort-amount")).toHaveTextContent("Ads spend"));
    await expect(canvas.queryByTestId("analytic-sort-ads_spend")).toBeNull();
  },
};
