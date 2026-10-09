import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router-dom";
import {
  Badge,
  Box,
  Button,
  Card,
  Flex,
  HStack,
  Heading,
  Icon,
  IconButton,
  Link,
  Separator,
  SimpleGrid,
  Spacer,
  Spinner,
  Stack,
  Text,
} from "@chakra-ui/react";
import { ArrowLeft, ExternalLink } from "lucide-react";

import { rpcError } from "../../api/clients";
import { RestockRequestStatus } from "../../gen/warehouse/inventory/v1/restock_request_pb";
import { useTeam } from "../../features/team/TeamContext";
import { useTeamDetail } from "../../features/teams/queries";
import { useShipmentChannelsByIds } from "../../features/shipment/queries";
import { useRestockRequest } from "../../features/restock/queries";
import { DetailField } from "../../features/restock/DetailField";
import { committedValue, courierCharge, goodsTotal, shortfall } from "../../features/restock/summary";
import { NotImplemented } from "../../features/pending/NotImplemented";
import { NotImplementedSummary } from "../../features/pending/NotImplementedSummary";
import { RestockStatusBadge } from "../../components/badges/RestockStatusBadge";
import { ShipmentChannelBadge } from "../../components/badges/ShipmentChannelBadge";
import { useIsMobile } from "../../layouts/shell";
import { formatUnixDateTime } from "../../lib/datetime";
import { formatRupiah } from "../../lib/money";
import { LinesCard } from "./components/LinesCard";
import { RestockTimeline } from "../../features/restock/RestockTimeline";
import { WarehouseRestockActions } from "../../features/restock/WarehouseRestockActions";
import { RESTOCK_WAREHOUSE_DETAIL_PENDING as PENDING } from "./pending";

function parseRequestId(raw: string | undefined): bigint {
  if (!raw) return 0n;
  try {
    return BigInt(raw);
  } catch {
    return 0n;
  }
}

// RestockWarehouseDetailPage — ONE DELIVERY AS THE RECEIVING WAREHOUSE SEES IT.
//
// The warehouse owns the two acts at its door (the-warehouse-signs-and-accepts-the-team-does-the-rest): it SIGNS for the
// box (ongoing → arrived, or a lost parcel that turned up, lost → arrived — a-late-lost-box-is-signed-for-as-arrived) and
// ACCEPTS it (ongoing or arrived → accepted). Those are this header's actions, with Print Labels and Receipt once it is
// counted in. Everything else about the restock is the selling team's, and is only read here.
//
// What it shows, top to bottom: the parcel (who sent it, the courier, the tracking number and its photo — what finds the
// box), the selling team's note, the lines as counted with WHERE the good units went, the money — and the courier's
// charge this warehouse paid at the door, owed back by the selling team and never part of the total
// (the-couriers-charge-stays-out-of-total) — then the trail.
//
// NOT HERE: which account paid, and the invoice. They are the selling team's purchase terms, and its accounts are not
// readable from the warehouse (FinancialAccountByIds is scoped to the owning team).
export function RestockWarehouseDetailPage() {
  const { t } = useTranslation();
  const { requestId } = useParams();
  const navigate = useNavigate();
  const { current } = useTeam();
  const isMobile = useIsMobile();

  const id = parseRequestId(requestId);
  const teamId = current?.teamId;

  const query = useRestockRequest({ teamId, requestId: id });

  const request = query.data ?? null;
  const loading = query.isPending && id !== 0n;

  const error = id === 0n ? t("restock.detail.invalidId") : query.isError ? rpcError(query.error) : "";

  const requestingTeamId = request?.requestingTeamId ?? 0n;

  // Who the goods are coming FROM. TeamDetail is unscoped, so the name resolves for either side.
  const requester = useTeamDetail({ teamId: requestingTeamId, enabled: requestingTeamId > 0n });
  const channels = useShipmentChannelsByIds(request ? [request.shipmentId] : []);

  const back = () => navigate("/inventories/restock");

  if (!current) {
    return (
      <Stack gap="section">
        <Heading size="md">{t("restock.detail.title")}</Heading>
        <Text color="fg.muted" data-testid="restock-detail-no-team">
          {t("restock.selectTeam")}
        </Text>
      </Stack>
    );
  }

  if (loading) {
    return <Spinner colorPalette="brand" />;
  }

  if (error || !request || teamId === undefined) {
    return (
      <Stack gap="section">
        <Button size="xs" variant="ghost" alignSelf="flex-start" data-testid="restock-detail-back" onClick={back}>
          <Icon as={ArrowLeft} boxSize="4" />
          {t("restock.detail.back")}
        </Button>
        <Text color="error.fg" data-testid="restock-detail-error">
          {error || t("restock.detail.notFound")}
        </Text>
      </Stack>
    );
  }

  const missing = shortfall(request);
  const fromName = requester.data?.name || t("restock.teamRef", { id: request.requestingTeamId.toString() });
  const accepted = request.status === RestockRequestStatus.ACCEPTED;
  const charge = courierCharge(request);

  const status = (
    <Box data-testid="restock-detail-status">
      <RestockStatusBadge status={request.status} />
    </Box>
  );
  const missingBadge = missing > 0n && (
    <Badge colorPalette="warning" data-testid="restock-detail-missing">
      {t("restock.detail.missingBadge", { count: Number(missing) })}
    </Badge>
  );

  return (
    <Stack gap="section" data-testid="restock-detail-page">
      {isMobile ? (
        // THE PHONE HEADER IS ONE ROW — back, the number, the status, ⋯.
        <Stack gap="1">
          <Flex align="center" gap="2">
            <IconButton
              size="xs"
              variant="ghost"
              aria-label={t("restock.detail.back")}
              data-testid="restock-detail-back"
              onClick={back}
            >
              <Icon as={ArrowLeft} boxSize="4" />
            </IconButton>
            <Heading size="md" truncate data-testid="restock-detail-title">
              #{request.id.toString()}
            </Heading>
            {status}
            <Spacer />
            <WarehouseRestockActions request={request} teamId={teamId} variant="menu" pending={PENDING} />
          </Flex>
          {missingBadge && <Box>{missingBadge}</Box>}
        </Stack>
      ) : (
        <>
          <Button size="xs" variant="ghost" alignSelf="flex-start" data-testid="restock-detail-back" onClick={back}>
            <Icon as={ArrowLeft} boxSize="4" />
            {t("restock.detail.back")}
          </Button>

          <Flex align="center" gap="card" wrap="wrap">
            <Heading size="md" data-testid="restock-detail-title">
              {t("restock.detail.requestTitle", { id: request.id.toString() })}
            </Heading>
            {status}
            {missingBadge}
            <Spacer />
            <WarehouseRestockActions request={request} teamId={teamId} variant="buttons" pending={PENDING} />
          </Flex>
        </>
      )}

      <NotImplementedSummary list={PENDING} />

      {/* THE PARCEL — what finds the box at the door: who sent it, the courier, the tracking number and its photo. */}
      <Card.Root maxW="full" overflow="hidden">
        <Card.Body>
          <Stack gap="card">
            <Text fontSize="sm" fontWeight="medium" color="fg.muted">
              {t("restock.detail.delivery")}
            </Text>
            <SimpleGrid columns={{ base: 1, sm: 2, lg: 4 }} gap="card">
              <DetailField label={t("restock.detail.from")} value={fromName} testId="restock-detail-from" />
              <DetailField
                label={t("restock.detail.courier")}
                testId="restock-detail-courier"
                value={
                  <HStack gap="1.5">
                    <ShipmentChannelBadge
                      channelId={request.shipmentId}
                      channel={channels.data?.get(request.shipmentId.toString())}
                    />
                    <NotImplemented list={PENDING} id="courier" />
                  </HStack>
                }
              />
              <DetailField
                label={t("restock.detail.tracking")}
                testId="restock-detail-tracking"
                value={
                  <Stack gap="0.5">
                    <Text as="span">{request.receipt || "—"}</Text>
                    <HStack gap="1.5">
                      {request.receiptFile ? (
                        <Link
                          href={request.receiptFile}
                          target="_blank"
                          rel="noreferrer"
                          fontSize="xs"
                          data-testid="restock-detail-receipt-photo"
                        >
                          <Icon as={ExternalLink} boxSize="3" />
                          {t("restock.detail.receiptPhoto")}
                        </Link>
                      ) : (
                        <Text as="span" fontSize="xs" color="fg.muted">
                          {t("restock.detail.noReceiptPhoto")}
                        </Text>
                      )}
                      <NotImplemented list={PENDING} id="receiptPhoto" />
                    </HStack>
                  </Stack>
                }
              />
              <DetailField
                label={t("restock.detail.arrivedAt")}
                value={request.arrivedAtUnix > 0n ? formatUnixDateTime(request.arrivedAtUnix) : ""}
                testId="restock-detail-arrived-at"
              />
            </SimpleGrid>
          </Stack>
        </Card.Body>
      </Card.Root>

      {/* The selling team's note — its own help text on the form reads "anything the warehouse should know". */}
      <Card.Root maxW="full" overflow="hidden">
        <Card.Body>
          <Stack gap="card">
            <Text fontSize="sm" fontWeight="medium" color="fg.muted">
              {t("restock.detail.note")}
            </Text>
            <Text fontSize="sm" whiteSpace="pre-wrap" wordBreak="break-word" data-testid="restock-detail-note">
              {request.note || "—"}
            </Text>
          </Stack>
        </Card.Body>
      </Card.Root>

      <LinesCard request={request} teamId={teamId} />

      {/* THE MONEY — goods + shipping is the total; the courier's charge this warehouse paid at the door is owed back
          by the selling team, on its own line, and never added in (the-couriers-charge-stays-out-of-total). */}
      <Card.Root maxW="full" overflow="hidden">
        <Card.Body>
          <Stack gap="card">
            <Text fontSize="sm" fontWeight="medium" color="fg.muted">
              {t("restock.detail.payment")}
            </Text>
            <Stack gap="1" align="end">
              <Text fontSize="sm" color="fg.muted">
                {t("restock.detail.subtotal")}:{" "}
                <Text as="span" color="fg" data-testid="restock-detail-subtotal">
                  {formatRupiah(goodsTotal(request.items))}
                </Text>
              </Text>
              <Text fontSize="sm" color="fg.muted">
                {t("restock.detail.shipping")}:{" "}
                <Text as="span" color="fg" data-testid="restock-detail-shipping">
                  {formatRupiah(request.shipmentCost)}
                </Text>
              </Text>
              <Text fontSize="md" fontWeight="semibold" data-testid="restock-detail-total">
                {t("restock.detail.total")}: {formatRupiah(committedValue(request))}
              </Text>
            </Stack>

            {accepted && (
              <>
                <Separator />
                <Stack gap="1" data-testid="restock-detail-courier-charge-card">
                  <Text fontSize="sm" fontWeight="medium" color="fg.muted">
                    {t("restock.detail.courierCharge")}
                  </Text>
                  {charge > 0n ? (
                    <>
                      <Text fontWeight="semibold" data-testid="restock-detail-courier-charge">
                        {formatRupiah(charge)}
                      </Text>
                      <Text fontSize="sm" wordBreak="break-word" data-testid="restock-detail-courier-charge-note">
                        {request.warehouseAdditionalCostNote}
                      </Text>
                      <Text fontSize="xs" color="fg.muted">
                        {t("restock.detail.courierChargeOwedToUs", { team: fromName })}
                      </Text>
                    </>
                  ) : (
                    <Text fontSize="sm" color="fg.muted" data-testid="restock-detail-courier-charge-none">
                      {t("restock.detail.courierChargeNone")}
                    </Text>
                  )}
                </Stack>
              </>
            )}
          </Stack>
        </Card.Body>
      </Card.Root>

      <Stack gap="card">
        <Text fontSize="sm" fontWeight="medium" color="fg.muted">
          {t("restock.detail.tab.timeline")}
        </Text>
        <RestockTimeline request={request} />
      </Stack>
    </Stack>
  );
}
