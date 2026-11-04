// What the app can tell about a user from the fields every user-shaped object carries.

import i18next from "i18next";

/**
 * The id of a FORMER user — an account erased on request (erase-keeps-the-row): its name blanked and its username
 * replaced with `erased<id>` by the server. Such a person is shown as *"Former user #57"*, never by the synthetic
 * username. Undefined for everyone else.
 *
 * Recognising it by the name is sound: nobody else may be called `erased` and digits (erased-usernames-are-reserved),
 * and an erased account is never edited back (an-erased-account-is-final).
 */
export function formerUserId(user: { name: string; username: string }): string | undefined {
  if (user.name !== "") return undefined;

  return /^erased(\d+)$/.exec(user.username)?.[1];
}

/**
 * How a person reads in a cell or a sentence — THE one place that decides it, so no screen shows `erased57`:
 * *"Former user #57"* for an erased account (erase-keeps-the-row), else the name, else the username, else `fallback`
 * (an id the lookup could not name, usually `#57` or the screen's own "user #57").
 *
 * It reads the app's i18next instance rather than taking `t`, so a query function (no hook there) names people the
 * same way a component does; a component re-renders on a language change through its own `useTranslation`.
 */
export function personName(user: { name: string; username: string } | undefined, fallback = ""): string {
  if (!user) return fallback;

  const formerId = formerUserId(user);
  if (formerId !== undefined) return i18next.t("users.formerUser", { id: formerId });

  return user.name || user.username || fallback;
}
