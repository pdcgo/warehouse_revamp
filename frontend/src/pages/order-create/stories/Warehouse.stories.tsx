import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { products, shops } from "../../../../.storybook/fixtures";
import { ORDER_CREATE_META, fillOrderRef, fillSellPrice, pickOrderDate, pickProduct } from "./kit";

// ORDER CREATE — the band that leads the form: the team's default, a warehouse with no rate.
// The page's stories are grouped by the part of the screen they are about
// (stories-are-grouped-by-the-part-of-the-screen); what they share is ./kit.tsx.

const meta = {
  title: "Pages/Order/OrderCreate/Warehouse",
  ...ORDER_CREATE_META,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

// THE WAREHOUSE ARRIVES PRE-FILLED, from the team's configured default (#145) — and the picker is
// therefore usable on first paint. A default the SYSTEM invents would move real goods out of the
// wrong building; a default the TEAM configured is the team stating where it ships from.
export const WarehousePrefilledFromTheTeamDefault: Story = {
  name: "Prefilled from the team",
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    // "Pick a warehouse first" is the hint shown beside the disabled picker. Its ABSENCE is the
    // assertion: the pre-fill landed, so nothing is waiting on the person.
    await waitFor(() => expect(canvas.queryByTestId("order-create-need-warehouse")).toBeNull());
    await expect(canvas.getByTestId("order-create-add-line")).toBeEnabled();
  },
};

// ⚠ THE WAREHOUSE LEADS THE FORM (owner). It is not a field of the order — it is what every figure
// on the screen is measured against — so it sits in its own band above the cards. This pins the ORDER,
// because the whole point of the change is the reading order: which building → the order itself. (The strip
// saying what the screen cannot do yet sat above the band — it is gone with the last entry it listed, and
// `NothingOnTheFormIsMarkedNotImplemented` pins that.)
export const TheWarehouseLeadsTheForm: Story = {
  name: "Leads the form",
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    const top = (el: HTMLElement) => el.getBoundingClientRect().top;

    const band = canvas.getByTestId("order-warehouse-band");
    const firstCard = canvas.getByTestId("order-create-receipt-preview");

    await expect(top(band)).toBeLessThan(top(firstCard));

    // …and it left the Order Information card behind: the picker is in the band, nowhere else.
    await expect(canvas.getAllByTestId("order-warehouse")).toHaveLength(1);
    await expect(band).toContainElement(canvas.getByTestId("order-warehouse"));
  },
};

// A WAREHOUSE WITH NO RATE TAKES NO ORDERS (a-warehouse-with-no-rate-takes-no-orders): its own sentence appears under
// the picker and Create turns off — on an order that was placeable a moment earlier at the other warehouse.
export const AWarehouseWithNoRateRefusesTheOrder: Story = {
  name: "No rate, no order",
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.type(canvas.getByTestId("order-create-customer-name"), "Bu Ani", { delay: 40 });
    await userEvent.click(canvas.getByTestId("shop-select"));
    const shop = await canvas.findByTestId(`shop-select-option-${shops[0]!.id}`);
    await waitFor(() => expect(shop).toBeVisible());
    await userEvent.click(shop);
    await pickProduct(canvasElement, products[0]!.id);
    await pickOrderDate(canvasElement);
    await fillSellPrice(canvasElement);
    await fillOrderRef(canvasElement);

    const create = canvas.getByTestId("order-create-save");
    await waitFor(() => expect(create).toBeEnabled());
    await expect(canvas.queryByTestId("order-warehouse-fee-refused")).toBeNull();

    // Gudang Cabang never set its fee. TeamSelect portals, so its option is found on the screen.
    const input = within(canvas.getByTestId("order-warehouse")).getByRole("combobox");
    await userEvent.clear(input);
    await userEvent.type(input, "WH-02", { delay: 40 });
    const option = await screen.findByTestId("team-select-option-WH-02");
    await waitFor(() => expect(option).toBeVisible());
    await userEvent.click(option);

    await waitFor(() =>
      expect(canvas.getByTestId("order-warehouse-fee-refused")).toHaveTextContent("has not set its fee"),
    );
    await expect(create).toBeDisabled();
  },
};
