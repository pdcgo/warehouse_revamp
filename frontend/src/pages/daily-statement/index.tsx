import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Badge, Checkbox, Flex, Heading, Icon, Spacer, Spinner, Stack, Text } from "@chakra-ui/react";
import { TriangleAlert } from "lucide-react";

import { rpcError } from "../../api/clients";
import { ExpenseKind } from "../../gen/warehouse/expense/v1/expense_pb";
import { TeamType } from "../../gen/warehouse/team/v1/team_pb";
import { ExpenseKindSelect } from "../../components/pickers/ExpenseKindSelect";
import { DateRangePicker, resolveRange } from "../../components/datetime/DateRangePicker";
import type { DateRange } from "../../components/datetime/DateRangePicker";
import { PeriodGrainPicker } from "../../components/datetime/PeriodGrainPicker";
import { RefreshOverlay } from "../../components/feedback/RefreshOverlay";
import { toDateInputValue } from "../../lib/datetime";
import { MAX_PERIOD_DAYS, bucketSpine, spanDays } from "../../lib/period";
import type { PeriodGrain } from "../../lib/period";
import { useTeam } from "../../features/team/TeamContext";
import { useDailyStatement } from "./queries";
import { StatementSummary } from "./components/StatementSummary";
import { StatementTable } from "./components/StatementTable";

// THE WINDOW EACH GRAIN OPENS ON, and it is not the same window three times.
//
// A grain is only readable with enough buckets in front of it: 30 days of days is a statement, and 30
// days of MONTHS is one row. So switching the grain re-picks the window rather than keeping the last
// one — the alternative is somebody clicking Monthly, getting a single row, and concluding the screen
// is broken. The picker is right beside it if they want a different period.
//
//   day     a rolling 30 days       — always a readable statement, on the 2nd of the month included
//   month   the last 12 months      — the first of them whole, so a year is twelve comparable rows
//   year    this year to date       — see the cap below
//
// ⚠ THE YEARLY WINDOW IS PINNED BY THE 366-DAY CAP, not chosen. The three RPCs return DAILY rows and
// refuse a span longer than a leap year, so a yearly view can hold at most one year — and "last year
// and this one" is not a range this screen is allowed to ask for. It shows year-to-date and says so.
// Lifting that means giving the RPCs a grain of their own, which is a contract change.
function defaultRangeFor(grain: PeriodGrain): DateRange {
  const now = new Date();

  if (grain === "month") {
    // The 1st of the month eleven back — twelve calendar months, which is 365 or 366 days and so
    // never trips the cap.
    return {
      kind: "absolute",
      from: toDateInputValue(new Date(now.getFullYear(), now.getMonth() - 11, 1)),
      to: toDateInputValue(now),
    };
  }

  if (grain === "year") {
    return {
      kind: "absolute",
      from: toDateInputValue(new Date(now.getFullYear(), 0, 1)),
      to: toDateInputValue(now),
    };
  }

  // A month would have matched the other three money screens, and it is deliberately NOT one: those
  // screens answer "how did July do", which is a question about a closed period, while this one answers
  // "how are we doing", which is a question about the recent past. On the 2nd of the month a month-scoped
  // statement is two rows. A rolling 30 days is always a readable statement.
  return { kind: "relative", days: 30 };
}

// A DateRange → the `yyyy-mm-dd` pair both Daily RPCs filter on.
//
// It goes through `resolveRange` rather than reading `range.from`/`range.to` directly, because a
// RELATIVE range ("last 30 days") has no dates on it at all — it stores the COUNT so the window stays
// live. Resolving is what turns it into today's actual 30 days.
//
// The unix instants come back in LOCAL time (that is `resolveRange`'s whole contract), so they are
// formatted back with the local formatter. Going via toISOString here would shift the boundary by seven
// hours in Indonesia and quietly ask the server for a window one day off the one the picker shows.
function rangeDates(range: DateRange): { from: string; to: string } {
  const { fromUnix, toUnix } = resolveRange(range);

  return {
    from: fromUnix > 0n ? toDateInputValue(new Date(Number(fromUnix) * 1000)) : "",
    to: toUnix > 0n ? toDateInputValue(new Date(Number(toUnix) * 1000)) : "",
  };
}

// DailyStatementPage — the money, period by period.
//
// Revenue, Expenses and Profit each answer "what did this MONTH do". None of them answers "which DAY
// did it", and that is the question somebody actually has: a month is not a thing that goes wrong, a
// Tuesday is. This screen is one row per period — what came in, what went out, what was left, and a
// running total across the whole of it, which is what makes it a statement rather than a table of days.
//
// IT READS AT THREE GRAINS, and they are three questions rather than three zoom levels:
//
//   daily     which Tuesday went wrong           — the reason this screen exists
//   monthly   whether the quarter is turning     — twelve comparable rows, at a glance
//   yearly    whether the business is bigger     — currently one year at a time (see `defaultRangeFor`)
//
// The grain is a ROLLUP of the same daily fetch (see `mergeBuckets`), not a different request, so every
// rule below — the spine, the subtraction, the server-owned footer — holds identically at all three.
//
// IT IS THE WAREHOUSE'S MONEY SCREEN: the handling fees it charged, less its expenses — and a
// warehouse's written-off stock is already an expense on its own team (#211), so the two sides need
// no branch.
//
// ⚠ It served a SELLING team too, reading expected margin from `revenue_service` (owner, 2026-08-14).
// That service was removed and its statistics deferred, so the selling half is gone until they are
// rebuilt. The page now refuses a non-warehouse team rather than showing it a subtraction with no
// income in it, which would report every day as a pure loss.
export function DailyStatementPage() {
  const { current } = useTeam();
  const { t } = useTranslation();

  const [grain, setGrain] = useState<PeriodGrain>("day");
  const [range, setRange] = useState<DateRange>(() => defaultRangeFor("day"));
  const [kind, setKind] = useState<ExpenseKind>(ExpenseKind.UNSPECIFIED);
  // Quiet periods are SHOWN by default — see the note in `mergeBuckets`. The toggle exists for a long
  // range over a young team, where the signal is a handful of rows in three hundred.
  const [hideQuiet, setHideQuiet] = useState(false);

  // Changing the grain re-picks the window with it. See `defaultRangeFor` — a grain kept over the
  // previous grain's window is how Monthly ends up showing one row.
  const pickGrain = (next: PeriodGrain) => {
    setGrain(next);
    setRange(defaultRangeFor(next));
  };

  const teamId = current?.teamId;
  // ONE MODE while the selling half is deferred. Kept as a named constant rather than inlined so the
  // seam stays visible: `StatementMode` is a one-member union for the same reason.
  const mode = "warehouse" as const;
  const servesThisTeam = current?.teamType === TeamType.WAREHOUSE;

  const { from, to } = rangeDates(range);
  const span = spanDays(from, to);

  // The SAME bound the server enforces, checked here first — and it is a bound in DAYS at every grain,
  // because the series underneath is daily whatever the table shows.
  //
  // Refused rather than clamped, and that is the same call the handler makes: silently trimming a
  // ten-year pick to its last year would answer a question nobody asked, with a total that looks like
  // the one they wanted. The picker keeps showing what was chosen and the screen says why it is not
  // loading, so the fix is obvious.
  const valid = span > 0 && span <= MAX_PERIOD_DAYS;

  // How many BUCKETS the window covers — the divisor for the per-period average, and the denominator
  // the row count is read against. Computed from the same spine the rows are laid on, so the header
  // and the table cannot disagree about how long the period is.
  const buckets = valid ? bucketSpine(from, to, grain).length : 0;

  const query = useDailyStatement({ teamId, mode, grain, from, to, kind, valid });

  const statement = query.data;
  const all = statement?.rows ?? [];
  const rows = hideQuiet ? all.filter((r) => r.active) : all;
  const error = query.isError ? rpcError(query.error) : "";

  // "day" / "days" / "bulan" — the grain's noun, agreeing with a count. See the same helper in
  // StatementSummary: one interpolated word rather than three copies of every sentence.
  const unit = (count: number) => t(`statement.unit.${grain}`, { count });

  if (!current) {
    return (
      <Stack gap="section">
        <Heading size="md">{t("statement.title")}</Heading>
        <Text color="fg.muted" data-testid="statement-no-team">
          {t("statement.selectTeam")}
        </Text>
      </Stack>
    );
  }

  return (
    <Stack gap="section">
      <Flex align="center" gap="card" wrap="wrap">
        <Heading size="md">{t("statement.title")}</Heading>
        <Badge colorPalette="brand">{current.teamName}</Badge>
        <Spacer />

        {/* FIRST in the bar, because it is the control that decides what the other two mean: a kind
            filter and a window are read differently over months than over days. */}
        <PeriodGrainPicker value={grain} onChange={pickGrain} testId="statement-grain" />

        {/* The kind filter narrows the EXPENSE column only — revenue has no kinds. Worth having:
            "which days did we spend the ads budget" is a question this table can answer directly. */}
        <ExpenseKindSelect value={kind} onChange={setKind} filter testId="statement-kind" />

        <DateRangePicker value={range} onChange={setRange} testId="statement-range" />
      </Flex>

      {/* ⚠ A NON-WAREHOUSE TEAM IS TOLD, not shown zeroes. Its income column came from
          `revenue_service`, which has been removed with its statistics deferred — so the subtraction
          would have real expenses and no income, and report every single day as a pure loss. */}
      {!servesThisTeam && (
        <Flex align="center" gap="2" color="fg.muted" data-testid="statement-not-available">
          <Icon as={TriangleAlert} boxSize="4" />
          <Text fontSize="sm">{t("statement.notAvailable")}</Text>
        </Flex>
      )}

      {/* ⚠ SAID OUT LOUD, because the alternative is a one-row table that looks like a bug. The series
          behind this screen is DAILY and capped at a leap year, so a yearly view cannot reach back to
          last year for comparison — which is the only thing anybody wants a yearly row for. Naming the
          limit is the honest version of shipping it; lifting it is a contract change (see queries.ts). */}
      {grain === "year" && valid && (
        <Flex align="center" gap="2" color="orange.fg" data-testid="statement-grain-capped">
          <Icon as={TriangleAlert} boxSize="4" />
          <Text fontSize="sm">{t("statement.grainCapped", { max: MAX_PERIOD_DAYS })}</Text>
        </Flex>
      )}

      {!valid && (
        <Flex align="center" gap="2" color="orange.fg" data-testid="statement-range-invalid">
          <Icon as={TriangleAlert} boxSize="4" />
          <Text fontSize="sm">
            {span === 0
              ? t("statement.rangeUnbounded")
              : t("statement.rangeTooLong", { max: MAX_PERIOD_DAYS, days: span })}
          </Text>
        </Flex>
      )}

      {error && (
        <Text color="red.fg" data-testid="statement-error">
          {error}
        </Text>
      )}

      {valid && !error && (
        <>
          <StatementSummary
            mode={mode}
            grain={grain}
            income={statement?.income ?? 0n}
            liability={statement?.liability}
            expenses={statement?.expenses}
            buckets={buckets}
            loading={query.isPending}
          />

          <Flex align="center" gap="card">
            <Checkbox.Root
              checked={hideQuiet}
              onCheckedChange={(e) => setHideQuiet(!!e.checked)}
              data-testid="statement-hide-quiet"
            >
              <Checkbox.HiddenInput />
              <Checkbox.Control />
              {/* The unit travels through the copy rather than being three sentences: "Hide months with
                  no activity" is the same rule as the daily one, and writing it three times is three
                  chances for one of them to say something slightly different. */}
              <Checkbox.Label>{t("statement.hideQuiet", { unit: unit(all.length) })}</Checkbox.Label>
            </Checkbox.Root>

            <Spacer />

            {/* Kept as `statement-day-count` at every grain: it is the row counter, and renaming it per
                grain would give one number three testids for no reader's benefit. */}
            <Text fontSize="sm" color="fg.muted" data-testid="statement-day-count">
              {t("statement.dayCount", {
                shown: rows.length,
                total: all.length,
                unit: unit(all.length),
              })}
            </Text>
          </Flex>

          {query.isPending ? (
            <Spinner colorPalette="brand" />
          ) : (
            // `isPending` is excluded from `busy` — a genuine first load has no rows to keep, and the
            // spinner above is already answering that wait.
            <RefreshOverlay busy={query.isFetching && !query.isPending}>
              <StatementTable
                mode={mode}
                grain={grain}
                rows={rows}
                income={statement?.income ?? 0n}
                liability={statement?.liability}
                expenses={statement?.expenses}
              />
            </RefreshOverlay>
          )}
        </>
      )}
    </Stack>
  );
}
