import type { ElementType } from "react";
import { Box, Flex, HStack, Icon, Stack, Text } from "@chakra-ui/react";
import { Card } from "../../../legacy/components/display/Card";
import { SkeletonBlock } from "../../../legacy/components/feedback/SkeletonBlock";

// ── TODAY'S MOVEMENT, BROKEN DOWN BY STATE ──────────────────────────────────────────────────────
//
// The dashboard's three cards. Each is one day's flow through one direction, split by the state the
// orders are sitting in, with a share of the total beside each row.
//
// ⚠ CANCELLED IS EXCLUDED FROM THE TOTAL, AND THE CARD SAYS SO.
//
// The original quietly filters cancellations out before summing, and it is right to: the card
// answers "how much work is there today", and a cancelled order is not work. But an unexplained
// total that does not equal the sum of the rows above it reads as a bug, and somebody will
// eventually "fix" it by adding cancellations back in. So the exclusion is stated on the card.
export const description =
  "One day's flow through one direction, split by state, with each state's share. Cancelled rows are excluded from the total — and the card says so, because an unexplained mismatch invites someone to 'fix' it.";

export interface OverviewRow {
  state: string;
  orders: number;
  units: number;
  // Excluded from the total. See above.
  cancelled?: boolean;
}

export interface OverviewCardProps {
  title: string;
  icon?: ElementType;
  rows: OverviewRow[];
  loading?: boolean;
  // e.g. "brand" | "green". The three cards are told apart at a glance by colour on a tablet held
  // at arm's length, which is the only way this screen is ever read.
  colorPalette?: string;
}

export function OverviewCard({ title, icon, rows, loading, colorPalette = "gray" }: OverviewCardProps) {
  const counted = rows.filter((r) => !r.cancelled);
  const totalOrders = counted.reduce((sum, r) => sum + r.orders, 0);
  const totalUnits = counted.reduce((sum, r) => sum + r.units, 0);
  const hasCancelled = rows.some((r) => r.cancelled);

  const share = (orders: number) => (totalOrders ? `${((orders / totalOrders) * 100).toFixed(0)}%` : "0%");

  return (
    <Card p="0" overflow="hidden" data-testid="overview-card" data-title={title}>
      <HStack gap="2" px="3" py="2" bg={`${colorPalette}.solid`} color={`${colorPalette}.contrast`}>
        {icon && <Icon as={icon} boxSize="4" />}
        <Text fontWeight="semibold" fontSize="sm">
          {title}
        </Text>
      </HStack>

      {loading ? (
        <Stack gap="2" p="3">
          <SkeletonBlock lines={4} />
        </Stack>
      ) : (
        <Stack gap="0" divideY="1px">
          {rows.map((row) => (
            <Flex
              key={row.state}
              justify="space-between"
              align="center"
              px="3"
              py="2"
              gap="3"
              opacity={row.cancelled ? 0.6 : 1}
              data-testid="overview-row"
            >
              <Text fontSize="sm" lineClamp={1}>
                {row.state}
              </Text>
              <HStack gap="3" flexShrink={0}>
                <Text fontSize="sm" color="fg.muted">
                  {row.units} pcs
                </Text>
                <Text fontSize="sm" fontWeight="medium" minW="12" textAlign="end">
                  {row.orders}
                </Text>
                <Text fontSize="xs" color="fg.muted" minW="10" textAlign="end">
                  {row.cancelled ? "—" : share(row.orders)}
                </Text>
              </HStack>
            </Flex>
          ))}

          <Flex
            justify="space-between"
            align="center"
            px="3"
            py="2"
            gap="3"
            bg="bg.subtle"
            data-testid="overview-total"
          >
            <Box>
              <Text fontSize="sm" fontWeight="semibold">
                Total
              </Text>
              {hasCancelled && (
                <Text fontSize="xs" color="fg.muted">
                  Cancelled not counted
                </Text>
              )}
            </Box>
            <HStack gap="3" flexShrink={0}>
              <Text fontSize="sm" color="fg.muted">
                {totalUnits} pcs
              </Text>
              <Text fontSize="sm" fontWeight="semibold" minW="12" textAlign="end">
                {totalOrders}
              </Text>
              <Box minW="10" />
            </HStack>
          </Flex>
        </Stack>
      )}
    </Card>
  );
}
