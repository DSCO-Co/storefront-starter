# Flightdeck Storefront

A production-ready, headless storefront for a Flightdeck commerce tenant. Own
the frontend, own the Vercel account — the platform hosts no storefront code
of yours. This app reads its catalog and places orders through the Flightdeck
commerce API using the typed `@dscodotco/sdk`; the shopper's
browser only ever talks to *this* app, and this app talks to the platform
server-to-server with a narrow, tenant-scoped credential.

It is the same codebase that powers Flightdeck's own hosted storefronts,
running in **single-tenant mode**.

## Deploy to Vercel

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/DSCO-Co/storefront-starter&env=FLIGHTDECK_API_URL,FLIGHTDECK_TENANT,FLIGHTDECK_STOREFRONT_TOKEN,SESSION_SECRET&envDescription=Your%20store's%20tenant%20ref%20and%20storefront%20token%20(from%20your%20merchant%20console)&project-name=my-storefront&repository-name=my-storefront)

The button clones this starter into your own GitHub + Vercel and prompts for
the four required env vars below.

Then:

1. Set the four required env vars (Vercel prompts for them on clone, or add
   them under **Project → Settings → Environment Variables**).
2. Deploy. Your store renders immediately on the `*.vercel.app` URL — no domain
   setup required.
3. When you're ready, add your custom domain in Vercel and verify it in your
   merchant console. Nothing about the app changes; `FLIGHTDECK_TENANT` keeps
   it pinned to your store.

## Configuration

See [`.env.example`](./.env.example) for the annotated list. The essentials:

| Variable | Required | What it is |
|---|---|---|
| `FLIGHTDECK_API_URL` | Yes | The commerce API origin, e.g. `https://api.ruo.pro`. |
| `FLIGHTDECK_TENANT` | Yes | Your store's tenant ref. Pins this deploy to one store and ignores the request Host, so it boots on a preview URL and before your domain is verified. |
| `FLIGHTDECK_STOREFRONT_TOKEN` | Yes | Narrow, tenant-scoped checkout credential (`x-storefront-token`). **Server-side only** — never shipped to the browser. Rotate it from your merchant console. |
| `SESSION_SECRET` | Yes | Signs shopper account sessions (`openssl rand -hex 32`). Without it, sign-in degrades to guest checkout. |
| `NEXT_PUBLIC_ASSET_BASE_URL` | — | CDN base for imagery. Defaults to the platform asset host. |
| `NEXT_PUBLIC_SENTRY_DSN` | — | Error reporting. Disabled if unset. |

## How it resolves its store

With `FLIGHTDECK_TENANT` set, every request resolves the manifest **directly by
tenant** (`GET {FLIGHTDECK_API_URL}/stores/v1/resolve?tenant=…`), independent of
the request Host. That's what lets a fresh deploy work on an ephemeral Vercel
URL. Leave `FLIGHTDECK_TENANT` unset only if you're running the multi-tenant
hosted surface, which resolves by verified domain instead.

A failed resolve is a **real error**, never a silent empty store — an unknown
tenant is a hard 404, a transport hiccup serves the last-good manifest.

## Talking to the platform yourself

Anything the storefront does, you can do from your own server code with the
SDK:

```ts
import { createStorefrontClient } from "@dscodotco/sdk";

const store = createStorefrontClient({
  apiUrl: process.env.FLIGHTDECK_API_URL!,
  tenant: process.env.FLIGHTDECK_TENANT!,
  storefrontToken: process.env.FLIGHTDECK_STOREFRONT_TOKEN!, // server-side only
});

const { products } = await store.products.list();
const outcome = await store.checkout.submit({ /* … typed order … */ });
```

The client is tenant-pinned (you never repeat the tenant, and can't address
another one) and fully typed from the API's OpenAPI spec — a wrong field is a
compile error. Keep the storefront token in server code only.

## Local development

```bash
npm install
cp .env.example .env.local   # fill in the four required vars
npm run dev
```

Leave `FLIGHTDECK_API_URL` unset to serve bundled demo fixtures with no running
platform (dev/test convenience; refused in production).
