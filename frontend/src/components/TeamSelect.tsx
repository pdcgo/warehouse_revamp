import { useEffect, useState } from "react";
import { Combobox, Portal, Spinner, useListCollection } from "@chakra-ui/react";
import { useTeams } from "../teams/queries";
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

  // Read through the cache (#176's gap, found via a flaky e2e — see src/shops/queries.ts).
  //
  // The hand-rolled version fetched once in an effect keyed on `[set, teamType]`, neither of which
  // changes in normal use. On failure it called `set([])` and stopped forever, so ONE transient
  // failure left this picker permanently empty — and this picker is the REQUIRED warehouse field on
  // the order and restock forms, so an empty one means the form cannot be submitted at all, with no
  // way back but a reload.
  //
  // `useTeams` already asks exactly this question, so this shares its cache rather than adding a
  // second copy of the same list.
  const query = useTeams({ teamType, page: 1, pageSize: 200 });
  const teams = query.data?.teams;

  // ⚠ `filled` tracks whether the COLLECTION has the list, not whether the QUERY has finished, and
  // the difference is the whole point once there is a cache.
  //
  // The remount below has to happen the moment the collection fills. With a cold fetch those were the
  // same instant, so `query.isPending` would do. On a CACHE HIT they are not: the data is present on
  // the very first render while the collection — filled by the effect below — is still empty. Keying
  // on the query would leave `key` at "ready" throughout, the machine would initialise against an
  // empty collection, and a prefilled edit form would render a BLANK REQUIRED FIELD. That is #131,
  // reintroduced by caching.
  const [filled, setFilled] = useState(false);

  // The collection is the combobox's own store, so the fetched list still has to be handed to it.
  useEffect(() => {
    if (teams === undefined) return;

    set(teams);
    setFilled(true);
  }, [teams, set]);

  const loading = !filled;

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
      // OPEN ON CLICK (#146's lesson, applied here too). The teams are already loaded, so making
      // somebody type before they can see which ones exist is asking them to guess. Every bounded
      // picker in the app now behaves this way; only ProductSelect withholds its list, because it
      // searches the server over a catalogue too large to show.
      openOnClick
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
