import { useState } from "react";
import { Check, ChevronsUpDown, X } from "lucide-react";
import { TeamType } from "../gen/warehouse/team/v1/team_pb";
import { TeamItem } from "../components/TeamItem";
import { IconButton } from "../components/ui/Button";
import { Dialog, Portal } from "../components/ui/Dialog";
import { Input } from "../components/ui/Input";
import { cn } from "../components/ui/cn";
import { useTeam } from "../features/team/TeamContext";

// Each team type carries a colour so the current scope's avatar chip is recognisable at a glance.
function typePalette(type: TeamType | undefined): string {
  switch (type) {
    case TeamType.WAREHOUSE:
      return "blue";
    case TeamType.SELLING:
      return "green";
    case TeamType.ADMIN:
      return "purple";
    case TeamType.ROOT:
      return "brand";
    default:
      return "gray";
  }
}

// The solid chip fill per palette — a recognisable colour block behind the team's initials (the
// mock's trigger). Written as literal classes so Tailwind's JIT can see them.
const CHIP: Record<string, string> = {
  blue: "bg-blue-600 text-white",
  green: "bg-green-600 text-white",
  purple: "bg-purple-600 text-white",
  brand: "bg-brand-600 text-white",
  gray: "bg-gray-500 text-white",
};

function typeLabel(type: TeamType | undefined): string {
  switch (type) {
    case TeamType.ROOT:
      return "Root";
    case TeamType.ADMIN:
      return "Admin";
    case TeamType.WAREHOUSE:
      return "Warehouse";
    case TeamType.SELLING:
      return "Selling";
    default:
      return "";
  }
}

// The first letter of the first and last word of a name, upper-cased — the chip's initials.
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "";
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
}

// TeamSwitcher is the sidebar's current-team control: a card showing the active team (colour keyed
// to its type) that opens a CENTERED dialog to search and switch teams. THE CURRENT TEAM IS THE
// SCOPE, so switching re-scopes the whole app. Collapsed, the trigger shrinks to just the colour chip.
export function TeamSwitcher({ collapsed }: { collapsed?: boolean }) {
  const { teams, current, selectTeam } = useTeam();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  if (teams.length === 0) {
    return null;
  }

  const name = current?.teamName || (current ? `Team #${current.teamId}` : "Select a team");
  const palette = typePalette(current?.teamType);

  const q = query.trim().toLowerCase();
  const filtered = teams.filter((team) =>
    (team.teamName || `Team #${team.teamId}`).toLowerCase().includes(q),
  );

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(e) => {
        setOpen(e.open);
        if (e.open) {
          setQuery("");
        }
      }}
    >
      <Dialog.Trigger asChild>
        <button
          type="button"
          data-testid="team-switcher"
          className={cn(
            "flex w-full items-center gap-2.5 rounded-control border border-line bg-surface-2 px-2.5 py-2 text-left text-fg hover:border-line-strong",
            collapsed ? "justify-center" : "justify-start",
          )}
        >
          <span
            className={cn(
              "flex size-7 shrink-0 items-center justify-center rounded-[7px] text-xs font-bold",
              CHIP[palette],
            )}
          >
            {initials(name)}
          </span>

          {!collapsed && (
            <>
              <span className="min-w-0 flex-1 text-start">
                <span className="block truncate text-sm font-semibold">{name}</span>
                <span className="block text-xs text-fg-subtle">{typeLabel(current?.teamType)}</span>
              </span>
              <ChevronsUpDown className="size-4 shrink-0 text-fg-subtle" />
            </>
          )}
        </button>
      </Dialog.Trigger>

      <Portal>
        <Dialog.Backdrop />
        <Dialog.Positioner>
          <Dialog.Content className="max-w-sm">
            <Dialog.Header>
              <Dialog.Title>Switch Team</Dialog.Title>
            </Dialog.Header>

            <Dialog.Body>
              <Input
                autoFocus
                placeholder="Search teams"
                data-testid="team-search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="mb-3"
              />

              <div className="flex max-h-80 flex-col gap-0.5 overflow-y-auto">
                {filtered.map((team) => (
                  <button
                    type="button"
                    key={team.teamId.toString()}
                    data-testid={`team-option-${team.teamId}`}
                    // A <button> defaults to text-align:center, which would centre the team name
                    // inside TeamItem — start-align it so the row reads chip → name, left to right.
                    className="w-full rounded-control px-2.5 py-2 text-start hover:bg-surface-2"
                    onClick={() => {
                      selectTeam(team.teamId);
                      setOpen(false);
                    }}
                  >
                    <TeamItem
                      team={{
                        teamName: team.teamName,
                        teamType: team.teamType,
                        teamId: team.teamId,
                        imageUrl: team.imageUrl,
                      }}
                      action={
                        current?.teamId === team.teamId ? (
                          <Check className="size-4 shrink-0 text-accent-fg" />
                        ) : undefined
                      }
                    />
                  </button>
                ))}

                {filtered.length === 0 && (
                  <p className="px-2.5 py-2 text-sm text-fg-muted">No teams found.</p>
                )}
              </div>
            </Dialog.Body>

            <Dialog.CloseTrigger asChild>
              <IconButton size="sm" aria-label="Close" className="absolute right-3 top-3">
                <X className="size-4" />
              </IconButton>
            </Dialog.CloseTrigger>
          </Dialog.Content>
        </Dialog.Positioner>
      </Portal>
    </Dialog.Root>
  );
}
