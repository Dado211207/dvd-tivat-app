# FireApp reference review

Review date: 7 September 2026.
Language: English (repository documentation standard). User-facing application labels are in the local language.

## 1. What this document is — and is not

DVD Tivat was pointed at [FireApp](https://fireapp.eu/) as a reference product and invited to discuss
requirements. This document records what FireApp's **public documentation** says, so that our own
product decisions can be traced to a source instead of to an assumption.

**This is a documentation review, not a product test.**

| We did | We did not |
|---|---|
| Read the public marketing site, the Slovenian handbook (`doc.fireapp.eu`) and the Croatian handbook (`upute.fireapp.eu`) | Install FireApp, log into a society account, or send a single alarm |
| Read the public store listings | Measure notification latency, reliability, or battery use |
| Record documented workflows and quote them | Read FireApp source code, inspect its API, or review its backend/security |
| Mark disagreements between sources | Verify behaviour in Montenegro, or on any specific phone/OS version |

Regional handbooks are versioned differently and some pages are visibly older than current app
releases. Where the Slovenian and Croatian handbooks disagree, that is recorded below as a
disagreement, **not** as a defect in today's product.

Nothing in this repository copies FireApp source code, branding, assets, or screen layouts. We took
*workflow concepts that are documented in public handbooks* — which is the same thing any fire
society does when it describes how it wants to be called out.

## 2. Verification status of each claim we rely on

| # | Claim we build on | Source | Status in this session |
|---|---|---|---|
| C1 | Selective alarming selects **individual members or predefined groups**, takes free text or a preset template, an **optional** address, and a type label among *TEST / VAJE / INTERVENCIJA*; the type is prepended to the message text | [Selektivno alarmiranje](https://doc.fireapp.eu/books/uporaba-fireapp-aplikacije/page/selektivno-alarmiranje) | **Verified** by fetching the page |
| C2 | Before sending there is a **summary of message and recipients**, then a second confirmation | same as C1 | **Verified** |
| C3 | Selective alarming "works only with an active internet connection" | same as C1 | **Verified** |
| C4 | Only the *INTERVENCIJA* type is recorded in intervention statistics | same as C1 | **Verified** |
| C5 | Member responses are three: coming / coming later / not coming; "later" carries a **time band (15 / 30 / 60 min)**; there is a separate "coming directly to the location" sub-option; a response can be **changed** after the fact | [Aktivna intervencija](https://doc.fireapp.eu/books/uporaba-fireapp-aplikacije/page/aktivna-intervencija) | **Verified** |
| C6 | A member can end the alarm **on their own device**; this is a local action and is not the same as closing the intervention for the society | same as C5 | **Verified** (page documents a per-member "end alarm" action distinct from society-level closure) |
| C7 | Vehicle departure/return is an **explicit log**: pick a vehicle, optionally give a purpose, tap again to mark returned; every departure and return is archived; an administrator can close a forgotten return | [Izlaz vozila](https://upute.fireapp.eu/books/1-uputstva-za-upotrebu-fireapp-aplikacije/page/izlaz-vozila) | **Verified** |
| C8 | Vehicle status is **not derived from member responses** — the handbook documents no crew-confirmation requirement for a vehicle to count as out | same as C7 | **Verified** (absence of any documented coupling; see caveat below) |
| C9 | During a departure the app ties **location updates to the selected vehicle**, pushed when the straight-line distance changes by ~50 m | same as C7 | **Verified** |
| C10 | Product modules advertised include station TV display, activity logging, SPIN and Ignis II+ synchronisation, hydrant/AED map layers, absence scheduling, and **garage door control** hardware | [fireapp.eu](https://fireapp.eu/) | **Verified** (marketing page, not a technical spec) |
| C11 | Public entry price "from 3 EUR per operational member per year", plus hardware line items | [fireapp.eu](https://fireapp.eu/) | **Verified as a published list price.** Not an offer to DVD Tivat and not a statement of total cost |
| C12 | Administration assigns members, permissions, specialties and groups; shows app version and last device check-in | [Online administracija](https://upute.fireapp.eu/books/2-online-web-su%C4%8Delje-za-aplikaciju-fireapp/page/online-web-administracija-za-administratore) | **Reported by the source research, not re-fetched in this session** |
| C13 | Dispatch defines *which societies an operator may activate*; members without the app can receive SMS but **cannot answer through the app** | [Uređivanje i dodavanje članova](https://upute.fireapp.eu/books/4-upotreba-fireapp-dispatch-za-%C5%BEvocvocjvpdvd/page/ure%C4%91ivanje-i-dodavanje-%C4%8Dlanova) | **Reported by the source research, not re-fetched in this session** |
| C14 | The Android listing advertises activation by **incoming SMS without an internet connection** | [Google Play listing](https://play.google.com/store/apps/details?id=eu.fireapp.foregroundservice) | **Reported by the source research, not re-fetched in this session.** A vendor claim about *their* Android build |
| C15 | Apple **Critical Alerts** require an entitlement granted by Apple on request; they are not obtained by writing a normal push notification | [Apple developer documentation](https://developer.apple.com/documentation/usernotifications/unnotificationsettings/criticalalertsetting) | **Not verified in this session** — the Apple documentation page is client-rendered and returned no body text to our fetch tool. Treat as a strong prior to be confirmed before any promise is made |
| C16 | Google Play restricts SMS permissions; the published exception table for emergency/physical-safety messaging lists `SEND_SMS` | [Google Play policy](https://support.google.com/googleplay/android-developer/answer/10208820) | **Not verified in this session.** Reported by the source research |

Caveat on C8: this is an argument from silence in one handbook page. It matches how a fire society
actually works, and it is the behaviour we want, but "FireApp's handbook does not document a
coupling" is weaker evidence than "FireApp documents that they are independent."

## 3. The findings that actually change our design

**F1 — A member's answer is not an operational status.** Documentation keeps four things apart:
what the member answered, whether a vehicle left, whether the society's intervention is open, and
whether one member silenced their own alarm. Our data model must keep them apart too, or the
station display will lie to the person reading it.

**F2 — Sending is a two-step act with an explicit recipient review.** C1 and C2 mean the recipient
list is *data on the call*, resolved and frozen at send time, not a live query. If a member is added
to a group after the call goes out, the call's recipient list must not silently change.

**F3 — Delivery has more than two outcomes.** C3 (internet required) plus C13 (SMS-only members
cannot answer in-app) plus C14 (a separate SMS path) means "sent" is not one boolean. A queued
request, a service acceptance, a device acknowledgement and a human answer are four different
facts. Collapsing them into one green tick is the single most dangerous thing this kind of
application can do.

**F4 — A mobile alarm is not a web notification.** C14, C15 and C16 together say the alerting
capability lives in platform permissions and store policy, not in our screens. A browser prototype
proves the *workflow*; it proves nothing about whether a phone will wake up. This is why the
delivery layer in our prototype records `NIJE_POKUSANO` and nothing else.

**F5 — Location data ages.** C9 shows FireApp binds location to a vehicle movement and refreshes on
movement. Any location we ever display must carry the time it was captured, so a stale marker is
readable as stale rather than as truth.

## 4. What the review did not establish

- No confirmation, in the public dispatch documentation we read, of **citizen self-reporting** or of
  **automatic activation of every society inside a radius**. We do not claim no such module exists;
  we claim this review did not find it. It stays out of our scope until DVD Tivat says otherwise.
- Backend architecture, security posture, measured availability, alarm latency, battery cost,
  contract terms, integration APIs, and behaviour in Montenegro: all unexamined.
- A disagreement worth checking against a specific version before quoting either way: the Croatian
  iOS handbook states the version it describes does not bypass silent mode, while the App Store
  version history mentions the introduction of Critical Alerts. Documentation disagreement, not
  evidence of a current fault.
- Documented Apple Watch notification-routing problems exist in the handbooks. Relevant only as a
  reminder to include a phone-with-watch case in any future delivery trial.

## 5. Questions this review cannot answer — they need the society

Carried into [PRODUCT_PLAN.md](./PRODUCT_PLAN.md) §7 as the meeting agenda.

The most important one is not a feature question: **what does DVD Tivat need that an existing
product does not already give them?** A published entry price of ~3 EUR per operational member per
year (C11) is a low bar for a custom build to clear. Honest answers might be data ownership, local
language and local process fit, Montenegro-specific needs, integration constraints, or cost at their
member count — but the answer should be stated before the build is scaled up, not after.
