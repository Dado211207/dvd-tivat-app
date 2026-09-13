/**
 * The live-update hook, against a channel that behaves like the real one.
 *
 * The assertions here are the rules the brief is strict about, and each is
 * tested as a property rather than by inspecting the implementation:
 *
 *   * nothing is watched before access is confirmed
 *   * one channel per scope, never two
 *   * a burst of changes produces one re-read, not a storm
 *   * a failed channel degrades to a timer instead of going silent
 *   * a tab nobody is looking at is not polled
 *   * everything is torn down on unmount
 *
 * The one thing NOT tested here is that a change notice never authorises
 * anything - because the hook cannot, by construction: `onChange` receives no
 * arguments. There is no payload to put on a screen even if somebody wanted to.
 * `expect(handler.length).toBe(0)` at the bottom is that fact, asserted.
 */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __setLiveBackendForTests, useLiveOperations, type LiveStatus } from './live';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

/** A stand-in for a Supabase channel, recording everything it is asked to do. */
class FakeChannel {
  handlers: (() => void)[] = [];
  tables: string[] = [];
  report: ((status: string) => void) | null = null;
  removed = false;

  constructor(readonly name: string) {}

  on(_type: string, filter: { table: string }, handler: () => void) {
    this.tables.push(filter.table);
    this.handlers.push(handler);
    return this;
  }

  subscribe(callback: (status: string) => void) {
    this.report = callback;
    return this;
  }

  /** One row changed on the server. */
  fire() {
    for (const handler of this.handlers) handler();
  }
}

class FakeBackend {
  channels: FakeChannel[] = [];
  channel(name: string) {
    const made = new FakeChannel(name);
    this.channels.push(made);
    return made;
  }
  removeChannel(channel: unknown) {
    (channel as FakeChannel).removed = true;
  }
  /** Channels that have not been removed. A leak shows up here. */
  get openChannels() {
    return this.channels.filter((c) => !c.removed);
  }
}

let backend: FakeBackend;
let container: HTMLDivElement;
let root: Root;
let reads: number;
let status: LiveStatus;
let visibility: 'visible' | 'hidden';

function Watcher({ enabled, id }: { enabled: boolean; id: string | null }) {
  // A NEW function every render, deliberately: this is how a screen writes it,
  // and a hook that resubscribed on it would open a channel per render.
  status = useLiveOperations({
    enabled,
    interventionId: id,
    onChange: () => {
      reads += 1;
    },
  });
  return null;
}

beforeEach(() => {
  vi.useFakeTimers();
  backend = new FakeBackend();
  __setLiveBackendForTests(backend);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  reads = 0;
  status = 'OFF';
  visibility = 'visible';
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  __setLiveBackendForTests(null);
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function render(props: { enabled: boolean; id: string | null }) {
  act(() => {
    root.render(<Watcher enabled={props.enabled} id={props.id} />);
  });
}

function accept(channel: FakeChannel) {
  act(() => channel.report?.('SUBSCRIBED'));
}

describe('nothing is watched until the server has said who you are', () => {
  it('opens no channel while access is not confirmed', () => {
    render({ enabled: false, id: 'i1' });
    expect(backend.channels).toHaveLength(0);
    expect(status).toBe('OFF');
  });

  it('opens one once it is', () => {
    render({ enabled: true, id: 'i1' });
    expect(backend.channels).toHaveLength(1);
    expect(backend.channels[0]!.name).toBe('ops:i1');
  });
});

describe('one channel per scope, never two', () => {
  it('does not open a second channel when the screen re-renders', () => {
    render({ enabled: true, id: 'i1' });
    // Three more renders with an identical scope and a brand new callback each
    // time. This is the shape that used to duplicate subscriptions.
    render({ enabled: true, id: 'i1' });
    render({ enabled: true, id: 'i1' });
    render({ enabled: true, id: 'i1' });
    expect(backend.channels, 'one channel for one scope').toHaveLength(1);
    expect(backend.openChannels).toHaveLength(1);
  });

  it('replaces the channel when the intervention changes, leaving none behind', () => {
    render({ enabled: true, id: 'i1' });
    render({ enabled: true, id: 'i2' });
    expect(backend.channels).toHaveLength(2);
    expect(backend.channels[0]!.removed, 'the old scope must be closed').toBe(true);
    expect(backend.openChannels).toHaveLength(1);
    expect(backend.openChannels[0]!.name).toBe('ops:i2');
  });

  it('closes the channel when access is withdrawn', () => {
    render({ enabled: true, id: 'i1' });
    render({ enabled: false, id: 'i1' });
    expect(backend.openChannels, 'signing out must not leave a socket open').toHaveLength(0);
    expect(status).toBe('OFF');
  });

  it('closes the channel on unmount', () => {
    render({ enabled: true, id: 'i1' });
    act(() => root.unmount());
    expect(backend.openChannels).toHaveLength(0);
  });
});

describe('a burst of changes is one re-read', () => {
  it('collapses sixteen notices into a single read', () => {
    render({ enabled: true, id: 'i1' });
    const channel = backend.channels[0]!;
    accept(channel);
    const afterSubscribe = reads; // the catch-up read

    // Publishing to eight people writes sixteen rows in one transaction.
    act(() => {
      for (let i = 0; i < 16; i += 1) channel.fire();
    });
    expect(reads, 'nothing until the burst has settled').toBe(afterSubscribe);

    act(() => vi.advanceTimersByTime(400));
    expect(reads - afterSubscribe, 'one read for the whole burst').toBe(1);
  });

  it('reads once on subscribing, to catch anything missed while connecting', () => {
    render({ enabled: true, id: 'i1' });
    expect(reads).toBe(0);
    accept(backend.channels[0]!);
    expect(reads).toBe(1);
    expect(status).toBe('LIVE');
  });
});

describe('when Realtime cannot be established', () => {
  it('falls back to a timer rather than going quietly dead', () => {
    render({ enabled: true, id: 'i1' });
    act(() => backend.channels[0]!.report?.('CHANNEL_ERROR'));
    expect(status, 'the screen must say it is on a timer, not claim to be live').toBe('POLLING');

    act(() => vi.advanceTimersByTime(12_000));
    expect(reads).toBe(1);
    act(() => vi.advanceTimersByTime(12_000));
    expect(reads).toBe(2);
  });

  it('does not poll a tab nobody is looking at', () => {
    render({ enabled: true, id: 'i1' });
    act(() => backend.channels[0]!.report?.('CHANNEL_ERROR'));

    visibility = 'hidden';
    act(() => vi.advanceTimersByTime(60_000));
    expect(reads, 'a phone in a pocket must not spend battery on this').toBe(0);

    visibility = 'visible';
    act(() => vi.advanceTimersByTime(12_000));
    expect(reads).toBe(1);
  });

  it('tries Realtime again later instead of polling forever', () => {
    render({ enabled: true, id: 'i1' });
    act(() => backend.channels[0]!.report?.('CHANNEL_ERROR'));
    expect(backend.channels).toHaveLength(1);

    act(() => vi.advanceTimersByTime(60_000));
    expect(backend.channels, 'a second attempt is made').toHaveLength(2);
  });

  it('stops polling once Realtime does come up', () => {
    render({ enabled: true, id: 'i1' });
    act(() => backend.channels[0]!.report?.('CHANNEL_ERROR'));
    act(() => vi.advanceTimersByTime(12_000));
    const polled = reads;

    accept(backend.channels[0]!);
    expect(status).toBe('LIVE');
    const afterLive = reads;

    act(() => vi.advanceTimersByTime(60_000));
    expect(reads, 'the timer must be stopped, not left running alongside').toBe(afterLive);
    expect(afterLive).toBeGreaterThan(polled);
  });
});

describe('coming back to the tab', () => {
  it('re-reads once, because Realtime does not replay what was missed', () => {
    render({ enabled: true, id: 'i1' });
    accept(backend.channels[0]!);
    const before = reads;

    visibility = 'visible';
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    act(() => vi.advanceTimersByTime(400));
    expect(reads - before).toBe(1);
  });

  it('does nothing when the tab is being hidden rather than shown', () => {
    render({ enabled: true, id: 'i1' });
    accept(backend.channels[0]!);
    const before = reads;

    visibility = 'hidden';
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    act(() => vi.advanceTimersByTime(400));
    expect(reads).toBe(before);
  });

  it('stops listening to the document after unmount', () => {
    render({ enabled: true, id: 'i1' });
    accept(backend.channels[0]!);
    act(() => root.unmount());
    const before = reads;

    act(() => document.dispatchEvent(new Event('visibilitychange')));
    act(() => vi.advanceTimersByTime(1000));
    expect(reads, 'an unmounted screen must not still be reading').toBe(before);
  });
});

describe('a change notice carries no authority', () => {
  it('hands the screen nothing it could put on a page', () => {
    // The whole safety argument in one assertion. The handler registered with
    // the channel takes no arguments, so there is no payload available to
    // render - the only possible response is to re-read through the queries row
    // level security already governs. A future change that started passing the
    // payload through would fail here.
    render({ enabled: true, id: 'i1' });
    const channel = backend.channels[0]!;
    expect(channel.handlers).not.toHaveLength(0);
    for (const handler of channel.handlers) {
      expect(handler.length, 'a change handler must take no payload').toBe(0);
    }
  });

  it('watches only the operational tables, not the whole schema', () => {
    render({ enabled: true, id: 'i1' });
    const tables = backend.channels[0]!.tables;
    expect(tables).toContain('intervention_responses');
    expect(tables).toContain('attendance_intervals');
    // A roster edit nobody is looking at must not wake the console.
    expect(tables).not.toContain('members');
    expect(tables).not.toContain('profiles');
    expect(tables).not.toContain('access_grants');
  });
});
