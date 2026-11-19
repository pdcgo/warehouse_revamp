import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { orderShopFixScenario } from "../../../../.storybook/orderShopStub";
import { asTeam } from "../../../../.storybook/pageStory";
import { withOrderStatus } from "../../../../.storybook/sessionScenario";
import { addShopForStory, setShopWriter } from "../../../../.storybook/shopStub";
import { toaster } from "../../../components/feedback/Toaster";
import { Marketplace } from "../../../gen/warehouse/marketplace/v1/marketplace_pb";
import { OrderStatus } from "../../../gen/warehouse/selling/v1/order_pb";
import { ORDER_DETAIL_META, Routed, SELLER, WAREHOUSE } from "./kit";

// UBAH TOKO — an order filed under the wrong shop is fixed (an-orders-shop-is-fixed-and-counted-on-the-day): on the
// seller's Info card, beside the shop, from the order's handover on. The picker offers only the team's shops of the
// order's marketplace that the person may write; Next asks to confirm, naming both shops; the order then reads in the
// new shop and its notes name the move. The page's stories are grouped by the part of the screen they are about
// (stories-are-grouped-by-the-part-of-the-screen); what they share is ./kit.tsx.

const meta = {
  title: "Pages/Order/OrderDetailPage/ShopFix",
  ...ORDER_DETAIL_META,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

// Order #106 sits in Melati Official (Shopee). The fixtures hold one shop per marketplace, so the story adds a second
// Shopee shop to fix it to, and a third granted to nobody but person 61.
const AtOrder = Routed("/orders/106");

const SECOND_SHOPEE = { id: 26n, teamId: SELLER.id, name: "Melati Shopee Kedua", shopCode: "MEL-SH2", marketplace: Marketplace.SHOPEE };
const ONLY_61 = { id: 27n, teamId: SELLER.id, name: "Melati Shopee Grosir", shopCode: "MEL-SH3", marketplace: Marketplace.SHOPEE };

/**
 * THE FIX: the shop's own button opens the dialog on the order's shop now; only Shopee shops are offered (Melati Store,
 * on Tokopedia, is not); the shop it is in picks nothing new. Next names both shops; the fix closes the dialog, toasts,
 * and the page reads the new shop — and Catatan carries the note row the fix wrote.
 */
export const SellerFixesACompletedOrdersShop: Story = {
  name: "Seller fixes a completed order's shop",
  beforeEach: () => {
    toaster.remove();
    asTeam(SELLER.id)();
    withOrderStatus(106n, OrderStatus.COMPLETED)();
    addShopForStory(SECOND_SHOPEE);
  },
  render: () => <AtOrder />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await waitFor(() => expect(canvas.getByTestId("order-shop-name")).toHaveTextContent("Melati Official"));
    await userEvent.click(canvas.getByTestId("order-change-shop"));

    const box = await screen.findByTestId("change-shop-dialog");
    await waitFor(() => expect(box).toBeVisible());
    const dialog = within(box);
    await waitFor(() => expect(dialog.getByTestId("change-shop-current")).toHaveTextContent("Melati Official"));
    // Nothing picked, nothing to confirm.
    await expect(dialog.getByTestId("change-shop-next")).toBeDisabled();

    await userEvent.click(dialog.getByTestId("shop-select"));
    const option = await screen.findByTestId(`shop-select-option-${SECOND_SHOPEE.id}`);
    await waitFor(() => expect(option).toBeVisible());
    // The same marketplace only: Melati Store (Tokopedia) and Melati Grosir (Lazada) are not offered.
    await expect(screen.queryByTestId("shop-select-option-22")).toBeNull();
    await expect(screen.queryByTestId("shop-select-option-23")).toBeNull();
    await userEvent.click(option);

    await waitFor(() => expect(dialog.getByTestId("change-shop-next")).toBeEnabled());
    await userEvent.click(dialog.getByTestId("change-shop-next"));

    await expect(dialog.getByTestId("change-shop-confirm-text")).toHaveTextContent(
      "Move order #106 from Melati Official to Melati Shopee Kedua?",
    );
    await userEvent.click(dialog.getByTestId("change-shop-save"));

    await waitFor(() => expect(screen.queryByTestId("change-shop-dialog")).not.toBeInTheDocument());
    await expect(orderShopFixScenario.last).toMatchObject({ teamId: SELLER.id, orderId: 106n, shopId: SECOND_SHOPEE.id });
    await expect((await screen.findAllByText("Shop changed")).length).toBeGreaterThan(0);

    // The order reads in the new shop, and its notes name the move.
    await waitFor(() => expect(canvas.getByTestId("order-shop-name")).toHaveTextContent("Melati Shopee Kedua"));
    await waitFor(() =>
      expect(canvas.getAllByTestId("order-note-text").map((note) => note.textContent)).toContain(
        "Toko: Melati Official → Melati Shopee Kedua",
      ),
    );
  },
};

/**
 * A CS PICKS ONLY THE SHOPS GRANTED THEM (a-write-needs-a-grant-or-a-manager): person 62 holds Melati Official, not the
 * second Shopee shop — so the picker offers neither that one nor the one granted to 61 alone.
 */
export const ACsPicksOnlyTheShopsTheyMayWrite: Story = {
  name: "A CS picks only the shops they may write",
  beforeEach: () => {
    toaster.remove();
    asTeam(SELLER.id)();
    withOrderStatus(106n, OrderStatus.LOST)();
    addShopForStory(SECOND_SHOPEE, [62n]);
    addShopForStory(ONLY_61, [61n]);
    setShopWriter(62n);
  },
  render: () => <AtOrder />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    // Lost: the sale is still open, so the shop may still be fixed.
    await userEvent.click(await canvas.findByTestId("order-change-shop"));

    const box = await screen.findByTestId("change-shop-dialog");
    await waitFor(() => expect(box).toBeVisible());
    await waitFor(() => expect(within(box).getByTestId("change-shop-current")).toBeInTheDocument());

    await userEvent.click(within(box).getByTestId("shop-select"));
    await waitFor(() => expect(screen.getByTestId(`shop-select-option-${SECOND_SHOPEE.id}`)).toBeVisible());
    await expect(screen.queryByTestId(`shop-select-option-${ONLY_61.id}`)).toBeNull();
  },
};

/**
 * FROM HANDOVER ON (the owner's 2026-11-18 word on an-orders-shop-is-fixed-and-counted-on-the-day): a SHIPPED order is
 * fixed too — customer service sets the statuses after handover by hand, so an order the platform has paid can still
 * read shipped, and its statement imports only once the shop is right. The fix goes through and the page reads the new
 * shop.
 */
export const SellerFixesAShippedOrdersShop: Story = {
  name: "Seller fixes a shipped order's shop",
  beforeEach: () => {
    toaster.remove();
    asTeam(SELLER.id)();
    withOrderStatus(106n, OrderStatus.SHIPPED)();
    addShopForStory(SECOND_SHOPEE);
  },
  render: () => <AtOrder />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await waitFor(() => expect(canvas.getByTestId("order-shop-name")).toHaveTextContent("Melati Official"));
    await userEvent.click(canvas.getByTestId("order-change-shop"));

    const box = await screen.findByTestId("change-shop-dialog");
    await waitFor(() => expect(box).toBeVisible());
    const dialog = within(box);
    await waitFor(() => expect(dialog.getByTestId("change-shop-current")).toHaveTextContent("Melati Official"));

    await userEvent.click(dialog.getByTestId("shop-select"));
    const option = await screen.findByTestId(`shop-select-option-${SECOND_SHOPEE.id}`);
    await waitFor(() => expect(option).toBeVisible());
    await userEvent.click(option);

    await waitFor(() => expect(dialog.getByTestId("change-shop-next")).toBeEnabled());
    await userEvent.click(dialog.getByTestId("change-shop-next"));
    await userEvent.click(dialog.getByTestId("change-shop-save"));

    await waitFor(() => expect(screen.queryByTestId("change-shop-dialog")).not.toBeInTheDocument());
    await expect(orderShopFixScenario.last).toMatchObject({ teamId: SELLER.id, orderId: 106n, shopId: SECOND_SHOPEE.id });
    await waitFor(() => expect(canvas.getByTestId("order-shop-name")).toHaveTextContent("Melati Shopee Kedua"));
  },
};

/** Not before handover: a PICKED order is still in the building — its shop is shown, nothing beside it. */
export const NoFixBeforeHandover: Story = {
  name: "No fix before handover",
  beforeEach: () => {
    asTeam(SELLER.id)();
    withOrderStatus(106n, OrderStatus.PICKED)();
  },
  render: () => <AtOrder />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await waitFor(() => expect(canvas.getByTestId("order-shop-name")).toHaveTextContent("Melati Official"));
    await expect(canvas.queryByTestId("order-change-shop")).toBeNull();
  },
};

/** The warehouse reads the completed order on its own page, and is offered no fix: the shop is the seller's filing. */
export const TheWarehouseHasNoFix: Story = {
  name: "Warehouse, no fix",
  beforeEach: () => {
    asTeam(WAREHOUSE.id)();
    withOrderStatus(106n, OrderStatus.COMPLETED)();
  },
  render: () => <AtOrder />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await waitFor(() => expect(canvas.getByTestId("order-detail-title")).toBeInTheDocument());
    await expect(canvas.queryByTestId("order-change-shop")).toBeNull();
  },
};
