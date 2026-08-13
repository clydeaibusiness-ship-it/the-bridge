# Deploying the Earl app to app.captainsbridge.io

The Next app is a **second** service alongside the existing Express service. It
reuses the Express API (`captainsbridge.io/api`) and shares the Clerk session as
a **subdomain** (free — Allowed Subdomains, NOT satellite/Pro).

## 1. Clerk (Production instance, free)
In the Clerk dashboard, switch from **Development** to the **Production**
instance (top bar), then:
- **Configure → Domains → Allowed subdomains** → add `app.captainsbridge.io`.
- **Configure → Domains → Satellites** → remove `app.captainsbridge.io` if it's
  there (that tab is the paid Pro feature; we are not using it).

That is the whole auth-cost story: $0.

## 2. Railway — new service for the Next app
- New service in the same project, from this repo, **Root Directory = `next-app`**.
  Railway auto-detects Next.js and runs `npm install` → `npm run build` →
  `npm start` (Next binds to Railway's `PORT` automatically).
- **Custom domain**: add `app.captainsbridge.io` to this service; Railway shows a
  CNAME to create in DNS.

## 3. Environment variables (on the Next service)
```
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY = pk_live_Y2xlcmsuY2FwdGFpbnNicmlkZ2UuaW8k
CLERK_SECRET_KEY                  = <the same sk_live_... the Express service uses>
NEXT_PUBLIC_API_BASE              = https://captainsbridge.io
NEXT_PUBLIC_CLERK_SIGN_IN_URL     = https://accounts.captainsbridge.io/sign-in
NEXT_PUBLIC_CLERK_SIGN_UP_URL     = https://accounts.captainsbridge.io/sign-up
```

## 4. Verify
Visit `https://app.captainsbridge.io`. Signed out → the sign-in screen. After
signing in on the existing account portal, the session is shared to the
subdomain, and the chat loads real history via the Bearer token to the API.

## Fallback if the subdomain path ever costs or misbehaves
Serve this app at `captainsbridge.io/app` (same origin, guaranteed free, no
Clerk domain config). That is a routing change on the Express side, not a
rewrite.
