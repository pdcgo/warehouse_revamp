import { useState } from "react";

import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, screen, userEvent, waitFor, within } from "storybook/test";

import { productCosts, products, warehouseStock } from "../../../.storybook/fixtures";
import { OrderItemCard, description } from "./OrderItemCard";
import type { Availability, Costs, LineDraft } from "../../features/orders/lines";
import { lineFor } from "../../features/orders/lines";
import type { PickedProduct } from "../products/ProductSelect";

// The fixture warehouse, and the team the order is placed by — the same one, because team 11 is what
// the stubbed memberships make `useTeam().current` and it owns the products the fixtures stock. Its
// catalogue is therefore the picker's "My Product" tab, which is the tab it opens on.
const WAREHOUSE = 11n;
const TEAM = 11n;

// Both maps are keyed by product id as a string — exactly the shape the two batched reads produce.
const stock: Availability = new Map(Object.entries(warehouseStock));
const costs: Costs = new Map(Object.entries(productCosts));

function lineOf(index: number, quantity = "1"): LineDraft {
  const p = products[index]!;

  return { ...lineFor(p as PickedProduct), quantity };
}

const meta = {
  title: "Components/Orders/OrderItemCard",
  component: OrderItemCard,
  parameters: {
    docs: { description: { component: description } },
    // AllProductPicker reads `useTeam()`, which throws outside a TeamProvider.
    signedIn: true,
  },
  args: {
    teamId: TEAM,
    warehouseId: WAREHOUSE,
    lines: [],
    stock,
    costs,
    onPick: fn(),
    onPatch: fn(),
    onRemove: fn(),
  },
} satisfies Meta<typeof OrderItemCard>;

export default meta;
type Story = StoryObj<typeof meta>;

// ── The states worth looking at ─────────────────────────────────────────────────────────────────

export const Empty: Story = {};

export const WithLines: Story = {
  args: { lines: [lineOf(0), lineOf(1, "2")] },
};

// Product 73's HPP is 0 in the fixtures, which is UNKNOWN and not free — the row says so rather than
// booking the goods at no cost.
export const UnknownHpp: Story = {
  args: { lines: [lineOf(2)] },
};

export const NoWarehouse: Story = {
  args: { warehouseId: 0n, lines: [] },
};

// ── The rules worth failing on ──────────────────────────────────────────────────────────────────

// The card NAMES ITSELF and says what it is for. The description is not decoration: the one thing a
// person cannot read off the table is that every figure on it belongs to the warehouse chosen above,
// so the same order shows different numbers from a different building.
export const TheCardSaysWhatItIsFor: Story = {
  args: { lines: [lineOf(0)] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByRole("heading", { level: 3 })).toHaveTextContent("Items");
    await expect(canvas.getByTestId("order-items-help")).toHaveTextContent("warehouse chosen above");
  },
};

// An order with nothing on it says so in words. A table of headers with no rows reads as a screen
// that failed to load.
export const EmptySaysSo: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("order-create-no-products")).toBeInTheDocument();
    await expect(canvas.queryByTestId("order-lines-table")).toBeNull();
  },
};

// ⚠ NO WAREHOUSE, NO PICKING (owner) — and the hint is the other half of the rule. Every figure on
// this card is a fact about ONE BUILDING, so the dialog would open full of blanks; a greyed-out
// button with no explanation is the worst state a form can be in.
export const WithoutAWarehousePickingIsRefusedAndSaysWhy: Story = {
  args: { warehouseId: 0n },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("order-create-add-line")).toBeDisabled();
    await expect(canvas.getByTestId("order-create-need-warehouse")).toBeInTheDocument();
  },
};

// …and with one, it is usable on first paint and the hint is gone.
export const WithAWarehousePickingIsOpen: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("order-create-add-line")).toBeEnabled();
    await expect(canvas.queryByTestId("order-create-need-warehouse")).toBeNull();
  },
};

// Each row reads its stock from the CHOSEN WAREHOUSE, not from the catalogue — 40 on the shelf for
// product 71, from the fixtures.
export const EachLineShowsWhatTheWarehouseHolds: Story = {
  args: { lines: [lineOf(0)] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("order-line-0")).toHaveTextContent(products[0]!.name);
    await expect(canvas.getByTestId("order-line-stock-0")).toHaveTextContent("40");
    await expect(canvas.getByTestId("order-line-hpp-0")).toHaveTextContent("18.500");
  },
};

// A quantity the building cannot fill is marked ON THE ROW. The page also summarises it at the top —
// that half belongs to the page, because a short line is a fact about the whole order.
export const AQuantityAboveTheShelfIsMarked: Story = {
  // Fixture product 72 has THREE on the shelf.
  args: { lines: [lineOf(1, "5")] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("order-line-stock-0")).toHaveTextContent("3");
    await expect(canvas.getByTestId("order-line-0")).toHaveTextContent("5");
  },
};

// The stock read has not landed — which is NOT "none". A confident 0 would have people refusing
// orders they could fill, so the column prints an em dash instead.
export const UnknownStockIsNotZero: Story = {
  args: { lines: [lineOf(0)], stock: undefined },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.queryByTestId("order-line-stock-0")).toBeNull();
    await expect(canvas.getByTestId("order-line-0")).toHaveTextContent("—");
  },
};

// Removing hands back the PRODUCT ID, not the row index — the caller keys its lines by product.
export const RemovingNamesTheProduct: Story = {
  args: { lines: [lineOf(0), lineOf(1)] },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(canvas.getByTestId("order-line-remove-1"));

    await expect(args.onRemove).toHaveBeenCalledWith(products[1]!.id);
  },
};

// The picker hands back the WHOLE ticked set, never an addition — which is what lets the caller
// reconcile instead of rebuilding, and is why a quantity already typed survives a second visit.
export const PickingEmitsTheWholeTickedSet: Story = {
  args: { lines: [lineOf(0)] },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(canvas.getByTestId("order-create-add-line"));

    const option = await screen.findByTestId(`product-picker-option-${products[1]!.id}`);
    await waitFor(() => expect(option).toBeVisible());
    await userEvent.click(option);
    await userEvent.click(await screen.findByTestId("product-picker-confirm"));

    // BOTH products — the one already on the order and the one just ticked.
    await waitFor(() =>
      expect(args.onPick).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ id: products[0]!.id }),
          expect.objectContaining({ id: products[1]!.id }),
        ]),
      ),
    );
  },
};

// The same rule, driven end to end against real state: a quantity typed onto a line is STILL THERE
// after opening the picker to add a second product. Rebuilding the list from the ticked set would be
// shorter to write and would silently reset every number on screen.
export const Interactive: Story = {
  render: (args) => {
    const [lines, setLines] = useState<LineDraft[]>([]);

    function pick(picked: PickedProduct[]) {
      setLines((prev) => {
        const ticked = new Set(picked.map((p) => p.id.toString()));
        const kept = prev.filter((l) => ticked.has(l.productId.toString()));
        const known = new Set(kept.map((l) => l.productId.toString()));

        return [...kept, ...picked.filter((p) => !known.has(p.id.toString())).map(lineFor)];
      });
    }

    return (
      <OrderItemCard
        {...args}
        lines={lines}
        onPick={pick}
        onPatch={(productId, patch) =>
          setLines((prev) =>
            prev.map((l) => (l.productId === productId ? { ...l, ...patch } : l)),
          )
        }
        onRemove={(productId) => setLines((prev) => prev.filter((l) => l.productId !== productId))}
      />
    );
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    async function pick(productId: bigint) {
      await userEvent.click(canvas.getByTestId("order-create-add-line"));
      const option = await screen.findByTestId(`product-picker-option-${productId}`);
      await waitFor(() => expect(option).toBeVisible());
      await userEvent.click(option);
      await userEvent.click(await screen.findByTestId("product-picker-confirm"));
    }

    await pick(products[0]!.id);
    await waitFor(() => expect(canvas.getByTestId("order-line-qty-0")).toBeInTheDocument());

    const qty = canvas.getByTestId("order-line-qty-0");
    await userEvent.clear(qty);
    await userEvent.type(qty, "4", { delay: 40 });

    await pick(products[1]!.id);

    await waitFor(() => expect(canvas.getByTestId("order-line-1")).toBeInTheDocument());
    // The typed quantity survived the second pick.
    await expect(canvas.getByTestId("order-line-qty-0")).toHaveValue(4);
  },
};
