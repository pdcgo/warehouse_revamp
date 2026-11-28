// A PICKER WITH NOTHING TO OFFER READS ITS LIST AGAIN WHEN THE PERSON COMES BACK (a-helper-link-opens-a-new-tab).
//
// Such a picker shows a helper that opens the page where the missing thing is made — a supplier, an operational account,
// a rack — in a NEW TAB, so the form beside it keeps every line and count typed so far. Back on the form's tab, the
// picker must see what was just made there, without a reload.
//
// The app keeps `refetchOnWindowFocus: false` (api/queryClient.ts, HARD RULE 10): it is used beside a scanner and a
// spreadsheet, and a refetch per alt-tab is a request storm. This buys it back for ONE query, and only while that query's
// answer is EMPTY — the one state its helper shows in. A picker with something in it never re-reads on a tab switch.
//
// TanStack v5 calls it on `visibilitychange` (the tab shown again). "always" refetches whatever the query's freshness —
// a `referenceQuery` feed counts as fresh for five minutes, and `true` would skip it.
//
//   useQuery({ ...referenceQuery, queryKey, queryFn, refetchOnWindowFocus: rereadOnReturnWhileEmpty((rows) => !rows.length) })
export function rereadOnReturnWhileEmpty<T>(isEmpty: (data: T) => boolean) {
  return (query: { state: { data: T | undefined } }): boolean | "always" =>
    query.state.data !== undefined && isEmpty(query.state.data) ? "always" : false;
}
