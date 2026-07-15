import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Button, Icon, Spinner, Stack, Text } from "@chakra-ui/react";
import { ArrowLeft } from "lucide-react";
import { rpcError, teamClient } from "../api/clients";
import { TeamType } from "../gen/warehouse/team/v1/team_pb";
import type { Team } from "../gen/warehouse/team/v1/team_pb";
import { TeamDetailCommon } from "./TeamDetailCommon";
import { WarehouseInfoSection } from "./WarehouseInfoSection";
import { ShopsSection } from "./ShopsSection";

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
// It loads the team once and hands it (with a reload callback) to the type page.
export function TeamDetailPage({ backTo = "/teams" }: { backTo?: string }) {
  const { teamId: teamIdParam } = useParams();
  const navigate = useNavigate();

  const teamId = parseTeamId(teamIdParam);

  const [team, setTeam] = useState<Team | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadTeam = useCallback(async () => {
    if (teamId === 0n) {
      setError("Invalid team id.");
      setLoading(false);
      return;
    }

    setLoading(true);
    setError("");

    try {
      const res = await teamClient.teamDetail({ teamId });
      setTeam(res.team ?? null);
    } catch (err) {
      setError(rpcError(err));
      setTeam(null);
    } finally {
      setLoading(false);
    }
  }, [teamId]);

  useEffect(() => {
    void loadTeam();
  }, [loadTeam]);

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

  const reload = () => void loadTeam();

  switch (team.type) {
    case TeamType.WAREHOUSE:
      return (
        <TeamDetailCommon
          team={team}
          noun="Warehouse"
          backTo={backTo}
          onReload={reload}
          extra={<WarehouseInfoSection teamId={team.id} />}
        />
      );
    case TeamType.SELLING:
      return (
        <TeamDetailCommon
          team={team}
          noun="Team"
          backTo={backTo}
          onReload={reload}
          extra={<ShopsSection teamId={team.id} />}
        />
      );
    default:
      // Root / admin — the full common detail, no type-specific section.
      return <TeamDetailCommon team={team} noun="Team" backTo={backTo} onReload={reload} />;
  }
}
