import { useTranslation } from "react-i18next";
import { Badge, Box, Flex, HStack, Stack, Table, Text } from "@chakra-ui/react";
import { Handshake } from "lucide-react";

import type { LiabilityLog } from "../../../gen/warehouse/liability/v1/liability_pb";
import { formatRupiah } from "../../../lib/money";
import { causeKey } from "../format";
import { formatUnixDateTimeShort } from "../../../lib/datetime";
import { EmptyHint } from "../../../components/feedback/EmptyHint";

// ONE RELATIONSHIP'S LEDGER — the All tab's whole running ledger, or one direction of it (the receivable or the payable
// tab) on the liability detail.
//
// Lifted out of the page so it can be reviewed on its own beside the other ledgers (settlement's,
// a financial account's, the stock's): they answer the same questions — when · what · how much · and
// what it left — and seeing them side by side is how they are kept alike.
export function LiabilityLedgerTable({
  rows,
  emptyText,
  phone = false,
}: {
  rows: LiabilityLog[];
  /** The tab's own way of saying nothing is owed in this direction. */
  emptyText: string;
  /**
   * Each entry as a BLOCK on a phone (a-phone-reads-each-line-as-a-block, the-team-balance-phone-layout-is-accepted):
   * the cause and the movement on the first line, the day and the balance it left on the second. The pair page passes
   * its `useIsMobile()`; off a phone it is the table.
   */
  phone?: boolean;
}) {
  const { t } = useTranslation();

  if (rows.length === 0) {
    return (
      <EmptyHint icon={Handshake} size="sm" title={emptyText} testId="liability-ledger-empty" />
    );
  }

  if (phone) {
    return (
      <Stack gap="0" data-testid="liability-ledger-table" data-layout="blocks">
        {rows.map((e) => (
          // A block that opens nothing does not light up (a-table-row-lights-up).
          <Box
            key={e.id.toString()}
            py="2.5"
            px="1"
            borderBottomWidth="1px"
            borderColor="border.muted"
            bg={e.reversal ? "bg.muted" : undefined}
            data-testid={`liability-detail-entry-${e.id}`}
          >
            <Flex justify="space-between" align="baseline" gap="3">
              <Text fontSize="sm" fontWeight="medium" minW="0">
                {t(causeKey(e.sourceType), { id: e.sourceId.toString() })}
              </Text>
              <Text fontSize="sm" fontWeight="bold" whiteSpace="nowrap">
                {e.amount > 0n ? "+" : "−"}
                {formatRupiah(e.amount < 0n ? -e.amount : e.amount)}
              </Text>
            </Flex>
            <Flex justify="space-between" align="center" gap="3" mt="0.5">
              <HStack gap="2" minW="0">
                <Text fontSize="xs" color="fg.muted" whiteSpace="nowrap">
                  {formatUnixDateTimeShort(e.createdAtUnix)}
                </Text>
                {e.reversal && (
                  <Badge size="sm" colorPalette="warning" data-testid={`liability-detail-reversal-${e.id}`}>
                    {t("liabilityDetail.reversal")}
                  </Badge>
                )}
              </HStack>
              <Text fontSize="xs" color="fg.muted" whiteSpace="nowrap" data-testid={`liability-detail-balance-after-${e.id}`}>
                {t("liabilityDetail.balanceAfterLine", { amount: formatRupiah(e.balanceAfter) })}
              </Text>
            </Flex>
          </Box>
        ))}
      </Stack>
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
            {/* A table date is short and Jakarta time (a-table-date-is-short-and-every-time-is-wib). */}
            <Table.Cell whiteSpace="nowrap">{formatUnixDateTimeShort(e.createdAtUnix)}</Table.Cell>
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
            <Table.Cell
              textAlign="end"
              color="fg.muted"
              whiteSpace="nowrap"
              data-testid={`liability-detail-balance-after-${e.id}`}
            >
              {formatRupiah(e.balanceAfter)}
            </Table.Cell>
          </Table.Row>
        ))}
      </Table.Body>
    </Table.Root>
  );
}
