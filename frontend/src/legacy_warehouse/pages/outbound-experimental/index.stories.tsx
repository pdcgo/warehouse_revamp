import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, waitFor, within } from "storybook/test";

import { OUTBOUND_ROWS } from "../../fixtures";
import { OutboundScanPage, description } from "./index";

function scan(code: string) {
  for (const key of code) document.dispatchEvent(new KeyboardEvent("keypress", { key, bubbles: true }));
  document.dispatchEvent(new KeyboardEvent("keypress", { key: "Enter", bubbles: true }));
}

const meta = {
  title: "LegacyWarehouse/Pages/OutboundScan",
  component: OutboundScanPage,
  parameters: { docs: { description: { component: description } } },
  args: { rows: OUTBOUND_ROWS },
} satisfies Meta<typeof OutboundScanPage>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    // Three of the seven orders are packed and waiting.
    await expect(canvas.getByTestId("outstanding")).toHaveTextContent("3");
  },
};

// ⚠ THE INVERSION. There is no filter bar at all — the parcel identifies itself. Compare
// `LegacyWarehouse/Pages/Outbound`, which is 912 lines in the original and almost all of it filters.
export const NoFilterBarAtAll: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.queryByTestId("outbound-filters")).toBeNull();
    await expect(canvas.getByTestId("scan-station")).toBeVisible();
  },
};

// ⚠ THE GATE IS THE DIFFERENCE BETWEEN A GOOD DAY AND A LOST PARCEL. An order in the batch but not
// finished being packed is refused — and NOT as "not found", which would send the operator looking
// for a parcel that is in their hand.
export const AnUnpackedOrderIsRefusedByName: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    scan("JX0900");

    await waitFor(async () => {
      await expect(canvas.getByTestId("tally-wrong_status")).toHaveTextContent("Wrong status 1");
    });
    // It says WHICH order and WHY, not "unknown code".
    await expect(canvas.getByTestId("scan-result")).toHaveTextContent("OUT-7703");
    await expect(canvas.getByTestId("scan-result")).toHaveTextContent("still picked");
    await expect(canvas.getByTestId("tally-not_found")).toHaveTextContent("Not found 0");
  },
};

// The number the run is about is how many are LEFT, not how many are done — that is what tells the
// operator whether they can stop.
export const TheCounterCountsDown: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("outstanding")).toHaveTextContent("3");

    scan("JX0001");
    await waitFor(async () => {
      await expect(canvas.getByTestId("outstanding")).toHaveTextContent("2");
    });

    scan("JX0002");
    await waitFor(async () => {
      await expect(canvas.getByTestId("outstanding")).toHaveTextContent("1");
    });
  },
};

// ⚠ THE BREAKDOWN IS BY COURIER, not by team or shop. The parcels are physically handed over in
// courier piles, so that is the only grouping that matches what the operator is holding.
export const GroupedByCourierBecauseThatIsThePile: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    const breakdown = within(canvas.getByTestId("courier-breakdown"));
    await expect(breakdown.getByText("JNE")).toBeVisible();

    scan("JX0001");
    await waitFor(async () => {
      await expect(canvas.getAllByTestId("courier-row")[0]).toHaveTextContent("1 / 2");
    });
    // The other pile is untouched — the operator can see which courier still needs work.
    await expect(canvas.getAllByTestId("courier-row")[1]).toHaveTextContent("0 / 1");
  },
};

// Turning the gate off is legitimate — a batch being packed as it is scanned — but it removes the
// only thing stopping an unfinished parcel reaching a courier, so it says so.
export const TurningTheGateOffIsWarnedAbout: Story = {
  play: async ({ canvasElement, userEvent: ue }) => {
    const canvas = within(canvasElement);

    await expect(canvas.queryByTestId("gate-off-warning")).toBeNull();

    // Chakra v3 renders the switch as a visually-hidden checkbox behind a styled control, so the
    // accessible role is checkbox — clicking the label is what a person does anyway.
    await ue.click(within(canvas.getByTestId("scan-gate")).getByText("Packed only"));

    await waitFor(async () => {
      await expect(canvas.getByTestId("gate-off-warning")).toBeVisible();
    });
  },
};

// ⚠ THE SESSION IS EXPORTABLE, and only once something has been scanned. A handover dispute is
// settled by what was actually scanned, and the scan log is the only record of it.
export const ExportUnlocksOnceSomethingIsScanned: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("export-session")).toBeDisabled();

    scan("JX0001");
    await waitFor(async () => {
      await expect(canvas.getByTestId("export-session")).toBeEnabled();
    });
  },
};

// An unknown code is a real and different outcome — this parcel belongs to another day's batch, or
// to another warehouse.
export const AnUnknownParcel: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    scan("ZZ0000");
    await waitFor(async () => {
      await expect(canvas.getByTestId("scan-result")).toHaveTextContent("Not in today's batch");
    });
  },
};

export const NothingPackedYet: Story = {
  args: { rows: OUTBOUND_ROWS.filter((r) => r.status !== "packing_completed") },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("outstanding")).toHaveTextContent("0");
    await expect(canvas.getByTestId("movement-table")).toHaveTextContent("Nothing packed yet");
  },
};
