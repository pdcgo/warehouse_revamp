import { Badge, HStack, Icon } from "@chakra-ui/react";
import { useTranslation } from "react-i18next";
import { Gift, Undo2 } from "lucide-react";

import type { CustomShipmentKind, CustomShipmentPayer, CustomShipmentStatus } from "./customShipments";
import { KIND_KEYS, STATUS_KEYS } from "./customShipments";

// A custom shipment's status — a LIFECYCLE STEP, so its colour is categorical (CLAUDE.md, the design system): waiting for
// the warehouse (blue, as a transfer's created), in the basket (purple, as being picked), with the courier — its end
// (green), and the ending it never reached (gray, as every cancel).
const STATUS_COLOR: Record<CustomShipmentStatus, string> = {
  REQUESTED: "blue",
  PICKED: "purple",
  HANDED_OVER: "green",
  CANCELLED: "gray",
};

export function CustomShipmentStatusBadge({ status }: { status: CustomShipmentStatus }) {
  const { t } = useTranslation();

  return (
    <Badge colorPalette={STATUS_COLOR[status]} data-testid={`custom-shipment-status-${status.toLowerCase()}`}>
      {t(STATUS_KEYS[status])}
    </Badge>
  );
}

// The kind tells two jobs apart — categorical too, and it carries its own icon so it reads before its word: a gift for a
// sample, the way back for a reship.
export function CustomShipmentKindBadge({ kind }: { kind: CustomShipmentKind }) {
  const { t } = useTranslation();

  return (
    <Badge
      variant="outline"
      colorPalette={kind === "SAMPLE" ? "pink" : "orange"}
      data-testid={`custom-shipment-kind-${kind === "SAMPLE" ? "sample" : "reship"}`}
    >
      <HStack gap="1">
        <Icon as={kind === "SAMPLE" ? Gift : Undo2} boxSize="3" />
        {t(KIND_KEYS[kind])}
      </HStack>
    </Badge>
  );
}

/** Who pays the courier — the team (*Kami bayar*) or the warehouse (*Gudang bayar*), as the reader calls it. */
export function payerKey(payer: CustomShipmentPayer, side: "selling" | "warehouse"): string {
  if (side === "selling") return payer === "TEAM" ? "customShipment.payer.team" : "customShipment.payer.warehouse";

  return payer === "TEAM" ? "customShipment.payer.teamForWarehouse" : "customShipment.payer.warehouseForWarehouse";
}
