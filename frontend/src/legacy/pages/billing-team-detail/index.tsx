import { Heading, HStack, SimpleGrid, Stack, Text } from "@chakra-ui/react";
import { ArrowDownLeft, ArrowUpRight, Receipt } from "lucide-react";
import { Breadcrumb } from "../../components/display/Breadcrumb";
import { Card } from "../../components/display/Card";
import { DataTable, type TableColumn } from "../../components/display/DataTable";
import { LimitProgress } from "../../components/display/LimitProgress";
import { NavTabs } from "../../components/display/NavTabs";
import { Statistic } from "../../components/display/Statistic";
import { Button } from "../../components/inputs/Button";
import { DateCell } from "../../components/cells/DateCell";
import { StatisticCell } from "../../components/cells/StatisticCell";
import { TeamTypeBadge } from "../../components/badges/TeamTypeBadge";
import { formatRupiahCompact } from "../../../lib/money";
import { TeamType } from "../../../gen/warehouse/team/v1/team_pb";
import type { InvoiceRow, TeamBalanceRow } from "../../financeFixtures";
import { InvoiceStatusBadge } from "../_invoices/InvoiceStatusBadge";

// ONE counterparty's whole billing position — the screen somebody opens before making a phone call.
//
// It gathers what is otherwise spread over four screens: the net balance, the limit, the open
// invoices in both directions. That gathering is the point. Deciding whether to chase, extend or
// stop supplying a team means holding all four at once, and doing that by navigating between the
// payable list, the receivable list, the limits screen and the timeline is how the call gets made on
// two of the four.
//
// The invoices are shown in BOTH directions on one table, with the direction as a column. Somebody
// who owes us money and is owed money by us has a net position, and splitting the table hides it.
export const description =
  "One counterparty's whole billing position — net balance, limit and open invoices in both directions, gathered because deciding whether to chase or extend means holding all of them at once.";

export interface BillingTeamDetailPageProps {
  team: TeamBalanceRow;
  invoices: InvoiceRow[];
  loading?: boolean;
}

export function BillingTeamDetailPage({ team, invoices, loading }: BillingTeamDetailPageProps) {
  const open = invoices.filter((i) => i.status !== "paid" && i.status !== "void");
  const net = team.owed > team.owing ? team.owed - team.owing : team.owing - team.owed;
  const inOurFavour = team.owed >= team.owing;

  const columns: Array<TableColumn<InvoiceRow>> = [
    { name: "Invoice", key: "code" },
    {
      name: "Direction",
      render: (row) => (
        <Text fontSize="sm">{row.direction === "payable" ? "We owe" : "Owed to us"}</Text>
      ),
    },
    { name: "Status", render: (row) => <InvoiceStatusBadge status={row.status} /> },
    { name: "Due", render: (row) => <DateCell value={row.dueAt} grain="relative" /> },
    {
      name: "Outstanding",
      align: "end",
      render: (row) => <StatisticCell value={row.total - row.paid} kind="price" compact />,
    },
  ];

  return (
    <Stack gap="section" data-testid="billing-team-detail-page">
      <Breadcrumb
        items={[{ href: "/billing/teams", name: "Team balances" }, { name: team.name }]}
      />

      <HStack justify="space-between" wrap="wrap" gap="card">
        <HStack gap="3">
          <Heading size="md">{team.name}</Heading>
          <TeamTypeBadge type={team.kind === "warehouse" ? TeamType.WAREHOUSE : TeamType.SELLING} />
        </HStack>
        <Button icon={Receipt}>Record payment</Button>
      </HStack>

      <SimpleGrid columns={{ base: 1, md: 3 }} gap="card">
        <Statistic title="Owed to us" icon={ArrowDownLeft} tone="success" loading={loading}>
          {formatRupiahCompact(team.owed)}
        </Statistic>
        <Statistic title="We owe" icon={ArrowUpRight} tone="warning" loading={loading}>
          {formatRupiahCompact(team.owing)}
        </Statistic>
        <Statistic
          title="Net"
          icon={inOurFavour ? ArrowDownLeft : ArrowUpRight}
          tone={inOurFavour ? "success" : "error"}
          help={inOurFavour ? "Owed to us" : "We owe"}
          loading={loading}
        >
          {formatRupiahCompact(net)}
        </Statistic>
      </SimpleGrid>

      {team.limit > 0n && (
        <Card>
          <Stack gap="2">
            <Text fontSize="sm" fontWeight="medium">
              Credit limit
            </Text>
            <LimitProgress unpaid={team.owing} threshold={team.limit} showValue showIcon />
          </Stack>
        </Card>
      )}

      {/* Tabs here are NAVIGATION — each is a real sub-route of this counterparty, linkable on its
          own. A colleague asked to look at "their payments" should get a URL for it. */}
      <NavTabs
        items={[
          { key: "invoices", label: "Open invoices" },
          { key: "payments", label: "Payments" },
          { key: "timeline", label: "Timeline" },
        ]}
        value="invoices"
        hrefFor={(key) => `/billing/teams/${team.id}/${key}`}
      />

      <DataTable
        columns={columns}
        items={open}
        loading={loading}
        emptyTitle="Nothing outstanding"
        emptyContent="Every invoice with this counterparty is settled."
        aria-label="Open invoices"
      />
    </Stack>
  );
}
