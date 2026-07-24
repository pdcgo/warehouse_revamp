import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Eye, Landmark, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { IconButton } from "../../../components/ui/Button";
import { Menu, Portal } from "../../../components/ui/Menu";
import { Spinner } from "../../../components/ui/Spinner";
import { Table } from "../../../components/ui/Table";
import { rpcError } from "../../../api/clients";
import type { TeamType } from "../../../gen/warehouse/team/v1/team_pb";
import type { Team } from "../../../gen/warehouse/team/v1/team_pb";
import { useTeam } from "../../../features/team/TeamContext";
import { ConfirmDialog } from "../../../components/ConfirmDialog";
import { TeamItem } from "../../../components/TeamItem";
import { toaster } from "../../../components/Toaster";
import { isGlobalAdmin } from "../../../lib/roles";
import { EditTeamDialog } from "../../../features/teams/EditTeamDialog";
import { TeamInfoDialog } from "./TeamInfoDialog";
import { useDeleteTeam, useTeams } from "../../../features/teams/queries";

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
    <div className="flex flex-col gap-section">
      {error && (
        <p className="text-red-600 dark:text-red-400" data-testid="teams-error">
          {error}
        </p>
      )}

      {loading ? (
        <Spinner />
      ) : (
        <Table.Root data-testid="teams-table">
          <Table.Header>
            <Table.Row>
              <Table.ColumnHeader>{t("teams.name")}</Table.ColumnHeader>
              <Table.ColumnHeader>{t("teams.code")}</Table.ColumnHeader>
              <Table.ColumnHeader className="text-right">{t("teams.actions")}</Table.ColumnHeader>
            </Table.Row>
          </Table.Header>

          <Table.Body>
            {teams.map((team) => {
              const isRoot = team.id === ROOT_TEAM_ID;

              return (
                <Table.Row key={team.id.toString()} data-testid={`team-row-${team.teamCode}`}>
                  <Table.Cell>
                    <div
                      className="cursor-pointer"
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
                    </div>
                  </Table.Cell>
                  <Table.Cell>{team.teamCode}</Table.Cell>

                  <Table.Cell className="text-right">
                    <Menu.Root>
                      <Menu.Trigger asChild>
                        <IconButton
                          size="xs"
                          variant="ghost"
                          aria-label="Actions"
                          data-testid={`row-actions-team-${team.teamCode}`}
                        >
                          <MoreHorizontal className="size-4" />
                        </IconButton>
                      </Menu.Trigger>

                      <Portal>
                        <Menu.Positioner>
                          <Menu.Content>
                            <Menu.Item
                              value="detail"
                              data-testid={`detail-team-${team.teamCode}`}
                              onSelect={() => navigate(`/teams/${team.id}`)}
                            >
                              <Eye className="size-4" />
                              {t("teams.detailsAction")}
                            </Menu.Item>

                            <Menu.Item
                              value="info"
                              data-testid={`info-team-${team.teamCode}`}
                              onSelect={() => setDialog({ kind: "info", team })}
                            >
                              <Landmark className="size-4" />
                              {t("teams.contactBank")}
                            </Menu.Item>

                            {admin && (
                              <>
                                <Menu.Item
                                  value="edit"
                                  data-testid={`edit-team-${team.teamCode}`}
                                  onSelect={() =>
                                    editAsPage
                                      ? navigate(`/teams/${team.id}/edit`)
                                      : setDialog({ kind: "edit", team })
                                  }
                                >
                                  <Pencil className="size-4" />
                                  {t("teams.edit")}
                                </Menu.Item>

                                {!isRoot && (
                                  <Menu.Item
                                    value="delete"
                                    className="text-red-600 dark:text-red-400 [&_svg]:text-red-600 dark:[&_svg]:text-red-400"
                                    data-testid={`delete-team-${team.teamCode}`}
                                    onSelect={() => setDialog({ kind: "delete", team })}
                                  >
                                    <Trash2 className="size-4" />
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
    </div>
  );
}
