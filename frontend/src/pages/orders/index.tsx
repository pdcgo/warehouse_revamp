import { TeamType } from "../../gen/warehouse/team/v1/team_pb";
import { useTeam } from "../../features/team/TeamContext";
import { SellerOrdersPage } from "./SellerOrders";
import { WarehouseOrdersPage } from "./WarehouseOrders";

// ONE ROUTE, TWO SCREENS — and the team decides which (owner, 2026-09-29).
//
// `/orders` is read from both ends (#151): a selling team reads the orders it PLACED, a warehouse
// reads the orders it has to SHIP. That was one screen with a few columns swapped, until the owner
// rebuilt the seller's around the money — the marketplace reference, total beli, the margin against
// what the platform paid, the storefront's clock — and said of the other end: *"warehouse order list
// page kembalikan, aku belum mau menyentuh itu, konteksnya beda soalnya"*.
//
// ⚠ AND THE CONTEXT REALLY IS DIFFERENT, which is why this is a split rather than a flag. Almost
// nothing on the seller's row is a fact a picker acts on:
//
//   ID Order · Tgl MP · Total MP · Beli · Margin    what a shop is owed and what it earned
//   what to pick, from which shelf, and by when      what a crew is holding
//
// A warehouse showing another team's margin would also be showing it a number that is none of its
// business. So the warehouse keeps the screen it had until its own is designed.
//
// ⚠ IT IS A JS BRANCH, NOT CSS. Same rule as the app shell (`layouts/Layout.tsx`): rendering both and
// hiding one would mount two tables, two sets of queries and two of every `data-testid` the e2e reach
// for.
//
// ⚠ THE TEAM TYPE, NOT A ROLE. Who you are inside a team does not change which list this is — a
// warehouse admin and a warehouse picker both read the building's queue. Root and admin fall through
// to the seller's screen, which is where the Tim column lives.
export function OrdersPage() {
  const { current } = useTeam();

  if (current?.teamType === TeamType.WAREHOUSE) {
    return <WarehouseOrdersPage />;
  }

  return <SellerOrdersPage />;
}
