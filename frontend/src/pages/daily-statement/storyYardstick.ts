import { expect, userEvent, waitFor, within } from "storybook/test";

import { dayKey, expenseDays, liabilityDays, teams } from "../../../.storybook/fixtures";
import { ExpenseKind } from "../../gen/warehouse/expense/v1/expense_pb";
import { formatRupiah } from "../../lib/money";
import { bucketOf, bucketSpine, type PeriodGrain } from "../../lib/period";

// THE STATEMENT'S YARDSTICK, shared by the page's grain stories (`GrainOnTheServer`, `PerGrainSpan`) — not a story file.
//
// The screen sends the grain and lays the server's rows on its spine; the stub groups the way the server does (one row
// per bucket, keyed by its first day). What a reader sees must equal the fixture's days summed by the bucket's
// `yyyy-mm` / `yyyy` prefix — the rollup the browser used to do — cell by cell. The server's own equality is pinned by
// the Go tests (`…AMonthsAndAYearsRowAreTheSumOfTheirDays`).

export const WAREHOUSE = teams[0]!; // Gudang Pusat (11)

export type Canvas = ReturnType<typeof within>;
export interface Window {
  from: string;
  to: string;
}

interface Expected {
  fees: number;
  cod: number;
  stockLoss: number;
  other: number;
}

// Every fixture day of the warehouse inside the window, summed by its bucket's prefix.
export function yardstick({ from, to }: Window, grain: PeriodGrain): Map<string, Expected> {
  const inWindow = (day: string) => day >= from && day <= to;
  const out = new Map<string, Expected>();
  const at = (day: string) => {
    const bucket = bucketOf(day, grain);
    const held = out.get(bucket) ?? { fees: 0, cod: 0, stockLoss: 0, other: 0 };
    out.set(bucket, held);

    return held;
  };

  for (const d of liabilityDays.filter((d) => d.teamId === WAREHOUSE.id)) {
    const day = dayKey(d.ago);
    if (!inWindow(day)) continue;

    at(day).fees += d.handlingFee;
    at(day).cod += d.codFee;
  }

  for (const d of expenseDays.filter((d) => d.teamId === WAREHOUSE.id)) {
    const day = dayKey(d.ago);
    if (!inWindow(day)) continue;

    const stockLoss = d.byKind[ExpenseKind.STOCK_LOSS] ?? 0;
    const total = Object.values(d.byKind).reduce((a, b) => a + b, 0);
    at(day).stockLoss += stockLoss;
    at(day).other += total - stockLoss;
  }

  return out;
}

// A cell as StatementTable writes it: zero is an em dash.
const cell = (amount: number) => (amount === 0 ? "—" : formatRupiah(amount));

// Every row of the window at the grain, cell by cell against the yardstick — fees, courier COD, stock loss, other
// expenses, profit, running — and the footer.
export async function expectTheYardstick(canvas: Canvas, window: Window, grain: PeriodGrain) {
  const expected = yardstick(window, grain);
  let running = 0;

  const spine = bucketSpine(window.from, window.to, grain);
  await waitFor(() => expect(canvas.getAllByTestId(/^statement-row-/)).toHaveLength(spine.length));

  for (const bucket of spine) {
    const e = expected.get(bucket) ?? { fees: 0, cod: 0, stockLoss: 0, other: 0 };
    const profit = e.fees - e.stockLoss - e.other;
    running += profit;

    const cells = within(canvas.getByTestId(`statement-row-${bucket}`))
      .getAllByRole("cell")
      .map((td) => td.textContent ?? "");

    await expect(cells.slice(1)).toEqual([
      cell(e.fees),
      cell(e.cod),
      cell(e.stockLoss),
      cell(e.other),
      cell(profit),
      formatRupiah(running),
    ]);
  }

  // The footer is the servers' period totals — the same number at every grain.
  await expect(canvas.getByTestId("statement-footer-profit")).toHaveTextContent(formatRupiah(running));

  return expected;
}

export async function loaded(canvasElement: HTMLElement): Promise<Canvas> {
  const canvas = within(canvasElement);

  await waitFor(() => expect(canvas.getByTestId("statement-table")).toBeInTheDocument(), { timeout: 3000 });

  return canvas;
}

// Switch the grain and wait for the table to be rebuilt at it over the window on screen — every bucket of the spine,
// the last one included (the previous grain's rows stay while the next load, and a row COUNT alone can match across
// grains: one month and one year).
export async function pickGrain(canvas: Canvas, grain: PeriodGrain, window: Window) {
  const spine = bucketSpine(window.from, window.to, grain);

  await userEvent.click(canvas.getByTestId(`statement-grain-${grain}`));
  await waitFor(() => {
    expect(canvas.getByTestId(`statement-row-${spine[spine.length - 1]}`)).toBeInTheDocument();
    expect(canvas.getAllByTestId(/^statement-row-/)).toHaveLength(spine.length);
  });
}

// A CLOCK HELD at one instant — ticking on from it, so nothing waiting on time stalls — for a story whose windows are
// written as dates. The page, the stub and the fixtures (`dayKey`) all read Jakarta's today through `Date`, so they move
// together. A story's `beforeEach`; the cleanup puts the real clock back.
export function holdTheClock(at: string) {
  return () => {
    const Real = Date;
    const offset = Real.parse(at) - Real.now();

    class Held extends Real {
      constructor(...args: unknown[]) {
        if (args.length === 0) super(Real.now() + offset);
        else super(...(args as [string | number | Date]));
      }

      static now() {
        return Real.now() + offset;
      }
    }
    globalThis.Date = Held as DateConstructor;

    return () => {
      globalThis.Date = Real;
    };
  };
}

// Days planted for one story file and taken out again — the page's other stories read the fixtures as they were.
export function plantDays(fees: typeof liabilityDays, expenses: typeof expenseDays) {
  return () => {
    liabilityDays.push(...fees);
    expenseDays.push(...expenses);

    return () => {
      liabilityDays.splice(liabilityDays.length - fees.length, fees.length);
      expenseDays.splice(expenseDays.length - expenses.length, expenses.length);
    };
  };
}
