import { HStack, Icon, Tag } from "@chakra-ui/react";
import { Lock } from "lucide-react";
import { useTranslation } from "react-i18next";

import type { RestockTag } from "./restockTags";

// A RESTOCK'S TAG AS A CHIP (backlog #87, live) — Chakra's Tag, the chip the Analytic composer's metrics already are
// (no new design language). A CUSTOM tag is the plain grey chip; a SYSTEM tag is told apart at a glance — its own tint
// and a lock before its name — because nobody but an admin and the app's own tasks may change it
// (custom-tags-are-shared-system-tags-are-the-admins-and-the-apps). A long name is cut at the chip's width and said whole
// on hover.

export const description =
  "A restock's tag as a chip (Chakra Tag): custom = grey; system = its own tint with a lock before the name. Cuts a long name at its width, whole on hover. With `onRemove` it carries a ×.";

export function RestockTagChip({
  tag,
  maxW = "10rem",
  onRemove,
  testId,
}: {
  tag: RestockTag;
  maxW?: string;
  /** Given only to someone who may take this tag off — a custom tag for a writer, any tag for an admin. */
  onRemove?: () => void;
  testId?: string;
}) {
  const { t } = useTranslation();
  const system = tag.type === "SYSTEM";

  return (
    <Tag.Root
      size="md"
      variant="surface"
      colorPalette={system ? "purple" : "gray"}
      maxW={maxW}
      flexShrink={0}
      title={system ? `${tag.name} — ${t("restock.tags.system")}` : tag.name}
      data-testid={testId}
      data-tag-type={system ? "system" : "custom"}
    >
      {system && (
        <Tag.StartElement>
          <Icon as={Lock} aria-label={t("restock.tags.system")} data-testid={testId ? `${testId}-lock` : undefined} />
        </Tag.StartElement>
      )}
      <Tag.Label>{tag.name}</Tag.Label>
      {onRemove && (
        <Tag.EndElement>
          <Tag.CloseTrigger
            aria-label={t("restock.tags.remove", { name: tag.name })}
            onClick={(e) => {
              e.stopPropagation();
              onRemove();
            }}
            data-testid={testId ? `${testId}-remove` : undefined}
          />
        </Tag.EndElement>
      )}
    </Tag.Root>
  );
}

/**
 * A ROW'S TAGS — the first `max` chips and a `+N` for the rest, whose hover names them. In a table cell they wrap inside
 * 10.5rem — two lines at most, as every other cell (one-context-per-column-and-never-three-lines) — so the column stays
 * narrow; a phone's block wraps them across its width. Nothing at all when the restock has none.
 */
export function RestockTagChips({
  tags,
  max = 2,
  wrap = false,
  testId,
}: {
  tags: RestockTag[];
  max?: number;
  /** A phone's block: wrap across the block's width. Otherwise a table cell: wrap inside 10.5rem. */
  wrap?: boolean;
  testId: string;
}) {
  if (tags.length === 0) return null;

  const shown = tags.slice(0, max);
  const rest = tags.slice(max);

  return (
    // ⚠ A table cell's chips hold their column by an explicit width (`max-content`, capped): a chip's cut label lets a
    // flex row's min-content fall to nothing, and the table then squeezed the column and drew the chips over the next one.
    <HStack
      gap="1"
      rowGap="1"
      wrap="wrap"
      w={wrap ? undefined : "max-content"}
      maxW={wrap ? undefined : "10.5rem"}
      minW="0"
      data-testid={testId}
    >
      {shown.map((tag) => (
        <RestockTagChip key={tag.id.toString()} tag={tag} maxW="8rem" testId={`${testId}-${tag.id}`} />
      ))}
      {rest.length > 0 && (
        <Tag.Root
          size="md"
          variant="subtle"
          colorPalette="gray"
          flexShrink={0}
          title={rest.map((tag) => tag.name).join(", ")}
          data-testid={`${testId}-more`}
        >
          <Tag.Label>+{rest.length}</Tag.Label>
        </Tag.Root>
      )}
    </HStack>
  );
}
