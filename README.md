# Hire Car System

Next.js dashboard for shared hire-car operations. Business records are stored in Supabase PostgreSQL. Supabase Auth handles email/password sign-in, and database row-level security allows authenticated users to share operational data while limiting account management to administrators.

## Supabase setup

1. Create a Supabase project and add the project URL, publishable key, service-role key, and a unique `DELETE_CONFIRMATION_PASSWORD` to `.env.local`, using [.env.example](./.env.example) as the template. Set the same variables in the Vercel project. Both the service-role key and delete confirmation password are server-only and must never use a `NEXT_PUBLIC_` prefix.
2. Apply [`supabase/migrations/20261011000000_initial_schema.sql`](./supabase/migrations/20261011000000_initial_schema.sql) once to the project using the Supabase SQL Editor. It creates the tables, RLS policies, auth profile trigger, and starter records carried over from the prototype.
3. In Supabase Auth URL Configuration, set the Site URL to the app's origin and add redirect URLs for local development and the deployed app, including `/auth/confirm`. Disable public sign-ups; administrators create accounts by invitation.
4. Create the first administrator from Supabase Dashboard → Authentication → Users. Use **Add user** with an email and password (and confirm the email). The database trigger creates the corresponding profile.
5. Promote that profile in the SQL Editor, replacing the address with the first administrator's email:

   ```sql
   update public.profiles
   set role = 'admin'
   where email = lower('admin@example.com');
   ```

6. Run `npm run dev` and sign in at `/login`. Administrators can invite accounts and assign either role from **登录管理**. Invited users set their own passwords from the email link.

The migration seeds the prototype's sample vehicles, drivers, companies, sources, and two sample orders. Remove those rows before using the project with real operational data if they are not wanted.

All signed-in users share and can edit the same operational records. Deletions require the server-configured `DELETE_CONFIRMATION_PASSWORD`; only administrators can list, invite, edit, promote, or delete accounts. The application currently has one shared workspace; it does not isolate records by company.

## Development

```bash
npm install
npm run dev
```

Run `npm run lint` and `npm run build` before deployment.
