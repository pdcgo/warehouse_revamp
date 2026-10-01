import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, waitFor, within } from "storybook/test";

import { OrderCustomCreatePage, description } from "./index";

const meta = {
  title: "Legacy/Pages/Orders/OrderCustomCreate",
  component: OrderCustomCreatePage,
  parameters: { docs: { description: { component: description } } },
  args: { onSubmit: fn() },
} satisfies Meta<typeof OrderCustomCreatePage>;

export default meta;
type Story = StoryObj<typeof meta>;

// ⚠ THE SOURCES EXPLAIN THEMSELVES. They are not interchangeable labels — they decide who owes the
// money — and choosing wrongly surfaces as a reconciliation problem weeks later. A dropdown would
// hide these sentences behind a click.
export const EverySourceSaysWhatItMeans: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByText(/the money is owed by them/i)).toBeVisible();
    await expect(canvas.getByText(/settled on their statement/i)).toBeVisible();
    await expect(canvas.getByText(/deducted from pay/i)).toBeVisible();
  },
};

// Clicking the EXPLANATION selects the option — it is inside the label, so the sentence is part of
// the click target rather than a decoration beside it.
export const ClickingTheExplanationSelects: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(canvas.getByText(/deducted from pay/i));

    await waitFor(async () => {
      await expect(canvas.getByTestId("radio-staff")).toHaveAttribute("data-state", "checked");
    });
  },
};

export const BuyerIsRequired: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("custom-submit")).toBeDisabled();

    await userEvent.type(canvas.getByTestId("custom-buyer"), "Budi Santoso", { delay: 10 });
    await waitFor(async () => {
      await expect(canvas.getByTestId("custom-submit")).toBeEnabled();
    });

    await userEvent.click(canvas.getByTestId("custom-submit"));
    await expect(args.onSubmit).toHaveBeenCalled();
  },
};
