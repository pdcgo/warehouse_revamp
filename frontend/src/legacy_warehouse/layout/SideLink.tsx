import { Badge, Box, HStack, Icon, Text } from "@chakra-ui/react";
import { Link } from "react-router-dom";
import type { FloorNavItem } from "./nav";

// One row of the floor sidebar.
//
// Two things ride on it beyond the name, and both are load-bearing:
//
//   badge         — how many things on that screen need attention. Capped at "99+", because past a
//                   hundred the exact number changes nothing about what you do next, and a
//                   four-digit badge pushes the name out of the row.
//   experimental  — marks a rewrite running beside the screen it replaces. See nav.ts for why two
//                   items are allowed to share a name, and why that is a hazard worth naming.
export interface SideLinkProps {
  item: FloorNavItem;
  current?: boolean;
  onNavigate?(): void;
}

export function SideLink({ item, current, onNavigate }: SideLinkProps) {
  return (
    <HStack
      as={Link}
      // @ts-expect-error Chakra's polymorphic `as` does not thread react-router's props through.
      to={item.href}
      onClick={onNavigate}
      gap="3"
      px="2.5"
      py="2"
      borderRadius="md"
      fontSize="sm"
      bg={current ? "colorPalette.solid" : undefined}
      color={current ? "colorPalette.contrast" : "fg"}
      colorPalette="brand"
      _hover={current ? undefined : { bg: "bg.muted" }}
      aria-current={current ? "page" : undefined}
      data-testid={`side-link-${item.key}`}
    >
      <Icon as={item.icon} boxSize="4" />
      <Text flex="1" lineClamp={1}>
        {item.name}
      </Text>

      {item.badge !== undefined && item.badge > 0 && (
        <Badge colorPalette="red" variant="solid" borderRadius="full" data-testid="side-link-badge">
          {item.badge > 99 ? "99+" : item.badge}
        </Badge>
      )}

      {item.experimental && (
        <Box
          fontSize="2xs"
          fontWeight="bold"
          px="1"
          borderRadius="sm"
          bg={current ? "colorPalette.contrast" : "colorPalette.solid"}
          color={current ? "colorPalette.solid" : "colorPalette.contrast"}
          data-testid="side-link-exp"
        >
          EXP
        </Box>
      )}
    </HStack>
  );
}
