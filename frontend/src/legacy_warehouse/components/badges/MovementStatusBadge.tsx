import { ToneBadge } from "../../../legacy/components/badges/ToneBadge";
import { statusLabel, type MovementDirection, type MovementStatus } from "../../status";

// ⚠ THE DIRECTION IS A REQUIRED PROP, AND THAT IS THE WHOLE POINT.
//
// The floor app stores one status enum for inbound, returns and outbound, and each reads the same
// key as a different word — `completed` is "received by warehouse" going in and "handed to the
// courier" going out (see status.ts). A badge that took only the status would have to guess, and
// would be wrong on half the screens.
//
// Making the direction mandatory means a caller cannot render one of these without saying which
// question it is answering. It does not FIX the underlying enum — a reference port should not — but
// it makes the ambiguity impossible to render by accident.
export const description =
  "A movement status, labelled for the direction it belongs to. The direction is required: the same status key means 'arrived' on inbound and 'left' on outbound.";

export interface MovementStatusBadgeProps {
  direction: MovementDirection;
  status: MovementStatus;
}

export function MovementStatusBadge({ direction, status }: MovementStatusBadgeProps) {
  const { label, tone } = statusLabel(direction, status);

  return (
    <ToneBadge tone={tone} data-testid="movement-status" data-direction={direction} data-status={status}>
      {label}
    </ToneBadge>
  );
}
