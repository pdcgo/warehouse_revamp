import type { Meta, StoryObj } from "@storybook/react-vite";
import { Badge, Stack, Table } from "@chakra-ui/react";
import { expect, within } from "storybook/test";

import {
  type FigureMarks,
  NO_FIGURE_MARKS,
  SupplierFigureCells,
  SupplierFigureHeaders,
  SupplierFigureIcons,
  SupplierFigureLines,
  description,
} from "./SupplierFigures";
import type { SupplierFigureValues } from "./figureValues";
import { sampleProductFigures } from "./sampleSupplierFigures";

// THE FIGURES — every unit sold with the last order, every unit ready with the last restock — as table columns, as a
// block's lines and as a card's badges: on the supplier list and Discover for a supplier, on the supplier's page for a
// store and a product (discover-shows-the-same-figures-and-filters, the-detail-tabs-show-sold-and-ready). A supplier's
// and a store's are real and unmarked; a product's are still invented and carry the page's marks.

const DAY = 86_400n;
const NOW = BigInt(Math.floor(Date.now() / 1000));
const STOCKED: SupplierFigureValues = { sold: 4135, orders: 260, lastOrderAt: NOW - 2n * DAY, ready: 155, restocks: 14, lastRestockAt: NOW - 8n * DAY };
// Goods that arrived and never sold: 0, no order date.
const UNSOLD: SupplierFigureValues = { sold: 0, orders: 0, lastOrderAt: 0n, ready: 40, restocks: 1, lastRestockAt: NOW - 20n * DAY };
// None of its goods ever arrived — nothing to count.
const NEVER = null;
// A product's row already says when it was bought, so its figures carry no restock date.
const PRODUCT = sampleProductFigures(7n, 1n);
// The page's marks — a product's figures are invented.
const MARKS: FigureMarks = {
  sold: <Badge data-testid="mark-sold">1</Badge>,
  ready: <Badge data-testid="mark-ready">2</Badge>,
};

function Both() {
  return (
    <Stack gap="6">
      <Table.Root size="sm">
        <Table.Header>
          <Table.Row>
            <SupplierFigureHeaders marks={NO_FIGURE_MARKS} />
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {(
            [
              ["7", STOCKED],
              ["9", UNSOLD],
              ["8", NEVER],
              ["product", PRODUCT],
            ] as const
          ).map(([id, figures]) => (
            <Table.Row key={id}>
              <SupplierFigureCells figures={figures} id={id} testIdPrefix="figures" />
            </Table.Row>
          ))}
        </Table.Body>
      </Table.Root>
      <SupplierFigureLines figures={STOCKED} marks={NO_FIGURE_MARKS} testId="figures-lines" />
      <SupplierFigureLines figures={UNSOLD} marks={NO_FIGURE_MARKS} testId="figures-lines-unsold" />
      <SupplierFigureLines figures={NEVER} marks={NO_FIGURE_MARKS} testId="figures-lines-none" />
      <SupplierFigureLines figures={PRODUCT} marks={MARKS} testId="figures-lines-product" />
      <SupplierFigureIcons figures={STOCKED} marks={NO_FIGURE_MARKS} testId="figures-icons" />
      <SupplierFigureIcons figures={NEVER} marks={NO_FIGURE_MARKS} testId="figures-icons-none" />
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

/**
 * Each figure with its last date under it; goods that never sold read 0 with no order date; a supplier none of whose
 * goods arrived is a dash in the table and no lines. Only a product's invented figures carry marks.
 */
export const ColumnsAndLines: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId("figures-sold-7")).toHaveTextContent(/^4\.135ordered /);
    await expect(canvas.getByTestId("figures-ready-7")).toHaveTextContent(/^155restocked /);
    await expect(canvas.getByTestId("figures-sold-9")).toHaveTextContent(/^0$/);
    await expect(canvas.getByTestId("figures-ready-9")).toHaveTextContent(/^40restocked /);
    await expect(canvas.getByTestId("figures-sold-8")).toHaveTextContent("—");
    await expect(canvas.getByTestId("figures-lines")).toHaveTextContent(/Sold 4\.135 · ordered .+Ready 155 · restocked /);
    await expect(canvas.getByTestId("figures-lines-unsold")).toHaveTextContent(/^Sold 0Ready 40 · restocked /);
    await expect(canvas.queryByTestId("figures-lines-none")).toBeNull();
    // A card's row: the units by their icons, no dates; a dash for each, unmarked, when nothing arrived.
    await expect(canvas.getByTestId("figures-icons")).not.toHaveTextContent(/ordered|restocked/);
    await expect(canvas.getByTestId("figures-icons-none-ready")).toHaveTextContent("—");
    // A product: the last order, but no restock date — its row's Terakhir dibeli says it — and the page's marks.
    await expect(canvas.getByTestId("figures-sold-product")).toHaveTextContent(/ordered /);
    await expect(canvas.getByTestId("figures-ready-product")).toHaveTextContent(/^\d+$/);
    await expect(canvas.getByTestId("figures-lines-product")).not.toHaveTextContent("restocked");
    await expect(canvas.getAllByTestId("mark-sold")).toHaveLength(1);
    await expect(canvas.queryByTestId("not-implemented-sold")).toBeNull();
  },
};
