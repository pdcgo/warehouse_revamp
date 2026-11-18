import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { CloseButton, Dialog, Drawer, Flex, HStack, Portal, Stack, Text } from "@chakra-ui/react";
import { Wallet } from "lucide-react";

import { EmptyHint } from "../../../components/feedback/EmptyHint";
import { ProviderBadge } from "../../../features/financialAccount/badges";
import { useIsMobile } from "../../../layouts/shell";
import { formatRupiahNumber } from "../../../lib/money";
import type { FinancialAccount } from "../../../gen/warehouse/financial_account/v1/financial_account_pb";
import type { PaymentShare } from "../../../features/restock/sellingStat";

/** One Rincian row: a paying account's share of the pile, and the account itself once its name is read. */
export interface PaymentRow extends PaymentShare {
  /** Undefined while the name is read, for an id the lookup did not answer, and for account 0. */
  account: FinancialAccount | undefined;
}

// THE TRANSACTION VALUE PER PAYING ACCOUNT — what Nilai transaksi's Rincian › opens (a-breakdown-opens-from-rincian): a
// dialog on a desktop, a bottom sheet on a phone. Every restock names the account it was paid from, and the account's
// provider badge says how — a bank is a transfer, ShopeePay an e-wallet — so this answers "how much by transfer, how much
// by ShopeePay" and which account besides (my recommendation, owner: *"sistem baru belum tau akan dibuat seperti apa"*).
//
// THE ROWS ARE THE SERVER'S (RestockSellingStat's `by_account`): each restock's CURRENT paying account, named by id — an
// archived or no-longer-operational account still paid its restocks, so the names come from the by-ids lookup, never the
// operational picker. A restock raised before naming an account was required is a row of its own, so the rows add up to
// the card (*not asked — the build's default*).
export function PaymentBreakdown({
  open,
  onOpenChange,
  rows,
  mark,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rows: PaymentRow[];
  /** The build-status mark beside the title. */
  mark?: ReactNode;
}) {
  const { t } = useTranslation();
  const isMobile = useIsMobile();

  const title = (
    <HStack gap="1.5">
      {t("restock.selling.summary.paymentsTitle")}
      {mark}
    </HStack>
  );

  const body =
    rows.length === 0 ? (
      <EmptyHint icon={Wallet} title={t("restock.selling.summary.paymentsNone")} size="sm" testId="restock-payments-empty" />
    ) : (
      <Stack gap="0" data-testid="restock-payments">
        {rows.map((row) => (
          <Flex
            key={row.accountId.toString()}
            align="center"
            gap="3"
            py="2.5"
            borderBottomWidth="1px"
            _last={{ borderBottomWidth: "0" }}
            data-testid={`restock-payment-${row.accountId}`}
          >
            <Stack gap="0.5" flex="1" minW="0">
              <Text fontWeight="bold" truncate data-testid={`restock-payment-name-${row.accountId}`}>
                {row.account?.name ??
                  (row.accountId === 0n
                    ? t("restock.selling.summary.noAccount")
                    : t("restock.selling.summary.accountRef", { id: row.accountId.toString() }))}
              </Text>
              <HStack gap="1.5">
                {row.account && <ProviderBadge provider={row.account.provider} />}
                <Text fontSize="xs" color="fg.muted" data-testid={`restock-payment-count-${row.accountId}`}>
                  {t("restock.selling.summary.transactionCount", { count: row.transactions })}
                </Text>
              </HStack>
            </Stack>
            <Text fontWeight="bold" whiteSpace="nowrap" data-testid={`restock-payment-value-${row.accountId}`}>
              {formatRupiahNumber(row.value)}
            </Text>
          </Flex>
        ))}
      </Stack>
    );

  if (isMobile) {
    return (
      <Drawer.Root open={open} onOpenChange={(e) => onOpenChange(e.open)} placement="bottom">
        <Portal>
          <Drawer.Backdrop />
          <Drawer.Positioner>
            <Drawer.Content roundedTop="l3" data-testid="restock-payments-sheet">
              <Drawer.Header>
                <Drawer.Title>{title}</Drawer.Title>
              </Drawer.Header>
              <Drawer.CloseTrigger asChild>
                <CloseButton size="sm" />
              </Drawer.CloseTrigger>
              <Drawer.Body pb="6">{body}</Drawer.Body>
            </Drawer.Content>
          </Drawer.Positioner>
        </Portal>
      </Drawer.Root>
    );
  }

  return (
    <Dialog.Root open={open} onOpenChange={(e) => onOpenChange(e.open)} size="sm">
      <Portal>
        <Dialog.Backdrop />
        <Dialog.Positioner>
          <Dialog.Content data-testid="restock-payments-dialog">
            <Dialog.Header>
              <Dialog.Title>{title}</Dialog.Title>
            </Dialog.Header>
            <Dialog.CloseTrigger asChild>
              <CloseButton size="sm" />
            </Dialog.CloseTrigger>
            <Dialog.Body pb="6">{body}</Dialog.Body>
          </Dialog.Content>
        </Dialog.Positioner>
      </Portal>
    </Dialog.Root>
  );
}
