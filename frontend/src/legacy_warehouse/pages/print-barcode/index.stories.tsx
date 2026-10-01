import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";

import { BARCODE_LABELS } from "../../fixtures";
import { PrintBarcodePage, description } from "./index";

const meta = {
  title: "LegacyWarehouse/Pages/PrintBarcode",
  component: PrintBarcodePage,
  parameters: { docs: { description: { component: description } } },
  args: { labels: BARCODE_LABELS },
} satisfies Meta<typeof PrintBarcodePage>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getAllByTestId("label")).toHaveLength(4);
  },
};

// ⚠ THE DIGITS UNDER THE BARS ARE NOT DECORATION. A scuffed label the scanner refuses is a daily
// occurrence on a warehouse floor, and this is what gets typed in instead.
export const EveryLabelIsHumanReadableToo: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    const codes = canvas.getAllByTestId("human-readable");
    await expect(codes).toHaveLength(4);
    await expect(codes[0]).toHaveTextContent("MLT-KAOS-M-NVY");
  },
};

// The barcode carries an accessible name, so the label is not an unlabelled graphic to anything
// that cannot see it.
export const TheBarcodeIsNamed: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getAllByRole("img")[0]).toHaveAccessibleName("Barcode MLT-KAOS-M-NVY");
  },
};

// ⚠ NO SHELL. This screen IS the print output, and app chrome on it is either wasted paper or a
// print stylesheet rule somebody has to maintain forever.
export const NoAppChrome: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.queryByTestId("warehouse-sidebar")).toBeNull();
    await expect(canvas.queryByRole("navigation")).toBeNull();
  },
};

// The sheet layout matches physical stationery, so the column count is a number rather than a
// breakpoint.
export const TwoUpStationery: Story = {
  args: { perRow: 2 },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getAllByTestId("label")).toHaveLength(4);
  },
};

// ⚠ AN EMPTY SHEET SAYS HOW TO FIX IT. This screen is reached by selecting rows elsewhere, so
// "nothing here" is always a mistake made on a previous screen — and the message has to say which.
export const NothingSelected: Story = {
  args: { labels: [] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("nothing-selected")).toHaveTextContent("Go back to Inbound");
  },
};
