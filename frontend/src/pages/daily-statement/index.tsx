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
import { RefreshOverlay } from "../../components/feedback/RefreshOverlay";
import { toDateInputValue } from "../../lib/datetime";
import { MAX_PERIOD_DAYS, spanDays } from "../../lib/period";
import { useTeam } from "../../features/team/TeamContext";
import { useDailyStatement } from "./queries";
import { StatementSummary } from "./components/StatementSummary";
import { StatementTable } from "./components/StatementTable";

// The window the statement opens on.
//
// A month would have matched the other three money screens, and it is deliberately NOT one: those
// screens answer "how did July do", which is a question about a closed period, while this one answers
// "how are we doing", which is a question about the recent past. On the 2nd of the month a month-scoped
// statement is two rows. A rolling 30 days is always a readable statement.
const DEFAULT_RANGE: DateRange = { kind: "relative", days: 30 };

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

// DailyStatementPage — the money, day by day.
//
// Revenue, Expenses and Profit each answer "what did this MONTH do". None of them answers "which DAY
// did it", and that is the question somebody actually has: a month is not a thing that goes wrong, a
// Tuesday is. This screen is one row per day — what came in, what went out, what was left, and a
// running total across the period, which is what makes it a statement rather than a table of days.
//
// IT SERVES BOTH TEAM TYPES, reading a different income column for each (owner, 2026-08-14):
//
//   selling    the expected margin on its orders    (revenue_service)
//   warehouse  the handling fees it charged         (settlement_service)
//
// A warehouse has no orders, so the selling version pointed at one would show margin 0 against real
// expenses and call every day a loss. The expenses half is shared and needs no branch — a warehouse's
// written-off stock is already an expense on its own team (#211).
export function DailyStatementPage() {
  const { current } = useTeam();
  const { t } = useTranslation();

  const [range, setRange] = useState<DateRange>(DEFAULT_RANGE);
  const [kind, setKind] = useState<ExpenseKind>(ExpenseKind.UNSPECIFIED);
  // Quiet days are SHOWN by default — see the note in `mergeDays`. The toggle exists for a long range
  // over a young team, where the signal is a handful of rows in three hundred.
  const [hideQuiet, setHideQuiet] = useState(false);

  const teamId = current?.teamId;
  // ROOT falls in with SELLING rather than getting a third case. A root team has neither orders nor
  // fees, so both modes read empty for it — and the selling shape is the one its members recognise
  // from the Profit screen beside this one.
  const mode = current?.teamType === TeamType.WAREHOUSE ? "warehouse" : "selling";

  const { from, to } = rangeDates(range);
  const span = spanDays(from, to);

  // The SAME bound the server enforces, checked here first.
  //
  // Refused rather than clamped, and that is the same call the handler makes: silently trimming a
  // ten-year pick to its last year would answer a question nobody asked, with a total that looks like
  // the one they wanted. The picker keeps showing what was chosen and the screen says why it is not
  // loading, so the fix is obvious.
  const valid = span > 0 && span <= MAX_PERIOD_DAYS;

  const query = useDailyStatement({ teamId, mode, from, to, kind, valid });

  const statement = query.data;
  const days = statement?.days ?? [];
  const rows = hideQuiet ? days.filter((d) => d.active) : days;
  const error = query.isError ? rpcError(query.error) : "";

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

        {/* The kind filter narrows the EXPENSE column only — revenue has no kinds. Worth having:
            "which days did we spend the ads budget" is a question this table can answer directly. */}
        <ExpenseKindSelect value={kind} onChange={setKind} filter testId="statement-kind" />

        <DateRangePicker value={range} onChange={setRange} testId="statement-range" />
      </Flex>

      {/* Not decoration. In SELLING mode half of every subtraction below is an EXPECTATION, and an
          unlabelled money screen is read as cash in the bank. Same notice the profit screen carries —
          this one just repeats it 30 times.

          A WAREHOUSE does not get it, and that is the point of it being conditional: both sides of its
          statement are real ledger movements — fees it actually charged, stock it actually wrote off —
          so warning about an expectation would be crying wolf about the one screen here that has none. */}
      {mode === "selling" && (
        <Flex align="center" gap="2" color="fg.muted" data-testid="statement-expected-notice">
          <Icon as={TriangleAlert} boxSize="4" />
          <Text fontSize="sm">{t("statement.expectedNotice")}</Text>
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
            income={statement?.income ?? 0n}
            revenue={statement?.revenue}
            settlement={statement?.settlement}
            expenses={statement?.expenses}
            days={span}
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
              <Checkbox.Label>{t("statement.hideQuiet")}</Checkbox.Label>
            </Checkbox.Root>

            <Spacer />

            <Text fontSize="sm" color="fg.muted" data-testid="statement-day-count">
              {t("statement.dayCount", { shown: rows.length, total: days.length })}
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
                rows={rows}
                income={statement?.income ?? 0n}
                revenue={statement?.revenue}
                settlement={statement?.settlement}
                expenses={statement?.expenses}
              />
            </RefreshOverlay>
          )}
        </>
      )}
    </Stack>
  );
}
