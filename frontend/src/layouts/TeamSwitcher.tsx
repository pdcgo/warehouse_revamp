import { useState } from "react";
import { Avatar, Box, CloseButton, Dialog, Flex, Icon, Input, Portal, Stack, Text } from "@chakra-ui/react";
import { Check, ChevronsUpDown } from "lucide-react";
import { teamTypeAvatar, teamTypeLabel } from "../components/badges/TeamTypeBadge";
import { TeamItem } from "../components/entity/TeamItem";
import { useTeam } from "../features/team/TeamContext";

// TeamSwitcher is the sidebar's current-team control: a card showing the active team (colour keyed
// to its type) that opens a CENTERED dialog to search and switch teams. THE CURRENT TEAM IS THE
// SCOPE, so switching re-scopes the whole app. Collapsed, the trigger shrinks to just the colour chip.
export function TeamSwitcher({ collapsed }: { collapsed?: boolean }) {
  const { teams, current, selectTeam } = useTeam();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  if (teams.length === 0) {
    return null;
  }

  const name = current?.teamName || (current ? `Team #${current.teamId}` : "Select a team");

  const q = query.trim().toLowerCase();
  const filtered = teams.filter((team) =>
    (team.teamName || `Team #${team.teamId}`).toLowerCase().includes(q),
  );

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(e) => {
        setOpen(e.open);
        if (e.open) {
          setQuery("");
        }
      }}
      placement="center"
      size="sm"
    >
      <Dialog.Trigger asChild>
        <Flex
          as="button"
          data-testid="team-switcher"
          align="center"
          gap="2.5"
          // ⚠ COLLAPSED, IT MUST NOT STRETCH. Full width is right in a sidebar, where the switcher
          // IS the row; in the mobile top bar the collapsed trigger sits beside the screen title and
          // a `w="full"` chip pushes that title out of the header entirely.
          w={collapsed ? "auto" : "full"}
          rounded="md"
          borderWidth="1px"
          borderColor="border"
          px="2.5"
          py="2"
          cursor="pointer"
          _hover={{ bg: "bg.muted" }}
          justify={collapsed ? "center" : "flex-start"}
        >
          <Avatar.Root
            shape="rounded"
            size="sm"
            // Tinted by team type from the ONE mapping (TeamTypeBadge) — this file used to keep its own
            // copy, and it had already drifted: the root team was rose here and gray in the team list.
            {...teamTypeAvatar(current?.teamType)}
            flexShrink={0}
          >
            <Avatar.Fallback name={name} />
            <Avatar.Image src={current?.imageUrl || undefined} alt={name} />
          </Avatar.Root>

          {!collapsed && (
            <>
              <Box textAlign="start" flex="1" minW="0">
                <Text fontSize="sm" fontWeight="medium" lineClamp={1}>
                  {name}
                </Text>
                <Text fontSize="xs" color="fg.muted">
                  {current ? teamTypeLabel(current.teamType) : ""}
                </Text>
              </Box>
              <Icon as={ChevronsUpDown} boxSize="4" color="fg.muted" flexShrink={0} />
            </>
          )}
        </Flex>
      </Dialog.Trigger>

      <Portal>
        <Dialog.Backdrop />
        <Dialog.Positioner>
          <Dialog.Content>
            <Dialog.Header>
              <Dialog.Title>Switch Team</Dialog.Title>
            </Dialog.Header>

            <Dialog.Body>
              <Input
                size="sm"
                autoFocus
                placeholder="Search teams"
                data-testid="team-search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                mb="3"
              />

              <Stack gap="0.5" maxH="320px" overflowY="auto">
                {filtered.map((team) => (
                  <Flex
                    as="button"
                    key={team.teamId.toString()}
                    data-testid={`team-option-${team.teamId}`}
                    w="full"
                    rounded="md"
                    px="2.5"
                    py="2"
                    cursor="pointer"
                    // A <button> defaults to text-align:center, which would centre the team name
                    // inside TeamItem — start-align it so the row reads avatar → name, left to right.
                    textAlign="start"
                    _hover={{ bg: "bg.muted" }}
                    onClick={() => {
                      selectTeam(team.teamId);
                      setOpen(false);
                    }}
                  >
                    <TeamItem
                      team={{
                        teamName: team.teamName,
                        teamType: team.teamType,
                        teamId: team.teamId,
                        imageUrl: team.imageUrl,
                      }}
                      action={
                        current?.teamId === team.teamId ? (
                          <Icon as={Check} boxSize="4" color="brand.fg" flexShrink={0} />
                        ) : undefined
                      }
                    />
                  </Flex>
                ))}

                {filtered.length === 0 && (
                  <Text fontSize="sm" color="fg.muted" px="2.5" py="2">
                    No teams found.
                  </Text>
                )}
              </Stack>
            </Dialog.Body>

            <Dialog.CloseTrigger asChild>
              <CloseButton size="sm" />
            </Dialog.CloseTrigger>
          </Dialog.Content>
        </Dialog.Positioner>
      </Portal>
    </Dialog.Root>
  );
}
