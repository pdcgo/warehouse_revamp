export const meta = {
  name: 'overnight-board',
  description: 'Autonomously work the Ready column of GitHub Project #2: triage every Ready issue, then implement the genuinely-actionable ones on dev (green, one at a time, dependency order) and move them to In review. Under-specified or blocked issues are PARKED with an explanatory comment, never half-built. Non-destructive: it only ever touches files it creates for an issue, never your other uncommitted work.',
  phases: [
    { title: 'Scan' },
    { title: 'Triage' },
    { title: 'Plan' },
    { title: 'Implement' },
  ],
}

// --- board constants (project #2 "Warehouse Revamp", owner pdcgo) ---
const OWNER = 'pdcgo'
const REPO = 'pdcgo/warehouse_revamp'
const PROJECT_NUMBER = 2
const PROJECT_ID = 'PVT_kwDOB8TF184BdVMC'
const STATUS_FIELD = 'PVTSSF_lADOB8TF184BdVMCzhX3esc'
const OPT_READY = '61e4505c'
const OPT_INPROGRESS = '47fc9ee4'
const OPT_INREVIEW = 'df73e18b'

// The house rules every agent must obey (condensed from CLAUDE.md).
const RULES = `You are in the warehouse_revamp repo (branch dev, cwd = repo root). Obey CLAUDE.md HARD RULES:
- Services live in backend/services/<name>_service/; handlers in <name>_v1/ (one file per RPC + a <rpc>_test.go beside it); db models in <name>_service_models/; goose migrations in db_migrations/ (per service, never cross-service).
- After any .proto edit: 'cd proto && buf lint && buf generate'. After changing Wire providers: 'cd backend && go tool wire ./cmd/app_development'. Generated code is committed but never hand-edited.
- A list RPC over growing data MUST take warehouse.common.v1.PageFilter and return PageInfo. A request message with NO role policy is DENIED (deny by default).
- Frontend: Chakra UI v3 only (no raw html controls), lucide icons via <Icon>, sizes from theme.ts; a curated shared component must 'export const description' and appear in the /components gallery. Destructive actions use ConfirmDialog; detail views are pages, not dialogs.
- Design-first is a HARD RULE: if an issue's design is NOT settled in its plans/<svc>/brainstorming.md, or it needs a decision only the owner can make, or it depends on an undesigned foundation (the warehouse fulfilment core — see plans/plan.md — is deliberately NOT designed yet), then it is BLOCKED, not actionable. Do not build on sand.

GIT SAFETY (critical — the working tree may hold the owner's other uncommitted work):
- NEVER run 'git add -A', 'git commit -a', 'git reset --hard', 'git clean', or 'git stash'. They would touch files you did not create.
- Only ever stage / revert the EXACT paths belonging to the issue you are working. Determine them by diffing 'git status --porcelain' before vs after your work.`

// ---------- 1. SCAN: page through the whole board, keep Status == Ready ----------
phase('Scan')
const scan = await agent(
  `List EVERY open issue whose Status is exactly "Ready" in GitHub Project #${PROJECT_NUMBER} (owner ${OWNER}).
The board has more than 100 items, so you MUST paginate: repeat the query following pageInfo.endCursor until hasNextPage is false.
  gh api graphql -f query='query($c:String){ organization(login:"${OWNER}"){ projectV2(number:${PROJECT_NUMBER}){ items(first:100, after:$c){ pageInfo{ hasNextPage endCursor } nodes{ id content{ ... on Issue { number title state } } fieldValues(first:20){ nodes{ ... on ProjectV2ItemFieldSingleSelectValue { name field{ ... on ProjectV2FieldCommon{ name } } } } } } } } } }' -f c=""
Keep only nodes where the Status field value == "Ready" and the issue state == OPEN. Return each as {number, title, itemId} (itemId is the node "id" of the project item).`,
  { label: 'scan-ready', phase: 'Scan', schema: {
    type: 'object', additionalProperties: false, required: ['items'],
    properties: { items: { type: 'array', items: {
      type: 'object', additionalProperties: false, required: ['number', 'title', 'itemId'],
      properties: { number: { type: 'integer' }, title: { type: 'string' }, itemId: { type: 'string' } } } } } }
  }
)

let ready = scan?.items || []
if (args && Array.isArray(args.only)) ready = ready.filter(i => args.only.includes(i.number))
const itemIdOf = Object.fromEntries(ready.map(i => [i.number, i.itemId]))
if (!ready.length) { log('Nothing in Ready.'); return { done: [], failed: [], parked: [], note: 'nothing ready' } }
log(`Ready (${ready.length}): ${ready.map(i => '#' + i.number).join(', ')}`)

// ---------- 2. TRIAGE: actionable vs blocked, one agent per issue, in parallel ----------
phase('Triage')
const triage = (await parallel(ready.map(it => () =>
  agent(
    `${RULES}

Triage issue #${it.number} ("${it.title}") for AUTONOMOUS overnight implementation.
Read the whole thread — the LAST comment is usually the current spec:
  gh api repos/${REPO}/issues/${it.number} --jq '.body'
  gh api repos/${REPO}/issues/${it.number}/comments --jq '.[].body'
Then read the matching plans/<service>/brainstorming.md and skim the code the issue touches (prefer 'graphify query' before broad grep).

Set actionable=true ONLY if ALL hold: (a) the design is settled in the brainstorming doc, (b) the spec is clear enough to build with no new owner decision, (c) every dependency is already built or is also actionable tonight. Otherwise actionable=false with a one-line blockedReason. List dependsOn (issue numbers that must land first). If actionable, give a 3-6 step plan.`,
    { label: `triage-#${it.number}`, phase: 'Triage', agentType: 'general-purpose', schema: {
      type: 'object', additionalProperties: false, required: ['number', 'actionable', 'summary'],
      properties: {
        number: { type: 'integer' },
        actionable: { type: 'boolean' },
        blockedReason: { type: 'string' },
        dependsOn: { type: 'array', items: { type: 'integer' } },
        plan: { type: 'array', items: { type: 'string' } },
        summary: { type: 'string' },
      } } }
  )
))).filter(Boolean)
const triageBy = Object.fromEntries(triage.map(t => [t.number, t]))

// ---------- 3. PLAN: topological order of the actionable set; park the rest ----------
phase('Plan')
const plan = await agent(
  `From these triage results, return:
- order: issue numbers with actionable=true, sorted so every value in an issue's dependsOn appears BEFORE it (topological). Drop any actionable issue that depends on a blocked/absent issue.
- parked: [{number, reason}] for every Ready issue NOT in order (blocked, or dropped).
Triage JSON:
${JSON.stringify(triage)}`,
  { label: 'plan-order', phase: 'Plan', schema: {
    type: 'object', additionalProperties: false, required: ['order', 'parked'],
    properties: {
      order: { type: 'array', items: { type: 'integer' } },
      parked: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['number', 'reason'],
        properties: { number: { type: 'integer' }, reason: { type: 'string' } } } },
    } } }
)

// Tell the owner on the board WHY each parked issue was skipped (parallel, harmless).
if (plan.parked?.length) {
  await parallel(plan.parked.map(p => () =>
    agent(`Post exactly ONE comment on issue #${p.number} in ${REPO}, prefixed "🌙 overnight (parked) — ", explaining it was skipped tonight because: ${p.reason}. Keep it to 1-2 sentences. Command: gh issue comment ${p.number} --repo ${REPO} --body "<text>". Then stop.`,
      { label: `park-#${p.number}`, phase: 'Plan' })
  ))
}
log(`Order: ${plan.order.map(n => '#' + n).join(' -> ') || '(none)'} | Parked: ${(plan.parked || []).map(p => '#' + p.number).join(', ') || '(none)'}`)

// ---------- 4. IMPLEMENT: sequential (git-safe), one issue fully at a time ----------
phase('Implement')
const done = [], failed = []
for (const num of plan.order) {
  const t = triageBy[num] || {}
  const itemId = itemIdOf[num]
  log(`Implementing #${num}...`)

  // 4a. move to In progress so the board shows it live
  if (itemId) await agent(
    `Move project item ${itemId} to Status "In progress": gh project item-edit --project-id ${PROJECT_ID} --id ${itemId} --field-id ${STATUS_FIELD} --single-select-option-id ${OPT_INPROGRESS}. Then stop.`,
    { label: `start-#${num}`, phase: 'Implement' })

  // 4b. implement — DO NOT COMMIT; report the exact files touched + green status
  const impl = await agent(
    `${RULES}

Implement issue #${num} on the working tree. Re-read its thread and follow this plan:
${JSON.stringify(t.plan || [], null, 0)}

First capture the current dirty set: 'git status --porcelain'. Everything already listed there is the OWNER'S work — do not touch it. As you build, track the paths YOU create or modify.

Do the full implementation the issue calls for (code, proto + 'buf generate', goose migration, tests, frontend, and the docs the HARD RULES require — e.g. docs/database-schema.md on a schema change). Then run every green gate that applies:
  cd proto && buf lint && buf generate            (if proto changed)
  cd backend && go build ./... && go vet ./... && go test ./...
  cd frontend && npm run typecheck                 (if frontend changed)

Do NOT git commit. Return green=true only if EVERY applicable gate passed. Return 'changed' = tracked files you modified, 'created' = new files you added (both as repo-relative paths, YOUR delta only). If you cannot finish or cannot make a gate pass, set green=false and explain in summary.`,
    { label: `impl-#${num}`, phase: 'Implement', agentType: 'general-purpose', effort: 'high', schema: {
      type: 'object', additionalProperties: false, required: ['green', 'summary'],
      properties: {
        green: { type: 'boolean' }, summary: { type: 'string' },
        changed: { type: 'array', items: { type: 'string' } },
        created: { type: 'array', items: { type: 'string' } },
      } } }
  )

  const paths = [...(impl?.changed || []), ...(impl?.created || [])]
  const revert = (why, label) => agent(
    `${RULES}

Issue #${num} must be rolled back so dev stays green and the owner's other work is untouched. Revert ONLY these paths (nothing else):
  tracked (restore):   ${JSON.stringify(impl?.changed || [])}   ->  for each: git checkout -- <path>
  created (delete):     ${JSON.stringify(impl?.created || [])}   ->  for each: rm <path> (and remove now-empty dirs you added)
Do NOT use reset --hard / clean / stash / add -A. After reverting, ${itemId ? `move project item ${itemId} back to Status "Ready": gh project item-edit --project-id ${PROJECT_ID} --id ${itemId} --field-id ${STATUS_FIELD} --single-select-option-id ${OPT_READY}; then ` : ''}post ONE comment on #${num} prefixed "🌙 overnight (${why}) — " summarising what went wrong. Then stop.`,
    { label, phase: 'Implement' })

  if (!impl?.green) { await revert('blocked', `revert-#${num}`); failed.push({ number: num, reason: impl?.summary || 'green gate failed' }); continue }

  // 4c. adversarial review of the uncommitted diff before it can land
  const verdicts = (await parallel([1, 2].map(k => () =>
    agent(`${RULES}

Adversarially review the UNCOMMITTED changes for issue #${num}: run 'git diff -- ${paths.map(p => `'${p}'`).join(' ')}' and 'git status --porcelain'. Confirm they genuinely satisfy the issue spec AND obey the HARD RULES (pagination on growing lists; per-service models/migrations; a role policy present on each new request message; a unit test per new RPC; buf/generated in sync; Chakra + design-system for any UI; docs updated on schema change). Default pass=false if anything is wrong, missing, or out of scope. You are skeptic #${k}.`,
      { label: `verify-#${num}-${k}`, phase: 'Implement', agentType: 'general-purpose', schema: {
        type: 'object', additionalProperties: false, required: ['pass'],
        properties: { pass: { type: 'boolean' }, problems: { type: 'array', items: { type: 'string' } } } } })
  ))).filter(Boolean)

  if (verdicts.filter(v => v.pass).length < 2) {
    const problems = verdicts.flatMap(v => v.problems || [])
    await revert('review-failed', `reject-#${num}`)
    failed.push({ number: num, reason: 'adversarial review: ' + problems.join('; ').slice(0, 300) })
    continue
  }

  // 4d. commit ONLY this issue's paths, move to In review, comment
  const commit = await agent(
    `${RULES}

Issue #${num} is green and reviewed. Land it:
1. Stage ONLY this issue's paths (never -A): git add ${paths.map(p => `'${p}'`).join(' ')}
2. Commit to dev (do NOT push, do NOT merge, do NOT close the issue). Message style like the repo's recent commits ("#${num} <concise summary>"), ending with:
   Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
3. Verify 'git status' still shows the owner's other files as before (you touched nothing else).
4. ${itemId ? `Move project item ${itemId} to Status "In review": gh project item-edit --project-id ${PROJECT_ID} --id ${itemId} --field-id ${STATUS_FIELD} --single-select-option-id ${OPT_INREVIEW}.` : ''}
5. Post ONE comment on #${num} prefixed "🌙 overnight (in review) — " with a 1-3 line summary + the commit sha.
Return committed + sha.`,
    { label: `commit-#${num}`, phase: 'Implement', schema: {
      type: 'object', additionalProperties: false, required: ['committed'],
      properties: { committed: { type: 'boolean' }, sha: { type: 'string' } } } }
  )
  if (commit?.committed) { done.push({ number: num, sha: commit.sha }); log(`#${num} -> In review (${commit.sha || 'committed'})`) }
  else failed.push({ number: num, reason: 'commit step failed' })
}

log(`Sweep complete. In review: ${done.map(d => '#' + d.number).join(', ') || '(none)'} | Parked/failed: ${[...(plan.parked || []).map(p => '#' + p.number), ...failed.map(f => '#' + f.number)].join(', ') || '(none)'}`)
return { done, failed, parked: plan.parked || [] }
