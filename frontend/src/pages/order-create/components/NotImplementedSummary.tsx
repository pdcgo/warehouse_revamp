import { Box, Button, Collapsible, Flex, Icon, SimpleGrid, Stack, Text } from "@chakra-ui/react";
import { useTranslation } from "react-i18next";
import { ChevronDown, TriangleAlert } from "lucide-react";

import { PENDING, PENDING_DROPPED } from "../pending";

// WHAT THIS SCREEN CANNOT DO, SAID ONCE, AT THE TOP — and FOLDED AWAY until somebody asks (owner).
//
// ⚠ THE COUNT AND THE CONSEQUENCE STAY VISIBLE; THE LIST DOES NOT. Fourteen rows above a form is a
// wall between the person and the work every single time they open the screen — and they are read
// once, not daily. What has to survive the fold is the two things somebody who has never seen this
// page needs: that parts of it are unfinished, and that what they type into those parts is not sent.
//
// The list is what the numbers on the cards point INTO, so opening it is one click from anywhere:
// a mark reading "⚠ 7" is a question, and this is where the answer is.
//
// ⚠ IT IS GENERATED, never written out. A hand-written list is a list that says thirteen while the
// screen carries fourteen, and the reader has no way to tell which is right.
//
// It is NOT an Alert: `Alert` carries a status colour, and every status colour on this screen is
// already spoken for by something true about the order. This is chrome about the BUILD — gray,
// dashed, and unmistakably not part of the form.
export function NotImplementedSummary() {
  const { t } = useTranslation();

  return (
    <Collapsible.Root defaultOpen={false}>
      <Box
        borderWidth="1px"
        borderStyle="dashed"
        borderColor="border"
        borderRadius="l2"
        bg="bg.subtle"
        p="card"
        data-testid="not-implemented-summary"
      >
        <Stack gap="card">
          <Flex gap="2" align="start" justify="space-between" wrap="wrap">
            <Flex gap="2" align="start" minW="0">
              <Icon as={TriangleAlert} boxSize="4" color="fg.muted" mt="0.5" />
              <Stack gap="1" minW="0">
                <Text fontWeight="bold">{t("orderForm.pendingTitle", { count: PENDING.length })}</Text>
                {/* The sentence that matters, named part by part: a person who typed a deadline needs
                    to know THAT field is one of the ones that disappears. */}
                <Text fontSize="sm" color="fg.muted">
                  {t("orderForm.pendingLead", {
                    count: PENDING_DROPPED.length,
                    parts: PENDING_DROPPED.map((p) => t(`orderForm.pending.${p.id}.label`)).join(", "),
                  })}
                </Text>
              </Stack>
            </Flex>

            <Collapsible.Trigger asChild>
              <Button
                type="button"
                size="xs"
                variant="outline"
                flexShrink="0"
                data-testid="not-implemented-toggle"
              >
                {/* The chevron turns with the state, so the control says which way it goes without a
                    second label to keep in sync. */}
                <Icon
                  as={ChevronDown}
                  boxSize="4"
                  transition="transform 0.15s"
                  css={{ "[data-state=open] &": { transform: "rotate(180deg)" } }}
                />
                {t("orderForm.pendingToggle", { count: PENDING.length })}
              </Button>
            </Collapsible.Trigger>
          </Flex>

          <Collapsible.Content>
            {/* Two columns from `md`: fourteen rows down one side of a form is a wall the eye skips.
                The numbering runs in source order, which is the order the cards appear in. */}
            <SimpleGrid columns={{ base: 1, md: 2 }} gap="2" columnGap="card" pt="1">
              {PENDING.map((part, i) => (
                <Flex key={part.id} gap="2" align="baseline" data-testid={`pending-row-${part.id}`}>
                  {/* THE NUMBER, in a fixed-width column so the labels line up and the eye can run
                      down the digits looking for the one it saw on a card. */}
                  <Text
                    fontSize="sm"
                    fontWeight="bold"
                    color="fg.muted"
                    minW="5"
                    textAlign="end"
                    flexShrink="0"
                  >
                    {i + 1}.
                  </Text>
                  <Text fontSize="sm" minW="0">
                    <Text as="span" fontWeight="bold">
                      {t(`orderForm.pending.${part.id}.label`)}
                    </Text>
                    {" — "}
                    <Text as="span" color="fg.muted">
                      {t(`orderForm.pending.${part.id}.reason`)}
                    </Text>{" "}
                    <Text as="span" color="fg.subtle">
                      {t(`orderForm.tag.${part.kind}`)}
                    </Text>
                  </Text>
                </Flex>
              ))}
            </SimpleGrid>
          </Collapsible.Content>
        </Stack>
      </Box>
    </Collapsible.Root>
  );
}
