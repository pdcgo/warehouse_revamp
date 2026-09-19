import { useState } from "react";
import type { ElementType } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import {
  Badge,
  Box,
  Checkbox,
  Flex,
  Grid,
  GridItem,
  Heading,
  Icon,
  Spacer,
  Stack,
  Text,
} from "@chakra-ui/react";
import { Check, Equal, FlaskConical, Plus, TriangleAlert } from "lucide-react";

import { DateRangePicker, type DateRange } from "../../components/datetime/DateRangePicker";
import { formatRupiah } from "../../lib/money";
import { parseLocalDate } from "../../lib/datetime";
import { BalanceCheckCard } from "./components/BalanceCheckCard";
import { BalanceSectionCard } from "./components/BalanceSectionCard";
import { check, gaps, section, sectionTotal, type BalanceSheet } from "./model";

// BalanceSheetPage — assets = liabilities + equity, at one instant.
//
// ⚠ A DESIGN MOCK, ON PURPOSE (see model.ts). It takes its whole sheet as a PROP: there is no query
// hook, no client, no route and no menu entry, because there is nothing to wire it to. This system
// has revenue, expenses, liability and inventory — it has no journal, no chart of accounts and no
// cash account, so every figure a balance sheet needs comes either from a service that was never
// asked for it or from nowhere at all.
//
// The page exists to answer the question BEFORE the ledger: what would the finished screen be worth?
// Which is why it carries a gap mode — the same layout, with every line nothing here can serve marked
// and totalled. Read with it on, the mock stops being a picture and becomes the estimate.
//
// THE LAYOUT IS THE EQUATION, and it has three rungs rather than a breakpoint:
//
//   | width   | shape                          | why                                                |
//   | ------- | ------------------------------ | -------------------------------------------------- |
//   | ≥1600px | A  =  L  +  E, three columns   | the operators are IN the gutters — the page reads   |
//   |         |                                | as the equation rather than stating it in a card    |
//   | ≥992px  | A | L over E — the T-account   | the two halves are the same height because they are |
//   |         |                                | the same number; a sheet that does not tie looks    |
//   |         |                                | wrong before anybody reads a figure                 |
//   | below   | one column, A then L then E    | the equation still reads top to bottom              |
//
// ⚠ ONE DOM AT EVERY WIDTH — the shape is CSS, never a second render. Mounting a wide layout beside a
// narrow one would put two of every `data-testid` on the page, which is the same trap the app's two
// shells avoid with a JS breakpoint (layouts/shell.ts). Here a single grid reflows instead, so the
// operator cells are `display: none` below the wide stop rather than a separate tree.
//
// THREE COLUMNS KEEP THE COMPARISON, which is what the width is being spent on. A prior column and a
// movement column are what turn "we hold 96 million of stock" into "8 million more than last month" —
// the difference between a photograph and a fact — and three tables carrying four columns each is
// simply a wide layout. The alternative was dropping the prior column to fit three narrow ones; this
// keeps it and asks for the pixels instead.
export interface BalanceSheetPageProps {
  sheet: BalanceSheet;
  /**
   * Wired by the caller, which resolves the window to a sheet.
   *
   * ⚠ THE RANGE PICKS TWO INSTANTS, NOT A PERIOD TO SUM — `to` is the sheet's own date and `from` is
   * the comparison column. That is the opposite of what the same control means on every other screen
   * in this app, where a window selects the movements INSIDE it. A balance sheet has no inside: it is
   * a level, and two levels are what a comparison needs. The caption under the control says so out
   * loud, because the control alone cannot.
   */
  onRangeChange?: (range: DateRange) => void;
}

// The T-account stop — Chakra's `lg`, written as a query so it sits in the same cascade as the wide
// one and their order on the page decides which wins.
const LG = "@media (min-width: 62em)";

// ⚠ 1600px, AND DELIBERATELY NOT A THEME BREAKPOINT. Chakra's widest default stop is `2xl` at 1536,
// which is about thirty pixels short of three of these tables side by side — and thirty pixels short
// means the money cells wrap, which in a column of right-aligned rupiah figures is worse than not
// having the third column at all. Adding a global breakpoint to theme.ts would change the generated
// conditions for all sixty other screens to serve this one, so the number lives here, once, beside
// the only layout that reads it.
const WIDE = "@media (min-width: 100em)";

// The `=` and `+` between the columns. Present in the DOM at every width and SHOWN only when there
// are three columns for them to sit between — below that the operators would be pointing at a stack.
function Operator({ icon, testId }: { icon: ElementType; testId: string }) {
  return (
    <GridItem
      data-testid={testId}
      css={{
        display: "none",
        [WIDE]: { display: "flex", alignSelf: "center", justifyContent: "center" },
      }}
    >
      <Icon as={icon} boxSize="6" color="fg.subtle" />
    </GridItem>
  );
}

function formatDate(yyyymmdd: string): string {
  const d = parseLocalDate(yyyymmdd);

  if (!d) {
    return yyyymmdd;
  }

  return d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

export function BalanceSheetPage({ sheet, onRangeChange }: BalanceSheetPageProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const [showGaps, setShowGaps] = useState(false);

  // Always the sheet's own two dates, never a separately-held filter value — see `onRangeChange`.
  const range: DateRange = { kind: "absolute", from: sheet.priorAsOf, to: sheet.asOf };

  const result = check(sheet);
  const gap = gaps(sheet);

  const asOfLabel = formatDate(sheet.asOf);
  const priorLabel = formatDate(sheet.priorAsOf);

  const equity = section(sheet, "equity");
  const profitLine = equity.lines.find((l) => l.id === "profit");
  const profitOnSheet = profitLine?.amount ?? 0n;
  const profitTies = profitOnSheet === sheet.profitPerIncomeStatement;

  const equityTotal = sectionTotal(equity);

  const openLine = (to: string) => navigate(to);

  return (
    <Stack gap="section">
      <Flex align="center" gap="card" wrap="wrap">
        <Heading size="md">{t("balance.title")}</Heading>
        <Badge colorPalette="brand">{sheet.teamName}</Badge>
        <Spacer />

        {/* The range is DERIVED from the sheet rather than held beside it. One source of truth means
            the control can never sit on a window the figures below it are not from — which is the
            failure people actually hit with a filter, and it looks like the data being wrong. */}
        <Flex align="center" gap="2">
          <Text fontSize="sm" color="fg.muted">
            {t("balance.compare")}
          </Text>
          <Box>
            <DateRangePicker
              value={range}
              onChange={(r) => onRangeChange?.(r)}
              disabled={!onRangeChange}
              testId="balance-range"
            />
          </Box>
        </Flex>

        <Checkbox.Root
          checked={showGaps}
          onCheckedChange={(e) => setShowGaps(!!e.checked)}
          data-testid="balance-show-gaps"
        >
          <Checkbox.HiddenInput />
          <Checkbox.Control />
          <Checkbox.Label>{t("balance.showGaps")}</Checkbox.Label>
        </Checkbox.Root>
      </Flex>

      {/* ⚠ WHAT THE WINDOW MEANS HERE, said in words. This control means "movements inside this
          window" on every other screen in the app, and "these two instants" on this one — the same
          widget with an inverted reading. Somebody who carries the habit across would read the sheet
          as August's trading rather than as August's position, and every figure would look plausible.
          A caption is a weak fix for that and still much better than nothing. */}
      <Text fontSize="xs" color="fg.muted" data-testid="balance-range-meaning">
        {t("balance.rangeMeaning", { to: asOfLabel, from: priorLabel })}
      </Text>

      {/* Said on the screen and not only in a comment. A money page that looks finished is read as
          finished, and this one's figures are typed into a fixture file. */}
      <Flex align="center" gap="2" color="orange.fg" data-testid="balance-mock-notice">
        <Icon as={FlaskConical} boxSize="4" />
        <Text fontSize="sm">{t("balance.mockNotice")}</Text>
      </Flex>

      <BalanceCheckCard result={result} />

      {/* THE GAP TOTAL IS THE POINT OF THE MOCK. Not "some lines are missing" — how much of what the
          business holds and owes somebody would have to type in every month, which is the number the
          decision to build a ledger actually turns on. */}
      {showGaps && (
        <Flex align="center" gap="2" color="orange.fg" data-testid="balance-gap-summary">
          <Icon as={TriangleAlert} boxSize="4" />
          <Text fontSize="sm">
            {t("balance.gapSummary", {
              untracked: gap.untrackedLines,
              total: gap.totalLines,
              amount: formatRupiah(gap.untrackedAmount),
              position: formatRupiah(gap.positionAmount),
            })}
          </Text>
        </Flex>
      )}

      <Grid
        gap="section"
        alignItems="start"
        css={{
          gridTemplateColumns: "1fr",
          [LG]: { gridTemplateColumns: "1fr 1fr" },
          [WIDE]: { gridTemplateColumns: "1fr auto 1fr auto 1fr" },
        }}
      >
        {/* Assets spans both rows of the T-account, and stops spanning once there is a column of its
            own. Placement is CSS at every width, never a `rowSpan` prop overridden by a query — the
            two would race on specificity, and the loser is invisible until somebody resizes. */}
        <GridItem css={{ [LG]: { gridRow: "span 2" }, [WIDE]: { gridRow: "auto" } }}>
          <BalanceSectionCard
            section={section(sheet, "assets")}
            asOfLabel={asOfLabel}
            priorLabel={priorLabel}
            showGaps={showGaps}
            onOpen={openLine}
          />
        </GridItem>

        <Operator icon={Equal} testId="balance-op-equals" />

        <GridItem>
          <BalanceSectionCard
            section={section(sheet, "liabilities")}
            asOfLabel={asOfLabel}
            priorLabel={priorLabel}
            showGaps={showGaps}
            onOpen={openLine}
          />
        </GridItem>

        <Operator icon={Plus} testId="balance-op-plus" />

        <GridItem>
          <Stack gap="field">
            <BalanceSectionCard
              section={equity}
              asOfLabel={asOfLabel}
              priorLabel={priorLabel}
              showGaps={showGaps}
              onOpen={openLine}
            />

            {/* ⚠ THE ONE NUMBER THAT JOINS THE TWO REPORTS. Equity moves by what the business earned,
                so the profit line here and the Profit screen's bottom line are the same figure
                approached from opposite ends. Nothing else on either screen would notice them
                drifting apart — so it is checked here, out loud, rather than trusted. */}
            {profitTies ? (
              <Flex align="center" gap="2" color="green.fg" data-testid="balance-profit-ties">
                <Icon as={Check} boxSize="4" />
                <Text fontSize="xs">
                  {t("balance.profitTies", { amount: formatRupiah(profitOnSheet) })}
                </Text>
              </Flex>
            ) : (
              <Flex align="center" gap="2" color="red.fg" data-testid="balance-profit-mismatch">
                <Icon as={TriangleAlert} boxSize="4" />
                <Text fontSize="xs">
                  {t("balance.profitMismatch", {
                    sheet: formatRupiah(profitOnSheet),
                    statement: formatRupiah(sheet.profitPerIncomeStatement),
                  })}
                </Text>
              </Flex>
            )}

            {/* Equity is a RESIDUAL and the page says so. Nobody puts equity anywhere: it is what is
                left when the debts come off what is held, and a reader who takes it for a pot of
                money reads a healthy equity as money available to spend. */}
            <Text fontSize="xs" color="fg.muted" data-testid="balance-equity-note">
              {t("balance.equityNote", { amount: formatRupiah(equityTotal) })}
            </Text>
          </Stack>
        </GridItem>
      </Grid>
    </Stack>
  );
}
