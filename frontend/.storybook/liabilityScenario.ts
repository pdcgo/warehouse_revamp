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

export function resetLiabilityListCalls() {
  liabilityListCalls.positions = [];
  liabilityListCalls.logs = [];
  liabilityListCalls.payments = [];
  liabilityListCalls.termsHistory = [];
}
