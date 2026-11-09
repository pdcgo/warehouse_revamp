import { useState, type ReactNode } from "react";
import { Box, Button, Flex, Icon, Popover, Portal, Stack, Text, useBreakpointValue } from "@chakra-ui/react";
import { useTranslation } from "react-i18next";
import { Calendar, ChevronDown, X } from "lucide-react";
import { parseLocalDate } from "../../lib/datetime";
import { jakartaUnixWindowOf } from "../../lib/jakartaDay";
import { RadioPills } from "../inputs/RadioPills";
import { RangeCalendar } from "./RangeCalendar";

/**
 * A date range, Grafana-style. Two shapes, one union:
 *   - RELATIVE — "the last N days" or "the last N months, ending today". It is stored as the NUMBER N, not
 *     resolved dates, so the window stays live: reopen the screen tomorrow and "Last 7 days" still means
 *     the last 7 days, not the 7 days that were current when it was picked. A year is twelve months.
 *   - ABSOLUTE — an explicit `from`/`to` as `yyyy-mm-dd`. `""` on either side is an OPEN end, so
 *     `{from:"",to:""}` means "all dates".
 *
 * The picker emits this value; a caller turns it into a unix window with `resolveRange`.
 */
export type DateRange =
  | { kind: "relative"; days: number; months?: undefined }
  | { kind: "relative"; months: number; days?: undefined }
  | { kind: "absolute"; from: string; to: string };

/** The empty filter: no lower and no upper bound. */
export const ALL_DATES: DateRange = { kind: "absolute", from: "", to: "" };

// The quick relative ranges, widening. "Today" is just N=1 day.
//
// PAST TWO WEEKS THEY ARE MONTHS AND A YEAR (owner: *"untuk presets range tanggal di atas 14 hari ada 1,2,3,6 bulan, 1,2,3
// tahun"*, then *"2 bulan, 2 3 tahun hilang"*, `the-quick-ranges-are-days-then-months-then-years`) — the way a person asks
// about a longer stretch ("the last three months"), counted on the CALENDAR, not as 30-day blocks: on 15 Oct, 3 months
// starts on 16 Jul. A list's default window is the last month (`LAST_MONTH`).
type QuickRange = { days: number; months?: undefined } | { months: number; days?: undefined };

const QUICK_RANGES: QuickRange[] = [
  { days: 1 },
  { days: 7 },
  { days: 14 },
  { months: 1 },
  { months: 3 },
  { months: 6 },
  { months: 12 },
];

/** The window a dated screen opens on — the last month (owner: *"default 1 bulan"*). */
export const LAST_MONTH: DateRange = { kind: "relative", months: 1 };

/**
 * Resolve a {@link DateRange} to a unix-seconds window for an RPC. `0n` is an OPEN end on either
 * side. A relative range ends at the END of today. By days it starts at the START of the day `days-1` back; by
 * months, the day AFTER the same date `months` back — so "Last 1 month" on 15 Oct is 16 Sep – 15 Oct, a month
 * of whole days the way "Last 7 days" is seven.
 *
 * IN JAKARTA DAYS (backlog #37, the-system-runs-on-jakarta-time): today is Jakarta's today and the bounds are
 * 00:00 / 23:59:59 WIB, whatever the viewer's clock — the lists filtering on these instants (orders, restocks, returns,
 * the pick queue, batches) cut the same days as the server's reports. A screen whose RPC takes `yyyy-mm-dd` days
 * reads them with `jakartaWindowOf` (lib/jakartaDay.ts) instead.
 */
export function resolveRange(range: DateRange, now: Date = new Date()): { fromUnix: bigint; toUnix: bigint } {
  return jakartaUnixWindowOf(range, now);
}

/** A relative window's name — "Today", "Last 7 days", "Last 3 months", "Last 1 year". */
export function relativeLabel(range: QuickRange, t: (key: string, opts?: Record<string, unknown>) => string): string {
  if (range.months !== undefined) {
    return range.months % 12 === 0
      ? t("dateRange.lastNYears", { count: range.months / 12 })
      : t("dateRange.lastNMonths", { count: range.months });
  }
  return range.days === 1 ? t("dateRange.today") : t("dateRange.lastNDays", { count: range.days });
}

/** True when the range selects everything — no bound on either side. */
export function isAllDates(range: DateRange): boolean {
  return range.kind === "absolute" && !range.from && !range.to;
}

export const description =
  "Grafana-style date range picker (#224): a Popover with quick relative ranges (\"Last 7 days\" up to two weeks, then 1, 3 and 6 months and 1 year, counted on the calendar — live/rolling) beside an absolute From–To picked on a month-grid RangeCalendar. Emits a DateRange union — a relative range stays live because it stores the day count, not resolved dates. `resolveRange(value)` turns it into a unix-seconds {fromUnix,toUnix} window. Pass `fields` and the panel opens on a Date row of radio pills (e.g. Created vs Arrived) above the two panes, and the trigger reads \"Arrived · Last 7 days\" — one control, one panel, picks BOTH which timestamp and which window. Picking a date type keeps the panel open.";

/** One selectable date type for the panel's Date row — e.g. `{ value: ARRIVED, label: "Arrived" }`. */
export interface DateField<T extends string | number = string> {
  value: T;
  /** Already-localised label — the picker does not translate it. */
  label: string;
  /** A ⚠ after the label — a date the screen offers but cannot filter on yet (`features/pending`). */
  mark?: ReactNode;
}

export interface DateRangePickerProps<T extends string | number = string> {
  value: DateRange;
  onChange: (value: DateRange) => void;
  /**
   * Optional date types. When present, the panel opens on a Date row that picks WHICH timestamp the
   * window filters on (`field`/`onFieldChange`), and the trigger names it. One field is shown, not
   * offered — it only says which date the window means. Omit for a plain, date-only picker.
   */
  fields?: DateField<T>[];
  field?: T;
  onFieldChange?: (value: T) => void;
  disabled?: boolean;
  testId?: string;
}

// DateRangePicker is the shared, Grafana-shaped date filter (#224). The trigger reads back the
// current window; opening it reveals the two ways to set one — a live relative shortcut, or an
// explicit From/To — side by side. It emits a DateRange and lets the caller `resolveRange` it.
//
// Optionally it also carries the DATE TYPE (#225): pass `fields` and the panel opens on a row of radio pills
// choosing which timestamp the window means (Created, Arrived, …).
//
// THE DATE TYPE IS INSIDE THE PANEL (owner: *"apa bisa dijadikan 1 dengan panel"*, `a-date-type-is-picked-inside-the-range-panel`)
// — it was a Menu segment fused to the trigger's left, a second popover beside the first. A date type and a window are
// one question ("which orders went to the courier last month"), so they are answered in one panel: the type first, the
// window under it. Picking a type does NOT close the panel — the window is the next thing to answer. The trigger names
// both, "Handed over · Last 1 month", so the choice is readable without opening it.
//
// The field is kept SEPARATE from DateRange (it is "which column", not "which window"), so `resolveRange` is unchanged.
export function DateRangePicker<T extends string | number = string>({
  value,
  onChange,
  fields,
  field,
  onFieldChange,
  disabled,
  testId,
}: DateRangePickerProps<T>) {
  const { t, i18n } = useTranslation();
  const [open, setOpen] = useState(false);
  // A PHONE GETS THE PANEL STACKED, AT THE SCREEN'S WIDTH (owner: *"ternyata yang tanggal kepotong di mobile"*,
  // a-date-range-panel-fits-a-phone) — the two panes side by side are ~29rem, wider than a phone, so the quick ranges and
  // the date types ran off its right edge. A JS breakpoint, as FilterBar's, so one layout mounts.
  const phone = useBreakpointValue({ base: true, md: false }) ?? false;
  // The absolute pane is a draft: typing in From/To must not fire onChange on every keystroke; it
  // commits on Apply.
  const [draftFrom, setDraftFrom] = useState(value.kind === "absolute" ? value.from : "");
  const [draftTo, setDraftTo] = useState(value.kind === "absolute" ? value.to : "");

  const fmt = (iso: string) => {
    const d = parseLocalDate(iso);
    return d
      ? d.toLocaleDateString(i18n.language, { day: "numeric", month: "short", year: "numeric" })
      : "";
  };

  // The date type in force — the one passed, or the first when none is.
  const chosen = fields && fields.length > 0 ? (fields.find((f) => f.value === field) ?? fields[0]) : undefined;

  function triggerLabel(): string {
    if (value.kind === "relative") {
      return relativeLabel(value, t);
    }
    const from = fmt(value.from);
    const to = fmt(value.to);
    if (from && to) return `${from} – ${to}`;
    if (from) return t("dateRange.fromOnly", { date: from });
    if (to) return t("dateRange.toOnly", { date: to });
    return t("dateRange.all");
  }

  // A readout of the in-progress calendar selection, shown beside the pane title. `""` on a side is an
  // open end; nothing chosen yet reads as "All dates".
  function draftLabel(): string {
    const from = fmt(draftFrom);
    const to = fmt(draftTo);
    if (from && to) return `${from} – ${to}`;
    if (from) return t("dateRange.fromOnly", { date: from });
    if (to) return t("dateRange.toOnly", { date: to });
    return t("dateRange.all");
  }

  function pickRelative(range: QuickRange) {
    onChange(range.months !== undefined ? { kind: "relative", months: range.months } : { kind: "relative", days: range.days });
    setOpen(false);
  }

  function applyAbsolute() {
    onChange({ kind: "absolute", from: draftFrom, to: draftTo });
    setOpen(false);
  }

  function openChange(next: boolean) {
    // Re-seed the draft from the committed value each time the pane opens, so a cancelled edit does
    // not leak into the next open.
    if (next) {
      setDraftFrom(value.kind === "absolute" ? value.from : "");
      setDraftTo(value.kind === "absolute" ? value.to : "");
    }
    setOpen(next);
  }

  // The quick relative ranges — a live window that keeps meaning "the last N days" (or months, or years) — and the clear
  // back to no bound. A column of buttons beside the calendar; on a phone a wrapped row over it.
  const quickButtons = (
    <>
      {QUICK_RANGES.map((range) => {
        const active =
          value.kind === "relative" &&
          (range.months !== undefined ? value.months === range.months : value.days === range.days);
        // `7` for days, `3m` for months — a test id per preset.
        const key = range.months !== undefined ? `${range.months}m` : String(range.days);
        return (
          <Button
            key={key}
            variant={phone ? (active ? "subtle" : "outline") : active ? "subtle" : "ghost"}
            colorPalette={active ? "brand" : "gray"}
            justifyContent="start"
            size="sm"
            onClick={() => pickRelative(range)}
            data-testid={testId ? `${testId}-quick-${key}` : undefined}
          >
            {relativeLabel(range, t)}
          </Button>
        );
      })}
      {/* Clear back to an unbounded window — a filter must be able to return to "no bound". */}
      {!isAllDates(value) ? (
        <Button
          variant="ghost"
          colorPalette="gray"
          justifyContent="start"
          size="sm"
          mt={phone ? undefined : "1"}
          color="fg.muted"
          onClick={() => {
            onChange(ALL_DATES);
            setOpen(false);
          }}
          data-testid={testId ? `${testId}-clear` : undefined}
        >
          <Icon as={X} boxSize="4" />
          {t("dateRange.clear")}
        </Button>
      ) : null}
    </>
  );

  // The absolute pane — a calendar range, committed on Apply.
  const absolutePane = (
    <>
      <Flex align="baseline" justify="space-between" gap="3">
        <Text fontWeight="semibold" fontSize="sm">
          {t("dateRange.absolute")}
        </Text>
        <Text fontSize="xs" color="fg.muted" truncate>
          {draftLabel()}
        </Text>
      </Flex>
      <RangeCalendar
        from={draftFrom}
        to={draftTo}
        onChange={(from, to) => {
          setDraftFrom(from);
          setDraftTo(to);
        }}
        testId={testId}
      />
      <Button colorPalette="brand" onClick={applyAbsolute} data-testid={testId ? `${testId}-apply` : undefined}>
        {t("dateRange.apply")}
      </Button>
    </>
  );

  return (
    <Popover.Root
      open={open}
      onOpenChange={(e) => openChange(e.open)}
      positioning={{ placement: "bottom-start" }}
    >
      <Popover.Trigger asChild>
        <Button variant="outline" disabled={disabled} data-testid={testId} minW="52" justifyContent="start">
          <Icon as={Calendar} boxSize="4" />
          <Text truncate>
            {chosen ? (
              <Box as="span" color="fg.muted" data-testid={testId ? `${testId}-field-label` : undefined}>
                {chosen.label} ·{" "}
              </Box>
            ) : null}
            {triggerLabel()}
          </Text>
          <Icon as={ChevronDown} boxSize="4" ml="auto" color="fg.muted" />
        </Button>
      </Popover.Trigger>

      {/* Portalled so the panel escapes any clipping/stacking ancestor — an overflow container or a
          table below it would otherwise crop the calendar (a filter popover renders above content). */}
      <Portal>
      <Popover.Positioner>
        <Popover.Content
          // On a phone: the screen's width less its gutters, and no taller than the room the panel has — it scrolls
          // inside rather than off the screen.
          width={phone ? "calc(100vw - 1.5rem)" : "auto"}
          maxH={phone ? "var(--available-height)" : undefined}
          overflowY={phone ? "auto" : undefined}
          data-testid={testId ? `${testId}-panel` : undefined}
        >
          <Popover.Body p="0">
            {chosen && fields ? (
              // THE DATE ROW — over both panes, answered first. `w="0" minW="full"` keeps the pills from widening the
              // panel: they wrap inside the width the two panes give it, however many types a screen offers.
              <Stack gap="2" p="card" w="0" minW="full" borderBottomWidth="1px" borderColor="border">
                <Text fontWeight="semibold" fontSize="sm">
                  {t("dateRange.field")}
                </Text>
                {fields.length > 1 ? (
                  <RadioPills
                    value={String(chosen.value)}
                    onChange={(next) => {
                      const picked = fields.find((f) => String(f.value) === next);
                      if (picked) onFieldChange?.(picked.value);
                    }}
                    options={fields.map((f) => ({
                      value: String(f.value),
                      label: f.label,
                      mark: f.mark,
                      testId: testId ? `${testId}-field-${String(f.value)}` : undefined,
                    }))}
                    ariaLabel={t("dateRange.field")}
                    testId={testId ? `${testId}-field` : undefined}
                  />
                ) : (
                  // One date is SHOWN, not offered — a single radio is a choice with no alternative.
                  <Text fontSize="sm" data-testid={testId ? `${testId}-field` : undefined}>
                    {chosen.label}
                  </Text>
                )}
              </Stack>
            ) : null}
            {phone ? (
              // A PHONE: the quick ranges first — one tap, the common answer — wrapped in a row, the calendar under them.
              <Stack gap="0">
                <Stack gap="2" p="card" borderBottomWidth="1px" borderColor="border">
                  <Text fontWeight="semibold" fontSize="sm">
                    {t("dateRange.quick")}
                  </Text>
                  <Flex wrap="wrap" gap="2">
                    {quickButtons}
                  </Flex>
                </Stack>
                <Stack gap="card" p="card">
                  {absolutePane}
                </Stack>
              </Stack>
            ) : (
              <Flex align="stretch">
                <Stack gap="card" p="card" minW="72" borderRightWidth="1px" borderColor="border">
                  {absolutePane}
                </Stack>
                <Stack gap="1" p="card" minW="44">
                  <Text fontWeight="semibold" fontSize="sm" mb="1">
                    {t("dateRange.quick")}
                  </Text>
                  {quickButtons}
                </Stack>
              </Flex>
            )}
          </Popover.Body>
        </Popover.Content>
      </Popover.Positioner>
      </Portal>
    </Popover.Root>
  );
}
