import { useCallback, useEffect, useState } from "react";
import {
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

// A warehouse IS a team of type WAREHOUSE — this is the Teams view filtered to that type.
export function WarehousesPage() {
  const { current } = useTeam();

  const [teams, setTeams] = useState<Team[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Create/delete are root/admin (backend: TeamCreate/TeamDelete are [ROOT, ADMIN]). The
  // Warehouses menu itself only shows for root/admin team types, but this is the real gate —
  // and the backend enforces it regardless of what the UI renders.
  const admin = isGlobalAdmin(current?.role);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const res = await teamClient.teamList({
        teamType: TeamType.WAREHOUSE,
        page: { page: 1, limit: 50 },
      });
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
      toaster.create({ type: "success", title: `Warehouse "${team.name}" deleted` });
      await load();
    } catch (err) {
      toaster.create({ type: "error", title: "Delete failed", description: rpcError(err) });
    }
  }

  return (
    <Stack gap="section">
      <Flex align="center" gap="card">
        <Heading size="md">Warehouses</Heading>
        <Spacer />
        {admin && <CreateTeamDialog fixedType={TeamType.WAREHOUSE} onDone={() => void load()} />}
      </Flex>

      {error && (
        <Text color="red.fg" data-testid="warehouses-error">
          {error}
        </Text>
      )}

      {loading ? (
        <Spinner colorPalette="brand" />
      ) : (
        <Table.Root size="sm" data-testid="warehouses-table">
          <Table.Header>
            <Table.Row>
              <Table.ColumnHeader>Name</Table.ColumnHeader>
              <Table.ColumnHeader>Code</Table.ColumnHeader>
              <Table.ColumnHeader textAlign="end">Actions</Table.ColumnHeader>
            </Table.Row>
          </Table.Header>

          <Table.Body>
            {teams.map((team) => {
              // A warehouse is never the root team (that's type ROOT), so this guard never
              // fires here — kept to mirror TeamsPage's delete behaviour exactly.
              const isRoot = team.id === ROOT_TEAM_ID;

              return (
                <Table.Row key={team.id.toString()} data-testid={`warehouse-row-${team.teamCode}`}>
                  <Table.Cell>{team.name}</Table.Cell>
                  <Table.Cell>{team.teamCode}</Table.Cell>

                  <Table.Cell textAlign="end">
                    <HStack justify="end" gap="1">
                      <TeamInfoDialog team={team} />

                      {admin && (
                        <>
                          <EditTeamDialog team={team} onDone={() => void load()} />

                          {!isRoot && (
                            <ConfirmDialog
                              title="Delete warehouse"
                              message={`Delete "${team.name}"? This cannot be undone.`}
                              confirmLabel="Delete"
                              onConfirm={() => remove(team)}
                              trigger={
                                <IconButton
                                  size="xs"
                                  variant="ghost"
                                  colorPalette="red"
                                  aria-label="Delete"
                                  data-testid={`delete-warehouse-${team.teamCode}`}
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
