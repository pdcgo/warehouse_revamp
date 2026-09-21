import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";

import { WAREHOUSES } from "../../fixtures";
import { WarehouseListPage, description } from "./index";

const meta = {
  title: "Legacy/Pages/Team/WarehouseList",
  component: WarehouseListPage,
  parameters: { docs: { description: { component: description } } },
  args: { warehouses: WAREHOUSES },
} satisfies Meta<typeof WarehouseListPage>;

export default meta;
type Story = StoryObj<typeof meta>;

// CARDS, not a table. The job here is choosing a place to work in, not scanning a column — and four
// rows do not need the headers and alignment a table spends the width on.
export const CardsNotATable: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("warehouse-3")).toBeVisible();
    await expect(canvas.queryByRole("table")).toBeNull();
  },
};

// A CLOSED warehouse is shown, not hidden — its stock still exists and still appears in history, so
// hiding it makes the totals impossible to reconcile.
export const ClosedWarehousesStillAppear: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByText("Closed")).toBeVisible();
    await expect(canvas.getByTestId("warehouse-11")).toBeVisible();
  },
};

export const Searching: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.type(canvas.getByTestId("search-input"), "bandung", { delay: 20 });

    // Waits on the card that DISAPPEARS. Waiting on the surviving one would pass instantly — it was
    // already on screen before the search — and the next assertion would then run before the 250ms
    // debounce had reported anything.
    await waitFor(async () => {
      await expect(canvas.queryByTestId("warehouse-3")).toBeNull();
    });
    await expect(canvas.getByTestId("warehouse-7")).toBeVisible();
  },
};

export const Loading: Story = { args: { warehouses: [], loading: true } };

export const Empty: Story = {
  args: { warehouses: [] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("empty-hint")).toHaveTextContent("No warehouses match");
  },
};
