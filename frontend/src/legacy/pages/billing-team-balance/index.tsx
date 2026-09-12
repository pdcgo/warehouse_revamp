import { useMemo, useState } from "react";
import { Heading, Stack, Text } from "@chakra-ui/react";
import { ArrowRight } from "lucide-react";
import { TeamCell } from "../../components/cells/TeamCell";
import { StatisticCell } from "../../components/cells/StatisticCell";
import { DataTable, type TableColumn } from "../../components/display/DataTable";
import { Summary } from "../../components/display/Summary";
import { Button } from "../../components/inputs/Button";
import { SearchInput } from "../../components/inputs/SearchInput";
import { ToneBadge } from "../../components/badges/ToneBadge";
import { formatRupiahCompact } from "../../../lib/money";
import { TeamType } from "../../../gen/warehouse/team/v1/team_pb";
import type { TeamBalanceRow } from "../../financeFixtures";

// Every team's NET position with us, both directions in one row.
//
// The decision: A SINGLE NET COLUMN, with the direction stated in words rather than by a minus sign.
//
// A signed number would be shorter and is what a ledger would do, but this screen is read by people
// deciding who to call — and "-44.000.000" requires knowing the sign convention before it means
// anything, which is exactly the knowledge somebody new to the screen does not have. "We owe" and
// "Owed to us" cannot be misread in either direction.
export const description =
  "Every team's net position, both directions in one row — with the direction in WORDS rather than a minus sign, because a signed number requires knowing the convention before it means anything.";

export interface BillingTeamBalancePageProps {
  teams: TeamBalanceRow[];
  loading?: boolean;
}

export function BillingTeamBalancePage({ teams, loading }: BillingTeamBalancePageProps) {
  const [search, setSearch] = useState("");

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = q ? teams.filter((t) => t.name.toLowerCase().includes(q)) : teams;

    // Largest net exposure first, in either direction — the biggest imbalance is the one to act on,
    // and its sign does not change how urgent it is.
    return [...filtered].sort((a, b) => {
      const net = (t: TeamBalanceRow) => (t.owed > t.owing ? t.owed - t.owing : t.owing - t.owed);
      return Number(net(b) - net(a));
    });
  }, [teams, search]);

  const totals = useMemo(
    () => ({
      owed: teams.reduce((s, t) => s + t.owed, 0n),
      owing: teams.reduce((s, t) => s + t.owing, 0n),
    }),
    [teams],
  );

  const columns: Array<TableColumn<TeamBalanceRow>> = [
    {
      name: "Team",
      sticky: "left",
      render: (row) => (
        <TeamCell
          team={{
            id: row.id,
            name: row.name,
            type: row.kind === "warehouse" ? TeamType.WAREHOUSE : TeamType.SELLING,
          }}
        />
      ),
    },
    {
      name: "Owed to us",
      align: "end",
      render: (row) => <StatisticCell value={row.owed} kind="price" compact />,
    },
    {
      name: "We owe",
      align: "end",
      render: (row) => <StatisticCell value={row.owing} kind="price" compact />,
    },
    {
      name: "Net",
      align: "end",
      tooltip: "The difference, with the direction stated rather than signed.",
      render: (row) => {
        const net = row.owed > row.owing ? row.owed - row.owing : row.owing - row.owed;
        const inOurFavour = row.owed >= row.owing;

        if (net === 0n) {
          return <ToneBadge tone="plain">Settled</ToneBadge>;
        }

        return (
          <Stack gap="0" align="flex-end" lineHeight="short">
            <StatisticCell value={net} kind="price" compact />
            {/* The direction, in words. */}
            <Text fontSize="xs" color={inOurFavour ? "green.fg" : "orange.fg"}>
              {inOurFavour ? "Owed to us" : "We owe"}
            </Text>
          </Stack>
        );
      },
    },
    {
      name: "",
      width: "1%",
      sticky: "right",
      render: (row) => (
        <Button size="xs" tone="plain" variant="ghost" icon={ArrowRight} href={`/billing/teams/${row.id}`}>
          Open
        </Button>
      ),
    },
  ];

  return (
    <Stack gap="section" data-testid="billing-team-balance-page">
      <Heading size="md">Team balances</Heading>

      <Summary
        items={[
          { label: "Owed to us", value: formatRupiahCompact(totals.owed), tone: "success" },
          { label: "We owe", value: formatRupiahCompact(totals.owing), tone: "warning" },
          {
            label: "Net",
            value: formatRupiahCompact(
              totals.owed > totals.owing ? totals.owed - totals.owing : totals.owing - totals.owed,
            ),
            tone: totals.owed >= totals.owing ? "success" : "error",
          },
        ]}
        loading={loading}
        columns={3}
      />

      <SearchInput value={search} onChange={setSearch} placeholder="Team name" maxW="64" />

      <DataTable
        columns={columns}
        items={rows}
        loading={loading}
        emptyTitle="No balances"
        emptyContent="Teams with money moving in either direction appear here."
        aria-label="Team balances"
      />
    </Stack>
  );
}
