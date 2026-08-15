// The month a money screen opens on: this one.
//
// A revenue or cost list without a period is a wall of everything ever recorded, so both start
// somewhere real — and both start on the SAME period, because the profit screen (#172) subtracts one
// from the other and two screens disagreeing about "this month" would make that arithmetic nonsense.
export function thisMonth(): string {
  const now = new Date();

  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

// A "YYYY-MM" month becomes the INCLUSIVE day range both list RPCs filter on (#168/#171).
//
// One copy, shared by the costs and revenue screens. Two copies of a date range is how two totals
// start describing different months while claiming the same label — which is the whole failure the
// server-side period filter exists to prevent, and it would be silly to reintroduce it here.
//
// The last day is COMPUTED rather than assumed: day 0 of the next month is the last day of this one,
// which is what makes February and the 30-day months come out right without a table of lengths.
export function monthRange(month: string): { from: string; to: string } {
  const [y, m] = month.split("-").map(Number);

  if (!y || !m) return { from: "", to: "" };

  const last = new Date(y, m, 0).getDate();

  return {
    from: `${month}-01`,
    to: `${month}-${String(last).padStart(2, "0")}`,
  };
}

// The longest period a DAILY series may cover, and it must equal `maxPeriodDays` on the server
// (backend/services/*/[revenue|expense]_daily.go).
//
// The cap is what lets RevenueDaily and ExpenseDaily have no page cursor at all: their response length
// is `to − from`, which the caller states, so bounding the span bounds the response forever. The client
// knows the number too so it can say WHY a range was refused before spending a round trip on an error
// it could have predicted.
//
// 366 rather than 365 so a leap year is a whole year, not a whole year minus a day.
export const MAX_PERIOD_DAYS = 366;

// How many days a `yyyy-mm-dd` range covers, counting BOTH ends — so a single day is 1, not 0. `0` if
// either end is missing or unparseable.
export function spanDays(from: string, to: string): number {
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);

  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return 0;

  return Math.round((end - start) / 86_400_000) + 1;
}

// Every day in an inclusive `yyyy-mm-dd` range, ascending — the STATEMENT'S DATE SPINE.
//
// ⚠ THE CLIENT OWNS THIS, and the two Daily RPCs are sparse because of it. The statement subtracts
// expense_service's days from revenue_service's, so it has to build a calendar to line them up on
// regardless; a server that also emitted empty days would be a second calendar, free to disagree with
// this one about what February contains.
//
// Walked in UTC deliberately. These are calendar labels, never instants — the strings go straight back
// to the RPC that produced them — so stepping through local time would only add a DST hour that could
// skip or repeat a day. There is no wall clock here to be wrong about.
export function daySpine(from: string, to: string): string[] {
  const span = spanDays(from, to);
  if (span <= 0) return [];

  const start = Date.parse(`${from}T00:00:00Z`);

  return Array.from({ length: span }, (_, i) =>
    new Date(start + i * 86_400_000).toISOString().slice(0, 10),
  );
}
