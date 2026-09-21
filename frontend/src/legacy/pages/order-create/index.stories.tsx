import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, waitFor, within } from "storybook/test";

import { OrderCreatePage, description } from "./index";

const meta = {
  title: "Legacy/Pages/Orders/OrderCreate",
  component: OrderCreatePage,
  parameters: { docs: { description: { component: description } } },
  args: { onSubmit: fn() },
} satisfies Meta<typeof OrderCreatePage>;

export default meta;
type Story = StoryObj<typeof meta>;

// An empty order cannot be submitted — it would produce a record nobody can act on.
export const EmptyCannotBeSubmitted: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("empty-hint")).toHaveTextContent("No lines yet");
    await expect(canvas.getByTestId("order-create-submit")).toBeDisabled();
  },
};

// Lines are edited IN PLACE. Six lines through six dialogs would be six rounds of open-fill-confirm
// for what is one continuous act of typing.
export const LinesAreAddedInPlace: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(canvas.getByTestId("order-add-line"));
    await userEvent.click(canvas.getByTestId("order-add-line"));

    await waitFor(async () => {
      await expect(canvas.getAllByTestId("order-line")).toHaveLength(2);
    });
    // With lines present the order becomes submittable.
    await expect(canvas.getByTestId("order-create-submit")).toBeEnabled();
  },
};

export const RemovingALine: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(canvas.getByTestId("order-add-line"));
    await waitFor(async () => {
      await expect(canvas.getAllByTestId("order-line")).toHaveLength(1);
    });

    await userEvent.click(canvas.getByTestId("order-remove-line-1"));
    await waitFor(async () => {
      await expect(canvas.queryByTestId("order-line")).toBeNull();
    });
  },
};

// The running total is why this screen uses FormDetail: it stays in view while lines are added,
// rather than sitting below the form where you cannot see it as it changes.
export const TotalStaysInView: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("form-detail")).toHaveTextContent("Total");
  },
};
