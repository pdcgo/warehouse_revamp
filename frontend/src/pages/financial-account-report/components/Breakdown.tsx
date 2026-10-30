import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { Badge, Box, Card, Flex, HStack, SimpleGrid, Stack, Table, Text } from "@chakra-ui/react";
import { ChartColumn } from "lucide-react";

import type { Metric } from "../../../features/financialAccount/analytics";
import { BalanceText, ChangeTypeBadge, ProviderBadge } from "../../../features/financialAccount/badges";
import type { FinancialAccountProvider } from "../../../gen/warehouse/financial_account/v1/financial_account_pb";
import { useIsMobile } from "../../../layouts/shell";
import { formatRupiahBare } from "../../../lib/money";
import { typesThatMoved } from "./ChangeDetailDialog";
import type { Mover } from "./MoversDialog";
import { SignedAmount } from "./ReportSummary";
import { EmptyHint } from "../../../components/feedback/EmptyHint";

// A ROW LIGHTS UP under the pointer, every cell of it (a-table-row-lights-up).
const LIGHTS_UP = { _hover: { "& > td": { bg: "bg.muted" } } } as const;

// Every money column one fixed width, gathered at the right — a row's figures read as one
// (the-rincian-view-is-a-grid-with-tight-figures).
const FIGURE_W = "9.5rem";

// THE RINCIAN VIEW AS TWO QUESTIONS (owner: *"masih bikin bingung ini apa konteks apa dsb, ada ide lain?"* — on the
// proposal: *"kita coba dulu"*, `rincian-answers-two-questions`). Three tables cut three ways said how the data was
// sliced, never what it answered; and Per Akun and Per Penyedia were one set of figures twice.
//
//   ┌ Saldo per Penyedia dan Akun ──────────────┐ ┌ Mutasi per Jenis ──────────────────┐
//   │ Saldo tiap akun, per penyedia               │ │ Dari saldo awal ke saldo akhir      │
//   │                    Awal   Berubah   Akhir   │ │ Saldo awal            11.300.000    │
//   │ [BCA]        10.750.000 +1.293.500 12.043.500│ │ Masuk                +12.000.000    │
//   │    BCA Operasional …                        │ │   [Penarikan] ██████  +11.000.000   │
//   │    BCA Gaji …                               │ │ Keluar                −6.856.500    │
//   │ Total        11.300.000 +5.143.500 16.443.500│ │   [Biaya]     ██       −3.600.000   │
//   └─────────────────────────────────────────────┘ │ Saldo akhir           16.443.500    │
//                                                   └─────────────────────────────────────┘
//
// Each a card with a line saying what it holds. Titled by WHAT IT GROUPS (owner, renaming the two questions: *"oke"* to
// *Saldo per Penyedia dan Akun* and *Mutasi per Jenis*, `rincian-cards-are-named-by-what-they-group`) — the tab is
// already *Rincian*, so neither repeats it; *Penyedia* stays the app's one word for bank, e-wallet and cash alike.
// Side by side from `lg`, the first wider; stacked below it, and on a phone each is a list.
export function Breakdown({
  byAccount,
  byProvider,
  metric,
  accountPicked,
}: {
  byAccount: Mover[] | undefined;
  byProvider: Mover[] | undefined;
  metric: Metric | undefined;
  accountPicked: boolean;
}) {
  const { t } = useTranslation();

  return (
    <SimpleGrid
      columns={{ base: 1, lg: 2 }}
      gridTemplateColumns={{ lg: "3fr 2fr" }}
      gap="section"
      alignItems="start"
      data-testid="account-report-breakdown"
    >
      <Panel
        title={t("financialAccounts.report.breakdown.where.title")}
        lead={t("financialAccounts.report.breakdown.where.lead")}
        unit={accountPicked ? undefined : t("financialAccounts.report.breakdown.where.unit")}
        testId="account-report-breakdown-where"
      >
        {accountPicked ? (
          <Text fontSize="sm" color="fg.muted">
            {t("financialAccounts.report.breakdown.oneAccount")}
          </Text>
        ) : (
          <WhereTheMoneyIs byAccount={byAccount ?? []} byProvider={byProvider ?? []} />
        )}
      </Panel>
      <Panel
        title={t("financialAccounts.report.breakdown.what.title")}
        lead={t("financialAccounts.report.breakdown.what.lead")}
        testId="account-report-breakdown-what"
      >
        <WhatChangedIt metric={metric} />
      </Panel>
    </SimpleGrid>
  );
}

// `unit` — THE CURRENCY SAID ONCE, at the right of the title (owner: *"rp di Saldo per Penyedia dan Akun hilang per
// kolom"*, `the-rincian-says-rp-once`), so the figures under it are digits alone.
function Panel({
  title,
  lead,
  unit,
  testId,
  children,
}: {
  title: string;
  lead: string;
  unit?: string;
  testId: string;
  children: ReactNode;
}) {
  return (
    <Card.Root variant="outline" data-testid={testId}>
      <Card.Header gap="1">
        {/* Read, not glanced past (owner: *"dalam Rp kurang jelas sedikit"*) — the field label's size, colour and weight,
            in words; under the title when the two do not fit on one line. */}
        <Flex justify="space-between" align="baseline" gap="1" columnGap="3" wrap="wrap">
          <Card.Title>{title}</Card.Title>
          {unit && (
            <Text fontSize="sm" fontWeight="bold" color="fg.label" whiteSpace="nowrap" data-testid={`${testId}-unit`}>
              {unit}
            </Text>
          )}
        </Flex>
        <Card.Description>{lead}</Card.Description>
      </Card.Header>
      <Card.Body>{children}</Card.Body>
    </Card.Root>
  );
}

function Empty() {
  const { t } = useTranslation();
  return (
    <EmptyHint
      icon={ChartColumn}
      size="sm"
      title={t("financialAccounts.report.empty")}
      description={t("emptyHint.otherPeriod")}
    />
  );
}

// ── Saldo per penyedia dan akun ──────────────────────────────────────────────────────────────────────────────────────────────

interface ProviderGroup {
  provider: Mover;
  accounts: Mover[];
}

// Each provider with its accounts under it, in the server's order — the provider that moved most first, and inside it
// the account that moved most. An account whose provider has no row (it could not be named) closes the list alone.
function groupByProvider(byProvider: Mover[], byAccount: Mover[]): { groups: ProviderGroup[]; loose: Mover[] } {
  const groups = byProvider.map((provider) => ({
    provider,
    accounts: byAccount.filter((a) => a.provider !== undefined && a.provider === provider.provider),
  }));
  const placed = new Set(groups.flatMap((g) => g.accounts.map((a) => a.id)));
  return { groups, loose: byAccount.filter((a) => !placed.has(a.id)) };
}

// A PROVIDER AND ITS ACCOUNTS, ONE TABLE — the provider's row its subtotal, on a grey ground, its accounts indented
// under it; a Total that is the whole team. An account row opens the account. Per Penyedia is no longer a table of its
// own: a provider IS the sum of its accounts, so the two were one set of figures read twice.
function WhereTheMoneyIs({ byAccount, byProvider }: { byAccount: Mover[]; byProvider: Mover[] }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const isMobile = useIsMobile();

  if (byProvider.length === 0 && byAccount.length === 0) return <Empty />;

  const { groups, loose } = groupByProvider(byProvider, byAccount);
  const total = {
    open: byAccount.reduce((sum, r) => sum + (r.open ?? 0), 0),
    change: byAccount.reduce((sum, r) => sum + r.change, 0),
    close: byAccount.reduce((sum, r) => sum + r.close, 0),
  };
  const opens = (r: Mover) => (r.to ? () => navigate(r.to!) : undefined);

  const accountName = (r: Mover) => (
    <HStack gap="2" wrap="wrap" minW="0">
      <Text fontSize="sm" color={r.archived ? "fg.muted" : undefined}>
        {r.name}
      </Text>
      {r.archived && <Badge colorPalette="gray">{t("financialAccounts.archived")}</Badge>}
    </HStack>
  );
  const providerName = (provider: FinancialAccountProvider | undefined, name: string) =>
    provider !== undefined ? <ProviderBadge provider={provider} /> : <Text fontSize="sm">{name}</Text>;

  if (isMobile) {
    // A phone: the provider's line, then its accounts indented — the name left, the closing balance with the change
    // under it right, as every report row reads on a phone.
    const line = (
      key: string,
      name: ReactNode,
      r: { open?: number; close: number; change: number },
      opts: { strong?: boolean; indent?: boolean; onClick?: () => void; testId: string },
    ) => (
      <Flex
        key={key}
        justify="space-between"
        align="start"
        gap="3"
        py="2.5"
        ps={opts.indent ? "4" : undefined}
        bg={opts.strong ? "bg.muted" : undefined}
        px={opts.strong ? "2" : undefined}
        borderBottomWidth="1px"
        borderColor="border"
        cursor={opts.onClick ? "pointer" : undefined}
        onClick={opts.onClick}
        data-testid={opts.testId}
      >
        {/* THE OPENING BALANCE UNDER THE NAME (owner: *"rincian juga ada saldo awal"*, `a-phone-breakdown-row-shows-its-opening`)
            — the desktop's Saldo awal column, which the phone's two figures on the right had left out. */}
        <Stack gap="0.5" minW="0" align="start">
          {name}
          {r.open !== undefined && (
            <Text fontSize="xs" color="fg.muted" data-testid={`${opts.testId}-open`}>
              {t("financialAccounts.report.open")} {formatRupiahBare(r.open)}
            </Text>
          )}
        </Stack>
        <Stack gap="0.5" align="end" flexShrink="0">
          <BalanceText balance={r.close} bold bare />
          <Text
            fontSize="sm"
            fontWeight={opts.strong ? "bold" : undefined}
            color={r.change === 0 ? "fg.muted" : undefined}
          >
            <SignedAmount amount={r.change} bare />
          </Text>
        </Stack>
      </Flex>
    );

    return (
      <Stack gap="0">
        {groups.map((g) => [
          line(g.provider.id, providerName(g.provider.provider, g.provider.name), g.provider, {
            strong: true,
            testId: `breakdown-row-${g.provider.id}`,
          }),
          ...g.accounts.map((a) =>
            line(a.id, accountName(a), a, { indent: true, onClick: opens(a), testId: `breakdown-row-${a.id}` }),
          ),
        ])}
        {loose.map((a) => line(a.id, accountName(a), a, { onClick: opens(a), testId: `breakdown-row-${a.id}` }))}
        {line(
          "total",
          <Text fontSize="sm" fontWeight="bold">
            {t("financialAccounts.report.total")}
          </Text>,
          total,
          {
            testId: "breakdown-total-where",
          },
        )}
      </Stack>
    );
  }

  const figures = (r: { open?: number; change: number; close: number }, strong = false) => (
    <>
      <Table.Cell textAlign="end">
        <BalanceText balance={r.open ?? 0} bold={strong} bare />
      </Table.Cell>
      <Table.Cell textAlign="end" whiteSpace="nowrap">
        <Text fontSize="sm" fontWeight={strong ? "bold" : undefined} color={r.change === 0 ? "fg.muted" : undefined}>
          <SignedAmount amount={r.change} bare />
        </Text>
      </Table.Cell>
      {/* THE CLOSE READS FROM THE LEFT (owner: *"saldo akhir di rincian, text align left"*,
          `the-rincian-close-is-left-aligned`) — its heading and every figure under it; the column keeps its place. */}
      <Table.Cell textAlign="start" data-testid="breakdown-close-cell">
        <BalanceText balance={r.close} bold bare />
      </Table.Cell>
    </>
  );

  return (
    <Table.Root size="sm" tableLayout="fixed" data-testid="breakdown-table-where">
      <Table.Header>
        <Table.Row>
          <Table.ColumnHeader>{t("financialAccounts.report.breakdown.where.name")}</Table.ColumnHeader>
          <Table.ColumnHeader textAlign="end" w={FIGURE_W}>
            {t("financialAccounts.report.open")}
          </Table.ColumnHeader>
          <Table.ColumnHeader textAlign="end" w={FIGURE_W}>
            {t("financialAccounts.report.change")}
          </Table.ColumnHeader>
          <Table.ColumnHeader textAlign="start" w={FIGURE_W}>
            {t("financialAccounts.report.close")}
          </Table.ColumnHeader>
        </Table.Row>
      </Table.Header>
      <Table.Body>
        {groups.map((g) => [
          <Table.Row key={g.provider.id} bg="bg.muted" data-testid={`breakdown-row-${g.provider.id}`}>
            <Table.Cell>{providerName(g.provider.provider, g.provider.name)}</Table.Cell>
            {figures(g.provider, true)}
          </Table.Row>,
          ...g.accounts.map((a) => (
            <Table.Row
              key={a.id}
              cursor={a.to ? "pointer" : undefined}
              css={a.to ? LIGHTS_UP : undefined}
              onClick={opens(a)}
              data-testid={`breakdown-row-${a.id}`}
            >
              <Table.Cell ps="8">{accountName(a)}</Table.Cell>
              {figures(a)}
            </Table.Row>
          )),
        ])}
        {loose.map((a) => (
          <Table.Row
            key={a.id}
            cursor={a.to ? "pointer" : undefined}
            css={a.to ? LIGHTS_UP : undefined}
            onClick={opens(a)}
            data-testid={`breakdown-row-${a.id}`}
          >
            <Table.Cell>{accountName(a)}</Table.Cell>
            {figures(a)}
          </Table.Row>
        ))}
        <Table.Row data-testid="breakdown-total-where">
          <Table.Cell>
            <Text fontSize="sm" fontWeight="bold">
              {t("financialAccounts.report.total")}
            </Text>
          </Table.Cell>
          {figures(total, true)}
        </Table.Row>
      </Table.Body>
    </Table.Root>
  );
}

// ── Mutasi per jenis ──────────────────────────────────────────────────────────────────────────────────────

// THE BRIDGE — from the opening balance, the money that came in, then the money that went out, to the closing balance:
// how 11.300.000 became 16.443.500, its two ends the cards' own. Each type a bar against the largest of them, the in
// group green and the out group red, both growing one way; the group's subtotal on its heading's line.
function WhatChangedIt({ metric }: { metric: Metric | undefined }) {
  const { t } = useTranslation();
  const isMobile = useIsMobile();
  const moved = typesThatMoved(metric);

  if (!metric || moved.length === 0) return <Empty />;

  const incoming = moved.filter((x) => x.amount > 0);
  const outgoing = moved.filter((x) => x.amount < 0);
  const largest = Math.max(...moved.map((x) => Math.abs(x.amount)));
  const sum = (xs: { amount: number }[]) => xs.reduce((s, x) => s + x.amount, 0);

  const end = (label: string, amount: number, testId: string, top = false) => (
    <Flex
      justify="space-between"
      align="center"
      gap="3"
      py="2.5"
      borderTopWidth={top ? "1px" : undefined}
      borderColor="border"
      data-testid={testId}
    >
      <Text fontSize="sm" fontWeight="bold">
        {label}
      </Text>
      <BalanceText balance={amount} bold />
    </Flex>
  );

  const group = (label: string, xs: { type: number; amount: number }[], into: boolean, testId: string) =>
    xs.length > 0 && (
      // A LITTLE MORE AIR (owner: *"untuk mutasi per jenis kasih tambahan gap sedikit"*, `mutasi-per-jenis-breathes`) — the
      // types 10px apart, a group 12px from its neighbours.
      <Stack gap="2.5" py="3" data-testid={testId}>
        <Flex justify="space-between" align="center" gap="3">
          <Text fontSize="sm" fontWeight="bold" color="fg.label">
            {label}
          </Text>
          <Text fontSize="sm" fontWeight="bold" data-testid={`${testId}-total`}>
            <SignedAmount amount={sum(xs)} />
          </Text>
        </Flex>
        {xs.map((x) =>
          isMobile ? (
            // A phone has no room for a bar between the badge and the amount — squeezed there it was a few pixels. The
            // badge and the amount on one line, the bar at the full width under them.
            <Stack key={x.type} gap="1.5" ps="2" data-testid={`breakdown-row-type-${x.type}`}>
              <Flex justify="space-between" align="center" gap="3">
                <ChangeTypeBadge changeType={x.type} />
                <Text fontSize="sm" whiteSpace="nowrap">
                  <SignedAmount amount={x.amount} />
                </Text>
              </Flex>
              <Bar amount={x.amount} max={largest} into={into} testId={`breakdown-bar-${x.type}`} />
            </Stack>
          ) : (
            <Flex key={x.type} align="center" gap="3" ps="2" data-testid={`breakdown-row-type-${x.type}`}>
              <Box w="8.5rem" flexShrink="0">
                <ChangeTypeBadge changeType={x.type} />
              </Box>
              <Box flex="1" minW="0">
                <Bar amount={x.amount} max={largest} into={into} testId={`breakdown-bar-${x.type}`} />
              </Box>
              <Text fontSize="sm" w="8rem" textAlign="end" flexShrink="0" whiteSpace="nowrap">
                <SignedAmount amount={x.amount} />
              </Text>
            </Flex>
          ),
        )}
      </Stack>
    );

  return (
    <Stack gap="1" data-testid="breakdown-bridge">
      {end(t("financialAccounts.report.open"), metric.openBalance, "breakdown-open")}
      {group(t("financialAccounts.report.breakdown.what.in"), incoming, true, "breakdown-in")}
      {group(t("financialAccounts.report.breakdown.what.out"), outgoing, false, "breakdown-out")}
      {end(t("financialAccounts.report.close"), metric.closeBalance, "breakdown-close", true)}
    </Stack>
  );
}

// A type's size, drawn — growing from the left, its length against the largest type, in its group's tone at the
// lighter `emphasized` step: the amount beside it is the fact, the bar says how big.
function Bar({ amount, max, into, testId }: { amount: number; max: number; into: boolean; testId: string }) {
  const share = max > 0 ? (Math.abs(amount) / max) * 100 : 0;

  return (
    <Box
      h="2"
      w="full"
      bg="bg.muted"
      borderRadius="full"
      aria-hidden="true"
      data-testid={testId}
      data-direction={into ? "in" : "out"}
    >
      <Box h="full" borderRadius="full" bg={into ? "success.emphasized" : "error.emphasized"} w={`${share}%`} />
    </Box>
  );
}
