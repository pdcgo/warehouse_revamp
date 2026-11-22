import { expect } from "@playwright/test";
import type { Page } from "@playwright/test";

// ORDER STATUS MOVES on Analytic (#84, the-order-status-moves-prototype-is-accepted in
// docs/business/analytic/rpc_provide_decision.md) — the shared read behind the eight order specs' "<move> recorded in
// analytic metric" thens (docs/acceptances/inventory/order.md). ONE metric, `metrics/orders/moves` (Analytic › Order ›
// Order status moves), a COUNT per status an order moved TO, each named by what happened to the order
// (the-order-metric-ids-name-what-moved — a resolve, problem → completed, is a Completed). Counts only, no money:
//
//   confirmed_count        pending → processed               confirm order
//   back_to_pending_count  processed or picked → pending     back to pending order
//   picked_count           processed → picked                validate package order (the pick)
//   handed_over_count      picked → shipping                 hand over order
//   shipped_count          shipping → shipped                mark shipped order
//   problem_count          shipped → problem                 mark problem order
//   completed_count        shipped → completed               complete order
//                          problem → completed               resolve dispute order
//   disputes_resolved_count  problem → completed             resolve dispute order (#97 — its own count as well)
//
// A resolve counts ONCE IN EACH of Completed and Disputes resolved (the-order-status-moves-prototype-is-accepted's
// 🔄 2026-11-20, acceptance analytic/order_metric.md given 14); a shipped → completed counts only in Completed.
//
// Each move counts on its own Jakarta day under the order's shop (a-fact-counts-on-the-day-it-happened), counted from
// the fold onward; a warehouse reads every count of the orders it ships (a-warehouse-reads-the-orders-it-ships), so each
// move is read by EVERY role its given names — the warehouse moves by warehouse:owner/admin/staff, the selling moves by
// selling:owner/admin/cs — each role on a shop of its own. The fold is asynchronous: every read re-loads the page until
// it settles.

export const ORDER_MOVES = "metrics/orders/moves";

export type OrderMoveField =
  | "confirmed_count"
  | "back_to_pending_count"
  | "picked_count"
  | "handed_over_count"
  | "shipped_count"
  | "problem_count"
  | "completed_count"
  | "disputes_resolved_count";

/** A count no move of the shop's reached: the cell reads 0, or "—" when the service left it unset. */
export const NOT_COUNTED = /^(0|—)$/;

/** The composer's Add Metric › Order offers Order status moves to the signed-in reader. */
export async function expectMovesOffered(page: Page): Promise<void> {
  await page.goto(`/analytic?g=shop&r=7d`);
  await page.getByTestId("analytic-add-metric").click();
  await page.getByTestId("analytic-category-order").click();
  await expect(
    page.getByTestId("analytic-category-order-metrics").getByTestId(`analytic-metric-${ORDER_MOVES.replaceAll("/", "-")}`),
  ).toBeVisible();
}

/**
 * A check's own shop — TWO orders, ONE of them moved by the test — read by shop over the last 7 days, filtered to that
 * shop, with Orders created beside Order status moves. First the shop's `created_count` must read 2 (the fold has both
 * orders), then the move's own `field` must read exactly `want`: one move counted once, and the untouched order — still
 * standing where the moved one started — added nothing to it.
 */
export async function expectMoveCounted(page: Page, shop: string, field: OrderMoveField, want = "1"): Promise<void> {
  const url = `/analytic?g=shop&m=metrics/orders/created,${ORDER_MOVES}&r=7d&shop=${shop}`;
  const created = page.getByTestId(`analytic-cell-${shop}-created_count`);
  const moved = page.getByTestId(`analytic-cell-${shop}-${field}`);

  // The shop's row stands: its two orders created (the fold landed).
  await expect(async () => {
    await page.goto(url);
    await expect(created).toHaveText("2", { timeout: 3_000 });
  }).toPass({ timeout: 30_000 });

  // The move's own count reads the ONE move.
  await expect(async () => {
    await page.goto(url);
    await expect(created).toHaveText("2", { timeout: 3_000 });
    await expect(moved).toHaveText(want, { timeout: 3_000 });
  }).toPass({ timeout: 30_000 });
}

/**
 * The same shop read as expectMoveCounted (its row already standing — call that first), every count named in `want`
 * read on ONE page load: a string is the exact figure, NOT_COUNTED a count no move reached.
 */
export async function expectMoveCounts(
  page: Page,
  shop: string,
  want: Partial<Record<OrderMoveField, string | RegExp>>,
): Promise<void> {
  const url = `/analytic?g=shop&m=metrics/orders/created,${ORDER_MOVES}&r=7d&shop=${shop}`;
  const created = page.getByTestId(`analytic-cell-${shop}-created_count`);
  await expect(async () => {
    await page.goto(url);
    await expect(created).toHaveText("2", { timeout: 3_000 });
    for (const [field, figure] of Object.entries(want)) {
      await expect(page.getByTestId(`analytic-cell-${shop}-${field}`)).toHaveText(figure!, { timeout: 3_000 });
    }
  }).toPass({ timeout: 30_000 });
}
