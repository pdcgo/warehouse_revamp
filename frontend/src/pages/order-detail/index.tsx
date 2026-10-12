import { TeamType } from "../../gen/warehouse/team/v1/team_pb";
import { useTeam } from "../../features/team/TeamContext";
import { SellerOrderDetailPage } from "./SellerOrderDetail";
import { WarehouseOrderDetailPage } from "./WarehouseOrderDetail";

// ONE ROUTE, TWO SCREENS — the same split the order list already made (owner, 2026-09-29).
//
// `/orders/:orderId` is read from both ends (#151), like the list it is reached from. The seller's
// detail was rebuilt and approved — one page of sections around the money: harga beli, the perincian,
// the margin against what the platform paid. The warehouse keeps the detail it had, for the reason the
// owner gave for its LIST (`the-two-ends-are-two-screens`): the context is different, and a building
// that fulfils many sellers' orders has no business reading another team's cost and margin.
//
// ⚠ A JS BRANCH, NOT CSS — exactly one page mounts, as with the list and the app shell.
//
// ⚠ THE TEAM TYPE, NOT A ROLE. Root and admin fall through to the seller's screen, like the list.
export function OrderDetailPage() {
  const { current } = useTeam();

  if (current?.teamType === TeamType.WAREHOUSE) {
    return <WarehouseOrderDetailPage />;
  }

  return <SellerOrderDetailPage />;
}
