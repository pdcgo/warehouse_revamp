import { HStack, Icon } from "@chakra-ui/react";
import { ArrowRight } from "lucide-react";
import { TeamType } from "../../../gen/warehouse/team/v1/team_pb";
import { TeamSelect } from "../../../components/teams/TeamSelect";

// TeamPairSelect picks a DIRECTED pair of teams — a source and a destination — as one control.
//
// It exists because the pair has a rule that two independent pickers cannot enforce: THE SAME TEAM
// CANNOT BE BOTH ENDS. A transfer from Gudang Utara to Gudang Utara is not a transfer, and left to
// two separate TeamSelects the form only discovers that at submit time, from the server, after the
// operator has filled in the rest of it.
//
// So the destination picker excludes whatever the source is set to. Picking a source that is already
// the destination clears the destination (TeamSelect's exclusion contract) — which is the right
// outcome: the field the user just contradicted is the one that gives way, not the one they were
// deliberately setting.
//
// The arrow between them is not decoration either. "From" and "To" as two adjacent dropdowns are
// genuinely ambiguous about direction at a glance, and direction is the whole meaning of a transfer.
export const description =
  "A directed source→destination team pair as one control. The destination excludes the source, so a transfer to itself is impossible to express rather than rejected at submit time.";

export interface TeamPairSelectProps {
  fromId?: bigint;
  toId?: bigint;
  onFromChange?(teamId: bigint): void;
  onToChange?(teamId: bigint): void;
  // Restrict BOTH ends to one kind of team — stock transfers are warehouse-to-warehouse.
  teamType?: TeamType;
  fromPlaceholder?: string;
  toPlaceholder?: string;
  disabled?: boolean;
}

export function TeamPairSelect({
  fromId,
  toId,
  onFromChange,
  onToChange,
  teamType,
  fromPlaceholder = "From team",
  toPlaceholder = "To team",
  disabled,
}: TeamPairSelectProps) {
  return (
    <HStack gap="2" align="center" wrap="wrap" data-testid="team-pair-select">
      <HStack flex="1" minW="44" data-testid="team-pair-from">
        <TeamSelect
          value={fromId}
          onChange={onFromChange}
          teamType={teamType}
          placeholder={fromPlaceholder}
          disabled={disabled}
        />
      </HStack>

      <Icon as={ArrowRight} boxSize="4" color="fg.muted" flexShrink="0" aria-label="to" />

      <HStack flex="1" minW="44" data-testid="team-pair-to">
        <TeamSelect
          value={toId}
          onChange={onToChange}
          teamType={teamType}
          // The rule, in one prop.
          excludeTeamIds={fromId && fromId !== 0n ? [fromId] : undefined}
          placeholder={toPlaceholder}
          disabled={disabled}
        />
      </HStack>
    </HStack>
  );
}
