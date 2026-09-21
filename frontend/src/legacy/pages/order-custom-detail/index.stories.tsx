import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";

import { ORDERS, ORDER_LINES } from "../../fixtures";
import { OrderCustomDetailPage, description } from "./index";

const meta = {
  title: "Legacy/Pages/Orders/OrderCustomDetail",
  component: OrderCustomDetailPage,
  parameters: { docs: { description: { component: description } } },
  args: {
    order: ORDERS[0],
    lines: ORDER_LINES,
    note: "Customer called about a damaged delivery; this replaces ORD-4102 at no charge.",
  },
} satisfies Meta<typeof OrderCustomDetailPage>;

export default meta;
type Story = StoryObj<typeof meta>;

// The note is FIRST and prominent — it is the only record of why a hand-raised order exists, and it
// is what somebody reconciling the books weeks later is looking for.
export const NoteIsProminent: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("custom-note-shown")).toHaveTextContent("damaged delivery");
  },
};

// No note is a PROBLEM, and the screen says so rather than leaving a blank where the explanation
// should be. A missing reason is exactly what makes a custom order impossible to reconcile.
export const MissingNoteIsFlagged: Story = {
  args: { note: undefined },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    const warning = canvas.getByTestId("custom-note-missing");
    await expect(warning).toBeVisible();
    await expect(warning).toHaveTextContent(/nobody reconciling this later will know/i);
  },
};

export const Cancelled: Story = { args: { order: ORDERS[4] } };
