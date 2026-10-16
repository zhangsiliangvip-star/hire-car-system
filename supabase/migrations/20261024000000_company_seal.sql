alter table public.companies
  add column seal_image text not null default ''
    check (
      seal_image = '' or (
        length(seal_image) <= 350000
        and seal_image ~ '^data:image/png;base64,[A-Za-z0-9+/]+={0,2}$'
      )
    );
