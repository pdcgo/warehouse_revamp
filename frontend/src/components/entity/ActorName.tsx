import type { ReactNode } from "react";
import { Badge, type BadgeProps, Box, Icon, Popover, Portal, Text, Tooltip } from "@chakra-ui/react";
import { Shield } from "lucide-react";
import { useTranslation } from "react-i18next";

import { useIsMobile } from "../../layouts/shell";

// WHO DID IT — AND WHETHER THE ROOT TEAM DID IT INSIDE THIS TEAM (an-override-shows-a-platform-badge, accepted as
// the-override-badge-is-accepted-as-by-root-team).
//
// A record Root or the System Administrator wrote inside a team they hold no role in is stamped `is_override`
// (an-override-is-stamped-in-every-service), and every read a screen names a person from carries that flag. Wherever a
// record names who did it, an override shows the person's name AND this badge beside it — ONE component, the same
// everywhere, so a team sees at a glance what the root team did inside it.
//
// The badge reads "by Root team", never "by Platform": *Platform* is the outside marketplace
// (platform-is-the-word-for-the-outside-marketplace). The name stays: the badge never replaces the person. Its colour is
// the root team's own green (`rootTeamBadge.*` in theme.ts) with a shield, and its sentence is a tooltip on a desktop
// and a tap on a phone — a phone has no hover.

export const description =
  "A person's name with the shared 'by Root team' badge beside it when the record is an override — Root or the System Administrator acting inside a team they are not in. The badge alone (RootTeamBadge) sits after a sentence that already names the person. Sized for a table cell (sm) and for a phone block or a muted meta line (xs); it explains itself in a tooltip on a desktop and on a tap on a phone.";

export interface RootTeamBadgeProps extends Omit<BadgeProps, "children" | "size"> {
  /** `sm` beside a cell's name, `xs` in a muted meta line or a phone block. */
  size?: "xs" | "sm";
  testId?: string;
}

/** The badge alone — after a sentence that already names the person (the member log's "fajar removed …"). */
export function RootTeamBadge({ size = "sm", testId = "root-team-badge", ...rest }: RootTeamBadgeProps) {
  const { t } = useTranslation();
  const isMobile = useIsMobile();
  const label = t("override.byRootTeam");
  const hint = t("override.byRootTeamHint");

  const look: BadgeProps = {
    size,
    bg: "rootTeamBadge.bg",
    color: "rootTeamBadge.fg",
    gap: "1",
    flexShrink: 0,
    whiteSpace: "nowrap",
    verticalAlign: "middle",
    ...rest,
  };
  const content = (
    <>
      <Icon as={Shield} boxSize={size === "xs" ? "2.5" : "3"} />
      {label}
    </>
  );

  // A PHONE HAS NO HOVER: the sentence opens on a tap, under the badge (as the desktop's tooltip does), so the record's
  // own line stays readable. The tap stops at the badge — a block or a row is often clickable, and reading what the
  // badge means must not also open the record.
  if (isMobile) {
    return (
      <Popover.Root positioning={{ placement: "bottom" }} lazyMount unmountOnExit>
        <Popover.Trigger asChild>
          <Badge
            as="button"
            {...look}
            aria-label={`${label}: ${hint}`}
            data-testid={testId}
            onClick={(e) => e.stopPropagation()}
          >
            {content}
          </Badge>
        </Popover.Trigger>
        <Portal>
          <Popover.Positioner>
            <Popover.Content maxW="xs">
              <Popover.Body p="3" textStyle="sm" data-testid={`${testId}-hint`}>
                {hint}
              </Popover.Body>
            </Popover.Content>
          </Popover.Positioner>
        </Portal>
      </Popover.Root>
    );
  }

  return (
    <Tooltip.Root openDelay={100} closeDelay={80}>
      <Tooltip.Trigger asChild>
        <Badge {...look} tabIndex={0} cursor="default" data-testid={testId}>
          {content}
        </Badge>
      </Tooltip.Trigger>
      <Portal>
        <Tooltip.Positioner>
          <Tooltip.Content maxW="xs" data-testid={`${testId}-hint`}>
            {hint}
          </Tooltip.Content>
        </Tooltip.Positioner>
      </Portal>
    </Tooltip.Root>
  );
}

export interface ActorNameProps {
  /** The person as the screen already names them — a name, "by Budi", or a resolved fallback ("#7"). */
  name: ReactNode;
  /** The record's `is_override`. False draws the name alone. */
  isOverride?: boolean;
  size?: "xs" | "sm";
  /** On the wrapper; the badge keeps `root-team-badge`, so a row is asserted the same way on every screen. */
  testId?: string;
}

/**
 * The name, then the badge when the record is an override. They wrap as one unit: in a narrow cell the badge drops
 * under the name rather than squeezing it, and the name never truncates — it is the fact the line is read for.
 */
export function ActorName({ name, isOverride = false, size = "sm", testId }: ActorNameProps) {
  return (
    <Box
      as="span"
      display="inline-flex"
      alignItems="center"
      flexWrap="wrap"
      columnGap="1.5"
      rowGap="0.5"
      maxW="full"
      verticalAlign="middle"
      data-testid={testId}
    >
      <Text as="span">{name}</Text>
      {isOverride && <RootTeamBadge size={size} />}
    </Box>
  );
}
