import type { Meta, StoryObj } from "@storybook/react-vite";
import { Badge } from "@chakra-ui/react";
import { expect, fn, userEvent, within } from "storybook/test";

import { SupplierTabExport, description } from "./SupplierTabExport";

// A SUPPLIER PAGE TAB'S EXPORT — the table under it, as filtered (each-supplier-tab-exports-its-own-table), the file
// streamed on the order list's pattern (one-export-is-the-list-as-a-file).

const meta = {
  title: "Features/Suppliers/SupplierTabExport",
  component: SupplierTabExport,
  args: { testId: "tab-export", onExport: fn() },
  parameters: { docs: { description: { component: description } } },
} satisfies Meta<typeof SupplierTabExport>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A grey outline, its download icon, its name — pressed, it starts the tab's export. */
export const Desktop: Story = {
  play: async ({ canvasElement, args }) => {
    const button = within(canvasElement).getByTestId("tab-export");
    await expect(button).toHaveTextContent("Export");
    await expect(button.querySelector("svg.lucide-download")).not.toBeNull();

    await userEvent.click(button);
    await expect(args.onExport).toHaveBeenCalledTimes(1);
  },
};

/** While the file is written it reads the stream's count and cannot be pressed again. */
export const Exporting: Story = {
  args: { progress: { done: 200, total: 456 } },
  play: async ({ canvasElement, args }) => {
    const button = within(canvasElement).getByTestId("tab-export");
    await expect(button).toHaveTextContent("Exporting 200 / 456");
    await expect(button).toBeDisabled();
    await expect(args.onExport).not.toHaveBeenCalled();
  },
};

/** A tab whose rows are still invented (Produk) holds the place with its page's mark, and builds nothing. */
export const MarkedHoldsThePlace: Story = {
  args: { onExport: undefined, mark: <Badge data-testid="tab-export-mark">5</Badge> },
  play: async ({ canvasElement }) => {
    const button = within(canvasElement).getByTestId("tab-export");
    await expect(within(button).getByTestId("tab-export-mark")).toHaveTextContent("5");
  },
};

/** An invalid window asks nothing. */
export const Disabled: Story = {
  args: { disabled: true },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByTestId("tab-export")).toBeDisabled();
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
