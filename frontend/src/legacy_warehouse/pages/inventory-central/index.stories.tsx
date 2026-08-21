import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";

import { INVENTORY_ROWS } from "../../fixtures";
import { InventoryPage, description } from "./index";

const meta = {
  title: "LegacyWarehouse/Pages/InventoryCentre",
  component: InventoryPage,
  parameters: { docs: { description: { component: description } } },
  args: { rows: INVENTORY_ROWS },
} satisfies Meta<typeof InventoryPage>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("inventory-table")).toBeVisible();
  },
};

// ⚠ ON HAND IS NOT AVAILABLE, AND THE DIFFERENCE IS A PICKER STANDING AT AN EMPTY SHELF.
// 142 on hand, 12 reserved, 0 damaged → 130 sellable. The original leads with 142.
export const AvailableLeadsNotOnHand: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    const headers = canvas.getAllByRole("columnheader").map((h) => h.textContent);
    // Available comes before On hand — the eye lands on the number that answers the question.
    await expect(headers.findIndex((h) => h?.includes("Available"))).toBeLessThan(
      headers.findIndex((h) => h?.includes("On hand")),
    );

    const firstRow = canvas.getAllByRole("row")[1];
    await expect(within(firstRow).getByText("130")).toBeVisible();
    await expect(within(firstRow).getByText("142")).toBeVisible();
  },
};

// ⚠ AVAILABLE CAN BE ZERO WHILE ON HAND IS NOT. Six of the seven dompet are promised, one is left —
// and a "7 in stock" headline is how the eighth gets sold.
export const ReservedStockIsNotSellable: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    const row = canvas.getByText("KNG-DOMPET-02").closest("tr")!;
    await expect(within(row).getByText("7")).toBeVisible();
    await expect(within(row).getByText("6")).toBeVisible();
    await expect(within(row).getByText("1")).toBeVisible();
  },
};

// ⚠ UNSHELVED STOCK IS ITS OWN FIGURE. It counts, the numbers balance, and no picker can find it —
// so it is called out rather than left to be noticed by whoever walks to the empty rack.
export const UnshelvedStockIsCountedSeparately: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    const summary = within(canvas.getByTestId("summary"));
    await expect(summary.getByText("SKUs unshelved")).toBeVisible();

    // And it renders as "Unplaced" in the row, not as a blank cell.
    const row = canvas.getByText("KNG-TAS-01").closest("tr")!;
    await expect(within(row).getByTestId("rack-chip")).toHaveTextContent("Unplaced");
  },
};

// ⚠ HOW OLD THE COUNT IS, not whether one happened. A SKU last counted a month ago is a guess, and
// "never counted" is worse — both look identical to a fresh count unless the date is on the row.
export const StaleCountsAreVisible: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    const row = canvas.getByText("KNG-TAS-01").closest("tr")!;
    await expect(within(row).getByText("Never")).toBeVisible();
  },
};

// Out of stock is shown, not hidden — the row with zero available is the one worth seeing, and
// filtering it away is how a re-order gets missed.
export const ZeroAvailableIsStillARow: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByText("AGK-SEPATU-40")).toBeVisible();
  },
};

export const Search: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.type(canvas.getByTestId("inventory-search"), "kaos");
    await expect(canvas.getAllByRole("row")).toHaveLength(3);
  },
};

export const NoMatches: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.type(canvas.getByTestId("inventory-search"), "zzzz");
    await expect(canvas.getByTestId("inventory-table")).toHaveTextContent("No products match");
  },
};

export const Loading: Story = { args: { rows: [], loading: true } };
