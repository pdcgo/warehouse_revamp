import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, screen, userEvent, waitFor, within } from "storybook/test";

import { products, teams } from "../../../.storybook/fixtures";
import { OwnStockedProductPicker, description } from "./OwnStockedProductPicker";

// The INTERSECTION picker: my catalogue ∩ what this building holds. Only its load semantics are
// pinned here — the shared dialog behaviour lives once in OwnProductPicker.stories.tsx.
const meta = {
  title: "Components/Products/OwnStockedProductPicker",
  component: OwnStockedProductPicker,
  parameters: {
    docs: { description: { component: description } },
    signedIn: true,
  },
  args: { teamId: teams[0]!.id, warehouseId: teams[0]!.id, value: [], onChange: fn() },
} satisfies Meta<typeof OwnStockedProductPicker>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Closed: Story = {};

// ⚠ THE WHOLE POINT, and the one thing AllStockedProductPicker does NOT do. All three fixture
// products are on this warehouse's shelf, but 73 belongs to team 13 — so it is listed by the "all"
// picker and excluded here. "Own" means own CATALOGUE, resolved in product_service and handed to
// inventory as a `product_ids` narrowing, because inventory has no owner axis of its own.
export const ExcludesAnotherTeamsStockedGoods: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(canvas.getByTestId("product-picker-trigger"));

    const dialog = await screen.findByTestId("product-picker-dialog");
    await waitFor(() => expect(dialog).toBeVisible());

    // Mine, on the shelf → listed.
    await expect(await screen.findByTestId(`product-picker-option-${products[0]!.id}`)).toBeInTheDocument();
    await expect(await screen.findByTestId(`product-picker-option-${products[1]!.id}`)).toBeInTheDocument();
    // Team 13's, on the same shelf → not mine, so not here.
    await expect(screen.queryByTestId(`product-picker-option-${products[2]!.id}`)).toBeNull();
  },
};

// A SEARCH replaces the whole-catalogue resolve rather than intersecting with it — ProductList only
// ever returns my products, so the term is already narrowed to my catalogue by construction. And it
// stays narrowed: another team's stocked product is not findable here even by name.
export const SearchStaysInsideMyCatalogue: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(canvas.getByTestId("product-picker-trigger"));
    await waitFor(() => expect(screen.getByTestId("product-picker-dialog")).toBeVisible());

    // "Gula" is team 13's product — stocked in this warehouse, and still not mine to request.
    await userEvent.type(screen.getByTestId("product-picker-search"), "Gula", { delay: 40 });

    await waitFor(async () => await expect(screen.getByTestId("product-picker-empty")).toBeInTheDocument());
  },
};

// A caller with no team yet gets the no-team state rather than a call authorized as nobody — and,
// crucially, rather than an unnarrowed `product_ids` that would show the ENTIRE warehouse as if it
// were this team's catalogue.
export const NoTeamSelected: Story = {
  args: { teamId: 0n },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(canvas.getByTestId("product-picker-trigger"));

    await expect(await screen.findByTestId("product-picker-no-team")).toBeInTheDocument();
    await expect(screen.queryByTestId("product-picker-list")).toBeNull();
  },
};
