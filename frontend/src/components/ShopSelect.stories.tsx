import { useState } from "react";

import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, waitFor, within } from "storybook/test";

import { shops } from "../../.storybook/fixtures";
import { ShopSelect, description } from "./ShopSelect";

const meta = {
  title: "Components/ShopSelect",
  component: ShopSelect,
  parameters: {
    docs: { description: { component: description } },
  },
  // The fixture selling team — its shops come back from the stubbed ShopList.
  args: { teamId: 12n, onChange: fn() },
} satisfies Meta<typeof ShopSelect>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Empty: Story = {};

export const Selected: Story = { args: { value: shops[0]!.id } };

export const Disabled: Story = { args: { value: shops[0]!.id, disabled: true } };

// Each option carries the shop's name AND its marketplace as the standard-coloured MarketplaceBadge
// — two shops with similar names ("Melati Official" / "Melati Store") stay distinguishable, and a
// shop's marketplace reads the same here as in every table.
export const OptionsCarryTheMarketplaceBadge: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(canvas.getByTestId("shop-select"));

    const option = await canvas.findByTestId(`shop-select-option-${shops[0]!.id}`);
    await waitFor(() => expect(option).toBeVisible());

    await expect(option).toHaveTextContent(shops[0]!.name);
    await expect(
      within(option).getByTestId(`marketplace-badge-${shops[0]!.marketplace}`),
    ).toBeInTheDocument();
  },
};

// ⚠ NOT portalled: this Select is used inside RecordExpenseDialog, and a portalled listbox renders
// OUTSIDE the dialog where the modal marks it inert — invisible to the a11y tree and unclickable.
// Finding the option INSIDE the canvas is what proves it stayed inline.
export const ListboxRendersInline: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(canvas.getByTestId("shop-select"));

    await expect(await canvas.findByTestId(`shop-select-option-${shops[1]!.id}`)).toBeInTheDocument();
  },
};

export const EmitsTheShopId: Story = {
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(canvas.getByTestId("shop-select"));
    const option = await canvas.findByTestId(`shop-select-option-${shops[1]!.id}`);
    await waitFor(() => expect(option).toBeVisible());
    await userEvent.click(option);

    await expect(args.onChange).toHaveBeenCalledWith(shops[1]!.id);
  },
};

// A team with no shops shows the placeholder rather than an error — a selling team that has not
// connected a storefront yet is a normal state, not a failure.
export const TeamWithNoShops: Story = {
  args: { teamId: 999n },
};

export const Interactive: Story = {
  render: (args) => {
    const [value, setValue] = useState(0n);

    return <ShopSelect {...args} value={value} onChange={setValue} />;
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(canvas.getByTestId("shop-select"));
    const option = await canvas.findByTestId(`shop-select-option-${shops[2]!.id}`);
    await waitFor(() => expect(option).toBeVisible());
    await userEvent.click(option);

    await expect(canvas.getByTestId("shop-select")).toHaveTextContent(shops[2]!.name);
  },
};
