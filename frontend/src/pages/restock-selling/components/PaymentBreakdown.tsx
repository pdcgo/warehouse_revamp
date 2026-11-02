import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { CloseButton, Dialog, Drawer, Flex, HStack, Portal, Stack, Text } from "@chakra-ui/react";
import { Wallet } from "lucide-react";

import { EmptyHint } from "../../../components/feedback/EmptyHint";
import { ProviderBadge } from "../../../features/financialAccount/badges";
import { useIsMobile } from "../../../layouts/shell";
import { formatRupiahNumber } from "../../../lib/money";
import type { PaymentShare } from "../summarySample";

// THE TRANSACTION VALUE PER PAYING ACCOUNT — what Nilai transaksi's Rincian › opens (a-breakdown-opens-from-rincian): a
// dialog on a desktop, a bottom sheet on a phone. Every restock names the account it was paid from, and the account's
// provider badge says how — a bank is a transfer, ShopeePay an e-wallet — so this answers "how much by transfer, how much
// by ShopeePay" and which account besides (my recommendation, owner: *"sistem baru belum tau akan dibuat seperti apa"*).
//
// ⚠ SAMPLE: the accounts are the team's real operational ones; the split over them is invented (`pending.ts`, `payment`).
export function PaymentBreakdown({
  open,
  onOpenChange,
  rows,
  mark,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rows: PaymentShare[];
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
            key={row.account.id.toString()}
            align="center"
            gap="3"
            py="2.5"
            borderBottomWidth="1px"
            _last={{ borderBottomWidth: "0" }}
            data-testid={`restock-payment-${row.account.id}`}
          >
            <Stack gap="0.5" flex="1" minW="0">
              <Text fontWeight="bold" truncate>
                {row.account.name}
              </Text>
              <HStack gap="1.5">
                <ProviderBadge provider={row.account.provider} />
                <Text fontSize="xs" color="fg.muted">
                  {t("restock.selling.summary.transactionCount", { count: row.transactions })}
                </Text>
              </HStack>
            </Stack>
            <Text fontWeight="bold" whiteSpace="nowrap">
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
