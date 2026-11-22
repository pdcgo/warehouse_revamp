import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, waitFor, within } from "storybook/test";

import { pickTeam } from "../../../../.storybook/pageStory";
import { productDailyCalls } from "../../../../.storybook/productListScenario";
import { PRODUCT_DETAIL_META, loaded, openTab } from "./kit";

// PRODUCT DETAIL — the Keluar Masuk Harian tab of the warehouse card (the-warehouse-zone-is-tabs: *"the last fourteen
// days: date, in, out, on hand"*) — REAL since 2026-11-21 (InventoryService.ProductDailyMoves), in the picker's warehouse
// (the-warehouse-picker-splits-the-page). The stub folds 700's stock history per Jakarta day of its clock (8 Oct 2026 is
// today) as the server folds the stock changes (productStub.ts `productDailyMoves`):
//
//   5 days ago   Gudang Cabang  +40 restocked (batch 7002)        Sisa 70 that evening (30 before)
//   3 days ago   Gudang Cabang  −15 picked                        55
//   1 day ago    Gudang Pusat   +24 restocked (batch 7003)        79 — today's, the Overview's Siap
//
// ⚠ Which movements are Masuk and which Keluar is the owner's open question (HELD); these stories pin option A, every
// movement by its direction — the Q2 pictures are ./DailyQ2.stories.tsx.

const meta = {
  title: "Pages/Products/ProductDetail/Daily",
  ...PRODUCT_DETAIL_META,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

/** The figure in a cell — "+40 pcs" / "−15 pcs" / "79 pcs" / "—" (0). */
const figure = (el: HTMLElement) => Number((el.textContent ?? "").replace(/[^\d]/g, "") || "0");

/** The tab's own queries (a `within`). */
type Scope = { getAllByTestId: (id: RegExp) => HTMLElement[]; getByTestId: (id: string) => HTMLElement };

type Day = { day: string; in: number; out: number; onHand: number };

/** Every row's figures, today first, read off the table. */
function daysOf(tab: Scope): Day[] {
  return tab.getAllByTestId(/^pd-daily-row-\d+$/).map((row: HTMLElement, i: number) => ({
    day: row.dataset.day ?? "",
    in: figure(tab.getByTestId(`pd-daily-in-${i}`)),
    out: figure(tab.getByTestId(`pd-daily-out-${i}`)),
    onHand: figure(tab.getByTestId(`pd-daily-balance-${i}`)),
  }));
}

/** EVERY DAY ADDS UP — Sisa kemarin + Masuk − Keluar = Sisa, walking from the oldest day to today. */
async function expectTheDaysAddUp(days: Day[]) {
  for (let i = days.length - 2; i >= 0; i--) {
    await expect(days[i + 1]!.onHand + days[i]!.in - days[i]!.out).toBe(days[i]!.onHand);
  }
}

/** THE LAST FOURTEEN DAYS, REAL: today first (8 Oct 2026 by the stub's clock), the four columns as decided (date, in,
 * out, on hand), no ⚠ on the tab. Today's Sisa is the Overview's Siap — 79 — read back day by day: the restock of 24
 * yesterday, the 15 picked three days ago, the 40 restocked five days ago, 30 before them. Every day adds up. The read
 * the tab asked: the owner (15) about 700, every warehouse. */
export const TheDaysAreReal: Story = {
  name: "Real days",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await expect(within(canvas.getByTestId("pd-tab-daily")).queryByTestId("not-implemented-daily")).toBeNull();

    const tab = await openTab(canvas, "daily");
    const table = await tab.findByTestId("pd-daily-table");
    await waitFor(() => expect(tab.getAllByTestId(/^pd-daily-row-\d+$/)).toHaveLength(14));
    await expect(productDailyCalls.at(-1)).toEqual({ teamId: 15n, productId: 700n, warehouseId: 0n });

    await expect(within(table).getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["Date", "In", "Out", "On hand"]);

    const days = daysOf(tab);
    await expect(days[0]!.day).toBe("2026-10-08");
    await expect(days[13]!.day).toBe("2026-09-25");
    await expect(days.map((d) => d.onHand)).toEqual([79, 79, 55, 55, 70, 70, 30, 30, 30, 30, 30, 30, 30, 30]);
    await expect(days[1]).toMatchObject({ in: 24, out: 0 });
    await expect(days[3]).toMatchObject({ in: 0, out: 15 });
    await expect(days[5]).toMatchObject({ in: 40, out: 0 });
    await expectTheDaysAddUp(days);

    // A day with no movement reads — in both columns; a figure reads in its tone and its unit.
    await expect(tab.getByTestId("pd-daily-in-0")).toHaveTextContent("—");
    await expect(tab.getByTestId("pd-daily-in-1")).toHaveTextContent("+24 pcs");
    await expect(tab.getByTestId("pd-daily-out-3")).toHaveTextContent("−15 pcs");
    await expect(tab.getByTestId("pd-daily-balance-0")).toHaveTextContent("79 pcs");
    await expect(table).not.toHaveTextContent("Rp");
  },
};

/** THE DAYS FOLLOW THE PICKER (the-warehouse-picker-splits-the-page): Gudang Cabang alone — asked of the server with that
 * warehouse, not cut on the screen — holds its 25 today, the 15 picked and the 40 it received, and nothing before. */
export const TheDaysFollowThePicker: Story = {
  name: "Days, in the lens",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const tab = await openTab(canvas, "daily");
    await waitFor(() => expect(tab.getByTestId("pd-daily-balance-0")).toHaveTextContent("79 pcs"));

    await pickTeam(canvas.getByTestId("pd-warehouse-filter"), "WH-02");
    await waitFor(() => expect(productDailyCalls.at(-1)?.warehouseId).toBe(14n));
    await waitFor(() => expect(tab.getByTestId("pd-daily-balance-0")).toHaveTextContent("25 pcs"));

    const days = daysOf(tab);
    await expect(days.map((d) => d.onHand)).toEqual([25, 25, 25, 25, 40, 40, 0, 0, 0, 0, 0, 0, 0, 0]);
    await expect(days[1]!.in).toBe(0); // yesterday's 24 went to Gudang Pusat
    await expectTheDaysAddUp(days);
  },
};

/** A PHONE READS EACH DAY AS A LINE — the date, then what came in, what went out and what was left. */
export const APhoneReadsEachDayAsALine: Story = {
  name: "Phone, a line a day",
  globals: { viewport: { value: "mobile2" } },
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const tab = await openTab(canvas, "daily");
    await waitFor(() => expect(tab.getAllByTestId(/^pd-daily-row-\d+$/)).toHaveLength(14));

    await expect(tab.getByTestId("pd-daily-table").tagName).not.toBe("TABLE");
    await expect(tab.getByTestId("pd-daily-in-1")).toHaveTextContent("+24");
    await expect(tab.getByTestId("pd-daily-out-3")).toHaveTextContent("−15");
    await expect(tab.getByTestId("pd-daily-balance-0")).toHaveTextContent("79 pcs");
    await expectTheDaysAddUp(daysOf(tab));
  },
};
