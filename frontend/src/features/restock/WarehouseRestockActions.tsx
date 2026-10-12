import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { Button, HStack, Icon, IconButton, Menu, Portal } from "@chakra-ui/react";
import { MoreHorizontal, PackageCheck, PackageOpen, Printer, Receipt } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { rpcError } from "../../api/clients";
import type { RestockRequest } from "../../gen/warehouse/inventory/v1/restock_request_pb";
import { RestockRequestStatus } from "../../gen/warehouse/inventory/v1/restock_request_pb";
import { useArriveRestockRequest } from "./queries";
import type { PendingList } from "../../features/pending/registry";
import { NotImplemented } from "../../features/pending/NotImplemented";
import { ConfirmDialog } from "../../components/feedback/ConfirmDialog";
import { toaster } from "../../components/feedback/Toaster";

// WHAT THE WAREHOUSE MAY DO TO A RESTOCK COMING TO IT, BY STATUS — the one matrix both the inbound list's rows and the
// warehouse detail's header read. The warehouse owns the two acts that happen at its door
// (the-warehouse-signs-and-accepts-the-team-does-the-rest):
//
//   ongoing  → Sign for Box · Accept   a box that turns up unannounced can be accepted straight away
//                                      (accept-locks-the-restock)
//   arrived  → Accept                  signed for, waiting to be counted
//   lost     → Sign for Box            the parcel turned up after all — the same restock, signed for as arrived
//                                      (a-late-lost-box-is-signed-for-as-arrived)
//   accepted → Print Labels · Receipt  what the crew does right after counting it in — not a status change
//   cancelled → nothing
//
// Editing, cancelling and marking lost are the SELLING team's, and never appear here.
export type WarehouseAction = "signForBox" | "accept" | "labels" | "receipt";

export function warehouseActions(status: RestockRequestStatus): WarehouseAction[] {
  switch (status) {
    case RestockRequestStatus.ONGOING:
      return ["signForBox", "accept"];
    case RestockRequestStatus.ARRIVED:
      return ["accept"];
    case RestockRequestStatus.LOST:
      return ["signForBox"];
    case RestockRequestStatus.ACCEPTED:
      return ["labels", "receipt"];
    default:
      return [];
  }
}

const LOOK: Record<WarehouseAction, { icon: LucideIcon; labelKey: string; slug: string; primary?: boolean }> = {
  signForBox: { icon: PackageOpen, labelKey: "restock.actions.signForBox", slug: "sign" },
  accept: { icon: PackageCheck, labelKey: "restock.actions.accept", slug: "accept", primary: true },
  labels: { icon: Printer, labelKey: "restock.labels.action", slug: "labels" },
  receipt: { icon: Receipt, labelKey: "restock.table.receipt", slug: "receipt" },
};

export interface WarehouseRestockActionsProps {
  request: RestockRequest;
  teamId: bigint;
  /**
   * `row` — small labelled buttons for a list row (never more than two, so they stay inline). `buttons` — a desktop
   * header. `menu` — one ⋯ trigger, for a phone header.
   */
  variant: "row" | "buttons" | "menu";
  /** The screen's pending list — it must carry `signForBox`. */
  pending: PendingList<string>;
}

export function WarehouseRestockActions({ request, teamId, variant, pending }: WarehouseRestockActionsProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [signing, setSigning] = useState(false);

  const actions = warehouseActions(request.status);
  if (actions.length === 0) return null;

  const id = request.id.toString();

  function run(action: WarehouseAction) {
    switch (action) {
      case "signForBox":
        setSigning(true);
        return;
      case "accept":
        // Accepting is COUNTING, placing and pricing — a form with sections, so it is a PAGE, not a dialog.
        navigate(`/inventories/restock/${id}/accept`);
        return;
      case "labels":
        navigate(`/inventories/restock/${id}/labels`);
        return;
      case "receipt":
        navigate(`/inventories/restock/${id}/receipt`);
        return;
    }
  }

  const mark = (action: WarehouseAction) =>
    action === "signForBox" ? <NotImplemented list={pending} id="signForBox" /> : null;

  return (
    <>
      {variant === "menu" ? (
        <Menu.Root>
          <Menu.Trigger asChild>
            <IconButton
              size="xs"
              variant="ghost"
              aria-label={t("restock.actions.menu")}
              data-testid={`restock-actions-${id}`}
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
                    data-testid={`restock-action-${LOOK[action].slug}-${id}`}
                    onSelect={() => run(action)}
                  >
                    <Icon as={LOOK[action].icon} boxSize="4" />
                    {t(LOOK[action].labelKey)}
                    {mark(action)}
                  </Menu.Item>
                ))}
              </Menu.Content>
            </Menu.Positioner>
          </Portal>
        </Menu.Root>
      ) : (
        <HStack gap={variant === "row" ? "1" : "2"} justify="end" wrap="wrap">
          {actions.map((action) => (
            <Button
              key={action}
              size={variant === "row" ? "xs" : undefined}
              variant={LOOK[action].primary ? "solid" : "outline"}
              colorPalette={LOOK[action].primary ? "brand" : undefined}
              data-testid={`restock-action-${LOOK[action].slug}-${id}`}
              onClick={() => run(action)}
            >
              <Icon as={LOOK[action].icon} boxSize="4" />
              {t(LOOK[action].labelKey)}
              {mark(action)}
            </Button>
          ))}
        </HStack>
      )}

      {signing && (
        <SignForBoxDialog request={request} teamId={teamId} pending={pending} onClose={() => setSigning(false)} />
      )}
    </>
  );
}

// SIGN FOR THE BOX — the courier handed it over: ongoing (or lost) → arrived. It cannot be taken back, so it confirms;
// it is not destructive, so the confirm is the brand colour, not red.
function SignForBoxDialog({
  request,
  teamId,
  pending,
  onClose,
}: {
  request: RestockRequest;
  teamId: bigint;
  pending: PendingList<string>;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const arrive = useArriveRestockRequest();
  const late = request.status === RestockRequestStatus.LOST;

  async function confirm() {
    try {
      await arrive.mutateAsync({ teamId, requestId: request.id });
      toaster.create({ type: "success", title: t("restock.actions.toast.arrived") });
    } catch (err) {
      toaster.create({ type: "error", title: t("restock.actions.toast.arriveFailed"), description: rpcError(err) });
    }
  }

  return (
    <ConfirmDialog
      open
      onOpenChange={(open) => !open && onClose()}
      destructive={false}
      title={t("restock.actions.sign.title", { id: request.id.toString() })}
      message={late ? t("restock.actions.sign.messageLost") : t("restock.actions.sign.message")}
      confirmLabel={t("restock.actions.signForBox")}
      dismissLabel={t("restock.actions.sign.dismiss")}
      onConfirm={confirm}
    >
      <HStack gap="1.5" fontSize="sm" color="fg.muted">
        {request.receipt
          ? t("restock.actions.sign.tracking", { receipt: request.receipt })
          : t("restock.actions.sign.noTracking")}
        <NotImplemented list={pending} id="signForBox" />
      </HStack>
    </ConfirmDialog>
  );
}
