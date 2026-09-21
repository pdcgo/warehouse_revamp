import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, waitFor, within } from "storybook/test";

import { ForgotPasswordResetPage, description } from "./index";

const meta = {
  title: "Legacy/Pages/Auth/ForgotPasswordReset",
  component: ForgotPasswordResetPage,
  parameters: { docs: { description: { component: description } }, layout: "fullscreen" },
  args: { onSubmit: fn() },
} satisfies Meta<typeof ForgotPasswordResetPage>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("reset-password")).toBeVisible();
    await expect(canvas.getByTestId("reset-submit")).toBeDisabled();
  },
};

// An expired link REPLACES the form. Nothing typed into those fields could have worked, so leaving
// them on screen only invites somebody to fill in a form and press a dead button.
export const ExpiredLinkReplacesTheForm: Story = {
  args: { expired: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("reset-expired")).toBeVisible();
    await expect(canvas.queryByTestId("reset-password")).toBeNull();
    // The one action that helps is offered, as a real link.
    await expect(canvas.getByRole("link", { name: /request a new link/i })).toHaveAttribute(
      "href",
      "/forgot-password",
    );
  },
};

export const MismatchBlocksSubmit: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);

    await userEvent.type(canvas.getByTestId("reset-password"), "hunter2", { delay: 20 });
    await userEvent.type(canvas.getByTestId("reset-confirm"), "hunter3", { delay: 20 });

    await waitFor(async () => {
      await expect(canvas.getByTestId("field-error")).toHaveTextContent("do not match");
    });
    await expect(args.onSubmit).not.toHaveBeenCalled();
  },
};
