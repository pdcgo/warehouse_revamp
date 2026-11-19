import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router-dom";
import { create } from "@bufbuild/protobuf";
import { Box, Button, Card, Flex, Heading, Icon, IconButton, Spacer, Stack, Text } from "@chakra-ui/react";
import { ArrowLeft, StickyNote, Truck } from "lucide-react";

import { OrderItemSchema } from "../../gen/warehouse/selling/v1/order_pb";
import { canWrite, useTeam } from "../../features/team/TeamContext";
import { CUSTOM_SHIPMENTS_PATH } from "../../features/customShipment/customShipments";
import { useCustomShipmentPrototype } from "../../features/customShipment/customShipmentPrototype";
import { CustomShipmentKindBadge, CustomShipmentStatusBadge } from "../../features/customShipment/CustomShipmentBadges";
import { LinesCard, ParcelCard } from "../../features/customShipment/CustomShipmentCards";
import { CustomShipmentTimeline } from "../../features/customShipment/CustomShipmentTimeline";
import { HandoverDialog } from "../../features/customShipment/HandoverDialog";
import { ItemScan } from "../pick-order/components/ItemScan";
import { toaster } from "../../components/feedback/Toaster";
import { useIsMobile } from "../../layouts/shell";

export function parseShipmentId(raw: string | undefined): bigint {
  try {
    return raw && /^\d+$/.test(raw) ? BigInt(raw) : 0n;
  } catch {
    return 0n;
  }
}

// THE WAREHOUSE'S PAGE FOR ONE PARCEL — the order pick page's shape (pages/pick-order), one step at a time:
//
//   Diminta    the pick list, then the item scans below it — every unit scanned by its product code, then Sudah Diambil
//              (the order's Set Picked: the-item-scans-live-on-the-page, ItemScan reused as it is)
//   Diambil    Serahkan ke Kurir — the handover dialog, the cost typed there when *Gudang bayar*
//   Diserahkan the parcel is done; the page reads its trail
//
// THE PICK LIST, BY KIND. A sample's racks are those its take drew at create, each with its count (two racks are two
// walks). A reship's units were never on a rack (a-restocks-broken-units-are-just-broken-for-now): the page names the
// restock they came from and the broken note written at Terima — where the broken goods lie is the warehouse's own
// knowledge, untracked for now.
//
// The team's note sits ABOVE the list, as an order's notes do — an instruction is read before the walk starts. The
// warehouse sees no seller money (a-warehouse-sees-no-seller-money): no values, and of a *Kami bayar* ongkir only that it
// must not pay the courier (the-warehouse-sees-the-ongkir-it-paid).
export function CustomShipmentPickPage() {
  const { t } = useTranslation();
  const { shipmentId } = useParams();
  const navigate = useNavigate();
  const { current } = useTeam();
  const isMobile = useIsMobile();
  const prototype = useCustomShipmentPrototype();
  const [handing, setHanding] = useState(false);

  const id = parseShipmentId(shipmentId);
  const back = () => navigate(CUSTOM_SHIPMENTS_PATH);

  if (!prototype) {
    return (
      <Text color="fg.muted" data-testid="custom-shipment-unavailable">
        {t("customShipment.unavailable")}
      </Text>
    );
  }

  if (!current || prototype.side !== "warehouse") {
    return (
      <Text color="fg.muted" data-testid="custom-shipment-wrong-team">
        {t("customShipment.warehouseOnly")}
      </Text>
    );
  }

  const shipment = prototype.detail(id);
  const backButton = (
    <Button size="xs" variant="ghost" alignSelf="flex-start" data-testid="custom-shipment-back" onClick={back}>
      <Icon as={ArrowLeft} boxSize="4" />
      {t("customShipment.detail.backToQueue")}
    </Button>
  );

  if (!shipment) {
    return (
      <Stack gap="section">
        {backButton}
        <Text color="error.fg" data-testid="custom-shipment-not-found">
          {t("customShipment.detail.notFound")}
        </Text>
      </Stack>
    );
  }

  const writable = canWrite(current);
  const scanning = shipment.status === "REQUESTED" && writable;
  const handover = shipment.status === "PICKED" && writable && (
    <Button colorPalette="brand" data-testid="custom-shipment-handover-open" onClick={() => setHanding(true)}>
      <Icon as={Truck} boxSize="4" />
      {t("customShipment.actions.handover")}
    </Button>
  );

  function setPicked() {
    const ok = prototype?.picked(id) ?? false;
    toaster.create(
      ok ? { type: "success", title: t("customShipment.toast.picked") } : { type: "error", title: t("customShipment.toast.refused") },
    );
  }

  return (
    <Stack gap="section" data-testid="custom-shipment-pick-page">
      {isMobile ? (
        <Flex align="center" gap="2" wrap="wrap">
          <IconButton size="xs" variant="ghost" aria-label={t("customShipment.detail.backToQueue")} data-testid="custom-shipment-back" onClick={back}>
            <Icon as={ArrowLeft} boxSize="4" />
          </IconButton>
          <Heading size="md" data-testid="custom-shipment-title">
            #{shipment.id.toString()}
          </Heading>
          <Box data-testid="custom-shipment-detail-status">
            <CustomShipmentStatusBadge status={shipment.status} />
          </Box>
          <CustomShipmentKindBadge kind={shipment.kind} />
        </Flex>
      ) : (
        <>
          {backButton}
          <Flex align="center" gap="card" wrap="wrap">
            <Heading size="md" data-testid="custom-shipment-title">
              {t("customShipment.detail.title", { id: shipment.id.toString() })}
            </Heading>
            <Box data-testid="custom-shipment-detail-status">
            <CustomShipmentStatusBadge status={shipment.status} />
          </Box>
            <CustomShipmentKindBadge kind={shipment.kind} />
            <Spacer />
            {handover}
          </Flex>
        </>
      )}
      {/* On a phone the one step is a full-width button under the title — the thumb's reach, as the pick page's. */}
      {isMobile && handover && <Box>{handover}</Box>}

      {shipment.note && (
        <Card.Root borderColor="warning.emphasized" borderWidth="1px" data-testid="custom-shipment-pick-note">
          <Card.Body>
            <Flex align="center" gap="2" mb="2">
              <Icon as={StickyNote} boxSize="4" color="warning.fg" />
              <Text fontSize="sm" fontWeight="medium" color="fg.muted">
                {t("customShipment.detail.noteFromTeam")}
              </Text>
            </Flex>
            <Text fontSize="sm" whiteSpace="pre-wrap">
              {shipment.note}
            </Text>
          </Card.Body>
        </Card.Root>
      )}

      <LinesCard shipment={shipment} showValue={false} showPicks />

      {/* THE ITEM SCANS (the-item-scans-live-on-the-page) — the order pick page's own component, fed the parcel's lines. */}
      {scanning && (
        <ItemScan
          key={shipment.id.toString()}
          items={shipment.items.map((item) =>
            create(OrderItemSchema, {
              id: item.id,
              productId: item.productId,
              productCode: item.productCode,
              name: item.name,
              quantity: Number(item.quantity),
            }),
          )}
          setting={false}
          onSetPicked={setPicked}
        />
      )}

      <ParcelCard shipment={shipment} side="warehouse" />
      <CustomShipmentTimeline shipment={shipment} side="warehouse" />

      {handing && <HandoverDialog shipment={shipment} onClose={() => setHanding(false)} />}
    </Stack>
  );
}
