import { useTranslation } from "react-i18next";
import { Badge, Flex, Table, Text } from "@chakra-ui/react";

import type { LiabilityLog } from "../../../gen/warehouse/liability/v1/liability_pb";
import { formatRupiah } from "../../../lib/money";
import { causeKey, fmtDate } from "../format";

// ONE DIRECTION OF ONE RELATIONSHIP'S LEDGER — the receivable or the payable tab of the liability detail.
//
// Lifted out of the page so it can be reviewed on its own beside the other ledgers (settlement's,
// a financial account's, the stock's): they answer the same questions — when · what · how much · and
// what it left — and seeing them side by side is how they are kept alike.
export function LiabilityLedgerTable({
  rows,
  emptyText,
}: {
  rows: LiabilityLog[];
  /** The tab's own way of saying nothing is owed in this direction. */
  emptyText: string;
}) {
  const { t } = useTranslation();

  if (rows.length === 0) {
    return (
      <Text color="fg.muted" py="card" data-testid="liability-ledger-empty">
        {emptyText}
      </Text>
    );
  }

  return (
    <Table.Root size="sm" data-testid="liability-ledger-table">
      <Table.Header>
        <Table.Row>
          <Table.ColumnHeader>{t("liabilityDetail.colDate")}</Table.ColumnHeader>
          <Table.ColumnHeader>{t("liabilityDetail.colCause")}</Table.ColumnHeader>
          <Table.ColumnHeader textAlign="end">{t("liabilityDetail.colAmount")}</Table.ColumnHeader>
          <Table.ColumnHeader textAlign="end">{t("liabilityDetail.colBalance")}</Table.ColumnHeader>
        </Table.Row>
      </Table.Header>
      <Table.Body>
        {rows.map((e) => (
          <Table.Row
            key={e.id.toString()}
            bg={e.reversal ? "bg.muted" : undefined}
            data-testid={`liability-detail-entry-${e.id}`}
          >
            <Table.Cell whiteSpace="nowrap">{fmtDate(e.createdAtUnix)}</Table.Cell>
            <Table.Cell>
              <Flex align="center" gap="2">
                <Text>{t(causeKey(e.sourceType), { id: e.sourceId.toString() })}</Text>
                {/* A reversal is labelled, not left to be inferred from a sign. */}
                {e.reversal && (
                  <Badge colorPalette="warning" data-testid={`liability-detail-reversal-${e.id}`}>
                    {t("liabilityDetail.reversal")}
                  </Badge>
                )}
              </Flex>
            </Table.Cell>
            {/* The one place a sign is legitimate: an entry is a MOVEMENT, and +/− means "this made
                the balance go up / down". */}
            <Table.Cell textAlign="end" whiteSpace="nowrap">
              {e.amount > 0n ? "+" : "−"}
              {formatRupiah(e.amount < 0n ? -e.amount : e.amount)}
            </Table.Cell>
            <Table.Cell textAlign="end" color="fg.muted" whiteSpace="nowrap">
              {formatRupiah(e.balanceAfter)}
            </Table.Cell>
          </Table.Row>
        ))}
      </Table.Body>
    </Table.Root>
  );
}
