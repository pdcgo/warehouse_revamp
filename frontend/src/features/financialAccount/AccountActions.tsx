import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button, HStack, Icon, IconButton, Menu, Portal, Span } from "@chakra-ui/react";
import {
  ArchiveRestore,
  ArrowLeftRight,
  Archive,
  BadgeCheck,
  BadgeMinus,
  HandCoins,
  MoreHorizontal,
  Pencil,
  Scale,
  SearchCheck,
} from "lucide-react";

import { rpcError } from "../../api/clients";
import { ConfirmDialog } from "../../components/feedback/ConfirmDialog";
import { toaster } from "../../components/feedback/Toaster";
import { type FinancialAccount, FinancialAccountStatus } from "../../gen/warehouse/financial_account/v1/financial_account_pb";
import { formatRupiahNumber } from "../../lib/money";
import { AccountFormDialog } from "./AccountFormDialog";
import { CapitalDialog } from "./CapitalDialog";
import { IdentifyDialog } from "./IdentifyDialog";
import { ReconcileDialog } from "./ReconcileDialog";
import { TransferDialog } from "./TransferDialog";
import { useArchiveAccount, useOperationalSet, useRestoreAccount } from "./queries";
import { isUnknown } from "./vocab";

type DialogName = "edit" | "transfer" | "capital" | "reconcile" | "identify" | "archive" | "operational";

// What can be DONE to one account, and the dialogs that do it — shared by the accounts list (a row) and the
// account's page.
//
// WITH `buttons` THE TWO MOST USED ARE ON THE ROW (owner, `transfer-and-reconcile-sit-on-the-row`) and the menu
// holds only the rest — never both, so a menu item is never a second copy of the button beside it:
//
//   active     [Transfer] [Rekonsiliasi]           ⋯ Capital · Edit · Mark / Unmark operational · Archive
//   unknown    [Transfer out]                       ⋯ Set account · Archive  (`the-unknown-row-warns-and-sets-from-the-menu`)
//   archived   [Restore]                            — no menu, nothing else to do
//
// Shown only to admin and up — the caller decides, since a member sees the page but moves nothing
// (seeing-is-team-wide-moving-is-admin-and-up).
//
// What each state offers:
//
//   archived   Restore — nothing moves in an archived account by hand
//   unknown    Which account is this? · Transfer out · Archive — no reconcile (no statement to read),
//              never operational (a-shop-with-no-account-gets-an-unknown-one, my spec)
//   active     Transfer · Reconcile · Capital · Edit · Mark / Unmark operational · Archive
//
// Archive is OFFERED only at zero, and the item says why when it is not
// (an-account-is-archived-only-at-zero). The server refuses it anyway.
//
// Each dialog MOUNTS ON OPEN, so it opens with a clean form every time rather than last time's typing.
export function AccountActions({
  teamId,
  account,
  balance,
  shopNames = [],
  buttons = false,
}: {
  teamId: bigint;
  account: FinancialAccount;
  balance: number | undefined;
  shopNames?: string[];
  /** The two most used as buttons, the rest in the menu — the list's rows and the account's page. */
  buttons?: boolean;
}) {
  const { t } = useTranslation();
  const [dialog, setDialog] = useState<DialogName | null>(null);

  const archive = useArchiveAccount();
  const restore = useRestoreAccount();
  const operational = useOperationalSet();

  const archived = account.status === FinancialAccountStatus.ARCHIVED;
  const unknown = isUnknown(account);
  const atZero = balance === 0;
  const id = account.id.toString();

  const close = (o: boolean) => {
    if (!o) setDialog(null);
  };

  const fail = (err: unknown) =>
    toaster.create({ type: "error", title: t("financialAccounts.failed"), description: rpcError(err) });

  // No confirm: a restore puts an account back into the pickers, and archiving it again undoes that.
  function doRestore() {
    restore.mutate(
      { teamId, accountId: account.id },
      {
        onSuccess: () => toaster.create({ type: "success", title: t("financialAccounts.toast.restored", { name: account.name }) }),
        onError: fail,
      },
    );
  }

  // IT ASKS FIRST (owner, `operational-asks-before-it-changes`) — marking changes what a restock's and an
  // expense's Paid from offers, for everybody on the team; the dialog says which way it goes.
  async function doOperational() {
    const next = !account.operational;
    try {
      await operational.mutateAsync({ teamId, accountId: account.id, operational: next });
      toaster.create({
        type: "success",
        title: t(next ? "financialAccounts.toast.markedOperational" : "financialAccounts.toast.unmarkedOperational", {
          name: account.name,
        }),
      });
    } catch (err) {
      // Toasted, not rethrown — ConfirmDialog awaits this with no catch of its own.
      fail(err);
    }
  }

  async function doArchive() {
    try {
      await archive.mutateAsync({ teamId, accountId: account.id });
      toaster.create({ type: "success", title: t("financialAccounts.toast.archived", { name: account.name }) });
    } catch (err) {
      // Toasted, not rethrown — ConfirmDialog awaits this with no catch of its own.
      fail(err);
    }
  }

  const item = (value: string, icon: typeof Pencil, label: string, onSelect: () => void, extra: { disabled?: boolean; hint?: string; danger?: boolean } = {}) => (
    <Menu.Item
      value={value}
      disabled={extra.disabled}
      color={extra.danger ? "fg.error" : undefined}
      data-testid={`account-${value}-${id}`}
      onClick={onSelect}
    >
      <Icon as={icon} boxSize="4" />
      <Span flex="1">{label}</Span>
      {extra.hint && (
        <Span fontSize="xs" color="fg.muted">
          {extra.hint}
        </Span>
      )}
    </Menu.Item>
  );

  const archiveItem = item("archive", Archive, t("financialAccounts.actions.archive"), () => setDialog("archive"), {
    disabled: !atZero,
    hint: atZero ? undefined : t("financialAccounts.actions.archiveOnlyAtZero"),
    danger: true,
  });

  return (
    <HStack gap="1" justify="end" onClick={(e) => e.stopPropagation()}>
      {buttons && archived && (
        <Button size="xs" variant="outline" data-testid={`account-restore-button-${id}`} onClick={doRestore}>
          <Icon as={ArchiveRestore} boxSize="4" />
          {t("financialAccounts.actions.restore")}
        </Button>
      )}
      {buttons && !archived && unknown && (
        <Button size="xs" variant="outline" data-testid={`account-transfer-button-${id}`} onClick={() => setDialog("transfer")}>
          <Icon as={ArrowLeftRight} boxSize="4" />
          {t("financialAccounts.actions.transferOut")}
        </Button>
      )}
      {buttons && !archived && !unknown && (
        <>
          <Button size="xs" variant="outline" data-testid={`account-transfer-button-${id}`} onClick={() => setDialog("transfer")}>
            <Icon as={ArrowLeftRight} boxSize="4" />
            {t("financialAccounts.actions.transfer")}
          </Button>
          <Button size="xs" variant="outline" data-testid={`account-reconcile-button-${id}`} onClick={() => setDialog("reconcile")}>
            <Icon as={Scale} boxSize="4" />
            {t("financialAccounts.actions.reconcile")}
          </Button>
        </>
      )}

      {!(buttons && archived) && (
        <Menu.Root>
          <Menu.Trigger asChild>
            <IconButton size="xs" variant="ghost" aria-label={t("financialAccounts.actions.label")} data-testid={`account-actions-${id}`}>
              <Icon as={MoreHorizontal} boxSize="4" />
            </IconButton>
          </Menu.Trigger>
          <Portal>
            <Menu.Positioner>
              <Menu.Content minW="16rem">
                {archived ? (
                  item("restore", ArchiveRestore, t("financialAccounts.actions.restore"), doRestore)
                ) : unknown ? (
                  <>
                    {item("identify", SearchCheck, t("financialAccounts.actions.identify"), () => setDialog("identify"))}
                    {!buttons && item("transfer", ArrowLeftRight, t("financialAccounts.actions.transferOut"), () => setDialog("transfer"))}
                    {archiveItem}
                  </>
                ) : (
                  <>
                    {!buttons && item("transfer", ArrowLeftRight, t("financialAccounts.actions.transfer"), () => setDialog("transfer"))}
                    {!buttons && item("reconcile", Scale, t("financialAccounts.actions.reconcile"), () => setDialog("reconcile"))}
                    {item("capital", HandCoins, t("financialAccounts.actions.capital"), () => setDialog("capital"))}
                    {item("edit", Pencil, t("financialAccounts.actions.edit"), () => setDialog("edit"))}
                    {account.operational
                      ? item("unmark-operational", BadgeMinus, t("financialAccounts.actions.unmarkOperational"), () => setDialog("operational"))
                      : item("mark-operational", BadgeCheck, t("financialAccounts.actions.markOperational"), () => setDialog("operational"))}
                    {archiveItem}
                  </>
                )}
              </Menu.Content>
            </Menu.Positioner>
          </Portal>
        </Menu.Root>
      )}

      {dialog === "edit" && <AccountFormDialog teamId={teamId} account={account} open onOpenChange={close} />}
      {dialog === "transfer" && <TransferDialog teamId={teamId} from={account} balance={balance} open onOpenChange={close} />}
      {dialog === "capital" && <CapitalDialog teamId={teamId} account={account} open onOpenChange={close} />}
      {dialog === "reconcile" && <ReconcileDialog teamId={teamId} account={account} balance={balance} open onOpenChange={close} />}
      {dialog === "identify" && (
        <IdentifyDialog teamId={teamId} account={account} balance={balance} shopNames={shopNames} open onOpenChange={close} />
      )}
      {dialog === "operational" && (
        <ConfirmDialog
          open
          onOpenChange={close}
          title={t(account.operational ? "financialAccounts.operationalDialog.unmarkTitle" : "financialAccounts.operationalDialog.markTitle", {
            name: account.name,
          })}
          message={t(
            account.operational ? "financialAccounts.operationalDialog.unmarkMessage" : "financialAccounts.operationalDialog.markMessage",
            { name: account.name },
          )}
          confirmLabel={t(account.operational ? "financialAccounts.actions.unmarkOperational" : "financialAccounts.actions.markOperational")}
          onConfirm={doOperational}
        />
      )}
      {dialog === "archive" && (
        <ConfirmDialog
          open
          onOpenChange={close}
          title={t("financialAccounts.archiveDialog.title", { name: account.name })}
          message={t("financialAccounts.archiveDialog.message", { name: account.name, amount: formatRupiahNumber(0) })}
          confirmLabel={t("financialAccounts.actions.archive")}
          destructive
          onConfirm={doArchive}
        />
      )}
    </HStack>
  );
}
