import type {
  LiabilityLogListFilter,
  LiabilityPaymentListFilter,
  LiabilityPositionListFilter,
  LiabilityTermsHistoryListFilter,
} from "../src/gen/warehouse/liability/v1/liability_pb";

// THE TEAM BALANCE LISTS' REQUESTS, as the stub received them (backlog #34). The search, the team type, "awaiting only",
// the date range and each tab's direction or side are the SERVER's filters now, applied before the page — so a story's
// play() asserts the screen SENT them, not only that the rows narrowed. Its own module, beside sessionScenario, so a
// story imports it without pulling the whole stub transport into the app's type check. Reset per story
// (stubTransport's resetLiabilityPayments, from preview.tsx).
export const liabilityListCalls = {
  positions: [] as (LiabilityPositionListFilter | undefined)[],
  logs: [] as (LiabilityLogListFilter | undefined)[],
  payments: [] as (LiabilityPaymentListFilter | undefined)[],
  termsHistory: [] as (LiabilityTermsHistoryListFilter | undefined)[],
};

// A PAYMENT'S STATUS AS A STORY NEEDS IT before the page reads (a-pending-payment-is-cancelled-by-its-selling-team): the
// creditor's view of a claim its payer already cancelled, or a warehouse's own pending payment. Keyed by payment id;
// the stub applies it on its next payment call and empties it — set it in a story's `beforeEach`, which runs after
// preview.tsx's reset. Statuses are LiabilityPaymentStatus numbers (1 pending · 2 accepted · 4 rejected · 5 cancelled).
export const liabilityPaymentScenario = {
  statusOf: {} as Record<string, number>,
};

export function resetLiabilityListCalls() {
  liabilityListCalls.positions = [];
  liabilityListCalls.logs = [];
  liabilityListCalls.payments = [];
  liabilityListCalls.termsHistory = [];
  liabilityPaymentScenario.statusOf = {};
}
