import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Badge, Flex, Heading, Spacer, Stack, Tabs } from "@chakra-ui/react";
import { useTeam } from "../../features/team/TeamContext";
import { isGlobalAdmin, managesMembers } from "../../lib/roles";
import { AddMemberDialog } from "../../features/users/AddMemberDialog";
import { MemberLog } from "./components/MemberLog";
import { UsersTable } from "./components/UsersTable";

type Tab = "team" | "history" | "all";

// The Users page is TABS (#58, the-history-is-a-tab-beside-the-members):
//
//  - "My Team User" — the current team's members.
//  - "Membership History" — who added, changed and removed whom in that same team, beside it.
//  - "All User" — everyone, filterable by team. Root and the System Administrator only, since only they
//    act outside a team.
//
// The Add Member button lives in the page header (top-right), NOT inside the tabs (#58 review). It is a
// team-membership action, so it shows on both of the team's tabs but not "All User". It does not signal
// the tables (#177): each write invalidates the user cache itself, so every tab's list refreshes.
//
// There is no New User button: the popup's Create is the only way an account is made
// (an-account-is-made-only-from-the-member-search), so nobody makes a second account for someone already
// here. Root and the Administrator add a person from the team they are adding them to.
//
// The button is for those who MANAGE MEMBERS (only-member-managers-open-the-search) — every Owner, the
// warehouse and selling Admins, Root and the Administrator. The admin team's Admin sees the list and no
// button (the-admin-team-admin-alone-does-not-manage-members).
export function UsersPage() {
  const { t } = useTranslation();
  const { current } = useTeam();
  const globalAdmin = isGlobalAdmin(current?.role);
  const manager = managesMembers(current?.role, current?.teamType);

  const [tab, setTab] = useState<Tab>("team");

  const teamScoped = tab !== "all";

  return (
    <Stack gap="section">
      <Flex align="center" gap="card">
        <Heading size="md">{t("users.title")}</Heading>
        {!globalAdmin && current && (
          <Badge colorPalette="brand">{current.teamName || `Team #${current.teamId}`}</Badge>
        )}
        <Spacer />
        {manager && teamScoped && <AddMemberDialog />}
      </Flex>

      {/* lazyMount + unmountOnExit: only the visible tab is mounted, so exactly one list is fetched and
          the shared `users-table` testid is never duplicated. The history loads only when opened. */}
      <Tabs.Root value={tab} onValueChange={(e) => setTab(e.value as Tab)} lazyMount unmountOnExit>
        <Tabs.List>
          <Tabs.Trigger value="team" data-testid="users-tab-team">
            {t("users.tab.myTeam")}
          </Tabs.Trigger>
          <Tabs.Trigger value="history" data-testid="users-tab-history">
            {t("users.log.title")}
          </Tabs.Trigger>
          {globalAdmin && (
            <Tabs.Trigger value="all" data-testid="users-tab-all">
              {t("users.tab.allUsers")}
            </Tabs.Trigger>
          )}
        </Tabs.List>

        <Tabs.Content value="team">
          <UsersTable mode="team" />
        </Tabs.Content>
        <Tabs.Content value="history">
          {current && <MemberLog teamId={current.teamId} teamType={current.teamType} />}
        </Tabs.Content>
        {globalAdmin && (
          <Tabs.Content value="all">
            <UsersTable mode="all" />
          </Tabs.Content>
        )}
      </Tabs.Root>
    </Stack>
  );
}
