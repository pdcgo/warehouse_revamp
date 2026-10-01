import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";

import { AuthErrorPage, description } from "./index";

const meta = {
  title: "Legacy/Pages/AuthError",
  component: AuthErrorPage,
  parameters: { docs: { description: { component: description } } },
  args: { onLogout: fn() },
} satisfies Meta<typeof AuthErrorPage>;

export default meta;
type Story = StoryObj<typeof meta>;

// RELOAD FIRST, sign-out second. Most auth failures here are transient — an expired token in a tab
// left open — and reloading costs nothing, where signing out throws away whatever was open.
export const ReloadIsOfferedBeforeSignOut: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    const buttons = canvas.getAllByRole("button");
    await expect(buttons[0]).toHaveTextContent(/reload/i);
    await expect(buttons[1]).toHaveTextContent(/sign out/i);
  },
};

export const SignOutCalls: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);

    await userEvent.click(canvas.getByTestId("auth-error-logout"));
    await expect(args.onLogout).toHaveBeenCalled();
  },
};
