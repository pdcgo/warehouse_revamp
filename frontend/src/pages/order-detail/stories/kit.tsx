import { asTeam, marker, routedPage } from "../../../../.storybook/pageStory";
import { orderDetailFor, orders, teams } from "../../../../.storybook/fixtures";
import { OrderDetailPage } from "../index";

// WHAT EVERY ORDER-DETAIL STORY FILE SHARES — the page's stories are split by the part of the screen they are about
// (stories-are-grouped-by-the-part-of-the-screen): `../index.stories.tsx` holds Default and Mobile, this folder one
// file per part. Each file keeps its own `title` literal — Storybook reads it statically — and spreads the rest from here.
//
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

export const SELLER = teams[1]!; // Toko Melati (12)
export const WAREHOUSE = teams[0]!; // Gudang Pusat (11)

// 101 is the order written out in full — three lines, an address, a note, a receipt, and a
// marketplace total that DISAGREES with ours.
export const FULL = orderDetailFor(101n)!;
// 107 is the only CANCELLED one, and it is Melati's.
export const CANCELLED = orders.find((o) => o.id === 107n)!;

export const Routed = (path: string) =>
  routedPage(
    [
      { path: "/orders/:orderId", element: <OrderDetailPage /> },
      marker("/orders", "at-order-list"),
    ],
    path,
  );

const AtFullOrder = Routed(`/orders/${FULL.id}`);

// The CANCELLED order's page — read by the Actions, Shipping and Notes stories.
export const AtCancelled = Routed(`/orders/${CANCELLED.id}`);

/** Everything in a file's meta but its title. */
export const ORDER_DETAIL_META = {
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
};
