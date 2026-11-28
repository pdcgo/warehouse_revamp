import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { daysAgo } from "../../../../.storybook/fixtures";
import { restockNoteByForStory, restockWarehouseNoteForStory, restockWire } from "../../../../.storybook/restockStub";
import { restockWriteScenario } from "../../../../.storybook/restockWriteScenario";
import { RestockRequestStatus } from "../../../gen/warehouse/inventory/v1/restock_request_pb";
import { toaster } from "../../../components/feedback/Toaster";
import { aColleagueEditsALineOf501ForStory } from "../../../features/restock/storyTrail";
import { formatUnixDateTimeShort } from "../../../lib/datetime";
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

// ONE NOTE PER WRITER (the-notes-are-one-per-writer) — the selling team's note with who and when; the warehouse's, read
// here and never written (none on 503 yet, and no ⚠ on it any more); and the system's voice is the Riwayat, whose edit
// rows say what changed (edits-are-in-the-same-trail). 503's note was written before its own writer was kept: the restock's last raise or edit
// stands in, as it always did, and SAYS so — never named as the note's writer, and no ⚠ on it any more.
export const TheNotesAreOnePerWriter: Story = {
  name: "One per writer",
  render: () => <At503 />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(canvas.getByTestId("not-implemented-summary")).toBeVisible();
    const selling = canvas.getByTestId("restock-detail-note-selling");
    const by = within(selling).getByTestId("restock-detail-note-selling-by");
    await waitFor(() => expect(by).toHaveTextContent(/^Ani Rahayu · /));
    await expect(by).toHaveAttribute("data-source", "restock");
    await expect(within(selling).getByTestId("restock-detail-note-selling-by-fallback")).toHaveTextContent(
      "the restock's last change — the note's own writer was not recorded",
    );
    await expect(within(selling).queryByTestId("not-implemented-sellingNoteBy")).toBeNull();

    // The warehouse's note is kept now (the-warehouse-writes-its-own-note): none written on 503, said so, no mark, and no
    // Ubah — it is the warehouse's to write.
    const warehouse = canvas.getByTestId("restock-detail-note-warehouse");
    await expect(within(warehouse).getByTestId("restock-detail-note-warehouse-text")).toHaveTextContent("No note from the warehouse yet.");
    await expect(canvas.queryByTestId("not-implemented-warehouseNote")).toBeNull();
    await expect(within(warehouse).queryByTestId("restock-warehouse-note-edit")).toBeNull();
    await expect(within(warehouse).queryByTestId("restock-detail-note-warehouse-by")).toBeNull();

    // The Riwayat carries no mark: an edit's row says what changed now.
    await expect(within(canvas.getByTestId("restock-detail-timeline-section")).queryByTestId("not-implemented-trailChanges")).toBeNull();
  },
};

// THE NOTE NAMES ITS OWN WRITER (the-notes-are-one-per-writer) — Budi wrote 501's note yesterday, after Ani raised it:
// the page says Budi and when he wrote it, never the restock's raise or its last edit.
const BUDI_AT = daysAgo(1);

export const TheNoteNamesItsOwnWriter: Story = {
  name: "Its own writer",
  beforeEach: () => restockNoteByForStory(501n, 62n, BUDI_AT),
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const selling = canvas.getByTestId("restock-detail-note-selling");

    const by = within(selling).getByTestId("restock-detail-note-selling-by");
    await waitFor(() => expect(by).toHaveTextContent(`Budi Santoso · ${formatUnixDateTimeShort(BUDI_AT)}`));
    await expect(by).toHaveAttribute("data-source", "note");
    await expect(within(selling).queryByTestId("restock-detail-note-selling-by-fallback")).toBeNull();
    await expect(within(selling).queryByTestId("root-team-badge")).toBeNull();
  },
};

// THE WAREHOUSE'S NOTE, READ WITH ITS OWN WRITER (the-warehouse-writes-its-own-note, the-notes-are-one-per-writer) — Budi,
// at the receiving warehouse, wrote it yesterday: the selling team reads the words, Budi and when, and has no Ubah on it.
export const TheWarehouseNoteIsReadWithItsWriter: Story = {
  name: "Warehouse's note, read",
  beforeEach: () => restockWarehouseNoteForStory(501n, "Kardus penyok di sudut, isi aman", 62n, BUDI_AT),
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const warehouse = within(canvas.getByTestId("restock-detail-note-section")).getByTestId("restock-detail-note-warehouse");

    await expect(within(warehouse).getByTestId("restock-detail-note-warehouse-text")).toHaveTextContent("Kardus penyok di sudut, isi aman");
    await waitFor(() =>
      expect(within(warehouse).getByTestId("restock-detail-note-warehouse-by")).toHaveTextContent(
        `Budi Santoso · ${formatUnixDateTimeShort(BUDI_AT)}`,
      ),
    );
    await expect(within(warehouse).queryByTestId("restock-warehouse-note-edit")).toBeNull();
    await expect(within(warehouse).queryByTestId("root-team-badge")).toBeNull();
  },
};

// …and Root or the System Administrator writing it from outside the warehouse is said (an-override-shows-a-platform-badge).
export const AWarehouseNoteByRootIsBadged: Story = {
  name: "Warehouse's note · Root team",
  beforeEach: () => restockWarehouseNoteForStory(501n, "Dicek oleh tim pusat", 62n, BUDI_AT, true),
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const warehouse = canvas.getByTestId("restock-detail-note-warehouse");

    await waitFor(() => expect(within(warehouse).getByTestId("restock-detail-note-warehouse-by")).toHaveTextContent(/^Budi Santoso · /));
    await expect(within(warehouse).getByTestId("root-team-badge")).toBeVisible();
  },
};

// …and Root or the System Administrator writing it from outside the team is said, as on every by-line naming a person
// (an-override-shows-a-platform-badge).
export const ANoteByRootFromOutsideIsBadged: Story = {
  name: "Its own writer · Root team",
  beforeEach: () => restockNoteByForStory(501n, 62n, BUDI_AT, true),
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const selling = canvas.getByTestId("restock-detail-note-selling");

    await waitFor(() => expect(within(selling).getByTestId("restock-detail-note-selling-by")).toHaveTextContent(/^Budi Santoso · /));
    await expect(within(selling).getByTestId("root-team-badge")).toBeVisible();
  },
};

// THE NOTE IS EDITED ON THE PAGE TOO (owner: *"edit di detailnya?"*, the-note-is-edited-from-a-button) — Ubah in the
// Catatan section, the edit in place, saved and read again; the same SellingNote as the list's dialog. Its writer is
// whoever saved it, now.
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
    await waitFor(() =>
      expect(within(section).getByTestId("restock-detail-note-selling-by")).toHaveTextContent(
        `Ani Rahayu · ${formatUnixDateTimeShort(restockWire(501n).noteAtUnix)}`,
      ),
    );
  },
};

// …AND ON ITS WAY THE NOTE IS SAVED ALONE (the-note-is-edited-in-any-status, #71) — the page read 501, and while the note
// was being typed a colleague changed Beras 10 → 12 through the edit form. Simpan sends the note alone
// (RestockRequestNoteSet), never the page's copy of the restock sent back whole (RestockRequestUpdate): the colleague's
// line is kept, and the Riwayat gains the note's row — the note before and after, nothing else — under the colleague's own.
export const OnItsWayTheNoteIsSavedAlone: Story = {
  name: "On its way · the note alone",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const section = canvas.getByTestId("restock-detail-note-section");

    await expect(within(section).getByTestId("restock-detail-note")).toHaveTextContent("Untuk promo 10.10");
    await userEvent.click(within(section).getByTestId("restock-notes-edit"));
    const input = await within(section).findByTestId("restock-notes-input");
    await userEvent.clear(input);
    await userEvent.type(input, "Urgent", { delay: 30 });

    // The colleague's edit lands while the note is open — the page still holds the restock as it WAS.
    await aColleagueEditsALineOf501ForStory();
    const from = restockWriteScenario.writes.length;

    // A toast an earlier story left up would read as this save's — clear them first.
    toaster.remove();
    await waitFor(() => expect(screen.queryByText("Notes saved")).toBeNull());
    await userEvent.click(within(section).getByTestId("restock-notes-save"));

    await expect(await screen.findByText("Notes saved")).toBeInTheDocument();
    await waitFor(() => expect(within(section).getByTestId("restock-detail-note")).toHaveTextContent("Urgent"));

    // The note alone was sent — never the whole restock — and the colleague's line stands.
    await expect(restockWriteScenario.writes.slice(from)).toEqual([
      { rpc: "RestockRequestNoteSet", teamId: 12n, requestId: 501n, note: "Urgent" },
    ]);
    await expect(restockWire(501n).items.find((it) => it.productId === 74n)?.count).toBe(12n);
    await waitFor(() =>
      expect(within(section).getByTestId("restock-detail-note-selling-by")).toHaveTextContent(
        `Ani Rahayu · ${formatUnixDateTimeShort(restockWire(501n).noteAtUnix)}`,
      ),
    );

    // The Riwayat: the colleague's row says the line; the save's says the note, before and after, and no line.
    const timeline = canvas.getByTestId("restock-detail-timeline-section");
    await expect(await within(timeline).findByTestId("restock-timeline-3-change-note")).toHaveTextContent(
      "Note “Untuk promo 10.10” → “Urgent”",
    );
    await expect(within(timeline).queryByTestId("restock-timeline-3-change-line-74")).toBeNull();
    await expect(within(timeline).getByTestId("restock-timeline-2-change-line-74")).toBeVisible();
    await expect(within(timeline).queryByTestId("restock-timeline-2-change-note")).toBeNull();
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

// …and a restock past its way still offers Ubah, and KEEPS the edit (the-note-is-edited-in-any-status) — an accepted one
// here, whose note was written before its writer was kept: once saved it names its writer, now, the stand-in and its words
// are gone, the restock is still accepted, and the Riwayat gains the edit's row with the note before and after
// (edits-are-in-the-same-trail).
export const ARecordsNoteIsEditedAndKept: Story = {
  name: "Accepted · edited, kept",
  render: () => <At503 />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const section = canvas.getByTestId("restock-detail-note-section");

    await expect(within(section).queryByTestId("not-implemented-lateNote")).toBeNull();
    await waitFor(() => expect(within(section).getByTestId("restock-detail-note-selling-by-fallback")).toBeVisible(), { timeout: 5000 });

    await userEvent.click(within(section).getByTestId("restock-notes-edit"));
    const input = await within(section).findByTestId("restock-notes-input");
    await userEvent.type(input, " — November", { delay: 20 });
    // A toast an earlier story left up would read as this save's — clear them first.
    toaster.remove();
    await waitFor(() => expect(screen.queryByText("Notes saved")).toBeNull());
    await userEvent.click(within(section).getByTestId("restock-notes-save"));

    await expect(await screen.findByText("Notes saved")).toBeInTheDocument();
    await waitFor(() => expect(within(section).getByTestId("restock-detail-note")).toHaveTextContent("Stok bulanan — November"));
    const by = within(section).getByTestId("restock-detail-note-selling-by");
    await waitFor(() => expect(by).toHaveAttribute("data-source", "note"));
    await expect(by).toHaveTextContent(`Ani Rahayu · ${formatUnixDateTimeShort(restockWire(503n).noteAtUnix)}`);
    await expect(within(section).queryByTestId("restock-detail-note-selling-by-fallback")).toBeNull();
    await expect(restockWire(503n).status).toBe(RestockRequestStatus.ACCEPTED);

    const timeline = canvas.getByTestId("restock-detail-timeline-section");
    await expect(await within(timeline).findByTestId("restock-timeline-4-change-note")).toHaveTextContent(
      "Note “Stok bulanan” → “Stok bulanan — November”",
    );
  },
};
