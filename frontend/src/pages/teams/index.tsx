import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Tabs } from "../../components/ui/Tabs";
import { TeamType } from "../../gen/warehouse/team/v1/team_pb";
import { useTeam } from "../../features/team/TeamContext";
import { isGlobalAdmin } from "../../lib/roles";
import { CreateTeamDialog } from "./components/CreateTeamDialog";
import { TeamTable } from "./components/TeamTable";

// The Teams page is the single home for every kind of team (#59). A tab per team type; the
// Warehouse tab carries the warehouse-specific behaviour (create locked to WAREHOUSE, Edit opens
// the dedicated hours page). The old standalone Warehouses menu is gone — a warehouse is a team.
//
// The "New …" button lives in the page header (top-right), NOT inside the tabs (#59 review). It
// reflects the ACTIVE tab: on the Warehouses tab it creates a warehouse, on All a team of any type,
// etc. Creating one no longer signals anything to the tables (#177) — the write invalidates the
// team list itself, so every tab's copy of it refreshes rather than only the one that happened to
// be mounted when the counter was bumped.
//
// `lazyMount` + `unmountOnExit`: only the visible tab's TeamTable is mounted, so exactly one team
// list is fetched (the active tab's), and there is never a duplicate `teams-table` in the DOM.
const TABS = [
  { value: "all", labelKey: "teams.tabAll", type: undefined as TeamType | undefined, editAsPage: false },
  { value: "warehouse", labelKey: "teams.tabWarehouses", type: TeamType.WAREHOUSE, editAsPage: true },
  { value: "selling", labelKey: "teams.tabSelling", type: TeamType.SELLING, editAsPage: false },
  { value: "admin", labelKey: "teams.tabAdmin", type: TeamType.ADMIN, editAsPage: false },
];

export function TeamsPage() {
  const { t } = useTranslation();
  const { current } = useTeam();
  const admin = isGlobalAdmin(current?.role);

  const [tab, setTab] = useState("all");

  const activeType = TABS.find((item) => item.value === tab)?.type;

  return (
    <div className="flex flex-col gap-section">
      <div className="flex items-center gap-card">
        <h1 className="text-[22px] font-bold">{t("teams.heading")}</h1>
        <div className="flex-1" />
        {admin && (
          // Keyed by the active tab so the locked type (and label/testid) reset when tabs change.
          <CreateTeamDialog key={tab} fixedType={activeType} />
        )}
      </div>

      <Tabs.Root value={tab} onValueChange={(e) => setTab(e.value)} lazyMount unmountOnExit>
        <Tabs.List>
          {TABS.map((item) => (
            <Tabs.Trigger key={item.value} value={item.value} data-testid={`teams-tab-${item.value}`}>
              {t(item.labelKey)}
            </Tabs.Trigger>
          ))}
        </Tabs.List>

        {TABS.map((item) => (
          <Tabs.Content key={item.value} value={item.value}>
            <TeamTable teamType={item.type} editAsPage={item.editAsPage} />
          </Tabs.Content>
        ))}
      </Tabs.Root>
    </div>
  );
}
