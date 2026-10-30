import { useState } from "react";

import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";

import { Marketplace } from "../../gen/warehouse/marketplace/v1/marketplace_pb";
import { marketplaceLabel } from "../badges/MarketplaceBadge";
import { MarketplaceSelect, description } from "./MarketplaceSelect";

const meta = {
  title: "Components/Pickers/MarketplaceSelect",
  component: MarketplaceSelect,
  parameters: {
    docs: { description: { component: description } },
  },
  args: { onChange: fn() },
} satisfies Meta<typeof MarketplaceSelect>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Empty: Story = {};

export const Selected: Story = { args: { value: Marketplace.SHOPEE } };

export const Disabled: Story = { args: { value: Marketplace.TOKOPEDIA, disabled: true } };

// ⚠ NOT portalled, deliberately. This picker is used inside ShopFormDialog, and a portalled listbox
// renders OUTSIDE the dialog — where the modal marks it inert and aria-hidden, so it is invisible to
// the a11y tree and unclickable. Querying inside the canvas is what proves it stayed inline.
export const ListboxRendersInline: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(canvas.getByTestId("marketplace-select"));

    // By ROLE, not text: Select.HiddenSelect renders a native <option> per item, so a text query
    // matches twice. The hidden select is aria-hidden and so absent from the accessibility tree.
    await expect(
      await canvas.findByRole("option", { name: marketplaceLabel(Marketplace.LAZADA) }),
    ).toBeInTheDocument();
  },
};

// UNSPECIFIED is the "not picked" sentinel, not a storefront — so it is never an option, and passing
// it as the value shows the placeholder rather than a bogus selection.
export const UnspecifiedShowsThePlaceholder: Story = {
  args: { value: Marketplace.UNSPECIFIED, placeholder: "Select a marketplace" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("marketplace-select")).toHaveTextContent("Select a marketplace");

    await userEvent.click(canvas.getByTestId("marketplace-select"));
    await expect(canvas.queryByText("Unspecified")).toBeNull();
  },
};

export const EmitsTheEnum: Story = {
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(canvas.getByTestId("marketplace-select"));
    await userEvent.click(await canvas.findByRole("option", { name: marketplaceLabel(Marketplace.TIKTOK) }));

    await expect(args.onChange).toHaveBeenCalledWith(Marketplace.TIKTOK);
  },
};

// A FILTER CLEARS FROM ITS OWN × (every-filter-clears-from-its-own-x) — `clearable` shows one on a picked value, and
// clearing emits UNSPECIFIED, the "none" sentinel, never nothing (#131). Nothing picked, nothing to clear.
export const ClearableForAFilter: Story = {
  args: { placeholder: "All types" },
  render: (args) => {
    const [value, setValue] = useState<Marketplace>(Marketplace.SHOPEE);

    return (
      <MarketplaceSelect
        {...args}
        clearable
        value={value}
        onChange={(m) => {
          setValue(m);
          args.onChange?.(m);
        }}
      />
    );
  },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(canvas.getByTestId("marketplace-select-clear"));
    await expect(args.onChange).toHaveBeenCalledWith(Marketplace.UNSPECIFIED);
    await expect(canvas.getByTestId("marketplace-select")).toHaveTextContent("All types");
    await expect(canvas.getByTestId("marketplace-select-clear")).not.toBeVisible();
  },
};

export const Interactive: Story = {
  render: (args) => {
    const [value, setValue] = useState<Marketplace | undefined>(undefined);

    return <MarketplaceSelect {...args} value={value} onChange={setValue} />;
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(canvas.getByTestId("marketplace-select"));
    await userEvent.click(await canvas.findByRole("option", { name: "Blibli" }));

    await expect(canvas.getByTestId("marketplace-select")).toHaveTextContent("Blibli");
  },
};
