import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Button, Stack, Text } from "@chakra-ui/react";
import { Pencil } from "lucide-react";
import { expect, screen, userEvent, waitFor } from "storybook/test";

import { Modal, description } from "./Modal";

const meta = {
  title: "Legacy/Components/Feedback/Modal",
  component: Modal,
  parameters: { docs: { description: { component: description } } },
  // Every story here drives the dialog from its own harness, because an open/close test needs local
  // state. These args exist only to satisfy the required props on the type — `render` replaces them.
  args: { open: false, onOpenChange: () => {} },
} satisfies Meta<typeof Modal>;

export default meta;
type Story = StoryObj<typeof meta>;

function Harness(props: Partial<React.ComponentProps<typeof Modal>>) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button onClick={() => setOpen(true)} data-testid="open">
        Open
      </Button>
      <Modal
        open={open}
        onOpenChange={setOpen}
        title="Edit Product"
        icon={Pencil}
        footer={
          <Stack direction="row" gap="2" justify="flex-end">
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => setOpen(false)}>Save</Button>
          </Stack>
        }
        {...props}
      >
        <Text>Change the product's name, category and ref id.</Text>
      </Modal>
    </>
  );
}

// The dialog portals, so it lives outside canvasElement — queries go through `screen`.
export const OpensAndCloses: Story = {
  render: () => <Harness />,
  play: async () => {
    await userEvent.click(await screen.findByTestId("open"));

    await waitFor(async () => {
      await expect(screen.getByTestId("modal")).toBeVisible();
    });

    await userEvent.click(screen.getByTestId("modal-close"));

    await waitFor(async () => {
      await expect(screen.queryByTestId("modal")).toBeNull();
    });
  },
};

// `closable={false}` removes the ✕ AND the Escape/backdrop exits together. A dialog whose two exits
// disagree about whether it may be abandoned is worse than one with neither — it looks dismissible
// and then is not.
export const NotClosableHasNoExits: Story = {
  render: () => <Harness closable={false} />,
  play: async () => {
    await userEvent.click(await screen.findByTestId("open"));

    await waitFor(async () => {
      await expect(screen.getByTestId("modal")).toBeVisible();
    });

    await expect(screen.queryByTestId("modal-close")).toBeNull();

    await userEvent.keyboard("{Escape}");
    // Still there — Escape is off in lockstep with the ✕.
    await expect(screen.getByTestId("modal")).toBeVisible();
  },
};

// Titles are Title Case, per the app's dialog rule — "Delete Product", never "Delete product".
export const TitleCase: Story = {
  render: () => <Harness title="Delete Product" />,
  play: async () => {
    await userEvent.click(await screen.findByTestId("open"));

    await waitFor(async () => {
      await expect(screen.getByTestId("modal")).toHaveTextContent("Delete Product");
    });
  },
};
