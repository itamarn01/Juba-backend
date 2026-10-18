# JUBA Admin

Admin panel for the JUBA app: who is online, who tipped, and ads on/off per device.
Data lives in Supabase; the schema is in [`../supabase/schema.sql`](../supabase/schema.sql).

## Setup

1. **Supabase schema**: SQL Editor → New query → paste `supabase/schema.sql` → Run.
2. **Admin user**: Authentication → Users → Add user (email + password, tick "Auto Confirm").
   Then in the SQL Editor:
   ```sql
   insert into public.admins (user_id)
   select id from auth.users where email = 'YOUR-EMAIL';
   ```
3. **Turn off public sign-ups**: Authentication → Sign In / Providers → disable "Allow new users to sign up".

## Run locally

```bash
cd admin
cp .env.example .env.local   # fill in URL + anon key
npm install
npm run dev
```

## Deploy (Vercel)

1. vercel.com → Add New → Project → import `Juba-backend`.
2. **Root Directory**: `admin` (Vercel detects Vite by itself).
3. Environment Variables: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`.
4. Deploy. Every push to `main` redeploys.

## Public pages

Static pages in `public/`, open to everyone (no login), English and Hebrew (`?lang=he`):

- `/privacy` – Privacy Policy (Google Play Console and App Store Connect)
- `/terms` – Terms of Use
- `/support` – Support URL for App Store Connect; `/support#delete-data` explains data deletion

Update the "Effective date" on a page whenever its content changes.
