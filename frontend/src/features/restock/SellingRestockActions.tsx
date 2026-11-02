import { useState } from "react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import {
  Alert,
  Button,
  Field,
  HStack,
  Icon,
  IconButton,
  Menu,
  Portal,
  RadioGroup,
  Stack,
  Text,
  Textarea,
} from "@chakra-ui/react";
import { Ban, MoreHorizontal, NotebookText, PackageX, Pencil, PencilLine } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { rpcError } from "../../api/clients";
import type { RestockRequest } from "../../gen/warehouse/inventory/v1/restock_request_pb";
import { RestockRequestStatus } from "../../gen/warehouse/inventory/v1/restock_request_pb";
import { useCancelRestockRequest, useMarkLostRestockRequest } from "./queries";
import { committedValue } from "./summary";
import { ConfirmDialog } from "../../components/feedback/ConfirmDialog";
import { toaster } from "../../components/feedback/Toaster";
import { formatRupiahNumber } from "../../lib/money";
import { CompactActions } from "../../components/chrome/CompactActions";
import { RestockNotesDialog } from "./RestockNotesDialog";

// WHAT THE SELLING TEAM MAY DO TO ITS RESTOCK, BY STATUS — the one matrix both the selling list's row menu and the
// selling detail's header read (the-warehouse-signs-and-accepts-the-team-does-the-rest):
//
//   ongoing  → Edit · Cancel · Mark Lost   everything is still the team's to change (a-restock-is-edited-only-while-
//                                          ongoing, a-restock-is-cancelled-only-while-ongoing, lost-is-set-only-before-
//                                          the-box-arrives)
//   arrived  → Edit Lines                  the box is in the building; only the lines move
//                                          (the-lines-stay-editable-until-accepted) — the SAME edit route, whose form
//                                          applies the arrived rules
//   accepted · lost · cancelled → nothing  a record of what happened
//
// …and, on the list only, Catatan in every status (`withNotes`, the-list-opens-the-notes-in-a-dialog): the notes are
// read whatever the status, and the selling team's is edited while it is on its way. The restock's page shows them in a
// section of its own, so it does not offer them.
//
// Signing for the box and accepting it are the WAREHOUSE's, and never appear here.
export type SellingAction = "edit" | "editLines" | "cancel" | "markLost" | "notes";

export function sellingActions(status: RestockRequestStatus): SellingAction[] {
  switch (status) {
    case RestockRequestStatus.ONGOING:
      return ["edit", "cancel", "markLost"];
    case RestockRequestStatus.ARRIVED:
      return ["editLines"];
    default:
      return [];
  }
}

const LOOK: Record<SellingAction, { icon: LucideIcon; labelKey: string; slug: string; danger?: boolean }> = {
  edit: { icon: Pencil, labelKey: "restock.actions.edit", slug: "edit" },
  editLines: { icon: PencilLine, labelKey: "restock.actions.editLines", slug: "edit-lines" },
  cancel: { icon: Ban, labelKey: "restock.actions.cancel", slug: "cancel", danger: true },
  markLost: { icon: PackageX, labelKey: "restock.actions.markLost", slug: "mark-lost" },
  notes: { icon: NotebookText, labelKey: "restock.actions.notes", slug: "notes" },
};

export interface SellingRestockActionsProps {
  request: RestockRequest;
  teamId: bigint;
  /**
   * `menu` — one ⋯ trigger opening the actions (a list row). `buttons` — each action a labelled button (a desktop
   * header, where there is room to name them). `compact` — a phone header's: each action its icon, past two all of them
   * in one ⋯ (a-phone-header-action-is-an-icon).
   */
  variant: "menu" | "buttons" | "compact";
  /**
   * The screen's ⚠ mark for the cancel dialog's warning — nothing checks a cancellation yet
   * (a-restock-cancel-warns-it-will-be-checked). Each screen numbers it in its own pending list.
   */
  cancelReviewMark?: ReactNode;
  /** Appended to every test id — a second copy of the same actions (a sticky title bar) passes `-sticky`. */
  idSuffix?: string;
  /** Offer Catatan, in every status — the list's rows (the-list-opens-the-notes-in-a-dialog). */
  withNotes?: boolean;
  /** The screen's ⚠ marks for the notes dialog — who wrote the note, the warehouse's note. */
  notesMarks?: { sellingBy?: ReactNode; late?: ReactNode; warehouse?: ReactNode };
}

// The actions, and the two dialogs behind them. Nothing renders when the status allows nothing — a disabled button
// would offer an act the server can only refuse.
export function SellingRestockActions({
  request,
  teamId,
  variant,
  cancelReviewMark,
  idSuffix = "",
  withNotes = false,
  notesMarks,
}: SellingRestockActionsProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [dialog, setDialog] = useState<"" | "cancel" | "markLost" | "notes">("");

  const actions: SellingAction[] = [...sellingActions(request.status), ...(withNotes ? (["notes"] as const) : [])];
  if (actions.length === 0) return null;

  const id = request.id.toString();

  function run(action: SellingAction) {
    switch (action) {
      case "edit":
      case "editLines":
        navigate(`/inventories/restock/${id}/edit`);
        return;
      case "cancel":
      case "markLost":
      case "notes":
        setDialog(action);
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
            danger: LOOK[action].danger,
            testId: `restock-action-${LOOK[action].slug}-${id}${idSuffix}`,
            onClick: () => run(action),
          }))}
        />
      ) : variant === "buttons" ? (
        <HStack gap="2" wrap="wrap">
          {actions.map((action) => (
            <Button
              key={action}
              variant="outline"
              colorPalette={LOOK[action].danger ? "error" : undefined}
              data-testid={`restock-action-${LOOK[action].slug}-${id}${idSuffix}`}
              onClick={() => run(action)}
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
                    color={LOOK[action].danger ? "error.fg" : undefined}
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
      )}

      {/* Mounted only while open, so each opening starts from an unanswered question. */}
      {dialog === "cancel" && (
        <CancelRestockDialog request={request} teamId={teamId} reviewMark={cancelReviewMark} onClose={() => setDialog("")} />
      )}
      {dialog === "markLost" && (
        <MarkLostDialog request={request} teamId={teamId} onClose={() => setDialog("")} />
      )}
      {dialog === "notes" && (
        <RestockNotesDialog
          open
          onOpenChange={(open) => !open && setDialog("")}
          teamId={teamId}
          requestId={request.id}
          marks={notesMarks}
        />
      )}
    </>
  );
}

// CANCEL — and it ASKS whether the money came back (a-restock-names-its-paying-account). Yes refunds the paying
// account; no posts nothing. There is no default: either answer moves money differently, so the confirm waits.
function CancelRestockDialog({
  request,
  teamId,
  reviewMark,
  onClose,
}: {
  request: RestockRequest;
  teamId: bigint;
  reviewMark?: ReactNode;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const cancel = useCancelRestockRequest();
  const [answer, setAnswer] = useState<"" | "yes" | "no">("");

  async function confirm() {
    try {
      await cancel.mutateAsync({ teamId, requestId: request.id, moneyReturned: answer === "yes" });
      toaster.create({ type: "success", title: t("restock.actions.toast.cancelled") });
    } catch (err) {
      toaster.create({ type: "error", title: t("restock.actions.toast.cancelFailed"), description: rpcError(err) });
    }
  }

  return (
    <ConfirmDialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={t("restock.cancel.title", { id: request.id.toString() })}
      message={t("restock.cancel.message")}
      confirmLabel={t("restock.cancel.confirm")}
      dismissLabel={t("restock.cancel.keep")}
      confirmDisabled={answer === ""}
      onConfirm={confirm}
    >
      {/* A CANCELLATION IS CHECKED (owner: *"untuk cancel order kasih warning akan diperiksa katanya"*,
          a-restock-cancel-warns-it-will-be-checked) — said before the confirm, in the warning tone, so nobody cancels
          thinking it goes unseen. Who checks it, and how, is not on this screen. */}
      <Alert.Root status="warning" mb="field" data-testid="restock-cancel-review">
        <Alert.Indicator />
        <Alert.Title>
          <HStack gap="1.5">
            {t("restock.cancel.review")}
            {reviewMark}
          </HStack>
        </Alert.Title>
      </Alert.Root>
      <Field.Root required>
        <Field.Label>
          <HStack gap="1.5">
            {t("restock.cancel.moneyQuestion")}
            <Field.RequiredIndicator />
          </HStack>
        </Field.Label>
        <RadioGroup.Root
          value={answer}
          onValueChange={(e) => setAnswer((e.value ?? "") as "yes" | "no")}
          data-testid="restock-cancel-money"
        >
          <Stack gap="2" pt="1">
            <RadioGroup.Item value="yes" data-testid="restock-cancel-money-yes">
              <RadioGroup.ItemHiddenInput />
              <RadioGroup.ItemIndicator />
              <RadioGroup.ItemText>{t("restock.cancel.moneyYes")}</RadioGroup.ItemText>
            </RadioGroup.Item>
            <RadioGroup.Item value="no" data-testid="restock-cancel-money-no">
              <RadioGroup.ItemHiddenInput />
              <RadioGroup.ItemIndicator />
              <RadioGroup.ItemText>{t("restock.cancel.moneyNo")}</RadioGroup.ItemText>
            </RadioGroup.Item>
          </Stack>
        </RadioGroup.Root>
        <Field.HelperText>
          {t("restock.cancel.moneyHint", { amount: formatRupiahNumber(committedValue(request)) })}
        </Field.HelperText>
      </Field.Root>
    </ConfirmDialog>
  );
}

// MARK LOST — the parcel never came (lost-is-set-only-before-the-box-arrives). The reason is optional and rides on the
// trail row. Not final: a box that turns up after all is signed for as arrived (a-late-lost-box-is-signed-for-as-
// arrived), which is why the message says so — this is a status, not a write-off.
function MarkLostDialog({
  request,
  teamId,
  onClose,
}: {
  request: RestockRequest;
  teamId: bigint;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const markLost = useMarkLostRestockRequest();
  const [description, setDescription] = useState("");

  async function confirm() {
    try {
      await markLost.mutateAsync({ teamId, requestId: request.id, description: description.trim() });
      toaster.create({ type: "success", title: t("restock.actions.toast.lost") });
    } catch (err) {
      toaster.create({ type: "error", title: t("restock.actions.toast.lostFailed"), description: rpcError(err) });
    }
  }

  return (
    <ConfirmDialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={t("restock.lost.title", { id: request.id.toString() })}
      message={t("restock.lost.message")}
      confirmLabel={t("restock.lost.confirm")}
      dismissLabel={t("restock.lost.keep")}
      onConfirm={confirm}
    >
      <Field.Root>
        <Field.Label>
          <HStack gap="1.5">
            {t("restock.lost.reason")}
          </HStack>
        </Field.Label>
        <Textarea
          value={description}
          maxLength={200}
          rows={2}
          placeholder={t("restock.lost.reasonPlaceholder")}
          data-testid="restock-lost-reason"
          onChange={(e) => setDescription(e.target.value)}
        />
        <Field.HelperText>
          <Text as="span">{t("restock.lost.reasonHint")}</Text>
        </Field.HelperText>
      </Field.Root>
    </ConfirmDialog>
  );
}
