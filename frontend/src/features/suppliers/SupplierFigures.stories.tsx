import type { Meta, StoryObj } from "@storybook/react-vite";
import { Stack, Table } from "@chakra-ui/react";
import { expect, within } from "storybook/test";

import {
  LIST_FIGURE_MARKS as MARKS,
  SupplierFigureCells,
  SupplierFigureHeaders,
  SupplierFigureIcons,
  SupplierFigureLines,
  description,
} from "./SupplierFigures";
import { sampleFiguresFor, sampleProductFigures } from "./sampleSupplierFigures";

// THE FIGURES — every unit sold with the last order, every unit ready with the last restock — as table columns, as a
// block's lines and as a card's badges: on the supplier list and Discover for a supplier, on the supplier's page for a
// store and a product (discover-shows-the-same-figures-and-filters, the-detail-tabs-show-sold-and-ready).

const STOCKED = sampleFiguresFor({ id: 7n, channels: [{}] });
const STORELESS = sampleFiguresFor({ id: 8n, channels: [] });
// A product's row already says when it was bought, so its figures carry no restock date.
const PRODUCT = sampleProductFigures(7n, 1n);

function Both() {
  return (
    <Stack gap="6">
      <Table.Root size="sm">
        <Table.Header>
          <Table.Row>
            <SupplierFigureHeaders marks={MARKS} />
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {(
            [
              ["7", STOCKED],
              ["8", STORELESS],
              ["product", PRODUCT],
            ] as const
          ).map(([id, figures]) => (
            <Table.Row key={id}>
              <SupplierFigureCells figures={figures} id={id} testIdPrefix="figures" />
            </Table.Row>
          ))}
        </Table.Body>
      </Table.Root>
      <SupplierFigureLines figures={STOCKED} marks={MARKS} testId="figures-lines" />
      <SupplierFigureLines figures={STORELESS} marks={MARKS} testId="figures-lines-none" />
      <SupplierFigureLines figures={PRODUCT} marks={MARKS} testId="figures-lines-product" />
      <SupplierFigureIcons figures={STOCKED} marks={MARKS} testId="figures-icons" />
      <SupplierFigureIcons figures={STORELESS} marks={MARKS} testId="figures-icons-none" />
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
    // A product: the last order, but no restock date — its row's Terakhir dibeli says it.
    await expect(canvas.getByTestId("figures-sold-product")).toHaveTextContent(/ordered /);
    await expect(canvas.getByTestId("figures-ready-product")).toHaveTextContent(/^\d+$/);
    await expect(canvas.getByTestId("figures-lines-product")).not.toHaveTextContent("restocked");
    await expect(canvas.getAllByTestId("not-implemented-sold").length).toBe(4);
  },
};
