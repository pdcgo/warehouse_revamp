import { useMemo } from "react";
import { Select } from "./ui/Select";
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
export const description = "Team-type picker (Select). Emits a TeamType; defaults to the creatable set.";

export function TeamTypeSelect({
  value,
  onChange,
  types = CREATABLE_TEAM_TYPES,
  placeholder = "Team type",
  disabled,
}: TeamTypeSelectProps) {
  const options = useMemo(
    () => types.map((t) => ({ label: teamTypeLabel(t), value: String(t) })),
    [types],
  );

  return (
    <Select
      data-testid="team-type-select"
      disabled={disabled}
      value={value !== undefined ? String(value) : ""}
      onChange={(e) => {
        if (e.target.value !== "") onChange?.(Number(e.target.value) as TeamType);
      }}
    >
      <option value="" disabled>
        {placeholder}
      </option>
      {options.map((item) => (
        <option key={item.value} value={item.value}>
          {item.label}
        </option>
      ))}
    </Select>
  );
}
