import { create } from "@bufbuild/protobuf";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { asTeam, marker, routedPage } from "../../../.storybook/pageStory";
import { receiptUpdateScenario } from "../../../.storybook/sessionScenario";
import { orderDetailFor, orders, products, teams, users } from "../../../.storybook/fixtures";
import { OrderTimelineLogSchema } from "../../gen/warehouse/selling/v1/order_pb";
import { NotesSection, noteWriter } from "./components/NotesSection";
import { OrderDetailPage } from "./index";
import { ORDER_DETAIL_PENDING } from "./pending";

// ONE ORDER, READ SECTION BY SECTION — the detail route behind every row of the order list.
//
// ⚠ THE DETAIL READ IS A DIFFERENT MESSAGE FROM A LIST ROW. `OrderDetail` is the only RPC that
// populates `items` and `events` (order.proto), and those two tables ARE the page's two tabs. So
// this screen cannot be reviewed from the list's fixtures — it needs the detail stub, which is why
// `orderDetailFor` exists beside `orders` rather than inside it.
//
// THE PAGE IS READ FROM BOTH ENDS, exactly as the list is (#151): `team_id` is the team you hold a
// role in, and the server matches it against the order's SELLING team or its WAREHOUSE. A picking
// crew opens orders it did not place, every day. `WarehouseReadsAnotherTeamsOrder` pins that, and it
// is the assertion that would fail if the scope were ever tightened to an owner check.
//
// What the stories below are for:
//
//   | story                             | the rule it pins                                        |
//   | --------------------------------- | ------------------------------------------------------- |
//   | Default                           | header, tabs, lines, money — the whole Info tab          |
//   | PlatformTotalDiffersFromOurs      | two totals, two facts — settlement's whole premise       |
//   | Timeline                          | the history tab, with the people resolved                |
//   | UnrecordedActor                   | actor 0 shows the STEP and stays silent about who        |
//   | CancelledOrderHasNoCancelButton   | a terminal order cannot be cancelled again               |
//   | WarehouseReadsAnotherTeamsOrder   | the two-sided scope                                      |
//   | TheBuyersUsernameShowsUnder…      | the username under the customer, and nothing without one |
//   | ABorrowedLineIsPricedWithItsMarkup | harga beli is the price with the owner's markup         |
//   | ALineShowsItsProductPicture       | picture, name, SKU — the picture from ONE ProductByIds    |
//   | ALineWithNoPictureKeepsThe…       | no picture to find: the line in full, with the placeholder |
//   | NotFound                          | an id this team may not read                             |
//   | NotesAreListedNewestFirst         | Catatan: the note rows, newest first, side and writer     |
//   | AddNoteWritesANote                | a note is written, and the re-read shows it on top       |
//   | AddNoteIsDisabledWhileEmpty       | nothing — or only spaces — is not a note                 |
//   | ANoteIsNeverEditedOrDeleted       | Add Note is Catatan's only control                       |
//   | NoNotesSaysSo                     | an order with no notes says so, never a blank card       |
//   | TheTimelineKeepsStatusRowsOnly    | a note is not a step; a hand-back's reason stays on it    |
//   | WarehouseDetailShowsTheNotes…     | the warehouse reads the notes and writes as the warehouse |
//   | WarehouseTimelineKeepsStatus…     | the warehouse's Timeline tab drops the notes too          |

const SELLER = teams[1]!; // Toko Melati (12)
const WAREHOUSE = teams[0]!; // Gudang Pusat (11)

// 101 is the order written out in full — three lines, an address, a note, a receipt, and a
// marketplace total that DISAGREES with ours.
const FULL = orderDetailFor(101n)!;
// 107 is the only CANCELLED one, and it is Melati's.
const CANCELLED = orders.find((o) => o.id === 107n)!;
// 110 belongs to Toko Kenanga but ships from Gudang Pusat — the other half of the two-sided read.
const OTHER_TEAMS = orders.find((o) => o.id === 110n)!;

// 101's two NOTE rows (a-note-is-a-timeline-row) — status 0, one per side. The warehouse's is the later one.
const FULL_NOTES = FULL.timelineLogs.filter((log) => log.status === 0);
const SELLER_NOTE = FULL_NOTES.find((log) => log.from === 2)!;
const WAREHOUSE_NOTE = FULL_NOTES.find((log) => log.from === 1)!;
// 102 went back to pending WITH A REASON — a status row's `note` — beside a warehouse note row.
const HANDED_BACK = orderDetailFor(102n)!;
const HANDBACK_REASON = HANDED_BACK.timelineLogs.find((log) => log.status !== 0 && log.note)!.note!;
const HANDED_BACK_NOTE = HANDED_BACK.timelineLogs.find((log) => log.status === 0)!.note!;
const ANI = users.find((u) => u.id === 61n)!;
const BUDI = users.find((u) => u.id === 62n)!;

const Routed = (path: string) =>
  routedPage(
    [
      { path: "/orders/:orderId", element: <OrderDetailPage /> },
      marker("/orders", "at-order-list"),
    ],
    path,
  );

const AtFullOrder = Routed(`/orders/${FULL.id}`);

const meta = {
  title: "Pages/Order/OrderDetailPage",
  component: OrderDetailPage,
  parameters: {
    // `useTeam()` throws outside a TeamProvider, and this page reads the current team on every path.
    signedIn: true,
    // The page builds its own data router (pageStory.tsx), so the shared one stands down.
    dataRouter: true,
    layout: "fullscreen",
  },
  beforeEach: asTeam(SELLER.id),
  render: () => <AtFullOrder />,
} satisfies Meta<typeof OrderDetailPage>;

export default meta;
type Story = StoryObj<typeof meta>;

// ── The states worth looking at ─────────────────────────────────────────────────────────────────

export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await waitFor(() => expect(canvas.getByTestId("order-detail-title")).toBeInTheDocument());

    // The header is the ORDER's, and stays put while the sections scroll under it.
    await expect(canvas.getByTestId("order-detail-title")).toHaveTextContent(FULL.id.toString());

    // ONE PAGE OF SECTIONS, not tabs (`the-order-detail-is-one-page-of-sections`): every section is
    // on the page at once, and the nav lists them.
    await expect(canvas.queryByTestId("order-detail-tabs")).not.toBeInTheDocument();
    await expect(canvas.getByTestId("section-items")).toBeInTheDocument();
    await expect(canvas.getByTestId("section-timeline")).toBeInTheDocument();

    for (const line of FULL.items) {
      await expect(canvas.getByText(line.name)).toBeInTheDocument();
    }
  },
};

// THE SAME ORDER, ON A PHONE-SHAPED CANVAS (owner). What to look at: the header and its actions, the
// section chips that replace the left nav, and the item table — the widest thing on the page, in its
// own scroll box.
//
// ⚠ No `play()`: the `viewport` global resizes the WORKBENCH canvas only, and the story runner has one
// fixed viewport (MobileLayout.stories), so an assertion here would describe a width nothing renders
// at. This is for looking. The shell around it is Layouts/Mobile/AppShell.
export const Mobile: Story = {
  globals: { viewport: { value: "mobile2" } },
};

// ── The rules worth failing on ──────────────────────────────────────────────────────────────────

/**
 * TWO TOTALS, TWO FACTS — and they disagree on purpose.
 *
 * `total_cost` is what the order cost US (goods + the warehouse's fee); `platform_total` is what the BUYER PAID THE
 * PLATFORM. Settlement opens every order's account from the platform figure and never from ours, so a fixture where
 * the two matched would make every downstream screen look correct by accident.
 *
 * ⚠ This is the number the settlement design is built on — see
 * `pages/order-settlement/components/OrderDetailPreview.tsx`, which asserts the same figure reaches
 * the settlement tab unchanged.
 */
export const PlatformTotalDiffersFromOurs: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await waitFor(() => expect(canvas.getByTestId("summary-tiles")).toBeInTheDocument());

    // Two facts on two tiles: what the platform paid, and what the order cost us (goods + fee). The
    // list shows the same pair (`the-row-shows-total-beli-and-total-mp`).
    await expect(Number(FULL.platformTotal)).not.toBe(FULL.totalCost);
    await expect(canvas.getByTestId("tile-mp")).toHaveTextContent("Rp 245.000");
    await expect(canvas.getByTestId("tile-system")).toHaveTextContent("Rp 150.500");
  },
};

/**
 * THE HISTORY TAB, WITH THE PEOPLE RESOLVED.
 *
 * The actor ids come from the TIMELINE — the order row records no actor at all — and are resolved
 * through a separate `UserByIDs` read. ⚠ `fetchActors` SWALLOWS a failure there, so an unstubbed
 * lookup does not throw: it quietly degrades every step to "User #61". This story is what notices.
 */
export const Timeline: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await waitFor(() => expect(canvas.getByTestId("timeline-rail")).toBeInTheDocument());

    const ani = users.find((u) => u.id === 61n)!;
    await waitFor(async () => {
      await expect(canvasElement).toHaveTextContent(ani.name);
    });

    // EACH ROW SAYS WHICH SIDE WROTE IT (order-timeline-logs-replaces-order-events): the seller placed the order,
    // the warehouse confirmed it.
    await expect(canvas.getByTestId("order-timeline-pending")).toHaveTextContent("Seller");
    await expect(canvas.getByTestId("order-timeline-processed")).toHaveTextContent("Warehouse");
  },
};

/**
 * ACTOR 0 IS "NOT RECORDED", NOT "USER ZERO".
 *
 * A row whose writer was not identified is in that state. The step must still SHOW — it
 * happened — while the page stays silent about who took it. Inventing a name there would be worse
 * than the gap, and hiding the step would be worse still.
 */
const AtBackfilled = Routed("/orders/108");

export const UnrecordedActor: Story = {
  render: () => <AtBackfilled />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await waitFor(() => expect(canvas.getByTestId("timeline-rail")).toBeInTheDocument());

    // The steps are there — asserted by TESTID, not by the words "handed over", which also appear in the
    // status badge in the header and would pass against a completely empty timeline.
    await waitFor(() => expect(canvas.getByTestId("order-timeline-shipping")).toBeInTheDocument());
    await expect(canvas.getByTestId("order-timeline-pending")).toBeInTheDocument();

    // …and nobody is named on them. Both halves are checked: no resolved person block, and no
    // "User #0" — the fallback firing on an id that means ABSENCE is the specific bug here.
    await expect(canvas.queryByTestId("order-timeline-shipping-by")).not.toBeInTheDocument();
    await expect(canvasElement).not.toHaveTextContent(/User #0/);
  },
};

/**
 * A BORROWED LINE IS PRICED WITH ITS OWNER'S MARKUP (the-cross-charge-lives-on-the-line).
 *
 * Harga beli is what one unit cost the SELLER — `unit_cost_with_markup` — never the bare drawn cost, so the line adds
 * up to the order's `goods_cost` and total sistem is that plus the fee, as on the list's Beli cell.
 */
const AtBorrowed = Routed("/orders/105");

export const ABorrowedLineIsPricedWithItsMarkup: Story = {
  render: () => <AtBorrowed />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await waitFor(() => expect(canvas.getByTestId("order-item-1")).toBeInTheDocument());

    // 157.867 drawn + 31.573 markup = 189.440 a unit, one unit.
    const line = canvas.getByTestId("order-item-1");
    await expect(line).toHaveTextContent("Rp 189.440");
    await expect(line).not.toHaveTextContent("Rp 157.867");

    // goods_cost 189.440 + the frozen fee 2.000.
    await expect(canvas.getByTestId("tile-system")).toHaveTextContent("Rp 191.440");
  },
};

/**
 * A LINE SHOWS ITS PRODUCT — "gambar nama sku": the picture, the name, the SKU.
 *
 * `OrderItem` carries no picture; the page reads it off `Product` with one batched `ProductByIds` for every line. 106's
 * line is on Beras (74), the fixture product drawn with a picture. 101's lines name products the catalogue does not
 * answer for, and they keep the placeholder — the line is still there in full, never blanked.
 */
const AtPictured = Routed("/orders/106");
const BERAS = products.find((p) => p.id === 74n)!;

export const ALineShowsItsProductPicture: Story = {
  render: () => <AtPictured />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await waitFor(() => expect(canvas.getByTestId("order-item-1")).toBeInTheDocument());
    const line = canvas.getByTestId("order-item-1");

    await waitFor(() => expect(within(line).getByRole("img")).toHaveAttribute("src", BERAS.defaultImageThumbnailUrl));
    await expect(line).toHaveTextContent(BERAS.name);
    await expect(line).toHaveTextContent(BERAS.sku);
  },
};

export const ALineWithNoPictureKeepsThePlaceholder: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await waitFor(() => expect(canvas.getByTestId("order-item-1")).toBeInTheDocument());

    for (const item of FULL.items) {
      const line = canvas.getByTestId(`order-item-${item.id}`);
      await expect(line).toHaveTextContent(item.name);
      await expect(line).toHaveTextContent(item.sku);
      await expect(within(line).queryByRole("img")).toBeNull();
    }
  },
};

/**
 * A CANCELLED ORDER CANNOT BE CANCELLED AGAIN.
 *
 * Cancel is offered only while the goods are still in the building (PLACED or CONFIRMED). On a
 * terminal order the button is ABSENT rather than disabled — there is no action left to explain.
 */
const AtCancelled = Routed(`/orders/${CANCELLED.id}`);

export const CancelledOrderHasNoCancelButton: Story = {
  render: () => <AtCancelled />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await waitFor(() => expect(canvas.getByTestId("order-detail-title")).toBeInTheDocument());

    // An end state offers NOTHING: no cancel, and no action bar drawn empty or disabled.
    await expect(canvas.queryByTestId("order-action-cancel")).not.toBeInTheDocument();
    await expect(canvas.queryByTestId("order-action-bar")).not.toBeInTheDocument();
  },
};

// EDIT RESI IS REAL (the-seller-edits-the-resi-until-handover): the seller's button opens the dialog on the order's own
// number and file, and Save sends only what changed — here the number, so the file is left as it is.
export const EditResiSendsOnlyTheNumber: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(await canvas.findByTestId("order-action-editReceipt"));

    const dialog = await screen.findByTestId("edit-receipt-dialog");
    const code = await within(dialog).findByTestId("edit-receipt-code");
    await expect(code).toHaveValue(FULL.receiptCode);
    await expect(within(dialog).getByTestId("order-receipt-attached")).toHaveTextContent(FULL.receipt!.filename);
    // Nothing changed yet, so there is nothing to save.
    await expect(within(dialog).getByTestId("edit-receipt-save")).toBeDisabled();

    await userEvent.clear(code);
    await userEvent.type(code, "JNE-NEW-01", { delay: 40 });
    await userEvent.click(within(dialog).getByTestId("edit-receipt-save"));

    await waitFor(() => expect(screen.queryByTestId("edit-receipt-dialog")).not.toBeInTheDocument());
    await expect(receiptUpdateScenario.last).toEqual({ orderId: FULL.id, receiptCode: "JNE-NEW-01", documentId: undefined });
  },
};

// The warehouse reads the same pending order and is offered no Edit Resi: the number is on the seller's label.
export const TheWarehouseHasNoEditResi: Story = {
  beforeEach: asTeam(WAREHOUSE.id),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await waitFor(() => expect(canvas.getByTestId("order-detail-title")).toBeInTheDocument());
    await expect(canvas.queryByTestId("order-action-editReceipt")).not.toBeInTheDocument();
  },
};

/**
 * THE SCOPE IS TWO-SIDED — a warehouse reads an order it did not place.
 *
 * 110 belongs to Toko Kenanga and ships from Gudang Pusat. The picking crew must be able to open the
 * job they are picking, so `team_id` matching the WAREHOUSE is enough. ⚠ Tightening this to an owner
 * check is the change this story exists to catch.
 */
const AtOtherTeamsOrder = Routed(`/orders/${OTHER_TEAMS.id}`);
// 107 is CANCELLED and has no settlement account in the stub — the "never settled" case.
const AtCancelledOrder = Routed(`/orders/${CANCELLED.id}`);

// ⚠ AND IT READS THE OLD PAGE. A warehouse gets `WarehouseOrderDetail` — the seller's rebuilt detail
// shows harga beli and margin, which a building fulfilling many sellers has no business reading
// (`the-two-ends-are-two-screens`). The tabs below are that page's.
export const WarehouseReadsAnotherTeamsOrder: Story = {
  beforeEach: asTeam(WAREHOUSE.id),
  render: () => <AtOtherTeamsOrder />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await waitFor(() => expect(canvas.getByTestId("order-detail-title")).toBeInTheDocument());
    await expect(canvas.getByTestId("order-detail-title")).toHaveTextContent(
      OTHER_TEAMS.id.toString(),
    );
    await expect(canvas.getByText(OTHER_TEAMS.customerName)).toBeInTheDocument();
    // The warehouse's Info tab names the buyer's marketplace username beside the customer, too.
    await expect(canvas.getByTestId("order-detail-buyer-username")).toHaveTextContent(OTHER_TEAMS.buyerUsername!);
  },
};

/**
 * THE BUYER'S USERNAME IS SHOWN UNDER THE CUSTOMER — and NOTHING when there is none
 * (the-buyers-username-is-optional). 101 carries one; 107 does not, and its recipient section draws no `—` row for it.
 */
export const TheBuyersUsernameShowsUnderTheCustomer: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await waitFor(() => expect(canvas.getByTestId("order-detail-title")).toBeInTheDocument());
    await expect(canvas.getByTestId("order-detail-buyer-username")).toHaveTextContent(FULL.buyerUsername!);
  },
};

export const NoBuyersUsernameShowsNothing: Story = {
  render: () => <AtCancelled />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await waitFor(() => expect(canvas.getByTestId("section-recipient")).toBeInTheDocument());
    await expect(canvas.queryByTestId("order-detail-buyer-username")).not.toBeInTheDocument();
  },
};

/**
 * AN ORDER THIS TEAM MAY NOT READ IS "NOT FOUND", not "forbidden".
 *
 * 110 is Kenanga's and ships from Gudang Pusat, so Melati is on neither side of it. The page shows
 * the error and keeps the way back — a dead end with no back button is how somebody gets stuck on a
 * URL they mistyped.
 */
const AtForbidden = Routed("/orders/110");

export const NotFound: Story = {
  render: () => <AtForbidden />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await waitFor(() => expect(canvas.getByTestId("order-detail-error")).toBeInTheDocument());
    await expect(canvas.getByTestId("order-detail-back")).toBeInTheDocument();
  },
};

/**
 * A MALFORMED ID NEVER REACHES THE SERVER.
 *
 * The query is disabled for it, so the message comes from the page rather than from an error no
 * request produced — which is also why this cannot be folded into `NotFound`: one is a refusal, the
 * other never asked.
 */
const AtGarbageId = Routed("/orders/not-a-number");

export const InvalidId: Story = {
  render: () => <AtGarbageId />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await waitFor(() => expect(canvas.getByTestId("order-detail-error")).toBeInTheDocument());
  },
};

/**
 * THE SETTLEMENT LEDGER IN ITS REAL SEAT — a section of the order, as it was a tab of it.
 *
 * `order-detail-manages-the-ledger` put it here rather than on a screen of its own: the ledger is a
 * property OF an order, and the person adding a row is looking at that order.
 *
 * This pins the tab against the settlement design's own WORKED example, so the numbers on screen are
 * the ones the design was reviewed with — the buyer paid 120.000, part of it never arrived, and the
 * gap is the platform's take rather than a debt anybody will collect.
 */
export const SettlementLedger: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await waitFor(() => expect(canvas.getByTestId("section-settlement")).toBeInTheDocument());

    // The panel loads from the real query hook through the stubbed transport — not a prop — so this
    // also proves the adapter maps the wire enums back to the shapes the panel was designed against.
    await waitFor(() => {
      expect(canvas.queryByTestId("settlement-absent")).not.toBeInTheDocument();
    });

    await waitFor(async () => {
      await expect(canvasElement).toHaveTextContent("120.000");
    });
  },
};

/**
 * ⚠ NEVER SETTLED IS NOT SETTLED TO ZERO.
 *
 * The service answers NotFound for an order with no account, and the tab must SAY so. A zeroed panel
 * would read as a completed settlement nobody performed — the one reading that is worse than showing
 * nothing, because it looks like an answer.
 */
export const SettlementNotRecordedYet: Story = {
  render: () => <AtCancelledOrder />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await waitFor(() => expect(canvas.getByTestId("section-settlement")).toBeInTheDocument());

    await waitFor(() => {
      expect(canvas.getByTestId("settlement-absent")).toBeInTheDocument();
    });
  },
};

// ── Catatan — a note is a timeline row with no status (a-note-is-a-timeline-row) ─────────────────────

/**
 * THE NOTE ROWS, NEWEST FIRST, EACH WITH ITS SIDE AND ITS WRITER. 101 has one per side: the seller's, typed on the
 * create form, and the warehouse's, written later — so the warehouse's leads. The writers come from the page's one
 * actor lookup, the same one the timeline reads.
 */
export const NotesAreListedNewestFirst: Story = {
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
  render: () => <AtCancelled />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const section = await canvas.findByTestId("section-notes");

    await expect(within(section).getByTestId("notes-empty")).toHaveTextContent("No notes on this order yet.");
    await expect(within(section).queryByTestId("notes-list")).not.toBeInTheDocument();
  },
};

/**
 * THE TIMELINE IS THE STATUS ROWS. A note row is not a step — it is in Catatan, and only there — while a STATUS row's
 * own reason (102 went back to pending because Rak A was empty) stays under the step it explains.
 */
const AtHandedBack = Routed(`/orders/${HANDED_BACK.id}`);

export const TheTimelineKeepsStatusRowsOnly: Story = {
  render: () => <AtHandedBack />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const rail = await canvas.findByTestId("timeline-rail");

    await expect(rail).toHaveTextContent("Handed back to pending");
    await expect(rail).toHaveTextContent(HANDBACK_REASON);
    await expect(rail).not.toHaveTextContent(HANDED_BACK_NOTE);
    await expect(canvas.queryByTestId("order-timeline-note")).not.toBeInTheDocument();

    const notes = await within(canvas.getByTestId("section-notes")).findByTestId("notes-list");
    await expect(notes).toHaveTextContent(HANDED_BACK_NOTE);
    await expect(notes).not.toHaveTextContent(HANDBACK_REASON);
  },
};

/**
 * THE WAREHOUSE READS THE NOTES AND WRITES ONE — on its Info tab, where the order's one note card used to be. It
 * writes with ITS team id, so the server records the note as the warehouse's.
 */
export const WarehouseDetailShowsTheNotesAndAddsOne: Story = {
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

/** THE WAREHOUSE'S TIMELINE TAB DROPS THE NOTES TOO, and keeps the hand-back's reason on its step. */
export const WarehouseTimelineKeepsStatusRowsOnly: Story = {
  beforeEach: asTeam(WAREHOUSE.id),
  render: () => <AtHandedBack />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(await canvas.findByTestId("order-detail-tab-timeline"));
    const timeline = await canvas.findByTestId("order-detail-timeline");

    await waitFor(() => expect(timeline).toHaveTextContent(HANDBACK_REASON));
    await expect(timeline).not.toHaveTextContent(HANDED_BACK_NOTE);
  },
};

// ── From the approved preview ───────────────────────────────────────────────────────────────────────

/** The layout without the ⚠ scaffolding — the version to judge the design on. */
export const WithoutTheMarks: Story = {
  globals: { pendingMarks: "off" },
};

/**
 * THE ORDER'S OWN LEG ONLY (the-return-leg-waits-for-tracking). There is no return shipment record, so
 * Pengiriman draws no return leg and Info no return resi. 108 is the fixture that once carried an
 * invented return, so it is the one that would show it if it came back.
 */
const AtOnceReturned = Routed("/orders/108");

export const OnlyTheOrderLegIsShown: Story = {
  render: () => <AtOnceReturned />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await waitFor(() => expect(canvas.getByTestId("shipment-outbound")).toBeInTheDocument());

    await expect(canvas.queryByTestId("shipment-return")).not.toBeInTheDocument();
    await expect(canvas.queryByTestId("shipment-return-none")).not.toBeInTheDocument();
    await expect(canvas.queryByTestId("order-reference-return")).not.toBeInTheDocument();
  },
};

/**
 * ⚠ EVERY GAP THE SCREEN DECLARES HAS A MARK ON IT. The deadline entry once sat in the pending list for
 * a whole round with no badge anywhere, while the deadline itself was the loudest invented thing on the
 * page. No exemptions (owner: *"kasih saja dulu seperti lainnya"*).
 */
export const EveryDeclaredGapIsMarkedOnScreen: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await waitFor(() => expect(canvas.getByTestId("summary-tiles")).toBeInTheDocument());

    for (const part of ORDER_DETAIL_PENDING.parts) {
      await expect(canvas.queryAllByTestId(`not-implemented-${part.id}`).length).toBeGreaterThan(0);
    }
  },
};
