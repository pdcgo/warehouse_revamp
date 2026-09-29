import { Box, Button, Collapsible, Flex, Icon, SimpleGrid, Stack, Text } from "@chakra-ui/react";
import { useTranslation } from "react-i18next";
import { ChevronDown, TriangleAlert } from "lucide-react";

import type { PendingList } from "./registry";
import { droppedParts } from "./registry";

// WHAT THIS SCREEN CANNOT DO, SAID ONCE, AT THE TOP — and FOLDED AWAY until somebody asks (owner).
//
// ⚠ THE COUNT AND THE CONSEQUENCE STAY VISIBLE; THE LIST DOES NOT. A dozen rows above a form is a
// wall between the person and the work every single time they open the screen — and they are read
// once, not daily. What has to survive the fold is the two things somebody who has never seen the
// page needs: that parts of it are unfinished, and that what they type into those parts is not sent.
//
// The list is what the numbers on the controls point INTO, so opening it is one click from anywhere.
//
// ⚠ IT IS GENERATED from the screen's own list, never written out. A hand-written summary is one
// that says eleven while the screen carries fourteen, and the reader cannot tell which is right.
export function NotImplementedSummary<Id extends string>({ list }: { list: PendingList<Id> }) {
  const { t } = useTranslation();
  const dropped = droppedParts(list);

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
                <Text fontWeight="bold">
                  {t("pending.title", { count: list.parts.length })}
                </Text>
                {/* The sentence that matters, named part by part: a person who typed a deadline
                    needs to know THAT field is one of the ones that disappears. */}
                {dropped.length > 0 && (
                  <Text fontSize="sm" color="fg.muted">
                    {t("pending.lead", {
                      count: dropped.length,
                      parts: dropped.map((p) => t(`${list.ns}.pending.${p.id}.label`)).join(", "),
                    })}
                  </Text>
                )}
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
                {t("pending.toggle", { count: list.parts.length })}
              </Button>
            </Collapsible.Trigger>
          </Flex>

          <Collapsible.Content>
            {/* Two columns from `md`: a dozen rows down one side of a form is a wall the eye skips.
                The numbering runs in list order, which is the order the controls appear in. */}
            <SimpleGrid columns={{ base: 1, md: 2 }} gap="2" columnGap="card" pt="1">
              {list.parts.map((part, i) => (
                <Flex key={part.id} gap="2" align="baseline" data-testid={`pending-row-${part.id}`}>
                  {/* THE NUMBER, in a fixed-width column so the labels line up and the eye can run
                      down the digits looking for the one it saw on a control. */}
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
                      {t(`${list.ns}.pending.${part.id}.label`)}
                    </Text>
                    {" — "}
                    <Text as="span" color="fg.muted">
                      {t(`${list.ns}.pending.${part.id}.reason`)}
                    </Text>{" "}
                    <Text as="span" color="fg.subtle">
                      {t(`pending.tag.${part.kind}`)}
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
