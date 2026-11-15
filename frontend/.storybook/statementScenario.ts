import { GroupType } from "../src/gen/warehouse/analytic_base/v1/analytic_pb";

// THE DAILY STATEMENT'S GRAIN, as the stub received it (periods-are-grouped-on-the-server). The grain is the SERVER's
// now — each Daily RPC takes it and returns one row per bucket — so a story's play() asserts the screen SENT it, not only
// that the rows came out by month. Its own module, beside liabilityScenario, so a story imports it without pulling the
// whole stub transport into the app's type check. Reset per story (stubTransport's resetLiabilityPayments, from
// preview.tsx).
export const statementCalls = {
  expense: [] as GroupType[],
  liability: [] as GroupType[],
};

// …and the WINDOW each call asked for, beside its grain — so a story can say "three years of Tahunan came from ONE call
// per service over the whole window", not three yearly calls.
export interface StatementAsk {
  groupBy: GroupType;
  from: string;
  to: string;
}

export const statementAsks = {
  expense: [] as StatementAsk[],
  liability: [] as StatementAsk[],
};

export function resetStatementCalls() {
  statementCalls.expense = [];
  statementCalls.liability = [];
  statementAsks.expense = [];
  statementAsks.liability = [];
}

// The key the server gives a bucket's row: its FIRST calendar day — the day itself, the 1st of its month, 1 January of
// its year. Unset is the daily grain, as on the server.
export function firstDayOfBucket(date: string, groupBy: GroupType): string {
  if (groupBy === GroupType.YEARLY) return `${date.slice(0, 4)}-01-01`;
  if (groupBy === GroupType.MONTHLY) return `${date.slice(0, 7)}-01`;

  return date;
}
