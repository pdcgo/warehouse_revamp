import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, waitFor, within } from "storybook/test";

import { RegisterPage, description } from "./index";

const meta = {
  title: "Legacy/Pages/Auth/Register",
  component: RegisterPage,
  parameters: { docs: { description: { component: description } }, layout: "fullscreen" },
  args: { onSubmit: fn() },
} satisfies Meta<typeof RegisterPage>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("auth-shell")).toHaveTextContent("Create an account");
    // Nothing typed yet, so nothing to submit.
    await expect(canvas.getByTestId("register-submit")).toBeDisabled();
  },
};

// THE one piece of client-side validation worth doing here: a typo in a password you cannot read is
// invisible until the next sign-in fails, and by then nobody knows what was actually typed.
export const MismatchIsCaughtBeforeSubmitting: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);

    await userEvent.type(canvas.getByTestId("register-password"), "hunter2", { delay: 20 });
    await userEvent.type(canvas.getByTestId("register-confirm"), "hunter3", { delay: 20 });

    await waitFor(async () => {
      await expect(canvas.getByTestId("field-error")).toHaveTextContent("do not match");
    });
    // And the button is blocked — submitting would create an account whose password is not the one
    // the person thinks they chose.
    await expect(canvas.getByTestId("register-submit")).toBeDisabled();
    await expect(args.onSubmit).not.toHaveBeenCalled();
  },
};

// An empty confirmation is NOT a mismatch — complaining before the field has been filled in would
// flag the form as wrong on arrival.
export const EmptyConfirmationIsNotAnError: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.type(canvas.getByTestId("register-password"), "hunter2", { delay: 20 });

    await expect(canvas.queryByTestId("field-error")).toBeNull();
  },
};

export const MatchingPasswordsSubmit: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);

    await userEvent.type(canvas.getByTestId("register-name"), "Ani Rahayu", { delay: 10 });
    await userEvent.type(canvas.getByTestId("register-username"), "ani.r", { delay: 10 });
    await userEvent.type(canvas.getByTestId("register-password"), "hunter2", { delay: 10 });
    await userEvent.type(canvas.getByTestId("register-confirm"), "hunter2", { delay: 10 });

    await userEvent.click(canvas.getByTestId("register-submit"));
    await expect(args.onSubmit).toHaveBeenCalled();
  },
};
