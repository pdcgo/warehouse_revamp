import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, waitFor, within } from "storybook/test";

import { BillingCreateLogPage, description } from "./index";

const meta = {
  title: "Legacy/Pages/Billing/CreateLog",
  component: BillingCreateLogPage,
  parameters: { docs: { description: { component: description } } },
  args: { onSubmit: fn() },
} satisfies Meta<typeof BillingCreateLogPage>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("create-log-screen")).toBeVisible();
    await expect(canvas.getByTestId("log-submit")).toBeDisabled();
  },
};

// The MEMO is required — a hand-posted entry with no explanation is the one nobody can
// reconcile later.
export const MemoIsRequired: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.type(canvas.getByTestId("log-amount"), "250000", { delay: 10 });
    await expect(canvas.getByTestId("log-submit")).toBeDisabled();

    await userEvent.type(canvas.getByTestId("log-memo"), "Courier top-up", { delay: 5 });
    await waitFor(async () => {
      await expect(canvas.getByTestId("log-submit")).toBeEnabled();
    });
  },
};

// The reference is OPTIONAL here — not every hand entry has an external document.
export const ReferenceIsOptional: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("log-reference")).not.toBeRequired();
  },
};
