import { useState } from "react";
import { Button, Grid, HStack, Icon, Popover, Portal, Text } from "@chakra-ui/react";
import { Calendar, ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";

/** A month window, inclusive at both ends. `yyyy-mm`; `""` is an open end. */
export interface MonthRange {
  from: string;
  to: string;
}

export const ALL_MONTHS: MonthRange = { from: "", to: "" };

const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function key(year: number, monthIndex: number): string {
  return `${year}-${String(monthIndex + 1).padStart(2, "0")}`;
}

export function formatMonth(value: string): string {
  if (!value) return "";
  const [year, month] = value.split("-");
  return `${MONTH_LABELS[Number(month) - 1] ?? month} ${year}`;
}

// MonthRangePicker picks a window of whole MONTHS.
//
// It is not a date-range picker with the days hidden. The distinction is real: a settlement period, a
// payout cycle, a monthly stock valuation are defined ON months, and letting somebody pick "3 Aug to
// 27 Sep" for one of those produces a window that does not correspond to any period the business
// actually has. Offering only months makes the invalid range unrepresentable.
//
// ⚠ IT SELECTS BY CLICKING TWICE, and the second click may be EARLIER than the first. Anyone who has
// used a range picker has clicked the end first; forcing a strict order means an error message for
// something the component can simply understand. Whichever two months are picked, the earlier one
// becomes `from`.
export const description =
  "A window of whole MONTHS, for periods that are defined on months (settlements, payouts, valuations) — so '3 Aug to 27 Sep' is not expressible. Click two months in either order.";

export interface MonthRangePickerProps {
  value: MonthRange;
  onChange(range: MonthRange): void;
  disabled?: boolean;
  placeholder?: string;
}

export function MonthRangePicker({
  value,
  onChange,
  disabled,
  placeholder = "All months",
}: MonthRangePickerProps) {
  const [open, setOpen] = useState(false);
  const [year, setYear] = useState(() => Number((value.from || value.to || "").split("-")[0]) || new Date().getFullYear());
  // The first click of a new selection. Null means the next click starts one.
  const [anchor, setAnchor] = useState<string | null>(null);

  const label = value.from || value.to ? `${formatMonth(value.from) || "…"} – ${formatMonth(value.to) || "…"}` : placeholder;

  function pick(monthKey: string) {
    if (anchor === null) {
      // A first click shows a single-month window rather than nothing, so the click has visible
      // effect even before the range is complete.
      setAnchor(monthKey);
      onChange({ from: monthKey, to: monthKey });
      return;
    }

    // Order-insensitive — see the note above.
    const [from, to] = anchor <= monthKey ? [anchor, monthKey] : [monthKey, anchor];
    setAnchor(null);
    onChange({ from, to });
    setOpen(false);
  }

  return (
    <Popover.Root open={open} onOpenChange={(e) => { setOpen(e.open); if (!e.open) setAnchor(null); }}>
      <Popover.Trigger asChild>
        <Button variant="outline" fontWeight="normal" disabled={disabled} data-testid="month-range-trigger">
          <Icon as={Calendar} boxSize="4" />
          <Text truncate>{label}</Text>
          <Icon as={ChevronDown} boxSize="4" />
        </Button>
      </Popover.Trigger>

      <Portal>
        <Popover.Positioner>
          <Popover.Content data-testid="month-range-panel">
            <Popover.Body>
              <HStack justify="space-between" mb="2">
                <Button size="xs" variant="ghost" aria-label="Previous year" onClick={() => setYear((y) => y - 1)}>
                  <Icon as={ChevronLeft} boxSize="4" />
                </Button>
                <Text fontWeight="medium" data-testid="month-range-year">{year}</Text>
                <Button size="xs" variant="ghost" aria-label="Next year" onClick={() => setYear((y) => y + 1)}>
                  <Icon as={ChevronRight} boxSize="4" />
                </Button>
              </HStack>

              <Grid templateColumns="repeat(3, 1fr)" gap="1">
                {MONTH_LABELS.map((label, i) => {
                  const k = key(year, i);
                  const inRange = Boolean(value.from && value.to && k >= value.from && k <= value.to);
                  const isEnd = k === value.from || k === value.to;

                  return (
                    <Button
                      key={k}
                      size="xs"
                      // The ends are solid and the interior subtle, so a range reads as a band with
                      // two handles rather than as twelve independently-selected months.
                      variant={isEnd ? "solid" : inRange ? "subtle" : "ghost"}
                      colorPalette={inRange || isEnd ? "brand" : "gray"}
                      onClick={() => pick(k)}
                      data-testid={`month-${k}`}
                      data-in-range={inRange ? "true" : undefined}
                    >
                      {label}
                    </Button>
                  );
                })}
              </Grid>

              <Button
                size="xs"
                variant="ghost"
                w="full"
                mt="2"
                onClick={() => {
                  setAnchor(null);
                  onChange(ALL_MONTHS);
                  setOpen(false);
                }}
                data-testid="month-range-clear"
              >
                All months
              </Button>
            </Popover.Body>
          </Popover.Content>
        </Popover.Positioner>
      </Portal>
    </Popover.Root>
  );
}
