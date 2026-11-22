import { Box, Flex, Icon, Stack, Text } from "@chakra-ui/react";
import { useTranslation } from "react-i18next";
import { CornerDownRight } from "lucide-react";

import type { OrderStage, OrderStageId } from "../../../features/orders/stages";

// WHERE THIS ORDER IS ON ITS JOURNEY — a picture instead of a badge to read.
//
// The eleven statuses are not a line: six are the journey (menunggu → diproses → sudah diambil → sudah
// diserahkan → dikirim → selesai) and five are ways OFF it (bermasalah, hilang, retur, retur diterima,
// batal). So the stepper draws the journey as steps, and an off-journey status as a BRANCH hanging from
// the step it left from, in its own colour — "cancelled while waiting" and "lost after it shipped" are
// different stories and should look it.
//
// ⚠ WHERE A BRANCH LEAVES IS INFERRED, and stated here rather than hidden. The order's history would say
// exactly, but a cancel only happens from pending (the status diagram), and lost / return / problem only
// after the handover — so cancel branches from Menunggu and the other four from Dikirim.
//
// ⚠ THE COLOURS ARE CATEGORICAL — the stage hues from `stages.ts`, the one case the theme rule names as
// hue-not-role. Done steps take the current stage's colour so the path reads as one travelled line.

const JOURNEY: OrderStageId[] = ["pending", "processed", "picked", "shipping", "shipped", "completed"];

// ⚠ BELOW 360px A LABEL IS 11px, NOT 12 (backlog #106). At 320 — the narrowest phone
// `nothing-runs-past-a-phones-edge` is judged on — even the one-word labels touched at 12px (*Pending* and
// *Processed* by 1.3px, *Menunggu* and *Diproses* by 0.2px); the owner approved the fix from a mock drawn with 11px
// labels. From 360 up they stay 12. A query, like the shell's own breakpoint: 360px (22.5em) minus a hair.
const NARROW_PHONE = "@media (max-width: 22.4375em)";

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
                {/* ⚠ THE LABEL WRAPS UNDER ITS DOT (backlog #106, owner from his phone: *"This status journey is
                    overlapping each other"*). On one line (`nowrap`) at 390px, *Sudah diambil*, *Sudah diserahkan*
                    and *Dikirim* ran into each other; now a long label breaks into two lines, centred under its dot,
                    so none runs into the next. With room to spare — a desktop — each still reads on one line. Below
                    360px it is 11px (`NARROW_PHONE`). */}
                <Text
                  fontSize="xs"
                  css={{ [NARROW_PHONE]: { fontSize: "0.6875rem" } }}
                  lineHeight="shorter"
                  textAlign="center"
                  lineClamp={2}
                  fontWeight={current ? "bold" : undefined}
                  color={done ? "fg" : "fg.muted"}
                  data-testid={`stage-step-label-${id}`}
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
