import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";

import { LocationProbe, marker, routedPage } from "../../../../.storybook/pageStory";
import { supplierExportScenario } from "../../../../.storybook/supplierExportScenario";
import { SupplierDetailPage } from "../index";
import { SUPPLIER_DETAIL_META, SUMBER, AtSinar, loaded, openProducts } from "./kit";

// SUPPLIER DETAIL — Gudang terkait (a-supplier-page-is-scoped-by-its-warehouses) — the chips over the tabs and the
// summary under them. The page's stories are grouped by the part of the screen they are about
// (stories-are-grouped-by-the-part-of-the-screen); what they share is ./kit.tsx.

const meta = {
  title: "Pages/Suppliers/SupplierDetail/Warehouses",
  ...SUPPLIER_DETAIL_META,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

// THE WAREHOUSES SCOPE THE PAGE — the warehouses its restocks were received at, as chips over the tabs (the page's
// scope, not one tab's); Semua first, then the most restocked; under them, before the tabs, the summary of the chosen
// one or of all — real (InventoryService.SupplierGoods by warehouse). Unmarked: a chip narrows every tab, Statistik
// included (the-supplier-reports-carry-the-warehouse — the stories below).
export const TheWarehousesScopeThePage: Story = {
  name: "Chips and summary",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    const row = canvas.getByTestId("supplier-warehouses");
    await expect(within(row).queryByTestId("not-implemented-warehouses")).toBeNull();
    await expect(within(row).queryByTestId("not-implemented-warehouseFilter")).toBeNull();
    await expect(row.getBoundingClientRect().bottom).toBeLessThanOrEqual(
      canvas.getByTestId("supplier-tabs").getBoundingClientRect().top,
    );

    // Each chip is a warehouse's name, nothing more (a-warehouse-chip-is-its-name-and-the-summary-follows-it)…
    const chips = await waitFor(() => {
      const found = within(within(row).getByTestId("supplier-warehouses-chips")).getAllByRole("button");
      expect(found.map((c) => c.textContent)).toEqual(["All", "Gudang Pusat", "Gudang Cabang"]);
      return found;
    });
    await expect(chips[0]).toHaveAttribute("aria-pressed", "true");

    // …and under them what this supplier's goods did there: units sold, from how many orders and the last; units ready,
    // from how many restocks and the last (the-summary-is-sold-and-ready-with-their-counts).
    const summary = within(row).getByTestId("supplier-warehouse-summary");
    await expect(within(summary).getAllByText(/^(Sold|Ready)$/)).toHaveLength(2);
    // All: 1.204 + 303 + 0 sold on 77 + 21 orders; 86 + 25 + 40 ready from 9 + 2 + 1 restocks.
    await expect(within(summary).getByTestId("supplier-warehouse-summary-sold")).toHaveTextContent(/1\.507 units.*from 98 orders · last /);
    await expect(within(summary).getByTestId("supplier-warehouse-summary-ready")).toHaveTextContent(/151 units.*12 restocks · last /);
    await userEvent.click(chips[2]!);
    await expect(chips[2]).toHaveAttribute("aria-pressed", "true");
    await waitFor(() =>
      expect(within(row).getByTestId("supplier-warehouse-summary-sold")).toHaveTextContent(/303 units.*from 21 orders/),
    );
  },
};

// …and a supplier none of whose goods ever arrived was never restocked — said in words.
export const NoStoresMeansNoWarehouses: Story = {
  name: "No stores, none",
  render: () => <AtSinar />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await waitFor(() => expect(canvas.getByTestId("supplier-warehouses-none")).toBeVisible(), { timeout: 5000 });
  },
};

// ── The chip narrows every tab, and lives in the URL ─────────────────────────────────────────

// The page with its query string on screen (hidden) — what a story reads to see the chip written to the URL.
function routedWithProbe(entry: string) {
  return routedPage(
    [
      {
        path: "/inventories/suppliers/:supplierId",
        element: (
          <>
            <SupplierDetailPage />
            <LocationProbe hidden />
          </>
        ),
      },
      marker("/inventories/suppliers", "at-suppliers"),
    ],
    entry,
  );
}

const AtSumberProbed = routedWithProbe(`/inventories/suppliers/${SUMBER.id}`);
const AtSumberUnderPusat = routedWithProbe(`/inventories/suppliers/${SUMBER.id}?warehouse=11`);

const chip = (canvas: ReturnType<typeof within>, name: string) =>
  within(canvas.getByTestId("supplier-warehouses-chips")).getByRole("button", { name });

// A CHIP NARROWS THE TABS (a-supplier-page-is-scoped-by-its-warehouses): Gudang Cabang picked, the Toko tab keeps only
// the store whose goods were received there, with what they did there; the Produk tab only its rows — the Tokopedia one
// and the store-less one. The pick is in the URL (`?warehouse=`), and Semua puts every warehouse back.
export const AChipNarrowsTheTabs: Story = {
  name: "A chip narrows Toko and Produk",
  render: () => <AtSumberProbed />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const location = canvas.getByTestId("location-search");

    await canvas.findByTestId("channel-row-311", {}, { timeout: 4000 });
    await expect(canvas.getByTestId("channel-row-312")).toBeVisible();

    await waitFor(() => expect(chip(canvas, "Gudang Cabang")).toBeVisible());
    await userEvent.click(chip(canvas, "Gudang Cabang"));
    await waitFor(() => expect(location).toHaveTextContent("warehouse=14"));

    // Toko: the Tokopedia store alone, with Gudang Cabang's figures.
    await waitFor(() => expect(canvas.queryByTestId("channel-row-311")).toBeNull());
    await expect(canvas.getByTestId("channel-row-312")).toBeVisible();
    await expect(canvas.queryByTestId("channel-row-313")).toBeNull();
    await waitFor(() => expect(canvas.getByTestId("channel-sold-312")).toHaveTextContent(/^303ordered /));

    // Produk: its two rows there.
    await openProducts(canvas);
    await waitFor(() => {
      const ids = within(canvas.getByTestId("products-table"))
        .getAllByRole("row")
        .slice(1)
        .map((row) => row.getAttribute("data-testid"));
      expect(ids).toEqual(["product-row-3103", "product-row-3104"]);
    });
    await expect(location).toHaveTextContent("warehouse=14");

    // Semua: every warehouse again — the URL drops the pick, the rows come back.
    await userEvent.click(chip(canvas, "All"));
    await waitFor(() => expect(location).not.toHaveTextContent("warehouse="));
    await waitFor(() => expect(canvas.getByTestId("product-row-3101")).toBeVisible());
    await expect(within(canvas.getByTestId("products-table")).getAllByRole("row")).toHaveLength(1 + 5);
  },
};

// OPENED AT A URL UNDER A CHIP, the page opens under it: Gudang Pusat pressed, its summary, its two Shopee rows on the
// Produk tab — and the tab's Export carries the chip.
export const TheChipComesFromTheUrl: Story = {
  name: "Opened under a chip",
  render: () => <AtSumberUnderPusat />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await waitFor(() => expect(chip(canvas, "Gudang Pusat")).toHaveAttribute("aria-pressed", "true"));
    await expect(canvas.getByTestId("supplier-warehouse-summary-sold")).toHaveTextContent(/1\.204 units/);
    await canvas.findByTestId("channel-row-311", {}, { timeout: 4000 });
    await expect(canvas.queryByTestId("channel-row-312")).toBeNull();

    await openProducts(canvas);
    await waitFor(() => {
      const ids = within(canvas.getByTestId("products-table"))
        .getAllByRole("row")
        .slice(1)
        .map((row) => row.getAttribute("data-testid"));
      expect(ids).toEqual(["product-row-3101", "product-row-3102"]);
    });

    await userEvent.click(canvas.getByTestId("products-export"));
    await waitFor(() => expect(supplierExportScenario.products).toHaveLength(1));
    await expect(supplierExportScenario.products[0]).toMatchObject({ supplierId: SUMBER.id, warehouseId: 11n, rows: 2 });
  },
};

// A CHIP NARROWS STATISTIK (the-supplier-reports-carry-the-warehouse): the supplier's restocks received at the chosen
// warehouse and its sales taken from there, at the same line prices — Gudang Cabang holds Toko Kenanga's Gula only
// (60 · Rp 900.000, 3 broken; 50 sold for Rp 975.000), so Per Produk loses Toko Melati's Beras, which went to Gudang
// Pusat. Semua is the sum over every warehouse again — the tab's figures before the reports carried the warehouse.
export const AChipNarrowsStatistik: Story = {
  name: "A chip narrows Statistik",
  render: () => <AtSumberProbed />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const location = canvas.getByTestId("location-search");

    await userEvent.click(canvas.getByTestId("supplier-tab-statistics"));
    const value = await canvas.findByTestId("statistics-summary-restocked-value", {}, { timeout: 4000 });
    await waitFor(() => expect(value).toHaveTextContent(/4\.400\.000/));

    await waitFor(() => expect(chip(canvas, "Gudang Cabang")).toBeVisible());
    await userEvent.click(chip(canvas, "Gudang Cabang"));
    await waitFor(() => expect(location).toHaveTextContent("warehouse=14"));

    await waitFor(() => expect(canvas.getByTestId("statistics-summary-restocked-value")).toHaveTextContent(/900\.000/));
    await expect(canvas.getByTestId("statistics-summary-restocked-units")).toHaveTextContent("60 units");
    await expect(canvas.getByTestId("statistics-summary-sales-value")).toHaveTextContent(/975\.000/);

    await userEvent.click(canvas.getByTestId("statistics-view-product"));
    await waitFor(() => {
      const rows = within(canvas.getByTestId("statistics-products")).getAllByRole("row").slice(1);
      expect(rows.map((r) => r.getAttribute("data-testid"))).toEqual(["statistics-product-row-13|73"]);
    });

    // Its Export carries the chip, as its reads do.
    await userEvent.click(canvas.getByTestId("statistics-export"));
    await waitFor(() => expect(supplierExportScenario.figures).toHaveLength(1));
    await expect(supplierExportScenario.figures[0]!.filters.find((f) => f.f.case === "warehouseFilter")?.f.value).toMatchObject(
      { warehouseId: 14n },
    );

    await userEvent.click(chip(canvas, "All"));
    await waitFor(() => expect(location).not.toHaveTextContent("warehouse="));
    await waitFor(() =>
      expect(within(canvas.getByTestId("statistics-products")).getAllByRole("row").slice(1)).toHaveLength(2),
    );
    await expect(canvas.getByTestId("statistics-summary-restocked-value")).toHaveTextContent(/4\.400\.000/);
  },
};
