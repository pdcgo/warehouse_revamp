// THE CODE IS COMPOSED ON WRITE (the-field-is-product-code-composed-on-write): what product_service stores is
// `<team_code>-<the team's part>`. This form shows the team's code FIXED in front and types only the rest — a prefix
// that could be typed is a prefix another team could type its way into.

/** The fixed part shown in front of the field — "ABC-" — or nothing while the team's code is still unknown. */
export function productCodePrefix(teamCode: string): string {
  return teamCode ? `${teamCode}-` : "";
}

/**
 * The team's part of a stored code: the code with its team's prefix taken off. A code that does not begin with the
 * prefix — a row written before codes were composed, not yet recomposed (`san product recompose-codes`) — is shown whole.
 */
export function productCodePart(code: string, teamCode: string): string {
  const prefix = productCodePrefix(teamCode);

  return prefix && code.startsWith(prefix) ? code.slice(prefix.length) : code;
}
