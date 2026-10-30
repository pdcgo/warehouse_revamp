import { useTranslation } from "react-i18next";
import { Box, Table, Text } from "@chakra-ui/react";
import { ChartColumn } from "lucide-react";

import type { SettlementGroupBy, SettlementGroupRow } from "../../../features/settlement/analytics";
import { MeasureCells, MeasureHeaders } from "./SeriesTable";
import { EmptyHint } from "../../../components/feedback/EmptyHint";

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
      <Table.Root size="sm" data-testid="report-groups-table">
        <Table.Header>
          <Table.Row>
            <Table.ColumnHeader>
              {groupBy === "shop" ? t("settlementReport.col.shop") : t("settlementReport.col.user")}
            </Table.ColumnHeader>
            <MeasureHeaders />
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {rows.map((row) => (
            <Table.Row key={row.id.toString()} data-testid={`report-group-row-${row.id}`}>
              <Table.Cell>
                <Text fontSize="sm">{nameOf(row.id)}</Text>
              </Table.Cell>
              <MeasureCells measure={row.measure} />
            </Table.Row>
          ))}
        </Table.Body>
      </Table.Root>
    </Box>
  );
}
