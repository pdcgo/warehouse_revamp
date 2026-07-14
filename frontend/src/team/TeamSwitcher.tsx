import { useState } from "react";
import { Box, Button, Flex, Icon, Input, Popover, Portal, Stack, Text } from "@chakra-ui/react";
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
// colour keyed to its type, opening a searchable popup of every team the user belongs to. THE
// CURRENT TEAM IS THE SCOPE, so switching it re-scopes the whole app. Collapsed, it shrinks to
// just the colour chip.
export function TeamSwitcher({ collapsed }: { collapsed?: boolean }) {
  const { teams, current, selectTeam } = useTeam();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  if (teams.length === 0) {
    return null;
  }

  const name = current?.teamName || (current ? `Team #${current.teamId}` : "Select a team");

  // Match on the same label we render — the `Team #<id>` fallback is searchable too.
  const q = query.trim().toLowerCase();
  const filtered = teams.filter((team) =>
    (team.teamName || `Team #${team.teamId}`).toLowerCase().includes(q),
  );

  return (
    <Popover.Root
      open={open}
      onOpenChange={(e) => {
        setOpen(e.open);
        // Start each open with a clean filter.
        if (e.open) {
          setQuery("");
        }
      }}
      positioning={{ placement: "bottom-start" }}
    >
      <Popover.Trigger asChild>
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
      </Popover.Trigger>

      <Portal>
        <Popover.Positioner>
          <Popover.Content w="260px">
            <Popover.Body p="2">
              <Input
                size="sm"
                autoFocus
                placeholder="Search teams"
                data-testid="team-search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                mb="2"
              />

              <Stack gap="0.5" maxH="240px" overflowY="auto">
                {filtered.map((team) => (
                  <Button
                    key={team.teamId.toString()}
                    variant="ghost"
                    justifyContent="flex-start"
                    w="full"
                    data-testid={`team-option-${team.teamId}`}
                    onClick={() => {
                      selectTeam(team.teamId);
                      setOpen(false);
                    }}
                  >
                    <Box boxSize="4" rounded="sm" bg={typeColor(team.teamType)} flexShrink={0} />
                    <Text flex="1" textAlign="start" lineClamp={1}>
                      {team.teamName || `Team #${team.teamId}`}
                    </Text>
                    {current?.teamId === team.teamId && (
                      <Icon as={Check} boxSize="4" color="brand.fg" flexShrink={0} />
                    )}
                  </Button>
                ))}

                {filtered.length === 0 && (
                  <Text fontSize="sm" color="fg.muted" px="2" py="1.5">
                    No teams found.
                  </Text>
                )}
              </Stack>
            </Popover.Body>
          </Popover.Content>
        </Popover.Positioner>
      </Portal>
    </Popover.Root>
  );
}
