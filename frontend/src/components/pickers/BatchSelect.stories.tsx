import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Text } from "@chakra-ui/react";
import { expect, fn, userEvent, waitFor, within } from "storybook/test";

import { BatchSelect, description } from "./BatchSelect";

// Gudang Pusat (11) holds two batches of Beras (74) with stock — #7 and #9, from restocks 1007 and 1009, three units
// ready in each (foundRequestFixtures.ts, the register Koreksi reads). Product 999 has none.

function Controlled(args: { productId: bigint; onChange?: (id: bigint) => void }) {
  const [value, setValue] = useState(0n);

  return (
    <>
      <BatchSelect
        warehouseId={11n}
        productId={args.productId}
        value={value}
        onChange={(id) => {
          setValue(id);
          args.onChange?.(id);
        }}
      />
      <Text mt="3" fontSize="sm" data-testid="picked">
        {value > 0n ? `#${value}` : "(none)"}
      </Text>
    </>
  );
}

const meta = {
  title: "Components/Pickers/BatchSelect",
  component: BatchSelect,
  parameters: { docs: { description: { component: description } } },
  args: { warehouseId: 11n, productId: 74n, value: 0n, onChange: fn() },
  render: (args) => <Controlled productId={args.productId} onChange={args.onChange} />,
} satisfies Meta<typeof BatchSelect>;

export default meta;
type Story = StoryObj<typeof meta>;

async function open(canvasElement: HTMLElement) {
  const canvas = within(canvasElement);
  const input = canvas.getByTestId("batch-select");
  await userEvent.click(input);
  return { canvas, input };
}

// EACH OPTION IS THE BATCH'S OWN NUMBER (a-batch-is-picked-by-its-own-number) — with its ready count, and where it came
// from under it; never the restock's number as its name.
export const Default: Story = {
  play: async ({ canvasElement }) => {
    const { canvas } = await open(canvasElement);

    const seven = await canvas.findByTestId("batch-select-option-7");
    await waitFor(() => expect(seven).toBeVisible());
    await expect(seven).toHaveTextContent(/^#7/);
    await expect(seven).toHaveTextContent("Ready 3");
    await expect(seven).toHaveTextContent("Restock #1007");
    await expect(canvas.getByTestId("batch-select-option-9")).toBeVisible();
  },
};

// TYPED, IT SEARCHES THE BATCH'S NUMBER OR ITS RESTOCK'S — "#9" and "1009" find the same one; the ready count the label
// also carries is not searched.
export const SearchesByNumber: Story = {
  name: "Searches by number",
  play: async ({ canvasElement }) => {
    const { canvas, input } = await open(canvasElement);

    await userEvent.type(input, "#9", { delay: 30 });
    await waitFor(() => expect(canvas.queryByTestId("batch-select-option-7")).toBeNull());
    await expect(canvas.getByTestId("batch-select-option-9")).toBeVisible();

    await userEvent.clear(input);
    await userEvent.type(input, "1007", { delay: 30 });
    await waitFor(() => expect(canvas.queryByTestId("batch-select-option-9")).toBeNull());
    await expect(canvas.getByTestId("batch-select-option-7")).toBeVisible();
  },
};

// A pick names the batch in the field; the × clears it to none (0n), never to nothing.
export const PicksAndClears: Story = {
  name: "Picks and clears",
  play: async ({ args, canvasElement }) => {
    const { canvas, input } = await open(canvasElement);

    const nine = await canvas.findByTestId("batch-select-option-9");
    await waitFor(() => expect(nine).toBeVisible());
    await userEvent.click(nine);
    await waitFor(() => expect(input).toHaveValue("#9 · 3 ready"));
    await expect(canvas.getByTestId("picked")).toHaveTextContent("#9");

    await userEvent.click(canvas.getByTestId("batch-select-clear"));
    await waitFor(() => expect(canvas.getByTestId("picked")).toHaveTextContent("(none)"));
    await expect(args.onChange).toHaveBeenLastCalledWith(0n);
  },
};

// A product with no batch holding stock says so — not "no match", since nothing was typed.
export const NothingWithStock: Story = {
  name: "Nothing with stock",
  args: { productId: 999n },
  play: async ({ canvasElement }) => {
    const { canvas } = await open(canvasElement);

    await expect(await canvas.findByText("No batch still holds stock")).toBeVisible();
  },
};
