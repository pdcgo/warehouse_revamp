import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router-dom";
import { Badge, Box, Button, Flex, Heading, Icon, IconButton, Spacer, Spinner, Stack, Text } from "@chakra-ui/react";
import { ArrowLeft } from "lucide-react";

import { rpcError } from "../../api/clients";
import { useTeam } from "../../features/team/TeamContext";
import { useWarehouseTransfer } from "../../features/warehouseTransfer/queries";
import { parseTransferId, problemUnits } from "../../features/warehouseTransfer/summary";
import { SellingTransferActions } from "../../features/warehouseTransfer/SellingTransferActions";
import { TransferTimeline } from "../../features/warehouseTransfer/TransferTimeline";
import { ParcelCard, RouteCard, TransferLinesCard } from "../../features/warehouseTransfer/TransferDetailCards";
import { NotImplementedSummary } from "../../features/pending/NotImplementedSummary";
import { WarehouseTransferStatusBadge } from "../../components/badges/WarehouseTransferStatusBadge";
import { useIsMobile } from "../../layouts/shell";
import { TRANSFER_SELLING_DETAIL_PENDING } from "./pending";

// WarehouseTransferSellingDetailPage — one transfer as its OWNER reads it: where it goes, the trip and what it costs,
// the lines with their values, and the trail. The team's acts sit in the header (SellingTransferActions); the
// warehouses' acts never appear here. The phone header is ONE row — back, the number, the status, ⋯.
export function WarehouseTransferSellingDetailPage() {
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

  // Units that did not make it are the team's loss, so they sit in the header.
  const problems = problemUnits(transfer);
  const status = (
    <Box data-testid="transfer-detail-status">
      <WarehouseTransferStatusBadge status={transfer.status} />
    </Box>
  );
  const problemBadge = problems > 0n && (
    <Badge colorPalette="warning" data-testid="transfer-detail-problems">
      {t("warehouseTransfer.table.problemUnits", { count: Number(problems) })}
    </Badge>
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
            <SellingTransferActions
              transfer={transfer}
              teamId={teamId}
              variant="menu"
              pending={TRANSFER_SELLING_DETAIL_PENDING}
            />
          </Flex>
          {problemBadge && <Box>{problemBadge}</Box>}
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
            {problemBadge}
            <Spacer />
            <SellingTransferActions
              transfer={transfer}
              teamId={teamId}
              variant="buttons"
              pending={TRANSFER_SELLING_DETAIL_PENDING}
            />
          </Flex>
        </>
      )}

      <NotImplementedSummary list={TRANSFER_SELLING_DETAIL_PENDING} />

      <RouteCard transfer={transfer} />
      <ParcelCard transfer={transfer} teamId={teamId} showMoney />
      <TransferLinesCard transfer={transfer} showPrices showPicks={false} />
      <TransferTimeline transfer={transfer} />
    </Stack>
  );
}
