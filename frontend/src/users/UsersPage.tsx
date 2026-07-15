import { Heading, Stack, Tabs } from "@chakra-ui/react";
import { useTeam } from "../team/TeamContext";
import { isGlobalAdmin } from "../lib/roles";
import { UsersTable } from "./UsersTable";

// The Users page has two faces (#58), and the caller's reach decides which:
//
//  - A global admin (root/admin) manages people across the whole system, so they get TABS:
//    "My Team User" (their own team's membership) and "All User" (everyone, filterable by team).
//  - Everyone else — a warehouse/selling team manager — can only manage their own team, so they
//    get that single team-scoped table with no tabs.
//
// This merges the former separate "Users" and "All Users" menus into one (the All-Users view is
// now the "All User" tab). `isGlobalAdmin` is the right switch: it is exactly who could list every
// user before, and it matches what the backend actually permits.
export function UsersPage() {
  const { current } = useTeam();
  const globalAdmin = isGlobalAdmin(current?.role);

  return (
    <Stack gap="section">
      <Heading size="md">Users</Heading>

      {globalAdmin ? (
        // lazyMount + unmountOnExit: only the visible tab's table is mounted, so exactly one user
        // list is fetched and the shared `users-table` testid is never duplicated.
        <Tabs.Root defaultValue="team" lazyMount unmountOnExit>
          <Tabs.List>
            <Tabs.Trigger value="team" data-testid="users-tab-team">
              My Team User
            </Tabs.Trigger>
            <Tabs.Trigger value="all" data-testid="users-tab-all">
              All User
            </Tabs.Trigger>
          </Tabs.List>

          <Tabs.Content value="team">
            <UsersTable mode="team" />
          </Tabs.Content>
          <Tabs.Content value="all">
            <UsersTable mode="all" />
          </Tabs.Content>
        </Tabs.Root>
      ) : (
        <UsersTable mode="team" />
      )}
    </Stack>
  );
}
