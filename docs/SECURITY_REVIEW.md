# Security review

Reviewed: 2026-09-20

This review maps the concrete security checks raised in the supplied videos to
the repository that actually ships. It is evidence for the public fictional-data
demonstration, not approval to use real member or incident data.

## Current controls

| Area | Evidence in this repository | Result |
| --- | --- | --- |
| Client secrets | Only the Supabase URL, publishable key, public VAPID key and guarded feature flag use `VITE_*`. The service-role and VAPID private keys exist only in server configuration. `scripts/check-bundle-secrets.mjs` rejects service-role material in `dist`. | Covered |
| Repository secrets | `.env*` is ignored except the documented example. The current tree and reachable Git history were checked for high-confidence private-key/service-role assignments; none was found. | Covered at review time |
| Authentication | Supabase Auth owns password storage and sessions. The UI never stores or hashes passwords itself. Recovery stays build-disabled until the SMTP acceptance gate in `ACCOUNT_RECOVERY.md` passes. | Covered, recovery gated |
| Authorisation and admin access | Database privileges, row-level security and security-definer RPC checks enforce the role matrix. Hiding a browser route is not treated as security. The push worker independently verifies either the scheduler secret or a signed-in command role. | Covered |
| Input and injection | React escapes rendered text; there is no `dangerouslySetInnerHTML`, `innerHTML`, `eval` or dynamic function construction in application source. Database calls use typed Supabase/RPC parameters and migrations constrain operational values. | Covered |
| XSS containment | The document now restricts scripts, connections, frames, objects, media and resource origins with a Content Security Policy. Inline scripts are not allowed. Inline styles remain allowed because Leaflet positions map elements with style attributes. | Covered for this static host |
| CORS and transport | The push function accepts the configured application origin and rejects other browser origins. GitHub Pages serves the demonstration over HTTPS with HSTS. Supabase traffic is HTTPS/WSS only in the browser policy. | Covered |
| CSRF and cookies | Mutations use an explicit bearer token, not ambient cookie authentication. There is no application authentication cookie to mark secure or SameSite. | Not applicable to this client model |
| Rate and cost bounds | Push delivery has bounded concurrency and a two-attempt ceiling. Authentication rate limits, abuse controls and provider spending limits belong to the hosted Supabase/provider configuration and must be checked there before a pilot. | Code covered; hosted check open |
| File uploads | The abandoned citizen-report prototype creates only a temporary local object URL; it has no public server upload endpoint. Any future upload must use the private, quarantined design in `PRODUCTION_ARCHITECTURE.md`. | No active upload surface |
| Dependencies | The production dependency audit reports no known vulnerability at review time. CI now fails on a high or critical production advisory, and the bundle-secret check runs before deployment. | Covered and automated |
| Debug and production build | Vite production builds do not emit source maps by default. Deployment refuses missing public configuration and secret-looking keys. The public recovery gate remains off pending email acceptance. | Covered |
| Logging and audit | Database audit events and separate notification-attempt states record operational actions without placing incident details in a locked-screen payload. Hosted log review and alert ownership remain release-acceptance tasks. | Application covered; operations open |

## Browser policy

GitHub Pages supplies HTTPS and HSTS, but repository code cannot add arbitrary
response headers there. The CSP is therefore delivered in `index.html`. That
blocks unapproved script and network origins, but a meta policy cannot enforce
`frame-ancestors`. Before real operational data is allowed, move behind a host
or proxy that can send at least these response headers and verify them on the
published URL:

- `Content-Security-Policy` as an HTTP response header, including
  `frame-ancestors 'none'`;
- `X-Content-Type-Options: nosniff`;
- an explicit `Permissions-Policy` for camera, microphone, geolocation and
  other device capabilities approved by the society.

This hosting limitation is acceptable only while the published system remains
a demonstration with fictional data.

## Checks that still require people or hosted access

These cannot be proven by source code or a desktop build:

1. confirm Supabase Auth rate limits, bot protection and any provider spending
   cap in the hosted dashboard;
2. confirm repository secret scanning and dependency alerts are enabled in
   GitHub settings;
3. review hosted audit and push-failure logs, name the person responsible and
   exercise incident response;
4. complete SMTP recovery acceptance, backup restore and rollback practice;
5. run the locked-screen iPhone and Android matrix and the three supervised
   fictional exercises in `RELEASE_ACCEPTANCE.md`.

Until those checks pass, the app must retain the approved telephone/Viber
fallback and must not claim emergency-grade availability.
