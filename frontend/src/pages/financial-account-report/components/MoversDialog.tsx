import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { Badge, Button, CloseButton, Dialog, Flex, HStack, Portal, Stack, Table, Text } from "@chakra-ui/react";

import { BalanceText, ProviderBadge } from "../../../features/financialAccount/badges";
import type { FinancialAccountProvider } from "../../../gen/warehouse/financial_account/v1/financial_account_pb";
import { useIsMobile } from "../../../layouts/shell";
import { dateInputToUnix, formatUnixDate } from "../../../lib/datetime";
import { SignedAmount } from "./ReportSummary";

/** One account or one provider, with what it moved in the window and where it closed. */
export interface Mover {
  id: string;
  name: string;
  /** An account's provider, or the provider a provider row IS — drawn as its coloured badge either way. */
  provider?: FinancialAccountProvider;
  archived?: boolean;
  change: number;
  close: number;
  /** Where the row leads — an account's own page, its statement. A provider row leads nowhere. */
  to?: string;
}

// WHAT MOVED THE MONEY, BY ACCOUNT OR BY PROVIDER (owner: *"yang menggerakannya bisa jadi statistic juga, detailnya nanti
// tampilkan sesuai yang menggerakan baik akun atau provider"*) — the ranking the report page draws as a table, opened
// from its card instead. Largest movement first, as the server ranks it; a row that did not move stays, muted, because
// it still holds money. The total row (owner: *"Seluruh tim jadi total saja"*) is the team's: its change is the net
// change card, its close the closing balance. A provider is its coloured badge (owner: *"yang penyedia itu badge
// berwarna, biar mudah dikenali"*).
//
// AN ACCOUNT ROW OPENS THE ACCOUNT (owner: *"akun di perubahan per akun? boleh sih disitu"*) — the next question after
// "which account moved it" is "what happened in it", and its page holds the statement. The whole row, as on the
// accounts list.
//
// ON A PHONE, A LIST (owner: *"mobile di modal Perubahan per Akun, perubahan bersih taruh saja di bawah saldo akhir"*) —
// the name on the left, the closing balance with the net change right under it on the right, as a report period's
// block reads (`the-change-sits-under-the-close-on-a-phone`). Three columns did not fit a phone's dialog.
export function MoversDialog({
  open,
  onOpenChange,
  kind,
  rows,
  from,
  to,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  kind: "account" | "provider";
  rows: Mover[];
  from: string;
  to: string;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const day = (d: string) => formatUnixDate(dateInputToUnix(d, false));

  const change = rows.reduce((sum, r) => sum + r.change, 0);
  const close = rows.reduce((sum, r) => sum + r.close, 0);

  return (
    <Dialog.Root open={open} onOpenChange={(e) => onOpenChange(e.open)} size="lg">
      <Portal>
        <Dialog.Backdrop />
        <Dialog.Positioner>
          <Dialog.Content data-testid={`movers-${kind}`}>
            <Dialog.Header>
              <Stack gap="0.5">
                <Dialog.Title>
                  {t(kind === "account" ? "financialAccounts.report.byAccountTitle" : "financialAccounts.report.byProviderTitle")}
                </Dialog.Title>
                <Text fontSize="sm" color="fg.muted">
                  {from === to ? day(from) : `${day(from)} – ${day(to)}`} · {t("financialAccounts.report.wholeTeam")}
                </Text>
              </Stack>
            </Dialog.Header>

            <Dialog.Body>
              {isMobile ? (
                <Stack gap="0">
                  {rows.map((r) => (
                    <Flex
                      key={r.id}
                      justify="space-between"
                      align="start"
                      gap="3"
                      py="2.5"
                      borderBottomWidth="1px"
                      borderColor="border"
                      cursor={r.to ? "pointer" : undefined}
                      onClick={r.to ? () => navigate(r.to!) : undefined}
                      data-testid={`movers-row-${r.id}`}
                      data-zero={r.change === 0 || undefined}
                    >
                      <HStack gap="2" wrap="wrap" minW="0">
                      {kind === "account" ? (
                        <>
                          <Text fontSize="sm" color={r.archived ? "fg.muted" : undefined}>
                            {r.name}
                          </Text>
                          {r.provider !== undefined && <ProviderBadge provider={r.provider} />}
                          {r.archived && <Badge colorPalette="gray">{t("financialAccounts.archived")}</Badge>}
                        </>
                      ) : r.provider !== undefined ? (
                        <ProviderBadge provider={r.provider} />
                      ) : (
                        <Text fontSize="sm">{r.name}</Text>
                      )}
                      </HStack>
                      <Stack gap="0.5" align="end" flexShrink="0">
                        <BalanceText balance={r.close} bold testId={`movers-close-${r.id}`} />
                        <Text fontSize="sm" color={r.change === 0 ? "fg.muted" : undefined} data-testid={`movers-change-${r.id}`}>
                          <SignedAmount amount={r.change} />
                        </Text>
                      </Stack>
                    </Flex>
                  ))}
                  <Flex justify="space-between" align="start" gap="3" py="2.5" data-testid={`movers-total-${kind}`}>
                    <Text fontSize="sm" fontWeight="bold">
                      {t("financialAccounts.report.total")}
                    </Text>
                    <Stack gap="0.5" align="end" flexShrink="0">
                      <BalanceText balance={close} bold />
                      <Text fontSize="sm" fontWeight="bold">
                        <SignedAmount amount={change} />
                      </Text>
                    </Stack>
                  </Flex>
                </Stack>
              ) : (
                <Table.Root size="sm">
                  <Table.Header>
                    <Table.Row>
                      <Table.ColumnHeader>{t(`financialAccounts.report.by.${kind}`)}</Table.ColumnHeader>
                      <Table.ColumnHeader textAlign="end">{t("financialAccounts.report.change")}</Table.ColumnHeader>
                      <Table.ColumnHeader textAlign="end">{t("financialAccounts.report.close")}</Table.ColumnHeader>
                    </Table.Row>
                  </Table.Header>
                  <Table.Body>
                    {rows.map((r) => (
                      <Table.Row
                        key={r.id}
                        cursor={r.to ? "pointer" : undefined}
                        _hover={r.to ? { bg: "bg.muted" } : undefined}
                        onClick={r.to ? () => navigate(r.to!) : undefined}
                        data-testid={`movers-row-${r.id}`}
                        data-zero={r.change === 0 || undefined}
                      >
                        <Table.Cell>
                          <HStack gap="2" wrap="wrap">
                            {kind === "account" ? (
                              <>
                                <Text fontSize="sm" color={r.archived ? "fg.muted" : undefined}>
                                  {r.name}
                                </Text>
                                {r.provider !== undefined && <ProviderBadge provider={r.provider} />}
                                {r.archived && <Badge colorPalette="gray">{t("financialAccounts.archived")}</Badge>}
                              </>
                            ) : r.provider !== undefined ? (
                              <ProviderBadge provider={r.provider} />
                            ) : (
                              <Text fontSize="sm">{r.name}</Text>
                            )}
                          </HStack>
                        </Table.Cell>
                        <Table.Cell textAlign="end" whiteSpace="nowrap">
                          <Text fontSize="sm" color={r.change === 0 ? "fg.muted" : undefined}>
                            <SignedAmount amount={r.change} />
                          </Text>
                        </Table.Cell>
                        <Table.Cell textAlign="end">
                          <BalanceText balance={r.close} bold />
                        </Table.Cell>
                      </Table.Row>
                    ))}
                    <Table.Row data-testid={`movers-total-${kind}`}>
                      <Table.Cell>
                        <Text fontSize="sm" fontWeight="bold">
                          {t("financialAccounts.report.total")}
                        </Text>
                      </Table.Cell>
                      <Table.Cell textAlign="end" whiteSpace="nowrap">
                        <Text fontSize="sm" fontWeight="bold">
                          <SignedAmount amount={change} />
                        </Text>
                      </Table.Cell>
                      <Table.Cell textAlign="end">
                        <BalanceText balance={close} bold />
                      </Table.Cell>
                    </Table.Row>
                  </Table.Body>
                </Table.Root>
              )}
            </Dialog.Body>

            <Dialog.Footer>
              <Dialog.ActionTrigger asChild>
                <Button variant="outline">{t("common.close")}</Button>
              </Dialog.ActionTrigger>
            </Dialog.Footer>

            <Dialog.CloseTrigger asChild>
              <CloseButton size="sm" />
            </Dialog.CloseTrigger>
          </Dialog.Content>
        </Dialog.Positioner>
      </Portal>
    </Dialog.Root>
  );
}
