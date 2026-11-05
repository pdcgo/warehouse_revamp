import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { SUPPLIERS_META, SINAR, SUMBER, loaded, rowNames } from "./kit";

// SUPPLIERS — Sold and Ready (the-supplier-list-shows-sales-and-ready-stock) — the columns, marked sample, and their
// range filters (supplier-figures-filter-by-range-pills, the-figure-filters-are-two-panels). The page's stories are
// grouped by the part of the screen they are about (stories-are-grouped-by-the-part-of-the-screen); what they share
// is ./kit.tsx.

const meta = {
  title: "Pages/Suppliers/Suppliers/Figures",
  ...SUPPLIERS_META,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

// SALES AND READY STOCK ARE ON THE LIST, MARKED SAMPLE — two figure columns, each heading carrying its ⚠ number, the
// not-implemented strip naming both; every unit sold with the last order under it, every unit ready with the last
// restock under it (sales-are-all-time-with-their-last-dates); a supplier with no store has nothing to count, so a dash.
export const SalesAndReadyStockAreMarkedSample: Story = {
  name: "Sold and Ready, sample",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const table = canvas.getByTestId("suppliers-table");

    const sold = within(table).getByRole("columnheader", { name: /^Sold/ });
    const ready = within(table).getByRole("columnheader", { name: /^Ready/ });
    await expect(within(sold).getByTestId("not-implemented-sold")).toHaveTextContent("1");
    await expect(within(ready).getByTestId("not-implemented-ready")).toHaveTextContent("2");
    await expect(canvas.getByTestId("not-implemented-summary")).toBeVisible();

    await expect(canvas.getByTestId(`supplier-sold-${SUMBER.id}`)).toHaveTextContent(/^[\d.]+ordered \w+ \d+, \d{4}$/);
    await expect(canvas.getByTestId(`supplier-ready-${SUMBER.id}`)).toHaveTextContent(/^[\d.]+restocked \w+ \d+, \d{4}$/);
    await expect(canvas.getByTestId(`supplier-sold-${SINAR.id}`)).toHaveTextContent("—");
    await expect(canvas.getByTestId(`supplier-ready-${SINAR.id}`)).toHaveTextContent("—");
  },
};

// …and on a phone, a line each under the stores — with its mark.
export const APhoneBlockCarriesItsFigures: Story = {
  name: "Phone · a line each",
  globals: { viewport: { value: "mobile2" } },
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const line = canvas.getByTestId(`supplier-row-${SUMBER.id}-figures`);
    await expect(line).toHaveTextContent(/Sold [\d.]+ · ordered .+Ready [\d.]+ · restocked /);
    await expect(within(line).getByTestId("not-implemented-sold")).toBeInTheDocument();
    await expect(canvas.queryByTestId(`supplier-row-${SINAR.id}-figures`)).toBeNull();
  },
};

// SOLD AND READY FILTER BY RANGE PILLS, A PANEL EACH — a trigger per figure with its `dropped` mark beside it (3 and 4);
// its panel narrow, the pills wrapping under one another, All first. A pick closes the panel and the trigger then reads
// the band, in the main tone; the list does not move for it. Clear takes both back.
export const TheFiguresFilterIsRangePills: Story = {
  name: "Range pills",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    const soldFilter = canvas.getByTestId("supplier-range-sold");
    const readyFilter = canvas.getByTestId("supplier-range-ready");
    await expect(within(soldFilter).getByTestId("not-implemented-soldRange")).toHaveTextContent("3");
    await expect(within(readyFilter).getByTestId("not-implemented-readyRange")).toHaveTextContent("4");

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

    await userEvent.click(within(panel).getByRole("button", { name: "500–1.000" }));
    await waitFor(() => expect(panel).not.toBeVisible());
    await expect(soldTrigger).toHaveTextContent("Sold: 500–1.000");
    // Dropped: every row is still there.
    await expect(rowNames(canvas)).toHaveLength(4);

    await userEvent.click(canvas.getByTestId("suppliers-filter-clear"));
    await waitFor(() => expect(soldTrigger).toHaveTextContent(/^Sold$/));
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
