import type { ReactNode } from "react";
import { Box, Flex, Stack, Text } from "@chakra-ui/react";

// A VERTICAL RAIL OF EVENTS, newest on top — a dot per event, the latest filled, joined by a line.
//
// ⚠ ONE SHAPE FOR EVERY "WHAT HAPPENED, IN ORDER" ON THIS PAGE. The status timeline and each shipment
// leg's courier trail are the same kind of thing — a sequence of moments — so they are drawn the same
// way; a reader who has learnt one has learnt both. Before this, the timeline was a plain list of rows
// while the trail was a rail, which made two equivalent facts look unrelated.
//
// ⚠ THE CALLER ORDERS THE ITEMS, newest first. Where the question is "where is it NOW", the answer is
// the top line.

export interface RailItem {
  key: string;
  /** Per-item testid — the status timeline uses the old tab's `order-timeline-<kind>`. */
  testId?: string;
  title: ReactNode;
  meta: ReactNode;
}

export function Rail({ items, testId }: { items: RailItem[]; testId?: string }) {
  return (
    <Stack gap="0" data-testid={testId}>
      {items.map((item, i) => (
        <Flex key={item.key} gap="3" align="stretch" data-testid={item.testId}>
          <Stack gap="0" align="center" pt="1.5">
            <Box
              boxSize="2.5"
              rounded="full"
              bg={i === 0 ? "brand.solid" : "border.emphasized"}
              flexShrink="0"
            />
            {i < items.length - 1 && <Box w="1px" flex="1" bg="border" />}
          </Stack>

          <Stack gap="0" pb="3" minW="0">
            <Text fontWeight={i === 0 ? "bold" : undefined}>{item.title}</Text>
            <Text fontSize="xs" color="fg.muted">
              {item.meta}
            </Text>
          </Stack>
        </Flex>
      ))}
    </Stack>
  );
}
