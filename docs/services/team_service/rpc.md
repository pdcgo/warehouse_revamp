# team_service — complex RPC flows

Only RPCs with a non-trivial flow or a cross-service dependency are documented here (HARD RULE 3).
The plain reads/writes (`TeamList`, `TeamDetail`, `TeamByIds`, `TeamUpdate`, `TeamDelete`,
`TeamInfoUpdate`) are single-table and need no diagram.

## TeamCreate — a saga across two services

`TeamCreate` must do two things that live in **two different services' databases**: create the team
row (team_service) and grant the caller the OWNER role (user_service). There is no distributed
transaction, so it runs as a saga with a compensating action.

```mermaid
sequenceDiagram
    participant C as Caller (ROOT/ADMIN)
    participant T as team_service
    participant U as user_service
    C->>T: TeamCreate(type, name, code, …)
    T->>T: INSERT team + empty team_info (one local tx)
    T->>U: TeamUserUpdate(add OWNER role), forwarding the caller's OWN bearer
    alt grant succeeds
        U-->>T: ok
        T-->>C: Team
    else grant fails
        U-->>T: error
        T->>T: COMPENSATE — soft-delete the team (deleted = true)
        Note over T: never HARD delete — the grant may have<br/>succeeded on a timed-out call, and a hard<br/>delete would strand a user_team_roles row
        T-->>C: Internal ("team created but owner grant failed; rolled back")
    end
```

**Why these choices:**
- **Blocking RPC, not an event.** Only ROOT/ADMIN create teams, it is rare, and the exposure window
  is one round-trip. A synchronous grant means the caller learns immediately whether they own the
  team, and the compensation keeps the two stores consistent.
- **The caller's own bearer is forwarded** to `TeamUserUpdate`, never a service credential — so
  user_service applies the *caller's* permissions, not team_service's. A service calling another
  with its own privileges is a confused deputy.
- **Compensation soft-deletes.** If the grant call times out it may actually have succeeded;
  soft-delete leaves the team recoverable and never dangles a role pointing at a vanished team. The
  one state a human must look at — grant failed *and* compensation failed — is logged at
  `slog.Error`.
- The owner role depends on team type: a `warehouse` team's owner is `ROLE_WAREHOUSE_OWNER`,
  everything else `ROLE_TEAM_OWNER` (see `ownerRoleFor` in `team_v1/mapper.go`).

Code: `backend/services/team_service/team_v1/team_create.go`.
