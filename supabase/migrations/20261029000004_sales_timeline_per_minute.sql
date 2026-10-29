-- Sales timeline in 1-minute buckets (UTC-aligned) for the dashboard and report charts.
-- Kept as its own function so get_dashboard (and its 15-minute 'timeline') stays untouched.
create or replace function public.get_sales_timeline() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_team();
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
             'bucket', b.bucket, 'transactions', b.txns, 'tickets', b.tickets, 'bars', b.bars) order by b.bucket), '[]'::jsonb)
    from (
      select date_bin('1 minute', created_at, timestamptz '2000-01-01 00:00:00+00') as bucket,
             count(*)::int as txns, sum(total_tickets)::int as tickets, sum(total_bars)::int as bars
      from public.transactions where status = 'completed'
      group by 1
    ) b
  );
end $$;

revoke execute on function public.get_sales_timeline() from public, anon;
grant execute on function public.get_sales_timeline() to authenticated;
