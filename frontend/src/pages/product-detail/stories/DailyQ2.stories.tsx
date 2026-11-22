import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, waitFor, within } from "storybook/test";

import { dailyMappingForStory, productDailyMovesForStory, type DailyFoldRow } from "../../../../.storybook/productStub";
import { StockChangeType } from "../../../gen/warehouse/inventory/v1/inventory_pb";
import i18n from "../../../i18n/config";
import { PRODUCT_DETAIL_META, loaded, openTab } from "./kit";

// THE OWNER'S Q2 — which movements are MASUK and which KELUAR on the Keluar Masuk Harian tab? ⚠ HELD: the build draws
// A until he answers. ONE table, ONE seeded day, three options — the pictures in accepts/q114/:
//
//   3 days ago, Gudang Pusat: 12 restocked · 1 returned · 5 picked · 1 lost at the count (opname −1) · 3 sent to Gudang
//   Cabang (still on the way). The other days: orders, and a restock of 20 eight days ago. Today's stock is 700's own, 79.
//
//   A (built)  every movement by its direction — Masuk 13, Keluar 9, and Sisa kemarin + Masuk − Keluar = Sisa
//   B (mock)   sales and purchases only — Masuk 12 (the restock), Keluar 5 (the orders); the rest not shown, so the day
//              does not add up — the stub answers as the server would with B's one-line mapping
//   C (mock)   A, with the kinds named under each figure — Restok 12 · Retur 1 — a layout change, drawn over A's table
//
// Only A is a live screen; B and C are MOCK stories, deleted when the owner picks.

const meta = {
  title: "Pages/Products/ProductDetail/DailyQ2",
  ...PRODUCT_DETAIL_META,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

const PUSAT = 11n;
const CABANG = 14n;

/** The seeded fortnight of 700 (every warehouse; today's stock 79 is its shelves'). */
const SEEDED: DailyFoldRow[] = [
  { daysAgo: 0, warehouseId: PUSAT, changeType: StockChangeType.ORDER, units: -2n },
  { daysAgo: 1, warehouseId: CABANG, changeType: StockChangeType.ORDER, units: -4n },
  // THE OWNER'S DAY.
  { daysAgo: 3, warehouseId: PUSAT, changeType: StockChangeType.RESTOCK, units: 12n },
  { daysAgo: 3, warehouseId: PUSAT, changeType: StockChangeType.RETURN, units: 1n },
  { daysAgo: 3, warehouseId: PUSAT, changeType: StockChangeType.ORDER, units: -5n },
  { daysAgo: 3, warehouseId: PUSAT, changeType: StockChangeType.LOST, units: -1n },
  { daysAgo: 3, warehouseId: PUSAT, changeType: StockChangeType.TRANSFER_OUT, units: -3n },
  { daysAgo: 5, warehouseId: PUSAT, changeType: StockChangeType.ORDER, units: -3n },
  { daysAgo: 8, warehouseId: CABANG, changeType: StockChangeType.RESTOCK, units: 20n },
  { daysAgo: 8, warehouseId: CABANG, changeType: StockChangeType.ORDER, units: -1n },
  { daysAgo: 10, warehouseId: PUSAT, changeType: StockChangeType.ORDER, units: -6n },
];

/** The owner's day — 3 days ago by the stub's clock (8 Oct 2026). */
const OWNER_DAY = 3;

function seed() {
  productDailyMovesForStory(700n, SEEDED);
}

async function openTheDays(canvasElement: HTMLElement) {
  const canvas = await loaded(canvasElement);
  const tab = await openTab(canvas, "daily");
  await waitFor(() => expect(tab.getAllByTestId(/^pd-daily-row-\d+$/)).toHaveLength(14));
  return { canvas, tab };
}

const figure = (el: HTMLElement) => Number((el.textContent ?? "").replace(/[^\d]/g, "") || "0");

/** **A (built)** — every movement by its direction: the owner's day reads Masuk 13 (12 + 1) and Keluar 9 (5 + 1 + 3),
 * Sisa 81 the evening before and 85 that evening — every day adds up. */
export const Q2OptionA: Story = {
  name: "Q2 · A — every movement (built)",
  beforeEach: seed,
  play: async ({ canvasElement }) => {
    const { tab } = await openTheDays(canvasElement);

    await expect(figure(tab.getByTestId(`pd-daily-in-${OWNER_DAY}`))).toBe(13);
    await expect(figure(tab.getByTestId(`pd-daily-out-${OWNER_DAY}`))).toBe(9);
    for (let i = 12; i >= 0; i--) {
      const before = figure(tab.getByTestId(`pd-daily-balance-${i + 1}`));
      await expect(before + figure(tab.getByTestId(`pd-daily-in-${i}`)) - figure(tab.getByTestId(`pd-daily-out-${i}`))).toBe(
        figure(tab.getByTestId(`pd-daily-balance-${i}`)),
      );
    }
  },
};

/** **B (mock)** — sales and purchases only: the owner's day reads Masuk 12 (the restock) and Keluar 5 (the orders); the
 * return, the count's loss and the transfer are not shown — so that day does not add up (Sisa moves by 4, the figures
 * say 7). The stub answers as the server would with B's mapping. */
export const Q2OptionBMock: Story = {
  name: "Q2 · B — sales and purchases only (mock)",
  beforeEach: () => {
    seed();
    dailyMappingForStory("B");
  },
  play: async ({ canvasElement }) => {
    const { tab } = await openTheDays(canvasElement);

    await expect(figure(tab.getByTestId(`pd-daily-in-${OWNER_DAY}`))).toBe(12);
    await expect(figure(tab.getByTestId(`pd-daily-out-${OWNER_DAY}`))).toBe(5);
    const before = figure(tab.getByTestId(`pd-daily-balance-${OWNER_DAY + 1}`));
    await expect(before + 12 - 5).not.toBe(figure(tab.getByTestId(`pd-daily-balance-${OWNER_DAY}`)));
  },
};

/** The kinds' names, in the screen's language — the ledger's words the stock screens already use. */
function kindLabel(kind: StockChangeType): string {
  const t = i18n.t.bind(i18n);
  switch (kind) {
    case StockChangeType.ORDER:
      return t("inventory.transaction.order");
    case StockChangeType.RESTOCK:
      return t("inventory.transaction.restock");
    case StockChangeType.RETURN:
      return t("inventory.transaction.return");
    case StockChangeType.TRANSFER_IN:
      return t("inventory.transaction.transferIn");
    case StockChangeType.TRANSFER_OUT:
      return t("inventory.transaction.transferOut");
    case StockChangeType.SAMPLE:
      return t("inventory.transaction.sample");
    case StockChangeType.LOST:
      return t("inventory.adjustReasonLost");
    case StockChangeType.BROKEN:
      return t("inventory.adjustReasonDamaged");
    case StockChangeType.FOUND:
      return t("inventory.adjustReasonFound");
    default:
      return t("inventory.transaction.adjustment");
  }
}

/** One day's kinds, by side: `in` the positive nets, `out` the negative — "Restok 12 · Retur 1". */
function kindLines(daysAgo: number) {
  const net = new Map<StockChangeType, bigint>();
  for (const r of SEEDED.filter((x) => x.daysAgo === daysAgo)) net.set(r.changeType, (net.get(r.changeType) ?? 0n) + r.units);
  const sorted = [...net].filter(([, u]) => u !== 0n).sort(([a], [b]) => a - b);
  const line = (rows: [StockChangeType, bigint][]) => rows.map(([k, u]) => `${kindLabel(k)} ${(u < 0n ? -u : u).toString()}`).join(" · ");
  return { in: line(sorted.filter(([, u]) => u > 0n)), out: line(sorted.filter(([, u]) => u < 0n)) };
}

/** Draw C over A's table: a small muted line under each figure naming its kinds (a mock — no live code draws it). */
function drawKinds(tab: ReturnType<typeof within>) {
  const rows = tab.getAllByTestId(/^pd-daily-row-\d+$/);
  const phone = tab.getByTestId("pd-daily-table").tagName !== "TABLE";
  rows.forEach((_: HTMLElement, i: number) => {
    const kinds = kindLines(i);
    const small = (text: string, testId: string) => {
      const el = document.createElement("div");
      el.textContent = text;
      el.dataset.testid = testId;
      el.style.cssText = "font-size:12px;line-height:16px;color:var(--chakra-colors-fg-muted);font-weight:normal;white-space:nowrap";
      return el;
    };
    if (phone) {
      const row = tab.getByTestId(`pd-daily-row-${i}`);
      const text = [kinds.in && `+ ${kinds.in}`, kinds.out && `− ${kinds.out}`].filter(Boolean).join("   ");
      if (!text) return;
      row.style.flexWrap = "wrap";
      const line = small(text, `q2c-kinds-${i}`);
      line.style.flexBasis = "100%";
      line.style.whiteSpace = "normal";
      line.style.textAlign = "end";
      row.appendChild(line);
      return;
    }
    if (kinds.in) tab.getByTestId(`pd-daily-in-${i}`).appendChild(small(kinds.in, `q2c-in-${i}`));
    if (kinds.out) tab.getByTestId(`pd-daily-out-${i}`).appendChild(small(kinds.out, `q2c-out-${i}`));
  });
}

/** **C (mock)** — A, with the kinds named under each figure: the owner's day reads Masuk 13 over *Restok 12 · Retur 1*
 * and Keluar 9 over *Pesanan 5 · Transfer keluar 3 · Hilang 1*. The figures are A's; the lines under them are drawn
 * by this story over the live table. */
export const Q2OptionCMock: Story = {
  name: "Q2 · C — the kinds named (mock)",
  beforeEach: seed,
  play: async ({ canvasElement }) => {
    const { tab } = await openTheDays(canvasElement);
    await waitFor(() => expect(figure(tab.getByTestId(`pd-daily-in-${OWNER_DAY}`))).toBe(13));

    drawKinds(tab);

    const owner = kindLines(OWNER_DAY);
    await expect(owner.in).toBe(`${kindLabel(StockChangeType.RESTOCK)} 12 · ${kindLabel(StockChangeType.RETURN)} 1`);
    await expect(owner.out).toBe(
      `${kindLabel(StockChangeType.ORDER)} 5 · ${kindLabel(StockChangeType.TRANSFER_OUT)} 3 · ${kindLabel(StockChangeType.LOST)} 1`,
    );
    if (tab.getByTestId("pd-daily-table").tagName === "TABLE") {
      await expect(tab.getByTestId(`q2c-in-${OWNER_DAY}`)).toHaveTextContent(owner.in);
      await expect(tab.getByTestId(`q2c-out-${OWNER_DAY}`)).toHaveTextContent(owner.out);
    }
  },
};
