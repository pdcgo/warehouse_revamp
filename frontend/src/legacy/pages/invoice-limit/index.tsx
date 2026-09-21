import { Heading, HStack, Stack, Text } from "@chakra-ui/react";
import { Pencil } from "lucide-react";
import { ActionCell } from "../../components/cells/ActionCell";
import { TeamCell } from "../../components/cells/TeamCell";
import { Alert } from "../../components/display/Alert";
import { DataTable, type TableColumn } from "../../components/display/DataTable";
import { LimitProgress } from "../../components/display/LimitProgress";
import { StatisticCell } from "../../components/cells/StatisticCell";
import { TeamType } from "../../../gen/warehouse/team/v1/team_pb";
import type { TeamBalanceRow } from "../../financeFixtures";

// The CREDIT LIMITS screen — every team's ceiling and how close it is.
//
// Its whole job is to be read before somebody is surprised. A limit is invisible until it stops an
// order, at which point a person on the floor is standing in front of a blocked screen and nobody
// knows why. This is where that becomes visible in advance.
//
// So the rows are sorted by PRESSURE, not by name: the account closest to its ceiling is the one
// worth looking at, and alphabetical order buries it. And a team with NO limit is shown, marked as
// having none — an absent row would read as "no limit problem here" when the truth is "no limit was
// ever set", which is a different and sometimes worse state.
export const description =
  "Every team's credit ceiling and how close it is — read before somebody is surprised by a blocked order. Sorted by PRESSURE rather than name, and a team with no limit set is shown as such rather than omitted.";

export interface InvoiceLimitPageProps {
  teams: TeamBalanceRow[];
  loading?: boolean;
}

export function InvoiceLimitPage({ teams, loading }: InvoiceLimitPageProps) {
  // Sorted by how close to the ceiling. Teams with no limit sort last — they have no pressure to
  // measure, and putting them first would push the urgent rows off the top.
  const rows = [...teams].sort((a, b) => {
    const pressure = (t: TeamBalanceRow) =>
      t.limit > 0n ? Number(t.owing) / Number(t.limit) : -1;
    return pressure(b) - pressure(a);
  });

  const atRisk = rows.filter((t) => t.limit > 0n && Number(t.owing) / Number(t.limit) >= 0.8);

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
      name: "Unpaid",
      align: "end",
      render: (row) => <StatisticCell value={row.owing} kind="price" compact />,
    },
    {
      name: "Limit",
      align: "end",
      render: (row) =>
        row.limit > 0n ? (
          <StatisticCell value={row.limit} kind="price" compact />
        ) : (
          <Text fontSize="sm" color="fg.subtle">
            not set
          </Text>
        ),
    },
    {
      name: "Pressure",
      width: "30%",
      tooltip: "How much of the ceiling is used. Ordering is blocked once it reaches 100%.",
      render: (row) => <LimitProgress unpaid={row.owing} threshold={row.limit} showIcon />,
    },
    {
      name: "",
      width: "1%",
      sticky: "right",
      render: () => <ActionCell items={[{ title: "Change limit", icon: Pencil }]} />,
    },
  ];

  return (
    <Stack gap="section" data-testid="invoice-limit-page">
      <Heading size="md">Credit limits</Heading>

      {atRisk.length > 0 && (
        <Alert tone="warning" title={`${atRisk.length} team${atRisk.length === 1 ? "" : "s"} near the ceiling`} data-testid="limit-warning">
          Ordering stops once a team reaches its limit. Raise the limit or collect payment first.
        </Alert>
      )}

      <DataTable
        columns={columns}
        items={rows}
        loading={loading}
        emptyTitle="No teams"
        emptyContent="Teams with a credit arrangement appear here."
        aria-label="Credit limits"
      />

      <HStack>
        <Text fontSize="sm" color="fg.muted">
          Sorted by how close each team is to its ceiling — the one about to be blocked is first.
        </Text>
      </HStack>
    </Stack>
  );
}
