import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";

import { SupplierTabExport, description } from "./SupplierTabExport";

// A SUPPLIER PAGE TAB'S EXPORT — the table under it, as filtered (each-supplier-tab-exports-its-own-table).

const meta = {
  title: "Features/Suppliers/SupplierTabExport",
  component: SupplierTabExport,
  args: { mark: null, testId: "tab-export" },
  parameters: { docs: { description: { component: description } } },
} satisfies Meta<typeof SupplierTabExport>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A grey outline, its download icon, its name. */
export const Desktop: Story = {
  play: async ({ canvasElement }) => {
    const button = within(canvasElement).getByTestId("tab-export");
    await expect(button).toHaveTextContent("Export");
    await expect(button.querySelector("svg.lucide-download")).not.toBeNull();
  },
};

/** On a phone — where it stands in the Filter sheet — it takes the full width, still labelled. */
export const OnAPhone: Story = {
  globals: { viewport: { value: "mobile2" } },
  play: async ({ canvasElement }) => {
    const button = within(canvasElement).getByTestId("tab-export");
    await expect(button).toHaveTextContent("Export");
    await expect(button.getBoundingClientRect().width).toBeGreaterThan(200);
  },
};
