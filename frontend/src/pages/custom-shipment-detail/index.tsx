import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router-dom";
import { Box, Button, Flex, Heading, Icon, IconButton, Spacer, Spinner, Stack, Text } from "@chakra-ui/react";
import { ArrowLeft } from "lucide-react";

import { rpcError } from "../../api/clients";
import { TeamType } from "../../gen/warehouse/team/v1/team_pb";
import { useTeam } from "../../features/team/TeamContext";
import { CUSTOM_SHIPMENTS_PATH } from "../../features/customShipment/customShipments";
import { useCustomShipment } from "../../features/customShipment/queries";
import { CustomShipmentKindBadge, CustomShipmentStatusBadge } from "../../features/customShipment/CustomShipmentBadges";
import { LinesCard, ParcelCard } from "../../features/customShipment/CustomShipmentCards";
import { CustomShipmentTimeline } from "../../features/customShipment/CustomShipmentTimeline";
import { SellingCustomShipmentActions } from "../../features/customShipment/SellingCustomShipmentActions";
import { useIsMobile } from "../../layouts/shell";
// The warehouse's goods-missing note (backlog #88 P6) — the open note's notice above the parcel while Diminta.
import { GoodsMissingNotice } from "../../features/customShipment/GoodsMissing";
import { parseShipmentId } from "../custom-shipment-pick";

// ONE PARCEL AS ITS OWNER READS IT — the transfer's selling detail shape: the title with its status and kind, the team's
// acts in the header (Ubah Ongkir for *Kami bayar*, Batalkan while Diminta — sellingActions), the parcel, the lines with
// the sample's value (the team sees every sample of its goods — a-sample-is-a-stock-out-at-batch-value), and the trail:
// Diminta → Diambil → Diserahkan, or Dibatalkan. The warehouse's acts never appear here. The phone header is ONE row —
// back, the number, the status, ⋯.
export function CustomShipmentDetailPage() {
  const { t } = useTranslation();
  const { shipmentId } = useParams();
  const navigate = useNavigate();
  const { current } = useTeam();
  const isMobile = useIsMobile();

  const id = parseShipmentId(shipmentId);
  const back = () => navigate(CUSTOM_SHIPMENTS_PATH);
  const selling = current?.teamType === TeamType.SELLING;
  // CustomShipmentDetail as the owning team — another team's parcel reads NotFound, said as not found.
  const query = useCustomShipment({ teamId: selling ? current?.teamId : undefined, id });

  if (!current || !selling) {
    return (
      <Text color="fg.muted" data-testid="custom-shipment-wrong-team">
        {t("customShipment.sellingOnly")}
      </Text>
    );
  }

  const shipment = query.data ?? null;

  if (id > 0n && query.isPending) {
    return <Spinner colorPalette="brand" data-testid="custom-shipment-loading" />;
  }

  if (query.isError || !shipment) {
    return (
      <Stack gap="section">
        <Button size="xs" variant="ghost" alignSelf="flex-start" data-testid="custom-shipment-back" onClick={back}>
          <Icon as={ArrowLeft} boxSize="4" />
          {t("customShipment.detail.back")}
        </Button>
        {query.isError ? (
          <Text color="error.fg" data-testid="custom-shipment-error">
            {rpcError(query.error)}
          </Text>
        ) : (
          <Text color="error.fg" data-testid="custom-shipment-not-found">
            {t("customShipment.detail.notFound")}
          </Text>
        )}
      </Stack>
    );
  }

  return (
    <Stack gap="section" data-testid="custom-shipment-detail-page">
      {isMobile ? (
        <Flex align="center" gap="2">
          <IconButton size="xs" variant="ghost" aria-label={t("customShipment.detail.back")} data-testid="custom-shipment-back" onClick={back}>
            <Icon as={ArrowLeft} boxSize="4" />
          </IconButton>
          <Heading size="md" data-testid="custom-shipment-title">
            #{shipment.id.toString()}
          </Heading>
          <Box data-testid="custom-shipment-detail-status">
            <CustomShipmentStatusBadge status={shipment.status} />
          </Box>
          <CustomShipmentKindBadge kind={shipment.kind} />
          <Spacer />
          <SellingCustomShipmentActions shipment={shipment} variant="menu" />
        </Flex>
      ) : (
        <>
          <Button size="xs" variant="ghost" alignSelf="flex-start" data-testid="custom-shipment-back" onClick={back}>
            <Icon as={ArrowLeft} boxSize="4" />
            {t("customShipment.detail.back")}
          </Button>
          <Flex align="center" gap="card" wrap="wrap">
            <Heading size="md" data-testid="custom-shipment-title">
              {t("customShipment.detail.title", { id: shipment.id.toString() })}
            </Heading>
            <Box data-testid="custom-shipment-detail-status">
            <CustomShipmentStatusBadge status={shipment.status} />
          </Box>
            <CustomShipmentKindBadge kind={shipment.kind} />
            <Spacer />
            <SellingCustomShipmentActions shipment={shipment} variant="buttons" />
          </Flex>
        </>
      )}

      <GoodsMissingNotice shipment={shipment} side="selling" />
      <ParcelCard shipment={shipment} side="selling" />
      <LinesCard shipment={shipment} showValue />
      <CustomShipmentTimeline shipment={shipment} side="selling" />
    </Stack>
  );
}
