import { HStack, Icon } from "@chakra-ui/react";
import { ArrowRight } from "lucide-react";
import { TeamType } from "../../../gen/warehouse/team/v1/team_pb";
import { TeamTypeSelect } from "../../../components/pickers/TeamTypeSelect";

// TeamTypePairSelect picks a directed pair of team KINDS — "selling → warehouse".
//
// Where TeamPairSelect names two specific teams, this names two CLASSES of team, and it is used
// where the question is about a flow rather than an instance: which kinds of movement to report on,
// which direction of transfer a rule applies to.
//
// ⚠ Unlike the team pair, the two ends here MAY be the same, and that is not a mistake to prevent.
// Warehouse-to-warehouse is a real and common flow; so is selling-to-selling. Excluding the source
// from the destination — the rule that makes TeamPairSelect correct — would make this one wrong, and
// the two components look similar enough that it is worth saying so out loud.
export const description =
  "A directed pair of team KINDS (selling → warehouse), for describing a flow rather than an instance. Both ends may be the same kind — unlike TeamPairSelect, that is a real flow, not a mistake.";

export interface TeamTypePairSelectProps {
  fromType?: TeamType;
  toType?: TeamType;
  onFromChange?(type: TeamType): void;
  onToChange?(type: TeamType): void;
  types?: TeamType[];
  disabled?: boolean;
}

export function TeamTypePairSelect({
  fromType,
  toType,
  onFromChange,
  onToChange,
  types,
  disabled,
}: TeamTypePairSelectProps) {
  return (
    <HStack gap="2" align="center" wrap="wrap" data-testid="team-type-pair-select">
      <HStack flex="1" minW="36" data-testid="team-type-pair-from">
        <TeamTypeSelect
          value={fromType}
          onChange={onFromChange}
          types={types}
          placeholder="From kind"
          disabled={disabled}
        />
      </HStack>

      <Icon as={ArrowRight} boxSize="4" color="fg.muted" flexShrink="0" aria-label="to" />

      <HStack flex="1" minW="36" data-testid="team-type-pair-to">
        <TeamTypeSelect
          value={toType}
          onChange={onToChange}
          types={types}
          placeholder="To kind"
          disabled={disabled}
        />
      </HStack>
    </HStack>
  );
}
