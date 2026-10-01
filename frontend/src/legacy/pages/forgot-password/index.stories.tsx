import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, within } from "storybook/test";

import { ForgotPasswordPage, description } from "./index";

const meta = {
  title: "Legacy/Pages/Auth/ForgotPassword",
  component: ForgotPasswordPage,
  parameters: { docs: { description: { component: description } }, layout: "fullscreen" },
  args: { onSubmit: fn() },
} satisfies Meta<typeof ForgotPasswordPage>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("forgot-username")).toBeVisible();
  },
};

// ⚠ THE SAME MESSAGE EITHER WAY. Confirming that an account exists is an enumeration oracle —
// anybody could walk a list of names and learn which are registered. The copy is hedged on purpose.
export const SentMessageDoesNotConfirmTheAccountExists: Story = {
  args: { sent: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    const sent = canvas.getByTestId("forgot-sent");
    await expect(sent).toHaveTextContent(/if that account exists/i);
    // Never the confirming form.
    await expect(sent).not.toHaveTextContent(/we found|no account|does not exist/i);
    // The form is gone — there is nothing more to do on this screen.
    await expect(canvas.queryByTestId("forgot-username")).toBeNull();
  },
};

export const Busy: Story = { args: { busy: true } };
