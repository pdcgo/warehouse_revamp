import { useTranslation } from "react-i18next";
import { Flex, Stack, Table, Text, Wrap } from "@chakra-ui/react";

import { SortableHeader, type SortState } from "../../../components/chrome/SortableHeader";
import type { AccountReportPoint } from "../../../features/financialAccount/analytics";
import { BalanceText, ChangeTypeBadge } from "../../../features/financialAccount/badges";
import { CHANGE_TYPES } from "../../../features/financialAccount/vocab";
import { useIsMobile } from "../../../layouts/shell";
import type { PeriodGrain } from "../../../lib/period";
import { FIELD_OF, TypeCells, TypeHeaders } from "./MetricColumns";
import { SignedAmount } from "./ReportSummary";

function periodLabel(at: string, grain: PeriodGrain): string {
  if (grain === "month") return at.slice(0, 7);
  if (grain === "year") return at.slice(0, 4);

  return at;
}

// One row per period — the quiet ones included, because a quiet day still carries the balance forward and a
// missing row reads as a day that did not load. NEWEST first, and the Periode heading flips it
// (`a-table-sorts-from-its-headings`). The net change signed and coloured, the closing balance bold, as on the
// accounts list (`a-balance-is-bold`). On a phone each period is a block (`a-phone-reads-each-line-as-a-block`).
export function SeriesTable({
  grain,
  points,
  sort,
  onSortChange,
  stickyEdges = false,
}: {
  grain: PeriodGrain;
  points: AccountReportPoint[];
  sort: SortState<"period">;
  onSortChange: (next: SortState<"period">) => void;
  /**
   * Hold Periode on the left and Saldo akhir on the right while the nine type columns scroll between them — a row's
   * date and the figure it is read for stay on screen however narrow the window.
   */
  stickyEdges?: boolean;
}) {
  const { t } = useTranslation();
  const isMobile = useIsMobile();
  // Opaque cells with a line on their inner edge, so the columns passing under them read as passing under.
  const stickyRight = stickyEdges
    ? ({ position: "sticky", right: "0", zIndex: "1", bg: "bg", boxShadow: "inset 1px 0 0 var(--chakra-colors-border)" } as const)
    : {};
  const stickyLeft = stickyEdges
    ? ({ position: "sticky", left: "0", zIndex: "1", bg: "bg", boxShadow: "inset -1px 0 0 var(--chakra-colors-border)" } as const)
    : {};

  if (points.length === 0) {
    return (
      <Text fontSize="sm" color="fg.muted" data-testid="account-report-series-empty">
        {t("financialAccounts.report.empty")}
      </Text>
    );
  }

  if (isMobile) {
    return (
      <Stack gap="0" data-testid="account-report-series">
        {points.map((point) => (
          // TWO COLUMNS, TOP-ALIGNED (owner: *"yang perubahan taruh di bawah saldo pas, tidak center dari tiap tipenya"*) —
          // the date and the types that moved on the left, the close and the change right under it on the right. As
          // two rows the change was centred against however many type badges had wrapped beside it.
          <Flex
            key={point.at}
            justify="space-between"
            align="start"
            gap="3"
            py="3"
            borderBottomWidth="1px"
            borderColor="border"
            data-testid={`account-report-series-row-${point.at}`}
          >
            <Stack gap="1" minW="0">
              <Text fontSize="sm">{periodLabel(point.at, grain)}</Text>
              <Wrap gap="1">
                {CHANGE_TYPES.filter((c) => point.metric[FIELD_OF[c]!] !== 0).map((c) => (
                  <Flex key={c} align="center" gap="1" fontSize="xs">
                    <ChangeTypeBadge changeType={c} />
                    <SignedAmount amount={point.metric[FIELD_OF[c]!]} />
                  </Flex>
                ))}
              </Wrap>
            </Stack>
            <Stack gap="1" align="end" flexShrink="0">
              <BalanceText balance={point.metric.closeBalance} bold testId={`account-report-series-close-${point.at}`} />
              <Text fontSize="sm" fontWeight="medium" data-testid={`account-report-series-change-${point.at}`}>
                <SignedAmount amount={point.metric.change} />
              </Text>
            </Stack>
          </Flex>
        ))}
      </Stack>
    );
  }

  return (
    <Table.ScrollArea>
      <Table.Root size="sm" data-testid="account-report-series">
        <Table.Header>
          <Table.Row>
            <SortableHeader
              column="period"
              label={t("financialAccounts.report.period")}
              sort={sort}
              onSortChange={onSortChange}
              testId="account-report-sort-period"
              headerProps={stickyLeft}
            />
            <TypeHeaders />
            <Table.ColumnHeader textAlign="end">{t("financialAccounts.report.change")}</Table.ColumnHeader>
            <Table.ColumnHeader textAlign="end" {...stickyRight}>
              {t("financialAccounts.report.close")}
            </Table.ColumnHeader>
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {points.map((point) => (
            // A ROW LIGHTS UP UNDER THE POINTER (owner: *"tabel report kasih hover per row"*) — eleven figures across, the
            // eye needs a rail to stay on one period. Set on every cell, so the held edge cells light up with the rest; by
            // Chakra's `_hover`, which a story can drive with `data-hover` where a synthetic pointer sets no `:hover`.
            <Table.Row key={point.at} css={{ _hover: { "& > td": { bg: "bg.muted" } } }} data-testid={`account-report-series-row-${point.at}`}>
              <Table.Cell whiteSpace="nowrap" {...stickyLeft}>
                {periodLabel(point.at, grain)}
              </Table.Cell>
              <TypeCells metric={point.metric} />
              <Table.Cell textAlign="end" whiteSpace="nowrap">
                <Text fontSize="sm" fontWeight="medium">
                  <SignedAmount amount={point.metric.change} />
                </Text>
              </Table.Cell>
              <Table.Cell textAlign="end" whiteSpace="nowrap" {...stickyRight}>
                <BalanceText balance={point.metric.closeBalance} bold />
              </Table.Cell>
            </Table.Row>
          ))}
        </Table.Body>
      </Table.Root>
    </Table.ScrollArea>
  );
}
