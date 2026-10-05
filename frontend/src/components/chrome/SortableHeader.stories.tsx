import { useState } from "react";

import type { Meta, StoryObj } from "@storybook/react-vite";
import { Table } from "@chakra-ui/react";
import { expect, userEvent, within } from "storybook/test";

import { SortableHeader, type SortState, description } from "./SortableHeader";

type Column = "name" | "amount";

// A two-column table holding its own sort, so every click is real state.
function Harness({ initial = null }: { initial?: SortState<Column> | null }) {
  const [sort, setSort] = useState<SortState<Column> | null>(initial);

  return (
    <Table.Root size="sm">
      <Table.Header>
        <Table.Row>
          <SortableHeader column="name" label="Name" sort={sort} onSortChange={setSort} firstDir="asc" testId="sort-name" />
          <SortableHeader column="amount" label="Amount" sort={sort} onSortChange={setSort} end testId="sort-amount" />
          <SortableHeader column="name" label="Note" sort={sort} />
        </Table.Row>
      </Table.Header>
    </Table.Root>
  );
}

const meta = {
  title: "Components/Chrome/SortableHeader",
  component: Harness,
  parameters: { docs: { description: { component: description } } },
} satisfies Meta<typeof Harness>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Unsorted: Story = {};

export const SortedByAmount: Story = { args: { initial: { by: "amount", dir: "desc" } } };

/** A measure starts LARGEST first, a name A to Z — and each then flips, never back to unsorted. */
export const FirstClickThenFlip: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const name = canvas.getByTestId("sort-name");
    const amount = canvas.getByTestId("sort-amount");

    await userEvent.click(amount);
    await expect(amount).toHaveAttribute("data-sort", "desc");
    await userEvent.click(amount);
    await expect(amount).toHaveAttribute("data-sort", "asc");
    await userEvent.click(amount);
    await expect(amount).toHaveAttribute("data-sort", "desc");

    await userEvent.click(name);
    await expect(name).toHaveAttribute("data-sort", "asc");
    await expect(amount).not.toHaveAttribute("data-sort");
    await expect(name.closest("th")).toHaveAttribute("aria-sort", "ascending");
  },
};

/** No handler, no button — a column whose order would mean nothing stays plain text. */
export const APlainHeadingIsNotAButton: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("columnheader", { name: "Note" }).querySelector("button")).toBeNull();
  },
};
