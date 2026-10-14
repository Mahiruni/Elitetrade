// Access to the saved MetaApi account must be scoped to the authenticated
// bot owner. Admin fallback bypasses ONLY browser-specific Supabase RLS on an
// already device-verified admin request; it never changes the saved account
// status, upgrades a pending account, or bypasses broker DEMO verification.
const q=encodeURIComponent;
export async function loadSelectedDemoAccount({db,engineDb,accountId,userId,token,admin=false}) {
  if(!/^[a-f0-9-]{36}$/i.test(String(accountId||'')) || !/^[a-f0-9-]{36}$/i.test(String(userId||'')))return null;
  const filter=`id=eq.${q(accountId)}&user_id=eq.${q(userId)}&select=id,user_id,gateway_id,status`;
  const member=await db.one('elitetrade_accounts',filter,token);
  if(member) return member.user_id===userId ? member : null;
  if(!admin||!engineDb)return null;
  const privileged=await engineDb.one('elitetrade_accounts',filter);
  return privileged?.user_id===userId ? privileged : null;
}
