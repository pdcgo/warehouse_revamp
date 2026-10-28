import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";

import { OrderTransactionRefusalReason } from "../../gen/warehouse/inventory/v1/order_transaction_pb";
import { TakeRefusalAlert, description } from "./TakeRefusalAlert";

// WHAT THE WAREHOUSE SAID WHEN IT REFUSED AN ORDER (a-refusal-names-its-reason-and-every-line) — shown by the order form
// and the draft page, so its rules are pinned once here rather than on two pages.
//
// The rules: the REASON is said in words (never a status code), every line the take named is listed by the name the
// page knows it by, and a short line says both what it wanted and what the warehouse holds — that pair is what tells
// the person how far to lower it.

const NAMES: Record<string, string> = {
  "71": "Kopi Arabika 250g",
  "72": "Teh Melati 100g",
};

const labelOf = (productId: bigint) => NAMES[productId.toString()] ?? `#${productId.toString()}`;

const meta = {
  title: "Features/Orders/TakeRefusalAlert",
  component: TakeRefusalAlert,
  parameters: { docs: { description: { component: description } } },
  args: {
    labelOf,
    refusal: {
      reason: OrderTransactionRefusalReason.NOT_ENOUGH_STOCK,
      lines: [
        { productId: 71n, wanted: 3n, available: 1n },
        { productId: 72n, wanted: 2n, available: 0n },
      ],
    },
  },
} satisfies Meta<typeof TakeRefusalAlert>;

export default meta;
type Story = StoryObj<typeof meta>;

// ── The states worth looking at ─────────────────────────────────────────────────────────────────

export const NotEnoughStock: Story = {};

export const AnotherTeamsProductIsNotAllowed: Story = {
  args: {
    refusal: {
      reason: OrderTransactionRefusalReason.NOT_ALLOWED,
      lines: [{ productId: 72n, wanted: 2n, available: 0n }],
    },
  },
};

export const AlreadyPlaced: Story = {
  args: { refusal: { reason: OrderTransactionRefusalReason.KEY_USED, lines: [] } },
};

// ── The rules worth failing on ──────────────────────────────────────────────────────────────────

// A SHORT LINE SAYS WHAT IT WANTED AND WHAT IS THERE, by name — the two numbers are how far to lower it.
export const AShortLineSaysWhatItWantedAndWhatIsThere: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("take-refusal")).toHaveTextContent(
      "The warehouse does not hold enough for this order",
    );
    await expect(canvas.getByTestId("take-refusal-line-71")).toHaveTextContent(
      "Kopi Arabika 250g: wants 3, the warehouse holds 1",
    );
    await expect(canvas.getByTestId("take-refusal-line-72")).toHaveTextContent(
      "Teh Melati 100g: wants 2, the warehouse holds 0",
    );
  },
};

// A REFUSED BORROWED PRODUCT names the product and what was wanted — "holds 0" would be a lie, since the warehouse may
// well hold it; it is the owner's rule that stops it.
export const ANotAllowedLineDoesNotClaimTheShelfIsEmpty: Story = {
  args: AnotherTeamsProductIsNotAllowed.args,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("take-refusal")).toHaveAttribute("data-reason", "notAllowed");

    const line = canvas.getByTestId("take-refusal-line-72");
    await expect(line).toHaveTextContent("Teh Melati 100g: wants 2");
    await expect(line).not.toHaveTextContent("holds");
  },
};

// A PRODUCT THE PAGE CANNOT NAME is still listed, by its id — a line the person cannot find is better than one missing.
export const AnUnnamedProductIsListedByItsId: Story = {
  args: {
    refusal: {
      reason: OrderTransactionRefusalReason.NOT_ENOUGH_STOCK,
      lines: [{ productId: 99n, wanted: 1n, available: 0n }],
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("take-refusal-line-99")).toHaveTextContent("#99: wants 1, the warehouse holds 0");
  },
};
