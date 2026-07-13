import { useEffect, useState } from "react";
import { Badge, Heading, Spinner, Stack, Table, Text } from "@chakra-ui/react";
import { teamClient } from "../api/clients";
import { TeamType } from "../gen/warehouse/team/v1/team_pb";
import type { Team } from "../gen/warehouse/team/v1/team_pb";

const TYPE_LABEL: Record<number, string> = {
  [TeamType.ROOT]: "Root",
  [TeamType.ADMIN]: "Admin",
  [TeamType.WAREHOUSE]: "Warehouse",
  [TeamType.SELLING]: "Selling",
};

export function TeamsPage() {
  const [teams, setTeams] = useState<Team[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    void (async () => {
      try {
        const res = await teamClient.teamList({ page: { page: 1, limit: 50 } });
        setTeams(res.teams);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) {
    return <Spinner colorPalette="brand" />;
  }

  return (
    <Stack gap="section">
      <Heading size="md">Teams</Heading>

      {error && <Text color="red.fg" data-testid="teams-error">{error}</Text>}

      <Table.Root size="sm" data-testid="teams-table">
        <Table.Header>
          <Table.Row>
            <Table.ColumnHeader>Name</Table.ColumnHeader>
            <Table.ColumnHeader>Code</Table.ColumnHeader>
            <Table.ColumnHeader>Type</Table.ColumnHeader>
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {teams.map((team) => (
            <Table.Row key={team.id.toString()}>
              <Table.Cell>{team.name}</Table.Cell>
              <Table.Cell>{team.teamCode}</Table.Cell>
              <Table.Cell>
                <Badge>{TYPE_LABEL[team.type] ?? "Unknown"}</Badge>
              </Table.Cell>
            </Table.Row>
          ))}
        </Table.Body>
      </Table.Root>
    </Stack>
  );
}
