import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";

import { NoPermissionPage, description } from "./index";

const meta = {
  title: "Legacy/Pages/NoPermission",
  component: NoPermissionPage,
  parameters: { docs: { description: { component: description } } },
} satisfies Meta<typeof NoPermissionPage>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("page-no-permission")).toHaveTextContent("You do not have access");
  },
};

// A SPECIFIC noun turns the message from a category error into something a colleague can act on —
// the reader's next move differs entirely depending on whether they should have had this.
export const NamesWhatWasRefused: Story = {
  args: { what: "the billing screens" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("page-no-permission")).toHaveTextContent("the billing screens");
  },
};
