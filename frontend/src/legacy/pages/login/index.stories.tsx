import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";

import { LoginPage, description } from "./index";

const meta = {
  title: "Legacy/Pages/Auth/Login",
  component: LoginPage,
  parameters: { docs: { description: { component: description } }, layout: "fullscreen" },
  args: { onSubmit: fn() },
} satisfies Meta<typeof LoginPage>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("auth-shell")).toHaveTextContent("Sign in");
  },
};

// Signing in is a two-field form people do every morning without looking. Reaching for the mouse to
// submit it is friction on the most-repeated action in the app.
export const EnterSubmits: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);

    await userEvent.type(canvas.getByTestId("login-username"), "ani.r", { delay: 20 });
    await userEvent.type(canvas.getByTestId("login-password"), "hunter2{Enter}", { delay: 20 });

    await expect(args.onSubmit).toHaveBeenCalledWith({ username: "ani.r", password: "hunter2" });
  },
};

// ⚠ ONE MESSAGE FOR BOTH FIELDS. "No account with that username" tells an attacker which usernames
// exist, so a failed sign-in never says which half was wrong — and it sits above the form, because
// it belongs to neither field.
export const FailureDoesNotSayWhichHalfWasWrong: Story = {
  args: { error: "That username and password do not match." },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    const error = canvas.getByTestId("login-error");
    await expect(error).toBeVisible();
    await expect(error).not.toHaveTextContent(/no account|unknown user|user not found/i);
    // Not attached to either field.
    await expect(canvas.queryByTestId("field-error")).toBeNull();
  },
};

export const Busy: Story = { args: { busy: true } };
