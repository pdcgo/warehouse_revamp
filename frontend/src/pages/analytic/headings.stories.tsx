import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, waitFor, within } from "storybook/test";

import { expenseMetricCalls, expensePersonCalls } from "../../../.storybook/expenseAnalyticStub";
import { asTeam, besideTheOpenSidebar, routedPage } from "../../../.storybook/pageStory";
import { EXPENSE_KIND_FIELDS, EXPENSE_TYPE_FIELDS, METRICS, type MetricDef } from "../../features/analytic/catalogue";
import type { ReportSort } from "../../features/analytic/provider";
import i18n from "../../i18n/config";
import { ReportTable } from "./components/ReportTable";
import { AnalyticPage } from "./index";

// THE TABLE'S HEADINGS ARE AT MOST TWO LINES (one-context-per-column-and-never-three-lines: *"1 line lebih dari 2
// baris"*), at 1440 beside the open sidebar, in English and Indonesian. Expenses heads its type columns with Biaya's
// words (backlog #107) — *Konten · endorse*, *Selisih · transaksi tak tercatat* — and a narrow column wrapped them to
// three lines, the middle dot alone on the second (*Konten / · / endorse*). The table now keeps the dot with the word
// before it and lets a heading break at ONE place only, so a column is never narrower than the heading's longer half.
//
// Each heading's lines are measured as its words' height over their line height. Expenses is read on the page, by day
// (the narrowest figures — many Rp 0); every other metric on one table of EVERY live metric's columns with no figures
// (each cell "—"), each column as narrow as the table can make it: what holds there holds for any pick of metrics.

const EXPENSES = "metrics/expenses";
const ExpensesDaily = routedPage(
  [{ path: "/analytic", element: <AnalyticPage /> }],
  `/analytic?g=daily&m=${EXPENSES}&r=2026-10-01..2026-10-10`,
);

const AT_1440 = { viewport: { value: "desktop1440" } };

const meta = {
  title: "Pages/Analytic/Headings",
  component: ExpensesDaily,
  parameters: { dataRouter: true, signedIn: true },
  decorators: [besideTheOpenSidebar],
  globals: AT_1440,
  beforeEach: [
    asTeam(12n),
    () => {
      expenseMetricCalls.length = 0;
      expensePersonCalls.length = 0;
    },
  ],
} satisfies Meta<typeof ExpensesDaily>;

export default meta;
type Story = StoryObj<typeof meta>;

interface HeadingLines {
  label: string;
  lines: number;
  /** The middle dot sits on the line of the word before it (or the heading has none). */
  dotKept: boolean;
}

/** A heading's own words — the text beside a sort heading's arrow, or the plain heading's. */
function wordsOf(th: HTMLElement): Text {
  const holder = th.querySelector("button") ?? th;
  const text = [...holder.childNodes].find((n): n is Text => n instanceof Text && n.data.trim() !== "");
  if (!text) throw new Error(`a heading with no words: ${th.outerHTML.slice(0, 120)}`);

  return text;
}

/** Every heading of the table: its words' height over their line height, and whether a `·` kept its word. */
function headingLines(table: HTMLElement): HeadingLines[] {
  return [...table.querySelectorAll<HTMLElement>("th")].map((th) => {
    const text = wordsOf(th);
    const range = document.createRange();
    range.selectNodeContents(text);
    const lineHeight = parseFloat(getComputedStyle(text.parentElement!).lineHeight);
    const lines = Math.round(range.getBoundingClientRect().height / lineHeight);

    // The dot's own box against the last letter before it: one line, or the dot was pushed off its word.
    const dot = text.data.indexOf("·");
    let dotKept = true;
    if (dot > 1) {
      const at = (i: number) => {
        const r = document.createRange();
        r.setStart(text, i);
        r.setEnd(text, i + 1);
        return r.getBoundingClientRect().top;
      };
      dotKept = Math.abs(at(dot) - at(dot - 2)) < lineHeight / 2;
    }

    return { label: text.data.replace(/\s+/g, " ").trim(), lines, dotKept };
  });
}

/** At most two lines each, no dot pushed off its word — the tallest printed for the record. */
async function atMostTwoLines(table: HTMLElement, expected: number) {
  const measured = headingLines(table);
  const tallest = Math.max(...measured.map((h) => h.lines));
  const wrapped = JSON.stringify(measured.filter((h) => h.lines > 1));
  console.log(`HEADINGS ${document.documentElement.lang || "?"} tallest=${tallest}`, wrapped);

  await expect(measured).toHaveLength(expected);
  for (const h of measured) await expect(h.lines).toBeGreaterThanOrEqual(1);
  await expect(measured.filter((h) => h.lines > 2).map((h) => `${h.label}: ${h.lines} lines`)).toEqual([]);
  await expect(measured.filter((h) => !h.dotKept).map((h) => h.label)).toEqual([]);

  return measured;
}

async function expensesTable(canvasElement: HTMLElement) {
  const canvas = within(canvasElement);
  await waitFor(() => expect(canvas.getAllByTestId(/^analytic-row-/).length).toBeGreaterThan(0), { timeout: 4000 });
  await expect(window.innerWidth).toBe(1440);

  return canvas.getByTestId("analytic-table");
}

/** The period, the four kinds, the total and the eighteen types. */
const EXPENSES_HEADINGS = 1 + EXPENSE_KIND_FIELDS.length + 1 + EXPENSE_TYPE_FIELDS.length;

export const ExpensesInEnglish: Story = {
  name: "Expenses · at most two lines · English",
  play: async ({ canvasElement }) => {
    const measured = await atMostTwoLines(await expensesTable(canvasElement), EXPENSES_HEADINGS);
    // The narrow columns do wrap — the two-line rule is what is being read, not a table wide enough to need none.
    await expect(measured.some((h) => h.lines === 2)).toBe(true);
  },
};

export const ExpensesInIndonesian: Story = {
  name: "Expenses · at most two lines · Indonesian",
  globals: { ...AT_1440, locale: "id" },
  play: async ({ canvasElement }) => {
    const measured = await atMostTwoLines(await expensesTable(canvasElement), EXPENSES_HEADINGS);
    await expect(measured.find((h) => h.label === "Konten · endorse")?.lines).toBe(2);
  },
};

// EVERY LIVE METRIC on one table, no figures: each column as narrow as its heading allows. Sorted by the longest type
// heading, so the bold one is measured too.
const KEYS = ["2026-10-01", "2026-10-02"];
const COLUMNS = METRICS.reduce((n, def) => n + def.fields.length, 0);
const BY_DISCREPANCY: ReportSort = { by: "field", metricId: EXPENSES, field: "discrepancy", dir: "desc" };

function EveryMetricTable({ defs = METRICS }: { defs?: MetricDef[] }) {
  const [sort, setSort] = useState<ReportSort | null>(BY_DISCREPANCY);

  return (
    <ReportTable
      groupBy="daily"
      keys={KEYS}
      defs={defs}
      cells={{}}
      sort={sort}
      onSortChange={setSort}
      labelOf={(key) => key}
    />
  );
}

async function everyMetric(canvasElement: HTMLElement, extra = 0) {
  const canvas = within(canvasElement);
  const table = await canvas.findByTestId("analytic-table");
  await expect(window.innerWidth).toBe(1440);
  await expect(COLUMNS).toBeGreaterThan(80);

  return atMostTwoLines(table, 1 + COLUMNS + extra);
}

export const EveryMetricInEnglish: Story = {
  name: "Every metric · at most two lines · English",
  render: () => <EveryMetricTable />,
  play: async ({ canvasElement }) => {
    await everyMetric(canvasElement);
  },
};

export const EveryMetricInIndonesian: Story = {
  name: "Every metric · at most two lines · Indonesian",
  render: () => <EveryMetricTable />,
  globals: { ...AT_1440, locale: "id" },
  play: async ({ canvasElement }) => {
    await everyMetric(canvasElement);
  },
};

// A DOT KEEPS ITS WORD WHEREVER THE ONE BREAK FALLS. No heading today has a long word before its dot and a short pair
// after it, where the most even break is BEFORE the dot (*Perlengkapan / · alat kecil*) — so this story brings its own
// copy for one, under a metric of its own (never in the app's locales: a type no screen has), on the every-metric table
// so its column is as narrow as it gets: *Perlengkapan ·* / *alat kecil*.
const EXAMPLE: MetricDef = {
  metricId: "metrics/headings-example",
  labelKey: "headingsExample",
  service: "story",
  category: "expense",
  supportedFilters: [],
  requiredFilters: [],
  supportedGroupBy: ["daily"],
  fields: [{ name: "kit", kind: "money", canSort: true, warehouseHidden: false }],
};
const EXAMPLE_WORDS = "Perlengkapan · alat kecil";
const EXAMPLE_COPY = { analytic: { fieldOf: { headingsExample: { kit: EXAMPLE_WORDS } } } };
i18n.addResourceBundle("en", "translation", EXAMPLE_COPY, true, false);

export const ADotKeepsItsWord: Story = {
  name: "A dot keeps its word wherever the break falls",
  render: () => <EveryMetricTable defs={[...METRICS, EXAMPLE]} />,
  play: async ({ canvasElement }) => {
    const measured = await everyMetric(canvasElement, 1);
    await expect(measured.at(-1)).toEqual({ label: EXAMPLE_WORDS, lines: 2, dotKept: true });
  },
};
