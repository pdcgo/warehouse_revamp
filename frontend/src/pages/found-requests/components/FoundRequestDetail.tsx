import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link as RouterLink } from "react-router-dom";
import {
  Alert,
  Badge,
  Box,
  Button,
  CloseButton,
  Dialog,
  Drawer,
  HStack,
  Icon,
  Link,
  Portal,
  Span,
  Stack,
  Table,
  Text,
} from "@chakra-ui/react";
import { Check, ClipboardCheck, Undo2, X } from "lucide-react";

import {
  type FoundRequest,
  FoundRequestApproveBlock,
  FoundRequestPostType,
  FoundRequestStatus,
} from "../../../gen/warehouse/inventory/v1/found_request_pb";
import type { Product } from "../../../gen/warehouse/product/v1/product_pb";
import type { Team } from "../../../gen/warehouse/team/v1/team_pb";
import { TeamItem } from "../../../components/entity/TeamItem";
import { ProductListItem } from "../../../components/products/ProductListItem";
import { useIsMobile } from "../../../layouts/shell";
import { formatUnixDateShort, formatUnixDateTimeShort } from "../../../lib/datetime";
import { formatRupiahNumber } from "../../../lib/money";
import { POST, blockTextOf, decidedTextOf, isWithdrawn } from "./found";
import { FoundRequestStatusBadge } from "./FoundRequestStatusBadge";

// A ROW LIGHTS UP UNDER THE POINTER, every cell of it (a-table-row-lights-up).
const LIGHTS_UP = { _hover: { "& > td": { bg: "bg.muted" } } } as const;

export interface FoundRequestDetailProps {
  /** The request to read; null = shut. */
  request: FoundRequest | null;
  product?: Product;
  team?: Team;
  nameOf: (id: bigint) => string;
  onClose: () => void;
  canApprove: boolean;
  canReject: boolean;
  onApprove: (r: FoundRequest) => void;
  onReject: (r: FoundRequest) => void;
}

// THE REQUEST'S RINCIAN (the-found-list-is-a-table, a-breakdown-opens-from-rincian) — what the row leaves out: the
// reporter's note, the decision's line, and what approving posts line by line — the oldest open losses claimed back at
// their price, then what it mints (an-adjust-found-waits-for-the-owner-or-admin). A dialog on a desktop, a sheet from the
// bottom on a phone. Setujui and Tolak are at its foot too: it is where the approver has read everything.
export function FoundRequestDetail(props: FoundRequestDetailProps) {
  const { t } = useTranslation();
  const isMobile = useIsMobile();
  const { request: r, onClose } = props;
  const open = r !== null;

  const title = r ? (
    <HStack gap="2" wrap="wrap">
      <Span>{t("foundRequest.detail.title", { id: r.id.toString() })}</Span>
      <FoundRequestStatusBadge status={r.status} withdrawn={isWithdrawn(r)} />
    </HStack>
  ) : null;
  const body = r ? <Body {...props} request={r} compact={isMobile} /> : null;
  const foot = r ? <Foot {...props} request={r} /> : null;

  if (isMobile) {
    return (
      <Drawer.Root open={open} onOpenChange={(e) => !e.open && onClose()} placement="bottom">
        <Portal>
          <Drawer.Backdrop />
          <Drawer.Positioner>
            <Drawer.Content roundedTop="l3" maxH="88dvh" data-testid="found-detail">
              <Drawer.Header>
                <Drawer.Title>{title}</Drawer.Title>
              </Drawer.Header>
              <Drawer.CloseTrigger asChild>
                <CloseButton size="sm" />
              </Drawer.CloseTrigger>
              <Drawer.Body pb="4">{body}</Drawer.Body>
              {foot && <Drawer.Footer>{foot}</Drawer.Footer>}
            </Drawer.Content>
          </Drawer.Positioner>
        </Portal>
      </Drawer.Root>
    );
  }

  return (
    <Dialog.Root open={open} onOpenChange={(e) => !e.open && onClose()} size="lg" scrollBehavior="inside">
      <Portal>
        <Dialog.Backdrop />
        <Dialog.Positioner>
          <Dialog.Content data-testid="found-detail">
            <Dialog.Header>
              <Dialog.Title>{title}</Dialog.Title>
            </Dialog.Header>
            <Dialog.CloseTrigger asChild>
              <CloseButton size="sm" />
            </Dialog.CloseTrigger>
            <Dialog.Body pb="6">{body}</Dialog.Body>
            {foot && <Dialog.Footer>{foot}</Dialog.Footer>}
          </Dialog.Content>
        </Dialog.Positioner>
      </Portal>
    </Dialog.Root>
  );
}

function Body({
  request: r,
  product,
  team,
  nameOf,
  compact,
}: FoundRequestDetailProps & { request: FoundRequest; compact: boolean }) {
  const { t } = useTranslation();
  const approved = r.status === FoundRequestStatus.APPROVED;
  const rejected = r.status === FoundRequestStatus.REJECTED;
  const settled = r.status === FoundRequestStatus.SETTLED_BY_COUNT;
  const why = r.status === FoundRequestStatus.WAITING ? blockTextOf(r, t) : "";

  const batchCell = (l: FoundRequest["lines"][number]) =>
    l.type === FoundRequestPostType.MINT
      ? l.batchId > 0n
        ? t("foundRequest.lines.newBatchId", { id: l.batchId.toString() })
        : t("foundRequest.lines.newBatch")
      : `#${l.batchId.toString()} · ${t("foundRequest.lines.claims", {
          id: l.problemId.toString(),
          // A table's date is short (a-table-date-is-short-and-every-time-is-wib).
          date: formatUnixDateShort(l.problemCreatedAtUnix),
        })}`;

  let lines: ReactNode = null;
  if (r.lines.length > 0) {
    lines = compact ? (
      // A phone reads each posting line as a block (a-phone-reads-each-line-as-a-block).
      <Stack gap="2">
        {r.lines.map((l, i) => (
          <Stack key={i} gap="0" fontSize="sm" data-testid={`found-detail-line-${i}`}>
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
              <Table.Row key={i} css={LIGHTS_UP} data-testid={`found-detail-line-${i}`}>
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
    );
  }

  return (
    <Stack gap="card">
      {/* What, whose, how many, where. The name and code are the report's snapshot; the picture is the catalogue's. */}
      <Stack gap="2">
        <ProductListItem
          productCodeCopyable
          product={{
            id: r.productId,
            name: r.productName,
            productCode: r.productCode,
            defaultImageUrl: product?.defaultImageUrl,
            defaultImageThumbnailUrl: product?.defaultImageThumbnailUrl,
          }}
        />
        <TeamItem size="xs" team={{ teamId: r.teamId, teamName: team?.name, teamType: team?.type, imageUrl: team?.imageUrl }} />
      </Stack>

      <Stack gap="0" fontSize="sm">
        <Text fontWeight="bold" data-testid="found-detail-units">
          {t("foundRequest.card.units", { count: Number(r.stockCount), rack: r.rackCode })}
        </Text>
        <Text color="fg.muted" data-testid="found-detail-reported">
          {t("foundRequest.card.reported", { name: nameOf(r.reportedById), when: formatUnixDateTimeShort(r.reportedAtUnix) })}
        </Text>
        {r.status !== FoundRequestStatus.WAITING && (
          <Text color="fg.muted" data-testid="found-detail-decided">
            {decidedTextOf(r, t, nameOf(r.decidedById), formatUnixDateTimeShort(r.decidedAtUnix))}
          </Text>
        )}
      </Stack>

      {/* The note the approver decides on. */}
      <Text fontSize="sm" fontStyle="italic" color={r.note ? "fg" : "fg.muted"} data-testid="found-detail-note">
        {r.note ? `“${r.note}”` : t("foundRequest.card.noNote")}
      </Text>

      {rejected && (
        <Text fontSize="sm" data-testid="found-detail-reject-reason">
          {t("foundRequest.card.rejectReason", { reason: r.rejectReason })}
        </Text>
      )}

      {/* The count posted these units itself — approving them too would post them twice. */}
      {settled && (
        <Alert.Root status="info" size="sm" data-testid="found-detail-settled">
          <Alert.Indicator>
            <Icon as={ClipboardCheck} boxSize="4" />
          </Alert.Indicator>
          <Alert.Description>
            <Stack gap="0.5">
              <Link asChild color="brand.fg" fontWeight="bold" data-testid="found-detail-settled-link">
                <RouterLink to={`/inventories/opname/sessions/${r.settledByCountingSessionId.toString()}`}>
                  {t("foundRequest.card.settledByCount", { id: r.settledByCountingSessionId.toString() })}
                </RouterLink>
              </Link>
              <Span>{t("foundRequest.card.settledLine")}</Span>
            </Stack>
          </Alert.Description>
        </Alert.Root>
      )}

      {lines && (
        <Stack gap="2" data-testid="found-detail-lines">
          <HStack justify="space-between" gap="2" wrap="wrap">
            <Text fontSize="sm" fontWeight="bold">
              {approved
                ? t("foundRequest.card.postedTitle", { id: r.transactionId.toString() })
                : t("foundRequest.card.wouldTitle")}
            </Text>
            <HStack gap="3" fontSize="sm" fontVariantNumeric="tabular-nums">
              {r.claimedAmount > 0 && (
                <Span color="success.fg">{t("foundRequest.card.claimed", { amount: formatRupiahNumber(r.claimedAmount) })}</Span>
              )}
              {r.mintedAmount > 0 && (
                <Span color="info.fg">{t("foundRequest.card.minted", { amount: formatRupiahNumber(r.mintedAmount) })}</Span>
              )}
            </HStack>
          </HStack>
          {lines}
        </Stack>
      )}

      {why && (
        <Alert.Root
          status={r.block === FoundRequestApproveBlock.OWN_REPORT ? "info" : "warning"}
          size="sm"
          data-testid="found-detail-block"
        >
          <Alert.Indicator />
          <Alert.Description>{why}</Alert.Description>
        </Alert.Root>
      )}
    </Stack>
  );
}

// Setujui and Tolak (Tarik, the reporter's own) — only for a waiting request someone here may decide.
function Foot({ request: r, canApprove, canReject, onApprove, onReject }: FoundRequestDetailProps & { request: FoundRequest }) {
  const { t } = useTranslation();
  if (r.status !== FoundRequestStatus.WAITING || !(canApprove || canReject)) return null;
  const blocked = r.block !== FoundRequestApproveBlock.UNSPECIFIED;
  const own = r.block === FoundRequestApproveBlock.OWN_REPORT;

  return (
    <HStack gap="2">
      {canReject && (
        <Button variant="outline" onClick={() => onReject(r)} data-testid="found-detail-reject">
          <Icon as={own ? Undo2 : X} boxSize="4" />
          {t(own ? "foundRequest.withdraw" : "foundRequest.reject")}
        </Button>
      )}
      {canApprove && (
        <Button
          colorPalette="brand"
          disabled={blocked}
          onClick={blocked ? undefined : () => onApprove(r)}
          data-testid="found-detail-approve"
        >
          <Icon as={Check} boxSize="4" />
          {t("foundRequest.approve")}
        </Button>
      )}
    </HStack>
  );
}
