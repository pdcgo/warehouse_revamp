// What the app can tell about a user from the fields every user-shaped object carries.

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
