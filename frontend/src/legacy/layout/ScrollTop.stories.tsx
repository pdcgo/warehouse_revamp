import { useRef } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Box, Stack, Text } from "@chakra-ui/react";
import { expect, waitFor, within } from "storybook/test";

import { ScrollTop, description } from "./ScrollTop";

const meta = {
  title: "Legacy/Layout/ScrollTop",
  component: ScrollTop,
  parameters: { docs: { description: { component: description } } },
  // Both stories build their own scrolling pane and pass its ref, so this only satisfies the
  // required prop on the type — `render` replaces it.
  args: { scrollRef: { current: null } },
} satisfies Meta<typeof ScrollTop>;

export default meta;
type Story = StoryObj<typeof meta>;

function Harness() {
  const ref = useRef<HTMLDivElement>(null);

  return (
    <Box ref={ref} height="300px" overflowY="auto" borderWidth="1px" p="3" data-testid="pane">
      <Stack gap="2">
        {Array.from({ length: 40 }, (_, i) => (
          <Text key={i}>Row {i + 1}</Text>
        ))}
      </Stack>
      <ScrollTop scrollRef={ref} />
    </Box>
  );
}

// ⚠ IT LISTENS TO THE CONTENT PANE, NOT THE WINDOW. This shell scrolls its content area, so the
// document's own scroll position never changes and a window listener would never fire at all.
export const AppearsOnceThePaneIsScrolled: Story = {
  render: () => <Harness />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    // Nothing at the top — the top is already on screen, so a button to reach it is noise.
    await expect(canvas.queryByTestId("scroll-top")).toBeNull();

    const pane = canvas.getByTestId("pane");
    pane.scrollTop = 400;
    pane.dispatchEvent(new Event("scroll"));

    await waitFor(async () => {
      await expect(canvas.getByTestId("scroll-top")).toBeVisible();
    });
  },
};

// Scrolling back up removes it again — it exists only while there is somewhere to go.
export const DisappearsBackAtTheTop: Story = {
  render: () => <Harness />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const pane = canvas.getByTestId("pane");

    pane.scrollTop = 400;
    pane.dispatchEvent(new Event("scroll"));
    await waitFor(async () => {
      await expect(canvas.getByTestId("scroll-top")).toBeVisible();
    });

    pane.scrollTop = 0;
    pane.dispatchEvent(new Event("scroll"));
    await waitFor(
      async () => {
        await expect(canvas.queryByTestId("scroll-top")).toBeNull();
      },
      { timeout: 3000 },
    );
  },
};
