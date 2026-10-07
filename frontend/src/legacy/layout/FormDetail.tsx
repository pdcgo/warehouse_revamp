import { useState, type ReactNode } from "react";
import { Box, Flex, HStack, Separator, Stack, Text } from "@chakra-ui/react";
import { Button } from "../components/inputs/Button";
import { Card } from "../components/display/Card";
import { PriceText } from "../components/text/PriceText";

export interface FormDetailFigure {
  name: string;
  value: bigint;
}

// FormDetail is the layout for a long form whose RUNNING TOTALS must stay visible while you fill it
// in — an order being built, an invoice being reconciled.
//
// It is responsive in a way that matters rather than decoratively:
//
//   WIDE   — the summary sits in a column beside the form. Both are visible at once, which is what
//            you want when the numbers change with every line you add.
//   NARROW — there is no room for a column, so the totals become a STICKY BAR across the top and the
//            full summary moves behind a button.
//
// The narrow case is the whole reason this is a component. The obvious responsive answer — drop the
// summary below the form — puts the totals off-screen exactly when a person is entering the lines
// that change them, so they scroll down after every row to check. A sticky strip keeps the two or
// three figures that actually matter in view and defers the rest.
export const description =
  "A long form with its running totals kept in view: a side column when there is room, a sticky bar plus a summary button when there is not. Dropping totals below the form is what this exists to avoid.";

export interface FormDetailProps {
  // The two or three figures worth keeping on screen at all times.
  figures: FormDetailFigure[];
  // The full summary. Rendered in the side column when wide, and inside the panel when narrow.
  summary: ReactNode;
  buttonLabel?: string;
  children: ReactNode;
}

export function FormDetail({
  figures,
  summary,
  buttonLabel = "View summary",
  children,
}: FormDetailProps) {
  const [showSummary, setShowSummary] = useState(false);

  return (
    <Flex gap="3" align="flex-start" data-testid="form-detail">
      <Stack flex="1" gap="section" minW="0">
        {/* The sticky strip — narrow viewports only, because on a wide one the side column is
            already showing everything it says. */}
        <Box hideFrom="2xl" position="sticky" top="0" zIndex="docked">
          <Card>
            <HStack gap={{ base: "1.5", md: "6" }} align="center">
              {figures.map((figure, i) => (
                <HStack key={figure.name} gap={{ base: "1.5", md: "6" }}>
                  {i > 0 && <Separator orientation="vertical" height="8" borderStyle="dashed" />}
                  <Stack gap="0">
                    <Text fontSize="xs" color="fg.muted">
                      {figure.name}
                    </Text>
                    <PriceText
                      amount={figure.value}
                      fontWeight="black"
                      colorPalette="brand"
                      color="colorPalette.fg"
                    />
                  </Stack>
                </HStack>
              ))}

              <Button
                tone="info"
                variant="subtle"
                size="xs"
                ms="auto"
                onClick={() => setShowSummary((s) => !s)}
                data-testid="form-detail-toggle"
              >
                {buttonLabel}
              </Button>
            </HStack>
          </Card>

          {showSummary && (
            <Box mt="2" data-testid="form-detail-summary-inline">
              <Card>{summary}</Card>
            </Box>
          )}
        </Box>

        {children}
      </Stack>

      {/* The side column, wide viewports only. Sticky so it stays put as the form scrolls past it. */}
      <Box hideBelow="2xl" width="80" flexShrink="0" position="sticky" top="0" data-testid="form-detail-aside">
        <Card>{summary}</Card>
      </Box>
    </Flex>
  );
}
