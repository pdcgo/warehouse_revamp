import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button, Field, HStack, Icon, IconButton, Menu, Portal, Stack } from "@chakra-ui/react";
import { Ban, MoreHorizontal, Wallet } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { rpcError } from "../../api/clients";
import { useCanWrite } from "../team/TeamContext";
import { ConfirmDialog } from "../../components/feedback/ConfirmDialog";
import { toaster } from "../../components/feedback/Toaster";
import { CurrencyInput } from "../../components/inputs/CurrencyInput";
import { FinancialAccountSelect } from "../../components/pickers/FinancialAccountSelect";
import type { CustomShipment, SellingAction } from "./customShipments";
import { sellingActions } from "./customShipments";
import { useCancelCustomShipment, useSetCustomShipmentCost } from "./queries";

const LOOK: Record<SellingAction, { icon: LucideIcon; labelKey: string; slug: string; danger?: boolean }> = {
  editCost: { icon: Wallet, labelKey: "customShipment.actions.editCost", slug: "edit-cost" },
  cancel: { icon: Ban, labelKey: "customShipment.actions.cancel", slug: "cancel", danger: true },
};

// THE SELLING TEAM'S ACTS ON ITS PARCEL — the matrix in customShipments.ts `sellingActions`, read by the list's ⋯ and the
// detail's header, as SellingTransferActions is for a transfer. Nothing renders when the status allows nothing, or while
// the admin team monitors the team (the-admin-team-monitors-read-only). Picking and the handover are the warehouse's,
// and never appear here. Each act is the owning team's RPC (CustomShipmentCostSet / CustomShipmentCancel, as the parcel's
// `team_id`); a refusal says the server's sentence and the screen re-reads the parcel as it now is.
export function SellingCustomShipmentActions({
  shipment,
  variant,
}: {
  shipment: CustomShipment;
  /** `menu` — one ⋯ trigger (a list row, a phone header). `buttons` — labelled buttons (a desktop header). */
  variant: "menu" | "buttons";
}) {
  const { t } = useTranslation();
  const [dialog, setDialog] = useState<"" | SellingAction>("");
  const writable = useCanWrite();

  const actions = sellingActions(shipment);
  if (actions.length === 0 || !writable) return null;

  const id = shipment.id.toString();

  return (
    <>
      {variant === "buttons" ? (
        <HStack gap="2" wrap="wrap">
          {actions.map((action) => (
            <Button
              key={action}
              variant="outline"
              colorPalette={LOOK[action].danger ? "error" : undefined}
              data-testid={`custom-shipment-action-${LOOK[action].slug}-${id}`}
              onClick={() => setDialog(action)}
            >
              <Icon as={LOOK[action].icon} boxSize="4" />
              {t(LOOK[action].labelKey)}
            </Button>
          ))}
        </HStack>
      ) : (
        <Menu.Root>
          <Menu.Trigger asChild>
            <IconButton
              size="xs"
              variant="ghost"
              aria-label={t("customShipment.actions.menu")}
              data-testid={`custom-shipment-actions-${id}`}
            >
              <Icon as={MoreHorizontal} boxSize="4" />
            </IconButton>
          </Menu.Trigger>
          <Portal>
            <Menu.Positioner>
              <Menu.Content>
                {actions.map((action) => (
                  <Menu.Item
                    key={action}
                    value={action}
                    color={LOOK[action].danger ? "error.fg" : undefined}
                    data-testid={`custom-shipment-action-${LOOK[action].slug}-${id}`}
                    onSelect={() => setDialog(action)}
                  >
                    <Icon as={LOOK[action].icon} boxSize="4" />
                    {t(LOOK[action].labelKey)}
                  </Menu.Item>
                ))}
              </Menu.Content>
            </Menu.Positioner>
          </Portal>
        </Menu.Root>
      )}

      {/* Mounted only while open, so each opening starts from the parcel as it is now. */}
      {dialog === "editCost" && <EditCostDialog shipment={shipment} onClose={() => setDialog("")} />}
      {dialog === "cancel" && <CancelDialog shipment={shipment} onClose={() => setDialog("")} />}
    </>
  );
}

// The stored cost exactly (the-backend-never-rounds-money) — saving untouched never moves it.
const digitsOf = (n: number | undefined) => (n !== undefined && n > 0 ? String(n) : "");
const amountOf = (digits: string) => (digits === "" ? 0 : Number(digits));

// UBAH ONGKIR — *Kami bayar*: the team's account and its cost, until the handover
// (the-courier-is-paid-by-the-team-or-by-the-warehouse, 🔄 A). The courier prices by the packed parcel, so the team
// often knows the cost only after the warehouse has packed it — as a transfer's Edit Cost. The account stays required:
// *Kami bayar* is the team paying from one of its accounts.
function EditCostDialog({ shipment, onClose }: { shipment: CustomShipment; onClose: () => void }) {
  const { t } = useTranslation();
  const costSet = useSetCustomShipmentCost();
  const [cost, setCost] = useState(digitsOf(shipment.shippingCost));
  const [accountId, setAccountId] = useState(shipment.financeAccountId);

  async function confirm() {
    try {
      await costSet.mutateAsync({ teamId: shipment.teamId, id: shipment.id, financeAccountId: accountId, shippingCost: amountOf(cost) });
      toaster.create({ type: "success", title: t("customShipment.toast.costSaved") });
    } catch (err) {
      toaster.create({ type: "error", title: t("customShipment.toast.refused"), description: rpcError(err) });
    }
  }

  return (
    <ConfirmDialog
      open
      onOpenChange={(open) => !open && onClose()}
      destructive={false}
      title={t("customShipment.cost.title", { id: shipment.id.toString() })}
      message={t("customShipment.cost.message")}
      confirmLabel={t("customShipment.cost.confirm")}
      dismissLabel={t("common.cancel")}
      confirmDisabled={accountId === 0n}
      onConfirm={confirm}
    >
      <Stack gap="field">
        <Field.Root>
          <Field.Label>{t("customShipment.form.cost")}</Field.Label>
          <CurrencyInput fraction value={cost} onChange={setCost} data-testid="custom-shipment-cost-amount" />
        </Field.Root>
        <Field.Root required>
          <Field.Label>
            {t("customShipment.form.account")}
            <Field.RequiredIndicator />
          </Field.Label>
          <FinancialAccountSelect
            teamId={shipment.teamId}
            value={accountId > 0n ? accountId : undefined}
            onChange={setAccountId}
            testId="custom-shipment-cost-account"
          />
        </Field.Root>
      </Stack>
    </ConfirmDialog>
  );
}

// BATALKAN — only while nobody has touched the goods (sellingActions). A sample's units go back on the racks they were
// taken from; a reship's broken units are free for another reship.
function CancelDialog({ shipment, onClose }: { shipment: CustomShipment; onClose: () => void }) {
  const { t } = useTranslation();
  const cancel = useCancelCustomShipment();

  async function confirm() {
    try {
      await cancel.mutateAsync({ teamId: shipment.teamId, id: shipment.id });
      toaster.create({ type: "success", title: t("customShipment.toast.cancelled") });
    } catch (err) {
      toaster.create({ type: "error", title: t("customShipment.toast.refused"), description: rpcError(err) });
    }
  }

  return (
    <ConfirmDialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={t("customShipment.cancel.title", { id: shipment.id.toString() })}
      message={t(shipment.kind === "SAMPLE" ? "customShipment.cancel.messageSample" : "customShipment.cancel.messageReship")}
      confirmLabel={t("customShipment.cancel.confirm")}
      dismissLabel={t("customShipment.cancel.dismiss")}
      onConfirm={confirm}
    />
  );
}
