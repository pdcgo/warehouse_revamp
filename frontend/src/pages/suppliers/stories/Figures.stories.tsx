import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { supplierGoodsCalls, supplierListBandCalls } from "../../../../.storybook/supplierGoodsStub";
import { SupplierGoodsGroup } from "../../../gen/warehouse/inventory/v1/inventory_pb";
import { SUPPLIERS_META, SINAR, SUMBER, loaded, rowIds, rowNames } from "./kit";

// SUPPLIERS — Sold and Ready (the-supplier-list-shows-sales-and-ready-stock) — the columns, real, and their
// range filters (supplier-figures-filter-by-range-pills, the-figure-filters-are-two-panels). The page's stories are
// grouped by the part of the screen they are about (stories-are-grouped-by-the-part-of-the-screen); what they share
// is ./kit.tsx.

const meta = {
  title: "Pages/Suppliers/Suppliers/Figures",
  ...SUPPLIERS_META,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

// SALES AND READY STOCK ARE ON THE LIST, REAL — two figure columns, unmarked since 2026-11-07 (InventoryService.
// SupplierGoods, every team's goods from the supplier); every unit sold with the last order under it, every unit ready
// with the last restock under it (sales-are-all-time-with-their-last-dates); a supplier none of whose goods ever arrived
// has nothing to count, so a dash. One read for the whole page.
export const SalesAndReadyStockAreReal: Story = {
  name: "Sold and Ready, real",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const table = canvas.getByTestId("suppliers-table");

    const sold = within(table).getByRole("columnheader", { name: /^Sold/ });
    const ready = within(table).getByRole("columnheader", { name: /^Ready/ });
    await expect(within(sold).queryByTestId("not-implemented-sold")).toBeNull();
    await expect(within(ready).queryByTestId("not-implemented-ready")).toBeNull();

    // Sumber's three stores: 1.204 + 303 + 0 sold, the last yesterday; 86 + 25 + 40 ready.
    await waitFor(() =>
      expect(canvas.getByTestId(`supplier-sold-${SUMBER.id}`)).toHaveTextContent(/^1\.507ordered \w+ \d+, \d{4}$/),
    );
    await expect(canvas.getByTestId(`supplier-ready-${SUMBER.id}`)).toHaveTextContent(/^151restocked \w+ \d+, \d{4}$/);
    const goods = supplierGoodsCalls.filter((c) => c.group === SupplierGoodsGroup.SUPPLIER);
    await expect(goods.at(-1)?.supplierIds.map(String).sort()).toEqual(rowIds(canvas));
    await expect(canvas.getByTestId(`supplier-sold-${SINAR.id}`)).toHaveTextContent("—");
    await expect(canvas.getByTestId(`supplier-ready-${SINAR.id}`)).toHaveTextContent("—");
  },
};

// …and on a phone, a line each under the stores.
export const APhoneBlockCarriesItsFigures: Story = {
  name: "Phone · a line each",
  globals: { viewport: { value: "mobile2" } },
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const line = await canvas.findByTestId(`supplier-row-${SUMBER.id}-figures`);
    await waitFor(() => expect(line).toHaveTextContent(/Sold 1\.507 · ordered .+Ready 151 · restocked /));
    await expect(within(line).queryByTestId("not-implemented-sold")).toBeNull();
    await expect(canvas.queryByTestId(`supplier-row-${SINAR.id}-figures`)).toBeNull();
  },
};

// SOLD AND READY FILTER BY RANGE PILLS, A PANEL EACH — a trigger per figure, unmarked since the bands became a fixed set
// (the-range-pills-are-a-fixed-set); its panel narrow, the pills wrapping under one another, All first. A pick closes the
// panel, the trigger reads the band in the main tone, and the SERVER narrows the list by it: Terjual 1.000–2.500 is PT
// Sumber Makmur alone (1.507 sold), the band sent as min 1.000, max 2.500. Clear takes both back.
export const TheFiguresFilterIsRangePills: Story = {
  name: "Range pills",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(within(canvas.getByTestId("supplier-range-sold")).queryByTestId("not-implemented-soldRange")).toBeNull();
    await expect(within(canvas.getByTestId("supplier-range-ready")).queryByTestId("not-implemented-readyRange")).toBeNull();

    const soldTrigger = canvas.getByTestId("supplier-range-sold-trigger");
    await expect(soldTrigger).toHaveTextContent(/^Sold$/);
    await userEvent.click(soldTrigger);
    const panel = await screen.findByTestId("supplier-range-sold-panel");
    await waitFor(() => expect(panel).toBeVisible());
    // Its own panel — Ready's stays shut — and narrow.
    await expect(screen.queryByTestId("supplier-range-ready-panel")).not.toBeVisible();
    await expect(panel.getBoundingClientRect().width).toBeLessThanOrEqual(320);
    await expect(within(panel).getAllByRole("button").map((b) => b.textContent)).toEqual([
      "All",
      "< 500",
      "500–1.000",
      "1.000–2.500",
      "2.500–5.000",
      "≥ 5.000",
    ]);
    await expect(within(panel).getByRole("button", { name: "All" })).toHaveAttribute("aria-pressed", "true");

    await userEvent.click(within(panel).getByRole("button", { name: "1.000–2.500" }));
    await waitFor(() => expect(panel).not.toBeVisible());
    await expect(soldTrigger).toHaveTextContent("Sold: 1.000–2.500");
    // Narrowed on the server: the band went with the list's question, and only Sumber is in it.
    await waitFor(() => expect(rowNames(canvas)).toEqual(["PT Sumber Makmur"]));
    await expect(supplierListBandCalls.at(-1)?.sold).toEqual({ min: 1000n, max: 2500n });

    await userEvent.click(canvas.getByTestId("suppliers-filter-clear"));
    await waitFor(() => expect(soldTrigger).toHaveTextContent(/^Sold$/));
    await waitFor(() => expect(rowNames(canvas)).toHaveLength(4));
    await expect(supplierListBandCalls.at(-1)?.sold).toBeUndefined();
  },
};

// …and on a phone each stands in the Filter sheet as a label over its pills — no panel inside a panel.
export const APhoneFiltersByRangeInTheSheet: Story = {
  name: "Phone · ranges in the sheet",
  globals: { viewport: { value: "mobile2" } },
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(canvas.queryByTestId("supplier-range-sold-trigger")).toBeNull();
    await userEvent.click(canvas.getByTestId("suppliers-filter-open"));
    const sheet = await screen.findByTestId("suppliers-filter-sheet");
    await waitFor(() => expect(sheet).toBeVisible());

    const sold = within(sheet).getByTestId("supplier-range-sold");
    await expect(within(sheet).getByTestId("supplier-range-ready")).toBeVisible();
    await userEvent.click(within(sold).getByRole("button", { name: "≥ 5.000" }));
    await expect(within(sheet).getByTestId("suppliers-filter-clear")).toBeVisible();
  },
};
