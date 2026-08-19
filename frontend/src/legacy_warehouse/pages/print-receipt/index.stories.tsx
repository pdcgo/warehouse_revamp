import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";

import { RECEIPT_JOBS } from "../../fixtures";
import { PrintReceiptPage, description } from "./index";

const meta = {
  title: "LegacyWarehouse/Pages/PrintReceipt",
  component: PrintReceiptPage,
  parameters: { docs: { description: { component: description } } },
  args: { jobs: RECEIPT_JOBS },
} satisfies Meta<typeof PrintReceiptPage>;

export default meta;
type Story = StoryObj<typeof meta>;

// ⚠ PRINTED ROWS START UNSELECTED. "Select all" on a batch where half are done is the single most
// likely way to produce a pile of duplicate labels, so the default is what is OUTSTANDING.
export const PrintedRowsStartUnselected: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    // Two of the four are already printed; the two that are not are pre-selected.
    await expect(canvas.getByTestId("print-receipt-page")).toHaveTextContent("2 selected");
    await expect(canvas.queryByTestId("reprint-warning")).toBeNull();
  },
};

// ⚠ REPRINTING IS ALLOWED — a jammed printer or a smudged label must not strand the operator, who
// will otherwise work around it by reprinting the whole batch.
export const ReprintingIsPossible: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    const printed = canvas.getAllByTestId("job-checkbox").find((c) => c.getAttribute("data-awb") === "JX0001")!;
    await userEvent.click(printed);

    await expect(canvas.getByTestId("print-receipt-page")).toHaveTextContent("3 selected");
  },
};

// ⚠ AND IT IS MARKED. Two scannable copies of one label is how a parcel goes out under the wrong
// waybill — so the batch says so BEFORE the print, not after.
export const AReprintIsWarnedAboutBeforeTheClick: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    const printed = canvas.getAllByTestId("job-checkbox").find((c) => c.getAttribute("data-awb") === "JX0001")!;
    await userEvent.click(printed);

    await expect(canvas.getByTestId("reprint-warning")).toHaveTextContent("throw the old one away");
  },
};

// The row itself says it has been printed, so the state is visible even without selecting anything.
export const AlreadyPrintedIsVisibleOnTheRow: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getAllByTestId("already-printed")).toHaveLength(2);
  },
};

// Nothing selected means nothing to do, and the button says so rather than printing an empty batch.
export const PrintIsDisabledWithNothingSelected: Story = {
  args: { jobs: RECEIPT_JOBS.map((j) => ({ ...j, printed: true })) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("print")).toBeDisabled();
  },
};

export const NothingToPrint: Story = {
  args: { jobs: [] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("receipt-table")).toHaveTextContent("Nothing to print");
  },
};

export const Loading: Story = { args: { jobs: [], loading: true } };
