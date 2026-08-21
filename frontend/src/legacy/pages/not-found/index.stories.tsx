import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";

import { NotFoundPage, description } from "./index";

const meta = {
  title: "Legacy/Pages/NotFound",
  component: NotFoundPage,
  parameters: { docs: { description: { component: description } } },
} satisfies Meta<typeof NotFoundPage>;

export default meta;
type Story = StoryObj<typeof meta>;

// The way out is a REAL link, not a navigate() call — so middle-click and copy-link-address work,
// and the reader is not left with only the back button, which returns them to whatever produced the
// bad link.
export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("page-not-found")).toHaveTextContent("Page not found");
    await expect(canvas.getByRole("link", { name: /back to dashboard/i })).toHaveAttribute("href", "/");
  },
};
