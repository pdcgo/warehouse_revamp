import { Badge } from "@chakra-ui/react";
import { useTranslation } from "react-i18next";

import type { OrderStage } from "../stages";

// One of the owner's eight statuses, named and coloured.
//
// ⚠ IT IS A STAND-IN FOR `OrderStatusBadge`, NOT A RIVAL. That component owns the colour of an order
// status everywhere in the app — and it is keyed on the proto enum, which has no `completed`,
// `problem`, `lost` or `return` to key on, and splits `processed` into three. So four of the eight
// could not be rendered by it at all.
//
// The day the enum migrates to the decided set, this file is deleted and the mapping in `stages.ts`
// moves into `OrderStatusBadge`. A second colour table is exactly the drift that makes two screens
// disagree, so it exists with an end date rather than as a decision.
export function StageBadge({ stage }: { stage: OrderStage }) {
  const { t } = useTranslation();

  return (
    <Badge colorPalette={stage.color} data-testid={`order-stage-${stage.id}`}>
      {t(`orders.stage.${stage.id}`)}
    </Badge>
  );
}
