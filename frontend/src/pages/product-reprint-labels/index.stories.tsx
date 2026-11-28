import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, spyOn, userEvent, waitFor, within } from "storybook/test";

import { asTeam, routedPage } from "../../../.storybook/pageStory";
import { ANGGREK, GUDANG_CABANG, GUDANG_PUSAT, productReprintScenario } from "../../../.storybook/productReprintStub";
import { PRODUCT_TAG } from "../../../.storybook/productTagScenario";
import { allProducts } from "../../../.storybook/productStub";
import { asAdminTeam, asRole } from "../../../.storybook/sessionScenario";
import { toaster } from "../../components/feedback/Toaster";
import { clearSettings, loadSettings, saveSettings } from "../../features/labels/settings";
import { Role } from "../../gen/warehouse/role_base/v1/role_pb";
import { ProductsPage } from "../products";
import { ProductReprintLabelsPage, REPRINT_LABELS_PATH } from "./index";

// CETAK ULANG KODE — the warehouse's reprint of the products whose code changed (backlog #151, live since
// the-team-code-and-product-tags-prototype-is-accepted, row *the reprint*; the acceptance rows
// docs/acceptances/teams/team_code.md givens 3–4). One label per placement — the LIVE code (QR and SKU), the shelf spot, the
// quantity beside it — on the device's own label setup; Cetak is the recorded print (InventoryService.ProductReprintRecord):
// the products leave this warehouse's list, and `need_reprint_code` comes off a product once every warehouse holding its
// stock has printed. Gudang Pusat (11): Minyak on A-01-1 (30) and A-01-2 (24), Tepung Karton on B-02-1 (12) — 3 labels,
// 2 products; Gudang Cabang (14): Minyak on C-01-1 (25) — the stub's world (.storybook/productReprintStub.ts). Back
// returns to the warehouse's Products, whose rows show the tags as they stand.

const routes = [
  { path: REPRINT_LABELS_PATH, element: <ProductReprintLabelsPage /> },
  { path: "/products", element: <ProductsPage /> },
];
const AtReprint = routedPage(routes, REPRINT_LABELS_PATH);

const TAG = PRODUCT_TAG;

const meta = {
  title: "Pages/Products/ProductReprintLabels",
  component: AtReprint,
  parameters: { signedIn: true, dataRouter: true },
  beforeEach: () => {
    asTeam(GUDANG_PUSAT)();
    asRole(Role.WAREHOUSE_STAFF)();
    toaster.remove();
    // The browser's print dialog never opens in a story — the page's Cetak is the assertion.
    const print = spyOn(window, "print").mockImplementation(() => {});
    return () => print.mockRestore();
  },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

async function loaded(canvasElement: HTMLElement) {
  const canvas = within(canvasElement);
  await canvas.findByTestId("reprint-page", {}, { timeout: 5000 });
  await waitFor(() => expect(canvas.queryByTestId("reprint-loading")).toBeNull(), { timeout: 5000 });
  return canvas;
}

/** ONE LABEL PER PLACEMENT, only the tagged products waiting here (given 3): 3 labels for 2 products on 3 shelf spots,
 *  each with its new code, its shelf spot and its quantity — the old code said beside the product, so the crew finds
 *  the sticker it replaces. */
export const OneLabelPerPlacement: Story = {
  name: "One label per placement",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(canvas.getByTestId("reprint-count")).toHaveTextContent("3 to print · 2 products");
    await expect(canvas.getAllByTestId(/^reprint-label-\d+$/)).toHaveLength(3);
    await expect(canvas.getByTestId("reprint-label-0-where")).toHaveTextContent("A-01-1 · 30 pcs on the shelf");
    await expect(canvas.getByTestId("reprint-label-1-where")).toHaveTextContent("A-01-2 · 24 pcs on the shelf");
    await expect(canvas.getByTestId("reprint-label-2-where")).toHaveTextContent("B-02-1 · 12 pcs on the shelf");

    const first = within(canvas.getByTestId("reprint-label-0"));
    await expect(first.getByTestId("label-sku")).toHaveTextContent("SL-03-ANG-001");
    await expect(first.getByTestId("label-placement")).toHaveTextContent("A-01-1");
    await expect(canvas.getByTestId("reprint-product-700-former")).toHaveTextContent("was TA-ANG-001");
    await expect(canvas.getByTestId("reprint-product-703-code")).toHaveTextContent("SL-03-ANG-004");
    // Tepung Satuan (702) was recomposed with nothing on a shelf — never tagged, never here (⚠4).
    await expect(canvas.queryByTestId("reprint-product-702")).toBeNull();
    // On the device's own setup — no settings panel of its own.
    await expect(canvas.getByTestId("reprint-settings-line")).toHaveTextContent("35 × 15 mm · 1 × 1");
    // Every label is in the print.
    await expect(canvasElement.ownerDocument.querySelectorAll('[data-testid="reprint-print-root"] .print-label')).toHaveLength(3);
  },
};

/** WRITES — Cetak opens the print and records it (ProductReprintRecord, each product with the code it printed): both
 *  products leave Gudang Pusat's list. Tepung Karton is held nowhere else, so its tag comes off; Minyak keeps it —
 *  Gudang Cabang has not printed (given 4). */
export const PrintingClearsThisWarehouse: Story = {
  name: "Printing (writes)",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await userEvent.click(canvas.getByTestId("reprint-print"));

    await waitFor(() => expect(window.print).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(productReprintScenario.records).toEqual([
        {
          warehouseId: GUDANG_PUSAT,
          items: [
            { productId: 700n, productCode: "SL-03-ANG-001" },
            { productId: 703n, productCode: "SL-03-ANG-004" },
          ],
        },
      ]),
    );
    await waitFor(() => expect(canvas.getByTestId("reprint-empty")).toBeVisible(), { timeout: 5000 });

    // Back on the list: the entry is gone, Tepung Karton's tag is off, Minyak's still on.
    await userEvent.click(canvas.getByTestId("reprint-back"));
    await canvas.findByTestId("stock-row-SL-03-ANG-004", {}, { timeout: 5000 });
    await expect(canvas.queryByTestId("open-reprint-labels")).toBeNull();
    await expect(canvas.queryByTestId(`stock-tags-SL-03-ANG-004-${TAG.reprint}`)).toBeNull();
    await expect(canvas.getByTestId(`stock-tags-SL-03-ANG-001-${TAG.reprint}`)).toBeVisible();
  },
};

/** WRITES — the other warehouse prints first: Minyak leaves Gudang Cabang's list, and stays tagged while Gudang Pusat
 *  has not printed (given 4: *product still tagged*, *other warehouse still sees it in its reprint*). */
export const AnotherWarehouseStillWaits: Story = {
  name: "One of two warehouses printed (writes)",
  beforeEach: () => {
    asTeam(GUDANG_CABANG)();
    asRole(Role.WAREHOUSE_ADMIN)();
  },
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(canvas.getAllByTestId(/^reprint-label-\d+$/)).toHaveLength(1);
    await expect(canvas.getByTestId("reprint-label-0-where")).toHaveTextContent("C-01-1 · 25 pcs on the shelf");
    await userEvent.click(canvas.getByTestId("reprint-print"));

    await waitFor(() =>
      expect(productReprintScenario.records).toEqual([{ warehouseId: GUDANG_CABANG, items: [{ productId: 700n, productCode: "SL-03-ANG-001" }] }]),
    );
    await waitFor(() => expect(canvas.getByTestId("reprint-empty")).toBeVisible(), { timeout: 5000 });
    await userEvent.click(canvas.getByTestId("reprint-back"));
    await waitFor(() => expect(canvas.getByTestId(`stock-tags-SL-03-ANG-001-${TAG.reprint}`)).toBeVisible(), { timeout: 5000 });
  },
};

/** WRITES — a code changed again between the read and the print is NOT cleared by it: the page says so, reads again and
 *  shows the newest code, still to print; the product printed with its live code leaves the list. */
export const ACodeChangedSinceTheRead: Story = {
  name: "Code changed since the read (writes)",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    // Toko Anggrek's code moves on while the page is open.
    allProducts().find((p) => p.id === 703n)!.productCode = "SL-09-ANG-004";
    await userEvent.click(canvas.getByTestId("reprint-print"));

    await waitFor(() => expect(productReprintScenario.records).toHaveLength(1));
    await expect(productReprintScenario.records[0].items).toContainEqual({ productId: 703n, productCode: "SL-03-ANG-004" });
    await waitFor(() => expect(within(document.body).getByText(/code changed again since this page read it/)).toBeVisible(), {
      timeout: 5000,
    });
    await waitFor(() => expect(canvas.getByTestId("reprint-product-703-code")).toHaveTextContent("SL-09-ANG-004"), { timeout: 5000 });
    await expect(canvas.queryByTestId("reprint-product-700")).toBeNull();
    await expect(canvas.getByTestId("reprint-count")).toHaveTextContent("1 to print · 1 product");
  },
};

/** WRITES — a run holds only as many labels as the device's setup allows: a product is recorded only when EVERY one of
 *  its labels was in the print, so the rest still wait here, and the page says how many labels are left. Minyak's code
 *  sorts after Tepung Karton's here, so a run of 2 holds Tepung Karton's one label and only the first of Minyak's two. */
export const OnlyWhatThePrintHeldWhole: Story = {
  name: "Only products printed whole (writes)",
  beforeEach: () => {
    allProducts().find((p) => p.id === 700n)!.productCode = "SL-03-ANG-009";
    saveSettings({ ...loadSettings(), limit: 2 });
    return () => clearSettings();
  },
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(canvas.getByTestId("reprint-more")).toHaveTextContent("1 more label waits for the next print");
    await userEvent.click(canvas.getByTestId("reprint-print"));

    await waitFor(() =>
      expect(productReprintScenario.records).toEqual([{ warehouseId: GUDANG_PUSAT, items: [{ productId: 703n, productCode: "SL-03-ANG-004" }] }]),
    );
    await waitFor(() => expect(canvas.queryByTestId("reprint-product-703")).toBeNull(), { timeout: 5000 });
    await expect(canvas.getByTestId("reprint-product-700")).toBeVisible();
    await expect(canvas.getByTestId("reprint-count")).toHaveTextContent("2 to print · 1 product");
  },
};

/** A monitor reads what waits, and prints nothing. */
export const AMonitorPrintsNothing: Story = {
  name: "Monitor prints nothing",
  beforeEach: asAdminTeam(),
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(canvas.getAllByTestId(/^reprint-label-\d+$/)).toHaveLength(3);
    await expect(canvas.queryByTestId("reprint-print")).toBeNull();
  },
};

/** A selling team has no reprint — the warehouse prints its labels. */
export const OnlyAWarehouse: Story = {
  name: "Only a warehouse",
  beforeEach: () => {
    asTeam(ANGGREK)();
    asRole(Role.SELLING_OWNER)();
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(await canvas.findByTestId("reprint-not-warehouse", {}, { timeout: 5000 })).toHaveTextContent("Only a warehouse");
    await expect(productReprintScenario.listReads).toBe(0);
  },
};

/** On a phone: one row of header with Cetak as its icon, the count under it, the labels a column. */
export const OnAPhone: Story = {
  name: "Reprint page, phone",
  globals: { viewport: { value: "mobile2" } },
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(canvas.getByTestId("reprint-print")).toBeVisible();
    await expect(canvas.getByTestId("reprint-count")).toHaveTextContent("3 to print");
    const sheet = canvas.getByTestId("reprint-to-print");
    await expect(sheet.scrollWidth).toBeLessThanOrEqual(sheet.clientWidth);
  },
};
