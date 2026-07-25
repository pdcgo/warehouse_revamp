import { useState } from "react";
import { Box, Button, Flex, Icon, Menu, Popover, Portal, Stack, Text } from "@chakra-ui/react";
import { useTranslation } from "react-i18next";
import { Calendar, Check, ChevronDown, X } from "lucide-react";
import { endOfDay, parseLocalDate, startOfDay, unixSeconds } from "../lib/datetime";
import { RangeCalendar } from "./RangeCalendar";

/**
 * A date range, Grafana-style. Two shapes, one union:
 *   - RELATIVE — "the last N days, ending today". It is stored as the NUMBER N, not resolved
 *     dates, so the window stays live: reopen the screen tomorrow and "Last 7 days" still means
 *     the last 7 days, not the 7 days that were current when it was picked.
 *   - ABSOLUTE — an explicit `from`/`to` as `yyyy-mm-dd`. `""` on either side is an OPEN end, so
 *     `{from:"",to:""}` means "all dates".
 *
 * The picker emits this value; a caller turns it into a unix window with `resolveRange`.
 */
export type DateRange =
  | { kind: "relative"; days: number }
  | { kind: "absolute"; from: string; to: string };

/** The empty filter: no lower and no upper bound. */
export const ALL_DATES: DateRange = { kind: "absolute", from: "", to: "" };

// The quick relative ranges, in Grafana's order (widening windows). "Today" is just N=1.
const QUICK_RANGES: { days: number; key: string }[] = [
  { days: 1, key: "today" },
  { days: 7, key: "last7" },
  { days: 14, key: "last14" },
  { days: 30, key: "last30" },
  { days: 90, key: "last90" },
];

/**
 * Resolve a {@link DateRange} to a unix-seconds window for an RPC. `0n` is an OPEN end on either
 * side. A relative range ends at the END of today and starts at the START of the day `days-1` back.
 */
export function resolveRange(range: DateRange, now: Date = new Date()): { fromUnix: bigint; toUnix: bigint } {
  if (range.kind === "relative") {
    const from = startOfDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() - (range.days - 1)));
    return { fromUnix: unixSeconds(from), toUnix: unixSeconds(endOfDay(now)) };
  }
  const from = parseLocalDate(range.from);
  const to = parseLocalDate(range.to);
  return {
    fromUnix: from ? unixSeconds(startOfDay(from)) : 0n,
    toUnix: to ? unixSeconds(endOfDay(to)) : 0n,
  };
}

/** True when the range selects everything — no bound on either side. */
export function isAllDates(range: DateRange): boolean {
  return range.kind === "absolute" && !range.from && !range.to;
}

export const description =
  "Grafana-style date range picker (#224): a Popover with quick relative ranges (\"Last 7 days\", live/rolling) beside an absolute From–To picked on a month-grid RangeCalendar. Emits a DateRange union — a relative range stays live because it stores the day count, not resolved dates. `resolveRange(value)` turns it into a unix-seconds {fromUnix,toUnix} window. Pass `fields` to prepend a time-type segment to the trigger (e.g. Created vs Arrived), so one control picks BOTH which timestamp and which window.";

/** One selectable time-type for the trigger's field segment — e.g. `{ value: ARRIVED, label: "Arrived" }`. */
export interface DateField<T extends string | number = string> {
  value: T;
  /** Already-localised label — the picker does not translate it. */
  label: string;
}

export interface DateRangePickerProps<T extends string | number = string> {
  value: DateRange;
  onChange: (value: DateRange) => void;
  /**
   * Optional time-type choices. When present, the trigger grows a leading segment that picks WHICH
   * timestamp the window filters on (`field`/`onFieldChange`). Omit for a plain, date-only picker.
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
// Optionally it also carries the TIME-TYPE (#225): pass `fields` and the trigger prepends a menu
// segment choosing which timestamp the window means (Created, Arrived, …). That segment is its own
// Menu — clicking it never opens the range popover. The field is kept SEPARATE from DateRange (it is
// "which column", not "which window"), so `resolveRange` is unchanged.
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

  function triggerLabel(): string {
    if (value.kind === "relative") {
      return value.days === 1 ? t("dateRange.today") : t("dateRange.lastNDays", { count: value.days });
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

  function pickRelative(days: number) {
    onChange({ kind: "relative", days });
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

  return (
    <Popover.Root
      open={open}
      onOpenChange={(e) => openChange(e.open)}
      positioning={{ placement: "bottom-start" }}
    >
      {fields && fields.length > 0 ? (
        // Segmented trigger: [ field ▾ │ 📅 range ▾ ]. The field segment is a Menu of its own, so it
        // never opens the range popover; a divider fuses the two into one control.
        <Flex
          borderWidth="1px"
          borderColor="border"
          borderRadius="l2"
          overflow="hidden"
          align="stretch"
          opacity={disabled ? 0.6 : undefined}
        >
          <Menu.Root>
            <Menu.Trigger asChild>
              <Button
                variant="ghost"
                borderRadius="0"
                disabled={disabled}
                data-testid={testId ? `${testId}-field` : undefined}
              >
                <Text truncate>
                  {fields.find((f) => f.value === field)?.label ?? fields[0].label}
                </Text>
                <Icon as={ChevronDown} boxSize="4" color="fg.muted" />
              </Button>
            </Menu.Trigger>
            <Portal>
              <Menu.Positioner>
                <Menu.Content>
                  {fields.map((f) => (
                    <Menu.Item
                      key={String(f.value)}
                      value={String(f.value)}
                      onSelect={() => onFieldChange?.(f.value)}
                    >
                      <Icon
                        as={Check}
                        boxSize="4"
                        visibility={f.value === field ? "visible" : "hidden"}
                      />
                      {f.label}
                    </Menu.Item>
                  ))}
                </Menu.Content>
              </Menu.Positioner>
            </Portal>
          </Menu.Root>
          <Box borderRightWidth="1px" borderColor="border" />
          <Popover.Trigger asChild>
            <Button
              variant="ghost"
              borderRadius="0"
              disabled={disabled}
              data-testid={testId}
              minW="44"
              justifyContent="start"
            >
              <Icon as={Calendar} boxSize="4" />
              <Text truncate>{triggerLabel()}</Text>
              <Icon as={ChevronDown} boxSize="4" ml="auto" color="fg.muted" />
            </Button>
          </Popover.Trigger>
        </Flex>
      ) : (
        <Popover.Trigger asChild>
          <Button variant="outline" disabled={disabled} data-testid={testId} minW="52" justifyContent="start">
            <Icon as={Calendar} boxSize="4" />
            <Text truncate>{triggerLabel()}</Text>
            <Icon as={ChevronDown} boxSize="4" ml="auto" color="fg.muted" />
          </Button>
        </Popover.Trigger>
      )}

      {/* Portalled so the panel escapes any clipping/stacking ancestor — an overflow container or a
          table below it would otherwise crop the calendar (a filter popover renders above content). */}
      <Portal>
      <Popover.Positioner>
        <Popover.Content width="auto">
          <Popover.Body p="0">
            <Flex align="stretch">
              {/* Absolute pane — a calendar range, committed on Apply. */}
              <Stack gap="card" p="card" minW="72" borderRightWidth="1px" borderColor="border">
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
                <Button
                  colorPalette="brand"
                  onClick={applyAbsolute}
                  data-testid={testId ? `${testId}-apply` : undefined}
                >
                  {t("dateRange.apply")}
                </Button>
              </Stack>

              {/* Quick relative pane — a live window that keeps meaning "the last N days". */}
              <Stack gap="1" p="card" minW="44">
                <Text fontWeight="semibold" fontSize="sm" mb="1">
                  {t("dateRange.quick")}
                </Text>
                {QUICK_RANGES.map(({ days, key }) => {
                  const active = value.kind === "relative" && value.days === days;
                  return (
                    <Button
                      key={key}
                      variant={active ? "subtle" : "ghost"}
                      colorPalette={active ? "brand" : "gray"}
                      justifyContent="start"
                      size="sm"
                      onClick={() => pickRelative(days)}
                      data-testid={testId ? `${testId}-quick-${days}` : undefined}
                    >
                      {days === 1 ? t("dateRange.today") : t("dateRange.lastNDays", { count: days })}
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
                    mt="1"
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
              </Stack>
            </Flex>
          </Popover.Body>
        </Popover.Content>
      </Popover.Positioner>
      </Portal>
    </Popover.Root>
  );
}
