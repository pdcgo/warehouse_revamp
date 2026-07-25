import { useState } from "react";
import { Button, Field, Flex, Icon, Input, Popover, Stack, Text } from "@chakra-ui/react";
import { useTranslation } from "react-i18next";
import { Clock, ChevronDown, X } from "lucide-react";
import { parseLocalDateTime, unixSeconds } from "../lib/datetime";

/**
 * A datetime range, the full Grafana control — DateRangePicker with time-of-day, so its quick ranges
 * reach down to MINUTES ("Last 5 minutes").
 *   - RELATIVE — "the last N minutes, ending now". Stored as the minute count, so it stays live.
 *   - ABSOLUTE — explicit `from`/`to` as `yyyy-mm-ddThh:mm` (local). `""` is an OPEN end.
 */
export type DateTimeRange =
  | { kind: "relative"; minutes: number }
  | { kind: "absolute"; from: string; to: string };

/** The empty filter: no lower and no upper bound. */
export const ALL_TIMES: DateTimeRange = { kind: "absolute", from: "", to: "" };

const MIN = 1;
const HOUR = 60;
const DAY = 24 * 60;

// The quick relative ranges, Grafana's ladder from minutes to days.
const QUICK_RANGES: { minutes: number }[] = [
  { minutes: 5 * MIN },
  { minutes: 15 * MIN },
  { minutes: 30 * MIN },
  { minutes: 1 * HOUR },
  { minutes: 3 * HOUR },
  { minutes: 6 * HOUR },
  { minutes: 12 * HOUR },
  { minutes: 24 * HOUR },
  { minutes: 2 * DAY },
  { minutes: 7 * DAY },
  { minutes: 30 * DAY },
];

/**
 * Resolve a {@link DateTimeRange} to a unix-seconds window. `0n` is an OPEN end. A relative range
 * ends at `now` and starts N minutes before it.
 */
export function resolveRange(range: DateTimeRange, now: Date = new Date()): { fromUnix: bigint; toUnix: bigint } {
  if (range.kind === "relative") {
    const from = new Date(now.getTime() - range.minutes * 60_000);
    return { fromUnix: unixSeconds(from), toUnix: unixSeconds(now) };
  }
  const from = parseLocalDateTime(range.from);
  const to = parseLocalDateTime(range.to);
  return {
    fromUnix: from ? unixSeconds(from) : 0n,
    toUnix: to ? unixSeconds(to) : 0n,
  };
}

/** True when the range selects everything — no bound on either side. */
export function isAllTimes(range: DateTimeRange): boolean {
  return range.kind === "absolute" && !range.from && !range.to;
}

/** Humanise a minute count as the largest whole unit — 5 → "5 minutes", 360 → "6 hours". */
export function relativeLabel(minutes: number, t: (k: string, o?: Record<string, unknown>) => string): string {
  if (minutes % DAY === 0) return t("dateTimeRange.lastDays", { count: minutes / DAY });
  if (minutes % HOUR === 0) return t("dateTimeRange.lastHours", { count: minutes / HOUR });
  return t("dateTimeRange.lastMinutes", { count: minutes });
}

export const description =
  "Grafana-style datetime range picker: a Popover with quick relative ranges down to minutes (\"Last 5 minutes\", \"Last 6 hours\") beside an absolute From–To with time-of-day (Chakra Input type=\"datetime-local\"). Emits a DateTimeRange union; a relative range stays live because it stores the minute count. `resolveRange(value)` → a unix-seconds {fromUnix,toUnix} window. The date-only sibling is DateRangePicker.";

export interface DateTimeRangePickerProps {
  value: DateTimeRange;
  onChange: (value: DateTimeRange) => void;
  disabled?: boolean;
  testId?: string;
}

// DateTimeRangePicker is the shared, Grafana-shaped datetime filter — the same two ways to set a
// window as DateRangePicker (a live relative shortcut or an explicit From/To), but at minute
// resolution with time-of-day. It emits a DateTimeRange and leaves `resolveRange` to the caller.
export function DateTimeRangePicker({ value, onChange, disabled, testId }: DateTimeRangePickerProps) {
  const { t, i18n } = useTranslation();
  const [open, setOpen] = useState(false);
  const [draftFrom, setDraftFrom] = useState(value.kind === "absolute" ? value.from : "");
  const [draftTo, setDraftTo] = useState(value.kind === "absolute" ? value.to : "");

  const fmt = (iso: string) => {
    const d = parseLocalDateTime(iso);
    return d
      ? d.toLocaleString(i18n.language, {
          day: "numeric",
          month: "short",
          year: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        })
      : "";
  };

  function triggerLabel(): string {
    if (value.kind === "relative") return relativeLabel(value.minutes, t);
    const from = fmt(value.from);
    const to = fmt(value.to);
    if (from && to) return `${from} – ${to}`;
    if (from) return t("dateTimeRange.fromOnly", { date: from });
    if (to) return t("dateTimeRange.toOnly", { date: to });
    return t("dateTimeRange.all");
  }

  function pickRelative(minutes: number) {
    onChange({ kind: "relative", minutes });
    setOpen(false);
  }

  function applyAbsolute() {
    onChange({ kind: "absolute", from: draftFrom, to: draftTo });
    setOpen(false);
  }

  function openChange(next: boolean) {
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
      <Popover.Trigger asChild>
        <Button variant="outline" disabled={disabled} data-testid={testId} minW="60" justifyContent="start">
          <Icon as={Clock} boxSize="4" />
          <Text truncate>{triggerLabel()}</Text>
          <Icon as={ChevronDown} boxSize="4" ml="auto" color="fg.muted" />
        </Button>
      </Popover.Trigger>

      <Popover.Positioner>
        <Popover.Content width="auto">
          <Popover.Body p="0">
            <Flex align="stretch">
              {/* Absolute pane — an explicit window with time-of-day, committed on Apply. */}
              <Stack gap="card" p="card" minW="64" borderRightWidth="1px" borderColor="border">
                <Text fontWeight="semibold" fontSize="sm">
                  {t("dateTimeRange.absolute")}
                </Text>
                <Field.Root>
                  <Field.Label>{t("dateTimeRange.from")}</Field.Label>
                  <Input
                    type="datetime-local"
                    value={draftFrom}
                    max={draftTo || undefined}
                    data-testid={testId ? `${testId}-from` : undefined}
                    onChange={(e) => setDraftFrom(e.target.value)}
                  />
                </Field.Root>
                <Field.Root>
                  <Field.Label>{t("dateTimeRange.to")}</Field.Label>
                  <Input
                    type="datetime-local"
                    value={draftTo}
                    min={draftFrom || undefined}
                    data-testid={testId ? `${testId}-to` : undefined}
                    onChange={(e) => setDraftTo(e.target.value)}
                  />
                </Field.Root>
                <Button
                  colorPalette="brand"
                  onClick={applyAbsolute}
                  data-testid={testId ? `${testId}-apply` : undefined}
                >
                  {t("dateTimeRange.apply")}
                </Button>
              </Stack>

              {/* Quick relative pane — a live window; the list scrolls because it runs minutes→days. */}
              <Stack gap="1" p="card" minW="48" maxH="72" overflowY="auto">
                <Text fontWeight="semibold" fontSize="sm" mb="1">
                  {t("dateTimeRange.quick")}
                </Text>
                {QUICK_RANGES.map(({ minutes }) => {
                  const active = value.kind === "relative" && value.minutes === minutes;
                  return (
                    <Button
                      key={minutes}
                      variant={active ? "subtle" : "ghost"}
                      colorPalette={active ? "brand" : "gray"}
                      justifyContent="start"
                      size="sm"
                      onClick={() => pickRelative(minutes)}
                      data-testid={testId ? `${testId}-quick-${minutes}` : undefined}
                    >
                      {relativeLabel(minutes, t)}
                    </Button>
                  );
                })}
                {/* Clear back to an unbounded window — a filter must be able to return to "no bound". */}
                {!isAllTimes(value) ? (
                  <Button
                    variant="ghost"
                    colorPalette="gray"
                    justifyContent="start"
                    size="sm"
                    mt="1"
                    color="fg.muted"
                    onClick={() => {
                      onChange(ALL_TIMES);
                      setOpen(false);
                    }}
                    data-testid={testId ? `${testId}-clear` : undefined}
                  >
                    <Icon as={X} boxSize="4" />
                    {t("dateTimeRange.clear")}
                  </Button>
                ) : null}
              </Stack>
            </Flex>
          </Popover.Body>
        </Popover.Content>
      </Popover.Positioner>
    </Popover.Root>
  );
}
