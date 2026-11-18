import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { LocationProbe, routedPage } from "../../../../.storybook/pageStory";
import { restockReadScenario } from "../../../../.storybook/restockReadScenario";
import { restockPaidFromForStory } from "../../../../.storybook/restockStub";
import { RestockSellingPage } from "../index";
import { SELLING_META, digits, loaded, openStatistics } from "./kit";

// RESTOCK SELLING — the Statistik panel (the-restock-statistics-count-transactions-under-the-tabs) — shut until opened, per
// tab, its button, Rincian. The figures are the stub's RestockSellingStat over Toko Melati's (12) restocks — 501 ongoing,
// 502 arrived, 503 and 507 accepted, 504 lost, 505 cancelled — read through the list's own predicate. The page's stories
// are grouped by the part of the screen they are about (stories-are-grouped-by-the-part-of-the-screen); what they share
// is ./kit.tsx.

const meta = {
  title: "Pages/Inventory/Restock/RestockSelling/Statistics",
  ...SELLING_META,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

const pileTransactions = (el: HTMLElement) => Number(/(\d+) transactions?/.exec(el.textContent ?? "")?.[1]);

// SHUT UNTIL OPENED, AND UNREAD UNTIL THEN (the-statistics-are-shut-and-read-when-opened) — opened on Semua Status, the
// total and a card per status, each led by how many transactions, the units and the value compact under it. Real now:
// no mark on the cards, and the page's strip no longer lists them.
export const TheStatisticsAreShutThenCountTransactions: Story = {
  name: "Shut, then counted",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(canvas.queryByTestId("restock-summary")).toBeNull();
    // Nothing is read while shut.
    await expect(restockReadScenario.sellingStatCalls).toHaveLength(0);

    const summary = await openStatistics(canvas);
    await expect(restockReadScenario.sellingStatCalls.map((call) => call.teamId)).toEqual([12n]);
    await expect(summary.querySelector('[data-testid^="not-implemented-"]')).toBeNull();

    // Six restocks; 172 pieces ordered across their lines.
    const total = within(summary).getByTestId("restock-summary-total");
    await expect(total).toHaveTextContent(/^Total6 transactions172 pcs · Rp /);

    // The piles add up to the total.
    let sum = 0;
    for (const key of ["ongoing", "arrived", "accepted", "lost", "cancelled"]) {
      sum += pileTransactions(within(summary).getByTestId(`restock-summary-pile-${key}`));
    }
    await expect(pileTransactions(total)).toBe(sum);

    // The page's strip lists the cancel check alone — no longer the statistics, nor the export.
    await userEvent.click(canvas.getByTestId("not-implemented-toggle"));
    await canvas.findByTestId("pending-row-cancelReview");
    await expect(canvas.queryByTestId("pending-row-export")).toBeNull();
    await expect(canvas.queryByTestId("pending-row-summary")).toBeNull();
    await expect(canvas.queryByTestId("pending-row-payments")).toBeNull();
  },
};

// A STATUS TAB DRAWS THAT STATUS'S FIGURES — Transaksi · Jumlah barang · Jumlah kode produk · Nilai barang · Ongkir COD ·
// Nilai transaksi — from the same answer: the tab picks a pile, it reads nothing. Diterima is 503 and 507. Jumlah barang
// is the pieces ORDERED, 10 + 20 + 15 = 45, though 44 were counted in (jumlah-barang-counts-the-pieces-ordered); two
// different products; Ongkir COD is the warehouse's Rp 5.000, outside Nilai transaksi = goods + shipping.
export const AStatusTabShowsItsFigures: Story = {
  name: "Per tab",
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

    const figure = (id: string) => within(canvas.getByTestId("restock-summary-measures")).getByTestId(`restock-summary-measure-${id}-value`);
    await expect(figure("transactions")).toHaveTextContent("2");
    await expect(figure("units")).toHaveTextContent("45 pcs");
    await expect(figure("skus")).toHaveTextContent("2");
    await expect(digits(figure("goods"))).toBe(1_175_000);
    await expect(within(measures).getByTestId("restock-summary-measure-courier-charge")).toHaveTextContent("Courier COD");
    await expect(digits(figure("courier-charge"))).toBe(5_000);
    await expect(digits(figure("value"))).toBe(1_215_000);

    // The tab only picked a pile: still the one read.
    await userEvent.click(canvas.getByTestId("restock-tab-lost"));
    await waitFor(() => expect(figure("units")).toHaveTextContent("40 pcs"));
    await expect(restockReadScenario.sellingStatCalls).toHaveLength(1);
  },
};

// THE CARDS FOLLOW THE FILTERS (the-statistics-are-shut-and-read-when-opened) — opened under a courier, they count that
// courier's restocks (501, 504, 507) as the rows do; a search laid over it narrows both again (501 and 507 carry Teh
// Melati), and the census was asked each filter.
const AtCourier91 = routedPage(
  [{ path: "/inventories/restock", element: <><RestockSellingPage /><LocationProbe /></> }],
  "/inventories/restock?courier=91",
);

export const TheCardsFollowAFilter: Story = {
  name: "Follows a filter",
  render: () => <AtCourier91 />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("restock-row-501", {}, { timeout: 4000 });
    const summary = await openStatistics(canvas);

    const total = () => within(canvas.getByTestId("restock-summary")).getByTestId("restock-summary-total");
    await waitFor(() => expect(pileTransactions(total())).toBe(3));
    await expect(restockReadScenario.sellingStatCalls.at(-1)?.filter?.shipmentId).toBe(91n);
    await expect(canvas.getAllByTestId(/^restock-row-\d+$/)).toHaveLength(3);
    await expect(summary).toBeVisible();

    await userEvent.type(canvas.getByTestId("restock-search"), "teh", { delay: 30 });
    await waitFor(() => expect(pileTransactions(total())).toBe(2));
    await expect(restockReadScenario.sellingStatCalls.at(-1)?.filter).toMatchObject({ shipmentId: 91n, q: "teh" });
    await waitFor(() => expect(canvas.getAllByTestId(/^restock-row-\d+$/)).toHaveLength(2));

    // The total is still the piles summed.
    const piles = ["ongoing", "arrived", "accepted", "lost", "cancelled"].map((key) =>
      pileTransactions(within(canvas.getByTestId("restock-summary")).getByTestId(`restock-summary-pile-${key}`)),
    );
    await expect(piles.reduce((a, b) => a + b, 0)).toBe(2);
  },
};

// RINCIAN › OPENS THE VALUE PER PAYING ACCOUNT (a-breakdown-opens-from-rincian) — each restock's account, named by id: 507
// was paid from BNI Lama, ARCHIVED since, so no operational picker would name it; 503 names no account (raised before it
// was required) and is a row of its own. The rows add up to the card.
export const RincianAddsUpPerPayingAccount: Story = {
  name: "Rincian per account",
  beforeEach: () => {
    restockPaidFromForStory(507n, 1305n);
    restockPaidFromForStory(503n, 0n);
  },
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await openStatistics(canvas);

    await userEvent.click(canvas.getByTestId("restock-tab-accepted"));
    const measures = await canvas.findByTestId("restock-summary-measures");
    await userEvent.click(within(measures).getByTestId("restock-summary-payments"));

    const dialog = await screen.findByTestId("restock-payments-dialog");
    await waitFor(() => expect(dialog).toBeVisible());
    const rows = await within(dialog).findAllByTestId(/^restock-payment-\d+$/);
    // The larger value first, the restocks with no account last — whatever their value.
    await expect(rows.map((row) => row.dataset.testid)).toEqual(["restock-payment-1305", "restock-payment-0"]);
    await waitFor(() => expect(within(dialog).getByTestId("restock-payment-name-1305")).toHaveTextContent("BNI Lama"));
    await expect(within(dialog).getByTestId("restock-payment-name-0")).toHaveTextContent("No paying account");
    await expect(within(dialog).getByTestId("restock-payment-count-1305")).toHaveTextContent("1 transaction");
    await expect(digits(within(dialog).getByTestId("restock-payment-value-1305"))).toBe(235_000);
    await expect(digits(within(dialog).getByTestId("restock-payment-value-0"))).toBe(980_000);

    const paid = rows.reduce((s, row) => s + digits(within(row).getByText(/^Rp /)), 0);
    await expect(paid).toBe(digits(within(measures).getByTestId("restock-summary-measure-value-value")));
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
    await expect(within(sheet).getByTestId("restock-payment-1301")).toBeVisible();
  },
};
