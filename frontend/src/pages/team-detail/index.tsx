import { useNavigate, useParams } from "react-router-dom";
import { Button, Icon, Spinner, Stack, Text } from "@chakra-ui/react";
import { ArrowLeft } from "lucide-react";
import { rpcError } from "../../api/clients";
import { TeamType } from "../../gen/warehouse/team/v1/team_pb";
import { TeamDetailCommon } from "./components/TeamDetailCommon";
import { useTeamDetail } from "../../features/teams/queries";
import { WarehouseInfoSection } from "./components/WarehouseInfoSection";
import { ShopsSection } from "./components/ShopsSection";

function parseTeamId(raw: string | undefined): bigint {
  if (!raw) return 0n;
  try {
    return BigInt(raw);
  } catch {
    return 0n;
  }
}

// TeamDetailPage is the detail route for a team (#38/#39). Since #79 it DISPATCHES BY TEAM TYPE:
// every type shares the common detail (TeamDetailCommon) but gets a different type-specific section
// and actions —
//   - WAREHOUSE: its weekly hours + location (with an edit shortcut), via WarehouseInfoSection.
//   - SELLING:   its marketplace shops, via ShopsSection.
//   - ROOT/ADMIN: the common detail only — they coordinate, they hold no stock or storefronts.
// It loads the team once and hands it to the type page.
export function TeamDetailPage({ backTo = "/teams" }: { backTo?: string }) {
  const { teamId: teamIdParam } = useParams();
  const navigate = useNavigate();

  const teamId = parseTeamId(teamIdParam);

  // The `onReload` callback this page used to hand down is gone (#177): an edit invalidates the
  // team cache, and this query is one of its readers, so the page re-reads itself.
  const query = useTeamDetail({ teamId });

  const team = query.data ?? null;
  const loading = query.isPending && teamId !== 0n;

  // A malformed id never reaches the server, so its message comes from here.
  const error = teamId === 0n ? "Invalid team id." : query.isError ? rpcError(query.error) : "";

  if (loading) {
    return <Spinner colorPalette="brand" />;
  }

  if (error || !team) {
    return (
      <Stack gap="section">
        <Button
          size="xs"
          variant="ghost"
          alignSelf="flex-start"
          data-testid="team-detail-back"
          onClick={() => navigate(backTo)}
        >
          <Icon as={ArrowLeft} boxSize="4" />
          Back
        </Button>
        <Text color="red.fg" data-testid="team-detail-error">
          {error || "Team not found."}
        </Text>
      </Stack>
    );
  }

  switch (team.type) {
    case TeamType.WAREHOUSE:
      return (
        <TeamDetailCommon
          team={team}
          noun="Warehouse"
          backTo={backTo}
          extra={<WarehouseInfoSection teamId={team.id} />}
        />
      );
    case TeamType.SELLING:
      return (
        <TeamDetailCommon
          team={team}
          noun="Team"
          backTo={backTo}
          extra={<ShopsSection teamId={team.id} />}
        />
      );
    default:
      // Root / admin — the full common detail, no type-specific section.
      return <TeamDetailCommon team={team} noun="Team" backTo={backTo} />;
  }
}
