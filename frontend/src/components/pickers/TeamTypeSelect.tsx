import { useMemo } from "react";
import { Portal, Select, createListCollection } from "@chakra-ui/react";
import { TeamType } from "../../gen/warehouse/team/v1/team_pb";
import { TeamTypeBadge, teamTypeLabel } from "../badges/TeamTypeBadge";

// The shared display name now lives with the badge (TeamTypeBadge owns how a team type is shown);
// re-exported so the callers that already import it from the picker keep working.
export { teamTypeLabel };

// The team types a caller may CREATE — ROOT is excluded (the root team is seeded, never created).
export const CREATABLE_TEAM_TYPES: TeamType[] = [
  TeamType.WAREHOUSE,
  TeamType.SELLING,
  TeamType.ADMIN,
];

export interface TeamTypeSelectProps {
  value?: TeamType;
  onChange?: (type: TeamType) => void;
  // The types to offer; defaults to the creatable set (Warehouse, Selling, Admin).
  types?: TeamType[];
  placeholder?: string;
  disabled?: boolean;
}

// TeamTypeSelect is the shared team-type picker (#45), built on Chakra's composable Select. It
// emits a TeamType, so callers work in the enum, not strings.
//
// COLOUR-CODED: every option, and the picked value in the closed trigger, is a TeamTypeBadge — the same
// colour the type wears in the team list and the switcher. The badge carries the name, so the colour is
// never the only cue.
export const description =
  "Team-type picker (Chakra Select), colour-coded: each option and the picked value is a TeamTypeBadge. Emits a TeamType; defaults to the creatable set.";

export function TeamTypeSelect({
  value,
  onChange,
  types = CREATABLE_TEAM_TYPES,
  placeholder = "Team type",
  disabled,
}: TeamTypeSelectProps) {
  const collection = useMemo(
    () =>
      createListCollection({ items: types.map((t) => ({ label: teamTypeLabel(t), value: String(t), type: t })) }),
    [types],
  );

  return (
    <Select.Root
      collection={collection}
      disabled={disabled}
      value={value !== undefined ? [String(value)] : []}
      onValueChange={(e) => {
        const picked = e.value[0];
        if (picked !== undefined) {
          onChange?.(Number(picked) as TeamType);
        }
      }}
    >
      <Select.HiddenSelect />

      <Select.Control>
        <Select.Trigger data-testid="team-type-select">
          {/* Read from the Select's own state rather than the `value` prop, so the badge follows the
              pick even when a caller leaves the picker uncontrolled. No pick → the placeholder. */}
          <Select.Context>
            {(select) => {
              const picked = select.value[0];

              return (
                <Select.ValueText placeholder={placeholder}>
                  {picked !== undefined ? <TeamTypeBadge type={Number(picked) as TeamType} /> : undefined}
                </Select.ValueText>
              );
            }}
          </Select.Context>
        </Select.Trigger>
        <Select.IndicatorGroup>
          <Select.Indicator />
        </Select.IndicatorGroup>
      </Select.Control>

      <Portal>
        <Select.Positioner>
          <Select.Content>
            {collection.items.map((item) => (
              <Select.Item item={item} key={item.value}>
                <Select.ItemText>
                  <TeamTypeBadge type={item.type} />
                </Select.ItemText>
                <Select.ItemIndicator />
              </Select.Item>
            ))}
          </Select.Content>
        </Select.Positioner>
      </Portal>
    </Select.Root>
  );
}
