-- Battle of the Brands: server-side business logic.
--
-- Every function here is SECURITY DEFINER with an empty search_path and checks the
-- caller's role itself. Clients cannot write to any table directly (see schema migration).
-- Errors are raised with a stable machine-readable code in MESSAGE and a human sentence
-- in DETAIL, which the web app shows as-is.

-- ---------------------------------------------------------------------------
-- Internal helpers
-- ---------------------------------------------------------------------------
create or replace function private.fail(p_code text, p_detail text) returns void
language plpgsql as $$
begin
  raise exception using errcode = 'P0001', message = p_code, detail = p_detail;
end $$;

create or replace function private.bump_ticker() returns void
language sql security definer set search_path = '' as $$
  update public.live_ticker set version = version + 1, updated_at = clock_timestamp() where id = 1;
$$;

-- Ledger-based inventory. Definitions:
--   available_total = initial + adjustments_in - adjustments_out
--   remaining       = available_total - bars_sold (completed transactions only)
--   pct_sold        = bars_sold / available_total * 100 (0 when available_total = 0)
create or replace function private.inventory_snapshot() returns jsonb
language sql stable security definer set search_path = '' as $$
  with s as (select initial_inventory from public.event_settings where id = 1),
  a as (
    select coalesce(sum(delta) filter (where delta > 0), 0)::int as adj_in,
           coalesce(-sum(delta) filter (where delta < 0), 0)::int as adj_out
    from public.inventory_adjustments
  ),
  t as (
    select coalesce(sum(total_bars), 0)::int as sold, count(*)::int as txns
    from public.transactions where status = 'completed'
  )
  select jsonb_build_object(
    'initial', s.initial_inventory,
    'adjustments_in', a.adj_in,
    'adjustments_out', a.adj_out,
    'available_total', s.initial_inventory + a.adj_in - a.adj_out,
    'bars_sold', t.sold,
    'remaining', s.initial_inventory + a.adj_in - a.adj_out - t.sold,
    'pct_sold', case when s.initial_inventory + a.adj_in - a.adj_out > 0
                     then round(t.sold::numeric * 100 / (s.initial_inventory + a.adj_in - a.adj_out), 1)
                     else 0 end,
    'transactions', t.txns
  )
  from s, a, t
$$;

create or replace function private.bars_remaining() returns integer
language sql stable security definer set search_path = '' as $$
  select (private.inventory_snapshot() ->> 'remaining')::int
$$;

create or replace function private.require_team() returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null then
    perform private.fail('NOT_AUTHENTICATED', 'Please sign in.');
  end if;
  if not private.is_team_member() then
    perform private.fail('NOT_AUTHORIZED', 'Your account is waiting for an admin to approve it.');
  end if;
end $$;

create or replace function private.require_admin() returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_team();
  if not private.is_admin() then
    perform private.fail('NOT_AUTHORIZED', 'Only admins can do this.');
  end if;
end $$;

-- Takes the event-wide lock that serializes every inventory-changing operation.
create or replace function private.lock_event() returns public.event_settings
language sql security definer set search_path = '' as $$
  select * from public.event_settings where id = 1 for update
$$;

create or replace function private.clean_reason(p_reason text) returns text
language plpgsql immutable as $$
declare
  v text := btrim(regexp_replace(coalesce(p_reason, ''), '\s+', ' ', 'g'));
begin
  if char_length(v) < 3 or char_length(v) > 300 then
    perform private.fail('REASON_REQUIRED', 'Enter a reason between 3 and 300 characters.');
  end if;
  return v;
end $$;

-- One transaction as the JSON shape the app uses everywhere (history, export, details).
create or replace function private.txn_json(p_id bigint) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', t.id,
    'created_at', t.created_at,
    'netid', t.netid,
    'customer_name', t.customer_name,
    'customer_category', t.customer_category,
    'items', coalesce((
      select jsonb_object_agg(i.product_id, i.quantity) from public.transaction_items i where i.transaction_id = t.id
    ), '{}'::jsonb),
    'total_bars', t.total_bars,
    'total_tickets', t.total_tickets,
    'seller_id', t.seller_id,
    'seller_name', s.display_name,
    'status', t.status,
    'voided_at', t.voided_at,
    'voided_by_name', v.display_name,
    'void_reason', t.void_reason
  )
  from public.transactions t
  join public.profiles s on s.id = t.seller_id
  left join public.profiles v on v.id = t.voided_by
  where t.id = p_id
$$;

revoke execute on all functions in schema private from public;
grant execute on function private.my_role(), private.is_team_member(), private.is_admin() to authenticated;

-- ---------------------------------------------------------------------------
-- Sales
-- ---------------------------------------------------------------------------
-- p_items: {"single_bar": 1, "week_pack": 0, "exam_week_bundle": 2}
-- Idempotent on p_client_request_id: a retry returns the original sale with duplicate_request = true.
create or replace function public.record_sale(
  p_client_request_id uuid,
  p_netid text,
  p_items jsonb,
  p_customer_name text default null,
  p_customer_category text default null,
  p_confirm_duplicate boolean default false
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_settings public.event_settings;
  v_existing public.transactions;
  v_recent public.transactions;
  v_product public.products;
  v_netid text;
  v_name text;
  v_category public.customer_category;
  v_key text;
  v_val jsonb;
  v_qty int;
  v_bars int := 0;
  v_tickets int := 0;
  v_remaining int;
  v_id bigint;
begin
  perform private.require_team();
  if p_client_request_id is null then
    perform private.fail('INVALID_REQUEST', 'Missing request id.');
  end if;

  -- Serialize with every other sale, void and adjustment.
  v_settings := private.lock_event();

  select * into v_existing from public.transactions where client_request_id = p_client_request_id;
  if found then
    if v_existing.seller_id <> v_uid then
      perform private.fail('INVALID_REQUEST', 'This request id was already used.');
    end if;
    return jsonb_build_object(
      'duplicate_request', true,
      'transaction', private.txn_json(v_existing.id),
      'inventory', private.inventory_snapshot()
    );
  end if;

  v_netid := regexp_replace(lower(btrim(coalesce(p_netid, ''))), '@cornell\.edu$', '');
  if v_netid !~ '^[a-z]{1,4}[0-9]{1,6}$' then
    perform private.fail('INVALID_NETID', 'Enter a valid Cornell NetID, for example abc123.');
  end if;

  v_name := nullif(btrim(regexp_replace(coalesce(p_customer_name, ''), '\s+', ' ', 'g')), '');
  if v_name is not null and char_length(v_name) > 80 then
    perform private.fail('INVALID_NAME', 'Customer name must be 80 characters or fewer.');
  end if;

  if nullif(p_customer_category, '') is not null then
    if p_customer_category not in ('first_year_mba', 'second_year_mba', 'faculty', 'other_unknown') then
      perform private.fail('INVALID_CATEGORY', 'Unknown customer category.');
    end if;
    v_category := p_customer_category::public.customer_category;
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'object' then
    perform private.fail('INVALID_ITEMS', 'Select at least one product.');
  end if;

  for v_key, v_val in select key, value from jsonb_each(p_items) loop
    if not exists (select 1 from public.products where id = v_key) then
      perform private.fail('UNKNOWN_PRODUCT', format('Unknown product "%s".', v_key));
    end if;
    if jsonb_typeof(v_val) <> 'number'
       or (v_val::text)::numeric <> trunc((v_val::text)::numeric)
       or (v_val::text)::numeric < 0
       or (v_val::text)::numeric > 100 then
      perform private.fail('INVALID_QUANTITY', 'Quantities must be whole numbers from 0 to 100.');
    end if;
  end loop;

  for v_product in select * from public.products order by sort_order loop
    v_qty := coalesce(((p_items ->> v_product.id)::numeric)::int, 0);
    if v_qty > 0 then
      if not v_product.active then
        perform private.fail('PRODUCT_UNAVAILABLE', format('%s is not available right now.', v_product.name));
      end if;
      v_bars := v_bars + v_qty * v_product.bars_per_unit;
      v_tickets := v_tickets + v_qty * v_product.tickets_per_unit;
    end if;
  end loop;

  if v_bars = 0 then
    perform private.fail('EMPTY_SALE', 'Select at least one product.');
  end if;

  if not coalesce(p_confirm_duplicate, false) and v_settings.duplicate_window_seconds > 0 then
    select * into v_recent from public.transactions
    where netid = v_netid and status = 'completed'
      and created_at > clock_timestamp() - make_interval(secs => v_settings.duplicate_window_seconds)
    order by created_at desc limit 1;
    if found then
      perform private.fail('POSSIBLE_DUPLICATE', jsonb_build_object(
        'message', format('%s already bought %s tickets'' worth a moment ago (sale #%s).', v_netid, v_recent.total_tickets, v_recent.id),
        'transaction_id', v_recent.id,
        'created_at', v_recent.created_at,
        'total_tickets', v_recent.total_tickets
      )::text);
    end if;
  end if;

  v_remaining := private.bars_remaining();
  if v_bars > v_remaining then
    perform private.fail('INSUFFICIENT_STOCK',
      format('Only %s bars left, and this sale needs %s.', v_remaining, v_bars));
  end if;

  insert into public.transactions (client_request_id, created_at, seller_id, netid, customer_name, customer_category, total_bars, total_tickets)
  values (p_client_request_id, clock_timestamp(), v_uid, v_netid, v_name, v_category, v_bars, v_tickets)
  returning id into v_id;

  insert into public.transaction_items (transaction_id, product_id, quantity, bars_per_unit, tickets_per_unit)
  select v_id, p.id, ((p_items ->> p.id)::numeric)::int, p.bars_per_unit, p.tickets_per_unit
  from public.products p
  where coalesce(((p_items ->> p.id)::numeric)::int, 0) > 0;

  update public.event_settings set sales_started_at = coalesce(sales_started_at, clock_timestamp()) where id = 1;
  perform private.bump_ticker();

  return jsonb_build_object(
    'duplicate_request', false,
    'transaction', private.txn_json(v_id),
    'inventory', private.inventory_snapshot()
  );
end $$;

-- Admins can void any sale. Sellers can undo their own sale within seller_undo_minutes.
create or replace function public.void_transaction(p_transaction_id bigint, p_reason text)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_settings public.event_settings;
  v_txn public.transactions;
  v_reason text;
begin
  perform private.require_team();
  v_reason := private.clean_reason(p_reason);
  v_settings := private.lock_event();

  select * into v_txn from public.transactions where id = p_transaction_id for update;
  if not found then
    perform private.fail('NOT_FOUND', format('Sale #%s does not exist.', p_transaction_id));
  end if;
  if v_txn.status = 'voided' then
    perform private.fail('ALREADY_VOIDED', format('Sale #%s was already voided.', p_transaction_id));
  end if;
  if not private.is_admin() and (
       v_txn.seller_id <> v_uid
       or v_txn.created_at < clock_timestamp() - make_interval(mins => v_settings.seller_undo_minutes)
     ) then
    perform private.fail('NOT_AUTHORIZED', format(
      'Sellers can undo only their own sales within %s minutes. Ask an admin to void this one.',
      v_settings.seller_undo_minutes));
  end if;

  update public.transactions
  set status = 'voided', voided_at = clock_timestamp(), voided_by = v_uid, void_reason = v_reason
  where id = p_transaction_id;

  insert into public.audit_log (actor_id, action, entity, entity_id, details)
  values (v_uid, 'transaction_voided', 'transaction', p_transaction_id::text, jsonb_build_object(
    'reason', v_reason, 'bars_restored', v_txn.total_bars, 'tickets_removed', v_txn.total_tickets,
    'original_seller_id', v_txn.seller_id));

  perform private.bump_ticker();
  return jsonb_build_object('transaction', private.txn_json(p_transaction_id), 'inventory', private.inventory_snapshot());
end $$;

-- ---------------------------------------------------------------------------
-- Admin: inventory and configuration
-- ---------------------------------------------------------------------------
create or replace function public.set_initial_inventory(p_value integer)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_settings public.event_settings;
  v_adjust int;
begin
  perform private.require_admin();
  v_settings := private.lock_event();
  if v_settings.sales_started_at is not null or exists (select 1 from public.transactions) then
    perform private.fail('SALES_STARTED', 'Sales have started. Use an inventory adjustment (restock or correction) instead.');
  end if;
  if p_value is null or p_value < 0 or p_value > 100000 then
    perform private.fail('INVALID_VALUE', 'Initial inventory must be between 0 and 100000 bars.');
  end if;
  select coalesce(sum(delta), 0) into v_adjust from public.inventory_adjustments;
  if p_value + v_adjust < 0 then
    perform private.fail('NEGATIVE_INVENTORY', 'That would make inventory negative.');
  end if;

  update public.event_settings set initial_inventory = p_value, updated_at = clock_timestamp() where id = 1;
  insert into public.audit_log (actor_id, action, entity, entity_id, details)
  values (auth.uid(), 'initial_inventory_set', 'event_settings', '1',
          jsonb_build_object('from', v_settings.initial_inventory, 'to', p_value));
  perform private.bump_ticker();
  return private.inventory_snapshot();
end $$;

create or replace function public.adjust_inventory(p_kind text, p_delta integer, p_reason text)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_reason text;
  v_remaining int;
  v_id bigint;
begin
  perform private.require_admin();
  v_reason := private.clean_reason(p_reason);
  if p_kind not in ('restock', 'correction') then
    perform private.fail('INVALID_KIND', 'Adjustment kind must be restock or correction.');
  end if;
  if p_delta is null or p_delta = 0 or abs(p_delta) > 100000 then
    perform private.fail('INVALID_VALUE', 'Enter a non-zero number of bars.');
  end if;
  if p_kind = 'restock' and p_delta < 0 then
    perform private.fail('INVALID_VALUE', 'A restock must add bars. Use a correction to remove bars.');
  end if;

  perform private.lock_event();
  v_remaining := private.bars_remaining();
  if v_remaining + p_delta < 0 then
    perform private.fail('NEGATIVE_INVENTORY', format('Only %s bars remain; cannot remove %s.', v_remaining, -p_delta));
  end if;

  insert into public.inventory_adjustments (created_by, kind, delta, reason)
  values (auth.uid(), p_kind::public.adjustment_kind, p_delta, v_reason)
  returning id into v_id;
  insert into public.audit_log (actor_id, action, entity, entity_id, details)
  values (auth.uid(), 'inventory_adjusted', 'inventory_adjustment', v_id::text,
          jsonb_build_object('kind', p_kind, 'delta', p_delta, 'reason', v_reason,
                             'remaining_before', v_remaining, 'remaining_after', v_remaining + p_delta));
  perform private.bump_ticker();
  return private.inventory_snapshot();
end $$;

create or replace function public.set_product_active(p_product_id text, p_active boolean)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_product public.products;
begin
  perform private.require_admin();
  perform private.lock_event();
  select * into v_product from public.products where id = p_product_id for update;
  if not found then
    perform private.fail('NOT_FOUND', 'Unknown product.');
  end if;
  update public.products set active = coalesce(p_active, false) where id = p_product_id;
  insert into public.audit_log (actor_id, action, entity, entity_id, details)
  values (auth.uid(), 'product_availability_changed', 'product', p_product_id,
          jsonb_build_object('from', v_product.active, 'to', coalesce(p_active, false)));
  perform private.bump_ticker();
  return jsonb_build_object('id', p_product_id, 'active', coalesce(p_active, false));
end $$;

create or replace function public.set_member_role(p_user_id uuid, p_role text)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_profile public.profiles;
begin
  perform private.require_admin();
  if p_role not in ('pending', 'seller', 'admin') then
    perform private.fail('INVALID_ROLE', 'Role must be pending, seller or admin.');
  end if;
  perform private.lock_event();
  select * into v_profile from public.profiles where id = p_user_id for update;
  if not found then
    perform private.fail('NOT_FOUND', 'Unknown team member.');
  end if;
  if v_profile.role = 'admin' and p_role <> 'admin'
     and (select count(*) from public.profiles where role = 'admin') = 1 then
    perform private.fail('LAST_ADMIN', 'The event needs at least one admin.');
  end if;
  update public.profiles set role = p_role::public.app_role where id = p_user_id;
  insert into public.audit_log (actor_id, action, entity, entity_id, details)
  values (auth.uid(), 'member_role_changed', 'profile', p_user_id::text,
          jsonb_build_object('from', v_profile.role, 'to', p_role, 'member', v_profile.display_name));
  return jsonb_build_object('id', p_user_id, 'role', p_role);
end $$;

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

-- ---------------------------------------------------------------------------
-- Reads
-- ---------------------------------------------------------------------------
create or replace function public.get_my_profile() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', p.id, 'email', p.email, 'display_name', p.display_name, 'role', p.role)
  from public.profiles p where p.id = auth.uid()
$$;

-- What the sales screen needs: inventory, products with per-product sales, settings.
create or replace function public.get_live_state() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_team();
  return jsonb_build_object(
    'version', (select version from public.live_ticker where id = 1),
    'inventory', private.inventory_snapshot(),
    'settings', (select jsonb_build_object(
        'event_name', s.event_name, 'timezone', s.timezone, 'initial_inventory', s.initial_inventory,
        'sales_started_at', s.sales_started_at, 'duplicate_window_seconds', s.duplicate_window_seconds,
        'seller_undo_minutes', s.seller_undo_minutes)
      from public.event_settings s where s.id = 1),
    'products', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', p.id, 'name', p.name, 'tagline', p.tagline,
        'bars_per_unit', p.bars_per_unit, 'tickets_per_unit', p.tickets_per_unit,
        'active', p.active, 'sort_order', p.sort_order,
        'packages_sold', coalesce(x.packages, 0), 'bars_sold', coalesce(x.bars, 0),
        'tickets', coalesce(x.tickets, 0), 'transactions_with', coalesce(x.txns, 0)
      ) order by p.sort_order), '[]'::jsonb)
      from public.products p
      left join (
        select i.product_id, sum(i.quantity)::int as packages, sum(i.bars)::int as bars,
               sum(i.tickets)::int as tickets, count(distinct i.transaction_id)::int as txns
        from public.transaction_items i
        join public.transactions t on t.id = i.transaction_id and t.status = 'completed'
        group by i.product_id
      ) x on x.product_id = p.id
    )
  );
end $$;

-- Dashboard aggregates. All figures exclude voided transactions.
-- Customer category: each NetID is assigned the most recent category it gave on any completed
-- sale; NetIDs that never gave one are 'not_specified'. That way customers, transactions and
-- tickets per category each add up exactly to the overall totals.
create or replace function public.get_dashboard() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_state jsonb;
  v_kpis jsonb;
begin
  perform private.require_team();
  v_state := public.get_live_state();

  select jsonb_build_object(
    'total_tickets', coalesce(sum(total_tickets), 0)::int,
    'total_bars', coalesce(sum(total_bars), 0)::int,
    'transactions', count(*)::int,
    'unique_customers', count(distinct netid)::int,
    'avg_tickets_per_transaction', case when count(*) > 0 then round(sum(total_tickets)::numeric / count(*), 2) else 0 end,
    'avg_bars_per_transaction', case when count(*) > 0 then round(sum(total_bars)::numeric / count(*), 2) else 0 end,
    'first_sale_at', min(created_at),
    'last_sale_at', max(created_at)
  ) into v_kpis
  from public.transactions where status = 'completed';

  return v_state || jsonb_build_object(
    'kpis', v_kpis,
    'voided', (select jsonb_build_object('count', count(*)::int,
                 'bars', coalesce(sum(total_bars), 0)::int, 'tickets', coalesce(sum(total_tickets), 0)::int)
               from public.transactions where status = 'voided'),
    'categories', (
      with cust as (
        select netid,
               (array_agg(customer_category order by created_at desc)
                  filter (where customer_category is not null))[1] as category,
               count(*) as txns, sum(total_tickets) as tickets, sum(total_bars) as bars
        from public.transactions where status = 'completed'
        group by netid
      ),
      cats(key, ord) as (values ('first_year_mba', 1), ('second_year_mba', 2), ('faculty', 3),
                                ('other_unknown', 4), ('not_specified', 5))
      select jsonb_agg(jsonb_build_object(
               'category', cats.key,
               'customers', coalesce(g.customers, 0), 'transactions', coalesce(g.txns, 0),
               'tickets', coalesce(g.tickets, 0), 'bars', coalesce(g.bars, 0)) order by cats.ord)
      from cats
      left join (
        select coalesce(category::text, 'not_specified') as key, count(*)::int as customers,
               sum(txns)::int as txns, sum(tickets)::int as tickets, sum(bars)::int as bars
        from cust group by 1
      ) g on g.key = cats.key
    ),
    -- 15-minute buckets (UTC-aligned); the app rolls them up to hours for long events.
    'timeline', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'bucket', b.bucket, 'transactions', b.txns, 'tickets', b.tickets, 'bars', b.bars) order by b.bucket), '[]'::jsonb)
      from (
        select date_bin('15 minutes', created_at, timestamptz '2000-01-01 00:00:00+00') as bucket,
               count(*)::int as txns, sum(total_tickets)::int as tickets, sum(total_bars)::int as bars
        from public.transactions where status = 'completed'
        group by 1
      ) b
    )
  );
end $$;

-- Final report: dashboard plus the void and adjustment trail. Contains no NetIDs or names.
create or replace function public.get_report() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_team();
  return public.get_dashboard() || jsonb_build_object(
    'generated_at', clock_timestamp(),
    'voided_transactions', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', t.id, 'created_at', t.created_at, 'voided_at', t.voided_at,
        'total_bars', t.total_bars, 'total_tickets', t.total_tickets, 'void_reason', t.void_reason,
        'seller_name', s.display_name, 'voided_by_name', v.display_name) order by t.id), '[]'::jsonb)
      from public.transactions t
      join public.profiles s on s.id = t.seller_id
      left join public.profiles v on v.id = t.voided_by
      where t.status = 'voided'
    ),
    'adjustments', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', a.id, 'created_at', a.created_at, 'kind', a.kind, 'delta', a.delta,
        'reason', a.reason, 'created_by_name', p.display_name) order by a.id), '[]'::jsonb)
      from public.inventory_adjustments a
      join public.profiles p on p.id = a.created_by
    )
  );
end $$;

-- Searchable, filterable history. Sellers only ever see their own sales.
create or replace function public.list_transactions(
  p_search text default null,
  p_status text default null,
  p_product text default null,
  p_category text default null,
  p_seller uuid default null,
  p_from timestamptz default null,
  p_to timestamptz default null,
  p_limit integer default 50,
  p_offset integer default 0
) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_seller uuid := p_seller;
  v_search text := nullif(lower(btrim(coalesce(p_search, ''))), '');
  v_total int;
  v_rows jsonb;
begin
  perform private.require_team();
  if not private.is_admin() then
    v_seller := auth.uid();
  end if;

  with filtered as (
    select t.id, t.created_at from public.transactions t
    where (v_search is null or position(v_search in t.netid) > 0
           or position(v_search in lower(coalesce(t.customer_name, ''))) > 0)
      and (p_status is null or p_status = '' or t.status::text = p_status)
      and (p_product is null or p_product = '' or exists (
             select 1 from public.transaction_items i where i.transaction_id = t.id and i.product_id = p_product))
      and (p_category is null or p_category = ''
           or (p_category = 'not_specified' and t.customer_category is null)
           or t.customer_category::text = p_category)
      and (v_seller is null or t.seller_id = v_seller)
      and (p_from is null or t.created_at >= p_from)
      and (p_to is null or t.created_at < p_to)
  )
  select (select count(*) from filtered)::int,
         coalesce((select jsonb_agg(private.txn_json(f.id) order by f.created_at desc, f.id desc)
                   from (select * from filtered order by created_at desc, id desc
                         limit least(greatest(coalesce(p_limit, 50), 1), 500)
                         offset greatest(coalesce(p_offset, 0), 0)) f), '[]'::jsonb)
  into v_total, v_rows;

  return jsonb_build_object('total', v_total, 'rows', v_rows);
end $$;

-- Every transaction (completed and voided) for CSV export. Admin only.
create or replace function public.export_transactions() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_admin();
  return coalesce((select jsonb_agg(private.txn_json(t.id) order by t.id) from public.transactions t), '[]'::jsonb);
end $$;

create or replace function public.get_admin_state() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_admin();
  return jsonb_build_object(
    'members', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', p.id, 'email', p.email, 'display_name', p.display_name, 'role', p.role, 'created_at', p.created_at,
        'sales', (select count(*) from public.transactions t where t.seller_id = p.id and t.status = 'completed'))
        order by (p.role = 'pending') desc, p.created_at), '[]'::jsonb)
      from public.profiles p
    ),
    'adjustments', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', a.id, 'created_at', a.created_at, 'kind', a.kind, 'delta', a.delta,
        'reason', a.reason, 'created_by_name', p.display_name) order by a.id desc), '[]'::jsonb)
      from public.inventory_adjustments a join public.profiles p on p.id = a.created_by
    ),
    'audit', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', l.id, 'created_at', l.created_at, 'action', l.action, 'entity', l.entity,
        'entity_id', l.entity_id, 'details', l.details, 'actor_name', p.display_name) order by l.id desc), '[]'::jsonb)
      from (select * from public.audit_log order by id desc limit 300) l
      left join public.profiles p on p.id = l.actor_id
    )
  );
end $$;

-- ---------------------------------------------------------------------------
-- Grants: only signed-in users may call the API; each function checks the role.
-- ---------------------------------------------------------------------------
revoke execute on all functions in schema public from public, anon;
grant execute on function
  public.record_sale(uuid, text, jsonb, text, text, boolean),
  public.void_transaction(bigint, text),
  public.set_initial_inventory(integer),
  public.adjust_inventory(text, integer, text),
  public.set_product_active(text, boolean),
  public.set_member_role(uuid, text),
  public.reset_event_data(text),
  public.get_my_profile(),
  public.get_live_state(),
  public.get_dashboard(),
  public.get_report(),
  public.list_transactions(text, text, text, text, uuid, timestamptz, timestamptz, integer, integer),
  public.export_transactions(),
  public.get_admin_state()
to authenticated;
