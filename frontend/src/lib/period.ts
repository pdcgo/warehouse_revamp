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
