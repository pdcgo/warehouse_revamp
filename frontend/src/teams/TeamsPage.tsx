import { Heading, Stack, Tabs } from "@chakra-ui/react";
import { TeamType } from "../gen/warehouse/team/v1/team_pb";
import { TeamTable } from "./TeamTable";

// The Teams page is the single home for every kind of team (#59). A tab per team type; the
// Warehouse tab carries the warehouse-specific behaviour (create locked to WAREHOUSE, Edit opens
// the dedicated hours page). The old standalone Warehouses menu is gone — a warehouse is a team.
//
// `lazyMount` + `unmountOnExit`: only the visible tab's TeamTable is mounted, so exactly one team
// list is fetched (the active tab's), and there is never a duplicate `teams-table` in the DOM.
const TABS = [
  { value: "all", label: "All", type: undefined as TeamType | undefined, editAsPage: false },
  { value: "warehouse", label: "Warehouses", type: TeamType.WAREHOUSE, editAsPage: true },
  { value: "selling", label: "Selling", type: TeamType.SELLING, editAsPage: false },
  { value: "admin", label: "Admin", type: TeamType.ADMIN, editAsPage: false },
];

export function TeamsPage() {
  return (
    <Stack gap="section">
      <Heading size="md">Teams</Heading>

      <Tabs.Root defaultValue="all" lazyMount unmountOnExit>
        <Tabs.List>
          {TABS.map((t) => (
            <Tabs.Trigger key={t.value} value={t.value} data-testid={`teams-tab-${t.value}`}>
              {t.label}
            </Tabs.Trigger>
          ))}
        </Tabs.List>

        {TABS.map((t) => (
          <Tabs.Content key={t.value} value={t.value}>
            <TeamTable teamType={t.type} editAsPage={t.editAsPage} />
          </Tabs.Content>
        ))}
      </Tabs.Root>
    </Stack>
  );
}
