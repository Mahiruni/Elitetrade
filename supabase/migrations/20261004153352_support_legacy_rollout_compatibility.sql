-- Keep the existing deployed support API functional while the reviewed code
-- awaits deployment. Ownership/sender RLS and the message guard still apply.
grant insert,update on public.elitetrade_conversations to authenticated;
grant insert on public.elitetrade_messages to authenticated;
-- After deploying the new RPC-based server, execute db/support-finalize.sql.
