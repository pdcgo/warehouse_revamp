import { useQuery } from "@tanstack/react-query";
import { userClient } from "../../api/clients";
import { key } from "../../api/queryClient";

// The profile screen's read (#122).
//
// ProfileDetail is the caller's OWN row, email and phone included — what UserByIDs' PublicUser never carries. It has no
// user id field at all (the subject is the token holder), so the KEY carries the signed-in identity: a second person
// signing in on the same tab is a different answer, and must never be handed the first one's cached row. A by-id read
// on the plain always-fresh default; the form seeds from it once (pages/profile, useSeedOnce).
export function useProfileDetail(args: { identityId: bigint | undefined }) {
  const { identityId } = args;

  return useQuery({
    queryKey: key.users(undefined, { profile: identityId?.toString() ?? "" }),
    enabled: identityId !== undefined,
    queryFn: async () => (await userClient.profileDetail({})).user ?? null,
  });
}
