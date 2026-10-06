import { useState } from "react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Avatar, Badge, Box, CloseButton, Dialog, Flex, HStack, Icon, Input, Portal, Spinner, Stack, Text } from "@chakra-ui/react";
import { Check, ChevronsUpDown } from "lucide-react";
import { teamTypeAvatar, teamTypeLabel } from "../components/badges/TeamTypeBadge";
import { TeamItem } from "../components/entity/TeamItem";
import { useTeam } from "../features/team/TeamContext";
import { useTeamSearch } from "../features/teams/queries";
import { useDebounced } from "../lib/useDebounced";

// TeamSwitcher is the sidebar's current-team control: a card showing the active team (colour keyed
// to its type) that opens a CENTERED dialog to search and switch teams. THE CURRENT TEAM IS THE
// SCOPE, so switching re-scopes the whole app. Collapsed, the trigger shrinks to just the colour chip.
//
// Root and the Administrator get a second section, *All teams*, searched on the server: every team, the ones
// they are not in marked as such (the-switcher-offers-every-team). Picking one acts there with their platform
// role under a strip on every page (a-non-member-root-acts-under-a-strip). Everyone else sees their own teams
// only, as before.
export function TeamSwitcher({ collapsed }: { collapsed?: boolean }) {
  const { t } = useTranslation();
  const { teams, current, platformRole, selectTeam } = useTeam();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const reachesEveryTeam = platformRole !== undefined;
  const term = useDebounced(query.trim());
  const everyTeam = useTeamSearch({ q: term, enabled: open && reachesEveryTeam });

  if (teams.length === 0) {
    return null;
  }

  const name = current?.teamName || (current ? `Team #${current.teamId}` : t("shell.switchTeam"));

  const q = query.trim().toLowerCase();
  const filtered = teams.filter((team) =>
    (team.teamName || `Team #${team.teamId}`).toLowerCase().includes(q),
  );

  // A team you are in stays under My teams, with your own role — All teams never shadows a membership.
  const memberIds = new Set(teams.map((team) => team.teamId.toString()));
  const others = (everyTeam.data ?? []).filter((team) => !memberIds.has(team.id.toString()));

  function pick(teamId: bigint) {
    selectTeam(teamId);
    setOpen(false);
  }

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
              <Dialog.Title>{t("shell.switchTeam")}</Dialog.Title>
            </Dialog.Header>

            <Dialog.Body>
              <Input
                size="sm"
                autoFocus
                placeholder={t("shell.searchTeams")}
                data-testid="team-search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                mb="3"
              />

              <Stack gap="0.5" maxH="360px" layerStyle="scrollList">
                {reachesEveryTeam && <SectionLabel testId="team-section-mine">{t("shell.myTeams")}</SectionLabel>}

                {filtered.map((team) => (
                  <TeamRow
                    key={team.teamId.toString()}
                    teamId={team.teamId}
                    team={{ teamName: team.teamName, teamType: team.teamType, teamId: team.teamId, imageUrl: team.imageUrl }}
                    selected={current?.teamId === team.teamId}
                    onPick={pick}
                  />
                ))}

                {filtered.length === 0 && (
                  <Text fontSize="sm" color="fg.muted" px="2.5" py="2">
                    {t("shell.noTeams")}
                  </Text>
                )}

                {reachesEveryTeam && (
                  <>
                    <SectionLabel testId="team-section-all">{t("shell.allTeams")}</SectionLabel>

                    {everyTeam.isPending ? (
                      <Spinner size="sm" colorPalette="brand" mx="2.5" my="2" />
                    ) : others.length === 0 ? (
                      <Text fontSize="sm" color="fg.muted" px="2.5" py="2">
                        {t("shell.noTeams")}
                      </Text>
                    ) : (
                      others.map((team) => (
                        <TeamRow
                          key={team.id.toString()}
                          teamId={team.id}
                          team={{ teamName: team.name, teamType: team.type, teamId: team.id, imageUrl: team.imageUrl }}
                          selected={current?.teamId === team.id}
                          onPick={pick}
                          mark={
                            <Badge size="sm" variant="subtle" colorPalette="warning" data-testid={`team-not-member-${team.id}`}>
                              {t("shell.notMemberBadge")}
                            </Badge>
                          }
                        />
                      ))
                    )}
                  </>
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

function SectionLabel({ children, testId }: { children: ReactNode; testId: string }) {
  return (
    <Text textStyle="xs" color="fg.muted" px="2.5" pt="2" pb="1" data-testid={testId}>
      {children}
    </Text>
  );
}

// One row of the switcher — a membership, or (with `mark`) a team picked from All teams.
function TeamRow({
  teamId,
  team,
  selected,
  onPick,
  mark,
}: {
  teamId: bigint;
  team: { teamName: string; teamType: number; teamId: bigint; imageUrl: string };
  selected: boolean;
  onPick: (teamId: bigint) => void;
  mark?: ReactNode;
}) {
  return (
    <Flex
      as="button"
      data-testid={`team-option-${teamId}`}
      w="full"
      rounded="md"
      px="2.5"
      py="2"
      cursor="pointer"
      // A <button> defaults to text-align:center, which would centre the team name
      // inside TeamItem — start-align it so the row reads avatar → name, left to right.
      textAlign="start"
      _hover={{ bg: "bg.muted" }}
      onClick={() => onPick(teamId)}
    >
      <TeamItem
        team={team}
        action={
          // The mark stays on the SELECTED row too: acting in a team you are not in is the case it exists for.
          mark || selected ? (
            <HStack gap="2" flexShrink={0}>
              {mark}
              {selected && <Icon as={Check} boxSize="4" color="brand.fg" />}
            </HStack>
          ) : undefined
        }
      />
    </Flex>
  );
}
