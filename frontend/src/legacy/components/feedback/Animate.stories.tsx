import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Box, Button, Stack } from "@chakra-ui/react";
import { expect, userEvent, waitFor, within } from "storybook/test";

import { Animate, description } from "./Animate";

const meta = {
  title: "Legacy/Components/Feedback/Animate",
  component: Animate,
  parameters: { docs: { description: { component: description } } },
} satisfies Meta<typeof Animate>;

export default meta;
type Story = StoryObj<typeof meta>;

function Toggling() {
  const [show, setShow] = useState(false);

  return (
    <Stack gap="3" w="280px">
      <Button size="sm" onClick={() => setShow((s) => !s)} data-testid="toggle">
        {show ? "Hide" : "Show"}
      </Button>

      <Animate show={show}>
        <Box borderWidth="1px" borderRadius="l3" p="3" data-testid="panel">
          The panel
        </Box>
      </Animate>
    </Stack>
  );
}

// Mounting is the easy half. The reason this component exists is the EXIT: a plain `{show && …}`
// removes the node on the same tick the flag flips, so the leave keyframes never get a frame and the
// panel blinks out. Here it survives long enough to animate away.
export const MountsAndUnmounts: Story = {
  render: () => <Toggling />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.queryByTestId("panel")).toBeNull();

    await userEvent.click(canvas.getByTestId("toggle"));
    await waitFor(async () => {
      await expect(canvas.getByTestId("panel")).toBeVisible();
    });

    await userEvent.click(canvas.getByTestId("toggle"));
    // It is NOT gone immediately — it is animating out — but it does eventually unmount rather than
    // lingering hidden with its subtree and queries still alive.
    await waitFor(
      async () => {
        await expect(canvas.queryByTestId("panel")).toBeNull();
      },
      { timeout: 3000 },
    );
  },
};

// Any truthy value works, not just a boolean, so `show={selectedId}` reads better than
// `show={selectedId !== undefined}` at every call site.
export const TruthyValueShows: Story = {
  render: () => (
    <Animate show={42n}>
      <Box data-testid="panel">Shown by a bigint id</Box>
    </Animate>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("panel")).toBeVisible();
  },
};
