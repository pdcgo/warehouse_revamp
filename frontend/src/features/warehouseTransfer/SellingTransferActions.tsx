import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button, Field, HStack, Icon, IconButton, Menu, Portal, Stack, Textarea } from "@chakra-ui/react";
import { Ban, MoreHorizontal, PackageX, Wallet } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { rpcError } from "../../api/clients";
import type { WarehouseTransfer } from "../../gen/warehouse/inventory/v1/warehouse_transfer_pb";
import { WarehouseTransferStatus as S } from "../../gen/warehouse/inventory/v1/warehouse_transfer_pb";
import { useCancelWarehouseTransfer, useMarkLostWarehouseTransfer, useUpdateWarehouseTransfer } from "./queries";
import type { PendingList } from "../../features/pending/registry";
import { NotImplemented } from "../../features/pending/NotImplemented";
import { ConfirmDialog } from "../../components/feedback/ConfirmDialog";
import { toaster } from "../../components/feedback/Toaster";
import { CurrencyInput } from "../../components/inputs/CurrencyInput";
import { FinancialAccountSelect } from "../../components/pickers/FinancialAccountSelect";

// WHAT THE SELLING TEAM MAY DO TO ITS TRANSFER, BY STATUS — the one matrix both the selling list's row menu and the
// selling detail's header read:
//
//   created  → Edit Cost · Cancel     nobody has touched the goods yet (cancel-before-processed-lost-only-in-transit)
//   process  → Edit Cost              A is picking — no cancel from here on
//   shipped  → Edit Cost · Mark Lost  the box is with the courier, the only time it can be given up
//   arrived  → Edit Cost
//   lost     → Edit Cost              the trip happened, so its cost can still be corrected
//   accepted · cancelled → nothing
//
// Edit Cost covers the shipping cost, its paying account and the note — never the lines
// (a-transfers-lines-are-never-edited), and only until accepted (the-shipping-expense-reaches-the-account-by-event).
// Processing, shipping, signing and accepting are the warehouses', and never appear here.
export type SellingTransferAction = "editCost" | "cancel" | "markLost";

export function sellingTransferActions(status: S): SellingTransferAction[] {
  switch (status) {
    case S.CREATED:
      return ["editCost", "cancel"];
    case S.SHIPPED:
      return ["editCost", "markLost"];
    case S.PROCESS:
    case S.ARRIVED:
    case S.LOST:
      return ["editCost"];
    default:
      return [];
  }
}

const LOOK: Record<SellingTransferAction, { icon: LucideIcon; labelKey: string; slug: string; danger?: boolean }> = {
  editCost: { icon: Wallet, labelKey: "warehouseTransfer.actions.editCost", slug: "edit-cost" },
  cancel: { icon: Ban, labelKey: "warehouseTransfer.actions.cancel", slug: "cancel", danger: true },
  markLost: { icon: PackageX, labelKey: "warehouseTransfer.actions.markLost", slug: "mark-lost" },
};

export interface SellingTransferActionsProps {
  transfer: WarehouseTransfer;
  teamId: bigint;
  /** `menu` — one ⋯ trigger (a list row, a phone header). `buttons` — labelled buttons (a desktop header). */
  variant: "menu" | "buttons";
  /** The screen's pending list — it must carry `costEvent`. */
  pending: PendingList<string>;
}

// The actions, and the three dialogs behind them. Nothing renders when the status allows nothing — a disabled button
// would offer an act the server can only refuse.
export function SellingTransferActions({ transfer, teamId, variant, pending }: SellingTransferActionsProps) {
  const { t } = useTranslation();
  const [dialog, setDialog] = useState<"" | SellingTransferAction>("");

  const actions = sellingTransferActions(transfer.status);
  if (actions.length === 0) return null;

  const id = transfer.id.toString();

  return (
    <>
      {variant === "buttons" ? (
        <HStack gap="2" wrap="wrap">
          {actions.map((action) => (
            <Button
              key={action}
              variant="outline"
              colorPalette={LOOK[action].danger ? "error" : undefined}
              data-testid={`transfer-action-${LOOK[action].slug}-${id}`}
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
              aria-label={t("warehouseTransfer.actions.menu")}
              data-testid={`transfer-actions-${id}`}
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
                    data-testid={`transfer-action-${LOOK[action].slug}-${id}`}
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

      {/* Mounted only while open, so each opening starts from the transfer as it is now. */}
      {dialog === "editCost" && (
        <EditCostDialog transfer={transfer} teamId={teamId} pending={pending} onClose={() => setDialog("")} />
      )}
      {dialog === "cancel" && <CancelDialog transfer={transfer} teamId={teamId} onClose={() => setDialog("")} />}
      {dialog === "markLost" && <MarkLostDialog transfer={transfer} teamId={teamId} onClose={() => setDialog("")} />}
    </>
  );
}

const digitsOf = (n: bigint) => (n > 0n ? n.toString() : "");
const bigintOf = (digits: string) => (digits === "" ? 0n : BigInt(digits));

// EDIT COST — the shipping expense and the account that pays it, plus the note. The courier prices by the packed
// weight, so the team usually knows the cost only after A has packed — which is why this stays open until accepted. A
// cost needs an account (a-transfer-names-its-paying-account); a cost of 0 needs none.
function EditCostDialog({
  transfer,
  teamId,
  pending,
  onClose,
}: {
  transfer: WarehouseTransfer;
  teamId: bigint;
  pending: PendingList<string>;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const update = useUpdateWarehouseTransfer();
  const [cost, setCost] = useState(digitsOf(transfer.shipmentCost));
  const [accountId, setAccountId] = useState(transfer.financeAccountId);
  const [note, setNote] = useState(transfer.note);

  const needsAccount = bigintOf(cost) > 0n && accountId === 0n;

  async function confirm() {
    try {
      await update.mutateAsync({
        teamId,
        transferId: transfer.id,
        shipmentCost: bigintOf(cost),
        financeAccountId: bigintOf(cost) > 0n ? accountId : 0n,
        note: note.trim(),
      });
      toaster.create({ type: "success", title: t("warehouseTransfer.toast.costSaved") });
    } catch (err) {
      toaster.create({ type: "error", title: t("warehouseTransfer.toast.costFailed"), description: rpcError(err) });
    }
  }

  return (
    <ConfirmDialog
      open
      onOpenChange={(open) => !open && onClose()}
      destructive={false}
      title={t("warehouseTransfer.cost.title", { id: transfer.id.toString() })}
      message={t("warehouseTransfer.cost.message")}
      confirmLabel={t("warehouseTransfer.cost.confirm")}
      dismissLabel={t("warehouseTransfer.cost.dismiss")}
      confirmDisabled={needsAccount}
      onConfirm={confirm}
    >
      <Stack gap="field">
        <Field.Root>
          <Field.Label>
            <HStack gap="1.5">
              {t("warehouseTransfer.cost.shippingCost")}
              <NotImplemented list={pending} id="costEvent" />
            </HStack>
          </Field.Label>
          <CurrencyInput value={cost} onChange={setCost} data-testid="transfer-cost-amount" />
          <Field.HelperText>{t("warehouseTransfer.cost.shippingCostHint")}</Field.HelperText>
        </Field.Root>

        <Field.Root required={bigintOf(cost) > 0n} invalid={needsAccount}>
          <Field.Label>
            {t("warehouseTransfer.cost.account")}
            <Field.RequiredIndicator />
          </Field.Label>
          <FinancialAccountSelect
            teamId={teamId}
            value={accountId > 0n ? accountId : undefined}
            onChange={setAccountId}
            operationalOnly
            disabled={bigintOf(cost) === 0n}
            testId="transfer-cost-account"
          />
          {needsAccount && <Field.ErrorText>{t("warehouseTransfer.cost.accountRequired")}</Field.ErrorText>}
        </Field.Root>

        <Field.Root>
          <Field.Label>{t("warehouseTransfer.cost.note")}</Field.Label>
          <Textarea
            value={note}
            maxLength={1000}
            rows={2}
            data-testid="transfer-cost-note"
            onChange={(e) => setNote(e.target.value)}
          />
        </Field.Root>
      </Stack>
    </ConfirmDialog>
  );
}

// CANCEL — only while created: the units go back on A's book. The paying account gets back whatever was posted for the
// shipping, by itself; there is no money question to ask (the-shipping-expense-reaches-the-account-by-event).
function CancelDialog({
  transfer,
  teamId,
  onClose,
}: {
  transfer: WarehouseTransfer;
  teamId: bigint;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const cancel = useCancelWarehouseTransfer();
  const [reason, setReason] = useState("");

  async function confirm() {
    try {
      await cancel.mutateAsync({ teamId, transferId: transfer.id, description: reason.trim() });
      toaster.create({ type: "success", title: t("warehouseTransfer.toast.cancelled") });
    } catch (err) {
      toaster.create({ type: "error", title: t("warehouseTransfer.toast.cancelFailed"), description: rpcError(err) });
    }
  }

  return (
    <ConfirmDialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={t("warehouseTransfer.cancel.title", { id: transfer.id.toString() })}
      message={t("warehouseTransfer.cancel.message")}
      confirmLabel={t("warehouseTransfer.cancel.confirm")}
      dismissLabel={t("warehouseTransfer.cancel.keep")}
      onConfirm={confirm}
    >
      <Field.Root>
        <Field.Label>{t("warehouseTransfer.cancel.reason")}</Field.Label>
        <Textarea
          value={reason}
          maxLength={200}
          rows={2}
          data-testid="transfer-cancel-reason"
          onChange={(e) => setReason(e.target.value)}
        />
      </Field.Root>
    </ConfirmDialog>
  );
}

// MARK LOST — only while shipped: the box never came. The loss is the team's
// (the-selling-team-bears-broken-missing-and-lost). Not final: a box that turns up is signed for at B as arrived.
function MarkLostDialog({
  transfer,
  teamId,
  onClose,
}: {
  transfer: WarehouseTransfer;
  teamId: bigint;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const markLost = useMarkLostWarehouseTransfer();
  const [reason, setReason] = useState("");

  async function confirm() {
    try {
      await markLost.mutateAsync({ teamId, transferId: transfer.id, description: reason.trim() });
      toaster.create({ type: "success", title: t("warehouseTransfer.toast.lost") });
    } catch (err) {
      toaster.create({ type: "error", title: t("warehouseTransfer.toast.lostFailed"), description: rpcError(err) });
    }
  }

  return (
    <ConfirmDialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={t("warehouseTransfer.lost.title", { id: transfer.id.toString() })}
      message={t("warehouseTransfer.lost.message")}
      confirmLabel={t("warehouseTransfer.lost.confirm")}
      dismissLabel={t("warehouseTransfer.lost.keep")}
      onConfirm={confirm}
    >
      <Field.Root>
        <Field.Label>{t("warehouseTransfer.lost.reason")}</Field.Label>
        <Textarea
          value={reason}
          maxLength={200}
          rows={2}
          data-testid="transfer-lost-reason"
          onChange={(e) => setReason(e.target.value)}
        />
      </Field.Root>
    </ConfirmDialog>
  );
}
