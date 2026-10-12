import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, screen, userEvent, waitFor, within } from "storybook/test";

import { products, teams, warehouseStock } from "../../../.storybook/fixtures";
import { AllStockedProductPicker, description } from "./AllStockedProductPicker";

// The ORDER FORM's picker. Only its load semantics are pinned here — the shared dialog behaviour
// lives once in OwnProductPicker.stories.tsx.
const meta = {
  title: "Components/Products/AllStockedProductPicker",
  component: AllStockedProductPicker,
  parameters: {
    docs: { description: { component: description } },
    signedIn: true,
  },
  args: { teamId: teams[0]!.id, warehouseId: teams[0]!.id, value: [], onChange: fn() },
} satisfies Meta<typeof AllStockedProductPicker>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Closed: Story = {};

// ⚠ THE RULE THIS PICKER EXISTS FOR. It does NOT filter by ownership — an order draws whatever is on
// the shelf (StockPick drains the warehouse regardless of which restock brought a unit in), so
// another team's goods sitting in this building are pickable like any other. Hiding them would refuse
// orders the warehouse can plainly fill.
export const ListsAnotherTeamsGoodsSittingInTheWarehouse: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(canvas.getByTestId("product-picker-trigger"));

    const dialog = await screen.findByTestId("product-picker-dialog");
    await waitFor(() => expect(dialog).toBeVisible());

    // Product 73 belongs to team 13 and is on team 11's shelf. It is offered.
    await expect(await screen.findByTestId(`product-picker-option-${products[2]!.id}`)).toBeInTheDocument();
  },
};

// The READY figure rides along with the LIST — it is the number the list was built from, so there is
// no second read that could disagree with the rows it sits on.
export const ShowsTheWarehousesOwnStockFigure: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(canvas.getByTestId("product-picker-trigger"));

    const row = await screen.findByTestId(`product-picker-option-${products[1]!.id}`);
    await waitFor(() => expect(row).toBeVisible());

    // Fixture product 72 has three on the shelf, and the badge says so.
    await expect(row).toHaveTextContent(warehouseStock["72"]!.toString());
  },
};

// A search reaches ACROSS catalogues before it reaches inventory: the term is resolved by
// ProductDiscover, and the matching ids are handed to the warehouse as a narrowing. Own-team-only
// resolution would make another team's stocked goods unsearchable while still being listed.
export const SearchFindsAnotherTeamsStockedProduct: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(canvas.getByTestId("product-picker-trigger"));
    await waitFor(() => expect(screen.getByTestId("product-picker-dialog")).toBeVisible());

    // "Gula" is product 73 — team 13's.
    await userEvent.type(screen.getByTestId("product-picker-search"), "Gula", { delay: 40 });

    // ⚠ BOTH HALVES IN ONE waitFor, and neither alone is enough.
    //
    // Waiting only for 73 to APPEAR passes instantly against the pre-search list, which already
    // contains it — the story would assert nothing. Waiting only for 71 to GO passes during the
    // loading frame, where the list is replaced by a spinner and every row is absent. The settled
    // state is the one where 73 is present AND 71 is not.
    await waitFor(async () => {
      await expect(screen.getByTestId(`product-picker-option-${products[2]!.id}`)).toBeInTheDocument();
      await expect(screen.queryByTestId(`product-picker-option-${products[0]!.id}`)).toBeNull();
    });
  },
};

// ⚠ A resolve that matched NOTHING must say so itself. An empty `product_ids` means "no narrowing"
// to inventory — i.e. the whole building — so a search for something the catalogue does not carry
// would otherwise come back with every stocked product in the warehouse.
export const ASearchThatMatchesNothingShowsNothing: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(canvas.getByTestId("product-picker-trigger"));
    await waitFor(() => expect(screen.getByTestId("product-picker-dialog")).toBeVisible());

    await userEvent.type(screen.getByTestId("product-picker-search"), "zzzznothing", { delay: 40 });

    await waitFor(async () => await expect(screen.getByTestId("product-picker-empty")).toBeInTheDocument());
    await expect(screen.queryByTestId("product-picker-list")).toBeNull();
  },
};
