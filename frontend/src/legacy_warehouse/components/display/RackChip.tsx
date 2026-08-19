import { Badge, HStack, Icon, Text } from "@chakra-ui/react";
import { MapPin } from "lucide-react";

// ── A PLACE IS NOT AN ABSENCE ───────────────────────────────────────────────────────────────────
//
// A rack chip says where a thing physically is. The case that matters is the one with no rack, and
// the temptation is to render nothing — a blank cell.
//
// That is wrong, and this repo has already learned it once: `RackSelect` keeps "unplaced"
// SELECTABLE while its placeholder stays disabled (#136/#139), because stock sitting on the floor
// unshelved is a REAL and actionable state, not missing data. A blank cell reads as "we did not
// load it"; "Unplaced" reads as "go and shelve it".
//
// The same rule applies to displaying it, so the chip renders the absence explicitly and in a tone
// that says something is outstanding.
export const description =
  "Where stock physically is. Renders 'Unplaced' explicitly rather than a blank — unshelved stock is a real, actionable state, not missing data.";

export interface RackChipProps {
  // The rack's code — the label a picker reads off the shelf. Absent means genuinely not shelved.
  rack?: string | null;
  // How many units sit there. A rack chip without a count answers half the question.
  count?: number;
}

export function RackChip({ rack, count }: RackChipProps) {
  const unplaced = !rack;

  return (
    <Badge
      colorPalette={unplaced ? "orange" : "gray"}
      variant="subtle"
      data-testid="rack-chip"
      data-unplaced={unplaced ? "true" : "false"}
    >
      <HStack gap="1">
        <Icon as={MapPin} boxSize="3" />
        <Text fontFamily={unplaced ? undefined : "mono"}>{rack || "Unplaced"}</Text>
        {count !== undefined && (
          <Text color="fg.muted" fontWeight="normal">
            × {count}
          </Text>
        )}
      </HStack>
    </Badge>
  );
}
