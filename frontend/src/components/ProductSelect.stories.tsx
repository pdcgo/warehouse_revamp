import { useState } from "react";

import type { Meta, StoryObj } from "@storybook/react-vite";
import { Text } from "@chakra-ui/react";
import { expect, fn, screen, userEvent, waitFor, within } from "storybook/test";

import { products } from "../../.storybook/fixtures";
import { ProductSelect, type PickedProduct, description } from "./ProductSelect";

const meta = {
  title: "Components/ProductSelect",
  component: ProductSelect,
  parameters: {
    docs: { description: { component: description } },
  },
  args: { teamId: 11n, onChange: fn() },
} satisfies Meta<typeof ProductSelect>;

export default meta;
type Story = StoryObj<typeof meta>;

export const TeamCatalogue: Story = {};

// "all" scope discovers products across EVERY team (ProductDiscover, #110) rather than searching
// this team's catalogue. The team id then only authorizes the request.
export const CrossTeamDiscovery: Story = { args: { scope: "all" } };

export const Disabled: Story = { args: { disabled: true } };

// ⚠ Unlike the bounded pickers, this one WITHHOLDS its list until you type — a catalogue grows
// without limit, so there is no "show me everything" to offer. That is why it has no `openOnClick`
// while TeamSelect and SupplierSelect do.
export const BelowTwoCharactersItDoesNotSearch: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const input = canvas.getByRole("combobox");

    await userEvent.click(input);
    await userEvent.type(input, "k");

    await expect(await screen.findByText("Type at least 2 characters")).toBeInTheDocument();
  },
};

export const SearchesByNameOrSku: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const input = canvas.getByRole("combobox");

    await userEvent.click(input);
    await userEvent.type(input, "kopi");

    const option = await screen.findByTestId(`product-select-option-${products[0]!.sku}`);
    await waitFor(() => expect(option).toBeVisible());

    // Each option reads "sku" over "name", so two similarly-named variants stay distinguishable.
    await expect(option).toHaveTextContent(products[0]!.sku);
    await expect(option).toHaveTextContent(products[0]!.name);
  },
};

// The "team" scope searches only THIS team's catalogue. Product 73 belongs to another team, so it
// must not appear here — while the cross-team story below finds it.
export const TeamScopeExcludesOtherTeamsProducts: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const input = canvas.getByRole("combobox");

    await userEvent.click(input);
    await userEvent.type(input, "gula");

    await expect(await screen.findByText("No products found")).toBeInTheDocument();
  },
};

export const AllScopeFindsOtherTeamsProducts: Story = {
  args: { scope: "all" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const input = canvas.getByRole("combobox");

    await userEvent.click(input);
    await userEvent.type(input, "gula");

    const option = await screen.findByTestId(`product-select-option-${products[2]!.sku}`);
    await waitFor(() => expect(option).toBeVisible());
  },
};

// It emits the WHOLE PickedProduct, not just an id — the caller snapshots sku and name onto the
// order line, because those are what was ordered and must not change when the catalogue does (#67).
// Price is deliberately absent: a product has no catalogue price, so the buyer-paid unit price is
// typed on the line itself.
export const EmitsTheSnapshotNotJustAnId: Story = {
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    const input = canvas.getByRole("combobox");

    await userEvent.click(input);
    await userEvent.type(input, "teh");

    const option = await screen.findByTestId(`product-select-option-${products[1]!.sku}`);
    await waitFor(() => expect(option).toBeVisible());
    await userEvent.click(option);

    await expect(args.onChange).toHaveBeenCalledWith({
      id: products[1]!.id,
      sku: products[1]!.sku,
      name: products[1]!.name,
    });
  },
};

export const Interactive: Story = {
  render: (args) => {
    const [picked, setPicked] = useState<PickedProduct | null>(null);

    return (
      <>
        <ProductSelect {...args} value={picked?.id} onChange={setPicked} />
        <Text mt="3" fontSize="sm" data-testid="picked">
          {picked ? `${picked.sku} — ${picked.name}` : "(nothing picked)"}
        </Text>
      </>
    );
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const input = canvas.getByRole("combobox");

    await userEvent.click(input);
    await userEvent.type(input, "kopi");

    const option = await screen.findByTestId(`product-select-option-${products[0]!.sku}`);
    await waitFor(() => expect(option).toBeVisible());
    await userEvent.click(option);

    await waitFor(() => expect(canvas.getByTestId("picked")).toHaveTextContent(products[0]!.name));

    // The picked product must also stay READABLE in the field — the half that broke in
    // SupplierSelect. This picker searches SERVER-side, so on selection the label is written back
    // into the input and searched for; the guard is that the field still shows it afterwards.
    await waitFor(() =>
      expect(input).toHaveValue(`${products[0]!.sku} — ${products[0]!.name}`),
    );
  },
};
