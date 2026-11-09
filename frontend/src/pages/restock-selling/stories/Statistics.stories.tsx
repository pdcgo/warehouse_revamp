import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { SELLING_META, digits, loaded, openStatistics } from "./kit";

// RESTOCK SELLING — the Statistik panel (the-restock-statistics-count-transactions-under-the-tabs) — shut until opened, per tab, its button. The page's stories are grouped by the part of the screen they are about
// (stories-are-grouped-by-the-part-of-the-screen); what they share is ./kit.tsx.

const meta = {
  title: "Pages/Inventory/Restock/RestockSelling/Statistics",
  ...SELLING_META,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

// SHUT UNTIL OPENED, UNDER THE TABS — opened on Semua Status, the total and a card per status, each led by how many
// transactions, the units and the value compact under it. Marked sample.
export const TheStatisticsAreShutThenCountTransactions: Story = {
  name: "Shut, then counted",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(canvas.queryByTestId("restock-summary")).toBeNull();
    await expect(canvas.getByTestId("not-implemented-summary")).toBeVisible();

    const summary = await openStatistics(canvas);
    await expect(within(summary).getByTestId("not-implemented-summary")).toBeInTheDocument();
    const total = within(summary).getByTestId("restock-summary-total");
    await expect(total).toHaveTextContent(/^Total\d+ transactions[\d,]+(rb)? pcs · Rp /);

    // The piles add up to the total.
    let sum = 0;
    for (const key of ["ongoing", "arrived", "accepted", "lost", "cancelled"]) {
      const pile = within(summary).getByTestId(`restock-summary-pile-${key}`);
      sum += Number(/(\d+) transactions?/.exec(pile.textContent ?? "")?.[1]);
    }
    await expect(Number(/(\d+) transactions/.exec(total.textContent ?? "")?.[1])).toBe(sum);
  },
};

// A STATUS TAB DRAWS THAT STATUS'S FIGURES — Transaksi · Jumlah barang · Jumlah kode produk · Nilai barang · Ongkir COD · Nilai
// transaksi — and Rincian › opens the value per paying account: the team's two operational accounts, a transfer and an
// e-wallet, adding up to the card.
export const AStatusTabShowsItsFiguresAndPayments: Story = {
  name: "Per tab, and payments",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await openStatistics(canvas);

    await userEvent.click(canvas.getByTestId("restock-tab-accepted"));
    const measures = await canvas.findByTestId("restock-summary-measures");
    // The cards are the strip's children — each card's own figure carries a `-value` id of its own.
    const labels = Array.from(measures.children).map((card) => (card as HTMLElement).dataset.testid);
    await expect(labels).toEqual([
      "restock-summary-measure-transactions",
      "restock-summary-measure-units",
      "restock-summary-measure-skus",
      "restock-summary-measure-goods",
      "restock-summary-measure-courier-charge",
      "restock-summary-measure-value",
    ]);
    await expect(within(measures).getByTestId("restock-summary-measure-courier-charge")).toHaveTextContent("Courier COD");

    await userEvent.click(within(measures).getByTestId("restock-summary-payments"));
    const dialog = await screen.findByTestId("restock-payments-dialog");
    await waitFor(() => expect(dialog).toBeVisible());
    const rows = await within(dialog).findAllByTestId(/^restock-payment-/);
    await expect(rows.map((row) => row.dataset.testid)).toEqual(["restock-payment-1301", "restock-payment-1303"]);
    await expect(rows[1]).toHaveTextContent("ShopeePay");
    const paid = rows.reduce((s, row) => s + digits(within(row).getByText(/^Rp /)), 0);
    const value = digits(within(within(measures).getByTestId("restock-summary-measure-value")).getByText(/^Rp /));
    await expect(paid).toBe(value);
  },
};

// THE STATISTIK BUTTON ENDS THE TAB ROW on a desktop (the-statistics-button-ends-the-tab-row) — no row of its own; it
// sits level with the tabs, at the row's right end.
export const TheStatisticsButtonEndsTheTabRow: Story = {
  name: "Button ends the tabs",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const toggle = canvas.getByTestId("restock-summary-toggle");
    const tabs = canvas.getByRole("tablist");

    await expect(toggle).toHaveTextContent("Statistics");
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    const row = tabs.getBoundingClientRect();
    const button = toggle.getBoundingClientRect();
    // Level with the tabs, and right of the last one.
    await expect(button.top).toBeGreaterThanOrEqual(row.top - 1);
    await expect(button.bottom).toBeLessThanOrEqual(row.bottom + 1);
    await expect(button.left).toBeGreaterThanOrEqual(canvas.getByTestId("restock-tab-cancelled").getBoundingClientRect().right);

    await userEvent.click(toggle);
    await canvas.findByTestId("restock-summary", {}, { timeout: 4000 });
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
  },
};

// …on a phone it is an icon beside Filter, in the search row — the six tabs already scroll sideways there. On the
// narrowest phone too: the search gives way, so the icon is never pushed off the screen.
export const OnAPhoneTheStatisticsButtonSitsBesideFilter: Story = {
  name: "Phone · beside Filter",
  globals: { viewport: { value: "mobile1" } },
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const toggle = canvas.getByTestId("restock-summary-toggle");

    await expect(canvas.getByTestId("restock-filter")).toContainElement(toggle);
    await expect(toggle.getBoundingClientRect().right).toBeLessThanOrEqual(window.innerWidth);
    await expect(toggle).toHaveAccessibleName("Statistics");
    await expect(canvas.getByRole("tablist")).not.toContainElement(toggle);

    await userEvent.click(toggle);
    await canvas.findByTestId("restock-summary", {}, { timeout: 4000 });
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
  },
};

// …on a phone the breakdown is a bottom sheet (a-breakdown-opens-from-rincian).
export const OnAPhoneThePaymentsAreASheet: Story = {
  name: "Phone · payments sheet",
  globals: { viewport: { value: "mobile2" } },
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await openStatistics(canvas);

    await userEvent.click(canvas.getByTestId("restock-tab-accepted"));
    const measures = await canvas.findByTestId("restock-summary-measures");
    await userEvent.click(within(measures).getByTestId("restock-summary-payments"));
    const sheet = await screen.findByTestId("restock-payments-sheet");
    await waitFor(() => expect(sheet).toBeVisible());
  },
};
