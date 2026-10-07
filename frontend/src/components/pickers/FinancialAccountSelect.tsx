import { useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { HStack, Select, Span, createListCollection } from "@chakra-ui/react";

import type { FinancialAccountProvider } from "../../gen/warehouse/financial_account/v1/financial_account_pb";
import { ProviderBadge } from "../../features/financialAccount/badges";
import { useFinancialAccountOptions } from "../../features/financialAccount/queries";
import { isUnknown } from "../../features/financialAccount/vocab";

export interface FinancialAccountSelectProps {
  /** The team whose accounts to offer — an account is team-scoped, so this is required. */
  teamId: bigint;
  /** Selected account id (0n = none). */
  value?: bigint;
  onChange?: (accountId: bigint) => void;
  /** Only accounts marked operational — a restock's *Paid from* (operational-accounts-pay-for-operations). */
  operationalOnly?: boolean;
  /** Accounts that may not be picked here — a transfer's *to* leaves out its *from*. */
  excludeIds?: bigint[];
  /** Pick the only option when there is exactly one — the restock form's pre-fill. */
  autoPickSingle?: boolean;
  placeholder?: string;
  disabled?: boolean;
  testId?: string;
}

type AccountItem = { label: string; value: string; provider: FinancialAccountProvider; tail: string };

// The last four of a number — enough to tell BCA Operasional's 7890 from BCA Gaji's 7891 at a glance,
// without printing a whole account number into every dropdown.
const tailOf = (accountNumber: string) => (accountNumber.length > 4 ? `•••${accountNumber.slice(-4)}` : accountNumber);

// FinancialAccountSelect — WHICH of the team's accounts. For recording a fact: which account paid, which
// one money moved to (docs/business/financial_account).
//
// ⚠ IT SHOWS NO BALANCE. A person picking the account that paid is saying what happened, and a number
// beside each option invites "pick the one with money in it" — which is a different, wrong answer.
// Balances are on the accounts page.
//
// Offers ACTIVE accounts only (an archived account is out of every picker), and NEVER an `unknown` one:
// it is nobody's Paid from and no transfer's destination until its bank is named
// (a-shop-with-no-account-gets-an-unknown-one).
export const description =
  "Picks one of the team's active accounts — name, provider and the number's last four, never a balance. Leaves out unknown accounts; can narrow to operational ones and pre-pick a single option.";

export function FinancialAccountSelect({
  teamId,
  value,
  onChange,
  operationalOnly = false,
  excludeIds = [],
  autoPickSingle = false,
  placeholder,
  disabled,
  testId = "financial-account-select",
}: FinancialAccountSelectProps) {
  const { t } = useTranslation();
  const query = useFinancialAccountOptions({ teamId, operationalOnly });

  const excluded = excludeIds.map(String).join(",");
  const accounts = useMemo(
    () => (query.data ?? []).filter((a) => !isUnknown(a) && !excluded.split(",").includes(a.id.toString())),
    [query.data, excluded],
  );

  // The restock form's pre-fill: ONE operational account is the answer, so asking would be ceremony.
  // Only once the list has resolved, and never over a value somebody already chose.
  useEffect(() => {
    if (autoPickSingle && query.isSuccess && accounts.length === 1 && (!value || value === 0n)) {
      onChange?.(accounts[0]!.id);
    }
  }, [autoPickSingle, query.isSuccess, accounts, value, onChange]);

  const collection = useMemo(
    () =>
      createListCollection<AccountItem>({
        items: accounts.map((a) => ({
          label: a.name,
          value: a.id.toString(),
          provider: a.provider,
          tail: tailOf(a.accountNumber),
        })),
      }),
    [accounts],
  );

  // NOTHING TO PICK says why, and what to do about it — an empty dropdown reads as a broken control.
  // For *Paid from* the fix is an admin's: marking an operational account is admin and up.
  const emptyText = operationalOnly ? t("financialAccounts.select.noOperational") : t("financialAccounts.select.empty");

  return (
    <Select.Root
      collection={collection}
      disabled={disabled}
      value={value && value > 0n ? [value.toString()] : []}
      onValueChange={(e) => {
        const picked = e.value[0];
        onChange?.(picked ? BigInt(picked) : 0n);
      }}
    >
      <Select.HiddenSelect />

      <Select.Control>
        <Select.Trigger data-testid={testId}>
          <Select.ValueText
            placeholder={
              query.isError
                ? t("financialAccounts.select.unavailable")
                : query.isSuccess && accounts.length === 0
                  ? emptyText
                  : (placeholder ?? t("financialAccounts.select.placeholder"))
            }
          />
        </Select.Trigger>
        <Select.IndicatorGroup>
          <Select.Indicator />
        </Select.IndicatorGroup>
      </Select.Control>

      {/* No Portal: this picker lives inside modal Dialogs (Transfer, Which account is this?), where a
          portalled listbox renders outside the dialog's inert boundary and cannot be clicked —
          ShopSelect's reasoning. */}
      <Select.Positioner>
        <Select.Content>
          {collection.items.map((item) => (
            <Select.Item item={item} key={item.value} data-testid={`${testId}-option-${item.value}`}>
              <HStack gap="2">
                <Span>{item.label}</Span>
                <ProviderBadge provider={item.provider} />
                {item.tail && (
                  <Span color="fg.muted" fontSize="xs">
                    {item.tail}
                  </Span>
                )}
              </HStack>
              <Select.ItemIndicator />
            </Select.Item>
          ))}
        </Select.Content>
      </Select.Positioner>
    </Select.Root>
  );
}
