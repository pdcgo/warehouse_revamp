import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { daysAgo } from "../../../../.storybook/fixtures";
import { restockNoteByForStory, restockWarehouseNoteForStory, restockWire } from "../../../../.storybook/restockStub";
import { RestockRequestStatus } from "../../../gen/warehouse/inventory/v1/restock_request_pb";
import { toaster } from "../../../components/feedback/Toaster";
import { formatUnixDateTimeShort } from "../../../lib/datetime";
import { At503, WAREHOUSE_DETAIL_META, loaded } from "./kit";

// RESTOCK WAREHOUSE DETAIL — the notes, one per writer: the selling team's read, this warehouse's written here.
// The page's stories are grouped by the part of the screen they are about
// (stories-are-grouped-by-the-part-of-the-screen); what they share is ./kit.tsx.

const meta = {
  title: "Pages/Inventory/Restock/RestockWarehouseDetail/Notes",
  ...WAREHOUSE_DETAIL_META,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

// THE WAREHOUSE WRITES ITS OWN NOTE (owner: *"bisa mengubah catatan warehouse"*, the-warehouse-writes-its-own-note) — its
// Ubah opens the edit, as the selling note's does; the selling team's note above it has none. It is KEPT: saved, read
// back with who wrote it and when (the-notes-are-one-per-writer), no ⚠ on it any more, and the Riwayat gains the edit's
// row with the warehouse note before and after (edits-are-in-the-same-trail).
export const TheWarehouseWritesItsOwnNote: Story = {
  name: "Warehouse's note, written and kept",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const section = canvas.getByTestId("restock-detail-note-section");
    const own = within(section).getByTestId("restock-detail-note-warehouse");

    await expect(within(section).queryByTestId("restock-notes-edit")).toBeNull();
    await expect(canvas.queryByTestId("not-implemented-warehouseNoteKept")).toBeNull();
    await expect(within(own).getByTestId("restock-detail-note-warehouse-text")).toHaveTextContent("No note from the warehouse yet.");
    // Nothing written yet, so nobody is named.
    await expect(within(own).queryByTestId("restock-detail-note-warehouse-by")).toBeNull();

    await userEvent.click(within(own).getByTestId("restock-warehouse-note-edit"));
    const input = await within(own).findByTestId("restock-warehouse-note-input");
    await expect(input).toHaveFocus();
    await userEvent.type(input, "Dus penyok di sudut", { delay: 20 });
    // A toast an earlier story left up would read as this save's — clear them first.
    toaster.remove();
    await waitFor(() => expect(screen.queryByText("Notes saved")).toBeNull());
    await userEvent.click(within(own).getByTestId("restock-warehouse-note-save"));

    await expect(await screen.findByText("Notes saved")).toBeInTheDocument();
    await waitFor(() => expect(within(own).queryByTestId("restock-warehouse-note-input")).toBeNull());
    await waitFor(() => expect(within(own).getByTestId("restock-detail-note-warehouse-text")).toHaveTextContent("Dus penyok di sudut"));
    await expect(restockWire(501n).warehouseNote).toBe("Dus penyok di sudut");
    await waitFor(() =>
      expect(within(own).getByTestId("restock-detail-note-warehouse-by")).toHaveTextContent(
        `Ani Rahayu · ${formatUnixDateTimeShort(restockWire(501n).warehouseNoteAtUnix ?? 0n)}`,
      ),
    );
    // The selling team's note is its own — untouched.
    await expect(within(section).getByTestId("restock-detail-note")).toHaveTextContent("Untuk promo 10.10");

    const timeline = canvas.getByTestId("restock-detail-timeline-section");
    const [change] = await within(timeline).findAllByTestId(/^restock-timeline-\d+-change-warehouse_note$/);
    await expect(change).toHaveTextContent("Warehouse note “Dus penyok di sudut”");
  },
};

// THE STORED NOTE IS READ BACK (the-notes-are-one-per-writer) — Budi wrote this warehouse's note yesterday: the block reads
// it with Budi and when, and Ubah opens on it.
export const TheStoredWarehouseNoteIsRead: Story = {
  name: "Warehouse's note, stored",
  beforeEach: () => restockWarehouseNoteForStory(501n, "Kardus penyok di sudut, isi aman", 62n, daysAgo(1)),
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const own = within(canvas.getByTestId("restock-detail-note-section")).getByTestId("restock-detail-note-warehouse");

    await expect(within(own).getByTestId("restock-detail-note-warehouse-text")).toHaveTextContent("Kardus penyok di sudut, isi aman");
    await waitFor(() =>
      expect(within(own).getByTestId("restock-detail-note-warehouse-by")).toHaveTextContent(
        `Budi Santoso · ${formatUnixDateTimeShort(daysAgo(1))}`,
      ),
    );
    await expect(within(own).queryByTestId("root-team-badge")).toBeNull();

    await userEvent.click(within(own).getByTestId("restock-warehouse-note-edit"));
    await expect(await within(own).findByTestId("restock-warehouse-note-input")).toHaveValue("Kardus penyok di sudut, isi aman");
  },
};

// …IN ANY STATUS: when the warehouse may write it is not decided, so an accepted restock still offers Ubah and keeps the
// note. 503's selling note was written before its writer was kept, so its head falls back to the restock's last raise
// or edit — and the warehouse's own write is NEVER that stand-in: the selling head reads exactly as before.
export const AnAcceptedRestocksWarehouseNoteIsKept: Story = {
  name: "Accepted · warehouse's note kept",
  render: () => <At503 />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const section = canvas.getByTestId("restock-detail-note-section");
    const own = within(section).getByTestId("restock-detail-note-warehouse");
    const sellingBy = await within(section).findByTestId("restock-detail-note-selling-by");
    await waitFor(() => expect(sellingBy).toHaveTextContent(/^Ani Rahayu · /));
    const sellingBefore = sellingBy.textContent;

    await userEvent.click(within(own).getByTestId("restock-warehouse-note-edit"));
    await userEvent.type(await within(own).findByTestId("restock-warehouse-note-input"), "Rusak 2, sudah difoto", { delay: 20 });
    await userEvent.click(within(own).getByTestId("restock-warehouse-note-save"));

    await waitFor(() => expect(within(own).getByTestId("restock-detail-note-warehouse-text")).toHaveTextContent("Rusak 2, sudah difoto"));
    await expect(restockWire(503n).status).toBe(RestockRequestStatus.ACCEPTED);
    await expect(within(section).getByTestId("restock-detail-note-selling-by-fallback")).toBeVisible();
    await expect(within(section).getByTestId("restock-detail-note-selling-by")).toHaveTextContent(sellingBefore ?? "");
  },
};

// THE SELLING TEAM'S NOTE, READ HERE WITH ITS OWN WRITER (the-notes-are-one-per-writer) — Budi wrote it yesterday, after
// Ani raised the restock: the warehouse reads Budi and when, no ⚠, and no Ubah on a note that is not its own.
const BUDI_AT = daysAgo(1);

export const TheSellingNoteNamesItsOwnWriter: Story = {
  name: "Selling team's note, its own writer",
  beforeEach: () => restockNoteByForStory(501n, 62n, BUDI_AT),
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const selling = canvas.getByTestId("restock-detail-note-selling");

    const by = within(selling).getByTestId("restock-detail-note-selling-by");
    await waitFor(() => expect(by).toHaveTextContent(`Budi Santoso · ${formatUnixDateTimeShort(BUDI_AT)}`));
    await expect(by).toHaveAttribute("data-source", "note");
    await expect(within(selling).queryByTestId("not-implemented-sellingNoteBy")).toBeNull();
    await expect(within(selling).queryByTestId("restock-notes-edit")).toBeNull();
  },
};
