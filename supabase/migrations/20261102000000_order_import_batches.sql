alter table public.orders
  add column import_batch_id uuid,
  add column import_batch_index integer,
  add constraint orders_import_batch_metadata_check check (
    (import_batch_id is null and import_batch_index is null)
    or
    (import_batch_id is not null and import_batch_index is not null
      and import_batch_index between 0 and 499)
  );

comment on column public.orders.import_batch_id is
  'Shared identifier for one reservation import; historical orders remain ungrouped.';
comment on column public.orders.import_batch_index is
  'Zero-based position in the original import, used to select the first reservation.';
