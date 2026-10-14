import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";

import { RelatedWarehouses, VISIBLE_WAREHOUSES, description } from "./RelatedWarehouses";
import type { SupplierWarehouse } from "./sampleWarehouses";

// GUDANG TERKAIT — a supplier page's warehouses as chips (the list and the page's filter), and under them what the
// supplier's goods did in the chosen one or in all (a-supplier-page-is-scoped-by-its-warehouses,
// a-warehouse-chip-is-its-name-and-the-summary-follows-it).

const DAY = 86_400n;
const LATEST = BigInt(Date.UTC(2026, 9, 8) / 1000);
const warehouse = (i: number, restocks: number): SupplierWarehouse => ({
  id: BigInt(100 + i),
  name: `Gudang ${i + 1}`,
  sold: 1000 * (i + 1),
  orders: 100 * (i + 1),
  ready: 10 * (i + 1),
  restocks,
  lastRestockAt: LATEST - BigInt(i) * DAY,
  lastOrderAt: LATEST - BigInt(i + 1) * DAY,
});
const FEW = [warehouse(0, 12), warehouse(1, 4), warehouse(2, 1)];
const MANY = Array.from({ length: 11 }, (_, i) => warehouse(i, 20 - i));

function Controlled({ warehouses }: { warehouses: SupplierWarehouse[] }) {
  const [picked, setPicked] = useState(0n);
  return <RelatedWarehouses warehouses={warehouses} value={picked} onChange={setPicked} marks={null} />;
}

const meta = {
  title: "Features/Suppliers/RelatedWarehouses",
  component: Controlled,
  parameters: { docs: { description: { component: description } } },
  args: { warehouses: FEW },
} satisfies Meta<typeof Controlled>;

export default meta;
type Story = StoryObj<typeof meta>;

const card = (canvas: ReturnType<typeof within>, name: "sold" | "ready") =>
  canvas.getByTestId(`supplier-warehouse-summary-${name}`);

/**
 * Each chip is a warehouse's name — no number; Semua first and chosen. Under them two cards for all the warehouses
 * together (the-summary-is-sold-and-ready-with-their-counts): units sold, from how many orders and the last one; units
 * ready, from how many restocks and the last one — summed, with the latest dates. A chip picked switches them.
 */
export const ChipsAndTheirSummary: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const chips = within(canvas.getByTestId("supplier-warehouses-chips")).getAllByRole("button");
    await expect(chips.map((c) => c.textContent)).toEqual(["All", "Gudang 1", "Gudang 2", "Gudang 3"]);
    await expect(chips[0]).toHaveAttribute("aria-pressed", "true");

    // Two cards, nothing else.
    await expect(within(canvas.getByTestId("supplier-warehouse-summary")).getAllByText(/^(Sold|Ready)$/)).toHaveLength(2);
    // All: 1.000 + 2.000 + 3.000 sold on 100 + 200 + 300 orders; 10 + 20 + 30 ready from 12 + 4 + 1 restocks.
    await expect(card(canvas, "sold")).toHaveTextContent("Sold6.000 unitsfrom 600 orders · last Oct 7, 2026");
    await expect(card(canvas, "ready")).toHaveTextContent("Ready60 units17 restocks · last Oct 8, 2026");

    await userEvent.click(chips[2]!);
    await waitFor(() => expect(card(canvas, "sold")).toHaveTextContent("Sold2.000 unitsfrom 200 orders · last Oct 6, 2026"));
    await expect(card(canvas, "ready")).toHaveTextContent("Ready20 units4 restocks · last Oct 7, 2026");
  },
};

/** More than eight fold behind "+N More", which unfolds the rest. */
export const ManyFold: Story = {
  args: { warehouses: MANY },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const chips = () => within(canvas.getByTestId("supplier-warehouses-chips")).getAllByRole("button");
    // Semua, eight warehouses, and the fold.
    await expect(chips()).toHaveLength(1 + VISIBLE_WAREHOUSES + 1);
    await userEvent.click(canvas.getByTestId("supplier-warehouses-more"));
    await expect(canvas.queryByTestId("supplier-warehouses-more")).toBeNull();
    await expect(chips()).toHaveLength(1 + MANY.length);
  },
};

/** A supplier never restocked says so in words — and has no summary. */
export const NeverRestocked: Story = {
  args: { warehouses: [] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId("supplier-warehouses-none")).toHaveTextContent("Not restocked into any warehouse yet.");
    await expect(canvas.queryByTestId("supplier-warehouse-summary")).toBeNull();
  },
};

/** On a phone the row scrolls sideways instead — nothing folds; and a card's count and date go on a line each. */
export const OnAPhone: Story = {
  args: { warehouses: MANY },
  globals: { viewport: { value: "mobile2" } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.queryByTestId("supplier-warehouses-more")).toBeNull();
    await expect(canvas.getByTestId("supplier-warehouse-summary-sold-note")).toHaveTextContent(/^last /);
    await expect(card(canvas, "sold")).not.toHaveTextContent("·");
    await expect(getComputedStyle(canvas.getByTestId("supplier-warehouses-chips")).overflowX).toBe("auto");
  },
};
