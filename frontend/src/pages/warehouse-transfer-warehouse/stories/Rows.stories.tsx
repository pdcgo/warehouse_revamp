import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { transferWire } from "../../../../.storybook/warehouseTransferStub";
import { userNamedForStory } from "../../../../.storybook/userStub";
import { WarehouseTransferStatus } from "../../../gen/warehouse/inventory/v1/warehouse_transfer_pb";
import { WAREHOUSE_META, loaded, openedByRoot } from "./kit";

// TRANSFER WAREHOUSE — what a DESKTOP row shows and the acts it runs. The page's stories are grouped by the part of the
// screen they are about (stories-are-grouped-by-the-part-of-the-screen); what they share is ./kit.tsx.

const meta = {
  title: "Pages/Inventory/WarehouseTransfer/TransferWarehouse/Rows",
  ...WAREHOUSE_META,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

// THE DESKTOP KEEPS ITS TABLE — the phone's blocks are below `md` only.
export const ADesktopReadsATable: Story = {
  name: "A desktop reads a table",
  globals: { viewport: { value: "desktop1440" } },
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(window.innerWidth).toBe(1440);
    await expect(canvas.getByTestId("transfers-table").tagName).toBe("TABLE");
    await expect(canvasElement.querySelector("[data-layout]")).toBeNull();
  },
};

export const Outgoing: Story = {
  name: "Outgoing",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    // Two owners' goods leave this building…
    await expect(canvas.getByTestId("transfer-row-609")).toBeInTheDocument();
    // …and the one coming IN is not on the outgoing list.
    await expect(canvas.queryByTestId("transfer-row-608")).toBeNull();
    // The next act is on the row: process a created one, ship a processed one.
    await expect(canvas.getByTestId("transfer-action-process-601")).toBeInTheDocument();
    await expect(canvas.getByTestId("transfer-action-ship-602")).toBeInTheDocument();
  },
};

export const Incoming: Story = {
  name: "Incoming",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.click(canvas.getByTestId("transfer-direction-incoming"));
    await waitFor(() => expect(canvas.queryByTestId("transfer-row-601")).toBeNull());
    await expect(canvas.getByTestId("transfer-row-608")).toBeInTheDocument();
    await expect(canvas.getByTestId("transfer-action-accept-608")).toBeInTheDocument();
  },
};

// Accepting is counting, line by line — a page, not a dialog.
export const AcceptOpensTheCount: Story = {
  name: "Accept opens the count",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.click(canvas.getByTestId("transfer-direction-incoming"));
    await userEvent.click(await canvas.findByTestId("transfer-action-accept-608"));
    await canvas.findByTestId("at-transfer-accept");
  },
};

// PROCESS FROM THE ROW — the act runs: it confirms, the transfer moves to process, and the row now offers Ship. The row
// is not opened by it.
export const ProcessFromTheRow: Story = {
  name: "Process from the row",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.click(canvas.getByTestId("transfer-action-process-601"));
    await userEvent.click(await screen.findByTestId("confirm-action"));
    await waitFor(() => expect(transferWire(601n).status).toBe(WarehouseTransferStatus.PROCESS));
    await canvas.findByTestId("transfer-action-ship-601", {}, { timeout: 4000 });
    await expect(canvas.queryByTestId("at-transfer-detail")).toBeNull();
  },
};

// The crew counts boxes; another team's values are not its business.
export const NoValues: Story = {
  name: "No values",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(canvas.queryByText(/Rp\s/)).toBeNull();
  },
};

// THE ROW SAYS WHO OPENED IT (the-transfer-lists-read-as-blocks-on-a-phone, as the restock inbound row does —
// the-inbound-row-says-who-and-when): the owning team, then the person small under its name. One context, two lines —
// never three.
export const TheRowSaysWhoOpenedIt: Story = {
  name: "The row says who opened it",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const cell = canvas.getByTestId("transfer-owner-601");
    const created = await within(cell).findByTestId("transfer-created-by-601");

    await waitFor(() => expect(cell).toHaveTextContent("Toko Melati"));
    await waitFor(() => expect(created).toHaveTextContent(/^by Ani Rahayu$/));
    await expect(within(cell).queryByTestId("root-team-badge")).toBeNull();
    // Under the team's name, not beside it.
    const name = within(cell).getByText("Toko Melati");
    await expect(created.getBoundingClientRect().top).toBeGreaterThanOrEqual(name.getBoundingClientRect().bottom - 1);
    const textLeft = created.getBoundingClientRect().left + parseFloat(getComputedStyle(created).paddingLeft);
    await expect(Math.abs(textLeft - name.getBoundingClientRect().left)).toBeLessThan(2);
    // Two lines, not three: the team's line and the person's.
    const lineHeight = parseFloat(getComputedStyle(created).lineHeight) || 16;
    await expect(cell.getBoundingClientRect().height).toBeLessThan(lineHeight * 2 + 40);
    // The other team's transfer leaving this building names its own opener too.
    await waitFor(() => expect(canvas.getByTestId("transfer-created-by-609")).toHaveTextContent(/^by /));
  },
};

// OPENED BY ROOT FROM OUTSIDE (an-override-shows-a-platform-badge): Fajar with the "by Root team" badge after his name,
// on his line, whole — even when his name is long. No other row carries one.
export const OpenedByRootFromOutside: Story = {
  name: "Opened by Root from outside",
  beforeEach: () => {
    openedByRoot();
    userNamedForStory(66n, "Fajar Nugroho Wicaksono Adiputra Prasetyo");
  },
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const created = await canvas.findByTestId("transfer-created-by-601");

    await waitFor(() => expect(created).toHaveTextContent("by Fajar Nugroho Wicaksono Adiputra Prasetyo"));
    const badge = within(created).getByTestId("root-team-badge");
    await expect(badge).toHaveTextContent("by Root team");
    await expect(badge).toBeVisible();
    await expect(badge.getBoundingClientRect().top).toBeGreaterThanOrEqual(created.getBoundingClientRect().top - 1);
    await expect(badge.getBoundingClientRect().bottom).toBeLessThanOrEqual(created.getBoundingClientRect().bottom + 4);
    await expect(within(canvas.getByTestId("transfers-table")).getAllByTestId("root-team-badge")).toHaveLength(1);
  },
};
