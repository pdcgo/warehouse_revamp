import { useEffect, useState } from "react";
import { Combobox, Portal, Spinner, useListCollection } from "@chakra-ui/react";
import { teamClient } from "../api/clients";
import type { Team } from "../gen/warehouse/team/v1/team_pb";
import { TeamType } from "../gen/warehouse/team/v1/team_pb";
import { TeamItem } from "./TeamItem";

export interface TeamSelectProps {
  value?: bigint;
  onChange?: (teamId: bigint) => void;
  placeholder?: string;
  disabled?: boolean;
  // When set, the picker only shows teams of this type; the TeamList RPC filters server-side by it.
  // Omit it (the default) to show every team — the original behaviour.
  teamType?: TeamType;
}

// TeamSelect is the shared team picker (#49): a Chakra Combobox so the list is searchable, matching
// on team NAME or team CODE. Each option renders with TeamItem, so the picker looks like every other
// place a team is shown. It fetches the team list itself and emits the selected team id. Pass the
// optional teamType prop to restrict the list to one team type (filtered server-side by TeamList).
export const description = "Searchable team picker (Chakra Combobox) — search by name or code, options render with TeamItem. Emits a team id. Optional teamType prop restricts it to one team type.";

export function TeamSelect({
  value,
  onChange,
  placeholder = "Search team by name or code",
  disabled,
  teamType,
}: TeamSelectProps) {
  const [loading, setLoading] = useState(true);

  const { collection, filter, set } = useListCollection<Team>({
    initialItems: [],
    itemToString: (team) => team.name,
    itemToValue: (team) => team.id.toString(),
    // Match on name OR code — the combobox's default matcher only sees itemToString (the name).
    filter: (_itemText, filterText, team) => {
      const q = filterText.trim().toLowerCase();
      if (!q) return true;
      return team.name.toLowerCase().includes(q) || team.teamCode.toLowerCase().includes(q);
    },
  });

  useEffect(() => {
    let cancelled = false;

    setLoading(true);

    void (async () => {
      try {
        const res = await teamClient.teamList({
          page: { page: 1, limit: 200 },
          // Unset (undefined) sends TEAM_TYPE_UNSPECIFIED, which the RPC treats as "no filter".
          teamType,
        });
        if (!cancelled) {
          set(res.teams);
        }
      } catch {
        if (!cancelled) {
          set([]);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [set, teamType]);

  return (
    <Combobox.Root
      collection={collection}
      disabled={disabled}
      value={value !== undefined ? [value.toString()] : []}
      onValueChange={(e) => {
        const picked = e.value[0];
        if (picked !== undefined) {
          onChange?.(BigInt(picked));
        }
      }}
      onInputValueChange={(e) => filter(e.inputValue)}
      data-testid="team-select"
    >
      <Combobox.Control>
        <Combobox.Input placeholder={placeholder} />
        <Combobox.IndicatorGroup>
          <Combobox.ClearTrigger />
          <Combobox.Trigger />
        </Combobox.IndicatorGroup>
      </Combobox.Control>

      <Portal>
        <Combobox.Positioner>
          <Combobox.Content>
            {loading ? (
              <Combobox.Empty>
                <Spinner size="sm" colorPalette="brand" />
              </Combobox.Empty>
            ) : (
              <>
                <Combobox.Empty>No teams found</Combobox.Empty>
                {collection.items.map((team) => (
                  <Combobox.Item
                    item={team}
                    key={team.id.toString()}
                    data-testid={`team-select-option-${team.teamCode}`}
                  >
                    <TeamItem
                      team={{
                        teamName: team.name,
                        teamType: team.type,
                        teamId: team.id,
                        imageUrl: team.imageUrl,
                      }}
                    />
                    <Combobox.ItemIndicator />
                  </Combobox.Item>
                ))}
              </>
            )}
          </Combobox.Content>
        </Combobox.Positioner>
      </Portal>
    </Combobox.Root>
  );
}
