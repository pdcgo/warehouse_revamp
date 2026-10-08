import { useTranslation } from "react-i18next";
import { Badge, Box, Flex, HStack, Icon, Stack, Text } from "@chakra-ui/react";
import { TriangleAlert } from "lucide-react";

import { AccountActions } from "../../../features/financialAccount/AccountActions";
import { BalanceText, ProviderBadge } from "../../../features/financialAccount/badges";
import { TYPE_KEY, isUnknown } from "../../../features/financialAccount/vocab";
import { type FinancialAccount, FinancialAccountStatus } from "../../../gen/warehouse/financial_account/v1/financial_account_pb";
import type { Marketplace } from "../../../gen/warehouse/marketplace/v1/marketplace_pb";
import { formatUnixRelative } from "../../../lib/datetime";
import { AccountLinks } from "./AccountLinks";

// ONE ACCOUNT ON A PHONE (`a-phone-reads-each-line-as-a-block`) — the table's six columns were 929px in a 318px screen,
// the balance and every action off to the right. A block reads top to bottom instead, each line one thing:
//
//   BCA Operasional                         Rp 11.443.500     the name, and the figure the row is read for
//   [BCA] 1234567890 · PT Melati Sejahtera              ⋯     what it is, and what can be done with it
//   Dicek kemarin · [Operasional] [Melati Official] …         when it was checked, and what it is linked to
//
// The same facts and the same test ids as the table's row, so a rule pinned on one is pinned on both; the actions all
// in the ⋯ menu, as a phone's header folds its own (`the-phone-header-is-one-row`). The whole block opens the account.
export function AccountBlock({
  account,
  balance,
  reconciledAt,
  teamId,
  canMove,
  canTransfer,
  shopNames,
  shopOf,
  onOpen,
}: {
  /** The account as the list shows it — a Lainnya account already named by its shop. */
  account: FinancialAccount;
  balance: number | undefined;
  reconciledAt: { seconds: bigint } | undefined;
  teamId: bigint;
  canMove: boolean;
  /** Transfer and Capital are offered — the role may move money (the-warehouse-admin-equals-the-owner-except-money). */
  canTransfer: boolean;
  shopNames: string[];
  shopOf: (shopId: bigint) => { name: string; marketplace: Marketplace } | undefined;
  onOpen: () => void;
}) {
  const { t } = useTranslation();
  const id = account.id.toString();
  const archived = account.status === FinancialAccountStatus.ARCHIVED;
  const unknown = isUnknown(account);

  return (
    <Stack gap="1.5" py="3" borderBottomWidth="1px" borderColor="border" cursor="pointer" onClick={onOpen} data-testid={`account-row-${id}`}>
      <Flex justify="space-between" align="start" gap="3">
        <HStack gap="2" minW="0" wrap="wrap">
          <Text fontWeight="medium" color={archived ? "fg.muted" : undefined}>
            {account.name}
          </Text>
          {archived && (
            <Badge colorPalette="gray" data-testid={`account-archived-${id}`}>
              {t("financialAccounts.archived")}
            </Badge>
          )}
        </HStack>
        <Box flexShrink="0" textAlign="end">
          {/* THE FACT ALONE ON A PHONE (owner: *"tidak perlu cocokkan dengan bank jika mobile"*) — "Di bawah nol", not
              the table's "· cocokkan dengan bank": the block is narrow, and the account's page says what to do. */}
          <BalanceText balance={balance} testId={`account-balance-${id}`} hint={t("financialAccounts.belowZero")} bold />
        </Box>
      </Flex>

      <Flex justify="space-between" align="center" gap="3">
        <HStack gap="2" minW="0" wrap="wrap">
          <ProviderBadge provider={account.provider} />
          {account.accountNumber && (
            <Text fontFamily="mono" fontSize="xs" color="fg.muted" data-testid={`account-number-${id}`}>
              {account.accountNumber}
            </Text>
          )}
          {unknown && account.shopIds.length > 0 ? (
            <HStack gap="1" color="fg.warning" data-testid={`account-not-set-${id}`}>
              <Icon as={TriangleAlert} boxSize="3" />
              <Text fontSize="xs">{t("financialAccounts.accountNotSet")}</Text>
            </HStack>
          ) : (
            <Text fontSize="xs" color="fg.muted">
              {account.holderName || t(TYPE_KEY[account.type]!)}
            </Text>
          )}
        </HStack>
        {canMove && <AccountActions teamId={teamId} account={account} balance={balance} shopNames={shopNames} canTransfer={canTransfer} />}
      </Flex>

      {/* An unknown account is never checked against a bank — the table's "—" says so in a column, but alone on a
          line of its own it reads as something missing, so the line keeps only its links, and goes when it has none. */}
      {(!unknown || account.operational || account.shopIds.length > 0) && (
        <HStack gap="2" wrap="wrap" fontSize="xs">
          {!unknown && (
            <Text fontSize="xs" color={reconciledAt ? "fg.muted" : "fg.subtle"} data-testid={`account-checked-${id}`}>
              {reconciledAt
                ? `${t("financialAccounts.col.lastChecked")} ${formatUnixRelative(reconciledAt.seconds)}`
                : t("financialAccounts.neverChecked")}
            </Text>
          )}
          <AccountLinks account={account} shopOf={shopOf} />
        </HStack>
      )}
    </Stack>
  );
}
