import { useTranslation } from "react-i18next";
import { Box, Table, Text } from "@chakra-ui/react";

import type { SettlementGroupBy, SettlementGroupRow } from "../../../features/settlement/analytics";
import { MeasureCells, MeasureHeaders } from "./SeriesTable";

// Shops or people, RANKED by the hidden cost they carry at the window's end — the largest first.
//
// ⚠ BY USER is WHO CREATED THE ORDER, and for a shop-level row WHO POSTED IT
// (#a-shop-addressed-row-is-attributed-to-its-actor) — so it is "who is answerable", not a salesperson
// league table. Half of a person's rows can be adjustments they posted rather than sales they made.
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
      <Text fontSize="sm" color="fg.muted" data-testid="report-groups-empty">
        {t("settlementReport.empty")}
      </Text>
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
