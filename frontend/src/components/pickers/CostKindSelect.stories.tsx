import { useState } from "react";

import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";

import { RestockCostKind } from "../../gen/warehouse/inventory/v1/restock_request_pb";
import { COST_KINDS, CostKindSelect, description } from "./CostKindSelect";

const meta = {
  title: "Components/Pickers/CostKindSelect",
  component: CostKindSelect,
  parameters: {
    docs: { description: { component: description } },
  },
  args: { value: RestockCostKind.COD_SHIPPING, onChange: fn() },
} satisfies Meta<typeof CostKindSelect>;

export default meta;
type Story = StoryObj<typeof meta>;

export const CodShipping: Story = {};

export const Other: Story = { args: { value: RestockCostKind.OTHER } };

export const Disabled: Story = { args: { disabled: true } };

// UNSPECIFIED is not a kind of cost — it is the absence of one. The handler refuses it, so offering
// it here would let someone submit a charge the server will reject with the amount already typed.
export const NeverOffersUnspecified: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(canvas.getByTestId("cost-kind-select"));

    // Inline, not portalled — the accept screen can render this inside a modal Dialog.
    for (const kind of COST_KINDS) {
      await expect(
        await canvas.findByTestId(`cost-kind-option-${kind}`),
      ).toBeInTheDocument();
    }

    await expect(
      canvas.queryByTestId(
        `cost-kind-option-${RestockCostKind.UNSPECIFIED}`,
      ),
    ).toBeNull();
  },
};

export const EmitsTheEnum: Story = {
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(canvas.getByTestId("cost-kind-select"));
    await userEvent.click(
      await canvas.findByTestId(`cost-kind-option-${RestockCostKind.OTHER}`),
    );

    await expect(args.onChange).toHaveBeenCalledWith(RestockCostKind.OTHER);
  },
};

export const Interactive: Story = {
  render: (args) => {
    const [value, setValue] = useState(RestockCostKind.COD_SHIPPING);

    return <CostKindSelect {...args} value={value} onChange={setValue} />;
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(canvas.getByTestId("cost-kind-select"));
    await userEvent.click(
      await canvas.findByTestId(`cost-kind-option-${RestockCostKind.OTHER}`),
    );

    await expect(canvas.getByTestId("cost-kind-select")).toHaveTextContent(
      /other|lainnya/i,
    );
  },
};
