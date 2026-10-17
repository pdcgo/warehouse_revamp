import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { LocationProbe, asTeam, marker, pickTeam, routedPage } from "../../../.storybook/pageStory";
import { asRole } from "../../../.storybook/sessionScenario";
import { Role } from "../../gen/warehouse/role_base/v1/role_pb";
import { ProductsPage } from "./index";

// THE PRODUCTS LIST — a selling team's catalogue, AS THE SCREEN STANDS TODAY: the stat row, the search and the
// warehouse lens, the Active and Archived tabs, a row per product with its stock, cost and sales figures, locking in
// the row, Edit and Archive, Restore on the archived tab. The stub is productStub.ts, writeable, with the server's
// rules — a SKU once among the live, archive is soft, restore can collide.
//
// Toko Anggrek (team 15) holds 44 live products with invented but consistent figures:
//
//   SKU-ANG-001  Minyak Goreng Sawit 2L — Satuan     79 ready (30 + 24 in Gudang Pusat, 25 in Gudang Cabang)
//   SKU-ANG-003  Tepung Terigu Serbaguna 1kg — Satuan nothing on a shelf
//   archived:    SKU-ANG-001 (an older pack — its SKU now taken by the live one), SKU-ANG-LAMA

function asAnggrekOwner() {
  asTeam(15n)();
  asRole(Role.SELLING_OWNER)();
}

const routes = [
  { path: "/products", element: <><ProductsPage /><LocationProbe /></> },
  marker("/products/new", "at-product-new"),
  marker("/products/:productId", "at-product-detail"),
  marker("/products/:productId/edit", "at-product-edit"),
];
const At = (path: string) => routedPage(routes, path);
const AtProducts = At("/products");

const meta = {
  title: "Pages/Products/Products",
  component: AtProducts,
  parameters: { signedIn: true, dataRouter: true },
  beforeEach: asAnggrekOwner,
} satisfies Meta<typeof AtProducts>;

export default meta;
type Story = StoryObj<typeof meta>;

async function loaded(canvasElement: HTMLElement) {
  const canvas = within(canvasElement);
  await canvas.findByTestId("product-row-SKU-ANG-001", {}, { timeout: 5000 });
  return canvas;
}

async function openArchived(canvas: ReturnType<typeof within>) {
  await userEvent.click(canvas.getByTestId("products-tab-archived"));
  await waitFor(() => expect(canvas.getByTestId("product-row-SKU-ANG-LAMA")).toBeVisible());
}

// ── The states worth looking at ─────────────────────────────────────────────────────────────────

export const Default: Story = {};

/** A phone — the same table, as the screen stands today (it has no phone arrangement of its own yet). */
export const Mobile: Story = {
  globals: { viewport: { value: "mobile2" } },
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await expect(canvas.getByTestId("open-create-product")).toBeVisible();
  },
};

/** The archived half of the catalogue. */
export const Archived: Story = {
  render: () => <AtArchived />,
};
const AtArchived = At("/products?status=archived");

// ── The rules worth failing on ──────────────────────────────────────────────────────────────────

/** The stat row counts the live catalogue and adds up its stock; each row carries its own figures — a product with
 * nothing on a shelf reads 0 pcs, a stock read that answered, not an unknown. */
export const TheCatalogueAndItsFigures: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await waitFor(() => expect(canvas.getByTestId("products-total")).toHaveTextContent(/^44$/));
    await waitFor(() => expect(canvas.getByTestId("products-ready-stock")).toHaveTextContent("pcs"));
    await waitFor(() => expect(canvas.getByTestId("product-row-SKU-ANG-001")).toHaveTextContent("79 pcs"));
    await expect(canvas.getByTestId("product-row-SKU-ANG-001")).toHaveTextContent("Minyak Goreng Sawit 2L — Satuan");
    await expect(canvas.getByTestId("product-row-SKU-ANG-003")).toHaveTextContent("0 pcs");
  },
};

/** The warehouse lens restates every stock figure for that one building — the catalogue itself does not shrink. */
export const TheWarehouseLensRestatesTheStock: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await waitFor(() => expect(canvas.getByTestId("product-row-SKU-ANG-001")).toHaveTextContent("79 pcs"));

    await pickTeam(canvas.getByTestId("product-warehouse-filter"), "WH-02");
    await waitFor(() => expect(canvas.getByTestId("product-row-SKU-ANG-001")).toHaveTextContent("25 pcs"));
    await expect(canvas.getByTestId("products-total")).toHaveTextContent(/^44$/);
    await waitFor(() => expect(canvas.getByTestId("location-search")).toHaveTextContent("warehouse=14"));
  },
};

/** The search reads the name and the SKU, on the live tab. */
export const SearchesByNameOrSku: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.type(canvas.getByTestId("product-search"), "lada", { delay: 40 });
    await waitFor(() => expect(canvas.queryByTestId("product-row-SKU-ANG-001")).toBeNull());
    await expect(canvas.getByTestId("product-row-SKU-ANG-010")).toHaveTextContent("Lada Bubuk");
  },
};

/** The Archived tab holds the archived products only — and none of them opens a page or locks. */
export const TheArchivedTabHoldsTheArchived: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await openArchived(canvas);

    await expect(canvas.getByTestId("product-row-SKU-ANG-001")).toHaveTextContent("Kemasan Lama");
    await expect(canvas.queryByTestId("product-row-SKU-ANG-002")).toBeNull();
    await expect(canvas.getByTestId("restore-SKU-ANG-LAMA")).toBeVisible();
    await expect(within(canvas.getByTestId("locked-SKU-ANG-LAMA")).getByRole("checkbox")).toBeDisabled();
  },
};

/** Archive confirms first, naming the SKU — and the product moves to the Archived tab. */
export const ArchiveConfirmsFirst: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.click(canvas.getByTestId("delete-SKU-ANG-002"));
    const dialog = await screen.findByRole("alertdialog");
    await waitFor(() => expect(dialog).toBeVisible());
    await expect(dialog).toHaveTextContent("SKU-ANG-002");
    await userEvent.click(within(dialog).getByTestId("confirm-action"));
    await waitFor(() => expect(canvas.queryByTestId("product-row-SKU-ANG-002")).toBeNull());

    await openArchived(canvas);
    await expect(canvas.getByTestId("product-row-SKU-ANG-002")).toBeVisible();
  },
};

/** Restoring under a SKU a live product took meanwhile is refused, naming the holder — and the screen asks for a new
 * SKU and restores under that. */
export const RestoreCollidesAndAsksForANewSku: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await openArchived(canvas);

    await userEvent.click(canvas.getByTestId("restore-SKU-ANG-001"));
    const dialog = await screen.findByTestId("restore-conflict-dialog");
    await waitFor(() => expect(dialog).toBeVisible());
    await expect(dialog).toHaveTextContent("Minyak Goreng Sawit 2L — Satuan");

    await userEvent.type(within(dialog).getByTestId("restore-new-sku"), "SKU-ANG-001-L", { delay: 20 });
    await userEvent.click(within(dialog).getByTestId("restore-with-new-sku"));
    await waitFor(() => expect(canvas.queryByTestId("product-row-SKU-ANG-001")).toBeNull());
    await expect(canvas.getByTestId("product-row-SKU-ANG-LAMA")).toBeVisible();
  },
};

/** A free SKU restores at once — the product leaves the Archived tab. */
export const RestoreWithAFreeSku: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await openArchived(canvas);

    await userEvent.click(canvas.getByTestId("restore-SKU-ANG-LAMA"));
    await waitFor(() => expect(canvas.queryByTestId("product-row-SKU-ANG-LAMA")).toBeNull());
    await expect(screen.queryByTestId("restore-conflict-dialog")).toBeNull();
  },
};

/** Locking is edited in the row — the switch, not a trip into the product — and the row does not open under it. */
export const LockingIsEditedInTheRow: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const lock = within(canvas.getByTestId("locked-SKU-ANG-001")).getByRole("checkbox");

    await expect(lock).not.toBeChecked();
    await userEvent.click(canvas.getByTestId("locked-SKU-ANG-001"));
    await waitFor(() => expect(lock).toBeChecked());
    await expect(canvas.queryByTestId("at-product-detail")).toBeNull();
  },
};

/** A live row opens the product's page; Edit opens its form; New Product opens an empty one. */
export const RowsAndActionsOpenTheirPages: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.click(canvas.getByTestId("open-product-SKU-ANG-001"));
    await waitFor(() => expect(canvas.getByTestId("at-product-detail")).toBeInTheDocument());
  },
};

export const EditOpensTheForm: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.click(canvas.getByTestId("edit-SKU-ANG-001"));
    await waitFor(() => expect(canvas.getByTestId("at-product-edit")).toBeInTheDocument());
  },
};

export const NewProductOpensTheForm: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.click(canvas.getByTestId("open-create-product"));
    await waitFor(() => expect(canvas.getByTestId("at-product-new")).toBeInTheDocument());
  },
};

/** Opened at a URL holding a search, the list is narrowed by it (a-lists-filters-live-in-the-url). */
const AtSearched = At("/products?q=lada");
export const TheSearchComesBackFromTheUrl: Story = {
  render: () => <AtSearched />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(await canvas.findByTestId("product-search", {}, { timeout: 5000 })).toHaveValue("lada");
    await waitFor(() => expect(canvas.getByTestId("product-row-SKU-ANG-010")).toBeVisible());
    await expect(canvas.queryByTestId("product-row-SKU-ANG-001")).toBeNull();
  },
};
