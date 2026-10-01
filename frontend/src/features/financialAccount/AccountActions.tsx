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

type DialogName = "edit" | "transfer" | "capital" | "reconcile" | "identify" | "archive";

// What can be DONE to one account, and the dialogs that do it — shared by the accounts list (a row's
// overflow menu) and the account's page (the same menu, plus Transfer and Reconcile as buttons).
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
  /** Also show Transfer and Reconcile as buttons — the account's page. */
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

  // No confirm either: marking changes what a restock's Paid from offers, and unmarking undoes it.
  function doOperational(next: boolean) {
    operational.mutate(
      { teamId, accountId: account.id, operational: next },
      {
        onSuccess: () =>
          toaster.create({
            type: "success",
            title: t(next ? "financialAccounts.toast.markedOperational" : "financialAccounts.toast.unmarkedOperational", {
              name: account.name,
            }),
          }),
        onError: fail,
      },
    );
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
      {buttons && !archived && (
        <>
          <Button size="xs" variant="outline" data-testid={`account-transfer-button-${id}`} onClick={() => setDialog("transfer")}>
            <Icon as={ArrowLeftRight} boxSize="4" />
            {t("financialAccounts.actions.transfer")}
          </Button>
          {!unknown && (
            <Button size="xs" variant="outline" data-testid={`account-reconcile-button-${id}`} onClick={() => setDialog("reconcile")}>
              <Icon as={Scale} boxSize="4" />
              {t("financialAccounts.actions.reconcile")}
            </Button>
          )}
          {unknown && (
            <Button size="xs" colorPalette="brand" data-testid={`account-identify-button-${id}`} onClick={() => setDialog("identify")}>
              <Icon as={SearchCheck} boxSize="4" />
              {t("financialAccounts.actions.identify")}
            </Button>
          )}
        </>
      )}

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
                  {item("transfer", ArrowLeftRight, t("financialAccounts.actions.transferOut"), () => setDialog("transfer"))}
                  {archiveItem}
                </>
              ) : (
                <>
                  {item("transfer", ArrowLeftRight, t("financialAccounts.actions.transfer"), () => setDialog("transfer"))}
                  {item("reconcile", Scale, t("financialAccounts.actions.reconcile"), () => setDialog("reconcile"))}
                  {item("capital", HandCoins, t("financialAccounts.actions.capital"), () => setDialog("capital"))}
                  {item("edit", Pencil, t("financialAccounts.actions.edit"), () => setDialog("edit"))}
                  {account.operational
                    ? item("unmark-operational", BadgeMinus, t("financialAccounts.actions.unmarkOperational"), () => doOperational(false))
                    : item("mark-operational", BadgeCheck, t("financialAccounts.actions.markOperational"), () => doOperational(true))}
                  {archiveItem}
                </>
              )}
            </Menu.Content>
          </Menu.Positioner>
        </Portal>
      </Menu.Root>

      {dialog === "edit" && <AccountFormDialog teamId={teamId} account={account} open onOpenChange={close} />}
      {dialog === "transfer" && <TransferDialog teamId={teamId} from={account} balance={balance} open onOpenChange={close} />}
      {dialog === "capital" && <CapitalDialog teamId={teamId} account={account} open onOpenChange={close} />}
      {dialog === "reconcile" && <ReconcileDialog teamId={teamId} account={account} balance={balance} open onOpenChange={close} />}
      {dialog === "identify" && (
        <IdentifyDialog teamId={teamId} account={account} balance={balance} shopNames={shopNames} open onOpenChange={close} />
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
