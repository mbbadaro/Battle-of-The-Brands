-- Lets admins change how many bars and tickets each package has.
-- Past sales keep the values they were sold at: transaction_items snapshots
-- bars_per_unit and tickets_per_unit when the sale is recorded.
create or replace function public.set_product_package(p_product_id text, p_bars integer, p_tickets integer)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_product public.products;
begin
  perform private.require_admin();
  if p_bars is null or p_bars not between 1 and 100 then
    perform private.fail('INVALID_PACKAGE', 'Bars per package must be a whole number from 1 to 100.');
  end if;
  if p_tickets is null or p_tickets not between 1 and 10000 then
    perform private.fail('INVALID_PACKAGE', 'Tickets per package must be a whole number from 1 to 10000.');
  end if;
  -- Serialize with sales so a sale uses either the old or the new package, never a mix.
  perform private.lock_event();
  select * into v_product from public.products where id = p_product_id for update;
  if not found then
    perform private.fail('NOT_FOUND', 'Unknown product.');
  end if;
  if v_product.bars_per_unit = p_bars and v_product.tickets_per_unit = p_tickets then
    return jsonb_build_object('id', p_product_id, 'bars_per_unit', p_bars, 'tickets_per_unit', p_tickets, 'changed', false);
  end if;
  update public.products
  set bars_per_unit = p_bars,
      tickets_per_unit = p_tickets,
      tagline = format('%s protein bar%s', p_bars, case when p_bars = 1 then '' else 's' end)
  where id = p_product_id;
  insert into public.audit_log (actor_id, action, entity, entity_id, details)
  values (auth.uid(), 'product_package_changed', 'product', p_product_id,
          jsonb_build_object('name', v_product.name,
                             'bars_from', v_product.bars_per_unit, 'bars_to', p_bars,
                             'tickets_from', v_product.tickets_per_unit, 'tickets_to', p_tickets));
  perform private.bump_ticker();
  return jsonb_build_object('id', p_product_id, 'bars_per_unit', p_bars, 'tickets_per_unit', p_tickets, 'changed', true);
end $$;

revoke execute on function public.set_product_package(text, integer, integer) from public, anon;
grant execute on function public.set_product_package(text, integer, integer) to authenticated;

-- Sale JSON now also carries the package sizes each item was sold at, so the
-- history detail shows the recorded values instead of today's package.
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
    'item_units', coalesce((
      select jsonb_object_agg(i.product_id, jsonb_build_object('bars', i.bars_per_unit, 'tickets', i.tickets_per_unit))
      from public.transaction_items i where i.transaction_id = t.id
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
revoke execute on function private.txn_json(bigint) from public;
