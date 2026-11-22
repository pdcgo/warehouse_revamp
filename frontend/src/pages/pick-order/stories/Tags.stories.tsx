import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { asTeam, marker, routedPage } from "../../../../.storybook/pageStory";
import { DESKTOP, PHONE, TAG, TAG_VIEWPORTS, orderTagScenario } from "../../../../.storybook/orderTagScenario";
import { PickOrderPage } from "../index";

// THE PICK PAGE — THE ORDER'S TAGS (backlog #100, live since the-order-tags-prototype-is-accepted). The page the
// warehouse's list and Scan Label open (scan-label-opens-the-pick-page) — so the crew sees and tags the order's tags here
// (orders-have-their-own-tag-list: seen and tagged by the warehouse that ships the order): the Tags box of the order
// detail (OrderTagsBox), as a card before the notes, as a restock's Tag box sits before its note. The stub's
// OrderService plays the tags (.storybook/orderTagScenario.ts).

const Routed = (path: string) =>
  routedPage(
    [{ path: "/warehouse-orders/:orderId", element: <PickOrderPage /> }, marker("/warehouse-orders", "at-pick-queue")],
    path,
  );

const At101 = Routed("/warehouse-orders/101");

const meta = {
  title: "Pages/Order/PickOrderPage/Tags",
  component: PickOrderPage,
  parameters: { signedIn: true, dataRouter: true, layout: "fullscreen", viewport: { options: TAG_VIEWPORTS } },
  beforeEach: asTeam(11n),
  globals: DESKTOP,
  render: () => <At101 />,
} satisfies Meta<typeof PickOrderPage>;

export default meta;
type Story = StoryObj<typeof meta>;

/** THE CARD — 101's tags (the warehouse's *Kemasan Ulang* among the seller's), right before the notes, with the add box. */
export const TheTagsCard: Story = {
  name: "The Tags card, before the notes",
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const card = await canvas.findByTestId("pick-order-tags", {}, { timeout: 4000 });
    // The very next card is the notes'.
    await expect(card.nextElementSibling?.contains(canvas.getByTestId("pick-order-notes"))).toBe(true);

    await expect([...card.querySelectorAll("[data-testid='order-tags'] [data-tag-type]")].map((el) => el.textContent)).toEqual([
      "Kemasan Ulang",
      "Kirim Pagi",
      "VIP",
    ]);
    await expect(within(card).getByTestId("order-tag-add")).toBeVisible();
  },
};

/** THE CREW TAGS — it adds a tag from the orders' one list (Toko Kenanga's *Bonus Stiker*). */
export const TheCrewTags: Story = {
  name: "The crew puts a tag on",
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const card = await canvas.findByTestId("pick-order-tags", {}, { timeout: 4000 });
    const tags = within(card);
    const input = tags.getByTestId("order-tag-add-input");
    await userEvent.click(input);
    await userEvent.type(input, "bonus", { delay: 40 });
    const option = await screen.findByTestId(`order-tag-add-option-${TAG.bonusStiker}`, {}, { timeout: 3000 });
    await waitFor(() => expect(option).toBeVisible());
    await userEvent.click(option);
    await expect(await tags.findByTestId(`order-tag-${TAG.bonusStiker}`)).toHaveTextContent("Bonus Stiker");
    await expect(orderTagScenario.calls).toEqual([{ rpc: "OrderTagAdd", orderId: 101n, tagId: TAG.bonusStiker }]);
  },
};

/** ON A PHONE — the same card, the add box the full width; nothing runs off the 390 px screen. */
export const OnAPhone: Story = {
  name: "Phone — the card fits",
  globals: PHONE,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("pick-order-tags", {}, { timeout: 4000 });
    await expect(window.innerWidth).toBe(390);
    await expect(canvas.getByTestId("order-tag-add")).toBeVisible();
    await expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
  },
};
