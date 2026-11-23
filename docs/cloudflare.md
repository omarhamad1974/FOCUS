# Pingo and Cloudflare

Pingo is built by GitHub Actions and served by GitHub Pages at
<https://omarhamad1974.github.io/Pingo/>. The app uses relative paths and `#/` routes,
so it runs unchanged at any address: a sub-folder, a `*.pages.dev` address, or your own domain.

## Today: no domain yet

Nothing has to change. Cloudflare's main job (DNS, HTTPS, caching for your own name) needs a domain.

Optional, only if you want to try Cloudflare now: publish a second copy on a free
`pingo.pages.dev` address. The site workflow does this by itself once two secrets exist.
Keep in mind it is a second address: people signed in on one are not signed in on the other,
and an installed phone app belongs to the address it was installed from.

1. Make a free account at <https://dash.cloudflare.com/sign-up>.
2. Copy your **Account ID**: Cloudflare dashboard > Workers & Pages > right-hand side.
3. Make an API token: My Profile > API Tokens > Create Token > Create Custom Token.
   Permission: **Account > Cloudflare Pages > Edit**. Create it and copy it (shown once).
4. In GitHub open <https://github.com/omarhamad1974/Pingo/settings/secrets/actions> and add two
   repository secrets: `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`.
5. Run the "Test and deploy to GitHub Pages" workflow on `main` (or merge anything).
   The log of the step "Also publish to Cloudflare Pages" prints the address
   (if `pingo` is taken, Cloudflare picks a name like `pingo-abc.pages.dev`).
6. Supabase > Authentication > URL Configuration > Redirect URLs: add `https://<that address>/**`.

To stop it, delete the two secrets. GitHub Pages keeps working either way.

## Later: your own domain (recommended path)

Keep GitHub Pages as the host and let Cloudflare handle the domain. Fewest moving parts,
still free, and the old github.io address forwards to the new domain automatically.

1. **Buy the domain.** Easiest at Cloudflare itself (Domain Registration > Register Domains,
   sold at cost). If you buy elsewhere, add the site to Cloudflare and change the domain's
   nameservers at the seller to the two Cloudflare gives you.
2. **DNS records** in Cloudflare > your domain > DNS > Records (example domain `pingo.app`):

   | Type  | Name  | Content                   | Proxy     |
   |-------|-------|---------------------------|-----------|
   | A     | `@`   | `185.199.108.153`         | DNS only  |
   | A     | `@`   | `185.199.109.153`         | DNS only  |
   | A     | `@`   | `185.199.110.153`         | DNS only  |
   | A     | `@`   | `185.199.111.153`         | DNS only  |
   | CNAME | `www` | `omarhamad1974.github.io` | DNS only  |

   Leave the cloud grey (DNS only) so GitHub can issue the HTTPS certificate.
3. **GitHub**: <https://github.com/omarhamad1974/Pingo/settings/pages> > Custom domain >
   type `pingo.app` > Save. When the DNS check is green, tick **Enforce HTTPS**
   (the certificate can take up to an hour). No CNAME file is needed because the site
   deploys with GitHub Actions.
4. **Supabase** > Authentication > URL Configuration:
   Site URL `https://pingo.app/`, and add `https://pingo.app/**` to Redirect URLs
   (keep the github.io entry for a while).
5. Tell Claude the domain: the push-notification contact address in
   `supabase/functions/send-push/index.ts` gets updated to it.
6. Tell users: an installed phone app has to be installed again from the new address,
   and everyone signs in once more there.

Optional after HTTPS works: turn the cloud orange (Proxied) to use Cloudflare's cache and
protection, and set SSL/TLS mode to **Full (strict)**.

### Alternative: host on Cloudflare Pages instead

Set up the `pages.dev` copy above, then Cloudflare > Workers & Pages > your project >
Custom domains > add the domain. Cloudflare adds the DNS record itself. GitHub Pages can stay
on as a backup. Pick this only if you want Cloudflare to be the host; otherwise the path above
is simpler.
