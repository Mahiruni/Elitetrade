-- Run only AFTER the support workspace branch has been approved and deployed.
-- New server routes use the authorization-checked elitetrade_support RPC.
begin;
revoke insert,update,delete on public.elitetrade_messages from authenticated;
revoke insert,update,delete on public.elitetrade_conversations from authenticated;
commit;
