import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { teams } from "../../../../.storybook/fixtures";
import { userNamedForStory } from "../../../../.storybook/userStub";
import { transferWire } from "../../../../.storybook/warehouseTransferStub";
import { WarehouseTransferStatus } from "../../../gen/warehouse/inventory/v1/warehouse_transfer_pb";
import { fitsTheScreen, tabsDoNotOverlap, theBadgeIsWhole } from "../../../features/warehouseTransfer/storyPhone";
import { WAREHOUSE_META, loaded, openedByRoot, warehouseAt } from "./kit";

// TRANSFER WAREHOUSE ON A PHONE (the-transfer-lists-read-as-blocks-on-a-phone, accepted 2026-11-14) — below `md` the
// queue stops drawing its table. The block is the restock INBOUND block's shape: number · status; when; whose goods and
// who opened them, with the Root badge (the-inbound-row-says-who-and-when); the other end; the courier and the tracking
// number; what is in it; the next act, named, at its foot — the desktop row's own WarehouseTransferActions, so it runs
// the same dialog and the same write. No values — the goods are a selling team's.
//
// At the 390px it was accepted at, and at 320px. The page's other stories are grouped by the part of the screen they are
// about; what they share is ./kit.tsx.

const meta = {
  title: "Pages/Inventory/WarehouseTransfer/TransferWarehouse/Phone",
  ...WAREHOUSE_META,
  globals: { viewport: { value: "phone390" } },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

// ── The blocks ───────────────────────────────────────────────────────────────────────────────────────────────────

// A BLOCK READS THE TRANSFER: whose goods and who opened them; where it goes; the parcel once shipped; the next act.
export const TheBlock: Story = {
  name: "A block reads the transfer",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const block = canvas.getByTestId("transfer-row-601");

    await expect(block).toHaveTextContent("#601");
    await waitFor(() => expect(within(block).getByTestId("transfer-owner-601")).toHaveTextContent("Toko Melati"));
    await waitFor(() => expect(within(block).getByTestId("transfer-created-by-601")).toHaveTextContent("by Ani Rahayu"));
    await waitFor(() => expect(within(block).getByTestId("transfer-other-601")).toHaveTextContent(/^To Gudang Cabang$/));
    await expect(within(block).getByTestId("transfer-action-process-601")).toBeVisible();
    await expect(canvas.getByTestId("transfer-action-ship-602")).toBeVisible();
    // The parcel, once A has shipped it.
    await expect(canvas.getByTestId("transfer-parcel-603")).toHaveTextContent("JNE7788990011");
    // Another team's goods leave here too, and the crew sees no values.
    await expect(canvas.getByTestId("transfer-row-609")).toBeInTheDocument();
    await expect(canvas.queryByText(/Rp\s/)).toBeNull();
    await fitsTheScreen(canvasElement);
  },
};

export const Incoming: Story = {
  name: "Incoming — Accept opens the count",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.click(canvas.getByTestId("transfer-direction-incoming"));
    const block = await canvas.findByTestId("transfer-row-608", {}, { timeout: 4000 });
    await waitFor(() => expect(canvas.queryByTestId("transfer-row-601")).toBeNull());

    await waitFor(() => expect(within(block).getByTestId("transfer-other-608")).toHaveTextContent(/^From Gudang Cabang$/));
    await expect(within(block).getByTestId("transfer-parcel-608")).toHaveTextContent("SCP9988776655");
    await expect(within(block).getByTestId("transfer-action-arrive-608")).toBeVisible();
    await fitsTheScreen(canvasElement);

    await userEvent.click(within(block).getByTestId("transfer-action-accept-608"));
    await canvas.findByTestId("at-transfer-accept");
  },
};

// THE BLOCK OPENS THE TRANSFER; its act does not.
export const TheBlockOpensTheTransfer: Story = {
  name: "A block opens the transfer",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.click(canvas.getByTestId("transfer-other-601"));
    await canvas.findByTestId("at-transfer-detail");
  },
};

// ── The next act, run from the block ─────────────────────────────────────────────────────────────────────────────

// PROCESS, THEN SHIP — the button at the block's foot does what it names: Process confirms and moves 601 to process (the
// block then offers Ship), Ship records the tracking number and moves it on (the block then shows the number). Neither
// opens the transfer.
export const ProcessThenShipFromTheBlock: Story = {
  name: "Process, then Ship, from the block",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const block = canvas.getByTestId("transfer-row-601");

    await userEvent.click(within(block).getByTestId("transfer-action-process-601"));
    await userEvent.click(await screen.findByTestId("confirm-action"));
    await waitFor(() => expect(transferWire(601n).status).toBe(WarehouseTransferStatus.PROCESS));
    const ship = await within(block).findByTestId("transfer-action-ship-601", {}, { timeout: 4000 });
    await expect(within(block).queryByTestId("transfer-action-process-601")).toBeNull();
    await expect(canvas.queryByTestId("at-transfer-detail")).toBeNull();

    await userEvent.click(ship);
    await userEvent.type(await screen.findByTestId("transfer-ship-tracking"), "JNE5566", { delay: 20 });
    await userEvent.click(screen.getByTestId("confirm-action"));
    await waitFor(() => expect(transferWire(601n).status).toBe(WarehouseTransferStatus.SHIPPED));
    await expect(transferWire(601n).receipt).toBe("JNE5566");
    await waitFor(() => expect(within(block).getByTestId("transfer-parcel-601")).toHaveTextContent("JNE5566"));
    await expect(within(block).queryByTestId("transfer-action-ship-601")).toBeNull();
    await expect(canvas.queryByTestId("at-transfer-detail")).toBeNull();
  },
};

// SIGN FOR THE BOX from the incoming block — 608 arrives; only Accept is left on it.
export const SignFromTheBlock: Story = {
  name: "Sign for the box, from the block",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.click(canvas.getByTestId("transfer-direction-incoming"));
    const block = await canvas.findByTestId("transfer-row-608", {}, { timeout: 4000 });
    await userEvent.click(within(block).getByTestId("transfer-action-arrive-608"));
    await userEvent.click(await screen.findByTestId("confirm-action"));

    await waitFor(() => expect(transferWire(608n).status).toBe(WarehouseTransferStatus.ARRIVED));
    await waitFor(() => expect(within(block).queryByTestId("transfer-action-arrive-608")).toBeNull());
    await expect(within(block).getByTestId("transfer-action-accept-608")).toBeVisible();
    await expect(canvas.queryByTestId("at-transfer-detail")).toBeNull();
  },
};

// ── Who opened it ────────────────────────────────────────────────────────────────────────────────────────────────

// OPENED BY ROOT FROM OUTSIDE: the owner line names Fajar with the "by Root team" badge, whole, inside the block.
export const OpenedByRootFromOutside: Story = {
  name: "Opened by Root from outside",
  beforeEach: openedByRoot,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const created = await canvas.findByTestId("transfer-created-by-601");

    await waitFor(() => expect(created).toHaveTextContent("by Fajar Nugroho"));
    await theBadgeIsWhole(canvasElement, "601", "transfer-owner-601");
    await expect(within(canvas.getByTestId("transfers-table")).getAllByTestId("root-team-badge")).toHaveLength(1);
  },
};

// LONG NAMES ON THE NARROWEST PHONE — a long shop, a long person and a long other warehouse: the owner line wraps rather
// than cut the badge off, the other end wraps at full width, and nothing runs past the edge.
const LONG_OWNER = "Toko Melati Sejahtera Abadi Grosir Sembako Bandung";
const LONG_OTHER = "Gudang Cabang Surabaya Timur Rungkut Industri Blok C";
const LONG_PERSON = "Fajar Nugroho Wicaksono Adiputra Prasetyo";

function longNames() {
  const owner = teams.find((t) => t.id === 12n)!;
  const other = teams.find((t) => t.id === 14n)!;
  const was = [owner.name, other.name];
  owner.name = LONG_OWNER;
  other.name = LONG_OTHER;
  userNamedForStory(66n, LONG_PERSON);
  openedByRoot();

  return () => {
    owner.name = was[0]!;
    other.name = was[1]!;
  };
}

export const ALongNameAt320: Story = {
  name: "Long names at 320px",
  globals: { viewport: { value: "mobile1" } },
  beforeEach: longNames,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(window.innerWidth).toBe(320);
    await waitFor(() => expect(canvas.getByTestId("transfer-owner-601")).toHaveTextContent(LONG_OWNER));
    await waitFor(() => expect(canvas.getByTestId("transfer-created-by-601")).toHaveTextContent(LONG_PERSON));
    await waitFor(() => expect(canvas.getByTestId("transfer-other-601")).toHaveTextContent(LONG_OTHER));
    await theBadgeIsWhole(canvasElement, "601", "transfer-owner-601");
    await fitsTheScreen(canvasElement);
  },
};

export const At320: Story = {
  name: "At 320px",
  globals: { viewport: { value: "mobile1" } },
  play: async ({ canvasElement }) => {
    await loaded(canvasElement);
    await expect(window.innerWidth).toBe(320);
    await tabsDoNotOverlap(canvasElement);
    await fitsTheScreen(canvasElement);
  },
};

// ── Empty ────────────────────────────────────────────────────────────────────────────────────────────────────────

// AN EMPTY TAB says which status has none (an-empty-list-shows-a-hint); the pager stays on screen.
const AtEmptyTab = warehouseAt("/inventories/transfer?direction=incoming&status=cancelled");

export const AnEmptyTab: Story = {
  name: "Empty: a status with none",
  render: () => <AtEmptyTab />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const empty = await canvas.findByTestId("transfers-empty", {}, { timeout: 4000 });

    await expect(empty).toHaveTextContent("No cancelled transfers.");
    await expect(canvas.getByTestId("transfer-pager")).toBeVisible();
    await fitsTheScreen(canvasElement);
  },
};

// NOTHING MATCHES: Clear Filters takes the search back, from the URL too.
const AtNoMatch = warehouseAt("/inventories/transfer?q=zzz");

export const NothingMatches: Story = {
  name: "Empty: nothing matches",
  render: () => <AtNoMatch />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const empty = await canvas.findByTestId("transfers-empty", {}, { timeout: 4000 });

    await expect(empty).toHaveTextContent("No transfers match.");
    await fitsTheScreen(canvasElement);
    await userEvent.click(canvas.getByTestId("transfers-empty-clear"));
    await canvas.findByTestId("transfer-row-601", {}, { timeout: 4000 });
    await waitFor(() => expect(canvas.getByTestId("location-search")).not.toHaveTextContent("q="));
  },
};

// ── In Indonesian ────────────────────────────────────────────────────────────────────────────────────────────────

export const Indonesian: Story = {
  name: "In Indonesian",
  globals: { locale: "id", viewport: { value: "phone390" } },
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(canvas.getByRole("heading", { name: "Transfer Stok" })).toBeVisible();
    await waitFor(() => expect(canvas.getByTestId("transfer-other-601")).toHaveTextContent(/^Ke Gudang Cabang$/));
    await waitFor(() => expect(canvas.getByTestId("transfer-created-by-601")).toHaveTextContent("oleh Ani Rahayu"));
    await expect(canvas.getByTestId("transfer-tab-all")).toHaveTextContent("Semua Status");
    await tabsDoNotOverlap(canvasElement);
    await fitsTheScreen(canvasElement);
  },
};

export const IndonesianEmptyTab: Story = {
  name: "In Indonesian: a status with none",
  globals: { locale: "id", viewport: { value: "phone390" } },
  render: () => <AtEmptyTab />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const empty = await canvas.findByTestId("transfers-empty", {}, { timeout: 4000 });

    await expect(empty).toHaveTextContent(/^Tidak ada transfer \S+\.$/);
  },
};
