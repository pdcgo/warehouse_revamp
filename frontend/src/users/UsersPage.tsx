import { useCallback, useEffect, useState } from "react";
import {
  Badge,
  Button,
  Flex,
  HStack,
  Heading,
  IconButton,
  Input,
  Spacer,
  Spinner,
  Stack,
  Table,
  Text,
} from "@chakra-ui/react";
import { rpcError, userClient } from "../api/clients";
import type { User } from "../gen/warehouse/user/v1/user_pb";
import { Role } from "../gen/warehouse/role_base/v1/role_pb";
import { useAuth } from "../auth/AuthContext";
import { useTeam } from "../team/TeamContext";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { toaster } from "../components/Toaster";
import { isGlobalAdmin } from "../lib/roles";
import { CreateUserDialog } from "./CreateUserDialog";
import { EditUserDialog } from "./EditUserDialog";
import { AddMemberDialog } from "./AddMemberDialog";
import { AdminResetPasswordDialog } from "./AdminResetPasswordDialog";

const PAGE_SIZE = 20;

export function UsersPage() {
  const { identity } = useAuth();
  const { current } = useTeam();

  const [users, setUsers] = useState<User[]>([]);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // A global admin may look at EVERY user (team_id = 0). Anyone else sees only their own team.
  //
  // The backend enforces this regardless: team_id = 0 resolves to the root scope, so a
  // non-admin asking for it is denied. This flag only decides what we ASK for.
  const globalAdmin = isGlobalAdmin(current?.role);
  const [allTeams, setAllTeams] = useState(false);

  const teamId = allTeams && globalAdmin ? 0n : (current?.teamId ?? 0n);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const res = await userClient.userList({
        teamId,
        q,
        page: { page: 1, limit: PAGE_SIZE },
      });

      setUsers(res.users);
    } catch (err) {
      setError(rpcError(err));
      setUsers([]);
    } finally {
      setLoading(false);
    }
  }, [teamId, q]);

  useEffect(() => {
    void load();
  }, [load]);

  async function suspend(user: User, suspended: boolean) {
    try {
      await userClient.suspendUser({ userId: user.id, suspended });

      toaster.create({
        type: "success",
        title: suspended ? `${user.username} suspended` : `${user.username} restored`,
        // Worth saying: suspension is not "they cannot log in next time" — it cuts their
        // current session off on the very next request.
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

  async function removeFromTeam(user: User) {
    try {
      await userClient.teamUserUpdate({
        teamId: current?.teamId ?? 0n,
        action: { case: "remove", value: { userId: user.id } },
      });

      toaster.create({ type: "success", title: `${user.username} removed from the team` });
      await load();
    } catch (err) {
      toaster.create({ type: "error", title: "Remove failed", description: rpcError(err) });
    }
  }

  return (
    <Stack gap="section">
      <Flex align="center" gap="card">
        <Heading size="md">Users</Heading>

        {current && !allTeams && (
          <Badge colorPalette="brand">{current.teamName || `Team #${current.teamId}`}</Badge>
        )}

        <Spacer />

        {globalAdmin && (
          <Button
            size="xs"
            variant={allTeams ? "solid" : "outline"}
            colorPalette="brand"
            data-testid="toggle-all-users"
            onClick={() => setAllTeams((v) => !v)}
          >
            {allTeams ? "All users" : "This team"}
          </Button>
        )}

        <AddMemberDialog onDone={() => void load()} />
        <CreateUserDialog onDone={() => void load()} />
      </Flex>

      <HStack>
        <Input
          maxW="sm"
          placeholder="Search name, username or email"
          value={q}
          data-testid="user-search"
          onChange={(e) => setQ(e.target.value)}
        />
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
              <Table.ColumnHeader>Username</Table.ColumnHeader>
              <Table.ColumnHeader>Name</Table.ColumnHeader>
              <Table.ColumnHeader>Email</Table.ColumnHeader>
              <Table.ColumnHeader>Status</Table.ColumnHeader>
              <Table.ColumnHeader textAlign="end">Actions</Table.ColumnHeader>
            </Table.Row>
          </Table.Header>

          <Table.Body>
            {users.map((user) => {
              // Never offer to delete or suspend yourself — the confirm dialog would be the last
              // thing you ever did in this app.
              const isSelf = identity?.identityId === user.id;

              return (
                <Table.Row key={user.id.toString()} data-testid={`user-row-${user.username}`}>
                  <Table.Cell>{user.username}</Table.Cell>
                  <Table.Cell>{user.name}</Table.Cell>
                  <Table.Cell>{user.email}</Table.Cell>
                  <Table.Cell>
                    {user.isSuspended ? (
                      <Badge colorPalette="red" data-testid={`suspended-${user.username}`}>
                        Suspended
                      </Badge>
                    ) : (
                      <Badge colorPalette="green">Active</Badge>
                    )}
                  </Table.Cell>

                  <Table.Cell textAlign="end">
                    <HStack justify="end" gap="1">
                      <EditUserDialog user={user} onDone={() => void load()} />

                      {!allTeams && current && !isSelf && (
                        <ConfirmDialog
                          title="Remove from team"
                          message={`Remove ${user.username} from ${current.teamName || "this team"}? The account itself is kept.`}
                          confirmLabel="Remove"
                          onConfirm={() => removeFromTeam(user)}
                          trigger={
                            <IconButton
                              size="xs"
                              variant="ghost"
                              aria-label="Remove from team"
                              data-testid={`remove-${user.username}`}
                            >
                              ⊘
                            </IconButton>
                          }
                        />
                      )}

                      {globalAdmin && !isSelf && (
                        <>
                          {/* An admin sets a password without knowing the old one — which is
                              exactly the situation you are in when someone is locked out. */}
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
                                data-testid={`suspend-${user.username}`}
                              >
                                {user.isSuspended ? "▶" : "⏸"}
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
                                data-testid={`delete-${user.username}`}
                              >
                                ✕
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
        <Text color="fg.muted" data-testid="users-empty">
          No users found.
        </Text>
      )}

      <Text fontSize="xs" color="fg.muted">
        Roles shown are per-team. {Role[Role.ROOT]} and {Role[Role.ADMIN]} exist only in the root
        team.
      </Text>
    </Stack>
  );
}
