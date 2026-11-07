import { useTranslation } from "react-i18next";
import { useLocation, useNavigate } from "react-router-dom";
import { Box, Icon, Table, Text } from "@chakra-ui/react";
import { ChartColumn, ChevronRight } from "lucide-react";

import type { SettlementGroupBy, SettlementGroupRow } from "../../../features/settlement/analytics";
import { MeasureCells, MeasureHeaders } from "./SeriesTable";
import { EmptyHint } from "../../../components/feedback/EmptyHint";
import { LAST_MONTH } from "../../../components/datetime/DateRangePicker";
import { shopEntriesLink } from "../../../features/settlement/shopEntries";
import { dateRangeCodec } from "../../../lib/urlState";

// Shops or people, RANKED by the position they carry at the window's end — the largest first.
//
// ⚠ BY USER is WHO CREATED THE ORDER, for a shop-level row WHO POSTED IT
// (#a-shop-addressed-row-is-attributed-to-its-actor), and for an imported shop row the shop's primary CS — so it is
// "who is answerable", not a salesperson league table. Half of a person's rows can be adjustments they posted rather
// than sales they made. A row with no one recorded is not a person, and is not listed here.
export function GroupTable({
  groupBy,
  rows,
  nameOf,
}: {
  groupBy: SettlementGroupBy;
  rows: SettlementGroupRow[];
  nameOf: (id: bigint) => string;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { search } = useLocation();

  // A BY SHOP ROW OPENS THAT SHOP'S OWN ENTRIES on the report's window (the-shop-entries-page-is-accepted: "a By shop
  // row of the report opens it on that shop with the report's dates"). A person's row opens nothing.
  const opensEntries = groupBy === "shop";
  const openEntries = (shopId: bigint) => {
    const range = dateRangeCodec.decode(new URLSearchParams(search).get("range") ?? "") ?? LAST_MONTH;
    navigate(shopEntriesLink(shopId, range));
  };

  if (rows.length === 0) {
    return (
      <EmptyHint
        icon={ChartColumn}
        title={t("settlementReport.empty")}
        description={t("emptyHint.otherPeriod")}
        testId="report-groups-empty"
      />
    );
  }

  return (
    <Box overflowX="auto">
      {opensEntries && (
        <Text fontSize="xs" color="fg.muted" mb="2" data-testid="report-groups-entries-hint">
          {t("settlementShopEntries.fromReportHint")}
        </Text>
      )}
      <Table.Root size="sm" interactive={opensEntries || undefined} data-testid="report-groups-table">
        <Table.Header>
          <Table.Row>
            <Table.ColumnHeader>
              {groupBy === "shop" ? t("settlementReport.col.shop") : t("settlementReport.col.user")}
            </Table.ColumnHeader>
            <MeasureHeaders />
            {opensEntries && <Table.ColumnHeader />}
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {rows.map((row) => (
            <Table.Row
              key={row.id.toString()}
              data-testid={`report-group-row-${row.id}`}
              {...(opensEntries ? { cursor: "pointer", onClick: () => openEntries(row.id) } : {})}
            >
              <Table.Cell>
                <Text fontSize="sm">{nameOf(row.id)}</Text>
              </Table.Cell>
              <MeasureCells measure={row.measure} />
              {opensEntries && (
                <Table.Cell>
                  <Icon
                    as={ChevronRight}
                    boxSize="4"
                    color="fg.subtle"
                    aria-label={t("settlementShopEntries.openFromReport")}
                    data-testid={`report-group-open-${row.id}`}
                  />
                </Table.Cell>
              )}
            </Table.Row>
          ))}
        </Table.Body>
      </Table.Root>
    </Box>
  );
}
