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
      // Remounted once, the moment the team list lands — this is load-bearing, not a hack.
      //
      // Zag derives the input's DISPLAY TEXT exactly twice: once when the machine initialises, by
      // looking `value` up in `collection` (combobox.machine.js — `inputValue` is a bindable whose
      // default is `collection.stringifyMany(value)`), and thereafter only when `value` CHANGES. A
      // collection that fills in LATER does not re-derive it.
      //
      // That is invisible when a picker mounts empty and the person picks (every use before #131):
      // the value changes, so the text is derived then, with the list already loaded. But an edit
      // form prefills from the server and mounts this with `value` ALREADY set while our own
      // teamList fetch is still in flight — so the id is looked up in an empty collection, resolves
      // to "", and never recovers, because the value never changes afterwards. The field renders
      // blank while a team is in fact selected.
      //
      // Re-keying on `loading` re-initialises the machine against the full collection. The cost is
      // that filter text typed during the ~100ms load is dropped; the dropdown shows a spinner for
      // that window anyway, and a blank REQUIRED field is far worse.
      key={loading ? "loading" : "ready"}
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
