-- Supabase loads pg_safeupdate, which rejects DELETE without WHERE.
-- Re-creates reset_event_data with explicit WHERE clauses.
-- Clears rehearsal data before the real event. Keeps products, settings, team and the audit log.
create or replace function public.reset_event_data(p_confirmation text)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_txns int;
  v_adjs int;
begin
  perform private.require_admin();
  if p_confirmation is distinct from 'RESET ALL SALES' then
    perform private.fail('CONFIRMATION_REQUIRED', 'Type RESET ALL SALES to confirm.');
  end if;
  perform private.lock_event();
  select count(*) into v_txns from public.transactions;
  select count(*) into v_adjs from public.inventory_adjustments;
  delete from public.transactions where true;  -- Supabase pg_safeupdate rejects a bare DELETE
  delete from public.inventory_adjustments where true;
  update public.event_settings set sales_started_at = null, updated_at = clock_timestamp() where id = 1;
  insert into public.audit_log (actor_id, action, entity, entity_id, details)
  values (auth.uid(), 'event_data_reset', 'event_settings', '1',
          jsonb_build_object('transactions_deleted', v_txns, 'adjustments_deleted', v_adjs));
  perform private.bump_ticker();
  return private.inventory_snapshot();
end $$;

