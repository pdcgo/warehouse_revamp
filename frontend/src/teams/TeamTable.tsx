import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Box,
  Icon,
  IconButton,
  Menu,
  Portal,
  Spinner,
  Stack,
  Table,
  Text,
} from "@chakra-ui/react";
import { Eye, Landmark, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { rpcError } from "../api/clients";
import type { TeamType } from "../gen/warehouse/team/v1/team_pb";
import type { Team } from "../gen/warehouse/team/v1/team_pb";
import { useTeam } from "../team/TeamContext";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { TeamItem } from "../components/TeamItem";
import { toaster } from "../components/Toaster";
import { isGlobalAdmin } from "../lib/roles";
import { EditTeamDialog } from "./EditTeamDialog";
import { TeamInfoDialog } from "./TeamInfoDialog";
import { useDeleteTeam, useTeams } from "./queries";

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
  const { t } = useTranslation();
  const { current } = useTeam();
  const navigate = useNavigate();

  // The list, and the delete that makes it stale. The `reloadSignal` prop this component used to
  // take is gone (#177): the page bumped a counter after creating a team, which meant the table
  // only refreshed when the write happened somewhere that remembered to bump it. The write now
  // invalidates the query itself, so every reader of this list updates — including the OTHER tabs'
  // copies of it, which the counter never reached.
  const query = useTeams({ teamType, page: 1, pageSize: 50 });
  const deleteTeam = useDeleteTeam();

  const teams = query.data?.teams ?? [];
  const loading = query.isPending;
  const error = query.isError ? rpcError(query.error) : "";

  const [dialog, setDialog] = useState<{ kind: "info" | "edit" | "delete"; team: Team } | null>(null);

  // Create/delete are root/admin (backend: TeamCreate/TeamDelete are [ROOT, ADMIN]). The backend
  // is the real gate; this only decides what the UI offers.
  const admin = isGlobalAdmin(current?.role);

  // `mutateAsync`, not `mutate`, because ConfirmDialog AWAITS its onConfirm to hold the button in
  // its loading state — a fire-and-forget `mutate` would resolve instantly and the dialog would
  // close while the delete was still in flight. mutateAsync REJECTS on failure, so the catch is not
  // optional here the way it would be with mutate's onError.
  async function remove(team: Team) {
    try {
      await deleteTeam.mutateAsync({ teamId: team.id });
      toaster.create({ type: "success", title: t("teams.teamDeleted", { name: team.name }) });
    } catch (err) {
      toaster.create({ type: "error", title: t("teams.deleteFailed"), description: rpcError(err) });
    }
  }

  return (
    <Stack gap="section">
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
              <Table.ColumnHeader>{t("teams.name")}</Table.ColumnHeader>
              <Table.ColumnHeader>{t("teams.code")}</Table.ColumnHeader>
              <Table.ColumnHeader textAlign="end">{t("teams.actions")}</Table.ColumnHeader>
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
                              {t("teams.detailsAction")}
                            </Menu.Item>

                            <Menu.Item
                              value="info"
                              data-testid={`info-team-${team.teamCode}`}
                              onClick={() => setDialog({ kind: "info", team })}
                            >
                              <Icon as={Landmark} boxSize="4" />
                              {t("teams.contactBank")}
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
                                  {t("teams.edit")}
                                </Menu.Item>

                                {!isRoot && (
                                  <Menu.Item
                                    value="delete"
                                    color="fg.error"
                                    data-testid={`delete-team-${team.teamCode}`}
                                    onClick={() => setDialog({ kind: "delete", team })}
                                  >
                                    <Icon as={Trash2} boxSize="4" />
                                    {t("teams.delete")}
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
        />
      )}

      {dialog?.kind === "delete" && (
        <ConfirmDialog
          open
          onOpenChange={(o) => {
            if (!o) setDialog(null);
          }}
          title={t("teams.deleteTeamTitle")}
          message={t("teams.deleteTeamConfirm", { name: dialog.team.name })}
          confirmLabel={t("teams.delete")}
          onConfirm={() => remove(dialog.team)}
        />
      )}
    </Stack>
  );
}
