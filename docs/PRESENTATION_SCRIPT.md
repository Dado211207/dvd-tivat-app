# First presentation script

Audience: DVD Tivat leadership and a small group of operational members. Target length: **8–10
minutes**, followed by requirements discussion. This script demonstrates a proposed workflow; it
does not claim that notifications, accounts or shared data exist.

## Before people arrive

1. Complete [FIRST_TEST_CHECKLIST.md](./FIRST_TEST_CHECKLIST.md) on desktop and phone width.
2. Run the reviewed branch locally with `npm ci` and `npm run dev`.
3. Use one browser and one tab. Reset the demo in **Istorija**, then reload once.
4. Keep the computer offline if practical; the prototype needs no network for its core flow.
5. Do not import a logo until DVD Tivat supplies and approves an original asset.

## Spoken opening (30 seconds)

> Napravili smo radni prototip prilagodjen nacinu rada DVD Tivat. U njemu je 52 izmisljena clana,
> probno vozilo MAN-1 i terenac TERENAC-1. Clanovi prvo dolaze u bazu po opremu, a zatim izlaze na
> teren. Ovo je samo simulacija: nema pravih naloga, ne salje obavjestenja i ne zamjenjuje Viber.
> Danas provjeravamo da li vam ovakav tok odgovara prije nego sto pravimo pravi sistem.

## Demonstration

| Time | Screen and action | Message to the audience |
|---|---|---|
| 0:30 | **Dezurni** — show station profile and search the 52-person fictional roster. | The interface is focused on DVD Tivat rather than a multi-society marketplace. The roster scale is realistic, but every identity is invented. |
| 1:15 | Create `Vjezba: provjera opreme`, choose `Nosioci IDA aparata`, review, cancel once, then confirm. | A dispatcher sees the exact message and recipients before recording anything. The base and incident location are separate. |
| 2:30 | **Clan** — submit one `Dolazim`, then another `Dolazim kasnije / 30 min`. | A person's answer is explicit and changeable. Silence is never counted as refusal. Base-first assembly is visible. |
| 3:30 | **Dezurni** — show response totals and delivery notice. | Recording a call, delivering to a phone and receiving a human answer are separate facts. This prototype proves only the first and the simulated answer. |
| 4:15 | **Vozila** — send MAN-1 out; update the incident to `Ekipa krenula`; open **Prikaz u bazi**. | A response does not move a vehicle and a vehicle departure does not change incident status. Each action has its own record. |
| 5:30 | Return MAN-1; close the exercise; open **Istorija**. | The complete fictional sequence stays locally available for review and training. |
| 6:30 | Briefly show **Dojava gradjana**. | This is a discussion prototype only. A report stays on this device and cannot alert anyone or create a call without authorised review. |
| 7:15 | Narrow the window to phone width and show **Clan**. | The same workflow is designed for iPhone and Android screen sizes. Native locked-screen alerts are a later, separate engineering phase. |

## Spoken boundary before questions

> Ono sto ste vidjeli je provjeren tok rada, a ne gotov alarmni sistem. Da bi ovo postalo prava
> aplikacija potrebni su sigurni nalozi, server, zajednicki podaci, push obavjestenja za iPhone i
> Android, potvrda prijema, rezervni kanal i testiranje kroz probne vjezbe. Dok se to ne dokaze,
> Viber i postojeci postupak ostaju obavezni.

## Decisions to obtain in the room

Mark each as **confirmed**, **changed** or **unanswered**:

1. Who may create, cancel, change and close a call-out?
2. Which authorised person approves a closed technical pilot?
3. Are `Dolazim`, `Dolazim kasnije`, `Ne mogu` and 15/30/60 minutes the right choices?
4. Which groups, qualifications and vehicle fields are operationally useful?
5. Should Viber remain the parallel fallback during every pilot exercise?
6. Is citizen reporting wanted at all; who monitors it and what official emergency instruction is shown?
7. Which phones and OS versions should be included in the first real-device trial?
8. Who owns member data, who may see it and how long is it retained?
9. Can DVD Tivat provide an approved logo file and permission to use it?

## Closing sentence

> Ako potvrdimo ovaj tok, sledeci korak nije odmah javno pustanje. Prvo pravimo zatvorenu verziju
> sa nalozima i zajednickim podacima, zatim mjerimo obavjestenja na stvarnim iPhone i Android
> telefonima kroz probne vjezbe, uz Viber kao rezervu. Tek nakon uspjesnih testova razgovaramo o
> operativnoj upotrebi.

Write every decision into [SOCIETY_PROFILE.md](./SOCIETY_PROFILE.md) and the dated work log before
changing production architecture. Do not promise a launch date, store approval or emergency-grade
reliability during the presentation.

Use [MEETING_DECISIONS.md](./MEETING_DECISIONS.md) during or immediately after the discussion so
the result is explicit and can be handed to the next development session without this conversation.
