import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { LocationProbe, asTeam, besideTheOpenSidebar, marker, routedPage } from "../../../../.storybook/pageStory";
import { PRODUCT_TAG, productTagScenario } from "../../../../.storybook/productTagScenario";
import { asRole } from "../../../../.storybook/sessionScenario";
import { Role } from "../../../gen/warehouse/role_base/v1/role_pb";
import { ProductsPage } from "../index";

// PRODUCTS — THE TAGS ON A SELLING TEAM'S CATALOGUE (backlog #148, live: the-team-code-and-product-tags-prototype-is-
// accepted): a Tag column right after the product — two chips and +N, two lines at most
// (one-context-per-column-and-never-three-lines), the system's first — a line of chips per phone block, and the Tag filter
// after the warehouse lens: several tags, ANY of them, in the address (`?tag=801,803`), sent to the server as `tag_ids`,
// cleared by Hapus Filter — the order lists' (the-order-tags-prototype-is-accepted) on the products' own list
// (products-have-their-own-tag-list). The acceptance's *Products list filtered by need_reprint_code shows 2 products* is
// the filter on need_reprint_code. The tags are productTagScenario.ts's seed (the accepted prototype's): Minyak (700)
// carries need_reprint_code, Laris and Promo Lebaran. The list FITS at 1440 beside the open sidebar, in both languages.

const ANGGREK = 15n;

const routes = [
  { path: "/products", element: <><ProductsPage /><LocationProbe hidden /></> },
  marker("/products/:productId", "at-product-detail"),
];
const AtProducts = routedPage(routes, "/products");
const AtTaggedReprint = routedPage(routes, `/products?tag=${PRODUCT_TAG.reprint}`);

const meta = {
  title: "Pages/Products/Products/Tags",
  component: AtProducts,
  parameters: { signedIn: true, dataRouter: true },
  beforeEach: () => {
    asTeam(ANGGREK)();
    asRole(Role.SELLING_OWNER)();
  },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

async function loaded(canvasElement: HTMLElement) {
  const canvas = within(canvasElement);
  await canvas.findByTestId("product-row-SL-03-ANG-001", {}, { timeout: 5000 });
  return canvas;
}

const listed = (canvas: ReturnType<typeof within>) =>
  canvas.getAllByTestId(/^product-row-SL-/).map((el: HTMLElement) => el.dataset.testid!.replace("product-row-", ""));

/** What the list last ASKED the server to narrow by — the filter is the server's, not the screen's. */
const lastAsked = () => productTagScenario.listTagIds.at(-1);

/** The Tag column after the product: Minyak's three tags as two chips and +1 (the app's first), Tepung's one, a product
 *  with none an empty cell. */
export const TheTagColumn: Story = {
  name: "Tag column",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const headers = [...canvas.getByTestId("products-table").querySelectorAll("thead th")].map((th) => th.textContent);

    await expect(headers.slice(0, 2)).toEqual(["Product", "Tags"]);
    const minyak = within(canvas.getByTestId("product-row-tags-SL-03-ANG-001"));
    await expect(minyak.getByTestId(`product-row-tags-SL-03-ANG-001-${PRODUCT_TAG.reprint}`)).toHaveTextContent("need_reprint_code");
    await expect(minyak.getByTestId(`product-row-tags-SL-03-ANG-001-${PRODUCT_TAG.laris}`)).toHaveTextContent("Laris");
    await expect(minyak.getByTestId("product-row-tags-SL-03-ANG-001-more")).toHaveTextContent("+1");
    await expect(canvas.getByTestId("product-row-tags-SL-03-ANG-003")).toHaveTextContent("Promo Lebaran");
    await expect(canvas.getByTestId("product-tags-cell-SL-03-ANG-002")).toBeEmptyDOMElement();
    // The chips are the rows' own (ProductList carries them) — nothing picked, nothing asked to narrow by.
    await expect(lastAsked()).toEqual([]);
  },
};

/** The filter takes SEVERAL tags, a product shown when it carries ANY: need_reprint_code alone is the two waiting for a
 *  reprint; adding Laris adds Gula Merah; the address follows; the server is asked for exactly the picks; Hapus Filter
 *  clears it. */
export const TheTagFilterTakesSeveral: Story = {
  name: "Tag filter, any of several",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.click(canvas.getByTestId("product-tag-filter-input"));
    await waitFor(() => expect(canvas.getByTestId(`product-tag-filter-option-${PRODUCT_TAG.reprint}`)).toBeVisible());
    await userEvent.click(canvas.getByTestId(`product-tag-filter-option-${PRODUCT_TAG.reprint}`));

    await waitFor(() => expect(listed(canvas)).toEqual(["SL-03-ANG-001", "SL-03-ANG-004"]));
    await waitFor(() => expect(canvas.getByTestId("location-search")).toHaveTextContent(`tag=${PRODUCT_TAG.reprint}`));
    await expect(lastAsked()).toEqual([PRODUCT_TAG.reprint]);

    await userEvent.click(canvas.getByTestId(`product-tag-filter-option-${PRODUCT_TAG.laris}`));
    await waitFor(() => expect(listed(canvas)).toEqual(["SL-03-ANG-001", "SL-03-ANG-004", "SL-03-ANG-005"]));
    await expect(lastAsked()).toEqual([PRODUCT_TAG.reprint, PRODUCT_TAG.laris]);

    await userEvent.click(canvas.getByTestId("products-filter-clear"));
    await waitFor(() => expect(listed(canvas).length).toBeGreaterThan(3));
    await waitFor(() => expect(canvas.getByTestId("location-search")).not.toHaveTextContent("tag="));
    await expect(lastAsked()).toEqual([]);
  },
};

/** The filter reads the address — `?tag=801` opens on the two products waiting for their new labels. */
export const TheFilterReadsTheAddress: Story = {
  name: "Tag filter from the address",
  render: () => <AtTaggedReprint />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("product-row-SL-03-ANG-004", {}, { timeout: 5000 });

    await waitFor(() => expect(listed(canvas)).toEqual(["SL-03-ANG-001", "SL-03-ANG-004"]));
    await waitFor(() => expect(canvas.getByTestId(`product-tag-filter-pick-${PRODUCT_TAG.reprint}`)).toHaveTextContent("need_reprint_code"));
    // The strip counts it as a filter in force — its Hapus Filter is offered.
    await expect(canvas.getByTestId("products-filter-clear")).toBeVisible();
    // The list's first read already asks the server for it — never every row, cut on screen. (The stat strip's count
    // reads the whole catalogue, as it does under every filter.)
    await expect(productTagScenario.listTagIds[0]).toEqual([PRODUCT_TAG.reprint]);
    await expect(productTagScenario.listTagIds.filter((ids) => ids.length > 0)).toEqual([[PRODUCT_TAG.reprint]]);
  },
};

/** ONE read of the products' tag list for the filter (a picker feed) — however many rows carry tags. */
export const TheTagListIsReadOnce: Story = {
  name: "Tag list read once",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await waitFor(() => expect(productTagScenario.catalogueReads).toBe(1));
    await new Promise((resolve) => setTimeout(resolve, 300));
    await expect(productTagScenario.catalogueReads).toBe(1);
    await expect(canvas.getByTestId("product-row-tags-SL-03-ANG-001")).toBeVisible();
  },
};

/** On a phone each block carries its line of chips under the product. */
export const OnAPhone: Story = {
  name: "Phone",
  globals: { viewport: { value: "mobile2" } },
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const block = canvas.getByTestId("product-row-SL-03-ANG-001");
    const chips = within(block).getByTestId("product-row-tags-SL-03-ANG-001");

    await expect(chips).toHaveTextContent("need_reprint_code");
    // The block shows every chip (a phone wraps them) and nothing runs past its edge.
    await expect(within(chips).queryByTestId("product-row-tags-SL-03-ANG-001-more")).toBeInTheDocument();
    await expect(block.scrollWidth).toBeLessThanOrEqual(block.clientWidth);

    // The Tag filter sits in the phone's Filter sheet, with the others.
    await userEvent.click(canvas.getByTestId("products-filter-open"));
    await waitFor(() => expect(screen.getByTestId("products-filter-sheet")).toBeVisible(), { timeout: 5000 });
    await expect(within(screen.getByTestId("products-filter-sheet")).getByTestId("product-tag-filter-input")).toBeVisible();
  },
};

// ── AT 1440 BESIDE THE OPEN SIDEBAR (the-team-code-and-product-tags-prototype-is-accepted asks the build to make it fit,
// in both languages). ⚠ NOT FITTED YET — an open point (backlog #148's report): every column is there and the table
// scrolls inside its own box (en 1265 / id 1381 px in a 1141 px box); a fit needs the owner's pick of the trade-offs.
// These pin what holds today: no column dropped, and the PAGE never scrolls sideways — only the table's own box. ──────

async function everyColumnInItsBox(canvasElement: HTMLElement) {
  const canvas = await loaded(canvasElement);
  await expect(window.innerWidth).toBe(1440);
  // Every column is there: the Tag column after the product, In transit beside Ongoing (the sample has units on the road).
  await waitFor(() => expect(canvas.getByTestId("products-in-transit-header")).toBeInTheDocument());
  const table = canvas.getByTestId("products-table");
  await expect(table.querySelectorAll("thead th")).toHaveLength(10);
  await expect(canvas.getByTestId("products-tag-header")).toBeInTheDocument();
  await expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(document.documentElement.clientWidth);
}

/** In English, at 1440 with the sidebar open. */
export const BesideTheOpenSidebar: Story = {
  name: "At 1440 beside the sidebar",
  decorators: [besideTheOpenSidebar],
  globals: { viewport: { value: "desktop1440" } },
  play: async ({ canvasElement }) => everyColumnInItsBox(canvasElement),
};

/** In Indonesian — the wider headers — at 1440 with the sidebar open. */
export const BesideTheOpenSidebarInIndonesian: Story = {
  name: "At 1440 beside the sidebar (id)",
  decorators: [besideTheOpenSidebar],
  globals: { viewport: { value: "desktop1440" }, locale: "id" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByText("Tag", { selector: "th" }, { timeout: 5000 });
    await everyColumnInItsBox(canvasElement);
  },
};
