import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router-dom";
import { Badge, Box, Button, Flex, Heading, Icon, IconButton, Spacer, Spinner, Stack, Text } from "@chakra-ui/react";
import { ArrowLeft } from "lucide-react";

import { rpcError } from "../../api/clients";
import { WarehouseTransferStatus as S } from "../../gen/warehouse/inventory/v1/warehouse_transfer_pb";
import { useTeam } from "../../features/team/TeamContext";
import { useWarehouseTransfer } from "../../features/warehouseTransfer/queries";
import { directionFor, parseTransferId } from "../../features/warehouseTransfer/summary";
import { WarehouseTransferActions } from "../../features/warehouseTransfer/WarehouseTransferActions";
import { TransferTimeline } from "../../features/warehouseTransfer/TransferTimeline";
import { ParcelCard, RouteCard, TransferLinesCard } from "../../features/warehouseTransfer/TransferDetailCards";
import { NotImplementedSummary } from "../../features/pending/NotImplementedSummary";
import { WarehouseTransferStatusBadge } from "../../components/badges/WarehouseTransferStatusBadge";
import { useIsMobile } from "../../layouts/shell";
import { TRANSFER_WAREHOUSE_DETAIL_PENDING } from "./pending";

// WarehouseTransferWarehouseDetailPage — one transfer as a WAREHOUSE reads it. Which warehouse decides what it shows:
//
//   A (outgoing) — the PICK LIST: per product, the racks the system chose at create (fewest first). Shown until it
//                  ships; after that the goods are gone from A's racks.
//   B (incoming) — once accepted, where the good units went and what was broken or missing.
//
// No values for either: the goods are the selling team's (TransferItemsCell and the lines card both hide them). The
// header carries the next act for this side (WarehouseTransferActions).
export function WarehouseTransferWarehouseDetailPage() {
  const { t } = useTranslation();
  const { transferId } = useParams();
  const navigate = useNavigate();
  const { current } = useTeam();
  const isMobile = useIsMobile();

  const id = parseTransferId(transferId);
  const teamId = current?.teamId;
  const query = useWarehouseTransfer({ teamId, transferId: id });
  const transfer = query.data ?? null;
  const loading = query.isPending && id !== 0n;
  const error = id === 0n ? t("warehouseTransfer.detail.invalidId") : query.isError ? rpcError(query.error) : "";

  const back = () => navigate("/inventories/transfer");

  if (!current) {
    return <Text color="fg.muted">{t("warehouseTransfer.selectTeam")}</Text>;
  }

  if (loading) {
    return <Spinner colorPalette="brand" />;
  }

  if (error || !transfer || teamId === undefined) {
    return (
      <Stack gap="section">
        <Button size="xs" variant="ghost" alignSelf="flex-start" data-testid="transfer-detail-back" onClick={back}>
          <Icon as={ArrowLeft} boxSize="4" />
          {t("warehouseTransfer.detail.back")}
        </Button>
        <Text color="error.fg" data-testid="transfer-detail-error">
          {error || t("warehouseTransfer.detail.notFound")}
        </Text>
      </Stack>
    );
  }

  const side = directionFor(transfer, teamId);
  const showPicks = side === "outgoing" && (transfer.status === S.CREATED || transfer.status === S.PROCESS);

  const sideBadge = (
    <Badge variant="subtle" data-testid="transfer-detail-side">
      {side === "outgoing" ? t("warehouseTransfer.direction.outgoing") : t("warehouseTransfer.direction.incoming")}
    </Badge>
  );
  const status = (
    <Box data-testid="transfer-detail-status">
      <WarehouseTransferStatusBadge status={transfer.status} />
    </Box>
  );

  return (
    <Stack gap="section" data-testid="transfer-detail-page">
      {isMobile ? (
        <Stack gap="1">
          <Flex align="center" gap="2">
            <IconButton
              size="xs"
              variant="ghost"
              aria-label={t("warehouseTransfer.detail.back")}
              data-testid="transfer-detail-back"
              onClick={back}
            >
              <Icon as={ArrowLeft} boxSize="4" />
            </IconButton>
            <Heading size="md" truncate data-testid="transfer-detail-title">
              #{transfer.id.toString()}
            </Heading>
            {status}
            <Spacer />
            <WarehouseTransferActions
              transfer={transfer}
              teamId={teamId}
              variant="menu"
              pending={TRANSFER_WAREHOUSE_DETAIL_PENDING}
            />
          </Flex>
          <Box>{sideBadge}</Box>
        </Stack>
      ) : (
        <>
          <Button size="xs" variant="ghost" alignSelf="flex-start" data-testid="transfer-detail-back" onClick={back}>
            <Icon as={ArrowLeft} boxSize="4" />
            {t("warehouseTransfer.detail.back")}
          </Button>
          <Flex align="center" gap="card" wrap="wrap">
            <Heading size="md" data-testid="transfer-detail-title">
              {t("warehouseTransfer.detail.title", { id: transfer.id.toString() })}
            </Heading>
            {status}
            {sideBadge}
            <Spacer />
            <WarehouseTransferActions
              transfer={transfer}
              teamId={teamId}
              variant="buttons"
              pending={TRANSFER_WAREHOUSE_DETAIL_PENDING}
            />
          </Flex>
        </>
      )}

      <NotImplementedSummary list={TRANSFER_WAREHOUSE_DETAIL_PENDING} />

      {showPicks && (
        <Text fontSize="sm" color="fg.muted" data-testid="transfer-detail-pick-hint">
          {t("warehouseTransfer.detail.pickHint")}
        </Text>
      )}
      <TransferLinesCard transfer={transfer} showPrices={false} showPicks={showPicks} />
      <RouteCard transfer={transfer} />
      <ParcelCard transfer={transfer} teamId={teamId} showMoney={false} />
      <TransferTimeline transfer={transfer} />
    </Stack>
  );
}
