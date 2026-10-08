# FireNexa member onboarding

Use this procedure only after the release acceptance record is complete. A new
account has no operational authority until the owner verifies the person and
assigns their service membership and role.

## What to send firefighters

- Installation guide: <https://firenexa.netlify.app/>
- Application: <https://dado211207.github.io/dvd-tivat-app/>

Suggested message:

> Pozdrav. Otvorite FireNexa vodič, instalirajte aplikaciju i napravite nalog
> svojom email adresom. Potvrdite email porukom koja stigne od FireNexa Support.
> Kada se uspješno prijavite, pošaljite mi ime i prezime, službu (DVD, SZS ili
> obje) i dogovorenu ulogu. Pristup pozivima dobijate tek kada vas povežem sa
> službenim sastavom. Nakon toga u aplikaciji uključite obavještenja. Tokom
> početnog korišćenja telefonski/Viber poziv ostaje obavezna rezerva.

Never ask a member to send a password, confirmation link or recovery code.

## Owner checklist for each person

1. Verify the person's identity outside the application and confirm that they
   belong in the official DVD/SZS roster.
2. Confirm that the registered email belongs to that person and shows as
   verified.
3. In **Nalozi**, use **Pripremi člana** to link the account to the correct
   existing member, or create the member record only from verified roster data.
4. Assign the approved service and role:
   - `FIREFIGHTER` for a firefighter;
   - `COMMANDER` only for an authorised commander;
   - `ADMIN` only for an authorised administrator;
   - never grant `OWNER` through routine onboarding.
5. For a person serving in both organisations, add DVD and SZS separately. The
   app intentionally never infers the second service.
6. Ask the person to sign out and in again if the new access does not appear,
   then enable operational notifications on the installed phone.
7. Run a supervised fictional `TEST` call-out. Confirm one initial notification,
   at most one reminder after 30 seconds if unanswered, the saved response and
   the correct service-scoped archive.
8. Record the result. Do not use the app as the only alert channel during the
   pilot.

## Removal and corrections

- Suspend or remove access immediately when the person leaves a service or the
  role changes.
- Never reuse one person's account or member record for somebody else.
- Correct roster mistakes through the owner workflow; do not edit production
  database rows manually.
- If email delivery or push notifications fail, use the agreed telephone/Viber
  fallback and record the incident before continuing the pilot.
