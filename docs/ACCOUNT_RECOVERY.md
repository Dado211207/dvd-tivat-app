# Email confirmation and account recovery

The application contains a password-recovery flow that uses an emailed one-time
code. It stays hidden until the recovery template and the full reset flow have
been accepted on a real mailbox.

## Production status (8 October 2026)

- Custom Gmail SMTP is configured for `firenexasupportcg@gmail.com`.
- **Confirm email** is enabled. A fresh external signup received the branded
  message, followed its link and signed in successfully on the public app.
- The versioned confirmation template is
  `supabase/templates/confirmation.html`.
- Password recovery remains build-disabled until the acceptance list below is
  completed. SMTP acceptance for signup does not by itself prove the recovery
  code and password-change flow.

## Email confirmation before inviting members

1. In the production Supabase project, configure a custom SMTP provider with a
   verified sender address. The built-in sender is unsuitable for external
   member addresses.
2. Set the Auth Site URL to `https://dado211207.github.io/dvd-tivat-app/` and
   add that exact URL to the allowed redirect URLs. The client requests this
   app directory for both registration and resend; check the current Pages
   deployment before enabling confirmation.
3. Publish `supabase/templates/confirmation.html` as the confirmation template
   and keep its `{{ .ConfirmationURL }}` link.
4. Keep existing member roles owner-assigned. Registration never grants DVD or
   SZS access by itself.

## Hosted setup

1. In Supabase, open **Authentication -> Emails -> SMTP Settings** and configure
   the society's mail provider. Use a sender address that the provider has
   verified.
2. Open **Authentication -> Email Templates -> Reset password** and publish
   `supabase/templates/recovery.html`. Its `{{ .Token }}` placeholder is
   required; a confirmation link does not match the code-entry screen.
3. If dashboard invitations are ever used, publish
   `supabase/templates/invite.html` as the invite template. Ordinary firefighter
   onboarding should normally use self-registration and owner-assigned access.

4. Keep the recovery-email rate limit enabled. The screen also prevents another
   request for 60 seconds, but the server limit is authoritative.
5. Leave the GitHub Actions variable `VITE_PASSWORD_RESET_ENABLED` unset or set
   to `false` while completing the acceptance below.

## Acceptance before enabling

Use a disposable account and a real mailbox:

- Request a code for the disposable account and confirm the mail arrives.
- Request a code for a nonexistent address and confirm the application displays
  the same response. No screen may reveal whether an account exists.
- Enter an invalid code and confirm no password changes.
- Enter the received code and two matching passwords of at least 12 characters.
- Confirm the old password is refused and the new password signs in.
- Confirm the temporary recovery session does not leave the user signed in.
- Confirm requesting a new code invalidates or supersedes the older code as the
  hosted project's policy specifies.
- Check the mailbox in which the message usually lands, including spam, and
  record the delivery time.

After every item passes, set the repository Actions variable
`VITE_PASSWORD_RESET_ENABLED` to `true` and publish a new build. If SMTP or mail
delivery later fails, set it back to `false` and publish again; the application
will show the owner-assisted recovery notice.

## Security properties in the client

- Every address receives the same on-screen request result after a server
  response, so the form cannot list registered members.
- The recovery client does not persist, refresh or share its temporary session
  with the operational account client.
- The code, password, Supabase response and temporary tokens are never logged or
  written to application storage.
- A lost response after password update is reported as uncertain. The screen
  asks the member to try the new password or request another code rather than
  claiming success.

## Owner-initiated recovery

When the same feature gate is enabled, the owner account directory offers
`Send reset code` for a registered account. It only requests the ordinary
recovery email to that account's stored address. The owner never receives the
code, never sees the old password and cannot choose the new one. The button is
disabled while this document's SMTP acceptance gate is closed.
