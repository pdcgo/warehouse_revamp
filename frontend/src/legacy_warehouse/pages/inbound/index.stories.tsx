import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";

import { INBOUND_ROWS, RETURN_ROWS } from "../../fixtures";
import { InboundPage, description } from "./index";

const meta = {
  title: "LegacyWarehouse/Pages/Inbound",
  component: InboundPage,
  parameters: { docs: { description: { component: description } } },
  args: { inbound: INBOUND_ROWS, returns: RETURN_ROWS },
} satisfies Meta<typeof InboundPage>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("movement-table")).toBeVisible();
  },
};

// ⚠ THE STATUS VOCABULARY CHANGES WITH THE TAB, because the underlying enum does not. `completed`
// is "received by warehouse" on new stock and "return accepted" on returns — same key, same column,
// different meaning. This is the finding recorded in status.ts, visible on a real screen.
export const TheTabChangesWhatTheStatusMeans: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getAllByTestId("movement-status")[0]).toHaveTextContent("Received by warehouse");

    await userEvent.click(canvas.getByRole("button", { name: /returns/i }));

    const badges = canvas.getAllByTestId("movement-status");
    await expect(badges[0]).toHaveTextContent("Return accepted");
    await expect(badges[0]).toHaveAttribute("data-status", "completed");
  },
};

// ⚠ THE BADGE COUNTS WHAT IS OUTSTANDING, not the total. The bench acts on what is still in transit
// and will land on them; a total of everything ever received tells them nothing.
export const TheBadgeIsOutstandingNotTotal: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    // Four inbound rows, of which two are still on their way.
    const tab = canvas.getByRole("button", { name: /new stock/i });
    await expect(tab).toHaveTextContent("2");
    await expect(canvas.getAllByTestId("movement-table")).toHaveLength(1);
  },
};

// A filter, not navigation: the bench flips between these many times an hour while working a pallet,
// and navigation tabs would put a history entry behind every flip.
export const TabsAreAFilterNotNavigation: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("choice-tabs")).toBeVisible();
    // No links — a NavTabs implementation would render anchors here.
    await expect(within(canvas.getByTestId("choice-tabs")).queryAllByRole("link")).toHaveLength(0);
  },
};

// Returns get their own colours in the original — pink and violet against inbound's blue and green.
// Worth keeping: a shelf filling up with returns should not look like one filling up with new stock.
export const ReturnsLookDifferentFromNewStock: Story = {
  args: { tab: "return" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    const badges = canvas.getAllByTestId("movement-status");
    await expect(badges[0]).toHaveAttribute("data-direction", "return");
  },
};

// Printing a barcode is a RECEIVING action — the label goes on as the box is opened, before the
// goods reach a shelf. It belongs here rather than in a printing section.
export const PrintingIsAReceivingAction: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("print-barcodes")).toBeVisible();
  },
};

export const Loading: Story = { args: { inbound: [], returns: [], loading: true } };

export const NothingArriving: Story = {
  args: { inbound: [], returns: [] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("movement-table")).toHaveTextContent("Nothing arriving");
  },
};
