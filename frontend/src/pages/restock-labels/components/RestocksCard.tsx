import type React from "react";
import { useTranslation } from "react-i18next";
import { Card, Flex, Icon, IconButton, Spinner, Stack, Text } from "@chakra-ui/react";
import { X } from "lucide-react";

import { rpcError } from "../../../api/clients";
import { RestockStatusBadge } from "../../../components/badges/RestockStatusBadge";
import { NotImplemented } from "../../../features/pending/NotImplemented";
import { LABELS_MAX_RESTOCKS } from "../../../features/restock/labelsPath";
import { RESTOCK_LABELS_PENDING } from "../pending";
import type { LabelSet } from "../labelSets";
import { AddRestockSelect } from "./AddRestockSelect";

// THE RESTOCKS ON THIS PRINT (owner: *"halaman labels bisa print banyak restock sekaligus"*,
// labels-print-several-restocks) — one row each: its number and status, its resi, and how many of its labels print;
// ✕ takes it off, and *Tambah Restok* puts another on. The last one stays: a print of nothing is not a page.
//
// A ROW TAKES YOU TO ITS LABELS (owner: *"restock navigasi ke labelnya"*, labels-a-restock-jumps-to-its-labels) — a
// click on a restock scrolls Yang Dicetak to its group, which blinks where it lands (a-nav-jump-blinks-where-it-lands).
//
//   ┌ Restok · 2 ─────────────────────────────┐
//   │ #503 [Diterima]  SCP5544332211   27 label ✕ │
//   │ #502 [Tiba]      JNT9988776655   17 label ✕ │
//   │ [ Tambah restok — no., resi, SKU     ⌄ ]    │
//   └─────────────────────────────────────────┘
export function RestocksCard({
  teamId,
  sets,
  printedOf,
  onAdd,
  onRemove,
  onJump,
}: {
  teamId: bigint | undefined;
  sets: LabelSet[];
  /** How many of a restock's labels the run holds — its counts summed. */
  printedOf: (id: bigint) => number;
  onAdd: (id: bigint) => void;
  onRemove: (id: bigint) => void;
  /** Take the page to this restock's labels in Yang Dicetak. */
  onJump: (id: bigint) => void;
}) {
  const { t } = useTranslation();
  const only = sets.length === 1;
  const full = sets.length >= LABELS_MAX_RESTOCKS;

  return (
    // Over the Pratinjau where there is room; first of all on a phone (the-label-settings-scroll-inside-their-card).
    <Card.Root className="no-print" data-testid="labels-restocks">
      <Card.Body>
        <Stack gap="card">
          <Flex align="center" gap="2">
            <Text fontWeight="bold">{t("restock.labels.restocks.title")}</Text>
            <Text fontSize="xs" color="fg.muted">
              {sets.length}
            </Text>
            {/* Each restock here is its own read — marked until several can be read at once (pending.ts). */}
            <NotImplemented list={RESTOCK_LABELS_PENDING} id="byIds" />
          </Flex>

          {/* A day's deliveries can be many: past a handful the rows scroll in place, the bar on the card's edge, so the
              Pratinjau under the card is not pushed off the screen. */}
          <Stack
            gap="1"
            layerStyle="scrollList"
            maxH="15rem"
            me="calc(var(--card-padding) * -1)"
            pe="var(--card-padding)"
            data-testid="labels-restocks-rows"
          >
            {sets.map((set) => {
              const id = set.id.toString();
              // A restock with labels takes you to them (labels-a-restock-jumps-to-its-labels); one without has none.
              const jumps = set.state === "ready";
              const jump = () => onJump(set.id);

              return (
                // The restock's part of the row takes you to its labels; ✕ stands beside it, never inside it.
                <Flex key={id} align="center" gap="1" minH="8" data-testid={`labels-restock-${id}`}>
                  <Flex
                    flex="1"
                    minW="0"
                    align="center"
                    gap="2"
                    minH="8"
                    ms="-2"
                    px="2"
                    borderRadius="md"
                    data-testid={`labels-restock-${id}-jump`}
                    {...(jumps
                      ? {
                          role: "button",
                          tabIndex: 0,
                          cursor: "pointer",
                          title: t("restock.labels.restocks.jump", { id }),
                          "aria-label": t("restock.labels.restocks.jump", { id }),
                          // It lights up under the pointer, as a row that opens something does (a-table-row-lights-up).
                          _hover: { bg: "bg.muted" },
                          onClick: jump,
                          onKeyDown: (e: React.KeyboardEvent<HTMLDivElement>) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              jump();
                            }
                          },
                        }
                      : {})}
                  >
                    <Text fontWeight="bold" flexShrink={0}>
                      #{id}
                    </Text>
                    {set.restock && <RestockStatusBadge status={set.restock.status} />}
                    <Text fontSize="xs" color="fg.muted" flex="1" minW="0" truncate title={set.restock?.receipt}>
                      {set.restock?.receipt}
                    </Text>
                    <Text
                      fontSize="xs"
                      flexShrink={0}
                      color={set.state === "ready" ? "fg" : set.state === "loading" ? "fg.muted" : "warning.fg"}
                      data-testid={`labels-restock-${id}-count`}
                    >
                      {set.state === "loading" ? (
                        <Spinner size="xs" />
                      ) : set.state === "ready" ? (
                        t("restock.labels.restocks.labelCount", { count: printedOf(set.id) })
                      ) : set.state === "notPrintable" ? (
                        t("restock.labels.restocks.notPrintable")
                      ) : set.error ? (
                        rpcError(set.error)
                      ) : (
                        t("restock.labels.notFound")
                      )}
                    </Text>
                  </Flex>
                  <IconButton
                    size="xs"
                    variant="ghost"
                    disabled={only}
                    aria-label={t("restock.labels.restocks.remove", { id })}
                    title={t("restock.labels.restocks.remove", { id })}
                    onClick={() => onRemove(set.id)}
                    data-testid={`labels-restock-${id}-remove`}
                  >
                    <Icon as={X} boxSize="4" />
                  </IconButton>
                </Flex>
              );
            })}
          </Stack>

          {/* AT MOST 50 A PRINT (at-most-fifty-restocks-a-print) — at the limit the box is off, and says why. */}
          <Stack gap="1">
            <AddRestockSelect teamId={teamId} taken={sets.map((s) => s.id)} onAdd={onAdd} disabled={full} />
            {full && (
              <Text fontSize="xs" color="fg.muted" data-testid="labels-restocks-full">
                {t("restock.labels.restocks.full", { max: LABELS_MAX_RESTOCKS })}
              </Text>
            )}
          </Stack>
        </Stack>
      </Card.Body>
    </Card.Root>
  );
}
