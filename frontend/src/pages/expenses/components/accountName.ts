import { useFinancialAccountsByIds } from "../../../features/financialAccount/queries";

// THE PAYING ACCOUNT'S NAME — an expense carries only the id (`finance_account_id`), and the screen names it from the
// accounts' own read, as a restock does. Archived accounts resolve too: an expense paid from an account closed since
// still names it. 0 = an expense made before Paid from, which names none.

/** id → name for the accounts a page of expenses names — one read per page, never one per row. */
export function useExpenseAccountNames(teamId: bigint | undefined, accountIds: bigint[]): Map<string, string> {
  const query = useFinancialAccountsByIds(teamId, accountIds);
  const out = new Map<string, string>();

  for (const [id, account] of query.data ?? []) out.set(id, account.name);

  return out;
}

/** One expense's account name; "…" while it is read, and "" for an expense that names none. */
export function useExpenseAccountName(teamId: bigint, accountId: bigint): string {
  const names = useExpenseAccountNames(teamId, accountId > 0n ? [accountId] : []);

  if (accountId === 0n) return "";

  return names.get(accountId.toString()) ?? "…";
}
