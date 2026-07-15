import { useState } from "react";
import { Badge, Flex, Heading, Spacer, Stack, Tabs } from "@chakra-ui/react";
import { useTeam } from "../team/TeamContext";
import { isGlobalAdmin } from "../lib/roles";
import { AddMemberDialog } from "./AddMemberDialog";
import { CreateUserDialog } from "./CreateUserDialog";
import { UsersTable } from "./UsersTable";

// The Users page has two faces (#58), and the caller's reach decides which:
//
//  - A global admin (root/admin) manages people across the whole system, so they get TABS:
//    "My Team User" (their own team's membership) and "All User" (everyone, filterable by team).
//  - Everyone else — a warehouse/selling team manager — can only manage their own team, so they
//    get that single team-scoped table with no tabs.
//
// The Add member / New user buttons live in the page header (top-right), NOT inside the tabs (#58
// review). "Add member" only makes sense for a team-scoped view, so it shows on the plain page and
// the "My Team User" tab, but not "All User". Running either bumps `reload` so the active table
// refreshes.
export function UsersPage() {
  const { current } = useTeam();
  const globalAdmin = isGlobalAdmin(current?.role);

  const [tab, setTab] = useState<"team" | "all">("team");
  const [reload, setReload] = useState(0);
  const bump = () => setReload((r) => r + 1);

  // Add member is a team-membership action — offered wherever the view is a single team.
  const teamScoped = !globalAdmin || tab === "team";

  const header = (
    <Flex align="center" gap="card">
      <Heading size="md">Users</Heading>
      {!globalAdmin && current && (
        <Badge colorPalette="brand">{current.teamName || `Team #${current.teamId}`}</Badge>
      )}
      <Spacer />
      {teamScoped && <AddMemberDialog onDone={bump} />}
      <CreateUserDialog onDone={bump} />
    </Flex>
  );

  if (!globalAdmin) {
    return (
      <Stack gap="section">
        {header}
        <UsersTable mode="team" reloadSignal={reload} />
      </Stack>
    );
  }

  return (
    <Stack gap="section">
      {header}

      {/* lazyMount + unmountOnExit: only the visible tab's table is mounted, so exactly one user
          list is fetched and the shared `users-table` testid is never duplicated. */}
      <Tabs.Root value={tab} onValueChange={(e) => setTab(e.value as "team" | "all")} lazyMount unmountOnExit>
        <Tabs.List>
          <Tabs.Trigger value="team" data-testid="users-tab-team">
            My Team User
          </Tabs.Trigger>
          <Tabs.Trigger value="all" data-testid="users-tab-all">
            All User
          </Tabs.Trigger>
        </Tabs.List>

        <Tabs.Content value="team">
          <UsersTable mode="team" reloadSignal={reload} />
        </Tabs.Content>
        <Tabs.Content value="all">
          <UsersTable mode="all" reloadSignal={reload} />
        </Tabs.Content>
      </Tabs.Root>
    </Stack>
  );
}
