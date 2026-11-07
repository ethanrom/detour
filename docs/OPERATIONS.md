# Operating Detour

## Abuse protection

Three routes spend the owner's Amazon Bedrock credits: `POST /api/ground` (custom tasks), `POST /api/repair`
(heading and label suggestions) and `POST /api/fix` (the fix agents behind **Fix this page**). All pass through
`lib/llm/guard.ts` before any model call. Counters are kept in
memory, per server instance.

| Control | Default | What happens past it |
|---|---|---|
| `LLM_DISABLED=1` (env) | off | Kill switch. `/api/ground` answers 503 `llm-unavailable`; `/api/repair` answers the offline fallback (`source: "fallback"`); `/api/fix` streams deterministic template edits (`source: "fallback"`). The UI already handles all three. |
| `LLM_DAILY_CAP` (env) | 300 calls per UTC day per instance | Behaves like the kill switch until the next UTC day. |
| `LLM_RATE_LIMIT` (env, optional) | 10 calls per 10 minutes per IP (sliding window; IP from `x-forwarded-for`, first entry, else `x-real-ip`) | `/api/ground` answers 429 `rate-limited`; `/api/repair` answers the fallback report with `limited: true`. |
| Input limits | JSON body at most 1.5 MB and page at most 4,000 nodes (413); ground text at most 200 characters and repair at most 6 tasks (400); a fix run at most 5 fixes of at most 30 targets each (400) | Rejected before any model call. |
| Output cap | `maxTokens` 400 for ground, at most 512 for repair, 800 for a fix, never more than 1,024 | Set on every Converse call (`lib/llm/bedrock.ts`). |

A "call" is one request that reaches the model; a ground request makes up to 2 Bedrock calls, a repair request
up to about 18, and a fix run up to 10 (one per planned fix, run in parallel, plus at most one retry each). The
guard counts a fix run once, so the daily cap bounds runs, not Bedrock calls. The fix agents use the fast tier
(`CLAUDE_AWS_FAST_MODEL`, for example a Claude Haiku inference profile) and send no sampling parameters, because
that tier rejects `temperature`. `/api/fix` sets `maxDuration = 60` seconds, since each agent call may take up to
20 s. The demo sites (`northwind`, `riverside`, `alpine`) make none: `/api/repair` answers them from
`fixtures/repair/<siteId>.json` (`cached: true`), the report Claude proposed in one real run, as long as the page
still matches it. The Wording panel therefore costs nothing on the demo sites. To re-record a report, run
`repairPage` once against the real client and overwrite the file. `/api/fix` does the same for the demo sites from
`fixtures/fix/<siteId>.json` when every target's markup still matches. To record those, run the dev server with
keys and `LIVEFIX_RECORD=1`, then press **Fix this page** once on each demo site; the agent's edits are written
to the file (never in production builds).

Logs carry counts only (calls today, clients tracked), never request bodies, client addresses or credentials.

To switch the LLM off right now: set `LLM_DISABLED=1` in the Vercel project settings and redeploy. Custom tasks then
report that they need the LLM, and the rest of the site is unaffected.

### Limits of the in-memory counters

Vercel runs several instances under load and each has its own counters, so the per-IP window and the daily cap bound
each warm instance, not the whole fleet. Treat them as a speed bump and use the account-level controls below as the
real ceiling.

### Recommended account controls

1. Give the app its own IAM user, not an admin or personal key, with a policy that allows only
   `bedrock:InvokeModel` (the action the Converse API uses) on the one model or inference profile in
   `CLAUDE_AWS_MODEL` / `CLAUDE_AWS_FAST_MODEL`, in the one region in `CLAUDE_AWS_REGION`.
2. Create an AWS Budgets budget for Bedrock (a few dollars a month) with alerts at 50% and 80%, and a Budgets
   action at 100% that attaches a deny-all IAM policy to that user. Billing data lags by hours, so also keep the
   limits above.
3. After the event, delete the access key and unset the `CLAUDE_AWS_*` variables.
