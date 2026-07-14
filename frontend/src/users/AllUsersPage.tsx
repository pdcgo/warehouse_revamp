import { useCallback, useEffect, useState } from "react";
import {
  Badge,
  Flex,
  HStack,
  Heading,
  Icon,
  IconButton,
  Input,
  NativeSelect,
  Spacer,
  Spinner,
  Stack,
  Table,
  Text,
} from "@chakra-ui/react";
import { ChevronLeft, ChevronRight, Pause, Play, Trash2 } from "lucide-react";
import { rpcError, teamClient, userClient } from "../api/clients";
import type { User } from "../gen/warehouse/user/v1/user_pb";
import type { Team } from "../gen/warehouse/team/v1/team_pb";
import type { PageInfo } from "../gen/warehouse/common/v1/page_pb";
import { useAuth } from "../auth/AuthContext";
import { useTeam } from "../team/TeamContext";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { UserItem } from "../components/UserItem";
import { toaster } from "../components/Toaster";
import { isGlobalAdmin } from "../lib/roles";
import { CreateUserDialog } from "./CreateUserDialog";
import { EditUserDialog } from "./EditUserDialog";
import { AdminResetPasswordDialog } from "./AdminResetPasswordDialog";

const PAGE_SIZE = 20;

// AllUsersPage is the ROOT/ADMIN management view of EVERY user across EVERY team (issue #40).
//
// It leans on one backend fact: UserList with team_id = 0 resolves to the root scope and returns
// all users — root/admin only. A team_id > 0 narrows to that team's members. So the single
// team-filter control drives both "see everyone" (All teams = 0) and "filter by team".
export function AllUsersPage() {
  const { identity } = useAuth();
  const { current } = useTeam();

  // The whole page is a root/admin surface; this only decides whether to OFFER the destructive
  // row actions. The backend's interceptor is the real boundary regardless.
  const globalAdmin = isGlobalAdmin(current?.role);

  const [teams, setTeams] = useState<Team[]>([]);
  const [teamId, setTeamId] = useState<bigint>(0n);

  const [users, setUsers] = useState<User[]>([]);
  const [pageInfo, setPageInfo] = useState<PageInfo | undefined>(undefined);
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // The team filter's options. Loaded once — a non-fatal failure just leaves "All teams" as the
  // only choice, which still lists everyone.
  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const res = await teamClient.teamList({ page: { page: 1, limit: 200 } });

        if (!cancelled) {
          setTeams(res.teams);
        }
      } catch {
        if (!cancelled) {
          setTeams([]);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const res = await userClient.userList({
        // team_id = 0 -> every user (root scope); a real id -> that team's members.
        teamId,
        q,
        page: { page, limit: PAGE_SIZE },
      });

      setUsers(res.users);
      setPageInfo(res.pageInfo);
    } catch (err) {
      setError(rpcError(err));
      setUsers([]);
      setPageInfo(undefined);
    } finally {
      setLoading(false);
    }
  }, [teamId, q, page]);

  useEffect(() => {
    void load();
  }, [load]);

  async function suspend(user: User, suspended: boolean) {
    try {
      await userClient.suspendUser({ userId: user.id, suspended });

      toaster.create({
        type: "success",
        title: suspended ? `${user.username} suspended` : `${user.username} restored`,
        description: suspended ? "Their active session was cut off immediately." : undefined,
      });

      await load();
    } catch (err) {
      toaster.create({ type: "error", title: "Suspend failed", description: rpcError(err) });
    }
  }

  async function remove(user: User) {
    try {
      await userClient.deleteUser({ userId: user.id });
      toaster.create({ type: "success", title: `${user.username} deleted` });
      await load();
    } catch (err) {
      toaster.create({ type: "error", title: "Delete failed", description: rpcError(err) });
    }
  }

  const totalPage = pageInfo ? pageInfo.totalPage : 1;

  return (
    <Stack gap="section">
      <Flex align="center" gap="card">
        <Heading size="md">All Users</Heading>
        <Spacer />
        {/* CreateUserDialog creates into the CURRENT team (it reads useTeam itself). See report. */}
        <CreateUserDialog onDone={() => void load()} />
      </Flex>

      <HStack gap="card">
        <Input
          maxW="sm"
          placeholder="Search name, username or email"
          value={q}
          data-testid="all-users-search"
          onChange={(e) => {
            setQ(e.target.value);
            setPage(1);
          }}
        />

        <NativeSelect.Root maxW="xs">
          <NativeSelect.Field
            value={teamId.toString()}
            data-testid="all-users-team-filter"
            onChange={(e) => {
              setTeamId(BigInt(e.target.value));
              setPage(1);
            }}
          >
            <option value="0">All teams</option>
            {teams.map((t) => (
              <option key={t.id.toString()} value={t.id.toString()}>
                {t.name || `Team #${t.id}`}
              </option>
            ))}
          </NativeSelect.Field>
          <NativeSelect.Indicator />
        </NativeSelect.Root>
      </HStack>

      {error && (
        <Text color="red.fg" data-testid="all-users-error">
          {error}
        </Text>
      )}

      {loading ? (
        <Spinner colorPalette="brand" />
      ) : (
        <Table.Root size="sm" data-testid="all-users-table">
          <Table.Header>
            <Table.Row>
              <Table.ColumnHeader>User</Table.ColumnHeader>
              <Table.ColumnHeader>Email</Table.ColumnHeader>
              <Table.ColumnHeader>Status</Table.ColumnHeader>
              <Table.ColumnHeader textAlign="end">Actions</Table.ColumnHeader>
            </Table.Row>
          </Table.Header>

          <Table.Body>
            {users.map((user) => {
              // Never offer to suspend or delete yourself — the confirm would be the last thing
              // you ever did in this app.
              const isSelf = identity?.identityId === user.id;

              return (
                <Table.Row key={user.id.toString()} data-testid={`all-users-row-${user.username}`}>
                  <Table.Cell>
                    <UserItem user={user} />
                  </Table.Cell>
                  <Table.Cell>{user.email}</Table.Cell>
                  <Table.Cell>
                    {user.isSuspended ? (
                      <Badge colorPalette="red" data-testid={`all-users-suspended-${user.username}`}>
                        Suspended
                      </Badge>
                    ) : (
                      <Badge colorPalette="green">Active</Badge>
                    )}
                  </Table.Cell>

                  <Table.Cell textAlign="end">
                    <HStack justify="end" gap="1">
                      <EditUserDialog user={user} onDone={() => void load()} />

                      {globalAdmin && !isSelf && (
                        <>
                          {/* An admin sets a password without knowing the old one — exactly the
                              situation when someone is locked out. */}
                          <AdminResetPasswordDialog user={user} />

                          <ConfirmDialog
                            title={user.isSuspended ? "Restore account" : "Suspend account"}
                            message={
                              user.isSuspended
                                ? `Restore ${user.username}? They will be able to sign in again.`
                                : `Suspend ${user.username}? Their active session is cut off immediately and they cannot sign in.`
                            }
                            confirmLabel={user.isSuspended ? "Restore" : "Suspend"}
                            destructive={!user.isSuspended}
                            onConfirm={() => suspend(user, !user.isSuspended)}
                            trigger={
                              <IconButton
                                size="xs"
                                variant="ghost"
                                aria-label={user.isSuspended ? "Restore" : "Suspend"}
                                data-testid={`all-users-suspend-${user.username}`}
                              >
                                {user.isSuspended ? (
                                  <Icon as={Play} boxSize="4" />
                                ) : (
                                  <Icon as={Pause} boxSize="4" />
                                )}
                              </IconButton>
                            }
                          />

                          <ConfirmDialog
                            title="Delete user"
                            message={`Permanently delete ${user.username}? Their team memberships are removed too. This cannot be undone.`}
                            confirmLabel="Delete"
                            onConfirm={() => remove(user)}
                            trigger={
                              <IconButton
                                size="xs"
                                variant="ghost"
                                colorPalette="red"
                                aria-label="Delete"
                                data-testid={`all-users-delete-${user.username}`}
                              >
                                <Icon as={Trash2} boxSize="4" />
                              </IconButton>
                            }
                          />
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

      {!loading && users.length === 0 && !error && (
        <Text color="fg.muted" data-testid="all-users-empty">
          No users found.
        </Text>
      )}

      {!loading && totalPage > 1 && (
        <HStack justify="end" gap="card">
          <IconButton
            size="xs"
            variant="ghost"
            aria-label="Previous page"
            data-testid="all-users-prev"
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            <Icon as={ChevronLeft} boxSize="4" />
          </IconButton>

          <Text fontSize="sm" color="fg.muted" data-testid="all-users-page">
            Page {page} of {totalPage}
          </Text>

          <IconButton
            size="xs"
            variant="ghost"
            aria-label="Next page"
            data-testid="all-users-next"
            disabled={page >= totalPage}
            onClick={() => setPage((p) => p + 1)}
          >
            <Icon as={ChevronRight} boxSize="4" />
          </IconButton>
        </HStack>
      )}
    </Stack>
  );
}
