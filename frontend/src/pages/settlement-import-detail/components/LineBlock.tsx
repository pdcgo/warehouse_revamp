import { useTranslation } from "react-i18next";
import { Link as RouterLink } from "react-router-dom";
import { Flex, Icon, Link, Span, Stack, Text } from "@chakra-ui/react";
import { ArrowRight } from "lucide-react";

import { SettlementType } from "../../../gen/warehouse/settlement/v1/settlement_pb";
import {
  type UploadedFileLine,
  UploadedFileLineOutcome,
} from "../../../gen/warehouse/settlement_importer/v1/settlement_importer_pb";
import { formatDayShort } from "../../../lib/datetime";
import { formatRupiah } from "../../../lib/money";

// ONE STATEMENT ROW ON A PHONE — accepted as drawn (the-import-detail-phone-prototype-is-accepted, backlog #94); the page
// draws it below `md` instead of its table row.
//
// The desktop row's six columns as a block (a-phone-reads-each-line-as-a-block), one
// context per line, names at full width, as the transfer lists' blocks read
// (the-transfer-lists-read-as-blocks-on-a-phone):
//
//   240927P001                                   Rp 47.500     the ref leads (what a person looks a row up by); the
//                                                              amount on the right, red when money left
//   Posted to its order  #1001                                 what became of it — the result, and the order its money
//                                                              went to, a link (or every order a ref found)
//   unique_id already names an entry on another account       the importer's detail, when it has one
//   Penghasilan dari Pesanan → Payout                          what the statement calls it → what it was recorded as
//   27 Sep · Rincian Transaksi                                 the day, and the sheet it came from
//
// The block opens nothing (only its links do — a-phone-import-block-opens-only-its-order-link), so it does not light up
// (a-table-row-lights-up). Room as the transfer
// blocks: 16px inside, 8px between lines.
export function LineBlock({ line, result, orderId }: { line: UploadedFileLine; result: string; orderId: bigint }) {
  const { t } = useTranslation();
  const id = line.id.toString();

  // A skipped row is never recorded, so it has no "recorded as" — as the desktop's "—" says.
  const recordedAs =
    line.outcome === UploadedFileLineOutcome.SKIPPED
      ? ""
      : line.settlementType === SettlementType.UNSPECIFIED
        ? t("settlementImports.line.unmapped")
        : t(`settlementImports.type.${SettlementType[line.settlementType].toLowerCase()}`);

  return (
    <Stack data-testid={`line-row-${id}`} borderWidth="1px" borderRadius="md" p="4" gap="2" minW="0">
      <Flex align="baseline" justify="space-between" gap="3" minW="0">
        <Text
          fontFamily="mono"
          fontWeight="bold"
          minW="0"
          wordBreak="break-all"
          color={line.orderRef ? undefined : "fg.muted"}
          data-testid={`line-ref-${id}`}
        >
          {line.orderRef || "—"}
        </Text>
        <Text
          fontWeight="bold"
          whiteSpace="nowrap"
          flexShrink={0}
          color={line.change < 0 ? "red.fg" : undefined}
          data-testid={`line-amount-${id}`}
        >
          {formatRupiah(line.change)}
        </Text>
      </Flex>

      <Flex align="baseline" columnGap="2" rowGap="1" wrap="wrap" fontSize="sm" minW="0">
        <Text wordBreak="break-word" data-testid={`line-reason-${id}`}>
          {result}
        </Text>
        {orderId > 0n && (
          <Link asChild colorPalette="primary" fontFamily="mono">
            <RouterLink to={`/orders/${orderId}`} data-testid={`line-order-${id}`}>
              #{orderId.toString()}
            </RouterLink>
          </Link>
        )}
        {line.foundOrderIds.length > 0 && (
          <Flex columnGap="2" wrap="wrap" data-testid={`line-found-orders-${id}`}>
            {line.foundOrderIds.map((found) => (
              <Link key={found.toString()} asChild colorPalette="primary" fontFamily="mono">
                <RouterLink to={`/orders/${found}`} data-testid={`line-found-order-${id}-${found}`}>
                  #{found.toString()}
                </RouterLink>
              </Link>
            ))}
          </Flex>
        )}
      </Flex>

      {line.detail && (
        <Text fontSize="xs" color="fg.muted" wordBreak="break-word" data-testid={`line-detail-${id}`}>
          {line.detail}
        </Text>
      )}

      <Flex
        align="center"
        columnGap="1.5"
        wrap="wrap"
        fontSize="xs"
        color="fg.muted"
        minW="0"
        data-testid={`line-type-${id}`}
      >
        <Span wordBreak="break-word">{line.platformType}</Span>
        {recordedAs && (
          <>
            <Icon as={ArrowRight} boxSize="3" flexShrink={0} />
            <Span wordBreak="break-word">{recordedAs}</Span>
          </>
        )}
      </Flex>

      <Text fontSize="xs" color="fg.muted" minW="0" wordBreak="break-word" data-testid={`line-when-${id}`}>
        {formatDayShort(line.occurredOn)}
        {line.sheet && ` · ${line.sheet}`}
      </Text>
    </Stack>
  );
}
