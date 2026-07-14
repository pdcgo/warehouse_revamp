import { useCallback, useEffect, useState } from "react";
import {
  Badge,
  Flex,
  Heading,
  HStack,
  Icon,
  IconButton,
  Spacer,
  Spinner,
  Stack,
  Table,
  Text,
} from "@chakra-ui/react";
import { Trash2 } from "lucide-react";
import { rpcError, teamClient } from "../api/clients";
import { TeamType } from "../gen/warehouse/team/v1/team_pb";
import type { Team } from "../gen/warehouse/team/v1/team_pb";
import { useTeam } from "../team/TeamContext";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { toaster } from "../components/Toaster";
import { isGlobalAdmin } from "../lib/roles";
import { CreateTeamDialog } from "./CreateTeamDialog";
import { EditTeamDialog } from "./EditTeamDialog";
import { TeamInfoDialog } from "./TeamInfoDialog";

const ROOT_TEAM_ID = 1n;

const TYPE_LABEL: Record<number, string> = {
  [TeamType.ROOT]: "Root",
  [TeamType.ADMIN]: "Admin",
  [TeamType.WAREHOUSE]: "Warehouse",
  [TeamType.SELLING]: "Selling",
};

export function TeamsPage() {
  const { current } = useTeam();

  const [teams, setTeams] = useState<Team[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Create/delete are root/admin (backend: TeamCreate/TeamDelete are [ROOT, ADMIN]). The Teams
  // menu itself only shows for root/admin team types, but this is the real gate — and the
  // backend enforces it regardless of what the UI renders.
  const admin = isGlobalAdmin(current?.role);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const res = await teamClient.teamList({ page: { page: 1, limit: 50 } });
      setTeams(res.teams);
    } catch (err) {
      setError(rpcError(err));
      setTeams([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function remove(team: Team) {
    try {
      await teamClient.teamDelete({ teamId: team.id });
      toaster.create({ type: "success", title: `Team "${team.name}" deleted` });
      await load();
    } catch (err) {
      toaster.create({ type: "error", title: "Delete failed", description: rpcError(err) });
    }
  }

  return (
    <Stack gap="section">
      <Flex align="center" gap="card">
        <Heading size="md">Teams</Heading>
        <Spacer />
        {admin && <CreateTeamDialog onDone={() => void load()} />}
      </Flex>

      {error && (
        <Text color="red.fg" data-testid="teams-error">
          {error}
        </Text>
      )}

      {loading ? (
        <Spinner colorPalette="brand" />
      ) : (
        <Table.Root size="sm" data-testid="teams-table">
          <Table.Header>
            <Table.Row>
              <Table.ColumnHeader>Name</Table.ColumnHeader>
              <Table.ColumnHeader>Code</Table.ColumnHeader>
              <Table.ColumnHeader>Type</Table.ColumnHeader>
              <Table.ColumnHeader textAlign="end">Actions</Table.ColumnHeader>
            </Table.Row>
          </Table.Header>

          <Table.Body>
            {teams.map((team) => {
              // The root team is the super-admin scope: the backend refuses to delete it, so we
              // don't offer the action (create/edit stay available — renaming it is harmless).
              const isRoot = team.id === ROOT_TEAM_ID;

              return (
                <Table.Row key={team.id.toString()} data-testid={`team-row-${team.teamCode}`}>
                  <Table.Cell>{team.name}</Table.Cell>
                  <Table.Cell>{team.teamCode}</Table.Cell>
                  <Table.Cell>
                    <Badge>{TYPE_LABEL[team.type] ?? "Unknown"}</Badge>
                  </Table.Cell>

                  <Table.Cell textAlign="end">
                    <HStack justify="end" gap="1">
                      <TeamInfoDialog team={team} />

                      {admin && (
                        <>
                          <EditTeamDialog team={team} onDone={() => void load()} />

                          {!isRoot && (
                            <ConfirmDialog
                              title="Delete team"
                              message={`Delete "${team.name}"? This cannot be undone.`}
                              confirmLabel="Delete"
                              onConfirm={() => remove(team)}
                              trigger={
                                <IconButton
                                  size="xs"
                                  variant="ghost"
                                  colorPalette="red"
                                  aria-label="Delete"
                                  data-testid={`delete-team-${team.teamCode}`}
                                >
                                  <Icon as={Trash2} boxSize="4" />
                                </IconButton>
                              }
                            />
                          )}
                        </>
                      )}
                    </HStack>
                  </Table.Cell>
                </Table.Row>
              );
            })}
          </Table.Body>
        </Table.Root>
      )}
    </Stack>
  );
}
