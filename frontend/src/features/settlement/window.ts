import { resolveRange } from "../../components/datetime/DateRangePicker";
import type { DateRange } from "../../components/datetime/DateRangePicker";
import { toDateInputValue } from "../../lib/datetime";

/**
 * A DateRange → the inclusive `yyyy-mm-dd` pair every settlement read filters on (the report's window,
 * the list's last-moved window).
 *
 * Through `resolveRange`, because a RELATIVE range stores a day COUNT and has no dates on it. The
 * instants come back in LOCAL time, so they are formatted back with the local formatter — `toISOString`
 * would shift the boundary by seven hours in Indonesia and ask for a window a day off the picker's.
 */
export function windowOf(range: DateRange): { from: string; to: string } {
  const { fromUnix, toUnix } = resolveRange(range);

  return {
    from: fromUnix > 0n ? toDateInputValue(new Date(Number(fromUnix) * 1000)) : "",
    to: toUnix > 0n ? toDateInputValue(new Date(Number(toUnix) * 1000)) : "",
  };
}
