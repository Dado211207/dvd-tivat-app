# Demonstration runbook

Everything needed to show the DVD Tivat prototype working end to end, and the
things that must not be claimed while showing it.

All data in the demonstration project is invented. Every account address is on
the reserved `.invalid` domain, which cannot receive mail. No real member, real
contact detail or real incident exists anywhere in this system.

---

## 1. What this demonstration is, in one paragraph

A commander opens a call-out on a phone, chooses who it goes to, and publishes
it. Those members see it, say whether they are coming and how far away they
are, report that they are moving, and record their own arrival and departure.
The commander sees each of those as a separate fact, confirms the attendance
that actually happened, records which vehicle went out, and closes the
intervention. Afterwards the archive shows what happened and how much confirmed
participation each member has. All of it runs against a real PostgreSQL
database behind real authentication, and the server refuses anything the
person's role does not permit.

---

## 2. The one thing that must never be claimed

**No notification of any kind is sent. There is no push, email, SMS, Viber or
telephone transport in this application at all.**

Publishing a call-out writes rows that say a message is *owed* to each
recipient. Nothing sends them. In the demonstration the members simply open the
application and see the call-out, which is what a second phone or a second
browser window is for.

The interface says this itself - the confirmation after publishing, and the
banner on every server-backed screen - so the demonstration does not depend on
the presenter remembering to say it. Do not paraphrase it into "they get a
notification".

**This application is not a replacement for calling the fire service.** It is an
internal tool for a society's own members. Nothing in it should be described as
a way for the public to report an emergency.

---

## 3. Before the demonstration

### 3.1 One-time setup for the published copy

The deployed build needs to know which Supabase project to talk to. Those two
values are not committed - this repository keeps placeholder configuration only.

In **Settings -> Secrets and variables -> Actions -> Variables**, add:

| Variable | Value |
| --- | --- |
| `VITE_SUPABASE_URL` | the project URL, `https://<ref>.supabase.co` |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | the **publishable** key (`sb_publishable_...`) |

Both are public by design: every Supabase browser application ships them, and
the publishable key grants nothing on its own - in this schema the `anon` role
holds no privilege on any table and may execute no function. **The secret key
must never be used here.** The workflow rejects one, and `npm run verify:bundle`
fails the build if any secret reaches the output.

Then run **Actions -> Deploy demonstration build -> Run workflow**. It enables
GitHub Pages on the first run and prints the URL when it finishes. The workflow
also runs by itself after CI passes on `main`.

### 3.2 Check the project is in its demonstration state

Sign in as the commander and open **Arhiva i ucesce**. Expected before a
demonstration: the roster has seven members, and there are no interventions.

If a previous run left an intervention open, close it first - a live call-out
from a previous rehearsal is the one piece of state that changes what the next
person sees.

### 3.3 Rehearse the whole journey once

Run section 5 end to end on the devices you will actually use. The optional
automated pass is in section 8.

---

## 4. The accounts

Passwords are **not** in this repository, and must not be added to it. They are
delivered separately. If they have been lost, an owner can set new ones from the
Supabase dashboard (Authentication -> Users).

| Address | Role | What it shows |
| --- | --- | --- |
| `vlasnik@example.invalid` | OWNER | Assigns roles, withdraws access. The only role that can. |
| `administrator@example.invalid` | ADMIN | Keeps the roster, groups, vehicles and account links. Full command authority too. |
| `komandir@example.invalid` | COMMANDER | Runs the call-out. Cannot touch roles or the roster. |
| `vatrogasac1@example.invalid` | FIREFIGHTER | Ivo Vatrogasac - answers, travels, attends. |
| `vatrogasac2@example.invalid` | FIREFIGHTER | Pero Vatrogasac - declines. |
| `vatrogasac3@example.invalid` | FIREFIGHTER | Jovo Vatrogasac - the second attender. |
| `cekanje@example.invalid` | none yet | An account waiting for approval. |
| `ukinut@example.invalid` | withdrawn | An account whose access was withdrawn, with a reason. |

Two members - Marko Probni and Ana Probna - have no account at all. That is
deliberate: the roster is a record of the society, not a list of people who
happen to have signed in.

**Use two devices, or two browser profiles.** A private window is the quickest
second identity. The application deliberately keeps one signed-in account per
browser profile; there is no actor switcher on the real screens, because
choosing a person from a list is not how anybody becomes anybody.

---

## 5. The journey

Roughly twelve minutes at a comfortable pace.

### Commander (device A)

1. Open the application. Not signed in, it says so and offers the way in. Sign in
   as `komandir@example.invalid`.
2. **Poziv i intervencija** opens on the call-out tab. Fill in a title, an
   instruction and a location. Say aloud that the location is invented.
3. Save the draft. Nobody has been called yet - a draft has no recipients.
4. Choose recipients: Ivo, Pero and Jovo. Publish.
5. Read the confirmation out loud. It says the obligations are **queued and not
   sent**, and names how many. This is the honesty point of the whole product.

### Firefighter (device B)

6. Sign in as `vatrogasac1@example.invalid`. Open **Moj poziv**.
7. Set availability to available. Point out that this is a statement about the
   member's own life and is not about any particular call-out.
8. The call-out is there. Press **1. Otvorio sam poziv**.
9. Answer **Dolazim**. Add an ETA band if you like.
10. Report movement: **Krecem**, then **Na licu mjesta**. Read the line under the
    buttons: this does not record attendance. It is a statement about where
    somebody is, not a record that they took part.
11. Press **Prijavi dolazak**. It says the record is waiting for the commander's
    confirmation.

### Commander again (device A)

12. **Pregled**. Every fact has its own column: opened, answer, movement,
    attendance. Show that these are four different things. Somebody who opened
    the call-out and never answered is visible as exactly that.
13. **Prisustvo**. Ivo's record is pending. Explain: a self-declared arrival is a
    claim, not a record of participation.
14. Select all pending and confirm in one action. **No note is required** - there
    is nothing to explain about confirming what is true. Rejecting or undoing a
    confirmation does require a reason, because those change the record against
    what somebody stated.
15. **Vozila**. Record a vehicle departure. Show that no attendance appeared: a
    vehicle going out is a fact about the vehicle.
16. Back on the call-out tab, close the intervention with a short note.

### Afterwards

17. **Arhiva i ucesce**. The chronology lists every fact with its own time. The
    participation table gives confirmed, awaiting confirmation and rejected their
    own columns, and the all-time total per member is computed by the server.

### The refusals, if there is time

Sign in as `cekanje@example.invalid` - the application says the account is
waiting for approval and offers nothing. Then `ukinut@example.invalid` - it says
access was withdrawn. Neither is merely a hidden screen: the server refuses
every command from those accounts, which is what the test suite proves.

---

## 6. Questions that will be asked

**"Does it send a notification to their phone?"**
Not yet. Nothing is sent today. The database already records what is owed to
whom, so a transport can be added without changing how any of this works. That
is a separate decision with its own cost and its own privacy questions.

**"Can the commander just mark everybody present?"**
A commander can record somebody's attendance, and it is stored as
*command-recorded* rather than self-declared, still unconfirmed until confirmed.
Who said it and whether command stands behind it are two different facts and the
system keeps them apart.

**"What stops somebody from claiming hours they did not do?"**
Participation counts confirmed, closed time only. A claim nobody confirmed
contributes nothing. A rejected claim stays in the record with its reason and
contributes nothing.

**"Is this the real membership?"**
No. Every person in it is invented.

**"Can we use it at the next real intervention?"**
Not yet, and it should not be. See section 7.

---

## 7. What to say about readiness

Honest summary: the mobilisation, response, attendance and record-keeping work
end to end against a real database with real access control, verified by an
automated suite and by a live run against the hosted project.

Not done, and needed before anybody relies on it:

- No notification transport. Somebody must open the application to see a
  call-out.
- No real members, and no decision about how personal data would be handled.
- Not tested by actual firefighters under actual conditions.
- No offline queue: an action taken with no signal is refused, not stored and
  sent later.
- One hosted project with no separate production environment and no backup
  policy.

---

## 8. Optional: check the whole journey automatically first

`db-tests/hosted_operations.test.ts` drives the application's own data layer
through the whole journey against the hosted project. It is useful the morning
of a demonstration.

```sh
set -a; . ./.env.local; set +a          # project URL and publishable key
DVD_DEMO_PASSWORD='<the demonstration password>' NODE_USE_ENV_PROXY=1 \
  npx vitest run --config vitest.db.config.ts db-tests/hosted_operations.test.ts
```

It creates one intervention titled `Vjezba (automatska provjera) <timestamp>`,
walks it to a close, and leaves it in the archive. Delete it afterwards if you
would rather start from an empty archive.

**It is skipped when those variables are not set, and a skipped test proves
nothing.** Check the output says 12 passed, not 12 skipped. It is not part of
CI: continuous integration deliberately has no credentials for the hosted
project, and must never be described as having tested it.

---

## 9. If something goes wrong during the demonstration

**A screen says the server is not available.** It is telling the truth; it will
not show stale data instead. Check the venue's network. The application works
offline only to the extent of opening - it cannot read or write anything.

**A screen says the account is waiting for approval.** You are signed in as the
wrong account. Check the identity pill at the top right.

**An action is refused with a sentence about rights.** The server refused it for
that role. This is worth showing rather than hiding: it is the access model
working.

**The published call-out does not appear for the firefighter.** Check the member
was among the chosen recipients. A call-out is addressed, not broadcast.

**A new version notice appears mid-demonstration.** Ignore it. It applies only
when pressed, and never changes the application underneath you.
