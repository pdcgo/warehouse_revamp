import { useTranslation } from "react-i18next";
import { Alert, Badge, Box, Button, Card, HStack, Icon, Link, Span, Stack, Table, Text } from "@chakra-ui/react";
import { Check, ClipboardCheck, Undo2, X } from "lucide-react";
import { Link as RouterLink } from "react-router-dom";

import {
  type FoundRequest,
  FoundRequestApproveBlock,
  FoundRequestPostType,
  FoundRequestStatus,
} from "../../../gen/warehouse/inventory/v1/found_request_pb";
import { formatUnixDate, formatUnixDateTimeShort } from "../../../lib/datetime";
import { formatRupiahNumber } from "../../../lib/money";

// A found request's status — a lifecycle step, so its colour is categorical (as the stock count's session status).
const STATUS: Record<FoundRequestStatus, { key: string; color: string }> = {
  [FoundRequestStatus.UNSPECIFIED]: { key: "foundRequest.status.unspecified", color: "gray" },
  [FoundRequestStatus.WAITING]: { key: "foundRequest.status.waiting", color: "orange" },
  [FoundRequestStatus.APPROVED]: { key: "foundRequest.status.approved", color: "green" },
  [FoundRequestStatus.REJECTED]: { key: "foundRequest.status.rejected", color: "gray" },
  [FoundRequestStatus.SETTLED_BY_COUNT]: { key: "foundRequest.status.settled", color: "blue" },
};

// What a line does — the stock count's finalize draws the same two the same way (opname-finalize): money coming back,
// and stock with no money.
const POST: Record<FoundRequestPostType, { key: string; color: string }> = {
  [FoundRequestPostType.UNSPECIFIED]: { key: "foundRequest.post.unspecified", color: "gray" },
  [FoundRequestPostType.CLAIM]: { key: "foundRequest.post.claim", color: "success" },
  [FoundRequestPostType.MINT]: { key: "foundRequest.post.mint", color: "info" },
};

export function FoundRequestStatusBadge({ status, withdrawn = false }: { status: FoundRequestStatus; withdrawn?: boolean }) {
  const { t } = useTranslation();
  const meta = STATUS[status];

  return (
    <Badge colorPalette={meta.color} data-testid={`found-request-status-${status}`}>
      {withdrawn ? t("foundRequest.status.withdrawn") : t(meta.key)}
    </Badge>
  );
}

// ONE FOUND REQUEST — what was found where, by whom, the note the approver decides on, and what approving it posts:
// which losses it claims back at what price, and what it mints (an-adjust-found-waits-for-the-owner-or-admin). The
// server says per request why THIS person cannot approve it now (`block`), so the reason sits right above the button it
// disables. The reporter's own request offers Withdraw instead of Reject (the-reporter-may-withdraw-their-found); one a
// stock count settled names that count and links to it (a-count-settles-the-found-it-counted).
export function FoundRequestCard({
  request,
  teamName,
  nameOf,
  compact,
  canApprove,
  canReject,
  onApprove,
  onReject,
}: {
  request: FoundRequest;
  teamName: string;
  nameOf: (id: bigint) => string;
  compact: boolean;
  /** The caller may approve here at all — the warehouse Owner or Admin, and not a monitor. */
  canApprove: boolean;
  /** The caller may reject — or, their own, withdraw — here: every reader but a monitor. */
  canReject: boolean;
  onApprove: () => void;
  onReject: () => void;
}) {
  const { t } = useTranslation();
  const r = request;
  const id = r.id.toString();
  const waiting = r.status === FoundRequestStatus.WAITING;
  const approved = r.status === FoundRequestStatus.APPROVED;
  const rejected = r.status === FoundRequestStatus.REJECTED;
  const settled = r.status === FoundRequestStatus.SETTLED_BY_COUNT;
  // A rejection by the person who reported it is their withdrawal.
  const withdrawn = rejected && r.decidedById !== 0n && r.decidedById === r.reportedById;
  const blocked = r.block !== FoundRequestApproveBlock.UNSPECIFIED;
  const own = r.block === FoundRequestApproveBlock.OWN_REPORT;

  const blockText = (() => {
    switch (r.block) {
      case FoundRequestApproveBlock.OWN_REPORT:
        return t("foundRequest.block.ownReport");
      case FoundRequestApproveBlock.BEING_COUNTED:
        return t("foundRequest.block.beingCounted", { id: r.countingSessionId.toString(), rack: r.rackCode });
      default:
        return "";
    }
  })();

  const batchCell = (l: FoundRequest["lines"][number]) =>
    l.type === FoundRequestPostType.MINT
      ? l.batchId > 0n
        ? t("foundRequest.lines.newBatchId", { id: l.batchId.toString() })
        : t("foundRequest.lines.newBatch")
      : `#${l.batchId.toString()} · ${t("foundRequest.lines.claims", {
          id: l.problemId.toString(),
          date: formatUnixDate(l.problemCreatedAtUnix),
        })}`;

  return (
    <Card.Root variant="outline" size="sm" data-testid={`found-request-${id}`}>
      <Card.Body gap="3">
        <HStack justify="space-between" align="flex-start" gap="2" wrap="wrap">
          <Stack gap="0" minW="0">
            <Span fontWeight="bold">{r.productName}</Span>
            <Span fontSize="xs" color="fg.muted">
              {r.productCode} · {teamName}
            </Span>
          </Stack>
          <HStack gap="2">
            <Span fontSize="xs" color="fg.muted">
              #{id}
            </Span>
            <FoundRequestStatusBadge status={r.status} withdrawn={withdrawn} />
          </HStack>
        </HStack>

        <Stack gap="0" fontSize="sm">
          <Text fontWeight="bold" data-testid={`found-request-units-${id}`}>
            {t("foundRequest.card.units", { count: Number(r.stockCount), rack: r.rackCode })}
          </Text>
          <Text color="fg.muted" data-testid={`found-request-reported-${id}`}>
            {t("foundRequest.card.reported", {
              name: nameOf(r.reportedById),
              when: formatUnixDateTimeShort(r.reportedAtUnix),
            })}
          </Text>
          {(approved || rejected || settled) && (
            <Text color="fg.muted" data-testid={`found-request-decided-${id}`}>
              {t(
                approved
                  ? "foundRequest.card.approved"
                  : withdrawn
                    ? "foundRequest.card.withdrawn"
                    : settled
                      ? "foundRequest.card.settledBy"
                      : "foundRequest.card.rejected",
                { name: nameOf(r.decidedById), when: formatUnixDateTimeShort(r.decidedAtUnix) },
              )}
            </Text>
          )}
        </Stack>

        <Text fontSize="sm" fontStyle="italic" color={r.note ? "fg" : "fg.muted"} data-testid={`found-request-note-${id}`}>
          {r.note ? `“${r.note}”` : t("foundRequest.card.noNote")}
        </Text>

        {rejected && (
          <Text fontSize="sm" data-testid={`found-request-reject-reason-${id}`}>
            {t("foundRequest.card.rejectReason", { reason: r.rejectReason })}
          </Text>
        )}

        {/* The count posted these units itself — approving them too would post them twice. */}
        {settled && (
          <Alert.Root status="info" size="sm" data-testid={`found-request-settled-${id}`}>
            <Alert.Indicator>
              <Icon as={ClipboardCheck} boxSize="4" />
            </Alert.Indicator>
            <Alert.Description>
              <Stack gap="0.5">
                <Link asChild color="brand.fg" fontWeight="semibold" data-testid={`found-request-settled-link-${id}`}>
                  <RouterLink to={`/inventories/opname/sessions/${r.settledByCountingSessionId.toString()}`}>
                    {t("foundRequest.card.settledByCount", { id: r.settledByCountingSessionId.toString() })}
                  </RouterLink>
                </Link>
                <Span>{t("foundRequest.card.settledLine")}</Span>
              </Stack>
            </Alert.Description>
          </Alert.Root>
        )}

        {r.lines.length > 0 && (
          <Stack gap="2" data-testid={`found-request-lines-${id}`}>
            <HStack justify="space-between" gap="2" wrap="wrap">
              <Text fontSize="sm" fontWeight="bold">
                {approved
                  ? t("foundRequest.card.postedTitle", { id: r.transactionId.toString() })
                  : t("foundRequest.card.wouldTitle")}
              </Text>
              <HStack gap="3" fontSize="sm" fontVariantNumeric="tabular-nums">
                {r.claimedAmount > 0 && (
                  <Span color="success.fg" data-testid={`found-request-claimed-${id}`}>
                    {t("foundRequest.card.claimed", { amount: formatRupiahNumber(r.claimedAmount) })}
                  </Span>
                )}
                {r.mintedAmount > 0 && (
                  <Span color="info.fg" data-testid={`found-request-minted-${id}`}>
                    {t("foundRequest.card.minted", { amount: formatRupiahNumber(r.mintedAmount) })}
                  </Span>
                )}
              </HStack>
            </HStack>

            {compact ? (
              <Stack gap="2">
                {r.lines.map((l, i) => (
                  <Stack key={i} gap="0" fontSize="sm" data-testid={`found-request-line-${id}-${i}`}>
                    <HStack gap="2" wrap="wrap">
                      <Badge colorPalette={POST[l.type].color}>{t(POST[l.type].key)}</Badge>
                      <Span fontVariantNumeric="tabular-nums">
                        {l.stockCount.toString()} × {formatRupiahNumber(l.priceUnit)}
                      </Span>
                      <Span fontWeight="bold" fontVariantNumeric="tabular-nums">
                        {formatRupiahNumber(l.amount)}
                      </Span>
                    </HStack>
                    <Span fontSize="xs" color="fg.muted">
                      {batchCell(l)}
                    </Span>
                  </Stack>
                ))}
              </Stack>
            ) : (
              <Box overflowX="auto">
                <Table.Root size="sm">
                  <Table.Header>
                    <Table.Row>
                      <Table.ColumnHeader>{t("foundRequest.lines.type")}</Table.ColumnHeader>
                      <Table.ColumnHeader>{t("foundRequest.lines.batch")}</Table.ColumnHeader>
                      <Table.ColumnHeader textAlign="end">{t("foundRequest.lines.units")}</Table.ColumnHeader>
                      <Table.ColumnHeader textAlign="end">{t("foundRequest.lines.price")}</Table.ColumnHeader>
                      <Table.ColumnHeader textAlign="end">{t("foundRequest.lines.amount")}</Table.ColumnHeader>
                    </Table.Row>
                  </Table.Header>
                  <Table.Body>
                    {r.lines.map((l, i) => (
                      <Table.Row key={i} _hover={{ bg: "bg.subtle" }} data-testid={`found-request-line-${id}-${i}`}>
                        <Table.Cell>
                          <Badge colorPalette={POST[l.type].color}>{t(POST[l.type].key)}</Badge>
                        </Table.Cell>
                        <Table.Cell color="fg.muted">{batchCell(l)}</Table.Cell>
                        <Table.Cell textAlign="end" fontVariantNumeric="tabular-nums">
                          {l.stockCount.toString()}
                        </Table.Cell>
                        <Table.Cell textAlign="end" fontVariantNumeric="tabular-nums">
                          {formatRupiahNumber(l.priceUnit)}
                        </Table.Cell>
                        <Table.Cell textAlign="end" fontWeight="bold" fontVariantNumeric="tabular-nums">
                          {formatRupiahNumber(l.amount)}
                        </Table.Cell>
                      </Table.Row>
                    ))}
                  </Table.Body>
                </Table.Root>
              </Box>
            )}
          </Stack>
        )}

        {waiting && blocked && blockText && (
          <Alert.Root
            status={r.block === FoundRequestApproveBlock.OWN_REPORT ? "info" : "warning"}
            size="sm"
            data-testid={`found-request-block-${id}`}
            data-block={r.block}
          >
            <Alert.Indicator />
            <Alert.Description>
              <Span>{blockText}</Span>
            </Alert.Description>
          </Alert.Root>
        )}

        {waiting && (canApprove || canReject) && (
          <HStack gap="2" wrap="wrap">
            {canApprove && (
              <Button
                size="xs"
                colorPalette="brand"
                disabled={blocked}
                // A disabled button is given no handler, so nothing can reach the write through it.
                onClick={blocked ? undefined : onApprove}
                data-testid={`found-request-approve-${id}`}
              >
                <Icon as={Check} boxSize="4" />
                {t("foundRequest.approve")}
              </Button>
            )}
            {canReject && (
              <Button size="xs" variant="outline" onClick={onReject} data-testid={`found-request-reject-${id}`}>
                <Icon as={own ? Undo2 : X} boxSize="4" />
                {t(own ? "foundRequest.withdraw" : "foundRequest.reject")}
              </Button>
            )}
          </HStack>
        )}
      </Card.Body>
    </Card.Root>
  );
}
