import { useState } from "react";

import type { Meta, StoryObj } from "@storybook/react-vite";
import { Button, Text } from "@chakra-ui/react";
import { expect, fn, screen, userEvent, waitFor, within } from "storybook/test";

import { products } from "../../.storybook/fixtures";
import { ProductPicker, description } from "./ProductPicker";
import type { PickedProduct } from "./ProductSelect";

const meta = {
  title: "Components/ProductPicker",
  component: ProductPicker,
  parameters: {
    docs: { description: { component: description } },
    // ⚠ The ONE component that needs the auth/team providers: it reads `useTeam()`, which throws
    // outside a TeamProvider. See the `withSignedIn` decorator in .storybook/preview.tsx.
    signedIn: true,
  },
  args: { teamId: 11n, value: [], onChange: fn() },
} satisfies Meta<typeof ProductPicker>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Closed: Story = {};

export const WithSelection: Story = { args: { value: [products[0]!.id] } };

export const Disabled: Story = { args: { disabled: true } };

// Two catalogues become TABS rather than one merged list, because putting your OWN product on an
// order and putting somebody ELSE'S on it are different decisions with different consequences —
// and a team badge in a merged list is too quiet a clue (#106).
export const TwoCatalogueTabs: Story = {
  args: { catalogs: ["own", "others"] },
};

export const CustomTrigger: Story = {
  args: { trigger: <Button colorPalette="brand">Add products</Button> },
};

export const OpensAndListsTheCatalogue: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(canvas.getByTestId("product-picker-trigger"));

    const dialog = await screen.findByTestId("product-picker-dialog");
    await waitFor(() => expect(dialog).toBeVisible());

    // The team's own catalogue — product 73 belongs to another team and must not be here.
    await expect(await screen.findByTestId(`product-picker-option-${products[0]!.id}`)).toBeInTheDocument();
    await expect(screen.queryByTestId(`product-picker-option-${products[2]!.id}`)).toBeNull();
  },
};

// ⚠ TICKS ARE A DRAFT. Seeded from `value` when the dialog opens, applied by Confirm, DISCARDED by
// Cancel. A picker that wrote through on every tick would edit the order line behind the dialog
// while somebody was still deciding.
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

// A caller meaning "this team, none selected yet" passes 0n and gets the no-team state — `undefined`
// means ALL teams, so a missing team must not silently widen the browse.
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
        <ProductPicker {...args} value={picked.map((p) => p.id)} onChange={setPicked} />
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
