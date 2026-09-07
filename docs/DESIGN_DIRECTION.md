# DVD Tivat visual direction

Status: original prototype design for owner review; no official society identity is implied.

The owner requested a modern, attractive interface personalised for DVD Tivat and expects that
only this society will use it. The latter is unconfirmed. The prototype therefore presents one
society's workspace, with no organisation switcher or multi-society administration.

## Design decisions

- A graphite/navy navigation rail anchors the society name. At phone widths it becomes a visible
  three-column, two-row menu. All six routes remain reachable without an off-screen menu.
- Pale working surfaces follow the system's light/dark theme. Adriatic teal is the institutional
  accent; red stays reserved for alerts and destructive confirmation.
- The overview introduces the team and shows counts derived from fictional members, groups and
  recorded vehicle movements. It never labels people or equipment as ready or connected.
- The shield-like text mark and abstract sea lines are original decorative graphics, not an official
  crest, map or operational symbol. Replace only with identity supplied and approved by the society.
- System fonts, local SVG and CSS only. No new dependency, remote font, stock photograph,
  tracking script, autoplay animation or sound.
- The persistent simulation strip states that data are fictional and notifications are absent.
  The actor selector remains explicitly simulated. Controls retain text, keyboard focus and
  44px minimum navigation targets. Status distinctions do not rely on colour alone.

## Files and review evidence

`src/styles/workspace.css` adapts the shell and shared components. `tokens.css` holds semantic
colours. `StationOverview.tsx` reads existing selectors. `NavIcon.tsx` contains decorative icons.
The existing core domain and notification semantics are unchanged.

Run `npm run screenshots` to regenerate images. CI runs the same screenshot spec after browser
and accessibility tests and attaches an artifact named for the reviewed head. Nothing is deployed
and no image is automatically committed. See the latest PR for the exact run and artifact.

Automated viewports cover desktop, phone, 320px, 720px and 1024px layout widths, with light and
dark axe checks. These approximate layout pressure at different display scales; they do not prove
actual iOS hardware, Windows display scaling or locked-phone behaviour.
