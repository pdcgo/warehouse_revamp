import { useState } from "react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useCanWrite } from "../team/TeamContext";
import { useLocation, useNavigate } from "react-router-dom";
import { Button, HStack, Icon, IconButton, Menu, Portal, Separator } from "@chakra-ui/react";
import { MoreHorizontal, PackageCheck, PackageOpen, Printer } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { rpcError } from "../../api/clients";
import type { RestockRequest } from "../../gen/warehouse/inventory/v1/restock_request_pb";
import { RestockRequestStatus } from "../../gen/warehouse/inventory/v1/restock_request_pb";
import { useArriveRestockRequest } from "./queries";
import { labelsPath } from "./labelsPath";
import { toRupiah } from "./counting";
import { CourierCharge } from "./CourierCharge";
import { CompactActions } from "../../components/chrome/CompactActions";
import { ConfirmDialog } from "../../components/feedback/ConfirmDialog";
import { toaster } from "../../components/feedback/Toaster";
import { fromHere } from "../../lib/cameFrom";

// WHAT THE WAREHOUSE MAY DO TO A RESTOCK COMING TO IT, BY STATUS — the one matrix both the inbound list's rows and the
// warehouse detail's header read. The warehouse owns the two acts that happen at its door
// (the-warehouse-signs-and-accepts-the-team-does-the-rest):
//
//   ongoing  → Sign for Box · Accept   a box that turns up unannounced can be accepted straight away
//                                      (accept-locks-the-restock)
//   arrived  → Accept · Print          signed for, waiting to be counted — its labels can print already, without
//                                      placements (labels-print-from-arrived)
//   lost     → Sign for Box            the parcel turned up after all — the same restock, signed for as arrived
//                                      (a-late-lost-box-is-signed-for-as-arrived)
//   accepted → Print                   what the crew does right after counting it in — not a status change
//   cancelled → nothing
//
// *Print* is the labels — the action says the verb alone (owner: *"cetak label di action, cetak saja"*,
// print-is-the-labels-action); the page it opens is still Cetak Label. There is no Struk: it was built without a
// decision, and is not needed (owner: *"struk tidak dibutuhkan ternyata"*, there-is-no-struk).
//
// Editing, cancelling and marking lost are the SELLING team's, and never appear here.
export type WarehouseAction = "signForBox" | "accept" | "labels";

export function warehouseActions(status: RestockRequestStatus): WarehouseAction[] {
  switch (status) {
    case RestockRequestStatus.ONGOING:
      return ["signForBox", "accept"];
    case RestockRequestStatus.ARRIVED:
      return ["accept", "labels"];
    case RestockRequestStatus.LOST:
      return ["signForBox"];
    case RestockRequestStatus.ACCEPTED:
      return ["labels"];
    default:
      return [];
  }
}

const LOOK: Record<WarehouseAction, { icon: LucideIcon; labelKey: string; slug: string; primary?: boolean }> = {
  signForBox: { icon: PackageOpen, labelKey: "restock.actions.signForBox", slug: "sign" },
  accept: { icon: PackageCheck, labelKey: "restock.actions.accept", slug: "accept", primary: true },
  labels: { icon: Printer, labelKey: "restock.labels.action", slug: "labels" },
};

export interface WarehouseRestockActionsProps {
  request: RestockRequest;
  teamId: bigint;
  /**
   * `row` — small labelled buttons for a list row (never more than two, so they stay inline). `buttons` — a desktop
   * header. `menu` — one ⋯ trigger. `compact` — a phone header's, and a sticky bar's: each action its icon, past two all
   * of them under ⋯ (a-phone-header-action-is-an-icon, CompactActions).
   */
  variant: "row" | "buttons" | "menu" | "compact";
  /**
   * The page's pending mark for the courier's charge in the sign dialog — typed there and NOT kept yet
   * (the-cod-can-be-noted-when-the-box-arrives). Each page passes its own, numbered in its own list.
   */
  codMark?: ReactNode;
  /** Appended to every test id — the sticky bar's copy (`-sticky`), so a test finds each of the page's once. */
  idSuffix?: string;
}

export function WarehouseRestockActions({ request, teamId, variant, codMark, idSuffix = "" }: WarehouseRestockActionsProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const [signing, setSigning] = useState(false);
  // Nothing to change here while the admin team monitors the team (the-admin-team-monitors-read-only) — printing the
  // labels changes nothing, so it stays.
  const writable = useCanWrite();

  const actions = warehouseActions(request.status).filter((action) => writable || action === "labels");
  if (actions.length === 0) return null;

  const id = request.id.toString();

  function run(action: WarehouseAction) {
    switch (action) {
      case "signForBox":
        setSigning(true);
        return;
      case "accept":
        // Accepting is COUNTING, placing and pricing — a form with sections, so it is a PAGE, not a dialog. It carries
        // where it was opened, so Back and Terima return there — the list with its filters, or this restock's page
        // (a-form-returns-where-it-was-opened).
        navigate(`/inventories/restock/${id}/accept`, { state: fromHere(location) });
        return;
      case "labels":
        // The labels' one address, with this restock on it (the-labels-have-one-address); Back returns where the labels
        // were opened from, as Terima's does.
        navigate(labelsPath([id]), { state: fromHere(location) });
        return;
    }
  }


  return (
    <>
      {variant === "compact" ? (
        <CompactActions
          menuLabel={t("restock.actions.menu")}
          menuTestId={`restock-actions-${id}${idSuffix}`}
          actions={actions.map((action) => ({
            id: action,
            label: t(LOOK[action].labelKey),
            icon: LOOK[action].icon,
            testId: `restock-action-${LOOK[action].slug}-${id}${idSuffix}`,
            onClick: () => run(action),
          }))}
        />
      ) : variant === "menu" ? (
        <Menu.Root>
          <Menu.Trigger asChild>
            <IconButton
              size="xs"
              variant="ghost"
              aria-label={t("restock.actions.menu")}
              data-testid={`restock-actions-${id}${idSuffix}`}
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
                    data-testid={`restock-action-${LOOK[action].slug}-${id}${idSuffix}`}
                    onSelect={() => run(action)}
                  >
                    <Icon as={LOOK[action].icon} boxSize="4" />
                    {t(LOOK[action].labelKey)}
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
              data-testid={`restock-action-${LOOK[action].slug}-${id}${idSuffix}`}
              onClick={() => run(action)}
            >
              <Icon as={LOOK[action].icon} boxSize="4" />
              {t(LOOK[action].labelKey)}
            </Button>
          ))}
        </HStack>
      )}

      {signing && (
        <SignForBoxDialog request={request} teamId={teamId} codMark={codMark} onClose={() => setSigning(false)} />
      )}
    </>
  );
}

// SIGN FOR THE BOX — the courier handed it over: ongoing (or lost) → arrived. It cannot be taken back, so it confirms;
// it is not destructive, so the confirm is the brand colour, not red.
//
// TIBA ONLY MARKS; TERIMA IS FINAL (owner: *"tiba itu untuk menandai, diterima itu final"*,
// tiba-marks-and-terima-is-final) — the message says stock does not move until Terima, and nothing here says "received".
//
// THE COURIER'S CHARGE CAN BE NOTED HERE (owner: *"ongkir cod bisa keduanya"*, the-cod-can-be-noted-when-the-box-arrives)
// — when the courier asks for it at the door, which is now. ASKED FIRST (the-charge-is-asked-for-before-it-is-filled): unticked,
// the sign goes ahead with nothing to fill; ticked, the amount and the note are required and the sign waits for them.
// ⚠ RestockRequestArrive takes no charge, so it is NOT KEPT (`dropped`): the mark says so, and so does a toast after the
// sign — enter it again at Terima.
function SignForBoxDialog({
  request,
  teamId,
  codMark,
  onClose,
}: {
  request: RestockRequest;
  teamId: bigint;
  codMark?: ReactNode;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const arrive = useArriveRestockRequest();
  const late = request.status === RestockRequestStatus.LOST;
  const [asked, setAsked] = useState(false);
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  // The courier's slip, optional (the-courier-slip-has-an-optional-photo) — not kept with the rest of the charge.
  const [photo, setPhoto] = useState<File | null>(null);

  const charged = asked && toRupiah(amount) > 0;
  // Ticked, both are required; the note's error shows once there is an amount, so a fresh tick is not all red.
  const incomplete = asked && (!charged || note.trim() === "");
  const noteMissing = charged && note.trim() === "";

  async function confirm() {
    try {
      await arrive.mutateAsync({ teamId, requestId: request.id });
      toaster.create({ type: "success", title: t("restock.actions.toast.arrived") });
      if (asked) {
        toaster.create({ type: "warning", title: t("restock.actions.toast.arrivedCodNotKept") });
      }
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
      confirmDisabled={incomplete}
      onConfirm={confirm}
    >
      <HStack gap="1.5" fontSize="sm" color="fg.muted">
        {request.receipt
          ? t("restock.actions.sign.tracking", { receipt: request.receipt })
          : t("restock.actions.sign.noTracking")}
      </HStack>

      <Separator />

      <CourierCharge
        asked={asked}
        onAsked={setAsked}
        amount={amount}
        note={note}
        noteMissing={noteMissing}
        onAmount={setAmount}
        onNote={setNote}
        photo={photo}
        onPhoto={setPhoto}
        hint={t("restock.actions.sign.courierHint")}
        mark={codMark}
        testId="sign-courier"
      />
    </ConfirmDialog>
  );
}
