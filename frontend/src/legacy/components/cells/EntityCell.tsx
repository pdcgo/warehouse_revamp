import type { ReactNode } from "react";
import { HStack, Stack } from "@chakra-ui/react";
import { ClippedText } from "../text/ClippedText";
import { SkeletonBlock } from "../feedback/SkeletonBlock";

// EntityCell is the shape every identity cell in this app shares: an optional thumbnail, a bold
// name that clips, and one quieter line of secondary identity beneath it.
//
// It exists so the eight entity cells are one layout with eight fillings rather than eight
// near-copies. That matters because the details that make these cells work are subtle and would
// otherwise be re-derived (and half-remembered) per entity:
//
//  1. THE NAME CLIPS, IT DOES NOT WRAP. A wrapping name makes one row taller than its neighbours and
//     breaks the column alignment the whole table depends on. ClippedText keeps the full value a
//     hover away.
//  2. A MISSING NAME FALLS BACK TO THE ID, NEVER TO BLANK. An entity the server would not resolve
//     still occupies a row, and an empty cell reads as a rendering bug. "#4471" is at least
//     something the reader can search for or quote in a message.
//  3. LOADING ONLY SHOWS A SKELETON WHEN THERE IS NOTHING CACHED. A refetch over a resolved entity
//     keeps the previous name on screen — the same always-fresh reasoning the lists follow. A cell
//     that flipped to grey bars on every background refresh would make a table strobe.
export const description =
  "The shared shape of every entity cell: thumbnail, a clipping name that falls back to the id, and a quieter second line. Only shows a skeleton when there is nothing cached to keep.";

export interface EntityCellProps {
  // Rendered before the text — an Image, an avatar, a marketplace mark.
  media?: ReactNode;
  name?: string;
  // What to show when the name is missing. Callers pass the id, per rule 2.
  fallback?: string;
  // The quieter identity line: a badge, a username, a code.
  secondary?: ReactNode;
  // Pinned to the far end of the cell — a warning marker, a status.
  trailing?: ReactNode;
  // True only when there is NOTHING to show yet. See rule 3: pass
  // `isPending`, not `isFetching`.
  loading?: boolean;
}

export function EntityCell({ media, name, fallback, secondary, trailing, loading }: EntityCellProps) {
  if (loading) {
    return (
      <HStack gap="2" py="1" data-testid="entity-cell" data-loading="true">
        {media && <SkeletonBlock shape="circle" boxSize="10" />}
        <Stack gap="1.5" flex="1" minW="0">
          <SkeletonBlock shape="rect" height="4" width="70%" />
          <SkeletonBlock shape="rect" height="3" width="45%" />
        </Stack>
      </HStack>
    );
  }

  return (
    <HStack gap="2" py="1" minW="0" data-testid="entity-cell">
      {media}

      <Stack gap="0.5" minW="0" lineHeight="short">
        <ClippedText fontWeight="bold" data-testid="entity-cell-name">
          {name || fallback || "—"}
        </ClippedText>
        {secondary}
      </Stack>

      {trailing && <HStack ms="auto">{trailing}</HStack>}
    </HStack>
  );
}
