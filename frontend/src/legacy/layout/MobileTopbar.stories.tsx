import type { Meta, StoryObj } from "@storybook/react-vite";
import { Box, Text } from "@chakra-ui/react";
import { Bell } from "lucide-react";
import { expect, userEvent, waitFor, within } from "storybook/test";

import { Button } from "../components/inputs/Button";
import { MobileTopbar, description } from "./MobileTopbar";
import { SidebarProvider, useSidebar } from "./SidebarContext";
import { TopbarSlot, description as slotDescription } from "./TopbarSlot";

const meta = {
  title: "Legacy/Layout/MobileTopbar",
  component: MobileTopbar,
  parameters: {
    docs: { description: { component: description } },
    // The bar is `hideFrom="md"`, so it only renders at phone width.
    viewport: { defaultViewport: "mobile1" },
  },
  args: { logo: <Text fontWeight="black">Warehouse</Text> },
} satisfies Meta<typeof MobileTopbar>;

export default meta;
type Story = StoryObj<typeof meta>;

function State() {
  const sidebar = useSidebar();
  return <Text data-testid="expanded">{String(sidebar?.expanded)}</Text>;
}

function Harness({ hideMenu, slots }: { hideMenu?: boolean; slots?: boolean }) {
  return (
    <SidebarProvider>
      <Box w="380px" borderWidth="1px">
        <MobileTopbar logo={<Text fontWeight="black">Warehouse</Text>} hideMenu={hideMenu} />
        {slots && (
          <TopbarSlot side="right">
            <Button size="xs" variant="ghost" icon={Bell} aria-label="Notifications" data-testid="page-action">
              3
            </Button>
          </TopbarSlot>
        )}
        <State />
      </Box>
    </SidebarProvider>
  );
}

// ONE control, two icons — not two buttons. The target stays put, so a second tap closes what the
// first opened without the button moving out from under the thumb.
export const MenuButtonToggles: Story = {
  render: () => <Harness />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("expanded")).toHaveTextContent("false");

    await userEvent.click(canvas.getByTestId("topbar-menu"));
    await expect(canvas.getByTestId("expanded")).toHaveTextContent("true");
    await expect(canvas.getByTestId("topbar-menu")).toHaveAttribute("aria-expanded", "true");

    await userEvent.click(canvas.getByTestId("topbar-menu"));
    await expect(canvas.getByTestId("expanded")).toHaveTextContent("false");
  },
};

// For a screen that is a step in a FLOW rather than a destination — a scanning session — opening
// the nav mid-task is not something to offer.
export const HiddenMenuForAFlowScreen: Story = {
  render: () => <Harness hideMenu />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.queryByTestId("topbar-menu")).toBeNull();
  },
};

// A PAGE puts its own controls in the bar, from inside itself — so the shell never becomes a switch
// statement over routes, and the controls unmount with the screen.
export const PageFillsASlot: Story = {
  parameters: { docs: { description: { story: slotDescription } } },
  render: () => <Harness slots />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    // ⚠ It resolves its target in an EFFECT — the slot mounts in the same commit as the page — so
    // the assertion waits rather than reading the first render.
    await waitFor(async () => {
      await expect(canvas.getByTestId("page-action")).toBeVisible();
    });
  },
};
