import type { Meta, StoryObj } from "@storybook/react-vite";
import { Button, HStack } from "@chakra-ui/react";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { toaster } from "./Toaster";

const meta = {
  title: "Components/Toaster",
  parameters: {
    docs: {
      description: {
        component:
          "The app's ONE toast host, mounted once beside the router in main.tsx. Anything that needs to say something calls the exported `toaster` singleton — there is no per-screen toaster and no provider to thread. Bottom-end, pausing while the page is idle so a message is not spent while nobody is looking.",
      },
    },
  },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

// ⚠ These stories do NOT render <Toaster/> themselves. The preview decorator already mounts exactly
// one, the same way main.tsx does — and that is the point worth documenting: a second host would
// render every toast twice.
export const Kinds: Story = {
  render: () => (
    <HStack gap="3">
      <Button
        size="sm"
        onClick={() => toaster.create({ title: "Order confirmed", type: "success" })}
      >
        Success
      </Button>
      <Button
        size="sm"
        colorPalette="red"
        onClick={() =>
          toaster.create({
            title: "Could not cancel order",
            description: "The order has already shipped.",
            type: "error",
          })
        }
      >
        Error
      </Button>
      <Button size="sm" variant="outline" onClick={() => toaster.create({ title: "Saving…", type: "loading" })}>
        Loading
      </Button>
    </HStack>
  ),
};

export const ShowsAToast: Story = {
  render: () => (
    <Button
      data-testid="fire"
      onClick={() => toaster.create({ title: "Order confirmed", type: "success" })}
    >
      Confirm order
    </Button>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(canvas.getByTestId("fire"));

    // Portalled, so it lands on document.body rather than in the story canvas — and it slides in,
    // so it is briefly present-but-invisible.
    const toast = await screen.findByText("Order confirmed");
    await waitFor(() => expect(toast).toBeVisible());
  },
};

// An error carries a DESCRIPTION as well as a title: "Could not cancel order" alone leaves the
// operator with nothing to do next, and the reason is the actionable half.
export const ErrorCarriesTheReason: Story = {
  render: () => (
    <Button
      data-testid="fire"
      colorPalette="red"
      onClick={() =>
        toaster.create({
          title: "Could not cancel order",
          description: "The order has already shipped.",
          type: "error",
        })
      }
    >
      Cancel order
    </Button>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(canvas.getByTestId("fire"));

    const title = await screen.findByText("Could not cancel order");
    await waitFor(() => expect(title).toBeVisible());
    await expect(await screen.findByText("The order has already shipped.")).toBeVisible();
  },
};
