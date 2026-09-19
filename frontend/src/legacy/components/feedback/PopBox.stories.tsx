import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Button, Stack, Text } from "@chakra-ui/react";
import { expect, screen, userEvent, waitFor } from "storybook/test";

import { PopBox, description } from "./PopBox";

const meta = {
  title: "Legacy/Components/Feedback/PopBox",
  component: PopBox,
  parameters: { docs: { description: { component: description } } },
  // Same as Modal: the stories drive the panel from a harness with local state, so these args only
  // satisfy the required props on the type.
  args: { open: false, onOpenChange: () => {} },
} satisfies Meta<typeof PopBox>;

export default meta;
type Story = StoryObj<typeof meta>;

function Harness(props: Partial<React.ComponentProps<typeof PopBox>>) {
  const [open, setOpen] = useState(false);

  return (
    <Stack gap="3">
      <Text fontWeight="medium">Inbound queue</Text>
      <Button onClick={() => setOpen(true)} data-testid="open">
        Open row 1
      </Button>

      <PopBox open={open} onOpenChange={setOpen} title="Inbound #4471" {...props}>
        <Text>14 items · supplier Ani · received 2 hours ago</Text>
      </PopBox>
    </Stack>
  );
}

// The queue case: open a row's panel, deal with it, close it — and the list behind is exactly where
// you left it, scroll, filters and page intact.
export const OpensBesideTheList: Story = {
  render: () => <Harness />,
  play: async () => {
    await userEvent.click(await screen.findByTestId("open"));

    await waitFor(async () => {
      await expect(screen.getByTestId("popbox")).toBeVisible();
    });

    await expect(screen.getByTestId("popbox")).toHaveTextContent("Inbound #4471");

    await userEvent.click(screen.getByTestId("popbox-close"));
    await waitFor(async () => {
      await expect(screen.queryByTestId("popbox")).toBeNull();
    });
  },
};

// Without a backdrop the panel is NOT modal, so the list behind stays usable — which is the whole
// point of the no-backdrop mode: pick a row, watch the panel update, pick the next.
export const NoBackdropLeavesTheListUsable: Story = {
  render: () => <Harness backdrop={false} />,
  play: async () => {
    await userEvent.click(await screen.findByTestId("open"));

    await waitFor(async () => {
      await expect(screen.getByTestId("popbox")).toBeVisible();
    });

    // The trigger behind it is still reachable — a focus trap would have made it inert.
    await expect(screen.getByTestId("open")).toBeEnabled();
  },
};

export const FullWidth: Story = { render: () => <Harness size="full" /> };
