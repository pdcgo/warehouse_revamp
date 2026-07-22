import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import {
  Badge,
  Box,
  HStack,
  Icon,
  IconButton,
  Input,
  Menu,
  NativeSelect,
  Portal,
  Spinner,
  Stack,
  Table,
  Text,
} from "@chakra-ui/react";
import { Eye, KeyRound, MoreHorizontal, Pause, Pencil, Play, Trash2, UserMinus } from "lucide-react";
import { rpcError } from "../api/clients";
import type { User } from "../gen/warehouse/user/v1/user_pb";
import { useAuth } from "../auth/AuthContext";
import { useTeam } from "../team/TeamContext";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { UserItem } from "../components/UserItem";
import { Pagination } from "../components/Pagination";
import { toaster } from "../components/Toaster";
import { isGlobalAdmin } from "../lib/roles";
import { useTeams } from "../teams/queries";
import { EditUserDialog } from "./EditUserDialog";
import { AdminResetPasswordDialog } from "./AdminResetPasswordDialog";
import { useDeleteUser, useRemoveTeamMember, useSuspendUser, useUsers } from "./queries";

const PAGE_SIZE_OPTIONS = [10, 20, 50];

// UsersTable is the one user-management surface, used by both faces of the Users page (#58):
//
//  - mode="team": manage the members of ONE team (the current team). Offers Add member and
//    Remove-from-team. This is the whole page for warehouse/selling managers, and the
//    "My Team User" tab for root/admin.
//  - mode="all": manage EVERY user across EVERY team (root/admin only). A team filter narrows the
//    list; team_id = 0 means everyone (the root scope). No Add member / Remove-from-team — those
//    are team-membership actions, meaningless in a cross-team view. This is the "All User" tab.
//
// Only one of these is ever mounted at a time (the tabs use lazyMount + unmountOnExit), so the
// shared `user-*` testids never collide. The Add member / New user buttons live in the PAGE header
// (#58 review), not here — and since #177 they signal nothing: every write invalidates the user
// cache, so this table refreshes wherever the write was made from. The `reloadSignal` prop that used
// to carry that message is gone.
export function UsersTable({ mode }: { mode: "team" | "all" }) {
  const { t } = useTranslation();
  const { identity } = useAuth();
  const { current } = useTeam();
  const navigate = useNavigate();

  // The whole cross-team view, and the destructive row actions, are root/admin surfaces. This flag
  // only decides what the UI OFFERS — the backend interceptor is the real boundary either way.
  const globalAdmin = isGlobalAdmin(current?.role);

  // mode="all" carries a team filter (0 = all teams); mode="team" is pinned to the current team.
  //
  // `undefined` in team mode is NOT the same as 0: 0 means "every user in the system", so falling
  // back to it while TeamProvider is still resolving would fire a root-scoped read on behalf of
  // someone who may not be an admin. Undefined simply means "not known yet", and the query waits.
  const [filterTeamId, setFilterTeamId] = useState<bigint>(0n);
  const teamId = mode === "all" ? filterTeamId : current?.teamId;

  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  // Which row action is open, and for which user. The row's actions live behind one overflow menu;
  // picking an item sets this, and the matching dialog (rendered once, below) opens from it.
  const [dialog, setDialog] = useState<
    { kind: "edit" | "reset" | "remove" | "suspend" | "delete"; user: User } | null
  >(null);

  const query = useUsers({ teamId, q, page, pageSize });

  // The team-filter options (all mode only). A failure is non-fatal — `?? []` leaves "All teams" as
  // the sole choice, which still lists everyone, exactly as the old swallowed catch did.
  const teamsQuery = useTeams({ page: 1, pageSize: 200, enabled: mode === "all" });
  const teams = teamsQuery.data?.teams ?? [];

  const suspendUser = useSuspendUser();
  const deleteUser = useDeleteUser();
  const removeMember = useRemoveTeamMember();

  const users = query.data?.users ?? [];
  const totalItems = query.data?.totalItems ?? 0;
  const loading = query.isPending && teamId !== undefined;
  const error = query.isError ? rpcError(query.error) : "";

  // All three of these are reached through ConfirmDialog, which AWAITS its onConfirm to hold the
  // button in its loading state. That is why they use `mutateAsync` rather than `mutate`: the
  // fire-and-forget form resolves instantly and the dialog would close over an in-flight write.
  // mutateAsync REJECTS on failure, so the catch is what produces the error toast.
  async function suspend(user: User, suspended: boolean) {
    try {
      await suspendUser.mutateAsync({ userId: user.id, suspended });

      toaster.create({
        type: "success",
        title: suspended
          ? t("users.toast.userSuspended", { username: user.username })
          : t("users.toast.userRestored", { username: user.username }),
        // Worth saying: suspension is not "they cannot log in next time" — it cuts their current
        // session off on the very next request.
        description: suspended ? t("users.toast.suspendedDescription") : undefined,
      });
    } catch (err) {
      toaster.create({ type: "error", title: t("users.toast.suspendFailed"), description: rpcError(err) });
    }
  }

  async function remove(user: User) {
    try {
      await deleteUser.mutateAsync({ userId: user.id });
      toaster.create({ type: "success", title: t("users.toast.userDeleted", { username: user.username }) });
    } catch (err) {
      toaster.create({ type: "error", title: t("users.toast.deleteFailed"), description: rpcError(err) });
    }
  }

  async function removeFromTeam(user: User) {
    try {
      await removeMember.mutateAsync({ teamId: current?.teamId ?? 0n, userId: user.id });

      toaster.create({ type: "success", title: t("users.toast.removedFromTeam", { username: user.username }) });
    } catch (err) {
      toaster.create({ type: "error", title: t("users.toast.removeFailed"), description: rpcError(err) });
    }
  }

  return (
    <Stack gap="section">
      <HStack gap="card">
        <Input
          maxW="sm"
          placeholder={t("users.searchPlaceholder")}
          value={q}
          data-testid="user-search"
          onChange={(e) => {
            setQ(e.target.value);
            setPage(1);
          }}
        />

        {mode === "all" && (
          <NativeSelect.Root maxW="xs">
            <NativeSelect.Field
              value={filterTeamId.toString()}
              data-testid="users-team-filter"
              onChange={(e) => {
                setFilterTeamId(BigInt(e.target.value));
                setPage(1);
              }}
            >
              <option value="0">{t("users.allTeams")}</option>
              {teams.map((team) => (
                <option key={team.id.toString()} value={team.id.toString()}>
                  {team.name || `Team #${team.id}`}
                </option>
              ))}
            </NativeSelect.Field>
            <NativeSelect.Indicator />
          </NativeSelect.Root>
        )}
      </HStack>

      {error && (
        <Text color="red.fg" data-testid="users-error">
          {error}
        </Text>
      )}

      {loading ? (
        <Spinner colorPalette="brand" />
      ) : (
        <Table.Root size="sm" data-testid="users-table">
          <Table.Header>
            <Table.Row>
              <Table.ColumnHeader>{t("users.table.user")}</Table.ColumnHeader>
              <Table.ColumnHeader>{t("users.table.email")}</Table.ColumnHeader>
              <Table.ColumnHeader>{t("users.table.status")}</Table.ColumnHeader>
              <Table.ColumnHeader textAlign="end">{t("users.table.actions")}</Table.ColumnHeader>
            </Table.Row>
          </Table.Header>

          <Table.Body>
            {users.map((user) => {
              // Never offer to suspend or delete yourself — the confirm would be the last thing you
              // ever did in this app.
              const isSelf = identity?.identityId === user.id;

              return (
                <Table.Row key={user.id.toString()} data-testid={`user-row-${user.username}`}>
                  <Table.Cell>
                    {globalAdmin ? (
                      // The detail PAGE reads UserTeams (root/admin only), so only offer
                      // click-to-open where it will actually work.
                      <Box
                        cursor="pointer"
                        data-testid={`open-user-${user.username}`}
                        onClick={() => navigate(`/users/${user.id}`)}
                      >
                        <UserItem user={user} />
                      </Box>
                    ) : (
                      <UserItem user={user} />
                    )}
                  </Table.Cell>
                  <Table.Cell>{user.email}</Table.Cell>
                  <Table.Cell>
                    {user.isSuspended ? (
                      <Badge colorPalette="red" data-testid={`suspended-${user.username}`}>
                        {t("users.status.suspended")}
                      </Badge>
                    ) : (
                      <Badge colorPalette="green">{t("users.status.active")}</Badge>
                    )}
                  </Table.Cell>

                  <Table.Cell textAlign="end">
                    <Menu.Root>
                      <Menu.Trigger asChild>
                        <IconButton
                          size="xs"
                          variant="ghost"
                          aria-label="Actions"
                          data-testid={`row-actions-${user.username}`}
                        >
                          <Icon as={MoreHorizontal} boxSize="4" />
                        </IconButton>
                      </Menu.Trigger>

                      <Portal>
                        <Menu.Positioner>
                          <Menu.Content>
                            <Menu.Item
                              value="edit"
                              data-testid={`edit-${user.username}`}
                              onClick={() => setDialog({ kind: "edit", user })}
                            >
                              <Icon as={Pencil} boxSize="4" />
                              {t("users.action.edit")}
                            </Menu.Item>

                            {/* UserTeams is root/admin only — offer the view only where it works. */}
                            {globalAdmin && (
                              <Menu.Item
                                value="details"
                                data-testid={`details-${user.username}`}
                                onClick={() => navigate(`/users/${user.id}`)}
                              >
                                <Icon as={Eye} boxSize="4" />
                                {t("users.action.details")}
                              </Menu.Item>
                            )}

                            {mode === "team" && current && !isSelf && (
                              <Menu.Item
                                value="remove"
                                data-testid={`remove-${user.username}`}
                                onClick={() => setDialog({ kind: "remove", user })}
                              >
                                <Icon as={UserMinus} boxSize="4" />
                                {t("users.action.removeFromTeam")}
                              </Menu.Item>
                            )}

                            {globalAdmin && !isSelf && (
                              <>
                                {/* An admin sets a password without knowing the old one — exactly
                                    the situation when someone is locked out. */}
                                <Menu.Item
                                  value="reset"
                                  data-testid={`reset-password-${user.username}`}
                                  onClick={() => setDialog({ kind: "reset", user })}
                                >
                                  <Icon as={KeyRound} boxSize="4" />
                                  {t("users.action.resetPassword")}
                                </Menu.Item>

                                <Menu.Item
                                  value="suspend"
                                  data-testid={`suspend-${user.username}`}
                                  onClick={() => setDialog({ kind: "suspend", user })}
                                >
                                  <Icon as={user.isSuspended ? Play : Pause} boxSize="4" />
                                  {user.isSuspended ? t("users.action.restore") : t("users.action.suspend")}
                                </Menu.Item>

                                <Menu.Item
                                  value="delete"
                                  color="fg.error"
                                  data-testid={`delete-${user.username}`}
                                  onClick={() => setDialog({ kind: "delete", user })}
                                >
                                  <Icon as={Trash2} boxSize="4" />
                                  {t("users.action.delete")}
                                </Menu.Item>
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

      {!loading && users.length === 0 && !error && (
        <Text color="fg.muted" data-testid="users-empty">
          {t("users.empty")}
        </Text>
      )}

      {!loading && (
        <Pagination
          count={totalItems}
          pageSize={pageSize}
          page={page}
          onPageChange={setPage}
          pageSizeOptions={PAGE_SIZE_OPTIONS}
          onPageSizeChange={(n) => {
            setPageSize(n);
            setPage(1);
          }}
        />
      )}

      {/* One instance of each dialog, driven by the row menu's selection above. */}
      {dialog?.kind === "edit" && (
        <EditUserDialog
          key={dialog.user.id.toString()}
          user={dialog.user}
          open
          onOpenChange={(o) => {
            if (!o) setDialog(null);
          }}
        />
      )}

      {dialog?.kind === "reset" && (
        <AdminResetPasswordDialog
          key={dialog.user.id.toString()}
          user={dialog.user}
          open
          onOpenChange={(o) => {
            if (!o) setDialog(null);
          }}
        />
      )}

      {dialog?.kind === "remove" && (
        <ConfirmDialog
          open
          onOpenChange={(o) => {
            if (!o) setDialog(null);
          }}
          title={t("users.confirm.removeFromTeam.title")}
          message={t("users.confirm.removeFromTeam.message", {
            username: dialog.user.username,
            team: current?.teamName || t("users.thisTeam"),
          })}
          confirmLabel={t("users.confirm.removeFromTeam.confirm")}
          onConfirm={() => removeFromTeam(dialog.user)}
        />
      )}

      {dialog?.kind === "suspend" && (
        <ConfirmDialog
          open
          onOpenChange={(o) => {
            if (!o) setDialog(null);
          }}
          title={dialog.user.isSuspended ? t("users.confirm.restore.title") : t("users.confirm.suspend.title")}
          message={
            dialog.user.isSuspended
              ? t("users.confirm.restore.message", { username: dialog.user.username })
              : t("users.confirm.suspend.message", { username: dialog.user.username })
          }
          confirmLabel={dialog.user.isSuspended ? t("users.action.restore") : t("users.action.suspend")}
          destructive={!dialog.user.isSuspended}
          onConfirm={() => suspend(dialog.user, !dialog.user.isSuspended)}
        />
      )}

      {dialog?.kind === "delete" && (
        <ConfirmDialog
          open
          onOpenChange={(o) => {
            if (!o) setDialog(null);
          }}
          title={t("users.confirm.delete.title")}
          message={t("users.confirm.delete.message", { username: dialog.user.username })}
          confirmLabel={t("users.action.delete")}
          onConfirm={() => remove(dialog.user)}
        />
      )}
    </Stack>
  );
}
