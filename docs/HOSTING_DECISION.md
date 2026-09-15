# GitHub Pages or Netlify

**Recommendation: stay on GitHub Pages. Do not migrate.**

This is a judgement about what the product actually needs, not about which
platform is better in general. Netlify is a good product and would work. That is
not sufficient reason to move a system a fire society relies on.

---

## What is being hosted

One static folder. Vite builds `dist/`; there is no server, no API route, no
server-side rendering, no serverless function, no build-time data fetch. Every
dynamic thing the application does — authentication, reads, writes, row level
security, Realtime, and the Web Push worker — is Supabase, and that does not
move either way.

The routing is hash-based (`#/poziv`) specifically so the build stays a plain
folder with no rewrite rules. The only build-time configuration is two
publishable values, `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`,
plus `VITE_WEB_PUSH_PUBLIC_KEY` — all three are public by design and all three
are already checked by `npm run verify:bundle`, which fails the build if a
private value reaches the bundle.

A host for this has one job: serve a folder over HTTPS.

---

## The comparison, on the criteria that apply

| Need | GitHub Pages today | Netlify | Does it justify moving? |
|---|---|---|---|
| **Serve a static folder over HTTPS** | Yes, working, deployment 34834867761 successful | Yes | No |
| **Reliability** | Backed by GitHub's CDN. No outage has affected this project. | Comparable | No — nothing is broken |
| **Deploy on merge to main** | Already automated, gated on the CI workflow passing | Would be equivalent | No |
| **Preview deployments per PR** | **No** | Yes | See below |
| **Rollback** | Re-run the deploy workflow on an earlier commit, or revert and let CI deploy | One click in the UI | Marginal. Both take minutes; neither is exercised often |
| **Environment variables** | GitHub Actions variables, already configured | Netlify UI | No. Only public values exist, and they already work |
| **Routing / rewrites** | Not needed — hash routing | `_redirects` available | No |
| **Custom domain** | Supported. Not currently used. | Supported | No |
| **Cost** | Free for a public repository | Free tier, with build-minute limits | Pages is simpler here |
| **Secrets surface** | One place (GitHub) holds CI secrets | A **second** vendor would hold deploy credentials | **Counts against moving** |
| **Maintainability for one volunteer** | One vendor, one login, one settings page | Two vendors, two logins, two settings pages | **Counts against moving** |

### The one genuine gap: preview deployments

Netlify would give a URL per pull request. That is a real convenience, and it is
the only line in the table where Netlify wins on something this project could
use.

It does not justify a migration, for three reasons:

1. The gap is already covered, imperfectly but adequately. CI runs the full
   browser suite at every target viewport on every PR and uploads screenshots as
   artefacts. A reviewer sees the rendered result without a deployment.
2. The audience for a preview URL is one owner reviewing one branch at a time.
   Preview deployments earn their keep when many reviewers need to click around
   many parallel branches.
3. If a preview URL turns out to be genuinely wanted, it can be added **without
   leaving Pages** — a workflow that publishes a PR build to a second branch or
   a separate Pages site. That is a smaller change than moving the production
   deployment.

---

## What moving would actually cost

Not the migration itself — that is an afternoon — but the standing cost:

- **A second vendor in the critical path.** Today one account governs source,
  CI, secrets and deployment. Two accounts means two things to keep working, two
  sets of credentials to rotate, and a new question at three in the morning:
  which one is broken?
- **A second place to hold deployment credentials.** The current arrangement has
  exactly one. Adding another widens the surface of a system whose entire
  security argument is that private values live in one place and never reach the
  browser.
- **The DNS and deployment change itself**, which needs the owner's explicit
  approval and is not reversible in one step.
- **Documentation drift.** `docs/OWNER_BOOTSTRAP.md`, `docs/DEMO_RUNBOOK.md` and
  the `ALLOWED_ORIGIN` on the `send-web-push` Edge Function all name the Pages
  origin. `ALLOWED_ORIGIN` in particular is not cosmetic: get it wrong and the
  commander's immediate push wake-up is refused by CORS and every alert silently
  falls back to the once-a-minute scheduler — which is precisely the failure
  mode `docs/PUSH_LATENCY.md` is written to detect.

That last point is the strongest argument against a casual move. A hosting
migration would change the origin, and the origin is load-bearing for push.

---

## Where moving WOULD become the right answer

Stated up front so the decision can be revisited on evidence rather than on
feeling:

- The application stops being a static folder — it needs a server-side route, an
  edge redirect, or server-side rendering.
- The society wants a custom domain **and** GitHub Pages' certificate handling
  proves inadequate for it.
- Pages availability actually affects a call-out, with a recorded incident.
- Several people start reviewing parallel branches and per-PR preview URLs
  become a bottleneck that artefacts do not solve.

None of these is true today.

---

## What must not be done without the owner's explicit approval

Recorded here because this document could otherwise be read as an invitation:

- Do not change DNS.
- Do not delete the existing Pages deployment.
- Do not rotate any secret.
- Do not move the Supabase backend.

The recommendation is to change nothing.
