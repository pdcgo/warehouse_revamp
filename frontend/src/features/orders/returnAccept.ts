import { useLocation, useNavigate } from "react-router-dom";

// THE RETURN ACCEPT PAGE'S ADDRESS AND ITS WAY IN (the-return-accept-page-is-accepted). The accept with its stock half is
// a page — racks per line need the room Accept Delivery and a transfer's accept have — beside the order's pick page.
// Three screens open it: the pick page, the warehouse order detail and Receive a Return's found order.

export const RETURN_ACCEPT_PATH = "/warehouse-orders/:orderId/accept-return";

export function returnAcceptPath(orderId: bigint): string {
  return `/warehouse-orders/${orderId}/accept-return`;
}

/** What the page goes back to — the screen that opened it, carried in the navigation's state. */
export interface ReturnAcceptEntryState {
  from?: string;
}

/**
 * Opens the accept page for an order, carrying where it was opened from so the page's Back (and the accept) return
 * there.
 */
export function useOpenReturnAccept(): (orderId: bigint) => void {
  const navigate = useNavigate();
  const location = useLocation();

  return (orderId) => {
    const state: ReturnAcceptEntryState = { from: `${location.pathname}${location.search}` };
    navigate(returnAcceptPath(orderId), { state });
  };
}
