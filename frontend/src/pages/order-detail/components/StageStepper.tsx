import { Box, Flex, Icon, Stack, Text } from "@chakra-ui/react";
import { useTranslation } from "react-i18next";
import { CornerDownRight } from "lucide-react";

import type { OrderStage, OrderStageId } from "../../../features/orders/stages";

// WHERE THIS ORDER IS ON ITS JOURNEY — a picture instead of a badge to read.
//
// The owner's eight statuses are not a line: four are the journey (menunggu → diproses → dikirim →
// selesai) and four are ways OFF it (bermasalah, hilang, retur, batal). So the stepper draws the
// journey as steps, and an off-journey status as a BRANCH hanging from the step it left from, in its
// own colour — "cancelled while waiting" and "lost after it shipped" are different stories and should
// look it.
//
// ⚠ WHERE A BRANCH LEAVES IS INFERRED, and stated here rather than hidden. The order's history would say
// exactly, but a cancel can only happen before the parcel ships (the business rule), and lost / return /
// problem only after it — so cancel branches from Menunggu and the other three from Dikirim.
//
// ⚠ THE COLOURS ARE CATEGORICAL — the stage hues from `stages.ts`, the one case the theme rule names as
// hue-not-role. Done steps take the current stage's colour so the path reads as one travelled line.

const JOURNEY: OrderStageId[] = ["pending", "processed", "shipped", "completed"];

/** The forward step an off-journey status leaves from. */
function branchesFrom(id: OrderStageId): OrderStageId {
  return id === "cancel" ? "pending" : "shipped";
}

export function StageStepper({ stage }: { stage: OrderStage | undefined }) {
  const { t } = useTranslation();

  if (!stage) {
    return null;
  }

  const onJourney = JOURNEY.includes(stage.id);
  const reached = JOURNEY.indexOf(onJourney ? stage.id : branchesFrom(stage.id));
  // The travelled path takes the current stage's hue — except when the order left the journey: then
  // the path it did travel is neutral, and the colour belongs to the branch that says where it went.
  const colour = onJourney ? stage.color : "gray";

  return (
    <Stack gap="2" data-testid="stage-stepper" data-stage={stage.id}>
      <Flex align="flex-start" w="full">
        {JOURNEY.map((id, i) => {
          const done = i <= reached;
          const current = onJourney && i === reached;
          const last = i === JOURNEY.length - 1;

          return (
            <Flex key={id} flex={last ? "0 0 auto" : "1"} align="flex-start" minW="0">
              <Stack gap="1" align="center" minW="0">
                <Box
                  boxSize={current ? "4" : "3"}
                  mt={current ? "0" : "0.5"}
                  rounded="full"
                  borderWidth="2px"
                  borderColor={done ? `${colour}.solid` : "border.emphasized"}
                  bg={done ? `${colour}.solid` : "bg"}
                  // The current step carries a ring, so "where it is now" beats "where it has been".
                  boxShadow={current ? `0 0 0 4px var(--chakra-colors-${colour}-subtle)` : undefined}
                  data-testid={`stage-step-${id}`}
                  data-state={current ? "current" : done ? "done" : "todo"}
                />
                <Text
                  fontSize="xs"
                  whiteSpace="nowrap"
                  fontWeight={current ? "bold" : undefined}
                  color={done ? "fg" : "fg.muted"}
                >
                  {t(`orders.stage.${id}`)}
                </Text>
              </Stack>

              {/* The segment to the next step: travelled or not. */}
              {!last && (
                <Box
                  flex="1"
                  h="2px"
                  mt="1.5"
                  mx="1"
                  bg={i < reached ? `${colour}.solid` : "border"}
                />
              )}
            </Flex>
          );
        })}
      </Flex>

      {/* THE BRANCH — an order that left the journey says where it went, in that status's colour. */}
      {!onJourney && (
        <Flex gap="1.5" align="center" color={`${stage.color}.fg`} data-testid="stage-branch">
          <Icon as={CornerDownRight} boxSize="4" />
          <Text fontSize="sm" fontWeight="bold">
            {t(`orders.stage.${stage.id}`)}
          </Text>
          <Text fontSize="xs" color="fg.muted">
            {t("orderDetail.stepper.branchedFrom", { stage: t(`orders.stage.${branchesFrom(stage.id)}`) })}
          </Text>
        </Flex>
      )}
    </Stack>
  );
}
