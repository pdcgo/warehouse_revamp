import type { ElementType, ReactNode } from "react";
import { Box, Flex, HStack, Icon, Text } from "@chakra-ui/react";

// Every floor screen opens the same way: an icon, the screen's name, and whatever actions belong to
// the screen as a whole. It is a component rather than a copied `<h2>` for the usual reason — the
// original writes it out per screen and they have already drifted, one bold and one semibold, one
// with the icon and one without.
//
// ⚠ IT IS DELIBERATELY SHALLOW. On a trolley-mounted tablet the header is pure overhead: every pixel
// it takes is a row the picker cannot see. It gets one line and no subtitle — if a screen needs
// explaining, it needs explaining somewhere that is not above the data on a 10-inch screen.
export const description =
  "The one-line screen header every floor screen opens with — icon, name, and screen-level actions. Deliberately shallow: header height is rows the picker cannot see.";

export interface ScreenHeaderProps {
  icon?: ElementType;
  title: string;
  // Screen-level actions — export, print, add. Row-level actions belong in the row.
  actions?: ReactNode;
}

export function ScreenHeader({ icon, title, actions }: ScreenHeaderProps) {
  return (
    <Flex
      justify="space-between"
      align="center"
      gap="3"
      wrap="wrap"
      data-testid="screen-header"
      data-screen={title}
    >
      <HStack gap="2" minW="0">
        {icon && <Icon as={icon} boxSize="5" color="fg.muted" />}
        <Text fontWeight="semibold" lineClamp={1}>
          {title}
        </Text>
      </HStack>
      {actions && <Box data-testid="screen-actions">{actions}</Box>}
    </Flex>
  );
}
