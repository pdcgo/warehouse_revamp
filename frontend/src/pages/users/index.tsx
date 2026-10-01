import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Badge, Flex, Heading, Spacer, Stack, Tabs } from "@chakra-ui/react";
import { useTeam } from "../../features/team/TeamContext";
import { isGlobalAdmin } from "../../lib/roles";
import { AddMemberDialog } from "../../features/users/AddMemberDialog";
import { CreateUserDialog } from "./components/CreateUserDialog";
import { UsersTable } from "./components/UsersTable";

// The Users page has two faces (#58), and the caller's reach decides which:
//
//  - A global admin (root/admin) manages people across the whole system, so they get TABS:
//    "My Team User" (their own team's membership) and "All User" (everyone, filterable by team).
//  - Everyone else — a warehouse/selling team manager — can only manage their own team, so they
//    get that single team-scoped table with no tabs.
//
// The Add member / New user buttons live in the page header (top-right), NOT inside the tabs (#58
// review). "Add member" only makes sense for a team-scoped view, so it shows on the plain page and
// the "My Team User" tab, but not "All User". Neither signals the tables any more (#177): each write
// invalidates the user cache itself, so BOTH tabs' lists refresh — the old `reload` counter only
// ever reached the one that happened to be mounted.
export function UsersPage() {
  const { t } = useTranslation();
  const { current } = useTeam();
  const globalAdmin = isGlobalAdmin(current?.role);

  const [tab, setTab] = useState<"team" | "all">("team");

  // Add member is a team-membership action — offered wherever the view is a single team.
  const teamScoped = !globalAdmin || tab === "team";

  const header = (
    <Flex align="center" gap="card">
      <Heading size="md">{t("users.title")}</Heading>
      {!globalAdmin && current && (
        <Badge colorPalette="brand">{current.teamName || `Team #${current.teamId}`}</Badge>
      )}
      <Spacer />
      {teamScoped && <AddMemberDialog />}
      <CreateUserDialog />
    </Flex>
  );

  if (!globalAdmin) {
    return (
      <Stack gap="section">
        {header}
        <UsersTable mode="team" />
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
            {t("users.tab.myTeam")}
          </Tabs.Trigger>
          <Tabs.Trigger value="all" data-testid="users-tab-all">
            {t("users.tab.allUsers")}
          </Tabs.Trigger>
        </Tabs.List>

        <Tabs.Content value="team">
          <UsersTable mode="team" />
        </Tabs.Content>
        <Tabs.Content value="all">
          <UsersTable mode="all" />
        </Tabs.Content>
      </Tabs.Root>
    </Stack>
  );
}
