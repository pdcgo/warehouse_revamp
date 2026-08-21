import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";

import { DWELL_TODAY, INBOUND_TODAY, INVOICE_TODAY, OUTBOUND_TODAY } from "../../fixtures";
import { DashboardPage, description } from "./index";

const meta = {
  title: "LegacyWarehouse/Pages/Dashboard",
  component: DashboardPage,
  parameters: { docs: { description: { component: description } } },
  args: { inbound: INBOUND_TODAY, outbound: OUTBOUND_TODAY, invoices: INVOICE_TODAY, dwell: DWELL_TODAY },
} satisfies Meta<typeof DashboardPage>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getAllByTestId("overview-card")).toHaveLength(3);
  },
};

// ⚠ EVERYTHING IS SCOPED TO TODAY, AND THERE IS NO PERIOD PICKER. The reader is deciding what to do
// in the next hour; a year-on-year comparison changes nothing about which trolley to load next.
// History lives on Warehouse insight, for a different reader.
export const NoPeriodPicker: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.queryByTestId("period-range-picker")).toBeNull();
    await expect(canvas.getByTestId("dashboard-page")).toHaveTextContent("Inbound today");
    await expect(canvas.getByTestId("dashboard-page")).toHaveTextContent("Outbound today");
  },
};

// ⚠ THE MEDIAN AND THE WORST ARE BOTH COLUMNS. The median is what the shift feels; the worst is what
// the customer feels, and only one of them is actionable. A single number hides the four-hour order.
export const TheWorstCaseIsAColumnNotAFootnote: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    const card = within(canvas.getByTestId("dwell-card"));
    await expect(card.getByRole("columnheader", { name: /median/i })).toBeVisible();
    await expect(card.getByRole("columnheader", { name: /worst/i })).toBeVisible();

    // The packed → courier row: a healthy 38m median hiding a 241m outlier.
    await expect(card.getByText("241m")).toBeVisible();
    await expect(card.getByText("38m")).toBeVisible();
  },
};

// The third card is the only thing on the screen that identifies a PROBLEM rather than reporting a
// number, so a queue that has stopped is visually marked rather than just present.
export const AStalledQueueIsMarked: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    const worst = within(canvas.getByTestId("dwell-card")).getByText("241m");
    await expect(worst).toHaveStyle({ fontWeight: "600" });
  },
};

export const Loading: Story = {
  args: { loading: true, inbound: [], outbound: [], invoices: [], dwell: [] },
};

// Nothing has happened yet — the start of a shift. The cards still render their states, so "no work"
// is distinguishable from "the screen did not load".
export const StartOfShift: Story = {
  args: {
    inbound: [{ state: "Sent to warehouse", orders: 0, units: 0 }],
    outbound: [{ state: "Awaiting processing", orders: 0, units: 0 }],
    invoices: [{ state: "Draft", orders: 0, units: 0 }],
    dwell: [],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("dwell-card")).toHaveTextContent("Nothing has moved yet today");
    await expect(canvas.getAllByTestId("overview-card")).toHaveLength(3);
  },
};
