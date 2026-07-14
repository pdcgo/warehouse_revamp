import { useCallback, useEffect, useState } from "react";
import {
  Badge,
  Flex,
  Heading,
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
import { Landmark, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
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

  // Which row action is open, and for which team. Each row's actions live behind one overflow
  // menu; picking an item sets this, and the matching dialog (rendered once, below) opens from it.
  const [dialog, setDialog] = useState<{ kind: "info" | "edit" | "delete"; team: Team } | null>(
    null,
  );

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
                                  onClick={() => setDialog({ kind: "edit", team })}
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

      {/* One instance of each dialog, driven by the row menu's selection above. */}
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
