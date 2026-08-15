import { useState } from "react";

import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, screen, userEvent, waitFor, within } from "storybook/test";

import { couriers } from "../../../.storybook/fixtures";
import { ShippingSelect, description } from "./ShippingSelect";

const meta = {
  title: "Components/Pickers/ShippingSelect",
  component: ShippingSelect,
  parameters: {
    docs: { description: { component: description } },
  },
  args: { value: "", onChange: fn() },
} satisfies Meta<typeof ShippingSelect>;

export default meta;
type Story = StoryObj<typeof meta>;

export const NoCourier: Story = {};

export const Selected: Story = { args: { value: couriers[0]!.code } };

export const Disabled: Story = { args: { value: couriers[0]!.code, disabled: true } };

// The catalogue is bounded, curated reference data — the one list CLAUDE.md exempts from pagination
// — so it opens on click with everything visible rather than demanding a search first (#146).
export const OpensOnClickWithTheWholeCatalogue: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(canvas.getByRole("combobox"));

    const option = await screen.findByTestId(`shipping-select-option-${couriers[0]!.code}`);
    await waitFor(() => expect(option).toBeVisible());
    await expect(option).toHaveTextContent(couriers[0]!.name);
  },
};

// Retired couriers are excluded by default — ShippingList returns only active ones unless asked.
export const InactiveCouriersAreNotOffered: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(canvas.getByRole("combobox"));

    await waitFor(() => expect(screen.getByTestId(`shipping-select-option-${couriers[0]!.code}`)).toBeVisible());
    // "pos" is inactive in the fixtures.
    await expect(screen.queryByTestId(`shipping-select-option-${couriers[3]!.code}`)).toBeNull();
  },
};

export const EmitsTheCourierCode: Story = {
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(canvas.getByRole("combobox"));
    const option = await screen.findByTestId(`shipping-select-option-${couriers[1]!.code}`);
    await waitFor(() => expect(option).toBeVisible());
    await userEvent.click(option);

    // The stable CODE, not the editable name — a shipment stores the code.
    await expect(args.onChange).toHaveBeenCalledWith(couriers[1]!.code);
  },
};

// ⚠ CLEARING EMITS "" — it does not do nothing (#131).
//
// No courier is a legitimate value: neither a restock nor an order requires one, so the field must
// be un-settable. Swallowing the empty case is what made this picker's predecessor WRITE-ONCE, and
// the same mistake is one `if (picked !== undefined)` away.
export const ClearingEmitsTheEmptyString: Story = {
  args: { value: couriers[0]!.code },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(await canvas.findByRole("button", { name: /clear/i }));

    await expect(args.onChange).toHaveBeenCalledWith("");
  },
};

export const Interactive: Story = {
  render: (args) => {
    const [value, setValue] = useState("");

    return <ShippingSelect {...args} value={value} onChange={setValue} />;
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(canvas.getByRole("combobox"));
    const option = await screen.findByTestId(`shipping-select-option-${couriers[2]!.code}`);
    await waitFor(() => expect(option).toBeVisible());
    await userEvent.click(option);

    await waitFor(() => expect(canvas.getByRole("combobox")).toHaveValue(couriers[2]!.name));
  },
};
