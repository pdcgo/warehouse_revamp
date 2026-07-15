import { useMemo } from "react";
import { Portal, Select, createListCollection } from "@chakra-ui/react";
import { TeamType } from "../gen/warehouse/team/v1/team_pb";

// teamTypeLabel is the shared display name for a team type — used by the picker below and by
// callers that show a locked/read-only type.
export function teamTypeLabel(type: TeamType): string {
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
      return "Unspecified";
  }
}

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
export function TeamTypeSelect({
  value,
  onChange,
  types = CREATABLE_TEAM_TYPES,
  placeholder = "Team type",
  disabled,
}: TeamTypeSelectProps) {
  const collection = useMemo(
    () =>
      createListCollection({ items: types.map((t) => ({ label: teamTypeLabel(t), value: String(t) })) }),
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
          <Select.ValueText placeholder={placeholder} />
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
                <Select.ItemText>{item.label}</Select.ItemText>
                <Select.ItemIndicator />
              </Select.Item>
            ))}
          </Select.Content>
        </Select.Positioner>
      </Portal>
    </Select.Root>
  );
}
