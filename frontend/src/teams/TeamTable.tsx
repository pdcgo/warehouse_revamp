import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Box,
  Flex,
  Icon,
  IconButton,
  Menu,
  Portal,
  Spacer,
  Spinner,
  Stack,
  Table,
  Text,
} from "@chakra-ui/react";
import { Eye, Landmark, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { rpcError, teamClient } from "../api/clients";
import { TeamType } from "../gen/warehouse/team/v1/team_pb";
import type { Team } from "../gen/warehouse/team/v1/team_pb";
import { useTeam } from "../team/TeamContext";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { TeamItem } from "../components/TeamItem";
import { toaster } from "../components/Toaster";
import { isGlobalAdmin } from "../lib/roles";
import { CreateTeamDialog } from "./CreateTeamDialog";
import { EditTeamDialog } from "./EditTeamDialog";
import { TeamInfoDialog } from "./TeamInfoDialog";

const ROOT_TEAM_ID = 1n;

// TeamTable is the shared team list used by every tab of the Teams page (#59). Filtered by
// `teamType` (undefined = all types). For warehouse teams, `editAsPage` sends Edit to the
// dedicated warehouse edit page (it carries the weekly hours); every other type edits in a dialog.
export function TeamTable({
  teamType,
  editAsPage = false,
}: {
  teamType?: TeamType;
  editAsPage?: boolean;
}) {
  const { current } = useTeam();
  const navigate = useNavigate();

  const [teams, setTeams] = useState<Team[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [dialog, setDialog] = useState<{ kind: "info" | "edit" | "delete"; team: Team } | null>(null);

  // Create/delete are root/admin (backend: TeamCreate/TeamDelete are [ROOT, ADMIN]). The backend
  // is the real gate; this only decides what the UI offers.
  const admin = isGlobalAdmin(current?.role);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const res = await teamClient.teamList({
        // team_type = UNSPECIFIED (the enum default) means "all types" server-side.
        teamType: teamType ?? TeamType.UNSPECIFIED,
        page: { page: 1, limit: 50 },
      });
      setTeams(res.teams);
    } catch (err) {
      setError(rpcError(err));
      setTeams([]);
    } finally {
      setLoading(false);
    }
  }, [teamType]);

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
        <Spacer />
        {admin && <CreateTeamDialog fixedType={teamType} onDone={() => void load()} />}
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
              <Table.ColumnHeader textAlign="end">Actions</Table.ColumnHeader>
            </Table.Row>
          </Table.Header>

          <Table.Body>
            {teams.map((team) => {
              const isRoot = team.id === ROOT_TEAM_ID;

              return (
                <Table.Row key={team.id.toString()} data-testid={`team-row-${team.teamCode}`}>
                  <Table.Cell>
                    <Box
                      cursor="pointer"
                      data-testid={`open-team-${team.teamCode}`}
                      onClick={() => navigate(`/teams/${team.id}`)}
                    >
                      <TeamItem
                        team={{
                          teamName: team.name,
                          teamType: team.type,
                          teamId: team.id,
                          imageUrl: team.imageUrl,
                        }}
                      />
                    </Box>
                  </Table.Cell>
                  <Table.Cell>{team.teamCode}</Table.Cell>

                  <Table.Cell textAlign="end">
                    <Menu.Root>
                      <Menu.Trigger asChild>
                        <IconButton
                          size="xs"
                          variant="ghost"
                          aria-label="Actions"
                          data-testid={`row-actions-team-${team.teamCode}`}
                        >
                          <Icon as={MoreHorizontal} boxSize="4" />
                        </IconButton>
                      </Menu.Trigger>

                      <Portal>
                        <Menu.Positioner>
                          <Menu.Content>
                            <Menu.Item
                              value="detail"
                              data-testid={`detail-team-${team.teamCode}`}
                              onClick={() => navigate(`/teams/${team.id}`)}
                            >
                              <Icon as={Eye} boxSize="4" />
                              Details
                            </Menu.Item>

                            <Menu.Item
                              value="info"
                              data-testid={`info-team-${team.teamCode}`}
                              onClick={() => setDialog({ kind: "info", team })}
                            >
                              <Icon as={Landmark} boxSize="4" />
                              Contact &amp; bank
                            </Menu.Item>

                            {admin && (
                              <>
                                <Menu.Item
                                  value="edit"
                                  data-testid={`edit-team-${team.teamCode}`}
                                  onClick={() =>
                                    editAsPage
                                      ? navigate(`/teams/${team.id}/edit`)
                                      : setDialog({ kind: "edit", team })
                                  }
                                >
                                  <Icon as={Pencil} boxSize="4" />
                                  Edit
                                </Menu.Item>

                                {!isRoot && (
                                  <Menu.Item
                                    value="delete"
                                    color="fg.error"
                                    data-testid={`delete-team-${team.teamCode}`}
                                    onClick={() => setDialog({ kind: "delete", team })}
                                  >
                                    <Icon as={Trash2} boxSize="4" />
                                    Delete
                                  </Menu.Item>
                                )}
                              </>
                            )}
                          </Menu.Content>
                        </Menu.Positioner>
                      </Portal>
                    </Menu.Root>
                  </Table.Cell>
                </Table.Row>
              );
            })}
          </Table.Body>
        </Table.Root>
      )}

      {dialog?.kind === "info" && (
        <TeamInfoDialog
          key={dialog.team.id.toString()}
          team={dialog.team}
          open
          onOpenChange={(o) => {
            if (!o) setDialog(null);
          }}
        />
      )}

      {dialog?.kind === "edit" && (
        <EditTeamDialog
          key={dialog.team.id.toString()}
          team={dialog.team}
          open
          onOpenChange={(o) => {
            if (!o) setDialog(null);
          }}
          onDone={() => void load()}
        />
      )}

      {dialog?.kind === "delete" && (
        <ConfirmDialog
          open
          onOpenChange={(o) => {
            if (!o) setDialog(null);
          }}
          title="Delete Team"
          message={`Delete "${dialog.team.name}"? This cannot be undone.`}
          confirmLabel="Delete"
          onConfirm={() => remove(dialog.team)}
        />
      )}
    </Stack>
  );
}
