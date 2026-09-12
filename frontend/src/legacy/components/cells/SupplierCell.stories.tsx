import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";

import { SupplierCell, description } from "./SupplierCell";

const meta = {
  title: "Legacy/Components/Cells/SupplierCell",
  component: SupplierCell,
  parameters: { docs: { description: { component: description } } },
  args: { supplier: { id: 12n, name: "CV Sinar Jaya", code: "SJ-004" } },
} satisfies Meta<typeof SupplierCell>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("supplier-code")).toHaveTextContent("SJ-004");
  },
};

// The code is the string that gets retyped into a purchase order or a chat message — short enough
// to mistype without noticing, which is exactly why one click beats a selection drag.
export const CodeCopies: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(canvas.getByTestId("supplier-code"));

    await waitFor(async () => {
      await expect((window as unknown as { __copiedText?: string }).__copiedText).toBe("SJ-004");
    });
  },
};

export const NoCode: Story = {
  args: { supplier: { id: 12n, name: "CV Sinar Jaya" } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.queryByTestId("supplier-code")).toBeNull();
  },
};

export const Unresolved: Story = { args: { supplier: undefined, supplierId: 12n } };
