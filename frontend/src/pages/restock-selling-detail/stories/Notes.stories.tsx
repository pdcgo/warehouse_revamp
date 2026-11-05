import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { At503, SELLING_DETAIL_META, loaded } from "./kit";

// RESTOCK SELLING DETAIL — Catatan — one note per writer, edited on the page, and on a phone in a sheet.
// The page's stories are grouped by the part of the screen they are about
// (stories-are-grouped-by-the-part-of-the-screen); what they share is ./kit.tsx.

const meta = {
  title: "Pages/Inventory/Restock/RestockSellingDetail/Notes",
  ...SELLING_DETAIL_META,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

// ONE NOTE PER WRITER (the-notes-are-one-per-writer) — the selling team's note, real, with who and when (⚠ derived: the
// restock's last raise or edit); the warehouse's, not stored yet (⚠ missing); and the system's voice is the Riwayat,
// whose edit rows should say what changed (⚠ missing). A record shows them too.
export const TheNotesAreOnePerWriter: Story = {
  name: "One per writer",
  render: () => <At503 />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(canvas.getByTestId("not-implemented-summary")).toBeVisible();
    const selling = canvas.getByTestId("restock-detail-note-selling");
    await waitFor(() => expect(within(selling).getByTestId("restock-detail-note-selling-by")).toHaveTextContent(/^Ani Rahayu · /));
    // The broken photo is the page's second mark (in Produk, above), so the notes' are third and fifth.
    await expect(within(selling).getByTestId("not-implemented-sellingNoteBy")).toHaveTextContent("3");

    const warehouse = canvas.getByTestId("restock-detail-note-warehouse");
    await expect(warehouse).toHaveTextContent("No note from the warehouse yet.");
    await expect(within(warehouse).getByTestId("not-implemented-warehouseNote")).toHaveTextContent("5");

    await expect(within(canvas.getByTestId("restock-detail-timeline-section")).getByTestId("not-implemented-trailChanges")).toHaveTextContent("6");
  },
};

// THE NOTE IS EDITED ON THE PAGE TOO (owner: *"edit di detailnya?"*, the-note-is-edited-from-a-button) — Ubah in the
// Catatan section, the edit in place, saved and read again; the same SellingNote as the list's dialog.
export const TheNoteIsEditedOnThePage: Story = {
  name: "Edit on the page",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const section = canvas.getByTestId("restock-detail-note-section");

    await expect(within(section).getByTestId("restock-detail-note")).toHaveTextContent("Untuk promo 10.10");
    await userEvent.click(within(section).getByTestId("restock-notes-edit"));
    const input = await within(section).findByTestId("restock-notes-input");
    await expect(input).toHaveFocus();
    await userEvent.clear(input);
    await userEvent.type(input, "Urgent", { delay: 30 });
    await userEvent.click(within(section).getByTestId("restock-notes-save"));

    await waitFor(() => expect(within(section).getByTestId("restock-detail-note")).toHaveTextContent("Urgent"));
    await expect(within(section).queryByTestId("restock-notes-input")).toBeNull();
  },
};

// ON A PHONE THE EDIT IS A SHEET (owner: *"edit catatan di mobile tidak bagus"*, a-phone-edits-the-note-in-a-sheet) — Ubah
// opens a bottom sheet with the textarea focused and Batal | Simpan as two equal halves; nothing is edited in the page.
// Simpan shuts it, and the page reads the saved note.
export const OnAPhoneTheNoteIsEditedInASheet: Story = {
  name: "Phone · edit in a sheet",
  globals: { viewport: { value: "mobile1" } },
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const section = canvas.getByTestId("restock-detail-note-section");

    await userEvent.click(within(section).getByTestId("restock-notes-edit"));
    const sheet = await screen.findByTestId("restock-notes-sheet");
    await waitFor(() => expect(sheet).toBeVisible());
    await expect(within(section).queryByTestId("restock-notes-input")).toBeNull();

    const input = within(sheet).getByTestId("restock-notes-input");
    await waitFor(() => expect(input).toHaveFocus());

    // Two equal halves, together the sheet's width.
    const cancel = within(sheet).getByTestId("restock-notes-cancel-edit").getBoundingClientRect();
    const save = within(sheet).getByTestId("restock-notes-save").getBoundingClientRect();
    await expect(Math.abs(cancel.width - save.width)).toBeLessThan(2);
    await expect(cancel.width + save.width).toBeGreaterThan(sheet.getBoundingClientRect().width * 0.8);

    await userEvent.clear(input);
    await userEvent.type(input, "Urgent", { delay: 30 });
    await userEvent.click(within(sheet).getByTestId("restock-notes-save"));

    await waitFor(() => expect(screen.queryByTestId("restock-notes-sheet")).toBeNull());
    await waitFor(() => expect(within(section).getByTestId("restock-detail-note")).toHaveTextContent("Urgent"));
  },
};

// …and Batal shuts the sheet with the note as it was.
export const OnAPhoneBatalLeavesTheNote: Story = {
  name: "Phone · Batal keeps it",
  globals: { viewport: { value: "mobile1" } },
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const section = canvas.getByTestId("restock-detail-note-section");

    await userEvent.click(within(section).getByTestId("restock-notes-edit"));
    const sheet = await screen.findByTestId("restock-notes-sheet");
    await waitFor(() => expect(sheet).toBeVisible());
    await userEvent.type(within(sheet).getByTestId("restock-notes-input"), " lagi", { delay: 30 });
    await userEvent.click(within(sheet).getByTestId("restock-notes-cancel-edit"));

    await waitFor(() => expect(screen.queryByTestId("restock-notes-sheet")).toBeNull());
    await expect(within(section).getByTestId("restock-detail-note")).toHaveTextContent("Untuk promo 10.10");
  },
};

// …and a restock past its way still offers Ubah (the-note-is-edited-in-any-status) — marked, since the server does not
// keep the note once the box has arrived.
export const ARecordsNoteHasAMarkedUbah: Story = {
  name: "Accepted · Ubah, marked",
  render: () => <At503 />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const section = canvas.getByTestId("restock-detail-note-section");

    await expect(within(section).getByTestId("restock-notes-edit")).toBeVisible();
    await expect(within(section).getByTestId("not-implemented-lateNote")).toHaveTextContent("4");
  },
};
