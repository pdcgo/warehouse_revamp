import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, Field, Input, Stack } from "@chakra-ui/react";

import { ConfirmDialog } from "../../components/feedback/ConfirmDialog";
import { toaster } from "../../components/feedback/Toaster";
import { CurrencyInput } from "../../components/inputs/CurrencyInput";
import { ShipmentChannelBadge } from "../../components/badges/ShipmentChannelBadge";
import { useShipmentChannelsByIds } from "../shipment/queries";
import { useTeamsByIds } from "../teams/queries";
import { DetailField } from "../restock/DetailField";
import type { CustomShipment } from "./customShipments";
import { useCustomShipmentPrototype } from "./customShipmentPrototype";

// SERAHKAN KE KURIR — the warehouse's last step, picked → handed over (the parcel is done).
//
// WHO PAYS WAS SETTLED AT CREATE (the-courier-is-paid-by-the-team-or-by-the-warehouse, 🔄 A), so the dialog only reads it:
//
//   Gudang bayar   Ongkir dibayar gudang *  [Rp 0        ]     the REAL cost, typed now — required, 0 allowed; the team
//                  ditagih ke Toko Melati lewat Saldo Tim      owes it back (the-warehouse-cost-is-the-couriers-charge-
//                                                              at-the-door's shape)
//   Kami bayar     ⓘ Ongkir dibayar Toko Melati — gudang tidak membayar kurir     no cost field: the team's cost is not
//                                                              the warehouse's to know (the-warehouse-sees-the-ongkir-it-paid)
//
// The resi is optional — the courier's receipt number as the counter hands it back; tracking itself stays deferred
// (tracking-is-deferred).
export function HandoverDialog({ shipment, onClose }: { shipment: CustomShipment; onClose: () => void }) {
  const { t } = useTranslation();
  const prototype = useCustomShipmentPrototype();
  const couriers = useShipmentChannelsByIds([shipment.shipmentChannelId]);
  const teams = useTeamsByIds({ ids: [shipment.teamId] });
  const owner = teams.data?.[shipment.teamId.toString()]?.name ?? "";
  const [cost, setCost] = useState("");
  const [resi, setResi] = useState("");
  const warehousePays = shipment.payer === "WAREHOUSE";

  async function confirm() {
    const ok = prototype?.handover(shipment.id, warehousePays ? Number(cost) : undefined, resi.trim()) ?? false;
    toaster.create(
      ok
        ? { type: "success", title: t("customShipment.toast.handedOver") }
        : { type: "error", title: t("customShipment.toast.refused") },
    );
  }

  return (
    <ConfirmDialog
      open
      onOpenChange={(open) => !open && onClose()}
      destructive={false}
      title={t("customShipment.handover.title", { id: shipment.id.toString() })}
      confirmLabel={t("customShipment.handover.confirm")}
      dismissLabel={t("common.cancel")}
      // An empty field is a cost not typed yet — never read as 0 on the warehouse's behalf (CurrencyInput: "" stays "").
      confirmDisabled={warehousePays && cost === ""}
      onConfirm={confirm}
    >
      <Stack gap="field" data-testid="custom-shipment-handover">
        <DetailField
          label={t("customShipment.detail.courier")}
          value={
            <ShipmentChannelBadge
              channelId={shipment.shipmentChannelId}
              channel={couriers.data?.get(shipment.shipmentChannelId.toString())}
            />
          }
          testId="custom-shipment-handover-courier"
        />
        {warehousePays ? (
          <Field.Root required>
            <Field.Label>
              {t("customShipment.handover.cost")}
              <Field.RequiredIndicator />
            </Field.Label>
            <CurrencyInput value={cost} onChange={setCost} data-testid="custom-shipment-handover-cost" />
            <Field.HelperText data-testid="custom-shipment-handover-owed">
              {t("customShipment.handover.costHint", { team: owner })}
            </Field.HelperText>
          </Field.Root>
        ) : (
          <Alert.Root status="info" data-testid="custom-shipment-handover-team-pays">
            <Alert.Indicator />
            <Alert.Title>{t("customShipment.handover.teamPays", { team: owner })}</Alert.Title>
          </Alert.Root>
        )}
        <Field.Root>
          <Field.Label>{t("customShipment.handover.resi")}</Field.Label>
          <Input
            value={resi}
            maxLength={100}
            placeholder={t("customShipment.handover.resiPlaceholder")}
            data-testid="custom-shipment-handover-resi"
            onChange={(e) => setResi(e.target.value)}
          />
        </Field.Root>
      </Stack>
    </ConfirmDialog>
  );
}
