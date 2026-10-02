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
import { Eraser, Eye, KeyRound, MoreHorizontal, Pause, Pencil, Play, UserCog, UserMinus } from "lucide-react";
import { rpcError } from "../../../api/clients";
import { Role } from "../../../gen/warehouse/role_base/v1/role_pb";
import { TeamType } from "../../../gen/warehouse/team/v1/team_pb";
import type { User } from "../../../gen/warehouse/user/v1/user_pb";
import { useAuth } from "../../../features/auth/AuthContext";
import { useTeam } from "../../../features/team/TeamContext";
import { NotImplemented } from "../../../features/pending/NotImplemented";
import { ConfirmDialog } from "../../../components/feedback/ConfirmDialog";
import { RefreshOverlay } from "../../../components/feedback/RefreshOverlay";
import { UserItem } from "../../../components/entity/UserItem";
import { Pagination } from "../../../components/chrome/Pagination";
import { toaster } from "../../../components/feedback/Toaster";
import {
  canEraseUser,
  canManageMember,
  canSuspendUser,
  grantableRoles,
  isGlobalAdmin,
  roleLabel,
} from "../../../lib/roles";
import { useTeams } from "../../../features/teams/queries";
import { EditUserDialog } from "./EditUserDialog";
import { AdminResetPasswordDialog } from "./AdminResetPasswordDialog";
import { ChangeRoleDialog } from "./ChangeRoleDialog";
import { MemberLog } from "./MemberLog";
import { useEraseUser, useRemoveTeamMember, useSuspendUser, useUsers } from "../../../features/users/queries";
import { USERS_PENDING } from "../pending";

const PAGE_SIZE_OPTIONS = [10, 20, 50];

// UsersTable is the one user-management surface, used by both faces of the Users page (#58):
//
//  - mode="team": manage the members of ONE team (the current team). Offers Change Role and
//    Remove-from-team, and the team's membership history below. This is the whole page for warehouse
//    and selling managers, and the "My Team User" tab for Root and the Administrator.
//  - mode="all": manage EVERY user across EVERY team (Root and the Administrator only). A team filter
//    narrows the list; team_id = 0 means everyone (the root scope).
//
// Suspend and Erase are ACCOUNT actions, not membership ones — offered in either mode, to Root and the
// Administrator only.
//
// WHAT EACH ROW OFFERS is decided by lib/roles.ts from the caller's role and the person's
// (docs/business/user/context_decision.md) — never by "is the caller a global admin" alone:
//
//   Change Role, Remove   → only someone whose role is BELOW yours, never yourself (change-role-only-below-your-own)
//   Suspend, Restore      → Root and the Administrator, never sideways (only-root-and-the-administrator-suspend)
//   Erase                 → a suspended account, by those who may suspend it (erase-keeps-the-row)
//   Delete                → gone: a user is never deleted (a-user-is-never-deleted)
//
// Only one of the two modes is ever mounted at a time (the tabs use lazyMount + unmountOnExit), so the
// shared `user-*` testids never collide.
export function UsersTable({ mode }: { mode: "team" | "all" }) {
  const { t } = useTranslation();
  const { identity } = useAuth();
  const { current } = useTeam();
  const navigate = useNavigate();

  // The detail page reads UserTeams (Root and the Administrator only), so only they get the link.
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
    { kind: "edit" | "reset" | "remove" | "suspend" | "changeRole" | "erase"; user: User } | null
  >(null);

  const query = useUsers({ teamId, q, page, pageSize });

  // The team-filter options (all mode only). A failure is non-fatal — `?? []` leaves "All teams" as
  // the sole choice, which still lists everyone, exactly as the old swallowed catch did.
  const teamsQuery = useTeams({ page: 1, pageSize: 200, enabled: mode === "all", reference: true });
  const teams = teamsQuery.data?.teams ?? [];

  // The type of the team the list is scoped to — it decides how a role reads (the admin team borrows
  // the selling team's two roles until they are renamed) and which roles the caller may give.
  const scopedTeamType =
    mode === "team"
      ? current?.teamType
      : filterTeamId === 0n
        ? TeamType.ROOT
        : teams.find((team) => team.id === filterTeamId)?.type;

  // What the caller may give in this team. Change Role is offered only when it leaves something to pick:
  // a team has ONE role below Admin, so an Admin may add and remove Staff but never change their role.
  const grantable = grantableRoles(scopedTeamType, current?.role);

  const suspendUser = useSuspendUser();
  const eraseUser = useEraseUser();
  const removeMember = useRemoveTeamMember();

  const users = query.data?.users ?? [];
  const memberships = query.data?.memberships;
  const totalItems = query.data?.totalItems ?? 0;
  const loading = query.isPending && teamId !== undefined;
  // Always-fresh: this list refetches on every mount, tab and page change. `listQuery` keeps the rows
  // already on screen while it does, and RefreshOverlay says a newer answer is coming. `isPending` is
  // excluded — a first load has nothing to keep and shows the spinner instead.
  const refreshing = query.isFetching && !query.isPending;
  const error = query.isError ? rpcError(query.error) : "";

  function roleOf(user: User): Role | undefined {
    return memberships?.get(user.id.toString())?.role;
  }

  // An account's ROOT-TEAM role — what decides who may suspend it. Known only when the list IS the
  // root team's: the all-users view over every team, or the team view while the root team is current.
  // Anywhere else it reads as "no platform role", and the server refuses a Root or an Administrator.
  function platformRoleOf(user: User): Role | undefined {
    return scopedTeamType === TeamType.ROOT ? roleOf(user) : undefined;
  }

  // All of these are reached through ConfirmDialog, which AWAITS its onConfirm to hold the button in
  // its loading state. That is why they use `mutateAsync` rather than `mutate`: the fire-and-forget
  // form resolves instantly and the dialog would close over an in-flight write. mutateAsync REJECTS
  // on failure, so the catch is what produces the error toast.
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

  async function erase(user: User) {
    try {
      await eraseUser.mutateAsync({ userId: user.id });
      toaster.create({ type: "success", title: t("users.toast.userErased", { id: user.id.toString() }) });
    } catch (err) {
      toaster.create({ type: "error", title: t("users.toast.eraseFailed"), description: rpcError(err) });
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
      <RefreshOverlay busy={refreshing}>
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
            <Text color="error.fg" data-testid="users-error">
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
                  <Table.ColumnHeader>
                    <HStack gap="1">
                      {t("users.table.role")}
                      <NotImplemented list={USERS_PENDING} id="roleColumn" />
                    </HStack>
                  </Table.ColumnHeader>
                  <Table.ColumnHeader>{t("users.table.email")}</Table.ColumnHeader>
                  <Table.ColumnHeader>{t("users.table.status")}</Table.ColumnHeader>
                  <Table.ColumnHeader textAlign="end">
                    <HStack gap="1" justify="end">
                      {t("users.table.actions")}
                      <NotImplemented list={USERS_PENDING} id="rankRules" />
                    </HStack>
                  </Table.ColumnHeader>
                </Table.Row>
              </Table.Header>

              <Table.Body>
                {users.map((user) => {
                  const isSelf = identity?.identityId === user.id;
                  const role = roleOf(user);

                  const manageable =
                    mode === "team" &&
                    canManageMember({ caller: current?.role, teamType: scopedTeamType, target: role, isSelf });

                  const roleChangeable = manageable && grantable.some((r) => r !== role);

                  const platformRole = platformRoleOf(user);
                  const suspendable = canSuspendUser({ caller: current?.role, target: platformRole, isSelf });
                  const erasable = canEraseUser({
                    caller: current?.role,
                    target: platformRole,
                    isSelf,
                    suspended: user.isSuspended,
                  });

                  return (
                    <Table.Row key={user.id.toString()} data-testid={`user-row-${user.username}`}>
                      <Table.Cell>
                        {globalAdmin ? (
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
                      <Table.Cell data-testid={`role-${user.username}`}>
                        {role !== undefined && role !== Role.UNSPECIFIED ? roleLabel(role, scopedTeamType) : "—"}
                      </Table.Cell>
                      <Table.Cell>{user.email}</Table.Cell>
                      <Table.Cell>
                        {user.isSuspended ? (
                          <Badge colorPalette="error" data-testid={`suspended-${user.username}`}>
                            {t("users.status.suspended")}
                          </Badge>
                        ) : (
                          <Badge colorPalette="success">{t("users.status.active")}</Badge>
                        )}
                      </Table.Cell>

                      <Table.Cell textAlign="end">
                        <Menu.Root>
                          <Menu.Trigger asChild>
                            <IconButton
                              size="xs"
                              variant="ghost"
                              aria-label={t("users.table.actions")}
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

                                {roleChangeable && (
                                  <Menu.Item
                                    value="changeRole"
                                    data-testid={`change-role-${user.username}`}
                                    onClick={() => setDialog({ kind: "changeRole", user })}
                                  >
                                    <Icon as={UserCog} boxSize="4" />
                                    {t("users.action.changeRole")}
                                  </Menu.Item>
                                )}

                                {manageable && (
                                  <>
                                    <Menu.Item
                                      value="remove"
                                      data-testid={`remove-${user.username}`}
                                      onClick={() => setDialog({ kind: "remove", user })}
                                    >
                                      <Icon as={UserMinus} boxSize="4" />
                                      {t("users.action.removeFromTeam")}
                                    </Menu.Item>
                                  </>
                                )}

                                {globalAdmin && !isSelf && (
                                  // An admin sets a password without knowing the old one — exactly the
                                  // situation when someone is locked out.
                                  <Menu.Item
                                    value="reset"
                                    data-testid={`reset-password-${user.username}`}
                                    onClick={() => setDialog({ kind: "reset", user })}
                                  >
                                    <Icon as={KeyRound} boxSize="4" />
                                    {t("users.action.resetPassword")}
                                  </Menu.Item>
                                )}

                                {suspendable && (
                                  <Menu.Item
                                    value="suspend"
                                    data-testid={`suspend-${user.username}`}
                                    onClick={() => setDialog({ kind: "suspend", user })}
                                  >
                                    <Icon as={user.isSuspended ? Play : Pause} boxSize="4" />
                                    {user.isSuspended ? t("users.action.restore") : t("users.action.suspend")}
                                  </Menu.Item>
                                )}

                                {erasable && (
                                  <Menu.Item
                                    value="erase"
                                    color="fg.error"
                                    data-testid={`erase-${user.username}`}
                                    onClick={() => setDialog({ kind: "erase", user })}
                                  >
                                    <Icon as={Eraser} boxSize="4" />
                                    {t("users.action.erase")}
                                    <NotImplemented list={USERS_PENDING} id="erase" />
                                  </Menu.Item>
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
        </Stack>
      </RefreshOverlay>

      {mode === "team" && current && <MemberLog teamId={current.teamId} teamType={current.teamType} />}

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

      {dialog?.kind === "changeRole" && current && (
        <ChangeRoleDialog
          key={dialog.user.id.toString()}
          user={dialog.user}
          teamId={current.teamId}
          teamType={scopedTeamType}
          currentRole={roleOf(dialog.user)}
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

      {dialog?.kind === "erase" && (
        <ConfirmDialog
          open
          onOpenChange={(o) => {
            if (!o) setDialog(null);
          }}
          title={t("users.confirm.erase.title")}
          message={t("users.confirm.erase.message", {
            username: dialog.user.username,
            id: dialog.user.id.toString(),
          })}
          confirmLabel={t("users.action.erase")}
          onConfirm={() => erase(dialog.user)}
        />
      )}
    </Stack>
  );
}
