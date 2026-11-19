import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { daysAgo } from "../../../../.storybook/fixtures";
import { restockNoteByForStory, restockWarehouseNoteForStory, restockWire } from "../../../../.storybook/restockStub";
import { restockWriteScenario } from "../../../../.storybook/restockWriteScenario";
import { asAdminTeam } from "../../../../.storybook/sessionScenario";
import { RestockRequestStatus } from "../../../gen/warehouse/inventory/v1/restock_request_pb";
import { toaster } from "../../../components/feedback/Toaster";
import { aColleagueEditsALineOf501ForStory } from "../../../features/restock/storyTrail";
import { formatUnixDateTimeShort } from "../../../lib/datetime";
import { SELLING_META, loaded, menuOf } from "./kit";

// RESTOCK SELLING — Catatan from the row (the-list-opens-the-notes-in-a-dialog) — read with its own writer, edited, and
// kept in any status. The page's stories are grouped by the part of the screen they are about
// (stories-are-grouped-by-the-part-of-the-screen); what they share is ./kit.tsx.

const meta = {
  title: "Pages/Inventory/Restock/RestockSelling/Notes",
  ...SELLING_META,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

// CATATAN FROM THE ROW (owner: *"di listnya aku ingin ada modal menampilkan catatannya … di aksi, bisa edit juga"*,
// the-list-opens-the-notes-in-a-dialog) — both notes, one per writer, the warehouse's read; the selling team's edited
// in place while the restock is on its way, its count shown, and saved. The row does not open behind the dialog.
export const NotesOpenFromTheRowAndSave: Story = {
  name: "Open and save",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await menuOf(canvas, 501);
    await userEvent.click(screen.getByTestId("restock-action-notes-501"));
    const dialog = await screen.findByTestId("restock-notes-dialog");
    await waitFor(() => expect(dialog).toBeVisible());

    // READ FIRST, CHANGED ON PURPOSE (the-note-is-edited-from-a-button): the note as text, and Ubah beside its head.
    await expect(await within(dialog).findByTestId("restock-detail-note")).toHaveTextContent("Untuk promo 10.10");
    await expect(within(dialog).queryByTestId("restock-notes-input")).toBeNull();
    // The warehouse's note is read here, never written — none on 501 yet, and no ⚠ on it any more.
    const warehouse = within(dialog).getByTestId("restock-detail-note-warehouse");
    await expect(within(warehouse).getByTestId("restock-detail-note-warehouse-text")).toHaveTextContent("No note from the warehouse yet.");
    await expect(within(dialog).queryByTestId("not-implemented-warehouseNote")).toBeNull();
    await expect(within(warehouse).queryByTestId("restock-warehouse-note-edit")).toBeNull();

    // Ubah opens the edit IN the dialog — it does not close it (owner: *"ubah tidak close modalnya"*).
    await userEvent.click(within(dialog).getByTestId("restock-notes-edit"));
    const input = await within(dialog).findByTestId("restock-notes-input");
    await new Promise((r) => setTimeout(r, 300));
    await expect(screen.getByTestId("restock-notes-dialog")).toBeVisible();
    await expect(input).toHaveValue("Untuk promo 10.10");
    await expect(input).toHaveFocus();
    await expect(within(dialog).getByTestId("restock-notes-count")).toHaveTextContent("17/1000");
    // While it is typed, Batal / Simpan are the dialog's actions — no Tutup under them (a-phone-edits-the-note-in-a-sheet).
    await expect(within(dialog).queryByTestId("restock-notes-close")).toBeNull();

    // Unchanged, nothing to save.
    await expect(within(dialog).getByTestId("restock-notes-save")).toBeDisabled();
    await userEvent.clear(input);
    await userEvent.type(input, "Urgent", { delay: 30 });
    // A toast an earlier story left up would read as this save's — clear them first.
    toaster.remove();
    await waitFor(() => expect(screen.queryByText("Notes saved")).toBeNull());
    await userEvent.click(within(dialog).getByTestId("restock-notes-save"));

    await expect(await screen.findByText("Notes saved")).toBeInTheDocument();
    // SAVING DOES NOT CLOSE IT (owner: *"close saat save maksudku"*) — back to reading, the saved note in place, Ubah
    // offered again.
    await waitFor(() => expect(within(dialog).getByTestId("restock-detail-note")).toHaveTextContent("Urgent"));
    await expect(screen.getByTestId("restock-notes-dialog")).toBeVisible();
    await expect(within(dialog).queryByTestId("restock-notes-input")).toBeNull();
    await expect(within(dialog).getByTestId("restock-notes-edit")).toBeVisible();
    await expect(within(dialog).getByTestId("restock-notes-close")).toBeVisible();
    await expect(canvas.queryByTestId("at-restock-detail")).toBeNull();
  },
};

// MONITORING KEEPS WHAT ONLY READS (monitoring-keeps-what-only-reads) — the admin team reading this team: the row's ⋯ is
// Catatan alone (no Edit, Cancel or Mark Lost — the-admin-team-monitors-read-only), and the note is read with no Ubah.
export const MonitoringReadsTheNotes: Story = {
  name: "Monitoring, read only",
  beforeEach: () => asAdminTeam()(),
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(await menuOf(canvas, 501)).toEqual(["restock-action-notes-501"]);
    await userEvent.click(screen.getByTestId("restock-action-notes-501"));
    const dialog = await screen.findByTestId("restock-notes-dialog");
    await waitFor(() => expect(dialog).toBeVisible());

    await expect(await within(dialog).findByTestId("restock-detail-note")).toHaveTextContent("Untuk promo 10.10");
    await expect(within(dialog).queryByTestId("restock-notes-edit")).toBeNull();
  },
};

// …ON A PHONE (a-phone-edits-the-note-in-a-sheet) — the dialog is already its own surface, so the note is edited in it, not
// in a sheet stacked on top; Batal | Simpan take two equal halves of its width.
export const OnAPhoneTheDialogEditsInPlace: Story = {
  name: "Phone · edit in place",
  globals: { viewport: { value: "mobile1" } },
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await menuOf(canvas, 501);
    await userEvent.click(screen.getByTestId("restock-action-notes-501"));
    const dialog = await screen.findByTestId("restock-notes-dialog");
    await userEvent.click(await within(dialog).findByTestId("restock-notes-edit"));

    await expect(await within(dialog).findByTestId("restock-notes-input")).toHaveFocus();
    await expect(screen.queryByTestId("restock-notes-sheet")).toBeNull();
    const cancel = within(dialog).getByTestId("restock-notes-cancel-edit").getBoundingClientRect();
    const save = within(dialog).getByTestId("restock-notes-save").getBoundingClientRect();
    await expect(Math.abs(cancel.width - save.width)).toBeLessThan(2);
  },
};

// …ON ITS WAY THE NOTE IS SAVED ALONE TOO (the-note-is-edited-in-any-status, #71) — the dialog read 501, and while the note
// was being typed a colleague changed Beras 10 → 12 through the edit form. Simpan sends the note alone
// (RestockRequestNoteSet), never the restock the dialog read sent back whole (RestockRequestUpdate), so the colleague's
// line is kept; the dialog reads as it always did — the toast, the saved note, its writer, now.
export const OnItsWayTheNoteIsSavedAlone: Story = {
  name: "On its way · the note alone",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await menuOf(canvas, 501);
    await userEvent.click(screen.getByTestId("restock-action-notes-501"));
    const dialog = await screen.findByTestId("restock-notes-dialog");
    await expect(await within(dialog).findByTestId("restock-detail-note")).toHaveTextContent("Untuk promo 10.10");

    await userEvent.click(within(dialog).getByTestId("restock-notes-edit"));
    const input = await within(dialog).findByTestId("restock-notes-input");
    await userEvent.clear(input);
    await userEvent.type(input, "Urgent", { delay: 30 });

    // The colleague's edit lands while the dialog is open — what it holds is now the restock as it WAS.
    await aColleagueEditsALineOf501ForStory();
    const from = restockWriteScenario.writes.length;

    // A toast an earlier story left up would read as this save's — clear them first.
    toaster.remove();
    await waitFor(() => expect(screen.queryByText("Notes saved")).toBeNull());
    await userEvent.click(within(dialog).getByTestId("restock-notes-save"));

    await expect(await screen.findByText("Notes saved")).toBeInTheDocument();
    await waitFor(() => expect(within(dialog).getByTestId("restock-detail-note")).toHaveTextContent("Urgent"));

    // The note alone was sent — never the whole restock — and the colleague's line stands.
    await expect(restockWriteScenario.writes.slice(from)).toEqual([
      { rpc: "RestockRequestNoteSet", teamId: 12n, requestId: 501n, note: "Urgent" },
    ]);
    await expect(restockWire(501n).items.find((it) => it.productId === 74n)?.count).toBe(12n);
    await expect(restockWire(501n).status).toBe(RestockRequestStatus.ONGOING);

    const by = within(dialog).getByTestId("restock-detail-note-selling-by");
    await waitFor(() => expect(by).toHaveTextContent(`Ani Rahayu · ${formatUnixDateTimeShort(restockWire(501n).noteAtUnix)}`));
    await expect(by).toHaveAttribute("data-source", "note");
  },
};

// …the note is edited IN ANY STATUS, and KEPT (owner: *"catatan bisa diedit kapanpun"*, the-note-is-edited-in-any-status) —
// once the box has arrived the note alone is sent (RestockRequestNoteSet): saved, read back, no mark on Ubah, and its
// writer is whoever saved it, now (the-notes-are-one-per-writer).
export const AnArrivedRestocksNoteIsKept: Story = {
  name: "Arrived · kept",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await menuOf(canvas, 502);
    await userEvent.click(screen.getByTestId("restock-action-notes-502"));
    const dialog = await screen.findByTestId("restock-notes-dialog");
    const edit = await within(dialog).findByTestId("restock-notes-edit");
    await expect(within(dialog).queryByTestId("not-implemented-lateNote")).toBeNull();
    await expect(within(dialog).queryByTestId("not-implemented-sellingNoteBy")).toBeNull();

    await userEvent.click(edit);
    const input = await within(dialog).findByTestId("restock-notes-input");
    await userEvent.type(input, "Dicek ulang di gudang", { delay: 20 });
    // A toast an earlier story left up would read as this save's — clear them first.
    toaster.remove();
    await waitFor(() => expect(screen.queryByText("Notes saved")).toBeNull());
    await userEvent.click(within(dialog).getByTestId("restock-notes-save"));

    await expect(await screen.findByText("Notes saved")).toBeInTheDocument();
    await waitFor(() => expect(within(dialog).getByTestId("restock-detail-note")).toHaveTextContent("Dicek ulang di gudang"));
    // Still at the door — the note moved, nothing else did.
    await expect(restockWire(502n).status).toBe(RestockRequestStatus.ARRIVED);
    const by = within(dialog).getByTestId("restock-detail-note-selling-by");
    await waitFor(() => expect(by).toHaveTextContent(`Ani Rahayu · ${formatUnixDateTimeShort(restockWire(502n).noteAtUnix)}`));
    await expect(by).toHaveAttribute("data-source", "note");
  },
};

// THE NOTE NAMES ITS OWN WRITER (the-notes-are-one-per-writer) — Budi wrote 501's note yesterday, after Ani raised it: the
// dialog says Budi and when he wrote it, never the restock's raise; no ⚠ on who and when any more.
const BUDI_AT = daysAgo(1);

export const TheNoteNamesItsOwnWriter: Story = {
  name: "Its own writer",
  beforeEach: () => restockNoteByForStory(501n, 62n, BUDI_AT),
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await menuOf(canvas, 501);
    await userEvent.click(screen.getByTestId("restock-action-notes-501"));
    const dialog = await screen.findByTestId("restock-notes-dialog");

    const by = await within(dialog).findByTestId("restock-detail-note-selling-by");
    await waitFor(() => expect(by).toHaveTextContent(`Budi Santoso · ${formatUnixDateTimeShort(BUDI_AT)}`));
    await expect(by).toHaveAttribute("data-source", "note");
    await expect(within(dialog).queryByTestId("restock-detail-note-selling-by-fallback")).toBeNull();
    await expect(within(dialog).queryByTestId("not-implemented-sellingNoteBy")).toBeNull();
  },
};

// THE WAREHOUSE'S NOTE, FROM THE ROW (the-warehouse-writes-its-own-note) — the dialog reads what the receiving warehouse
// wrote, with who and when, beside the selling team's own; it is never written here.
export const TheDialogReadsTheWarehouseNote: Story = {
  name: "Warehouse's note, read",
  beforeEach: () => restockWarehouseNoteForStory(501n, "Kardus penyok di sudut, isi aman", 62n, BUDI_AT),
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await menuOf(canvas, 501);
    await userEvent.click(screen.getByTestId("restock-action-notes-501"));
    const dialog = await screen.findByTestId("restock-notes-dialog");
    const warehouse = await within(dialog).findByTestId("restock-detail-note-warehouse");

    await expect(within(warehouse).getByTestId("restock-detail-note-warehouse-text")).toHaveTextContent("Kardus penyok di sudut, isi aman");
    await waitFor(() =>
      expect(within(warehouse).getByTestId("restock-detail-note-warehouse-by")).toHaveTextContent(
        `Budi Santoso · ${formatUnixDateTimeShort(BUDI_AT)}`,
      ),
    );
    await expect(within(warehouse).queryByTestId("restock-warehouse-note-edit")).toBeNull();
  },
};
