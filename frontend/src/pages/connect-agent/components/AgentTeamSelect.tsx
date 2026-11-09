import { useMemo } from "react";
import { Center, Combobox, HStack, Icon, Portal, Stack, Text, useListCollection } from "@chakra-ui/react";
import { Globe } from "lucide-react";
import { useTranslation } from "react-i18next";

import { TeamItem } from "../../../components/entity/TeamItem";
import type { TeamAccessItem } from "../../../gen/warehouse/user/v1/user_pb";
import { searchOnlyWhatIsTyped } from "../../../lib/comboboxSearch";
import { roleLabel } from "../../../lib/roles";

/** An option: one of the person's teams, or — for Root and the Administrator — every team (`0`). */
interface Option {
  value: string;
  label: string;
  team?: TeamAccessItem;
}

/** The team id that means EVERY team — root's bypass (a-roots-agent-reads-every-team). */
export const EVERY_TEAM = 0n;

// WHICH TEAM THE AGENT READS — one of the person's own teams, and for Root and the root team's Administrator also
// *Every team* (a-roots-agent-reads-every-team). One team per connection otherwise: an owner of two selling teams
// connects twice (an-agent-gets-its-own-team-credential).
//
// A SEARCH SELECT, not a list: a person's memberships are few today and bounded by nothing, so the field searches
// (a picker over data that grows). The list is the person's own and loads whole, so it filters in the field; the page
// mounts this only once the memberships have arrived, so a preselected team resolves against a full collection and the
// late-fill remount the shared pickers carry is not needed.
//
// Each option names the person's ROLE there — it is what decides whether the owner's consent is needed.
export function AgentTeamSelect({
  teams,
  offerEveryTeam,
  value,
  onChange,
  disabled,
}: {
  teams: TeamAccessItem[];
  /** Root or the Administrator in the root team. */
  offerEveryTeam: boolean;
  /** The picked team — `EVERY_TEAM` for every team, `undefined` for none yet. */
  value: bigint | undefined;
  onChange: (teamId: bigint | undefined) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation();

  const options = useMemo<Option[]>(
    () => [
      ...(offerEveryTeam ? [{ value: EVERY_TEAM.toString(), label: t("agents.connect.everyTeam") }] : []),
      ...teams.map((team) => ({ value: team.teamId.toString(), label: team.teamName, team })),
    ],
    [offerEveryTeam, teams, t],
  );

  const { collection, filter } = useListCollection<Option>({
    initialItems: options,
    itemToString: (o) => o.label,
    itemToValue: (o) => o.value,
    filter: (text, typed) => text.toLowerCase().includes(typed.trim().toLowerCase()),
  });

  // Only a keystroke searches; a pick or a click-to-open starts over, so the list reopens whole.
  const search = searchOnlyWhatIsTyped(filter);

  return (
    <Combobox.Root
      openOnClick
      collection={collection}
      disabled={disabled}
      value={value !== undefined ? [value.toString()] : []}
      onValueChange={(e) => {
        // Clearing emits "none" — the parent must not keep the team the field no longer shows.
        const picked = e.value[0];
        onChange(picked !== undefined ? BigInt(picked) : undefined);
      }}
      onInputValueChange={search.onInputValueChange}
      onOpenChange={search.onOpenChange}
      data-testid="agent-team-select"
    >
      <Combobox.Control>
        <Combobox.Input placeholder={t("agents.connect.teamPlaceholder")} />
        <Combobox.IndicatorGroup>
          <Combobox.ClearTrigger />
          <Combobox.Trigger />
        </Combobox.IndicatorGroup>
      </Combobox.Control>

      <Portal>
        <Combobox.Positioner>
          <Combobox.Content>
            <Combobox.Empty>{t("agents.connect.noTeamFound")}</Combobox.Empty>
            {collection.items.map((option) => (
              <Combobox.Item item={option} key={option.value} data-testid={`agent-team-option-${option.value}`}>
                {option.team ? (
                  <HStack gap="3" flex="1" minW="0" justify="space-between">
                    <TeamItem team={option.team} />
                    <Text fontSize="xs" color="fg.muted" flexShrink={0}>
                      {roleLabel(option.team.role, option.team.teamType)}
                    </Text>
                  </HStack>
                ) : (
                  <HStack gap="3" flex="1" minW="0">
                    <Center boxSize="8" rounded="md" bg="brand.subtle" color="brand.fg" flexShrink={0}>
                      <Icon as={Globe} boxSize="4" />
                    </Center>
                    <Stack gap="0" minW="0">
                      <Text fontWeight="bold">{option.label}</Text>
                      <Text fontSize="xs" color="fg.muted">
                        {t("agents.connect.everyTeamHint")}
                      </Text>
                    </Stack>
                  </HStack>
                )}
                <Combobox.ItemIndicator />
              </Combobox.Item>
            ))}
          </Combobox.Content>
        </Combobox.Positioner>
      </Portal>
    </Combobox.Root>
  );
}
