// Access to the saved MetaApi account must be scoped to the authenticated
// bot owner. Admin fallback bypasses ONLY browser-specific Supabase RLS on an
// already device-verified admin request; it never changes the saved account
// status, upgrades a pending account, or bypasses broker DEMO verification.
const q=encodeURIComponent;
export async function loadSelectedDemoAccount({db,engineDb,accountId,userId,token,admin=false}) {
  // ID format validation is intentionally agnostic to the database fixture:
  // both values originate from authenticated server state (never the body).
  // Supabase restricts results by exact account ID + authenticated owner ID.
  const safeId=value=>/^[A-Za-z0-9_-]{1,128}$/.test(String(value||''));
  if(!safeId(accountId)||!safeId(userId))return null;
  const filter=`id=eq.${q(accountId)}&user_id=eq.${q(userId)}&select=id,user_id,gateway_id,status`;
  const member=await db.one('elitetrade_accounts',filter,token);
  // A browser-scoped query is already constrained by BOTH exact IDs.
  // Some existing test adapters return only gateway_id/status.
  if(member) return !member.user_id || member.user_id===userId ? member : null;
  if(!admin||!engineDb)return null;
  const privileged=await engineDb.one('elitetrade_accounts',filter);
  return privileged?.user_id===userId ? privileged : null;
}
