import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, waitFor, within } from "storybook/test";

import { IN_TRANSIT_SAMPLE, transfersInTransitForStory } from "../../../../.storybook/productStub";
import { LocationProbe, besideTheOpenSidebar, marker, routedPage } from "../../../../.storybook/pageStory";
import { ProductsPage } from "../index";
import { PRODUCTS_META, loaded } from "./kit";

// THE IN-TRANSIT FIGURE ON THE LIST (in-transit-is-its-own-figure-beside-siap-and-dikirim,
// the-in-transit-column-shows-while-any-is-in-transit — docs/technical/frontend/products_decision.md): units on a
// warehouse transfer not yet accepted, their own figure beside Siap and Dikirim. Under a warehouse lens, the units on
// their way TO it.
//
//   the stat strip's tile    always — 0 pcs included
//   the phone block's fact   always — 0 pcs included
//   the desktop column       ONLY while the view's units in transit — the tile's figure, same team, same lens — are
//                            above zero; at zero the list is exactly the eight columns it had before the figure
//
// The stub's open transfers (productStub.ts `IN_TRANSIT_SAMPLE`), all Toko Anggrek's (team 15):
//
//   SL-03-ANG-001  Minyak Goreng 2L — Satuan    79 ready · 12 ongoing · 3 in transit, Pusat → Cabang, Rp 137.100
//   SL-03-ANG-002  Minyak Goreng 2L — Karton    0 in transit — reads "0 pcs", as Dikirim's zero does
//   SL-03-ANG-003  Tepung Terigu 1kg — Satuan   nothing ready anywhere · 8 in transit, Cabang → Pusat, Rp 76.000
//
// The team: 11 pcs in transit, Rp 213.100; under Gudang Cabang 3 pcs, under Gudang Pusat 8. A story empties or narrows
// them with `transfersInTransitForStory(...)` in its `beforeEach`.

/** The 390px phone the list's blocks are judged at. */
const PHONE_VIEWPORTS = {
  phone390: { name: "Phone 390", styles: { width: "390px", height: "844px" }, type: "mobile" },
};

// The list's own routes, the query string kept off the screen being reviewed.
const routes = [
  {
    path: "/products",
    element: (
      <>
        <ProductsPage />
        <LocationProbe hidden />
      </>
    ),
  },
  marker("/products/:productId", "at-product-detail"),
];
const AtList = routedPage(routes, "/products");
const AtGudangPusat = routedPage(routes, "/products?warehouse=11");
const AtGudangCabang = routedPage(routes, "/products?warehouse=14");

/** Only SL-03-ANG-001's 3 on the road, Gudang Pusat → Gudang Cabang. */
const onlyTheMinyak = () => transfersInTransitForStory(IN_TRANSIT_SAMPLE.find((l) => l.productId === 700n)!);

/** The list as it was before the figure: eight columns. */
// The Tag column after the product is live since #148 (the-team-code-and-product-tags-prototype-is-accepted).
const TODAYS_HEADERS = ["Product", "Tags", "Cross", "Cost range", "Lock", "Ready", "Ongoing", "Stock age", "Actions"];

const meta = {
  title: "Pages/Products/Products/InTransit",
  ...PRODUCTS_META,
  component: AtList,
  parameters: { ...PRODUCTS_META.parameters, viewport: { options: PHONE_VIEWPORTS } },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

const headersOf = (canvas: ReturnType<typeof within>) =>
  within(canvas.getByTestId("products-table"))
    .getAllByRole("columnheader")
    .map((h) => h.textContent?.trim() ?? "");

const cellsOf = (canvas: ReturnType<typeof within>, productCode: string) =>
  within(canvas.getByTestId(`product-row-${productCode}`)).getAllByRole("cell");

const tileValue = (canvas: ReturnType<typeof within>) =>
  within(canvas.getByTestId("products-in-transit-stock")).getByTestId("products-in-transit-stock-value");

// THE PAGE NEVER SCROLLS SIDEWAYS — a wide table scrolls inside its own box (nothing-runs-past-a-phones-edge, and the
// list's own rule on a desktop).
async function thePageDoesNotScrollSideways(canvasElement: HTMLElement) {
  await expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(document.documentElement.clientWidth);
  await expect(canvasElement.scrollWidth).toBeLessThanOrEqual(canvasElement.clientWidth);
}

/** UNITS IN TRANSIT → THE COLUMN, beside Siap and Dikirim: 3 pcs on SL-03-ANG-001 (what the out-leg took on its title),
 * 0 pcs on SL-03-ANG-002 as Dikirim writes its zero, and 8 pcs on SL-03-ANG-003, which has nothing ready anywhere. Never
 * added into Siap (001 stays 79) nor into Dikirim (stays 12). At 1440 beside the open sidebar. */
export const UnitsInTransitShowTheColumn: Story = {
  name: "Units in transit → the column",
  decorators: [besideTheOpenSidebar],
  globals: { viewport: { value: "desktop1440" } },
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(window.innerWidth).toBe(1440);
    // The column follows the tile: 11 pcs for the team, so it shows.
    await waitFor(() => expect(tileValue(canvas)).toHaveTextContent(/^11 pcs$/));
    await waitFor(() => expect(canvas.getByTestId("products-in-transit-header")).toBeInTheDocument());
    const headers = headersOf(canvas);
    await expect(headers).toHaveLength(10);
    await expect(headers.slice(5, 9)).toEqual(["Ready", "Ongoing", "In transit", "Stock age"]);
    await expect(canvas.getByTestId("products-in-transit-header")).toHaveAttribute(
      "title",
      "Units on a transfer between warehouses, not yet accepted",
    );

    await waitFor(() => expect(canvas.getByTestId("in-transit-SL-03-ANG-001")).toHaveTextContent(/^3 pcs$/));
    await expect(canvas.getByTestId("in-transit-SL-03-ANG-001")).toHaveAttribute("title", "Rp 137.100");
    const minyak = cellsOf(canvas, "SL-03-ANG-001");
    await expect(minyak[5]).toHaveTextContent(/^79 pcs/);
    await expect(minyak[6]).toHaveTextContent(/^12 pcs/);
    await expect(minyak[7]).toHaveTextContent(/^3 pcs$/);

    // Zero as Dikirim writes it — "0 pcs", never a dash, and no worth on its title.
    const none = canvas.getByTestId("in-transit-SL-03-ANG-002");
    await expect(none).toHaveTextContent(/^0 pcs$/);
    await expect(none).toHaveAttribute("data-zero", "true");
    await expect(none).not.toHaveAttribute("title");
    await expect(cellsOf(canvas, "SL-03-ANG-002")[6]).toHaveTextContent(/^0 pcs/);

    // Only in transit: nothing ready on any shelf, 8 on their way.
    const tepung = cellsOf(canvas, "SL-03-ANG-003");
    await expect(tepung[5]).toHaveTextContent(/^0 pcs/);
    await expect(canvas.getByTestId("in-transit-SL-03-ANG-003")).toHaveTextContent(/^8 pcs$/);
    await expect(canvas.getByTestId("in-transit-SL-03-ANG-003")).toHaveAttribute("title", "Rp 76.000");

    await thePageDoesNotScrollSideways(canvasElement);
  },
};

/** NO UNITS IN TRANSIT → NO COLUMN: the team has no open transfer, so the list is exactly the list it was before the
 * figure — eight columns, eight cells a row, no in-transit cell anywhere. The tile still shows, reading 0 pcs. */
export const NoUnitsInTransitNoColumn: Story = {
  name: "No units in transit → no column",
  beforeEach: () => transfersInTransitForStory(),
  decorators: [besideTheOpenSidebar],
  globals: { viewport: { value: "desktop1440" } },
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await waitFor(() => expect(cellsOf(canvas, "SL-03-ANG-001")[5]).toHaveTextContent(/^79 pcs/));
    await waitFor(() => expect(tileValue(canvas)).toHaveTextContent(/^0 pcs$/));
    await expect(canvas.getByTestId("products-in-transit-stock")).toHaveTextContent("Rp 0 · between warehouses, at cost");

    await expect(headersOf(canvas)).toEqual(TODAYS_HEADERS);
    await expect(canvas.queryByTestId("products-in-transit-header")).toBeNull();
    await expect(canvas.queryAllByTestId(/^in-transit-/)).toHaveLength(0);
    await expect(cellsOf(canvas, "SL-03-ANG-001")).toHaveLength(9);
    await thePageDoesNotScrollSideways(canvasElement);
  },
};

/** THE TILE beside Dikirim: the team's 11 pcs in transit and what the out-legs took, Rp 213.100 — six cards. */
export const TheTileInTheStrip: Story = {
  name: "Stat tile",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    const tile = await canvas.findByTestId("products-in-transit-stock");
    await waitFor(() => expect(tileValue(canvas)).toHaveTextContent(/^11 pcs$/));
    await expect(tile).toHaveTextContent("In transit");
    await expect(tile).toHaveTextContent("Rp 213.100 · between warehouses, at cost");

    const cards = Array.from(canvas.getByTestId("products-stats").children).map((c) => c.getAttribute("data-testid"));
    await expect(cards).toEqual([
      "products-total",
      "products-ready-stock",
      "products-ongoing-stock",
      "products-in-transit-stock",
      "products-last-order",
      "products-last-restock",
    ]);
  },
};

/** A PHONE — a fact in the product's block, beside Dikirim on the same line; the worth inline, since nothing hovers on a
 * phone. The block still fits the 390px screen. */
export const TheFactOnAPhone: Story = {
  name: "Phone block",
  globals: { viewport: { value: "phone390" } },
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(window.innerWidth).toBe(390);
    await expect(canvasElement.querySelector("table")).toBeNull();

    const block = canvas.getByTestId("product-row-SL-03-ANG-001");
    await waitFor(() => expect(within(block).getByTestId("in-transit-SL-03-ANG-001")).toHaveTextContent(/^3 pcs · Rp 137\.100$/));
    // Beside Dikirim: the two labels on one line, Dikirim first.
    const ongoing = within(block).getByText("Ongoing", { exact: true }).getBoundingClientRect();
    const inTransit = within(block).getByText("In transit", { exact: true }).getBoundingClientRect();
    await expect(Math.abs(ongoing.top - inTransit.top)).toBeLessThan(1);
    await expect(inTransit.left).toBeGreaterThan(ongoing.left);

    await expect(canvas.getByTestId("in-transit-SL-03-ANG-002")).toHaveTextContent(/^0 pcs$/);
    await expect(canvas.getByTestId("in-transit-SL-03-ANG-003")).toHaveTextContent(/^8 pcs · Rp 76\.000$/);

    // The tile is in the strip on a phone too.
    await expect(canvas.getByTestId("products-in-transit-stock")).toHaveTextContent("11 pcs");

    await thePageDoesNotScrollSideways(canvasElement);
    for (const code of ["SL-03-ANG-001", "SL-03-ANG-002", "SL-03-ANG-003"]) {
      const b = canvas.getByTestId(`product-row-${code}`);
      await expect(b.getBoundingClientRect().right).toBeLessThanOrEqual(window.innerWidth);
      await expect(b.scrollWidth).toBeLessThanOrEqual(b.clientWidth);
    }
  },
};

/** A PHONE WITH NOTHING IN TRANSIT — the fact does not hide: every block reads 0 pcs beside Dikirim, as the tile does. */
export const NothingInTransitThePhoneFactReadsZero: Story = {
  name: "Phone, nothing in transit → 0 pcs",
  beforeEach: () => transfersInTransitForStory(),
  globals: { viewport: { value: "phone390" } },
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(window.innerWidth).toBe(390);
    const block = canvas.getByTestId("product-row-SL-03-ANG-001");
    await waitFor(() => expect(block).toHaveTextContent("79 pcs"));
    await expect(within(block).getByText("In transit", { exact: true })).toBeVisible();
    await waitFor(() => expect(within(block).getByTestId("in-transit-SL-03-ANG-001")).toHaveTextContent(/^0 pcs$/));
    await expect(canvas.getByTestId("in-transit-SL-03-ANG-003")).toHaveTextContent(/^0 pcs$/);
    await waitFor(() => expect(tileValue(canvas)).toHaveTextContent(/^0 pcs$/));
  },
};

/** UNDER A WAREHOUSE — the units on their way TO it (the receiver, as the Transfer metric reads it): under Gudang
 * Cabang, SL-03-ANG-001's 3 (Pusat → Cabang) and not SL-03-ANG-003's 8, which go to Gudang Pusat. The heading and the tile
 * name the warehouse, and say which way. */
export const UnderAWarehouseLens: Story = {
  name: "Warehouse lens — the receiver's",
  render: () => <AtGudangCabang />,
  decorators: [besideTheOpenSidebar],
  globals: { viewport: { value: "desktop1440" } },
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    const header = await canvas.findByTestId("products-in-transit-header", {}, { timeout: 5000 });
    await waitFor(() => expect(header).toHaveTextContent(/^In transit · Gudang Cabang$/));
    await expect(header).toHaveAttribute("title", "Units on their way to Gudang Cabang, not yet accepted");

    await waitFor(() => expect(cellsOf(canvas, "SL-03-ANG-001")[5]).toHaveTextContent(/^25 pcs/));
    await expect(canvas.getByTestId("in-transit-SL-03-ANG-001")).toHaveTextContent(/^3 pcs$/);
    await expect(canvas.getByTestId("in-transit-SL-03-ANG-003")).toHaveTextContent(/^0 pcs$/);

    const tile = canvas.getByTestId("products-in-transit-stock");
    await waitFor(() => expect(tileValue(canvas)).toHaveTextContent(/^3 pcs$/));
    await expect(tile).toHaveTextContent("In transit · Gudang Cabang");
    await expect(tile).toHaveTextContent("Rp 137.100 · on its way to Gudang Cabang, at cost");
    await thePageDoesNotScrollSideways(canvasElement);
  },
};

/** THE SENDER'S LENS HAS NO COLUMN — only SL-03-ANG-001's 3 are on the road, Gudang Pusat → Gudang Cabang. Under Gudang
 * Pusat (the sender) nothing is on its way there: the tile reads 0 pcs and the list keeps today's eight columns, though
 * the team has units in transit elsewhere — the column follows the tile for THIS lens. */
export const TheSendersLensHasNoColumn: Story = {
  name: "Warehouse lens — the sender's, no column",
  beforeEach: onlyTheMinyak,
  render: () => <AtGudangPusat />,
  decorators: [besideTheOpenSidebar],
  globals: { viewport: { value: "desktop1440" } },
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await waitFor(() => expect(cellsOf(canvas, "SL-03-ANG-001")[5]).toHaveTextContent(/^54 pcs/));
    const tile = canvas.getByTestId("products-in-transit-stock");
    await waitFor(() => expect(tileValue(canvas)).toHaveTextContent(/^0 pcs$/));
    await expect(tile).toHaveTextContent("In transit · Gudang Pusat");

    const headers = headersOf(canvas);
    await expect(headers).toHaveLength(TODAYS_HEADERS.length);
    await expect(headers.filter((h) => h.startsWith("In transit"))).toHaveLength(0);
    await expect(canvas.queryByTestId("products-in-transit-header")).toBeNull();
    await expect(canvas.queryAllByTestId(/^in-transit-/)).toHaveLength(0);
  },
};
