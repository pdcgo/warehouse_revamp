import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";

import { MovementKind } from "../../gen/warehouse/inventory/v1/inventory_pb";
import { MovementTable, type MovementRow } from "./MovementTable";

// THE STOCK LEDGER — one component for a product's, a shelf's and a batch's history. The shape is fixed
// (When · What · <context> · Change · After); only the context columns and the after-label vary, by what
// the page is about. Here on its own so it can be read beside the money ledgers.
//
//   | story                | the rule it pins                                                |
//   | -------------------- | --------------------------------------------------------------- |
//   | Default              | the bare five questions; the sign is written, zero has none      |
//   | WithContextColumns   | context columns sit between What and Change, in the given order  |
//   | TheAfterLabelIsTheCallers | the balance column says WHICH number it is                  |
//   | Empty                | the page's own sentence under the header                         |

const row = (id: bigint, createdAt: string, kind: MovementKind, delta: bigint, balance: bigint, extra: Partial<MovementRow> = {}): MovementRow => ({
  id,
  createdAt,
  kind,
  delta,
  balance,
  actorUserId: 61n,
  batchId: 801n,
  productId: 41n,
  rackId: 71n,
  ...extra,
});

const movements: MovementRow[] = [
  row(4n, "2026-09-30T14:10:00+07:00", MovementKind.PICK, -2n, 22n),
  row(3n, "2026-09-29T09:00:00+07:00", MovementKind.ADJUST, 0n, 24n, { actorUserId: 62n }),
  row(2n, "2026-09-28T16:30:00+07:00", MovementKind.MOVE, 4n, 24n, { rackId: 72n }),
  row(1n, "2026-09-25T10:00:00+07:00", MovementKind.RECEIVE, 20n, 20n, { batchId: 0n }),
];

const meta = {
  title: "Features/Inventory/MovementTable",
  component: MovementTable,
  args: {
    movements,
    testId: "ledger",
    afterLabel: "After",
    emptyText: "Nothing has moved here yet.",
  },
} satisfies Meta<typeof MovementTable>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The five questions and nothing else. A change is signed; a movement that moved nothing has no sign. */
export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId("ledger-row-1")).toHaveTextContent("+20");
    await expect(canvas.getByTestId("ledger-row-4")).toHaveTextContent("-2");
    await expect(canvas.getByTestId("ledger-row-3")).not.toHaveTextContent("+0");
  },
};

/** Who, which batch and which shelf — between What and Change, in the order the page listed them. */
export const WithContextColumns: Story = {
  args: {
    columns: ["by", "batch", "place"],
    actorNames: new Map([
      ["61", "Ani"],
      ["62", "Budi"],
    ]),
    rackLabel: (id: bigint) => (id === 71n ? "A-01-02" : "A-03-01"),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const headers = Array.from(canvas.getByTestId("ledger-table").querySelectorAll("th")).map((th) => th.textContent);
    await expect(headers).toHaveLength(7);
    await expect(canvas.getByTestId("ledger-row-2")).toHaveTextContent("A-03-01");
    await expect(canvas.getByTestId("ledger-row-3")).toHaveTextContent("Budi");
    // A batch-less recount reads as a dash, not "#0".
    await expect(canvas.getByTestId("ledger-row-1")).not.toHaveTextContent("#0");
  },
};

/** The same `balance` means a batch's ready units, a shelf's count or a place's — so the page names it. */
export const TheAfterLabelIsTheCallers: Story = {
  args: { afterLabel: "On shelf after" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId("ledger-table")).toHaveTextContent("On shelf after");
  },
};

export const Empty: Story = {
  args: { movements: [] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId("ledger-empty")).toHaveTextContent("Nothing has moved here yet.");
  },
};
