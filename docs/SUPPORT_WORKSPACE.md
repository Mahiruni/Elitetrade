# EliteTrade support workspace

Customer route: `/support`. Administrator route: `/admin/support`. Both use the approved EliteBot logo and existing English-only app navigation. Signed-in users receive the new workspace; existing guest text conversations remain supported without exposing signed-in customer data.

## Delivered behavior

- Charcoal/gold and complete light styles, compact inbox and participant header, mobile list/conversation switching, collapsible details, searchable authorized conversations, unread/assigned/unassigned/resolved filters.
- New conversation categories, reference numbers, assignment, configurable priority/category labels, open/waiting/resolved states, reopening, editable saved replies, private internal notes, resolution ratings.
- Multiline growing composer, optional expanded writing, desktop Enter/Shift+Enter, native multiline typing on mobile, 20,000 UTF-16 code units consistently enforced at API and database boundaries. Near-limit character counter.
- Drafts and pending client message IDs are stored per user/conversation/mode on the device and cleared on sign-out. Failed sends retain the draft and retry with the same message UUID; database uniqueness handles duplicate requests. Successful server persistence is labeled **Sent**. **Read** requires the other party's authenticated read cursor. No fabricated delivered receipt.
- JPG/JPEG, PNG, WebP, PDF, DOCX, TXT, CSV, XLSX: previews, upload progress, cancel/remove, private image thumbnails and keyboard-accessible preview dialog, document downloads with type/size metadata. Five files per message, configurable lower limits.
- Server size/extension/MIME/signature checks, safe generated storage object names, Office ZIP central-directory/content-type checks, macro/embedded/encrypted Office rejection, text-content checks. Files download with `Content-Disposition: attachment`, `nosniff`, no-store, and sandbox headers. No uploaded HTML is rendered.
- Whole-word NFKC moderation runs server-side. Legitimate complaints and substrings in broker/name/trading terms remain allowed. Admins manage the list and see repeat-block counts. Original rejected content is **never persisted**. Counts expire after 30 days; stale counts and presence records are cleaned on inbox reads.

## Database setup

Applied to the existing EliteTrade project `cgpvhayfwnpipktyltho`:

1. `supabase/migrations/20261004150911_support_workspace.sql`
2. `supabase/migrations/20261004151938_support_workspace_hardening.sql`
3. `supabase/migrations/20261004153352_support_legacy_rollout_compatibility.sql` temporarily restored legacy writes during the staged rollout.
4. `supabase/migrations/20261004154759_support_workspace_finalize.sql` removes those temporary grants after the RPC-based deployment is live.

Existing conversation/message rows remain in place. Message sequence, author, and deduplication fields are additive. Assignments, presence, read cursors, internal notes, attachment metadata, moderation configuration, and rate counters live in the unexposed `elitetrade_private` schema with RLS and no direct client table grants.

`public.elitetrade_support` is an authenticated invoker RPC delegating to an authorization-checked private function. It validates the existing browser-verification guard, current profile/disabled state, conversation ownership, and administrator privileges. Admin support follows the existing policy that administrators can access all support conversations. Customer APIs omit internal notes entirely. The final rollout revokes direct signed-in writes to the legacy conversation/message tables to prevent bypassing moderation/assignment/deduplication; authenticated legacy API writes in this branch call the RPC. The staged rollout temporarily retained the old deployment’s RLS-protected insert/update grants; those grants are now revoked in production. The legacy guest APIs retain their existing secret-cookie access model; a database trigger applies message moderation/length enforcement to their writes too.

SQLite automatically creates its additional support state tables for local development and isolated tests.

## Production rollout

PR #1 was authorized and merged into `main` on October 4, 2026, at commit `80ade537090c8f025ca79412d47b4fd2190c75c0`. Vercel deployment `dpl_wQjPSdDjf2WH74jAVcRpV36SEeQn` reached READY and was assigned to `https://elitetradee.vercel.app`. The live support JavaScript and CSS matched the tested assets; customer/admin page routes returned HTTP 200, health confirmed Supabase, and unauthenticated workspace requests returned HTTP 401.

The `support_workspace_finalize` database migration was then applied. Direct authenticated conversation/message writes are revoked, and the private attachment bucket remains nonpublic. Authenticated RPC rollback fixtures passed again after finalization and left no fixture users or conversations behind. The repository migration and `db/support-finalize.sql` record the same final restrictions.

For another environment, deploy the RPC-based API before finalizing grants. Revoking them while the old send/create handlers are still live breaks those handlers. Rollbacks to the old API require restoring the compatibility grants first; do not silently restore them while the new deployment is active.

## Storage and environment

The migration creates **private** bucket `elitetrade-support`, with a 20 MB storage limit and no customer object policies. The server uses existing `SUPABASE_SECRET_KEY` (or `SUPABASE_SERVICE_ROLE_KEY`) plus `SUPABASE_URL`. Keep these secrets server-only. The production Vercel environment already contains the required key and project URL.

Every image/download request is authenticated through the application and rechecks conversation membership and attachment ownership. Unsent files are visible only to their uploader; a sent file is visible to authorized participants. Downloads are streamed through this protected endpoint instead of publishing reusable storage URLs. There are no public storage links.

Vercel's proxy request limit is lower than 20 MB. This implementation advertises and enforces **3 MB per file on Vercel**. Other supported hosts permit up to 20 MB. To accept 20 MB on Vercel, add a separately hosted authenticated upload validator or an Edge Function with matching membership, signature, rate, and storage rules; do not bypass verification with public/direct uploads.

Local SQLite files use generated UUID names under `SUPPORT_FILES_PATH` (default `data/support-files`), with restrictive directory/file modes. This local directory is not served as a public asset.

Virus scanning is not configured and the UI does not claim files are scanned. No additional environment variables are required for text chat. Support hours, offline wording, word lists, saved replies, categories, priorities, and lower attachment limits are managed under **Support settings** in the admin inbox. Hours are descriptive configuration; the UI does not manufacture availability from a schedule.

Remove abandoned unsent attachment objects/metadata through a maintenance job after an appropriate retention window; automatic storage-orphan cleanup is not provisioned in this change.

## Updates, presence, and reconnection

The existing Supabase `/api/events` endpoint returns HTTP 204; it is not a working push connection. The workspace therefore uses one authenticated 2.5-second refresh loop, retains the existing SQLite SSE refresh events, and does not add a second websocket. UI updates recover missed messages by ascending sequence in 60-message pages, deduplicate by server ID, and retain loaded history while changing conversations. History is paginated; search queries the persisted conversation and returns the latest 60 matches.

Presence uses authenticated per-tab heartbeats, globally aggregates the authorized peer's availability, and scopes typing to the selected conversation. Heartbeats expire after 45 seconds; activity older than two minutes is Away. Leaving/disconnecting expires correctly across multiple tabs. Monotonic client heartbeat counters reject out-of-order presence writes. Typing is throttled to about 1.2 seconds, expires after five seconds, and sends only state, never draft text. Internal-note typing is not shown to customers. Missing/unconfirmed peer presence is **Status unavailable**.

Polling pauses for hidden tabs, reconnects on visibility/network recovery, and surfaces interrupted/offline states. Auto-scroll occurs only when already near the latest message. Earlier readers receive a jump/new-message control. Browser presence cannot prove someone is actively reading every individual message; read cursors record reaching the latest visible timeline in an active tab.

## Verification

- `npm run check`
- `npm test`: existing tests plus isolated support API/policy tests.
- `test/support-workspace.sql`: run against Supabase through an administrator connection. Uses clearly named temporary users/sessions, temporarily applies final write restrictions inside its rollback transaction, then verifies browser auth, 20k messages, deduplication, moderation/false positives, conversation isolation, direct-write denial, assignment, internal-note exclusion, read cursors, confirmed presence, resolution, and reopening; rolls back every fixture.
- `test/support-browser.mjs`: isolated SQLite server and two real browser sessions; replies/typing/reads, private notes, attachments, moderation, drafts/navigation, disconnect/recovery, responsive/theme and layout checks. Uses `CODEX_PRIMARY_RUNTIME_NODE_MODULES` for Playwright and optional `CHROMIUM_EXECUTABLE`.

Real Android/iOS keyboard and safe-area behavior should also be checked on physical devices. Malware-scanning, 20 MB Vercel uploads, and a true push transport remain optional infrastructure integrations; the working default uses validated private uploads within host limits and authenticated polling.
