import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { Button } from "@chakra-ui/react";
import { expect, userEvent, within } from "storybook/test";

import { DataTable, description, type DataTableProps, type TableSort } from "./DataTable";

interface Row {
  id: number;
  product: string;
  rack: string;
  qty: number;
  value: number;
}

const ROWS: Row[] = [
  { id: 1, product: "Kaos Polos Hitam L", rack: "A-12", qty: 48, value: 1_440_000 },
  { id: 2, product: "Kaos Polos Putih M", rack: "A-13", qty: 12, value: 360_000 },
  { id: 3, product: "Hoodie Abu XL", rack: "B-01", qty: 5, value: 750_000 },
];

const COLUMNS = [
  { name: "Product", key: "product" as const, sortKey: "product" },
  { name: "Rack", key: "rack" as const },
  { name: "Qty", key: "qty" as const, sortKey: "qty", align: "end" as const },
];

// Typed as `Meta<DataTableProps<Row>>` rather than `Meta<typeof DataTable>`: the component is
// GENERIC, and inferring the meta from it collapses `T` to `unknown`, which then rejects every
// `key: "product"` in the column list. Naming the prop type is what keeps the columns type-checked
// against the row.
const meta: Meta<DataTableProps<Row>> = {
  title: "Legacy/Components/Display/DataTable",
  component: DataTable,
  parameters: { docs: { description: { component: description } } },
  args: { columns: COLUMNS, items: ROWS },
};

export default meta;
type Story = StoryObj<DataTableProps<Row>>;

export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByText("Kaos Polos Hitam L")).toBeVisible();
    await expect(canvas.getByText("A-12")).toBeVisible();
  },
};

// THE sort rule: unsorted, then ascending, then descending, then UNSORTED AGAIN. Without that third
// state a reader who sorted by quantity to answer one question can never get back to the natural
// order except by reloading the page.
export const SortCyclesBackToUnsorted: Story = {
  render: (args) => {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const [sort, setSort] = useState<TableSort | undefined>();

    return (
      <>
        <DataTable {...args} sort={sort} onSort={setSort} />
        <span data-testid="sort-state">{sort ? `${sort.key}:${sort.desc ? "desc" : "asc"}` : "none"}</span>
      </>
    );
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const header = canvas.getByTestId("th-qty");

    await userEvent.click(header);
    await expect(canvas.getByTestId("sort-state")).toHaveTextContent("qty:asc");

    await userEvent.click(header);
    await expect(canvas.getByTestId("sort-state")).toHaveTextContent("qty:desc");

    await userEvent.click(header);
    await expect(canvas.getByTestId("sort-state")).toHaveTextContent("none");
  },
};

// Loading with NOTHING yet: skeleton rows, so the table already has its final height and the page
// does not jump when the data lands.
export const LoadingEmptyShowsSkeleton: Story = {
  args: { items: [], loading: true, skeletonRows: 4 },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("table-skeleton")).toBeVisible();
  },
};

// Loading OVER existing rows: a spinner, and the rows stay readable — they are still the best answer
// available. Replacing them with grey bars would be strictly less information.
export const LoadingWithRowsKeepsThem: Story = {
  args: { loading: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.queryByTestId("table-skeleton")).toBeNull();
    await expect(canvas.getByTestId("spinner-overlay")).toBeVisible();
    await expect(canvas.getByText("Kaos Polos Hitam L")).toBeInTheDocument();
  },
};

export const Empty: Story = {
  args: { items: [], emptyTitle: "No stock in this rack", emptyContent: "Move something here to see it listed." },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("empty-hint")).toHaveTextContent("No stock in this rack");
  },
};

export const ErrorState: Story = {
  args: { items: [], isError: true, errorTitle: "Could not load stock", errorContent: "The warehouse service did not respond." },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("empty-hint")).toHaveTextContent("Could not load stock");
  },
};

// ONE BAD CELL MUST NOT BLANK THE PAGE. A render function runs against server data, and in React an
// uncaught render error unmounts the whole tree — the operator would lose the screen with no clue
// which row did it. The boundary keeps the failure inside the table.
export const OneBadCellFailsOnlyTheTable: Story = {
  args: {
    columns: [
      { name: "Product", key: "product" as const },
      {
        name: "Boom",
        render: () => {
          throw new Error("cell exploded");
        },
      },
    ],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    // The page around it survives, and the message says the TABLE is what broke.
    await expect(canvas.getByTestId("empty-hint")).toHaveTextContent("cell exploded");
  },
};

// A group header spans its children, and every leafless sibling gains a rowspan so the two header
// rows stay aligned instead of leaving a hole above the ungrouped columns.
export const GroupedHeader: Story = {
  args: {
    columns: [
      { name: "Product", key: "product" as const },
      {
        name: "Stock",
        children: [
          { name: "Qty", key: "qty" as const, align: "end" as const },
          { name: "Value", key: "value" as const, align: "end" as const },
        ],
      },
    ],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByText("Stock")).toBeVisible();
    await expect(canvas.getByText("Qty")).toBeVisible();
  },
};

export const RowClick: Story = {
  args: {
    onRowClick: () => {},
    columns: [
      ...COLUMNS,
      {
        name: "",
        width: "1%",
        render: () => (
          <Button size="xs" variant="ghost">
            Move
          </Button>
        ),
      },
    ],
  },
};
