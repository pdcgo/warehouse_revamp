import { Navigate, useLocation } from "react-router-dom";
import { TeamType } from "../../gen/warehouse/team/v1/team_pb";
import { useTeam } from "../../features/team/TeamContext";

// THE OLD STOCK ADDRESS FORWARDS (a-warehouses-products-is-what-it-holds). Inventories ▸ Stock (/inventories/stock) was
// the list of what a warehouse holds; that list is now a warehouse's Products, and the separate item was withdrawn
// (superseded-stock-opens-a-warehouses-inventories). A link or a bookmark to it still lands:
//
//   a warehouse team   → /products     its own held list
//   anyone else        → /inventory    root and the admin team's Inventory, the same list with a warehouse to pick
//
// An element rather than a loader redirect, because where it goes depends on the CURRENT team, which only the
// TeamProvider knows — and only once it is `ready` (it loads the memberships after the page mounts; forwarding before
// that would send a warehouse's own Admin to the picker). The query rides along, so a search survives the forward.
export function StockForward() {
  const { current, ready } = useTeam();
  const { search } = useLocation();

  if (!ready) {
    return null;
  }

  const pathname = current?.teamType === TeamType.WAREHOUSE ? "/products" : "/inventory";

  return <Navigate to={{ pathname, search }} replace />;
}
