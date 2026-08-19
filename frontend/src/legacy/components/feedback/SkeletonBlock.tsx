import { Skeleton, SkeletonCircle, SkeletonText, Stack } from "@chakra-ui/react";
import type { SkeletonProps } from "@chakra-ui/react";

// The three shapes real content comes in, so a placeholder can be the same SHAPE as the thing it is
// standing in for: a line of text, a round avatar/thumbnail, or a solid block.
export type SkeletonShape = "text" | "circle" | "rect";

// SkeletonBlock is one component over Chakra's three skeleton primitives, keyed by the shape of the
// content it replaces.
//
// The point of a skeleton is that the layout does not JUMP when the data lands — which only works if
// the placeholder occupies the same space and shape as the real thing. Picking the right primitive
// is therefore the entire decision, and having one component ask for it by name ("this is standing in
// for two lines of text") is what keeps callers from reaching for a generic grey box that resizes the
// moment content arrives.
//
// `lines` renders a paragraph, with the last line short — a paragraph of equal-length bars reads as a
// table, not as prose.
export const description =
  "A loading placeholder shaped like what it replaces — text lines, a circle, or a block — so the layout doesn't jump when the real content lands.";

export interface SkeletonBlockProps extends Omit<SkeletonProps, "children"> {
  shape?: SkeletonShape;
  // Only meaningful for `shape="text"`. More than one renders a paragraph.
  lines?: number;
}

export function SkeletonBlock({ shape = "text", lines = 1, ...rest }: SkeletonBlockProps) {
  if (shape === "circle") {
    return <SkeletonCircle data-testid="skeleton-block" data-shape="circle" {...rest} />;
  }

  if (shape === "text") {
    // ⚠ WRAPPED, and deliberately so. Chakra's SkeletonText with `noOfLines` renders one element
    // PER LINE and spreads the props it is given onto each of them — so putting the test id straight
    // on it stamps the same id on every line, and any query for it matches n times instead of once.
    // The wrapper is what gives the component a single identity regardless of how many lines it drew.
    return (
      <Stack gap="1.5" data-testid="skeleton-block" data-shape="text" data-lines={lines}>
        <SkeletonText noOfLines={lines} {...rest} />
      </Stack>
    );
  }

  return <Skeleton data-testid="skeleton-block" data-shape="rect" {...rest} />;
}
