import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link as RouterLink } from "react-router-dom";
import { Box, Button, Flex, HStack, Icon, Link, Span, Stack, Table, Text } from "@chakra-ui/react";
import { Check, Undo2, X } from "lucide-react";

import {
  type FoundRequest,
  FoundRequestApproveBlock,
  FoundRequestStatus,
} from "../../../gen/warehouse/inventory/v1/found_request_pb";
import type { Product } from "../../../gen/warehouse/product/v1/product_pb";
import type { Team } from "../../../gen/warehouse/team/v1/team_pb";
import { TeamItem } from "../../../components/entity/TeamItem";
import { ProductListItem } from "../../../components/products/ProductListItem";
import { useIsMobile } from "../../../layouts/shell";
import { formatUnixDateTimeShort } from "../../../lib/datetime";
import { formatRupiahNumber } from "../../../lib/money";
import { blockTextOf, decidedTextOf, isWithdrawn } from "./found";
import { FoundRequestStatusBadge } from "./FoundRequestStatusBadge";

// A ROW LIGHTS UP UNDER THE POINTER, every cell of it (a-table-row-lights-up) — and it opens the request's Rincian.
const LIGHTS_UP = { cursor: "pointer", _hover: { "& > td": { bg: "bg.muted" } } } as const;

export interface FoundRequestTableProps {
  requests: FoundRequest[];
  products: Map<string, Product> | undefined;
  teams: { [id: string]: Team } | undefined;
  nameOf: (id: bigint) => string;
  /** The Diputuskan column — every tab but Waiting, where nothing is decided yet. */
  showDecided: boolean;
  /** The warehouse Owner or Admin, not a monitor. */
  canApprove: boolean;
  /** Every reader but a monitor — a reporter's own reads Withdraw. */
  canReject: boolean;
  onOpen: (r: FoundRequest) => void;
  onApprove: (r: FoundRequest) => void;
  onReject: (r: FoundRequest) => void;
}

// THE FOUND STOCK LIST AS EVERY LIST IS (owner: *"listnya buat seperti yang lain, atau tabel saja"*,
// the-found-list-is-a-table) — one request a row, two lines a cell at most, and its Rincian behind a click on the row:
//
//   No.            Produk                       Pemilik          Ditemukan   Dilaporkan       Nilai               Aksi
//   #301           [img] Beras Pandan 5kg       [TM] Toko Melati 4 unit      Budi Santoso     Klaim Rp 189.000    [✓ Setujui] [✕ Tolak]
//   [Menunggu]           SKU-BERAS-5K ⧉                         B-02-1      10 Nov 09:12     Baru Rp 65.000
//
// The status sits under the reference, so the badges line up down the page (one-context-per-column-and-never-three-
// lines); why Setujui is off sits under the buttons. A phone reads each request as a block (a-phone-reads-each-line-as-a-
// block). What it posts, line by line, and the reporter's note are the Rincian's — the list carries them already, so it
// opens with no second read.
export function FoundRequestTable(props: FoundRequestTableProps) {
  const { t } = useTranslation();
  const isMobile = useIsMobile();
  const { requests, products, teams, nameOf, showDecided, canApprove, canReject, onOpen, onApprove, onReject } = props;
  const withActions = canApprove || canReject;

  const product = (r: FoundRequest) => {
    const p = products?.get(r.productId.toString());

    // The name and code are the REPORT's snapshot — what was found; the picture is the catalogue's.
    return (
      <ProductListItem
        productCodeCopyable
        product={{
          id: r.productId,
          name: r.productName,
          productCode: r.productCode,
          defaultImageUrl: p?.defaultImageUrl,
          defaultImageThumbnailUrl: p?.defaultImageThumbnailUrl,
        }}
      />
    );
  };

  // Whose goods — always a selling team, so the small avatar and the name (a-team-of-a-known-type-shows-no-badge).
  const owner = (r: FoundRequest) => {
    const team = teams?.[r.teamId.toString()];

    return (
      <Box data-testid={`found-request-owner-${r.id}`} minW="0">
        <TeamItem size="xs" team={{ teamId: r.teamId, teamName: team?.name, teamType: team?.type, imageUrl: team?.imageUrl }} />
      </Box>
    );
  };

  // What approving posts, or what it posted — money claimed back, and stock with no money. A rejection has none: it shows
  // why instead.
  const value = (r: FoundRequest): ReactNode => {
    if (r.status === FoundRequestStatus.REJECTED) {
      return (
        <Text fontSize="sm" color="fg.muted" lineClamp={2} data-testid={`found-request-reject-reason-${r.id}`}>
          {t("foundRequest.card.rejectReason", { reason: r.rejectReason })}
        </Text>
      );
    }
    if (r.claimedAmount <= 0 && r.mintedAmount <= 0) return <Text color="fg.muted">—</Text>;

    return (
      <Stack gap="0" fontSize="sm" fontVariantNumeric="tabular-nums">
        {r.claimedAmount > 0 && (
          <Span color="success.fg" whiteSpace="nowrap" data-testid={`found-request-claimed-${r.id}`}>
            {t("foundRequest.card.claimed", { amount: formatRupiahNumber(r.claimedAmount) })}
          </Span>
        )}
        {r.mintedAmount > 0 && (
          <Span color="info.fg" whiteSpace="nowrap" data-testid={`found-request-minted-${r.id}`}>
            {t("foundRequest.card.minted", { amount: formatRupiahNumber(r.mintedAmount) })}
          </Span>
        )}
      </Stack>
    );
  };

  // Who decided and when; one a count closed names the count, as a way there (a-count-settles-the-found-it-counted).
  const decided = (r: FoundRequest): ReactNode => {
    if (r.status === FoundRequestStatus.WAITING) return <Text color="fg.muted">—</Text>;

    if (r.status === FoundRequestStatus.SETTLED_BY_COUNT) {
      return (
        <Stack gap="0" fontSize="sm" data-testid={`found-request-decided-${r.id}`}>
          <Link asChild color="brand.fg" onClick={(e) => e.stopPropagation()} data-testid={`found-request-settled-link-${r.id}`}>
            <RouterLink to={`/inventories/opname/sessions/${r.settledByCountingSessionId.toString()}`}>
              {t("foundRequest.card.settledByCount", { id: r.settledByCountingSessionId.toString() })}
            </RouterLink>
          </Link>
          <Span fontSize="xs" color="fg.muted">
            {formatUnixDateTimeShort(r.decidedAtUnix)}
          </Span>
        </Stack>
      );
    }

    return (
      <Stack gap="0" fontSize="sm" data-testid={`found-request-decided-${r.id}`}>
        <Span title={decidedTextOf(r, t, nameOf(r.decidedById), formatUnixDateTimeShort(r.decidedAtUnix))}>
          {nameOf(r.decidedById)}
        </Span>
        <Span fontSize="xs" color="fg.muted">
          {formatUnixDateTimeShort(r.decidedAtUnix)}
        </Span>
      </Stack>
    );
  };

  // Setujui and Tolak (Tarik, the reporter's own) — and why Setujui is off, under them. A click here never opens the row.
  const actions = (r: FoundRequest): ReactNode => {
    if (r.status !== FoundRequestStatus.WAITING || !withActions) return null;
    const blocked = r.block !== FoundRequestApproveBlock.UNSPECIFIED;
    const own = r.block === FoundRequestApproveBlock.OWN_REPORT;
    const why = blockTextOf(r, t);

    return (
      <Stack gap="1" align="flex-start" onClick={(e) => e.stopPropagation()}>
        <HStack gap="2">
          {canApprove && (
            <Button
              size="xs"
              colorPalette="brand"
              disabled={blocked}
              // A disabled button is given no handler, so nothing can reach the write through it.
              onClick={blocked ? undefined : () => onApprove(r)}
              data-testid={`found-request-approve-${r.id}`}
            >
              <Icon as={Check} boxSize="4" />
              {t("foundRequest.approve")}
            </Button>
          )}
          {canReject && (
            <Button size="xs" variant="outline" onClick={() => onReject(r)} data-testid={`found-request-reject-${r.id}`}>
              <Icon as={own ? Undo2 : X} boxSize="4" />
              {t(own ? "foundRequest.withdraw" : "foundRequest.reject")}
            </Button>
          )}
        </HStack>
        {canApprove && blocked && why && (
          <Text
            fontSize="xs"
            color={own ? "fg.muted" : "warning.fg"}
            maxW="18rem"
            data-testid={`found-request-block-${r.id}`}
            data-block={r.block}
          >
            {why}
          </Text>
        )}
      </Stack>
    );
  };

  const units = (r: FoundRequest) => t("foundRequest.table.units", { count: Number(r.stockCount) });

  if (isMobile) {
    return (
      <Stack gap="3" data-testid="found-requests-list">
        {requests.map((r) => (
          // A BLOCK PER REQUEST — it opens the Rincian, so it lights up under a finger too.
          <Stack
            key={r.id.toString()}
            gap="2"
            borderWidth="1px"
            borderRadius="md"
            p="3"
            cursor="pointer"
            _hover={{ bg: "bg.muted" }}
            onClick={() => onOpen(r)}
            data-testid={`found-request-${r.id}`}
          >
            <HStack gap="2">
              <Span fontWeight="bold">#{r.id.toString()}</Span>
              <FoundRequestStatusBadge status={r.status} withdrawn={isWithdrawn(r)} />
            </HStack>
            {product(r)}
            <Flex align="center" justify="space-between" gap="2">
              {owner(r)}
              <Text fontSize="sm" flexShrink={0} data-testid={`found-request-units-${r.id}`}>
                <Span fontWeight="bold">{units(r)}</Span>
                {` · ${r.rackCode}`}
              </Text>
            </Flex>
            <Text fontSize="xs" color="fg.muted" data-testid={`found-request-reported-${r.id}`}>
              {t("foundRequest.card.reported", { name: nameOf(r.reportedById), when: formatUnixDateTimeShort(r.reportedAtUnix) })}
            </Text>
            {/* Decided, as a sentence — a block has the width for it; a count's close keeps its link. */}
            {r.status === FoundRequestStatus.SETTLED_BY_COUNT
              ? decided(r)
              : r.status !== FoundRequestStatus.WAITING && (
                  <Text fontSize="xs" color="fg.muted" data-testid={`found-request-decided-${r.id}`}>
                    {decidedTextOf(r, t, nameOf(r.decidedById), formatUnixDateTimeShort(r.decidedAtUnix))}
                  </Text>
                )}
            {value(r)}
            {actions(r)}
          </Stack>
        ))}
      </Stack>
    );
  }

  return (
    // The table scrolls inside its own box, never the page.
    <Box overflowX="auto" w="full" maxW="full" minW="0">
      <Table.Root size="sm" data-testid="found-requests-list">
        <Table.Header>
          <Table.Row>
            <Table.ColumnHeader>{t("foundRequest.table.no")}</Table.ColumnHeader>
            <Table.ColumnHeader>{t("foundRequest.table.product")}</Table.ColumnHeader>
            <Table.ColumnHeader>{t("foundRequest.table.owner")}</Table.ColumnHeader>
            <Table.ColumnHeader>{t("foundRequest.table.found")}</Table.ColumnHeader>
            <Table.ColumnHeader>{t("foundRequest.table.reported")}</Table.ColumnHeader>
            {showDecided && <Table.ColumnHeader>{t("foundRequest.table.decided")}</Table.ColumnHeader>}
            <Table.ColumnHeader>{t("foundRequest.table.value")}</Table.ColumnHeader>
            {withActions && <Table.ColumnHeader>{t("foundRequest.table.actions")}</Table.ColumnHeader>}
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {requests.map((r) => (
            <Table.Row
              key={r.id.toString()}
              css={LIGHTS_UP}
              onClick={() => onOpen(r)}
              data-testid={`found-request-${r.id}`}
              verticalAlign="top"
            >
              {/* The reference, its status under it — the badges line up down the page. */}
              <Table.Cell>
                <Stack gap="1" align="flex-start">
                  <Span fontWeight="bold">#{r.id.toString()}</Span>
                  <FoundRequestStatusBadge status={r.status} withdrawn={isWithdrawn(r)} />
                </Stack>
              </Table.Cell>
              <Table.Cell minW="14rem">{product(r)}</Table.Cell>
              <Table.Cell>{owner(r)}</Table.Cell>
              {/* What was found, where — one fact, read twice. */}
              <Table.Cell data-testid={`found-request-units-${r.id}`}>
                <Stack gap="0">
                  <Span fontWeight="bold" whiteSpace="nowrap">
                    {units(r)}
                  </Span>
                  <Span fontSize="xs" color="fg.muted">
                    {r.rackCode}
                  </Span>
                </Stack>
              </Table.Cell>
              <Table.Cell data-testid={`found-request-reported-${r.id}`}>
                <Stack gap="0" fontSize="sm">
                  <Span>{nameOf(r.reportedById)}</Span>
                  <Span fontSize="xs" color="fg.muted" whiteSpace="nowrap">
                    {formatUnixDateTimeShort(r.reportedAtUnix)}
                  </Span>
                </Stack>
              </Table.Cell>
              {showDecided && <Table.Cell>{decided(r)}</Table.Cell>}
              <Table.Cell>{value(r)}</Table.Cell>
              {withActions && <Table.Cell>{actions(r)}</Table.Cell>}
            </Table.Row>
          ))}
        </Table.Body>
      </Table.Root>
    </Box>
  );
}
