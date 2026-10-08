import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Stack, Table, Text } from "@chakra-ui/react";

import type { FinancialAccountLog } from "../../../gen/warehouse/financial_account/v1/financial_account_pb";
import { BalanceText, ChangeText, ChangeTypeBadge } from "../../../features/financialAccount/badges";
import { BY_HAND } from "../../../features/financialAccount/vocab";
import { useIsMobile } from "../../../layouts/shell";
import { formatUnixDate } from "../../../lib/datetime";
import { AccountLogDetailDialog } from "./AccountLogDetailDialog";

// A ROW LIGHTS UP UNDER THE POINTER (owner: *"hoverable juga"*, `a-statement-row-lights-up`) — as the report's table
// does: set on every cell, by Chakra's `_hover`, which a story can drive with `data-hover`.
const LIGHTS_UP = { _hover: { "& > td": { bg: "bg.muted" } } } as const;

// The account's statement — newest first, in the order `balance_after` runs (the-log-says-balance-after).
//
// Each row says WHY in words (the-description-names-the-cause), and WHICH WAY it came in: a row a listener
// posted cannot be corrected here by hand — its cause is somewhere else — so the screen says so rather than
// leaving somebody to look for an edit button (one-way-in-per-type).
//
// The date is the day the money MOVED (occurred_at), not the day it was typed. When the two differ the row
// says when it was recorded, because a row dated last week that appeared today explains a balance that
// changed today.
//
// ON A PHONE, TWO COLUMNS UNDER THEIR HEADINGS, AND A TAP FOR THE REST (owner: *"keterangan di mobile lebih baik
// dihidden saja, atau buat modal detail untuk mobile, heading tolong tetap ada, perubahan tolong di bawah saldo
// langsung"*, then *"mobile tipe di bawah tanggal"*; `a-phone-statement-row-opens-its-detail`,
// `the-type-sits-under-the-date-on-a-phone`) — the description, who and when it was typed open in a dialog. Each
// heading names its column's top line:
//
//   Tanggal                       Saldo
//   7 Okt 2026            Rp 11.443.500     ← the day, and the balance the row is read for
//   [Penyesuaian]             −Rp 6.500     ← its type under the day, the change under the balance
export function AccountLogTable({
  logs,
  actorName,
  describe,
}: {
  logs: FinancialAccountLog[];
  actorName: (id: bigint) => string;
  /** The row's description as shown — a listener writes a shop by id, the screen puts its name in. */
  describe: (text: string) => string;
}) {
  const { t } = useTranslation();
  const isMobile = useIsMobile();
  const [opened, setOpened] = useState<FinancialAccountLog | undefined>(undefined);

  if (logs.length === 0) {
    return (
      <Text fontSize="sm" color="fg.muted" data-testid="account-log-empty">
        {t("financialAccounts.log.empty")}
      </Text>
    );
  }

  if (isMobile) {
    return (
      <>
        <Table.Root size="sm" data-testid="account-log-table">
          <Table.Header>
            <Table.Row>
              <Table.ColumnHeader>{t("financialAccounts.log.date")}</Table.ColumnHeader>
              <Table.ColumnHeader textAlign="end">{t("financialAccounts.log.balanceAfter")}</Table.ColumnHeader>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {logs.map((log) => (
              <Table.Row
                key={log.id.toString()}
                cursor="pointer"
                tabIndex={0}
                aria-haspopup="dialog"
                css={{ ...LIGHTS_UP, _active: { "& > td": { bg: "bg.muted" } } }}
                onClick={() => setOpened(log)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setOpened(log);
                  }
                }}
                data-testid={`account-log-row-${log.id}`}
              >
                <Table.Cell verticalAlign="top">
                  <Stack gap="0.5" align="start">
                    <Text fontSize="sm" whiteSpace="nowrap">
                      {log.occurredAt ? formatUnixDate(log.occurredAt.seconds) : "—"}
                    </Text>
                    <ChangeTypeBadge changeType={log.changeType} />
                  </Stack>
                </Table.Cell>
                <Table.Cell textAlign="end" verticalAlign="top">
                  <Stack gap="0.5" align="end">
                    <BalanceText balance={log.balanceAfter} />
                    <ChangeText change={log.change} />
                  </Stack>
                </Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table.Root>
        <AccountLogDetailDialog log={opened} onClose={() => setOpened(undefined)} actorName={actorName} describe={describe} />
      </>
    );
  }

  return (
    <Table.ScrollArea>
      <Table.Root size="sm" data-testid="account-log-table">
        <Table.Header>
          <Table.Row>
            <Table.ColumnHeader>{t("financialAccounts.log.date")}</Table.ColumnHeader>
            <Table.ColumnHeader>{t("financialAccounts.log.type")}</Table.ColumnHeader>
            <Table.ColumnHeader>{t("financialAccounts.log.description")}</Table.ColumnHeader>
            <Table.ColumnHeader textAlign="end">{t("financialAccounts.log.change")}</Table.ColumnHeader>
            <Table.ColumnHeader textAlign="end">{t("financialAccounts.log.balanceAfter")}</Table.ColumnHeader>
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {logs.map((log) => {
            const occurred = log.occurredAt ? formatUnixDate(log.occurredAt.seconds) : "—";
            const recorded = log.createdAt ? formatUnixDate(log.createdAt.seconds) : occurred;
            const byHand = BY_HAND.has(log.changeType);

            return (
              <Table.Row key={log.id.toString()} css={LIGHTS_UP} data-testid={`account-log-row-${log.id}`}>
                <Table.Cell whiteSpace="nowrap">
                  <Text fontSize="sm">{occurred}</Text>
                  {recorded !== occurred && (
                    <Text fontSize="xs" color="fg.muted" data-testid={`account-log-recorded-${log.id}`}>
                      {t("financialAccounts.log.recordedOn", { date: recorded })}
                    </Text>
                  )}
                </Table.Cell>
                <Table.Cell>
                  <ChangeTypeBadge changeType={log.changeType} />
                </Table.Cell>
                <Table.Cell>
                  <Stack gap="0">
                    <Text fontSize="sm">{describe(log.description)}</Text>
                    <Text fontSize="xs" color="fg.muted" data-testid={`account-log-way-${log.id}`}>
                      {byHand
                        ? t("financialAccounts.log.byHand", { name: actorName(log.actorId) })
                        : t("financialAccounts.log.automatic")}
                    </Text>
                  </Stack>
                </Table.Cell>
                <Table.Cell textAlign="end">
                  <ChangeText change={log.change} />
                </Table.Cell>
                <Table.Cell textAlign="end">
                  <BalanceText balance={log.balanceAfter} />
                </Table.Cell>
              </Table.Row>
            );
          })}
        </Table.Body>
      </Table.Root>
    </Table.ScrollArea>
  );
}
