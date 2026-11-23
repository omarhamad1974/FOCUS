# Pingo on Cloudflare

The code stays on GitHub (versioning, pull requests, the Supabase workflow).
Two hosts build the same code from `main`:

| Host | Address | How it deploys |
|------|---------|----------------|
| Cloudflare Workers (main) | `https://pingo.<your-subdomain>.workers.dev` | Cloudflare Workers Builds, connected to the GitHub repo, reads `wrangler.jsonc` |
| GitHub Pages (backup) | <https://omarhamad1974.github.io/Pingo/> | `.github/workflows/pages.yml` |

The app uses relative paths and `#/` routes, so it runs unchanged at either address.
Both use the same Supabase project, so all data is shared.

## How the Cloudflare build works

`wrangler.jsonc` tells Cloudflare to run `npm run build` and serve the files in `dist/`.
Every push to `main` deploys the live site. Pushes to other branches upload a preview version
(shown as the "Workers Builds: pingo" check on a pull request) without touching the live site.

Cloudflare dashboard > Workers & Pages > **pingo** > Settings > Build should show:

- Git repository: `omarhamad1974/Pingo`, production branch `main`
- Build command: `npm run build` (or empty: `wrangler.jsonc` also runs it)
- Deploy command: `npx wrangler deploy`
- Non-production branch deploy command: `npx wrangler preview` (needs the `previews` block in `wrangler.jsonc`)

## Supabase settings (one time)

Supabase > Authentication > URL Configuration:

- **Site URL**: the workers.dev address, with a trailing `/`
- **Redirect URLs**: add `https://pingo.<your-subdomain>.workers.dev/**` and keep
  `https://omarhamad1974.github.io/Pingo/**`

Without this, password-reset emails from the Cloudflare address are refused.

## What users notice

- Each address keeps its own sign-in and its own installed app. Someone who installed the app
  from github.io keeps using it there; to move, they open the new address, sign in once and
  install again.
- Share the Cloudflare address from now on.

## Later: your own domain

1. Buy it at Cloudflare (Domain Registration > Register Domains, sold at cost), or move an
   existing domain's nameservers to Cloudflare.
2. Workers & Pages > **pingo** > Settings > Domains & Routes > Add > Custom domain > type the
   domain. Cloudflare creates the DNS record and HTTPS certificate itself.
3. Supabase: change Site URL to `https://<domain>/` and add `https://<domain>/**` to Redirect URLs.
4. Tell Claude the domain: the push-notification contact address in
   `supabase/functions/send-push/index.ts` gets updated to it.
5. Optional: to send github.io visitors to the domain too, GitHub repo > Settings > Pages >
   Custom domain is **not** the way (that would point the domain at GitHub). Instead ask Claude
   to add a small redirect page to the GitHub Pages build.
