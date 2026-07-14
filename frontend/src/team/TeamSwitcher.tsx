import { Box, Flex, Icon, Menu, Portal, Text } from "@chakra-ui/react";
import { Check, ChevronsUpDown } from "lucide-react";
import { TeamType } from "../gen/warehouse/team/v1/team_pb";
import { useTeam } from "./TeamContext";

// Each team type carries a colour so the current scope is recognisable at a glance.
function typeColor(type: TeamType | undefined): string {
  switch (type) {
    case TeamType.WAREHOUSE:
      return "blue.500";
    case TeamType.SELLING:
      return "green.500";
    case TeamType.ADMIN:
      return "purple.500";
    case TeamType.ROOT:
      return "brand.solid";
    default:
      return "gray.400";
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
      return "";
  }
}

// TeamSwitcher is the sidebar's current-team control: a card showing the active team with a
// colour keyed to its type, opening a menu of every team the user belongs to. THE CURRENT TEAM IS
// THE SCOPE, so switching it re-scopes the whole app. Collapsed, it shrinks to just the colour chip.
export function TeamSwitcher({ collapsed }: { collapsed?: boolean }) {
  const { teams, current, selectTeam } = useTeam();

  if (teams.length === 0) {
    return null;
  }

  const name = current?.teamName || (current ? `Team #${current.teamId}` : "Select a team");

  return (
    <Menu.Root positioning={{ placement: "bottom-start" }}>
      <Menu.Trigger asChild>
        <Flex
          as="button"
          data-testid="team-switcher"
          align="center"
          gap="2.5"
          w="full"
          rounded="md"
          borderWidth="1px"
          borderColor="border"
          px="2.5"
          py="2"
          cursor="pointer"
          _hover={{ bg: "bg.muted" }}
          justify={collapsed ? "center" : "flex-start"}
        >
          <Box boxSize="6" rounded="sm" bg={typeColor(current?.teamType)} flexShrink={0} />

          {!collapsed && (
            <>
              <Box textAlign="start" flex="1" minW="0">
                <Text fontSize="sm" fontWeight="medium" lineClamp={1}>
                  {name}
                </Text>
                <Text fontSize="xs" color="fg.muted">
                  {typeLabel(current?.teamType)}
                </Text>
              </Box>
              <Icon as={ChevronsUpDown} boxSize="4" color="fg.muted" flexShrink={0} />
            </>
          )}
        </Flex>
      </Menu.Trigger>

      <Portal>
        <Menu.Positioner>
          <Menu.Content minW="230px">
            {teams.map((team) => (
              <Menu.Item
                key={team.teamId.toString()}
                value={team.teamId.toString()}
                onClick={() => selectTeam(team.teamId)}
                data-testid={`team-option-${team.teamId}`}
              >
                <Box boxSize="4" rounded="sm" bg={typeColor(team.teamType)} flexShrink={0} />
                <Text flex="1" lineClamp={1}>
                  {team.teamName || `Team #${team.teamId}`}
                </Text>
                {current?.teamId === team.teamId && <Icon as={Check} boxSize="4" color="brand.fg" />}
              </Menu.Item>
            ))}
          </Menu.Content>
        </Menu.Positioner>
      </Portal>
    </Menu.Root>
  );
}
