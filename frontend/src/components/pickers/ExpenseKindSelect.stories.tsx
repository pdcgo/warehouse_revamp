import { useState } from "react";

import type { Meta, StoryObj } from "@storybook/react-vite";
import { HStack } from "@chakra-ui/react";
import { expect, fn, screen, userEvent, within } from "storybook/test";

import { ExpenseKind } from "../../gen/warehouse/expense/v1/expense_pb";
import { ExpenseKindSelect, description } from "./ExpenseKindSelect";

const meta = {
  title: "Components/Pickers/ExpenseKindSelect",
  component: ExpenseKindSelect,
  parameters: {
    docs: { description: { component: description } },
  },
  args: { onChange: fn() },
} satisfies Meta<typeof ExpenseKindSelect>;

export default meta;
type Story = StoryObj<typeof meta>;

export const AsAFormField: Story = {};

export const AsAFilter: Story = { args: { filter: true } };

export const Selected: Story = { args: { value: ExpenseKind.PAYROLL } };

export const Disabled: Story = { args: { value: ExpenseKind.ADS, disabled: true } };

// ⚠ STOCK_LOSS IS THE POINT OF THIS COMPONENT'S TWO LISTS (#211). It is not a decision anybody
// makes — it is what inventory_service posts when a warehouse writes units off. Offering it on the
// FORM would invite a hand-typed loss beside the automatic ones, and then "how much did we break"
// would be answered by a number that is partly a guess somebody typed.
//
// A FILTER must offer it, because "what did we break this month" is exactly the question a warehouse
// manager asks. Readable and writable are different permissions.
export const StockLossIsFilterableButNotEnterable: Story = {
  args: { testId: "form-kind" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(canvas.getByTestId("form-kind"));

    await expect(await screen.findByTestId(`form-kind-${ExpenseKind.ADS}`)).toBeInTheDocument();
    await expect(screen.queryByTestId(`form-kind-${ExpenseKind.STOCK_LOSS}`)).toBeNull();
  },
};

export const FilterOffersStockLossAndAny: Story = {
  args: { filter: true, testId: "filter-kind" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(canvas.getByTestId("filter-kind"));

    await expect(await screen.findByTestId(`filter-kind-${ExpenseKind.STOCK_LOSS}`)).toBeInTheDocument();
    // "any kind" exists ONLY on the filter — on a form it would be a choice the server refuses,
    // which is worse than not offering it: the person picks it, submits, and is told no.
    await expect(screen.getByTestId("filter-kind-any")).toBeInTheDocument();
  },
};

// On a FORM an unset value shows the placeholder rather than silently selecting the first kind —
// pre-selecting "Ads" would file rent as ads for anybody who did not look.
export const FormDoesNotPreselectAKind: Story = {
  args: { testId: "form-kind" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("form-kind")).not.toHaveTextContent(/ads|iklan/i);
  },
};

// `testId` exists because the costs screen carries this picker TWICE on one page — once as a list
// filter, once inside the record form. A single hardcoded id makes both the trigger and every
// option ambiguous, so a test has to select by position and breaks when the layout shifts.
export const TwoOnOnePageStayDistinct: Story = {
  render: (args) => {
    const [filterValue, setFilterValue] = useState<ExpenseKind | undefined>(undefined);
    const [formValue, setFormValue] = useState<ExpenseKind | undefined>(undefined);

    return (
      <HStack gap="4" align="start">
        <ExpenseKindSelect {...args} testId="filter-kind" filter value={filterValue} onChange={setFilterValue} />
        <ExpenseKindSelect {...args} testId="form-kind" value={formValue} onChange={setFormValue} />
      </HStack>
    );
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(canvas.getByTestId("form-kind"));
    await userEvent.click(await screen.findByTestId(`form-kind-${ExpenseKind.OPERATIONAL}`));

    await expect(canvas.getByTestId("form-kind")).not.toHaveTextContent(/^$/);
    // The filter beside it is untouched.
    await expect(canvas.getByTestId("filter-kind")).toBeInTheDocument();
  },
};
