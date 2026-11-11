import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { asAdminTeam } from "../../../../.storybook/sessionScenario";
import { SELLING_META, loaded, menuOf } from "./kit";

// RESTOCK SELLING — Catatan from the row (the-list-opens-the-notes-in-a-dialog) — read, edited, and a late one not kept. The page's stories are grouped by the part of the screen they are about
// (stories-are-grouped-by-the-part-of-the-screen); what they share is ./kit.tsx.

const meta = {
  title: "Pages/Inventory/Restock/RestockSelling/Notes",
  ...SELLING_META,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

// CATATAN FROM THE ROW (owner: *"di listnya aku ingin ada modal menampilkan catatannya … di aksi, bisa edit juga"*,
// the-list-opens-the-notes-in-a-dialog) — both notes, one per writer, the warehouse's marked; the selling team's edited
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
    await expect(within(within(dialog).getByTestId("restock-detail-note-warehouse")).getByTestId("not-implemented-warehouseNote")).toBeVisible();

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

// …the note is edited IN ANY STATUS (owner: *"catatan bisa diedit kapanpun"*, the-note-is-edited-in-any-status) — but once the
// box has arrived the server keeps the note closed: Ubah carries its ⚠, and a save says it was not kept.
export const AnArrivedRestocksNoteIsNotKeptYet: Story = {
  name: "Arrived · not kept",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await menuOf(canvas, 502);
    await userEvent.click(screen.getByTestId("restock-action-notes-502"));
    const dialog = await screen.findByTestId("restock-notes-dialog");
    const edit = await within(dialog).findByTestId("restock-notes-edit");
    await expect(within(dialog).getByTestId("not-implemented-lateNote")).toBeVisible();
    const before = within(dialog).getByTestId("restock-detail-note").textContent;

    await userEvent.click(edit);
    const input = await within(dialog).findByTestId("restock-notes-input");
    await userEvent.type(input, " — dicek ulang", { delay: 20 });
    await userEvent.click(within(dialog).getByTestId("restock-notes-save"));

    await expect(await screen.findByText(/^Not saved/)).toBeInTheDocument();
    await waitFor(() => expect(within(dialog).getByTestId("restock-detail-note").textContent).toBe(before));
  },
};
