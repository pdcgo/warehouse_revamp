import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Avatar, Box, CloseButton, Drawer, Flex, Icon, IconButton, Input, InputGroup, Popover, Portal, Spinner, Stack, Text } from "@chakra-ui/react";
import { Check, ChevronUp, ChevronsUpDown, Search } from "lucide-react";
import { teamTypeAvatar, teamTypeLabel } from "../components/badges/TeamTypeBadge";
import { TeamItem } from "../components/entity/TeamItem";
import { useTeam } from "../features/team/TeamContext";
import { useTeamSearch } from "../features/teams/queries";
import { useDebounced } from "../lib/useDebounced";

// TeamSwitcher is the sidebar's current-team control — the WORKSPACE, in the owner's word: a card showing the active
// team (colour keyed to its type) that opens a search and the teams to switch to. THE CURRENT TEAM IS THE SCOPE, so
// switching re-scopes the whole app. Collapsed, the trigger shrinks to just the colour chip.
//
// WHERE IT OPENS (owner: *"workspace, di panel aja langsung di bawahnya"*, `the-workspace-opens-under-its-card`):
//
//   | panel     | who                       | it opens as                                                    |
//   | --------- | ------------------------- | -------------------------------------------------------------- |
//   | "below"   | the open desktop sidebar  | a panel straight under the card, the card's width              |
//   | "right"   | the collapsed sidebar     | a panel to the right of the avatar, beside the rail            |
//   | "drawer"  | the phone (the default)   | a drawer from the bottom, where the thumb is — a dropdown      |
//   |           |                           | under a chip is a small target (`the-phone-opens-its-panels-from-the-bottom`) |
//
// Root and the Administrator get a second section, *All teams*, searched on the server: every team they are not in
// (the-switcher-offers-every-team). Picking one acts there with their platform role under a strip on every page
// (a-non-member-root-acts-under-a-strip). Everyone else sees their own teams only.
//
// EVERY SECTION SEARCHES ITSELF, UNDER ITS HEADING (owner, `the-workspace-search-opens-under-its-heading`, after a
// sidebar's *Top repositories*): the heading stays, a search icon at its right; a click opens the field UNDER the
// heading and turns the icon into a ^ that shuts it. One section is searched at a time — while it is, the other steps
// aside. No "not a member" badge: the section says it. Access decides only how many sections there are: a member has
// My teams; Root and the Administrator have My teams and All teams.
//
//   Tim saya                 ⌕      →    Tim saya                 ^
//    GP Gudang Pusat         ✓           [⌕ Cari di Tim saya       ]
//   Semua tim                ⌕            GP Gudang Pusat         ✓
//    TM Toko Melati                      (Semua tim aside while My teams is searched)
export function TeamSwitcher({
  collapsed,
  panel = "drawer",
  screen,
}: {
  collapsed?: boolean;
  panel?: "drawer" | "below" | "right";
  /**
   * The phone top bar's use (`the-phone-team-chip-is-the-whole-box`): the screen's name under the team's, so the whole
   * bar is ONE selector — team, then screen, then ⇅ — rather than an avatar chip beside two lines of text.
   */
  screen?: string;
}) {
  const { t } = useTranslation();
  const { teams, current, platformRole, selectTeam } = useTeam();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  // Which section is being searched — none, My teams, or All teams.
  const [searching, setSearching] = useState<Section | null>(null);

  const reachesEveryTeam = platformRole !== undefined;
  // All teams searches the SERVER, and only while it is the section being searched.
  const term = useDebounced(searching === "all" ? query.trim() : "");
  const everyTeam = useTeamSearch({ q: term, enabled: open && reachesEveryTeam });

  if (teams.length === 0) {
    return null;
  }

  const name = current?.teamName || (current ? `Team #${current.teamId}` : t("shell.switchTeam"));

  // My teams narrows in the browser, and only while it is the section being searched.
  const q = searching === "mine" ? query.trim().toLowerCase() : "";
  const filtered = teams.filter((team) =>
    (team.teamName || `Team #${team.teamId}`).toLowerCase().includes(q),
  );

  // A team you are in stays under My teams, with your own role — All teams never shadows a membership.
  const memberIds = new Set(teams.map((team) => team.teamId.toString()));
  const others = (everyTeam.data ?? []).filter((team) => !memberIds.has(team.id.toString()));

  function pick(teamId: bigint) {
    selectTeam(teamId);
    setOpen(false);
  }

  const onOpenChange = (next: boolean) => {
    setOpen(next);
    if (next) {
      setQuery("");
      setSearching(null);
    }
  };

  const startSearch = (section: Section) => {
    setQuery("");
    setSearching(section);
  };
  const stopSearch = () => {
    setQuery("");
    setSearching(null);
  };

  // A section's heading — its name, and at its right a search icon that opens the field UNDER the heading (and becomes a
  // ^ that shuts it again).
  const heading = (section: Section, label: string) => {
    const open = searching === section;

    return (
      <Box>
        <Flex align="center" gap="2" ps="2.5" pe="1" pt="2" pb="0.5" data-testid={`team-section-${section}`}>
          <Text textStyle="xs" color="fg.muted" flex="1">
            {label}
          </Text>
          <IconButton
            size="2xs"
            variant="ghost"
            color="fg.muted"
            aria-label={open ? t("shell.closeSearch") : t("shell.searchIn", { section: label })}
            aria-expanded={open}
            // A ghost button shades itself while `aria-expanded` — here that is a state, not a press.
            _expanded={{ bg: "transparent" }}
            _hover={{ bg: "bg.muted" }}
            data-testid={`team-search-${section}`}
            onClick={() => (open ? stopSearch() : startSearch(section))}
          >
            <Icon as={open ? ChevronUp : Search} boxSize="3.5" />
          </IconButton>
        </Flex>

        {open && (
          <Box px="1" pt="1" pb="1.5">
            <InputGroup startElement={<Icon as={Search} boxSize="4" color="fg.subtle" />}>
              <Input
                size="sm"
                autoFocus
                placeholder={t("shell.searchIn", { section: label })}
                data-testid="team-search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  // Escape leaves the search first; a second Escape closes the panel.
                  if (e.key === "Escape") {
                    e.preventDefault();
                    stopSearch();
                  }
                }}
              />
            </InputGroup>
          </Box>
        )}
      </Box>
    );
  };

  // While its panel is open the card reads as pressed — the panel hangs from it.
  const pressed = open && panel !== "drawer";

  const trigger = (
    <Flex
      as="button"
      data-testid="team-switcher"
      align="center"
      gap="2.5"
      // ⚠ COLLAPSED, IT MUST NOT STRETCH. Full width is right in a sidebar, where the switcher
      // IS the row; in the mobile top bar the collapsed trigger sits beside the screen title and
      // a `w="full"` chip pushes that title out of the header entirely.
      w={collapsed ? "auto" : "full"}
      rounded="md"
      borderWidth="1px"
      borderColor={pressed ? "border.emphasized" : "border"}
      bg={pressed ? "bg.muted" : undefined}
      px="2.5"
      py="2"
      cursor="pointer"
      _hover={{ bg: "bg.muted" }}
      justify={collapsed ? "center" : "flex-start"}
    >
      <Avatar.Root
        shape="rounded"
        size="sm"
        // Tinted by team type from the ONE mapping (TeamTypeBadge) — this file used to keep its own
        // copy, and it had already drifted: the root team was rose here and gray in the team list.
        {...teamTypeAvatar(current?.teamType)}
        flexShrink={0}
      >
        <Avatar.Fallback name={name} />
        <Avatar.Image src={current?.imageUrl || undefined} alt={name} />
      </Avatar.Root>

      {!collapsed && (
        <>
          {screen !== undefined ? (
            // The phone's top bar: whose data, then what you are looking at — stacked, as the bar always said it.
            <Box textAlign="start" flex="1" minW="0">
              <Text fontSize="xs" color="fg.subtle" truncate>
                {name}
              </Text>
              <Text fontSize="sm" fontWeight="semibold" truncate data-testid="mobile-title">
                {screen}
              </Text>
            </Box>
          ) : (
            <Box textAlign="start" flex="1" minW="0">
              <Text fontSize="sm" fontWeight="medium" lineClamp={1}>
                {name}
              </Text>
              <Text fontSize="xs" color="fg.muted">
                {current ? teamTypeLabel(current.teamType) : ""}
              </Text>
            </Box>
          )}
          <Icon as={ChevronsUpDown} boxSize="4" color="fg.muted" flexShrink={0} />
        </>
      )}
    </Flex>
  );

  // The sections and their teams — the same in the panel and in the dialog.
  //
  // ⚠ THE SCROLLBAR RIDES THE PANEL'S EDGE (theme.ts, `scrollList`): the list is pulled out through the panel's right
  // padding, so its reserved gutter sits on the edge instead of adding to the inset — the heading's search icon and a
  // row's ✓ end near the edge, not 45px in from it.
  const body = (
    <>
      <Stack
        gap="0.5"
        maxH="400px"
        layerStyle="scrollList"
        // Out through the panel's padding (2.5, or the drawer body's 6), and only a sliver of it given back: with the
        // 10px gutter that makes the right inset match the left one.
        me={panel === "drawer" ? "-6" : "-2.5"}
        pe={panel === "drawer" ? "4" : "0.5"}
      >
        {searching !== "all" && (
          <>
            {heading("mine", t("shell.myTeams"))}

            {filtered.map((team) => (
              <TeamRow
                key={team.teamId.toString()}
                teamId={team.teamId}
                team={{ teamName: team.teamName, teamType: team.teamType, teamId: team.teamId, imageUrl: team.imageUrl }}
                selected={current?.teamId === team.teamId}
                onPick={pick}
              />
            ))}

            {filtered.length === 0 && (
              <Text fontSize="sm" color="fg.muted" px="2.5" py="2">
                {t("shell.noTeams")}
              </Text>
            )}
          </>
        )}

        {reachesEveryTeam && searching !== "mine" && (
          <>
            {heading("all", t("shell.allTeams"))}

            {everyTeam.isPending ? (
              <Spinner size="sm" colorPalette="brand" mx="2.5" my="2" />
            ) : others.length === 0 ? (
              <Text fontSize="sm" color="fg.muted" px="2.5" py="2">
                {t("shell.noTeams")}
              </Text>
            ) : (
              others.map((team) => (
                <TeamRow
                  key={team.id.toString()}
                  teamId={team.id}
                  team={{ teamName: team.name, teamType: team.type, teamId: team.id, imageUrl: team.imageUrl }}
                  selected={current?.teamId === team.id}
                  onPick={pick}
                />
              ))
            )}
          </>
        )}
      </Stack>
    </>
  );

  if (panel !== "drawer") {
    return (
      <Popover.Root
        open={open}
        onOpenChange={(e) => onOpenChange(e.open)}
        closeOnEscape={searching === null}
        // Mounted only while open, as the dialog's content is.
        lazyMount
        unmountOnExit
        positioning={
          panel === "below"
            ? // Straight under the card, as wide as it — the card opening, not a window arriving.
              { placement: "bottom-start", sameWidth: true, gutter: 6 }
            : { placement: "right-start", gutter: 10 }
        }
      >
        <Popover.Trigger asChild>{trigger}</Popover.Trigger>
        <Portal>
          <Popover.Positioner>
            <Popover.Content
              w={panel === "below" ? "var(--reference-width)" : "72"}
              p="2.5"
              data-testid="team-switcher-panel"
            >
              {/* A panel still needs a name; the card above it is the visible one. */}
              <Popover.Title srOnly>{t("shell.switchTeam")}</Popover.Title>
              {body}
            </Popover.Content>
          </Popover.Positioner>
        </Portal>
      </Popover.Root>
    );
  }

  // The phone: a drawer from the bottom, rounded at the top, never the whole screen.
  return (
    <Drawer.Root
      open={open}
      onOpenChange={(e) => onOpenChange(e.open)}
      closeOnEscape={searching === null}
      placement="bottom"
    >
      <Drawer.Trigger asChild>{trigger}</Drawer.Trigger>

      <Portal>
        <Drawer.Backdrop />
        <Drawer.Positioner>
          <Drawer.Content roundedTop="l3" maxH="85dvh" data-testid="team-switcher-drawer">
            <Drawer.Header>
              <Drawer.Title>{t("shell.switchTeam")}</Drawer.Title>
            </Drawer.Header>

            <Drawer.Body pb="calc(env(safe-area-inset-bottom) + var(--chakra-spacing-4))">{body}</Drawer.Body>

            <Drawer.CloseTrigger asChild>
              <CloseButton size="sm" />
            </Drawer.CloseTrigger>
          </Drawer.Content>
        </Drawer.Positioner>
      </Portal>
    </Drawer.Root>
  );
}

type Section = "mine" | "all";

// One row of the switcher — a membership, or a team from All teams.
function TeamRow({
  teamId,
  team,
  selected,
  onPick,
}: {
  teamId: bigint;
  team: { teamName: string; teamType: number; teamId: bigint; imageUrl: string };
  selected: boolean;
  onPick: (teamId: bigint) => void;
}) {
  return (
    <Flex
      as="button"
      data-testid={`team-option-${teamId}`}
      w="full"
      rounded="md"
      px="2.5"
      py="2"
      cursor="pointer"
      // A <button> defaults to text-align:center, which would centre the team name
      // inside TeamItem — start-align it so the row reads avatar → name, left to right.
      textAlign="start"
      _hover={{ bg: "bg.muted" }}
      onClick={() => onPick(teamId)}
    >
      <TeamItem team={team} action={selected ? <Icon as={Check} boxSize="4" color="brand.fg" /> : undefined} />
    </Flex>
  );
}
