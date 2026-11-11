import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button, HStack, Icon, Popover, Portal, Stack, Text } from "@chakra-ui/react";
import { CircleAlert, CircleCheck } from "lucide-react";

export const description =
  "One line by a form's save button saying whether it is READY (owner: `a-save-button-says-what-it-waits-for`). Ready: a green ✓ and the form's own word — *Siap dibuat*. Not ready: ONE thing still missing — *Belum diisi: gudang* — and, when there are more, *+2 lainnya*, which opens the whole list in a popover. One line either way, so it never pushes the button down. With `onSelect`, each missing thing is a link that takes you to it.";

export interface ReadyLineItem {
  /** Stable — the test id of this part. */
  id: string;
  /** A word or two — *gudang*, *rekening*. */
  label: string;
}

export interface ReadyLineProps {
  /** What still stands between the form and its button, most important first. Empty = ready. */
  missing: ReadyLineItem[];
  /** The ready mark's words — *Siap dibuat*, *Siap disimpan*. */
  readyLabel: string;
  /**
   * Take the person to a missing thing — each label becomes a link (owner, on Terima: the ready line names a line, and a
   * click jumps to it, `the-ready-line-jumps-to-what-it-names`). Left out, the labels are plain text.
   */
  onSelect?: (id: string) => void;
  /**
   * Prefix for the test ids: `<testId>-ready`, `<testId>-missing`, `<testId>-missing-<id>` (the one shown),
   * `<testId>-missing-more`, `<testId>-missing-detail-<id>` (each in the popover).
   */
  testId: string;
}

// ReadyLine — WHY THE BUTTON IS OFF, OR THAT IT IS ON, IN ONE LINE.
//
//   not ready   ⓘ Belum diisi: gudang  +2 lainnya ›    ← the first thing missing; the rest one click away
//   ready       ✓ Siap dibuat                          ← green
//
// A disabled button says nothing about why, and a list of every missing part grew under it — five lines in a fresh
// form. One line says the next thing to do; the detail is there for whoever wants it (owner: *"aku ingin info 1 aja
// ditampilkan yang belum saja, kalau sudah semua berarti ada tanda siap, masih bisa didetailkan"*).
export function ReadyLine({ missing, readyLabel, testId, onSelect }: ReadyLineProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [first, ...rest] = missing;

  // A missing thing's label — a link when the page can take you there, its plain words otherwise.
  const label = (item: ReadyLineItem, id: string, onPicked?: () => void) =>
    onSelect ? (
      <Button
        type="button"
        variant="plain"
        size="xs"
        h="auto"
        minW="0"
        px="0"
        fontSize="xs"
        fontWeight="normal"
        color="inherit"
        textDecoration="underline"
        textDecorationStyle="dotted"
        textUnderlineOffset="2px"
        display="inline"
        verticalAlign="baseline"
        whiteSpace="normal"
        textAlign="start"
        data-testid={id}
        onClick={() => {
          onPicked?.();
          onSelect(item.id);
        }}
      >
        {item.label}
      </Button>
    ) : (
      <span data-testid={id}>{item.label}</span>
    );

  if (!first) {
    return (
      <HStack gap="1.5" color="success.fg" data-testid={`${testId}-ready`}>
        <Icon as={CircleCheck} boxSize="3.5" flexShrink={0} />
        <Text fontSize="xs" fontWeight="bold">
          {readyLabel}
        </Text>
      </HStack>
    );
  }

  return (
    <HStack gap="1.5" color="fg.muted" minW="0" data-testid={`${testId}-missing`}>
      <Icon as={CircleAlert} boxSize="3.5" flexShrink={0} />
      <Text fontSize="xs" lineClamp={1} minW="0">
        {t("readyLine.missing")} {label(first, `${testId}-missing-${first.id}`)}
      </Text>

      {rest.length > 0 && (
        <Popover.Root positioning={{ placement: "top-start" }} open={open} onOpenChange={(e) => setOpen(e.open)}>
          <Popover.Trigger asChild>
            <Button
              type="button"
              variant="plain"
              size="xs"
              h="auto"
              minW="0"
              px="0"
              flexShrink={0}
              fontSize="xs"
              color="primary.fg"
              textDecoration="underline"
              textUnderlineOffset="2px"
              data-testid={`${testId}-missing-more`}
            >
              {t("readyLine.more", { count: rest.length })}
            </Button>
          </Popover.Trigger>
          <Portal>
            <Popover.Positioner>
              <Popover.Content w="auto" maxW="calc(100vw - 2rem)" data-testid={`${testId}-missing-detail`}>
                <Popover.Arrow />
                <Popover.Body py="3" px="4">
                  <Stack gap="1">
                    <Text fontSize="xs" fontWeight="bold" color="fg.label">
                      {t("readyLine.detailTitle")}
                    </Text>
                    {missing.map((m) => (
                      <Text key={m.id} fontSize="xs" data-testid={`${testId}-missing-detail-${m.id}`}>
                        · {label(m, `${testId}-missing-detail-${m.id}-link`, () => setOpen(false))}
                      </Text>
                    ))}
                  </Stack>
                </Popover.Body>
              </Popover.Content>
            </Popover.Positioner>
          </Portal>
        </Popover.Root>
      )}
    </HStack>
  );
}
