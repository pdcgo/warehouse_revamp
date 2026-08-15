import { useState } from "react";

import type { Meta, StoryObj } from "@storybook/react-vite";
import { Button } from "@chakra-ui/react";
import { expect, fn, screen, userEvent, waitFor, within } from "storybook/test";

import { ConfirmDialog } from "./ConfirmDialog";

const meta = {
  title: "Components/ConfirmDialog",
  component: ConfirmDialog,
  parameters: {
    docs: {
      description: {
        component:
          "The confirmation every destructive action goes through — delete, suspend, remove, reset. Not decoration: those are the things in this app that cannot be undone with a click, and each is one menu-item away. Triggers itself when given a `trigger`, or is controlled by the page when opened from a menu. Titles are Title Case.",
      },
    },
  },
  args: {
    title: "Delete Product",
    message: "Kopi Arabika 250g will be removed from the catalogue. This cannot be undone.",
    confirmLabel: "Delete",
    onConfirm: fn(async () => {}),
  },
} satisfies Meta<typeof ConfirmDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

// Self-triggering — the products and categories screens still use this shape.
export const WithTrigger: Story = {
  args: {
    trigger: <Button colorPalette="red">Delete</Button>,
  },
};

// Non-destructive variant: same confirmation, brand-coloured rather than red.
export const NotDestructive: Story = {
  args: {
    title: "Reset Password for ani",
    message: "A new password will be issued and every existing session signed out.",
    confirmLabel: "Reset Password",
    destructive: false,
    trigger: <Button>Reset password</Button>,
  },
};

export const OpenControlledByThePage: Story = {
  render: (args) => {
    const [open, setOpen] = useState(false);

    return (
      <>
        <Button onClick={() => setOpen(true)}>Open from a menu</Button>
        <ConfirmDialog {...args} open={open} onOpenChange={setOpen} />
      </>
    );
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(canvas.getByRole("button", { name: "Open from a menu" }));

    // Portalled, like every Chakra Dialog — and it animates in, so the node is in the DOM a beat
    // before it is visible. `waitFor` around the visibility check keeps the assertion meaningful.
    const title = await screen.findByText("Delete Product");
    await waitFor(() => expect(title).toBeVisible());
  },
};

export const ConfirmRunsTheActionThenCloses: Story = {
  args: { trigger: <Button colorPalette="red">Delete</Button> },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(canvas.getByRole("button", { name: "Delete" }));
    await userEvent.click(await screen.findByTestId("confirm-action"));

    await expect(args.onConfirm).toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByText("Delete Product")).toBeNull());
  },
};

// Cancelling must NOT run the action — the whole point of the dialog.
export const CancelDoesNothing: Story = {
  args: { trigger: <Button colorPalette="red">Delete</Button> },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(canvas.getByRole("button", { name: "Delete" }));
    await userEvent.click(await screen.findByRole("button", { name: "Cancel" }));

    await waitFor(() => expect(screen.queryByText("Delete Product")).toBeNull());
    await expect(args.onConfirm).not.toHaveBeenCalled();
  },
};

// A slow delete has to show it is running, or an impatient second click sends the request twice.
export const ShowsBusyWhileTheActionRuns: Story = {
  args: {
    trigger: <Button colorPalette="red">Delete</Button>,
    onConfirm: fn(() => new Promise<void>((resolve) => setTimeout(resolve, 400))),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(canvas.getByRole("button", { name: "Delete" }));

    const confirm = await screen.findByTestId("confirm-action");
    await userEvent.click(confirm);

    await waitFor(() => expect(confirm).toHaveAttribute("data-loading"));
  },
};
