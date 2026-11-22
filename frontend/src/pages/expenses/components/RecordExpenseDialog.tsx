import { useState } from "react";
import type { FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Link as RouterLink } from "react-router-dom";
import {
  Alert,
  Box,
  Button,
  CloseButton,
  Dialog,
  Field,
  HStack,
  Icon,
  IconButton,
  Link,
  Portal,
  Stack,
  Text,
  Textarea,
} from "@chakra-ui/react";
import { Plus } from "lucide-react";
import { Code, ConnectError } from "@connectrpc/connect";

import { rpcError } from "../../../api/clients";
import { useSaveExpense } from "../queries";
import { ExpenseKind, ExpenseType } from "../../../gen/warehouse/expense/v1/expense_pb";
import { CurrencyInput } from "../../../components/inputs/CurrencyInput";
import { DatePicker } from "../../../components/datetime/DatePicker";
import { ShopSelect } from "../../../components/pickers/ShopSelect";
import { FinancialAccountSelect } from "../../../components/pickers/FinancialAccountSelect";
import { useFinancialAccountOptions } from "../../../features/financialAccount/queries";
import { isUnknown } from "../../../features/financialAccount/vocab";
import { toaster } from "../../../components/feedback/Toaster";
import { todayWibDateInput } from "../../../lib/datetime";
import {
  accountHelpKey,
  accountLabelKey,
  operationalOnlyFor,
  typeDef,
} from "../../../features/expense/expenseTypes";
import { ExpenseTypeLine, ExpenseTypeSelect } from "./ExpenseTypeParts";

interface RecordCostDialogProps {
  teamId: bigint;
  /** A phone header's drawing of the trigger — its icon alone, labelled (a-phone-header-action-is-an-icon). */
  compact?: boolean;
}

// RecordExpenseDialog enters a cost (#170).
//
// A DIALOG rather than a page, and that is the repo's own distinction: a dialog is for a focused
// ACTION, a page is for reading an entity. Entering a cost is five fields and a button.
//
// It only ever RECORDS: an expense is never edited after it is saved (an-expense-is-never-edited). A mistake is
// corrected by AdjustExpenseDialog, which writes a row of its own.
//
// PAID FROM is REQUIRED (an-expense-must-name-the-account-that-paid): one of the team's operational accounts, picked
// with the restock form's own picker. A team with none cannot send the form — as a restock cannot — and is told where
// an admin marks one.
//
// THE TYPE (expense-types-sit-under-groups, the-expense-types-prototype-is-accepted): the picker lists the types under
// their group; the type's group is sent as the kind. Under it the direction — a badge and a line (the amount stays
// positive), and for Prive / Setoran modal the line that it is the account's capital row. The account field reads
// *Dibayar dari*, *Diambil dari* (Prive) or *Masuk ke* (money in); Prive and Setoran modal pick among ANY of the team's
// active accounts, every other type among the operational ones.
//
// THE SHOP IS FOR THE MARKETPLACE'S ADS ONLY, AND THEY NEED ONE (an-expense-names-a-shop-only-for-ads, read per type):
// the field shows only on Iklan marketplace, required there; any other type sends shop 0, and switching away clears it.
// The server refuses both ways.
//
// AN ACCOUNT THAT MAY NO LONGER PAY — unmarked or archived since the picker loaded — is refused by the server
// (FailedPrecondition, naming it). Its words are said in the dialog, the pick is dropped and the picker re-reads the
// team's operational accounts, so the next pick is among the ones that may pay now.
export function RecordExpenseDialog({ teamId, compact = false }: RecordCostDialogProps) {
  const { t } = useTranslation();

  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<ExpenseKind>(ExpenseKind.UNSPECIFIED);
  // The picked type (UNSPECIFIED until picked) — its group is `kind`.
  const [typeId, setTypeId] = useState<ExpenseType>(ExpenseType.UNSPECIFIED);
  const [amount, setAmount] = useState("");
  // TODAY IN JAKARTA — the day the month on the screen is counted in. The UTC day was yesterday from 00:00 to 07:00 WIB,
  // and on the 1st it was last month's last day: the cost went into a month the screen was not showing.
  const [occurredAt, setOccurredAt] = useState(todayWibDateInput);
  const [shopId, setShopId] = useState<bigint>(0n);
  const [financeAccountId, setFinanceAccountId] = useState<bigint>(0n);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");

  // The write, and what it invalidates, declared together in queries.ts (#177). `busy` is gone: the
  // mutation already knows whether it is in flight, and a second flag beside it is a second answer to
  // the same question that can disagree with the first.
  const save = useSaveExpense();
  const busy = save.isPending;

  function reset() {
    setKind(ExpenseKind.UNSPECIFIED);
    setAmount("");
    setOccurredAt(todayWibDateInput());
    setShopId(0n);
    setFinanceAccountId(0n);
    setNote("");
    setError("");
    setTypeId(ExpenseType.UNSPECIFIED);
  }

  // The picker's own read (the same cache entry), asked here only to say WHY nothing can be picked.
  const accounts = useFinancialAccountOptions({ teamId, operationalOnly: true });
  // Capital takes any active account, so only a type that needs an operational one is blocked by having none.
  const noOperational =
    operationalOnlyFor(typeId) && accounts.isSuccess && accounts.data.filter((a) => !isUnknown(a)).length === 0;

  // The shop is the marketplace's ads' — the one type that names it (Konten · endorse sits under Iklan and names none).
  const isAds = typeDef(typeId)?.namesShop === true;

  // A type names its group (the kind), and only the Iklan marketplace type keeps a shop — leaving it clears the shop, so
  // a hidden pick is never sent. Moving between capital and the rest drops the account, since capital picks among every
  // account and the rest among the operational ones.
  function pickType(next: ExpenseType) {
    const def = typeDef(next);
    if (!def) return;
    if (def.capital !== typeDef(typeId)?.capital) setFinanceAccountId(0n);
    setTypeId(next);
    setKind(def.group);
    if (!def.namesShop) setShopId(0n);
  }

  // A kind and a real amount are the two things a cost cannot be recorded without — the contract
  // refuses UNSPECIFIED and requires amount > 0, so this mirrors the server rather than inventing a
  // second idea of "ready to send".
  //
  // Plus the account that paid, and on Ads the shop — what is still missing is listed under the form, as on a restock.
  const missing: ("kind" | "amount" | "shop" | "account")[] = [];
  if (typeId === ExpenseType.UNSPECIFIED) missing.push("kind");
  if (amount === "" || Number(amount) <= 0) missing.push("amount");
  if (isAds && shopId === 0n) missing.push("shop");
  if (financeAccountId === 0n) missing.push("account");
  const ready = missing.length === 0;

  function submit(event: FormEvent) {
    event.preventDefault();

    if (!ready) return;

    setError("");

    save.mutate(
      {
        teamId,
        kind,
        type: typeId,
        amount: Number(amount),
        occurredAt,
        shopId: isAds ? shopId : 0n,
        note,
        financeAccountId,
      },
      {
        onSuccess: () => {
          toaster.create({ type: "success", title: t("expenses.toast.recorded") });

          setOpen(false);
          reset();
        },
        onError: (err) => {
          setError(rpcError(err));

          if (err instanceof ConnectError && err.code === Code.FailedPrecondition) {
            setFinanceAccountId(0n);
            void accounts.refetch();
          }
        },
      },
    );
  }

  function change(next: boolean) {
    // Read on OPENING too, not only when the form was last reset: a page left open overnight would otherwise offer the
    // day it was loaded on.
    if (next) {
      setOccurredAt(todayWibDateInput());
    }

    setOpen(next);

    if (!next) {
      reset();
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={(e) => change(e.open)} placement="center">
      <Dialog.Trigger asChild>
        {compact ? (
          <IconButton
            colorPalette="brand"
            size="sm"
            aria-label={t("expenses.record")}
            title={t("expenses.record")}
            data-testid="open-record-cost"
          >
            <Icon as={Plus} boxSize="4" />
          </IconButton>
        ) : (
          <Button colorPalette="brand" size="xs" data-testid="open-record-cost">
            <Icon as={Plus} boxSize="4" />
            {t("expenses.record")}
          </Button>
        )}
      </Dialog.Trigger>

      <Portal>
        <Dialog.Backdrop />
        <Dialog.Positioner>
          <Dialog.Content>
            <form onSubmit={submit}>
              <Dialog.Header>
                <Dialog.Title>{t("expenses.recordTitle")}</Dialog.Title>
              </Dialog.Header>

              <Dialog.Body>
                <Stack gap="field">
                  <Field.Root required>
                    <Field.Label>{t("expenses.table.kind")}</Field.Label>
                    <ExpenseTypeSelect value={typeId} onChange={pickType} disabled={busy} />
                    <ExpenseTypeLine typeId={typeId} />
                  </Field.Root>

                  <Field.Root required>
                    <Field.Label>{t("expenses.table.amount")}</Field.Label>
                    <CurrencyInput
                      value={amount}
                      onChange={setAmount}
                      disabled={busy}
                      data-testid="expense-amount"
                    />
                  </Field.Root>

                  <Field.Root required>
                    <Field.Label>{t("expenses.table.date")}</Field.Label>
                    <DatePicker
                      value={occurredAt}
                      onChange={setOccurredAt}
                      disabled={busy}
                      testId="expense-date"
                    />
                    {/* The date the cost BELONGS TO — payroll paid on the 5th is last month's cost. */}
                    <Field.HelperText>{t("expenses.dateHelp")}</Field.HelperText>
                  </Field.Root>

                  {isAds && (
                    <Field.Root required>
                      <Field.Label>
                        <HStack gap="1">
                          {t("expenses.table.shop")}
                          <Field.RequiredIndicator />
                        </HStack>
                      </Field.Label>
                      <Box w="full" data-testid="expense-shop-field">
                        <ShopSelect teamId={teamId} value={shopId} onChange={setShopId} disabled={busy} withClosed />
                      </Box>
                      <Field.HelperText>{t("expenses.shopAdsHelp")}</Field.HelperText>
                    </Field.Root>
                  )}

                  <Field.Root required>
                    <Field.Label>
                      <HStack gap="1">
                        {t(accountLabelKey(typeId))}
                        <Field.RequiredIndicator />
                      </HStack>
                    </Field.Label>
                    <Box w="full">
                      <FinancialAccountSelect
                        teamId={teamId}
                        operationalOnly={operationalOnlyFor(typeId)}
                        // One operational account is the answer; asking would be ceremony — as on a restock.
                        autoPickSingle
                        value={financeAccountId}
                        onChange={setFinanceAccountId}
                        disabled={busy || noOperational}
                        testId="expense-paid-from"
                      />
                    </Box>
                    {noOperational ? (
                      <Alert.Root status="warning" size="sm" mt="1" data-testid="expense-no-operational">
                        <Alert.Indicator />
                        <Alert.Content>
                          <Alert.Description>
                            {t("expenses.noOperational")}{" "}
                            <Link asChild fontWeight="medium" data-testid="expense-open-accounts">
                              <RouterLink to="/financial-accounts">{t("expenses.openAccounts")}</RouterLink>
                            </Link>
                          </Alert.Description>
                        </Alert.Content>
                      </Alert.Root>
                    ) : (
                      <Field.HelperText>{t(accountHelpKey(typeId))}</Field.HelperText>
                    )}
                  </Field.Root>

                  <Field.Root>
                    <Field.Label>{t("expenses.table.note")}</Field.Label>
                    <Textarea
                      value={note}
                      disabled={busy}
                      data-testid="expense-note"
                      onChange={(e) => setNote(e.target.value)}
                    />
                  </Field.Root>

                  {/* A disabled Save says nothing about WHY — so what is missing is listed, as on a restock. */}
                  {missing.length > 0 && (
                    <Stack gap="0" fontSize="sm" color="fg.muted" data-testid="expense-form-missing">
                      <Text>{t("expenses.missing.title")}</Text>
                      {missing.map((m) => (
                        <Text key={m} data-testid={`expense-form-missing-${m}`}>
                          · {t(`expenses.missing.${m}`)}
                        </Text>
                      ))}
                    </Stack>
                  )}

                  {error && (
                    <Dialog.Description color="error.fg" data-testid="expense-form-error">
                      {error}
                    </Dialog.Description>
                  )}
                </Stack>
              </Dialog.Body>

              <Dialog.Footer>
                <Dialog.ActionTrigger asChild>
                  <Button variant="outline" disabled={busy}>
                    {t("common.cancel")}
                  </Button>
                </Dialog.ActionTrigger>
                <Button type="submit" colorPalette="brand" loading={busy} disabled={!ready} data-testid="submit-cost">
                  {t("expenses.save")}
                </Button>
              </Dialog.Footer>
            </form>

            <Dialog.CloseTrigger asChild>
              <CloseButton size="sm" />
            </Dialog.CloseTrigger>
          </Dialog.Content>
        </Dialog.Positioner>
      </Portal>
    </Dialog.Root>
  );
}
