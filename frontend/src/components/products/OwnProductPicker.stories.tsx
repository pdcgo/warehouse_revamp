import { useState } from "react";

import type { Meta, StoryObj } from "@storybook/react-vite";
import { Button, Text } from "@chakra-ui/react";
import { expect, fn, screen, userEvent, waitFor, within } from "storybook/test";

import { products, teams } from "../../../.storybook/fixtures";
import { OwnProductPicker, description } from "./OwnProductPicker";
import type { PickedProduct } from "./ProductSelect";

// The four product pickers share ProductPickerShell, so THE SHELL'S RULES ARE PINNED HERE — ticks as
// a draft, Confirm/Cancel, the no-team state — and the other three stories cover only what makes them
// different (which catalogue they load, and what they exclude). Testing the shell four times over
// would quadruple the run for one component's behaviour.
const meta = {
  title: "Components/Products/OwnProductPicker",
  component: OwnProductPicker,
  parameters: {
    docs: { description: { component: description } },
    // The picker chain reads `useTeam()`, which throws outside a TeamProvider.
    signedIn: true,
  },
  // A warehouse by default, because that is the state the restock form uses it in — without one the
  // READY column has nothing to say and half the table is dashes.
  args: { teamId: teams[0]!.id, stockWarehouseId: teams[0]!.id, value: [], onChange: fn() },
} satisfies Meta<typeof OwnProductPicker>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Closed: Story = {};

export const WithSelection: Story = { args: { value: [products[0]!.id] } };

export const Disabled: Story = { args: { disabled: true } };

export const CustomTrigger: Story = {
  args: { trigger: <Button colorPalette="brand">Add products</Button> },
};

// ONE TEAM'S CATALOGUE, and nothing else. Product 73 belongs to another team, so it must not appear
// — that is the entire difference from AllProductPicker, and the reason `teamId` is required rather
// than optional-meaning-everyone.
export const ListsOnlyThisTeamsCatalogue: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(canvas.getByTestId("product-picker-trigger"));

    const dialog = await screen.findByTestId("product-picker-dialog");
    await waitFor(() => expect(dialog).toBeVisible());

    await expect(await screen.findByTestId(`product-picker-option-${products[0]!.id}`)).toBeInTheDocument();
    await expect(screen.queryByTestId(`product-picker-option-${products[2]!.id}`)).toBeNull();
  },
};

// A CATALOGUE picker, not a stocked one — it lists what the team SELLS, whether or not any warehouse
// holds it. That is what makes it the right picker for a restock: a request is precisely the act of
// ordering something the building does not have.
export const ShowsProductsRegardlessOfStock: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(canvas.getByTestId("product-picker-trigger"));

    // Both of the team's products are offered — the picker never asks inventory what is on a shelf
    // before deciding what may be ordered.
    await expect(await screen.findByTestId(`product-picker-option-${products[0]!.id}`)).toBeInTheDocument();
    await expect(await screen.findByTestId(`product-picker-option-${products[1]!.id}`)).toBeInTheDocument();
  },
};

// ── The table (owner) ───────────────────────────────────────────────────────────────────────────

// A TABLE, not a list of badges: product | on the way | ready stock. Buying is a comparison down a
// column — "what is already coming" and "what is already here", across rows — and a badge riding on
// a product name cannot be scanned that way.
export const LaysTheStockOutAsColumns: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(canvas.getByTestId("product-picker-trigger"));
    await waitFor(() => expect(screen.getByTestId("product-picker-dialog")).toBeVisible());

    const table = await screen.findByTestId("product-picker-list");
    await expect(within(table).getByText("Product")).toBeInTheDocument();
    await expect(within(table).getByText("On the way")).toBeInTheDocument();
    await expect(within(table).getByText("Ready stock")).toBeInTheDocument();

    // Fixture product 72: three on the shelf, six already on the way.
    await waitFor(async () => {
      await expect(screen.getByTestId(`product-picker-ready-${products[1]!.id}`)).toHaveTextContent("3");
      await expect(screen.getByTestId(`product-picker-ongoing-${products[1]!.id}`)).toHaveTextContent("6");
    });
  },
};

// ⚠ A TABLE PRINTS THE ZERO. The list layout hides an ongoing badge at 0 — nothing on the way is the
// normal state of most products, and a badge saying so on every row is noise. A blank CELL is a
// different claim: it reads as "we did not check". So 0 is printed and "—" is kept for unknown.
export const ZeroIsPrintedRatherThanLeftBlank: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(canvas.getByTestId("product-picker-trigger"));

    // Fixture product 71 has nothing on the way — the cell says 0, not "—" and not empty.
    await waitFor(async () =>
      await expect(screen.getByTestId(`product-picker-ongoing-${products[0]!.id}`)).toHaveTextContent("0"),
    );
  },
};

// …and the other half: with no warehouse named, READY was never read, so it is "—" rather than a
// fabricated 0. ONGOING is unaffected — it is totalled across EVERY warehouse, so it has an answer
// whether or not a destination has been chosen.
export const ReadyIsUnknownWithoutAWarehouse: Story = {
  args: { stockWarehouseId: undefined },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(canvas.getByTestId("product-picker-trigger"));

    await waitFor(async () => {
      await expect(screen.getByTestId(`product-picker-ready-${products[1]!.id}`)).toHaveTextContent("—");
      await expect(screen.getByTestId(`product-picker-ongoing-${products[1]!.id}`)).toHaveTextContent("6");
    });
  },
};

// A <label> cannot wrap a <tr>, so the whole-row-toggles behaviour had to be wired by hand. Clicking
// the PRODUCT cell ticks the row, exactly as clicking the box does.
export const ClickingTheRowBodyTicksIt: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(canvas.getByTestId("product-picker-trigger"));

    const row = await screen.findByTestId(`product-picker-option-${products[0]!.id}`);
    await waitFor(() => expect(row).toBeVisible());

    // The product cell — deliberately NOT the checkbox.
    await userEvent.click(within(row).getByText(products[0]!.name));

    await expect(within(row).getByRole("checkbox")).toBeChecked();
  },
};

// The other gesture, and the one the row handler must not double-fire: ticking the BOX itself. Both
// handlers running in one click would cancel out and leave the row unticked.
export const ClickingTheCheckboxTicksItExactlyOnce: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(canvas.getByTestId("product-picker-trigger"));

    const row = await screen.findByTestId(`product-picker-option-${products[0]!.id}`);
    await waitFor(() => expect(row).toBeVisible());

    await userEvent.click(within(row).getByRole("checkbox"));

    // CHECKED, not a count: two handlers firing in one click would cancel out and leave it unticked,
    // which is exactly what this asserts against.
    await expect(within(row).getByRole("checkbox")).toBeChecked();
  },
};

// It has NO owner-team filter — that control belongs to the all-teams picker, where "whose catalogue"
// is still an open question. Here it is already answered by `teamId`, and a filter that could only
// narrow to itself or to nothing is worse than no filter.
export const HasNoOwnerTeamFilter: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(canvas.getByTestId("product-picker-trigger"));
    await waitFor(() => expect(screen.getByTestId("product-picker-dialog")).toBeVisible());

    await expect(screen.queryByTestId("product-picker-filters")).toBeNull();
  },
};

// ⚠ TICKS ARE A DRAFT. Seeded from `value` when the dialog opens, applied by Confirm, DISCARDED by
// Cancel. A picker that wrote through on every tick would edit the order line behind the dialog while
// somebody was still deciding.
export const CancelDiscardsTheTicks: Story = {
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(canvas.getByTestId("product-picker-trigger"));

    const option = await screen.findByTestId(`product-picker-option-${products[0]!.id}`);
    await waitFor(() => expect(option).toBeVisible());
    await userEvent.click(option);

    await userEvent.click(await screen.findByTestId("product-picker-cancel"));

    await expect(args.onChange).not.toHaveBeenCalled();
  },
};

// Confirm emits the WHOLE ticked set as snapshots — id plus the sku/name frozen at pick time — the
// same PickedProduct shape ProductSelect emits, so a caller handles one or many identically.
export const ConfirmEmitsTheSnapshots: Story = {
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(canvas.getByTestId("product-picker-trigger"));

    const option = await screen.findByTestId(`product-picker-option-${products[1]!.id}`);
    await waitFor(() => expect(option).toBeVisible());
    await userEvent.click(option);

    await userEvent.click(await screen.findByTestId("product-picker-confirm"));

    await waitFor(() =>
      expect(args.onChange).toHaveBeenCalledWith([
        expect.objectContaining({ id: products[1]!.id, sku: products[1]!.sku, name: products[1]!.name }),
      ]),
    );
  },
};

// An empty list is a legitimate OUTCOME — "clear what was picked" — not an invalid state to be
// swallowed. This is the same #131 lesson the single-value pickers carry.
export const ConfirmingNothingClearsTheSelection: Story = {
  args: { value: [products[0]!.id] },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(canvas.getByTestId("product-picker-trigger"));

    // Untick the one that was seeded from `value`.
    const option = await screen.findByTestId(`product-picker-option-${products[0]!.id}`);
    await waitFor(() => expect(option).toBeVisible());
    await userEvent.click(option);

    await userEvent.click(await screen.findByTestId("product-picker-confirm"));

    await waitFor(() => expect(args.onChange).toHaveBeenCalledWith([]));
  },
};

// A caller meaning "this team, none selected yet" passes 0n and gets the no-team state rather than a
// call authorized as nobody.
export const NoTeamSelected: Story = {
  args: { teamId: 0n },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(canvas.getByTestId("product-picker-trigger"));

    await expect(await screen.findByTestId("product-picker-no-team")).toBeInTheDocument();
  },
};

export const Interactive: Story = {
  render: (args) => {
    const [picked, setPicked] = useState<PickedProduct[]>([]);

    return (
      <>
        <OwnProductPicker {...args} value={picked.map((p) => p.id)} onChange={setPicked} />
        <Text mt="3" fontSize="sm" data-testid="picked">
          {picked.length ? picked.map((p) => p.sku).join(", ") : "(nothing picked)"}
        </Text>
      </>
    );
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(canvas.getByTestId("product-picker-trigger"));

    const option = await screen.findByTestId(`product-picker-option-${products[0]!.id}`);
    await waitFor(() => expect(option).toBeVisible());
    await userEvent.click(option);
    await userEvent.click(await screen.findByTestId("product-picker-confirm"));

    await waitFor(() => expect(canvas.getByTestId("picked")).toHaveTextContent(products[0]!.sku));
  },
};
