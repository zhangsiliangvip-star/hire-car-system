-- Orders reference their vehicle by 車両番号 so vehicles may share a name.
alter table public.orders
  add column if not exists vehicle_plate text not null default '';

-- Backfill only where the name identifies exactly one plated vehicle in the region;
-- orders on duplicated names keep an empty plate and must be reassigned manually.
update public.orders o
set vehicle_plate = v.plate
from public.vehicles v
where o.vehicle_plate = ''
  and v.region_id = o.region_id
  and v.name = o.vehicle
  and v.plate <> ''
  and (
    select count(*) from public.vehicles same_name
    where same_name.region_id = o.region_id and same_name.name = o.vehicle
  ) = 1;
