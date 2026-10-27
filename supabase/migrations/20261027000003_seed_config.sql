-- Product configuration and initial inventory. This is configuration, not sales data:
-- the database starts with zero transactions.
insert into public.event_settings (id, event_name, initial_inventory, timezone)
values (1, 'Cornell MBA Battle of the Brands', 200, 'America/New_York')
on conflict (id) do nothing;

insert into public.live_ticker (id, version) values (1, 0) on conflict (id) do nothing;

insert into public.products (id, name, tagline, bars_per_unit, tickets_per_unit, active, sort_order) values
  ('single_bar',       'Single Bar',       '1 protein bar',  1, 3, true, 1),
  ('week_pack',        'Week Pack',        '3 protein bars', 3, 6, true, 2),
  ('exam_week_bundle', 'Exam Week Bundle', '5 protein bars', 5, 8, true, 3)
on conflict (id) do nothing;
