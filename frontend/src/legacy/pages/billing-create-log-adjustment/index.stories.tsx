import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, waitFor, within } from "storybook/test";

import { BillingCreateLogAdjustmentPage, description } from "./index";

const meta = {
  title: "Legacy/Pages/Billing/CreateLogAdjustment",
  component: BillingCreateLogAdjustmentPage,
  parameters: { docs: { description: { component: description } } },
  args: { onSubmit: fn() },
} satisfies Meta<typeof BillingCreateLogAdjustmentPage>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("create-log-screen")).toBeVisible();
    await expect(canvas.getByTestId("log-submit")).toBeDisabled();
  },
};

// ⚠ An adjustment additionally demands WHAT IT CORRECTS. One that does not say is
// indistinguishable from an unexplained change to the books.
export const CorrectingIsRequired: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.type(canvas.getByTestId("log-amount"), "250000", { delay: 10 });
    await userEvent.type(canvas.getByTestId("log-memo"), "Corrects a double-posted receipt", { delay: 5 });

    // Amount and memo are in, but the correction target is not — still blocked.
    await expect(canvas.getByTestId("log-submit")).toBeDisabled();

    await userEvent.type(canvas.getByTestId("log-reference"), "INV-9002", { delay: 10 });
    await waitFor(async () => {
      await expect(canvas.getByTestId("log-submit")).toBeEnabled();
    });
  },
};
