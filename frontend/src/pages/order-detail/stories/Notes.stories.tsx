import { create } from "@bufbuild/protobuf";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";

import { asTeam } from "../../../../.storybook/pageStory";
import { users } from "../../../../.storybook/fixtures";
import { OrderTimelineLogSchema } from "../../../gen/warehouse/selling/v1/order_pb";
import { NotesSection, noteWriter } from "../components/NotesSection";
import { AtCancelled, FULL, ORDER_DETAIL_META, SELLER, WAREHOUSE } from "./kit";

// ONE ORDER — Catatan — the notes, newest first, and Add Note.
// The page's stories are grouped by the part of the screen they are about
// (stories-are-grouped-by-the-part-of-the-screen); what they share is ./kit.tsx.

const meta = {
  title: "Pages/Order/OrderDetailPage/Notes",
  ...ORDER_DETAIL_META,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

// ── Catatan — a note is a timeline row with no status (a-note-is-a-timeline-row) ─────────────────────

// 101's two NOTE rows (a-note-is-a-timeline-row) — status 0, one per side. The warehouse's is the later one.
const FULL_NOTES = FULL.timelineLogs.filter((log) => log.status === 0);
const SELLER_NOTE = FULL_NOTES.find((log) => log.from === 2)!;
const WAREHOUSE_NOTE = FULL_NOTES.find((log) => log.from === 1)!;
const ANI = users.find((u) => u.id === 61n)!;
const BUDI = users.find((u) => u.id === 62n)!;

/**
 * THE NOTE ROWS, NEWEST FIRST, EACH WITH ITS SIDE AND ITS WRITER. 101 has one per side: the seller's, typed on the
 * create form, and the warehouse's, written later — so the warehouse's leads. The writers come from the page's one
 * actor lookup, the same one the timeline reads.
 */
export const NotesAreListedNewestFirst: Story = {
  name: "Newest first",
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const section = await canvas.findByTestId("section-notes");
    const notes = await within(section).findAllByTestId("order-note");

    await expect(notes).toHaveLength(2);

    await expect(notes[0]).toHaveAttribute("data-from", "warehouse");
    await expect(within(notes[0]!).getByTestId("order-note-text")).toHaveTextContent(WAREHOUSE_NOTE.note!);
    await expect(within(notes[0]!).getByTestId("order-note-meta")).toHaveTextContent("Warehouse");

    await expect(notes[1]).toHaveAttribute("data-from", "selling");
    await expect(within(notes[1]!).getByTestId("order-note-text")).toHaveTextContent(SELLER_NOTE.note!);
    await expect(within(notes[1]!).getByTestId("order-note-meta")).toHaveTextContent("Seller");

    await waitFor(() => expect(within(notes[0]!).getByTestId("order-note-by")).toHaveTextContent(BUDI.name));
    await expect(within(notes[1]!).getByTestId("order-note-by")).toHaveTextContent(ANI.name);
  },
};

/**
 * ADD NOTE WRITES ONE, and the re-read shows it on top. The page invalidates rather than splicing the row in, so the
 * note appearing is the server's answer coming back — from `selling`, because the seller writes with its own team.
 */
export const AddNoteWritesANote: Story = {
  name: "Add a note",
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const section = await canvas.findByTestId("section-notes");
    await within(section).findAllByTestId("order-note");

    const input = within(section).getByRole("textbox", { name: "New note" });
    await userEvent.type(input, "Kirim sebelum jam 3 sore.", { delay: 40 });
    // The limit is counted as it is typed.
    await expect(within(section).getByTestId("notes-count")).toHaveTextContent("25 / 500");

    await userEvent.click(within(section).getByRole("button", { name: "Add Note" }));

    await waitFor(async () => {
      const notes = within(section).getAllByTestId("order-note");
      await expect(notes).toHaveLength(3);
      await expect(notes[0]).toHaveTextContent("Kirim sebelum jam 3 sore.");
    });

    const written = within(section).getAllByTestId("order-note")[0]!;
    await expect(written).toHaveAttribute("data-from", "selling");
    await waitFor(() => expect(within(written).getByTestId("order-note-by")).toHaveTextContent(ANI.name));
    await waitFor(() => expect(input).toHaveValue(""));
  },
};

/** NOTHING IS NOT A NOTE — and neither is a line of spaces: the server trims, and so does the button. */
export const AddNoteIsDisabledWhileEmpty: Story = {
  name: "Empty is not a note",
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const section = await canvas.findByTestId("section-notes");
    const add = within(section).getByRole("button", { name: "Add Note" });

    await expect(add).toBeDisabled();

    const input = within(section).getByRole("textbox", { name: "New note" });
    await userEvent.type(input, "   ", { delay: 40 });
    await expect(add).toBeDisabled();

    await userEvent.type(input, "ok", { delay: 40 });
    await expect(add).toBeEnabled();
  },
};

/**
 * A VIEWER WHO IS NEITHER END WRITES NO NOTE — Root and Administrator read every team's orders, but a note always comes
 * from the order's selling team or its warehouse, and the server refuses anybody else. So the box is not drawn at all,
 * rather than offered and refused; the notes themselves are still read.
 */
export const ANeitherEndViewerGetsNoAddNote: Story = {
  name: "Neither end, no box",
  render: () => (
    <NotesSection
      teamId={noteWriter(1n, FULL)}
      orderId={FULL.id}
      logs={FULL.timelineLogs.map((log) => create(OrderTimelineLogSchema, log))}
    />
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(noteWriter(SELLER.id, FULL)).toBe(SELLER.id);
    await expect(noteWriter(WAREHOUSE.id, FULL)).toBe(WAREHOUSE.id);
    await expect(canvas.queryByTestId("notes-composer")).not.toBeInTheDocument();
    await expect(canvas.getAllByTestId("order-note")).toHaveLength(2);
  },
};

/**
 * A NOTE IS NEVER EDITED AND NEVER DELETED — a correction is a new note. The only control in Catatan is Add Note: no
 * pencil and no bin on any row, absent rather than greyed.
 */
export const ANoteIsNeverEditedOrDeleted: Story = {
  name: "Never edited",
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const section = await canvas.findByTestId("section-notes");
    await within(section).findAllByTestId("order-note");

    const buttons = within(section).getAllByRole("button");
    await expect(buttons).toHaveLength(1);
    await expect(buttons[0]).toHaveAccessibleName("Add Note");
    await expect(within(section).queryByRole("button", { name: /edit|delete|remove/i })).toBeNull();
  },
};

/** AN ORDER WITH NO NOTES SAYS SO — a sentence, never a blank card. 107 has none. */
export const NoNotesSaysSo: Story = {
  name: "No notes",
  render: () => <AtCancelled />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const section = await canvas.findByTestId("section-notes");

    await expect(within(section).getByTestId("notes-empty")).toHaveTextContent("No notes on this order yet.");
    await expect(within(section).queryByTestId("notes-list")).not.toBeInTheDocument();
  },
};

/**
 * THE WAREHOUSE READS THE NOTES AND WRITES ONE — on its Info tab, where the order's one note card used to be. It
 * writes with ITS team id, so the server records the note as the warehouse's.
 */
export const WarehouseDetailShowsTheNotesAndAddsOne: Story = {
  name: "Warehouse · reads and adds",
  beforeEach: asTeam(WAREHOUSE.id),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const card = await canvas.findByTestId("order-detail-notes");
    const notes = await within(card).findAllByTestId("order-note");

    await expect(notes).toHaveLength(2);
    await expect(notes[0]).toHaveTextContent(WAREHOUSE_NOTE.note!);
    await expect(notes[1]).toHaveTextContent(SELLER_NOTE.note!);
    // The single `order.note` card is gone.
    await expect(canvas.queryByTestId("order-detail-note")).not.toBeInTheDocument();

    const input = within(card).getByRole("textbox", { name: "New note" });
    await userEvent.type(input, "Paket siap jam 2 siang.", { delay: 40 });
    await userEvent.click(within(card).getByRole("button", { name: "Add Note" }));

    await waitFor(async () => {
      const after = within(card).getAllByTestId("order-note");
      await expect(after).toHaveLength(3);
      await expect(after[0]).toHaveTextContent("Paket siap jam 2 siang.");
      await expect(after[0]).toHaveAttribute("data-from", "warehouse");
    });
  },
};
