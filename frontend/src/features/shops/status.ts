import { ShopListStatus, ShopStatus, type Shop } from "../../gen/warehouse/selling/v1/selling_pb";

// A SHOP IS CLOSED, NEVER DELETED (a-shop-is-closed-never-deleted): `status` (open · closed) and `closed_at_unix`. A
// closed shop takes no new selling — the order form never offers it, a pushed draft is refused — while its money keeps
// running: its statements import, its placed orders move, expenses name it (a-closed-shop-refuses-only-new-selling).

/** The shops list's status filter — open by default, closed, or both (the-close-shop-prototype-is-accepted). */
export type ShopStatusFilter = "open" | "closed" | "all";

export const SHOP_STATUS_FILTERS = ["open", "closed", "all"] as const satisfies readonly ShopStatusFilter[];

/** ShopList's `status` for each filter. */
export const SHOP_LIST_STATUS: Record<ShopStatusFilter, ShopListStatus> = {
  open: ShopListStatus.OPEN,
  closed: ShopListStatus.CLOSED,
  all: ShopListStatus.ALL,
};

/** Whether the shop is closed — false for a shop not loaded yet. */
export function isShopClosed(shop: Pick<Shop, "status"> | null | undefined): boolean {
  return shop?.status === ShopStatus.CLOSED;
}
