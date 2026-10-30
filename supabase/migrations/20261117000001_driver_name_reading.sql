alter table public.drivers
  add column if not exists reading text not null default '';

alter table public.drivers
  drop constraint if exists drivers_reading_length_check;
alter table public.drivers
  add constraint drivers_reading_length_check check (char_length(reading) <= 200);
