import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";

import { BARCODE_LABELS } from "../../fixtures";
import { PrintBarcodeV2Page, description } from "./index";

const meta = {
  title: "LegacyWarehouse/Pages/PrintBarcodeV2",
  component: PrintBarcodeV2Page,
  parameters: { docs: { description: { component: description } } },
  args: { label: BARCODE_LABELS[0] },
} satisfies Meta<typeof PrintBarcodeV2Page>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("print")).toHaveTextContent("Print 1");
  },
};

// ⚠ THE WHOLE DIFFERENCE FROM THE SHEET VERSION. "Forty of this one" is the normal request when a
// carton arrives; the sheet screen makes you select the same row forty times.
export const ItAsksHowMany: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    const input = within(canvas.getByTestId("copies")).getByRole("spinbutton");
    await userEvent.clear(input);
    await userEvent.type(input, "40");

    await expect(canvas.getByTestId("print")).toHaveTextContent("Print 40");
  },
};

// The count is explained where it is used — one per unit received, which is the thing the operator
// is counting anyway.
export const TheCountIsExplainedInPlace: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByText("One per unit received.")).toBeVisible();
  },
};

// ⚠ THE SIZE MUST MATCH THE STOCK IN THE PRINTER. Printing a 100mm design onto a 58mm roll wastes
// the roll and the half hour it takes to notice.
export const SizeIsAChoiceWithAConsequence: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("preview")).toHaveAttribute("data-size", "58mm");

    await userEvent.selectOptions(within(canvas.getByTestId("size")).getByRole("combobox"), "100mm");
    await expect(canvas.getByTestId("preview")).toHaveAttribute("data-size", "100mm");
    await expect(canvas.getByText("Must match the stock in the printer.")).toBeVisible();
  },
};

// ⚠ ONE PREVIEW, NOT FORTY. The sheet is forty of this, and rendering forty identical previews tells
// the operator nothing they cannot already see.
export const OnePreviewNoMatterTheCount: Story = {
  args: { copies: 40 },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getAllByTestId("barcode")).toHaveLength(1);
    await expect(canvas.getByTestId("print")).toHaveTextContent("Print 40");
  },
};

// Where the goods are going, shown because printing a label and walking the goods to a shelf are
// the same errand.
export const TheRackIsShownBecauseItIsTheSameErrand: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("rack-chip")).toHaveTextContent("A-03-2");
  },
};

// And when there is no rack yet, it says "Unplaced" — the goods still need shelving, which is
// exactly what the person holding the printed label is about to do.
export const NotShelvedYet: Story = {
  args: { label: BARCODE_LABELS[2] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("rack-chip")).toHaveTextContent("Unplaced");
  },
};
