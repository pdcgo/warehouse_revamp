import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { warehouseStock } from "../../../../.storybook/fixtures";
import { AtTeh, DISCOVER_PRODUCT_DETAIL_META, EMPTY, GULA, STOCKED, loaded, routedAt, stockLoaded, tehIs } from "./kit";

// DISCOVER PRODUCT DETAIL — Buat Pesanan (the-order-and-restock-start-on-the-page): the warehouse and the quantity
// first, then the order form — and held back, with its reason, while locked or with nothing ready. The page's stories are
// grouped by the part of the screen they are about (stories-are-grouped-by-the-part-of-the-screen); what they share is
// ./kit.tsx.

const meta = {
  title: "Pages/Products/DiscoverProductDetail/Order",
  ...DISCOVER_PRODUCT_DETAIL_META,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

// BUAT PESANAN — the warehouse and the quantity first (the-order-and-restock-start-on-the-page): Gudang Cabang holds no
// Gula, so it cannot be picked; more than Gudang Pusat's 12 cannot continue. Then the order form with the product on it
// (a-product-page-opens-the-order-and-restock-forms). Discover opens no restock.
export const OrderOpensTheOrderForm: Story = {
  name: "Order form",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const shelf = warehouseStock[GULA.id.toString()]!;

    await expect(canvas.queryByTestId("discover-detail-restock")).toBeNull();
    await userEvent.click(canvas.getByTestId("discover-detail-order"));
    const dialog = await screen.findByTestId("start-order-dialog");

    await waitFor(() => expect(within(dialog).getByTestId(`start-warehouse-ready-${STOCKED.id}`)).toHaveTextContent(`${shelf} pcs`));
    await expect(within(dialog).getByTestId(`start-warehouse-ready-${EMPTY.id}`)).toHaveTextContent("Out of stock");

    const qty = within(dialog).getByTestId("start-quantity");
    await userEvent.clear(qty);
    await userEvent.type(qty, `${shelf + 1n}`, { delay: 40 });
    await expect(within(dialog).getByTestId("start-quantity-over")).toBeInTheDocument();
    await expect(within(dialog).getByTestId("start-order-continue")).toBeDisabled();

    await userEvent.clear(qty);
    await userEvent.type(qty, "3", { delay: 40 });
    await userEvent.click(within(dialog).getByTestId("start-order-continue"));

    await canvas.findByTestId("at-order-form");
    await expect(canvas.getByTestId("location-search")).toHaveTextContent(`?product=${GULA.id}&warehouse=${STOCKED.id}&qty=3`);
  },
};

// HELD BACK while another team may not order it — the owner's lock here — with the reason on it.
export const OrderIsHeldBackWhileLocked: Story = {
  name: "Held while locked",
  beforeEach: tehIs("crossLocked"),
  render: () => <AtTeh />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const order = canvas.getByTestId("discover-detail-order");

    await expect(order).toBeDisabled();
    await expect(order.parentElement).toHaveAttribute("title", expect.stringContaining("Locked by its owner"));
  },
};

// NOTHING READY IN ANY WAREHOUSE (an-empty-product-cannot-start-an-order) — team 15's Tepung holds no stock anywhere, so
// Buat Pesanan is held back with the reason; the form would only refuse it.
const AtTepung = routedAt(702n);
export const OrderIsHeldBackWithNoStock: Story = {
  name: "Held, no stock",
  render: () => <AtTepung />,
  play: async ({ canvasElement }) => {
    const canvas = await stockLoaded(canvasElement);
    const order = canvas.getByTestId("discover-detail-order");

    await waitFor(() => expect(order).toBeDisabled());
    await expect(order.parentElement).toHaveAttribute("title", "No stock is ready in any warehouse.");
  },
};
