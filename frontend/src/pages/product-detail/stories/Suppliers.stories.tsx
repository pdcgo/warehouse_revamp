import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, waitFor, within } from "storybook/test";

import { pickTeam } from "../../../../.storybook/pageStory";
import { productSupplierCalls } from "../../../../.storybook/productListScenario";
import { productSuppliersForStory } from "../../../../.storybook/productStub";
import { formatUnixDate } from "../../../lib/datetime";
import { PRODUCT_DETAIL_META, loaded, openTab } from "./kit";

// PRODUCT DETAIL — the Pemasok tab of the warehouse card (the-suppliers-are-a-tab-of-their-own,
// the-supplier-tab-names-the-store): who supplied this product, at which of their stores, how often, how much, the
// owner's last cost and when — REAL since 2026-11-21 (InventoryService.ProductSupplierGoods), in the picker's warehouse
// (the-warehouse-picker-splits-the-page). The stub groups team 15's batches as the server does (productStub.ts
// `productSupplierGoods`):
//
//   700  batch 7001  Gudang Pusat   60 @ Rp 45.700, 30 days ago   PT Sumber Makmur · Sumber Makmur Official (Shopee)
//        batch 7002  Gudang Cabang  40 @ Rp 47.200,  5 days ago   Linen House · no store
//        batch 7003  Gudang Pusat   24 @ Rp 46.500,  1 day ago    PT Sumber Makmur · Sumber Makmur Official (Shopee)

const meta = {
  title: "Pages/Products/ProductDetail/Suppliers",
  ...PRODUCT_DETAIL_META,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

// The stub's clock: productStub.ts reads every sample date from 8 Oct 2026, 00:00 UTC.
const STUB_NOW = BigInt(Date.UTC(2026, 9, 8) / 1000);
const DAY = 86_400n;

/** THE COLUMNS, as decided (the-supplier-tab-names-the-store): Pemasok · Toko pemasok · Kiriman · Unit · Modal terakhir ·
 * Kiriman terakhir — the last cost on the owner's page. A supplier's deliveries add up: Sumber Makmur's two into Gudang
 * Pusat are 2 deliveries of 84 pcs, its last cost the NEWEST delivery's (Rp 46.500, not the first's Rp 45.700); its store
 * opens in a new tab. Linen House's line named no store — it reads — under its supplier
 * (a-line-with-no-store-links-under-the-supplier). No ⚠ on the tab, no pager under two rows. */
export const TheSuppliersAreReal: Story = {
  name: "Real rows",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await expect(within(canvas.getByTestId("pd-tab-suppliers")).queryByTestId("not-implemented-suppliers")).toBeNull();

    const tab = await openTab(canvas, "suppliers");
    const table = await tab.findByTestId("pd-suppliers-table");
    await waitFor(() => expect(tab.getAllByTestId(/^pd-supplier-row-\d+$/)).toHaveLength(2));

    await expect(within(table).getAllByRole("columnheader").map((h) => h.textContent)).toEqual([
      "Supplier",
      "Supplier store",
      "Deliveries",
      "Units",
      "Last cost",
      "Last delivery",
    ]);

    // The read the page asked: the owner (15) about 700, every warehouse, page 1.
    await expect(productSupplierCalls.at(-1)).toEqual({ teamId: 15n, productId: 700n, warehouseId: 0n, page: 1 });

    const sumber = within(tab.getByTestId("pd-supplier-row-0"));
    await waitFor(() => expect(sumber.getByTestId("supplier-open-31")).toHaveTextContent("PT Sumber Makmur"));
    await expect(tab.getByTestId("pd-supplier-row-0")).toHaveTextContent("Toko Melati");
    await expect(sumber.getByTestId("supplier-store-link-311")).toHaveAttribute("href", "https://shopee.co.id/sumbermakmur");
    await expect(sumber.getByTestId("supplier-store-link-311")).toHaveAttribute("target", "_blank");
    await expect(sumber.getByTestId("pd-supplier-deliveries-0")).toHaveTextContent("2");
    await expect(sumber.getByTestId("pd-supplier-units-0")).toHaveTextContent("84 pcs");
    await expect(sumber.getByTestId("pd-supplier-cost-0")).toHaveTextContent(/^Rp\s?46\.500$/);
    await expect(sumber.getByTestId("pd-supplier-last-0")).toHaveTextContent(formatUnixDate(STUB_NOW - 1n * DAY));

    const linen = within(tab.getByTestId("pd-supplier-row-1"));
    await waitFor(() => expect(linen.getByTestId("supplier-open-37")).toHaveTextContent("Linen House"));
    await expect(linen.getByTestId("supplier-store-none-37")).toHaveTextContent("—");
    await expect(linen.getByTestId("pd-supplier-deliveries-1")).toHaveTextContent("1");
    await expect(linen.getByTestId("pd-supplier-units-1")).toHaveTextContent("40 pcs");
    await expect(linen.getByTestId("pd-supplier-cost-1")).toHaveTextContent(/^Rp\s?47\.200$/);

    await expect(tab.queryByTestId("pd-suppliers-pager")).toBeNull();
  },
};

/** THE TAB FOLLOWS THE PICKER (the-warehouse-picker-splits-the-page): only the deliveries RECEIVED in the chosen
 * warehouse, asked of the server with it — Gudang Cabang got Linen House's one; Gudang Pusat, Sumber Makmur's two. */
export const TheSuppliersFollowThePicker: Story = {
  name: "Follows the picker",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const tab = await openTab(canvas, "suppliers");
    await waitFor(() => expect(tab.getAllByTestId(/^pd-supplier-row-\d+$/)).toHaveLength(2));

    await pickTeam(canvas.getByTestId("pd-warehouse-filter"), "WH-02");
    await waitFor(() => expect(productSupplierCalls.at(-1)?.warehouseId).toBe(14n));
    await waitFor(() => expect(tab.getAllByTestId(/^pd-supplier-row-\d+$/)).toHaveLength(1));
    await expect(tab.getByTestId("pd-supplier-row-0")).toHaveAttribute("data-supplier-id", "37");
    await expect(tab.getByTestId("pd-supplier-units-0")).toHaveTextContent("40 pcs");

    await pickTeam(canvas.getByTestId("pd-warehouse-filter"), "WH-01");
    await waitFor(() => expect(productSupplierCalls.at(-1)?.warehouseId).toBe(11n));
    await waitFor(() => expect(tab.getByTestId("pd-supplier-row-0")).toHaveAttribute("data-supplier-id", "31"));
    await expect(tab.getAllByTestId(/^pd-supplier-row-\d+$/)).toHaveLength(1);
    await expect(tab.getByTestId("pd-supplier-deliveries-0")).toHaveTextContent("2");
  },
};

/** A LONG LIST PAGES, as every list on this page (no-list-on-the-product-page-pages-when-it-fits): 25 pairs, 20 a page,
 * so the pager shows. A DELETED supplier is still named — badged, and opening nothing, since its page is gone
 * (a-deleted-supplier-still-shows-with-a-badge). */
export const ALongListPagesAndADeletedSupplierIsBadged: Story = {
  name: "Pages · deleted supplier",
  beforeEach: () => {
    const pairs: [bigint, bigint][] = [
      [38n, 391n],
      ...[351n, 352n, 353n, 354n, 355n, 356n, 357n, 358n, 359n, 360n, 361n, 362n].map((s): [bigint, bigint] => [35n, s]),
      [31n, 312n],
      [31n, 313n],
      [36n, 371n],
      [36n, 372n],
      [36n, 373n],
      [37n, 381n],
      [37n, 382n],
      [34n, 341n],
      [34n, 342n],
      [32n, 321n],
    ];
    productSuppliersForStory(
      700n,
      pairs.map(([supplierId, storeId], i) => ({
        supplierId,
        storeId,
        warehouseId: 11n,
        deliveries: 1n,
        units: 10n,
        // The deleted supplier's the newest, so it opens the list.
        lastDeliveryUnix: STUB_NOW - BigInt(i) * 60n,
        lastUnitCost: 40_000,
      })),
    );
  },
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const tab = await openTab(canvas, "suppliers");

    await waitFor(() => expect(tab.getAllByTestId(/^pd-supplier-row-\d+$/)).toHaveLength(20));
    await expect(tab.getByTestId("pd-suppliers-pager")).toBeInTheDocument();

    const deleted = within(tab.getByTestId("pd-supplier-row-0"));
    await waitFor(() => expect(deleted.getByTestId("supplier-name-38")).toHaveTextContent("CV Lama Tutup"));
    await expect(deleted.getByTestId("deleted-badge")).toBeInTheDocument();
    await expect(deleted.queryByTestId("supplier-open-38")).toBeNull();
  },
};

/** ON A PHONE each supplier is a block (a-phone-reads-each-line-as-a-block): the supplier and its last delivery, the
 * store, then *2 deliveries · 84 pcs* and the owner's last cost — no table, nothing past the screen's edge. */
export const APhoneReadsEachSupplierAsABlock: Story = {
  name: "Phone · blocks",
  globals: { viewport: { value: "mobile2" } },
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const tab = await openTab(canvas, "suppliers");

    await waitFor(() => expect(tab.getAllByTestId(/^pd-supplier-row-\d+$/)).toHaveLength(2));
    await expect(tab.queryByRole("table")).toBeNull();
    await expect(tab.getByTestId("pd-supplier-row-0")).toHaveTextContent(/2 deliveries · 84 pcs/);
    await expect(tab.getByTestId("pd-supplier-cost-0")).toHaveTextContent(/^Rp\s?46\.500$/);
    await expect(tab.getByTestId("supplier-store-none-37")).toBeInTheDocument();
    await expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(document.documentElement.clientWidth);
  },
};
