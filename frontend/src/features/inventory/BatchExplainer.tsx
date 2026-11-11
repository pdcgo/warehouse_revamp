import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Box, Button, Flex, Icon, List, Portal, Stack, Text, Tooltip } from "@chakra-ui/react";
import { ArrowRight, CircleHelp } from "lucide-react";

export const description =
  "What a batch is, said on the screens that list batches — \"Apa itu batch?\" with its ? icon, the answer in a TOOLTIP: stock that came in together at one price, one per product of an accepted restock (and from returns, transfers in and counts), priced at the landed cost, taken oldest first, a record of value — not of place — and an example. Hover or focus opens it; a click or a tap opens and shuts it, so a phone reads it too.";

// WHAT A BATCH IS, ON THE SCREEN (owner: *"inisiasi dan kasih keterangan batch itu apa"*, then *"penjelasan batch
// jangan collapse, tooltips?"*, a-batch-says-what-it-is). The word is the warehouse's own, and it is not obvious: two
// batches of one restock read alike, a batch is not a rack, and the oldest going first is why what leaves costs what it
// does. So the screens that list batches carry the answer — in a tooltip on "Apa itu batch?", never a panel that pushes
// the page down.
//
//   ⓘ Apa itu batch?
//     ┌──────────────────────────────────────────────┐
//     │ Batch adalah stok yang masuk bersamaan …      │
//     │ • dibuat saat restok diterima …               │
//     │ • harganya …  • terlama dulu …  • nilai, …    │
//     │ [Restok #503] → [Beras · 7] [Teh · 20]        │
//     └──────────────────────────────────────────────┘
//
// Hover or focus opens it, as every tooltip; a CLICK OR A TAP opens and shuts it too — a phone has no hover, and a
// tooltip that only answers a pointer is one a phone never shows.
//
// The rules it states are the business record's: one-batch-per-line, unit-price-is-line-price-plus-costs-per-unit, and
// the batch ledger's oldest-first (docs/business/inventory/). It explains; it decides nothing.
export function BatchExplainer({ testId = "batch-explainer" }: { testId?: string }) {
  const { t } = useTranslation();
  const k = (key: string) => t(`batches.explainer.${key}`);
  const [open, setOpen] = useState(false);

  return (
    <Tooltip.Root
      open={open}
      onOpenChange={(e) => setOpen(e.open)}
      openDelay={150}
      closeDelay={80}
      closeOnClick={false}
      interactive
      positioning={{ placement: "bottom-start" }}
    >
      <Tooltip.Trigger asChild>
        <Button
          size="xs"
          variant="ghost"
          colorPalette="gray"
          color="fg.muted"
          px="1"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
          data-testid={`${testId}-toggle`}
        >
          <Icon as={CircleHelp} boxSize="4" />
          <Box as="span" textDecoration="underline dotted" textUnderlineOffset="3px">
            {k("toggle")}
          </Box>
        </Button>
      </Tooltip.Trigger>

      <Portal>
        <Tooltip.Positioner>
          {/* LIGHT, NOT BLACK (owner: *"jangan hitam"*) — the panel's own ground and ink, a thin line and a shadow, as a
              popover is drawn; the default tooltip's black was a lot of dark for a paragraph. */}
          <Tooltip.Content
            maxW="min(26rem, calc(100vw - 2rem))"
            px="3"
            py="2.5"
            bg="bg.panel"
            color="fg"
            borderWidth="1px"
            borderColor="border"
            borderRadius="md"
            boxShadow="lg"
            css={{ "--tooltip-bg": "colors.bg.panel" }}
            data-testid={`${testId}-panel`}
          >
            <Stack gap="2" fontSize="xs" lineHeight="1.5">
              <Text fontWeight="bold">{k("lead")}</Text>

              <List.Root gap="1" ps="4" color="fg.muted">
                <List.Item>{k("made")}</List.Item>
                <List.Item>{k("price")}</List.Item>
                <List.Item>{k("oldestFirst")}</List.Item>
                <List.Item>{k("notPlace")}</List.Item>
              </List.Root>

              {/* AN EXAMPLE, drawn as the restock becomes its batches. */}
              <Flex align="center" gap="1.5" wrap="wrap" data-testid={`${testId}-example`}>
                <Box px="1.5" borderRadius="sm" bg="bg.muted" fontWeight="bold">
                  {k("exampleRestock")}
                </Box>
                <Icon as={ArrowRight} boxSize="3.5" color="fg.muted" />
                <Box px="1.5" borderRadius="sm" borderWidth="1px" borderColor="border">
                  {k("exampleRice")}
                </Box>
                <Box px="1.5" borderRadius="sm" borderWidth="1px" borderColor="border">
                  {k("exampleTea")}
                </Box>
                <Text color="fg.muted">{k("exampleNote")}</Text>
              </Flex>
            </Stack>
          </Tooltip.Content>
        </Tooltip.Positioner>
      </Portal>
    </Tooltip.Root>
  );
}
