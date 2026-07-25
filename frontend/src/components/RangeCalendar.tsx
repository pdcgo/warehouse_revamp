import { useMemo, useState } from "react";
import { Flex, Grid, Icon, IconButton, Text, chakra } from "@chakra-ui/react";
import { useTranslation } from "react-i18next";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { addMonths, monthGrid, parseLocalDate, startOfMonth, toDateInputValue } from "../lib/datetime";

/**
 * A month-grid range calendar — the absolute pane of {@link DateRangePicker}. Two clicks set a window:
 * the first drops an anchor and opens the upper end, the second closes it (either order — the pair is
 * sorted), and hovering between the two previews the span. It speaks the same `yyyy-mm-dd` strings the
 * rest of the picker family uses, so there is no `Date` round-trip and no timezone drift; `""` on a side
 * is an OPEN end, so a single click (anchor only) is a valid "from X onwards".
 *
 * This is hand-built rather than Chakra/Ark's `DatePicker`: that one crashed when its localized
 * `valueAsString` was fed back through `parseDate`, and a calendar we own has no such surprise.
 */
export const description =
  "Month-grid range calendar (the absolute pane of DateRangePicker). Two clicks set a `yyyy-mm-dd` window — anchor, then close, in either order — with a live hover preview between them; a lone click is an open-ended \"from X onwards\". Hand-built (not Ark's DatePicker) so it round-trips no localized strings.";

const Day = chakra("button");

export interface RangeCalendarProps {
  /** Lower bound, `yyyy-mm-dd`, or `""` for open. */
  from: string;
  /** Upper bound, `yyyy-mm-dd`, or `""` for open. */
  to: string;
  onChange: (from: string, to: string) => void;
  testId?: string;
}

// Order two yyyy-mm-dd (or null) ascending; nulls keep their side. Lexical order == chronological for
// fixed-width ISO dates, so no parsing is needed to compare.
function order(a: string | null, b: string | null): [string | null, string | null] {
  if (a && b) return a <= b ? [a, b] : [b, a];
  return [a, b];
}

export function RangeCalendar({ from, to, onChange, testId }: RangeCalendarProps) {
  const { i18n } = useTranslation();
  const locale = i18n.language;
  const todayIso = toDateInputValue(new Date());

  // The visible month — seeded from the selection (its end, then its start) so the picker opens looking
  // at the dates you already chose, not always at today.
  const [view, setView] = useState<Date>(() =>
    startOfMonth(parseLocalDate(to) ?? parseLocalDate(from) ?? new Date()),
  );
  // The anchor of an in-progress selection: set by the first click, cleared by the second.
  const [anchor, setAnchor] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);

  const days = useMemo(() => monthGrid(view), [view]);
  // Weekday headings in the active locale. 2023-01-01 was a Sunday — a stable anchor for Su…Sa.
  const weekdays = useMemo(
    () =>
      Array.from({ length: 7 }, (_, i) =>
        new Date(2023, 0, 1 + i).toLocaleDateString(locale, { weekday: "short" }),
      ),
    [locale],
  );
  const monthLabel = view.toLocaleDateString(locale, { month: "long", year: "numeric" });

  // The pair to paint: mid-selection it's [anchor, hovered], otherwise the committed [from, to].
  const [lo, hi] = anchor ? order(anchor, hover ?? anchor) : order(from || null, to || null);

  function pick(iso: string) {
    if (anchor === null) {
      // First click: start a fresh range with an open upper end.
      setAnchor(iso);
      onChange(iso, "");
    } else {
      // Second click: close the range, sorted so order of picking doesn't matter.
      const [a, b] = order(anchor, iso);
      onChange(a ?? "", b ?? "");
      setAnchor(null);
    }
  }

  return (
    <Flex direction="column" gap="2" colorPalette="brand" onMouseLeave={() => setHover(null)}>
      <Flex align="center" justify="space-between">
        <IconButton
          aria-label={monthLabel}
          variant="ghost"
          size="xs"
          onClick={() => setView(addMonths(view, -1))}
          data-testid={testId ? `${testId}-prev` : undefined}
        >
          <Icon as={ChevronLeft} boxSize="4" />
        </IconButton>
        <Text fontWeight="semibold" fontSize="sm">
          {monthLabel}
        </Text>
        <IconButton
          aria-label={monthLabel}
          variant="ghost"
          size="xs"
          onClick={() => setView(addMonths(view, 1))}
          data-testid={testId ? `${testId}-next` : undefined}
        >
          <Icon as={ChevronRight} boxSize="4" />
        </IconButton>
      </Flex>

      <Grid templateColumns="repeat(7, 1fr)" columnGap="0" rowGap="1px">
        {weekdays.map((w) => (
          <Text key={w} textAlign="center" fontSize="2xs" fontWeight="medium" color="fg.muted" pb="1">
            {w}
          </Text>
        ))}
        {days.map((d) => {
          const iso = toDateInputValue(d);
          const inMonth = d.getMonth() === view.getMonth();
          const isLo = lo !== null && iso === lo;
          const isHi = hi !== null && iso === hi;
          const isEnd = isLo || isHi;
          const inRange = lo !== null && hi !== null && iso > lo && iso < hi;
          const isToday = iso === todayIso;
          const single = isLo && isHi;

          return (
            <Day
              key={iso}
              type="button"
              onClick={() => pick(iso)}
              onMouseEnter={() => setHover(iso)}
              data-testid={testId ? `${testId}-day-${iso}` : undefined}
              aria-pressed={isEnd}
              h="8"
              w="full"
              fontSize="sm"
              lineHeight="1"
              cursor="pointer"
              color={isEnd ? "colorPalette.contrast" : inMonth ? "fg" : "fg.subtle"}
              fontWeight={isEnd || isToday ? "semibold" : "normal"}
              bg={isEnd ? "colorPalette.solid" : inRange ? "colorPalette.subtle" : "transparent"}
              borderLeftRadius={single || isLo ? "md" : "0"}
              borderRightRadius={single || isHi ? "md" : "0"}
              boxShadow={isToday && !isEnd ? "inset 0 0 0 1px var(--chakra-colors-color-palette-emphasized)" : undefined}
              _hover={{ bg: isEnd ? "colorPalette.solid" : "colorPalette.muted" }}
            >
              {d.getDate()}
            </Day>
          );
        })}
      </Grid>
    </Flex>
  );
}
