import type { ReactNode } from "react";
import { Avatar, Badge, HStack, Stack, Text } from "@chakra-ui/react";
import { TeamType } from "../gen/warehouse/team/v1/team_pb";

// Each team type gets its own colour so the type is readable at a glance.
function typePalette(type: TeamType | undefined): string {
  switch (type) {
    case TeamType.WAREHOUSE:
      return "blue";
    case TeamType.SELLING:
      return "green";
    case TeamType.ADMIN:
      return "purple";
    case TeamType.ROOT:
      return "gray";
    default:
      return "gray";
  }
}

function typeLabel(type: TeamType | undefined): string {
  switch (type) {
    case TeamType.ROOT:
      return "Root";
    case TeamType.ADMIN:
      return "Admin";
    case TeamType.WAREHOUSE:
      return "Warehouse";
    case TeamType.SELLING:
      return "Selling";
    default:
      return "Team";
  }
}

export interface TeamItemProps {
  // Any team-shaped object with a name, type, and (optionally) id — a Team or a TeamAccessItem.
  team: { teamName?: string; teamType?: TeamType; teamId?: bigint };
  // Optional trailing content: a check, actions, etc.
  action?: ReactNode;
}

// TeamItem is the shared way to show a team (#42): a rounded avatar (name initials), the team name,
// and a type badge coloured by team type. Everything that renders "a team" should use this so team
// display stays consistent.
export function TeamItem({ team, action }: TeamItemProps) {
  const name = team.teamName || (team.teamId !== undefined ? `Team #${team.teamId}` : "Team");
  const palette = typePalette(team.teamType);

  return (
    <HStack gap="card" w="full">
      <Avatar.Root shape="rounded" size="sm" colorPalette={palette} flexShrink={0}>
        <Avatar.Fallback name={name} />
      </Avatar.Root>

      <Stack gap="0.5" flex="1" minW="0">
        <Text fontWeight="medium" lineClamp={1}>
          {name}
        </Text>
        <Badge colorPalette={palette} size="sm" alignSelf="flex-start">
          {typeLabel(team.teamType)}
        </Badge>
      </Stack>

      {action}
    </HStack>
  );
}
