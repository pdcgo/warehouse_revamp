import { useState } from "react";

import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, screen, userEvent, within } from "storybook/test";

import { RestockPaymentType } from "../gen/warehouse/inventory/v1/restock_request_pb";
import { PaymentTypeSelect, description } from "./PaymentTypeSelect";

const meta = {
  title: "Components/PaymentTypeSelect",
  component: PaymentTypeSelect,
  parameters: {
    docs: { description: { component: description } },
  },
  args: { onChange: fn() },
} satisfies Meta<typeof PaymentTypeSelect>;

export default meta;
type Story = StoryObj<typeof meta>;

export const NotRecorded: Story = {};

export const ShopeePay: Story = { args: { value: RestockPaymentType.SHOPEE_PAY } };

export const BankAccount: Story = { args: { value: RestockPaymentType.BANK_ACCOUNT } };

export const Disabled: Story = { args: { value: RestockPaymentType.SHOPEE_PAY, disabled: true } };

// ⚠ THE RULE, and the one a fresh `<select>` gets wrong every time: "not recorded" is a SELECTABLE
// ITEM, not a disabled placeholder. Having recorded no payment is a real answer somebody can come
// back to — #131 is the bug that taught this: a picker you cannot un-set is write-once.
//
// It carries a sentinel value rather than "" because Chakra treats an empty value array as "nothing
// selected", which is a different state entirely.
export const NotRecordedIsSelectable: Story = {
  args: { value: RestockPaymentType.SHOPEE_PAY },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(canvas.getByTestId("restock-payment-type"));
    await userEvent.click(await screen.findByTestId("payment-type-none"));

    await expect(args.onChange).toHaveBeenCalledWith(RestockPaymentType.UNSPECIFIED);
  },
};

export const EmitsTheEnum: Story = {
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(canvas.getByTestId("restock-payment-type"));
    await userEvent.click(await screen.findByTestId(`payment-type-${RestockPaymentType.BANK_ACCOUNT}`));

    await expect(args.onChange).toHaveBeenCalledWith(RestockPaymentType.BANK_ACCOUNT);
  },
};

// Round trip: pick a type, then put it back to "not recorded". A field that can only be set once
// is the failure this picker was rebuilt to avoid.
export const CanBeSetAndUnset: Story = {
  render: (args) => {
    const [value, setValue] = useState<RestockPaymentType>(RestockPaymentType.UNSPECIFIED);

    return <PaymentTypeSelect {...args} value={value} onChange={setValue} />;
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const trigger = canvas.getByTestId("restock-payment-type");

    await userEvent.click(trigger);
    await userEvent.click(await screen.findByTestId(`payment-type-${RestockPaymentType.SHOPEE_PAY}`));
    await expect(trigger).toHaveTextContent(/shopee/i);

    await userEvent.click(trigger);
    await userEvent.click(await screen.findByTestId("payment-type-none"));
    await expect(trigger).not.toHaveTextContent(/shopee/i);
  },
};
