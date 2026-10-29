-- Makes the customer NetID optional when recording a sale.
-- * transactions.netid accepts null (the format check still applies when it is set).
-- * record_sale treats a blank NetID as null and skips the duplicate-NetID prompt for it.
-- * get_dashboard counts each sale without a NetID as its own customer, so customers per
--   category still add up to unique_customers.

alter table public.transactions alter column netid drop not null;

-- Sales: p_netid may be null or blank.
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

  -- NetID is optional: blank means no NetID, anything else must look like one.
  v_netid := nullif(regexp_replace(lower(btrim(coalesce(p_netid, ''))), '@cornell\.edu$', ''), '');
  if v_netid is not null and v_netid !~ '^[a-z]{1,4}[0-9]{1,6}$' then
    perform private.fail('INVALID_NETID', 'Enter a valid Cornell NetID (for example abc123) or leave it blank.');
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

  if v_netid is not null and not coalesce(p_confirm_duplicate, false) and v_settings.duplicate_window_seconds > 0 then
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

-- Dashboard aggregates. All figures exclude voided transactions.
-- Customer category: each NetID is assigned the most recent category it gave on any completed
-- sale; NetIDs that never gave one are 'not_specified'. A sale without a NetID is its own
-- customer. That way customers, transactions and tickets per category each add up exactly to
-- the overall totals.
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
    'unique_customers', count(distinct coalesce(netid, '#' || id))::int,
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
        select coalesce(netid, '#' || id) as customer,
               (array_agg(customer_category order by created_at desc)
                  filter (where customer_category is not null))[1] as category,
               count(*) as txns, sum(total_tickets) as tickets, sum(total_bars) as bars
        from public.transactions where status = 'completed'
        group by 1
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
