import type { ReactNode } from "react";
import { Badge } from "./ui/Badge";
import { cn } from "./ui/cn";
import type { PublicUser } from "../gen/warehouse/user/v1/user_pb";
import { Role } from "../gen/warehouse/role_base/v1/role_pb";
import { roleLabel } from "../lib/roles";

export interface UserItemProps {
  // Any user-shaped object — a PublicUser, a User, whatever carries these fields.
  user: Pick<PublicUser, "name" | "username" | "avatarUrl">;
  // Optionally show the user's role as a badge (e.g. their role in a team).
  role?: Role;
  // Optional trailing content: action buttons, a check, etc.
  action?: ReactNode;
  size?: "sm" | "md";
}

// The first letter of the first and last word of a name, upper-cased — the avatar's fallback when
// there is no picture (or the picture fails to load). Mirrors what Chakra's Avatar derived for us.
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "";
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
}

// UserItem is the shared way to show a user in a list, a menu, a search result (#41): their avatar
// (falling back to initials), display name, @username, and — optionally — a role badge. Everything
// that renders "a user" should use this so avatars and naming stay consistent across the app.
export const description = "The shared way to show a user — avatar (or initials), display name, and @username.";

export function UserItem({ user, role, action, size = "sm" }: UserItemProps) {
  const display = user.name || user.username;
  const showRole = role !== undefined && role !== Role.UNSPECIFIED;

  return (
    <div className="flex w-full items-center gap-card">
      {/* Avatar: a brand-tinted rounded box showing initials, with the picture layered on top. The
          <img> hides itself if it fails to load (a 404 or a bad URL), revealing the initials beneath. */}
      <div
        className={cn(
          "relative flex shrink-0 items-center justify-center overflow-hidden rounded-full font-medium",
          "bg-brand-50 text-brand-700 dark:bg-brand-950 dark:text-brand-300",
          size === "md" ? "size-10 text-sm" : "size-8 text-xs",
        )}
      >
        <span>{initials(display)}</span>
        {user.avatarUrl && (
          <img
            key={user.avatarUrl}
            src={user.avatarUrl}
            alt={display}
            className="absolute inset-0 size-full object-cover"
            onError={(e) => {
              e.currentTarget.style.display = "none";
            }}
          />
        )}
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <p className="line-clamp-1 text-sm font-medium">{display}</p>
        <div className="flex items-center gap-2">
          <span className="line-clamp-1 text-xs text-fg-muted">@{user.username}</span>
          {showRole && <Badge colorPalette="brand">{roleLabel(role)}</Badge>}
        </div>
      </div>

      {action}
    </div>
  );
}
