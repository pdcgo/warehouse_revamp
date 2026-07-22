import { useQuery, useQueryClient } from "@tanstack/react-query";
import { userClient } from "../api/clients";
import { key } from "../api/queryClient";

// The user detail screen's read (#176).
//
// UserTeams returns the person AND their memberships in one call, so one query holds both — they are
// one answer, not two that happen to arrive together.
//
// No team in the key: this is an admin screen about a PERSON, and the same user is the same user
// whichever team the admin is currently standing in. `key.users(undefined, …)` records that
// deliberately rather than by omission.
export function useUserTeams(args: { userId: bigint; page: number; pageSize: number }) {
  const { userId, page, pageSize } = args;

  return useQuery({
    queryKey: key.users(undefined, { userId: userId.toString(), page, pageSize }),
    enabled: userId > 0n,
    queryFn: async () => {
      const res = await userClient.userTeams({ userId, page: { page, limit: pageSize } });

      return {
        user: res.user ?? null,
        teams: res.teams,
        pageInfo: res.pageInfo,
      };
    },
  });
}

export function useInvalidateUsers() {
  const client = useQueryClient();

  return () => client.invalidateQueries({ queryKey: ["users"] });
}
