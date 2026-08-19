import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, waitFor, within } from "storybook/test";

import { ORDERS } from "../../fixtures";
import { OrderDraftFinishPage, description } from "./index";

const MISSING = [
  { key: "address", label: "Delivery address", hint: "Street, city and postcode." },
  { key: "courier", label: "Courier" },
];

const meta = {
  title: "Legacy/Pages/Orders/OrderDraftFinish",
  component: OrderDraftFinishPage,
  parameters: { docs: { description: { component: description } } },
  args: { draft: { ...ORDERS[2], status: "draft" }, missing: MISSING, onSubmit: fn() },
} satisfies Meta<typeof OrderDraftFinishPage>;

export default meta;
type Story = StoryObj<typeof meta>;

// ⚠ THE FORM IS BUILT FROM WHAT IS MISSING. A full edit form with everything pre-filled would make
// the operator hunt for which boxes are actually blocking the order.
export const OnlyTheMissingFieldsAreShown: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("draft-field-address")).toBeVisible();
    await expect(canvas.getByTestId("draft-field-courier")).toBeVisible();
    // The known details are context, not inputs.
    await expect(canvas.getByTestId("draft-context")).toHaveTextContent("Gudang Selatan");
    await expect(canvas.queryByTestId("draft-field-shop")).toBeNull();
  },
};

// Partly finished is still a draft — submitting one just produces the same draft, one field better.
export const IncompleteCannotBeSubmitted: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("draft-finish-submit")).toBeDisabled();

    await userEvent.type(canvas.getByTestId("draft-field-address"), "Jl. Merdeka 10", { delay: 10 });
    // Still one field short.
    await expect(canvas.getByTestId("draft-finish-submit")).toBeDisabled();
    await expect(args.onSubmit).not.toHaveBeenCalled();
  },
};

export const CompleteEnablesFinish: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);

    await userEvent.type(canvas.getByTestId("draft-field-address"), "Jl. Merdeka 10", { delay: 10 });
    await userEvent.type(canvas.getByTestId("draft-field-courier"), "JNE", { delay: 10 });

    await waitFor(async () => {
      await expect(canvas.getByTestId("draft-finish-submit")).toBeEnabled();
    });

    await userEvent.click(canvas.getByTestId("draft-finish-submit"));
    await expect(args.onSubmit).toHaveBeenCalled();
  },
};

// One missing field reads as one, not "1 details".
export const SingleMissingField: Story = {
  args: { missing: [{ key: "courier", label: "Courier" }] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("alert")).toHaveTextContent("1 detail still needed");
  },
};
