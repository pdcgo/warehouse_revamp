import { useEffect, useMemo, useState } from "react";
import { Badge, Box, Combobox, Portal, Spinner, Text, useListCollection } from "@chakra-ui/react";
import { useTeams } from "../../features/teams/queries";
import type { Team } from "../../gen/warehouse/team/v1/team_pb";
import { TeamType } from "../../gen/warehouse/team/v1/team_pb";
import { TeamItem, typeLabel, typePalette } from "../entity/TeamItem";

export interface TeamSelectProps {
  value?: bigint;
  onChange?: (teamId: bigint) => void;
  placeholder?: string;
  disabled?: boolean;
  // When set, the picker only shows teams of this type; the TeamList RPC filters server-side by it.
  // Omit it (the default) to show every team — the original behaviour.
  teamType?: TeamType;
  /**
   * Teams to LEAVE OUT of the list. The from/to case: a transfer's destination picker excludes the
   * source, because a team cannot transfer to itself.
   *
   * ⚠ An exclusion that covers the CURRENT value CLEARS it — `onChange(0n)` fires once. Same
   * contract as ShopSelect's `marketplace` filter, and for the same reason: silently keeping a value
   * the list no longer offers leaves a field showing something the user cannot re-pick, and submits
   * a combination the form has just declared invalid.
   */
  excludeTeamIds?: bigint[];
}

// TeamSelect is the shared team picker (#49): a Chakra Combobox so the list is searchable, matching
// on team NAME or team CODE. Each option renders with TeamItem, so the picker looks like every other
// place a team is shown. The SELECTED team keeps its type: the field reads `name [Selling]` — the
// name with its type badge beside it — rather than collapsing to a bare name (owner). It fetches the
// team list itself and emits the selected team id. Pass the optional teamType prop to restrict the
// list to one team type (filtered server-side by TeamList).
export const description = "Searchable team picker (Chakra Combobox) — search by name or code. Options render with TeamItem; the selected team shows as its name plus its type badge, so the picked team's type stays readable. Emits a team id. Optional teamType prop restricts it to one team type, and excludeTeamIds leaves teams out — an exclusion covering the current value clears it.";

// A Team as TeamItem wants it — the option rows' shape, kept out of the JSX.
function teamItemProps(team: Team) {
  return {
    teamName: team.name,
    teamType: team.type,
    teamId: team.id,
    imageUrl: team.imageUrl,
  };
}

export function TeamSelect({
  value,
  onChange,
  placeholder = "Search team by name or code",
  disabled,
  teamType,
  excludeTeamIds,
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
  const query = useTeams({ teamType, page: 1, pageSize: 200, reference: true });

  // Exclusion is applied to the FETCHED list rather than to the request: `useTeams` is a shared
  // reference cache, and narrowing the query per caller would fragment it into one entry per
  // exclusion set — a pair picker would then miss the cache on every change of its other half.
  const excluded = excludeTeamIds?.length ? excludeTeamIds.map(String) : undefined;
  const teams = useMemo(
    () =>
      excluded
        ? query.data?.teams.filter((team) => !excluded.includes(team.id.toString()))
        : query.data?.teams,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [query.data?.teams, excluded?.join(",")],
  );

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

  // The selected team, read from the FETCHED list rather than from `collection.items` — the
  // collection is what the filter narrows as somebody types, so a search that excludes the current
  // team would otherwise blank the field it is sitting in.
  const selected = value !== undefined ? teams?.find((team) => team.id === value) : undefined;

  // An exclusion that covers the current value CLEARS it — see the prop docs. Guarded on `filled`
  // so a value is never cleared merely because the list has not arrived yet, which would wipe an
  // edit form the instant it mounted.
  useEffect(() => {
    if (!filled || value === undefined || value === 0n) return;
    if (!excluded?.includes(value.toString())) return;

    onChange?.(0n);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filled, value, excluded?.join(",")]);

  // The face of the control is `name [Type]` — the name plus its type badge on ONE line (owner),
  // not the full two-line TeamItem the options use: a field has to stay a field, and a card with an
  // avatar made this control half again as tall as every other filter beside it.
  //
  // A Zag combobox has to keep a real <input> — that is what search types into and what screen
  // readers announce — so this is drawn OVER it, and only while the list is CLOSED. Open it and the
  // plain input comes back, because covering the text somebody is typing is worse than a bare field.
  const [open, setOpen] = useState(false);
  const showSelected = selected !== undefined && !open;

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
      onOpenChange={(e) => setOpen(e.open)}
      data-testid="team-select"
    >
      <Combobox.Control position="relative">
        {/* Stock control height — the selected display is one line, so it fits a normal field. */}
        <Combobox.Input
          placeholder={placeholder}
          // The name is HIDDEN, not removed: the input keeps its value for Zag and for assistive
          // tech while the overlay draws the name and its badge. `caret-color` inherits
          // `currentColor`, so the caret goes with it if the field is focused-but-closed (Escape).
          color={showSelected ? "transparent" : undefined}
        />

        {showSelected && (
          <Box
            // NO background of its own — it sits on whatever the field sits on. An opaque strip
            // would be right on a page and wrong inside a Dialog, where the panel is a different
            // surface in dark mode; the input's text is hidden by its own `color` instead.
            //
            // `pointerEvents="none"` so a click lands on the input underneath and opens the list —
            // this must not become a dead zone in the middle of its own control. It stops short of
            // the indicators (insetEnd) so the ✕ and the chevron stay clickable.
            position="absolute"
            top="1px"
            bottom="1px"
            insetStart="1px"
            insetEnd="16"
            ps="3"
            display="flex"
            alignItems="center"
            gap="2"
            overflow="hidden"
            pointerEvents="none"
            data-testid="team-select-selected"
          >
            {/* The name gives up the room, not the badge: a clipped badge would read as a DIFFERENT
                type, while a clipped name is still recognisably the team. */}
            <Text lineClamp={1} minW="0">
              {selected.name}
            </Text>
            <Badge colorPalette={typePalette(selected.type)} size="sm" flexShrink={0}>
              {typeLabel(selected.type)}
            </Badge>
          </Box>
        )}

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
                    <TeamItem team={teamItemProps(team)} />
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
