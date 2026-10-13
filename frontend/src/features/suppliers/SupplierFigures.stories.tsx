import type { Meta, StoryObj } from "@storybook/react-vite";
import { Stack, Table } from "@chakra-ui/react";
import { expect, within } from "storybook/test";

import {
  SupplierFigureCells,
  SupplierFigureHeaders,
  SupplierFigureIcons,
  SupplierFigureLines,
  description,
} from "./SupplierFigures";

// A SUPPLIER'S FIGURES — every unit sold with the last order, every unit ready with the last restock — as table columns
// and as a block's lines, on the supplier list and on Discover alike (discover-shows-the-same-figures-and-filters).

const STOCKED = { id: 7n, channels: [{}] };
const STORELESS = { id: 8n, channels: [] };

function Both() {
  return (
    <Stack gap="6">
      <Table.Root size="sm">
        <Table.Header>
          <Table.Row>
            <SupplierFigureHeaders />
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {[STOCKED, STORELESS].map((supplier) => (
            <Table.Row key={supplier.id.toString()}>
              <SupplierFigureCells supplier={supplier} testIdPrefix="figures" />
            </Table.Row>
          ))}
        </Table.Body>
      </Table.Root>
      <SupplierFigureLines supplier={STOCKED} testId="figures-lines" />
      <SupplierFigureLines supplier={STORELESS} testId="figures-lines-none" />
      <SupplierFigureIcons supplier={STOCKED} testId="figures-icons" />
      <SupplierFigureIcons supplier={STORELESS} testId="figures-icons-none" />
    </Stack>
  );
}

const meta = {
  title: "Features/Suppliers/SupplierFigures",
  component: Both,
  parameters: { docs: { description: { component: description } } },
} satisfies Meta<typeof Both>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Each figure with its last date under it, marked; a store-less supplier a dash in the table and no lines. */
export const ColumnsAndLines: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId("figures-sold-7")).toHaveTextContent(/^[\d.]+ordered /);
    await expect(canvas.getByTestId("figures-ready-7")).toHaveTextContent(/^[\d.]+restocked /);
    await expect(canvas.getByTestId("figures-sold-8")).toHaveTextContent("—");
    await expect(canvas.getByTestId("figures-lines")).toHaveTextContent(/Sold [\d.]+ · ordered .+Ready [\d.]+ · restocked /);
    await expect(canvas.queryByTestId("figures-lines-none")).toBeNull();
    // A card's row: the units by their icons, no dates; a dash for each, unmarked, when there is no store.
    await expect(canvas.getByTestId("figures-icons")).not.toHaveTextContent(/ordered|restocked/);
    await expect(canvas.getByTestId("figures-icons-none-ready")).toHaveTextContent("—");
    await expect(canvas.getAllByTestId("not-implemented-sold").length).toBe(3);
  },
};
