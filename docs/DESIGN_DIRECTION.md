# DVD Tivat visual direction

Status: modern command-centre redesign for owner review; no official society identity is implied.

The owner requested a modern, attractive interface personalised for DVD Tivat and expects that
only this society will use it. The latter is unconfirmed. The prototype therefore presents one
society's workspace, with no organisation switcher or multi-society administration.

## Design decisions

- The product opens as a calm operational workspace, not a marketing page. A compact summary shows
  only the current fictional exercise and record counts; the call composer is the primary task.
- A graphite/navy navigation rail anchors the society name. At phone and high-scaling widths it
  becomes a compact header followed by one horizontally scrollable row. All six routes remain in
  the document and reachable without a hidden menu.
- The call composer is split into two numbered steps: call details and recipients. The confirmation
  preview and every existing domain validation remain unchanged.
- Pale working surfaces follow the system's light/dark theme. Adriatic teal is the institutional
  accent; red stays reserved for warnings and destructive confirmation. Typography uses local
  Windows and system fonts only.
- The overview shows counts derived from fictional members, groups and recorded vehicle movements.
  It never labels people or equipment as ready, connected or notified.
- The 52-member scale is represented with generic fictional rows and a searchable recipient list.
  Member actions and the seven-route shell are checked at 390x844 and 412x915 layouts, representing
  common iPhone and Android pressures without claiming native-device certification.
- The simple `D` text mark is an original placeholder, not an official crest or operational symbol.
  Replace it only with identity supplied and approved by the society.
- System fonts, local SVG and CSS only. No new dependency, remote font, stock photograph,
  tracking script, autoplay animation or sound.
- The persistent simulation strip states that data are fictional and notifications are absent.
  The actor selector remains explicitly simulated. Controls retain text, keyboard focus and
  44px minimum navigation targets. Status distinctions do not rely on colour alone.

## Files and review evidence

`src/styles/workspace.css` defines the responsive shell and shared components. `tokens.css` holds
semantic colours. `StationOverview.tsx` reads existing selectors. `NavIcon.tsx` contains decorative
icons. `DispatcherView.tsx` adds visual workflow hierarchy without moving validation or state into
the UI. The existing core domain, confirmation and notification semantics are unchanged.

Run `npm run screenshots` to regenerate images. CI runs the same screenshot spec after browser
and accessibility tests and attaches an artifact named for the reviewed head. Nothing is deployed
and no image is automatically committed. See the latest PR for the exact run and artifact.

Automated viewports cover desktop, phone, explicit 390x844 iPhone and 412x915 Android dimensions,
320px, 720px and 1024px widths, with light and dark axe checks. These approximate layout pressure;
they do not prove actual iOS hardware, Windows display scaling or locked-phone behaviour.
