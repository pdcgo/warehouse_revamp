import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { asTeam, marker, pickTeam, routedPage } from "../../../.storybook/pageStory";
import { asRole } from "../../../.storybook/sessionScenario";
import { Role } from "../../gen/warehouse/role_base/v1/role_pb";
import { ProductDetailPage } from "./index";

// A PRODUCT'S PAGE — AS THE SCREEN STANDS TODAY: the name, SKU and category, Edit and Archive (Restore when archived),
// and four tabs — Info, Price (the cost layers), Batch (the deliveries) and Stock history (the movements) — the last
// three under one warehouse lens. The stub is productStub.ts, its figures consistent across the tabs:
//
//   700  SKU-ANG-001  Minyak Goreng Sawit 2L — Satuan   (Toko Anggrek, team 15)
//        info        two pictures, a description, 12.5% markup, 4 held back
//        batch 7001  Gudang Pusat   ready 30 of 60  @ Rp 45.700
//        batch 7002  Gudang Cabang  ready 25 of 40  @ Rp 47.200
//        batch 7003  Gudang Pusat   ready 24 of 24  @ Rp 46.500     → 79 ready, Rp 3.667.000
//        history     receive 60, pick 30, receive 40, pick 15, receive 24 → balance 79
//   790  SKU-ANG-001  the archived older pack — its SKU now held by 700
//    74  another team's product — not found here

function asAnggrekOwner() {
  asTeam(15n)();
  asRole(Role.SELLING_OWNER)();
}

const routes = [
  { path: "/products/:productId", element: <ProductDetailPage /> },
  marker("/products", "at-products"),
  marker("/products/:productId/edit", "at-product-edit"),
];
const At = (productId: number) => routedPage(routes, `/products/${productId}`);
const AtMinyak = At(700);
const AtArchivedPack = At(790);
const AtOtherTeams = At(74);

const meta = {
  title: "Pages/Products/ProductDetail",
  component: AtMinyak,
  parameters: { signedIn: true, dataRouter: true },
  beforeEach: asAnggrekOwner,
} satisfies Meta<typeof AtMinyak>;

export default meta;
type Story = StoryObj<typeof meta>;

async function loaded(canvasElement: HTMLElement) {
  const canvas = within(canvasElement);
  await canvas.findByTestId("product-detail-page", {}, { timeout: 5000 });
  return canvas;
}

async function openTab(canvas: ReturnType<typeof within>, tab: "price" | "batch" | "history") {
  await userEvent.click(canvas.getByTestId(`pd-tab-${tab}`));
  await waitFor(() => expect(canvas.getByTestId(`pd-${tab}-panel`)).toBeVisible());
}

// ── The states worth looking at ─────────────────────────────────────────────────────────────────

export const Default: Story = {};

/** A phone — the same page, as it stands today (it has no phone arrangement of its own yet). */
export const Mobile: Story = {
  globals: { viewport: { value: "mobile2" } },
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await expect(canvas.getByTestId("product-detail-name")).toHaveTextContent("Minyak Goreng Sawit 2L — Satuan");
  },
};

/** An archived product — reachable by URL, so the page says so and offers Restore instead of Edit. */
export const AnArchivedProduct: Story = {
  render: () => <AtArchivedPack />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(canvas.getByTestId("product-detail-archived")).toBeVisible();
    await expect(canvas.getByTestId("product-detail-restore")).toBeVisible();
    await expect(canvas.queryByTestId("product-detail-edit")).toBeNull();
  },
};

// ── The rules worth failing on ──────────────────────────────────────────────────────────────────

/** The heading is the product's name; under it its SKU and its category's path. */
export const TheProductsName: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(canvas.getByTestId("product-detail-name")).toHaveTextContent(/^Minyak Goreng Sawit 2L — Satuan$/);
    await waitFor(() => expect(canvas.getByTestId("product-detail-page")).toHaveTextContent("SKU-ANG-001 · Rumah Tangga"));
  },
};

/** Info is the record itself: the gallery opening on the cover, the hold-back as a count, the markup as a percent. A
 * product with no pictures says so instead of drawing an empty frame. */
export const TheInfoTabIsTheRecord: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(canvas.getByTestId("product-detail-images")).toBeVisible();
    await expect(canvas.getByTestId("product-detail-image-1")).toBeInTheDocument();
    await expect(canvas.getByTestId("product-detail-reserved")).toHaveTextContent("4 pcs");
    await expect(canvas.getByTestId("product-detail-info-markup")).toHaveTextContent("12.5%");
    await expect(canvas.getByTestId("product-detail-page")).toHaveTextContent("Minyak goreng kelapa sawit");
  },
};

export const AProductWithNoPictures: Story = {
  render: () => <AtArchivedPack />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await expect(canvas.getByTestId("product-detail-no-images")).toBeVisible();
  },
};

/** Price lists the cost layers still holding stock — one per delivery — and values them together. */
export const ThePriceTabListsTheLayers: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await openTab(canvas, "price");

    await waitFor(() => expect(canvas.getByTestId("pd-price-row-2")).toBeVisible());
    await expect(canvas.queryByTestId("pd-price-row-3")).toBeNull();
    await expect(canvas.getByTestId("pd-price-total")).toHaveTextContent("3.667.000");
  },
};

/** Batch lists the deliveries, newest first; the warehouse lens narrows them to one building. */
export const TheBatchTabAndItsLens: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await openTab(canvas, "batch");

    await waitFor(() => expect(canvas.getByTestId("pd-batch-row-7001")).toBeVisible());
    const rows = within(canvas.getByTestId("pd-batch-table")).getAllByTestId(/^pd-batch-row-/);
    await expect(rows.map((r) => r.dataset.testid)).toEqual(["pd-batch-row-7003", "pd-batch-row-7002", "pd-batch-row-7001"]);

    await pickTeam(canvas.getByTestId("pd-batch-warehouse-filter"), "WH-02");
    await waitFor(() => expect(canvas.queryByTestId("pd-batch-row-7001")).toBeNull());
    await expect(canvas.getByTestId("pd-batch-row-7002")).toBeVisible();
  },
};

/** Stock history lists every receipt and pick, newest first — five movements ending on the 79 ready. */
export const TheStockHistoryTab: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await openTab(canvas, "history");

    await waitFor(() => expect(canvas.getByTestId("pd-history-row-70005")).toBeVisible());
    const rows = within(canvas.getByTestId("pd-history-table")).getAllByTestId(/^pd-history-row-/);
    await expect(rows).toHaveLength(5);
    await expect(rows[0]!.dataset.testid).toBe("pd-history-row-70005");
  },
};

/** Archive confirms first, naming the SKU — and the page then says the product is archived. */
export const ArchiveConfirmsFirst: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.click(canvas.getByTestId("product-detail-archive"));
    const dialog = await screen.findByRole("alertdialog");
    await waitFor(() => expect(dialog).toBeVisible());
    await expect(dialog).toHaveTextContent("SKU-ANG-001");

    await userEvent.click(within(dialog).getByTestId("confirm-action"));
    await waitFor(() => expect(canvas.getByTestId("product-detail-archived")).toBeVisible());
    await expect(canvas.getByTestId("product-detail-restore")).toBeVisible();
  },
};

/** Restoring the older pack collides — its SKU is now SKU-ANG-001's live product — and restores under a new one. */
export const RestoreCollidesAndAsksForANewSku: Story = {
  render: () => <AtArchivedPack />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.click(canvas.getByTestId("product-detail-restore"));
    const dialog = await screen.findByTestId("restore-conflict-dialog");
    await waitFor(() => expect(dialog).toBeVisible());
    await userEvent.type(within(dialog).getByTestId("restore-new-sku"), "SKU-ANG-001-L", { delay: 20 });
    await userEvent.click(within(dialog).getByTestId("restore-with-new-sku"));

    await waitFor(() => expect(canvas.queryByTestId("product-detail-archived")).toBeNull());
    await expect(canvas.getByTestId("product-detail-page")).toHaveTextContent("SKU-ANG-001-L");
  },
};

/** Edit opens the product's form; Back returns to the list. */
export const EditOpensTheForm: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.click(canvas.getByTestId("product-detail-edit"));
    await waitFor(() => expect(canvas.getByTestId("at-product-edit")).toBeInTheDocument());
  },
};

export const BackGoesToTheList: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.click(canvas.getByTestId("product-detail-back"));
    await waitFor(() => expect(canvas.getByTestId("at-products")).toBeInTheDocument());
  },
};

/** Another team's product is not found — the id in the URL is not trusted to belong to the team in hand. */
export const AnotherTeamsProductIsNotFound: Story = {
  render: () => <AtOtherTeams />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByTestId("product-detail-error", {}, { timeout: 5000 })).toBeVisible();
  },
};
