import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  RUN_STATES,
  RUN_STATE_LIST,
  ACTIVE_RUN_STATES,
  RUN_STATE_LABELS,
  isRunState,
  isActiveRunState,
  runStateLabel,
  setRunState,
  getRunState,
} from '../src/utils/runState.js';

/** Minimal element-like object that satisfies the runState contract. */
function makeFakeElement() {
  const attrs = new Map();
  const classes = new Set();
  return {
    setAttribute(name, value) {
      attrs.set(name, String(value));
    },
    getAttribute(name) {
      return attrs.has(name) ? attrs.get(name) : null;
    },
    classList: {
      add: vi.fn((...names) => names.forEach((n) => classes.add(n))),
      remove: vi.fn((...names) => names.forEach((n) => classes.delete(n))),
    },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('runState vocabulary', () => {
  it('exposes the canonical seven states', () => {
    expect(RUN_STATE_LIST).toEqual([
      'idle',
      'running',
      'streaming',
      'stopping',
      'complete',
      'error',
      'stopped',
    ]);
    expect(RUN_STATE_LIST).toHaveLength(7);
  });

  it('classifies active states', () => {
    expect(isActiveRunState('running')).toBe(true);
    expect(isActiveRunState('streaming')).toBe(true);
    expect(isActiveRunState('stopping')).toBe(true);
    expect(isActiveRunState('complete')).toBe(false);
    expect(isActiveRunState('idle')).toBe(false);
    expect(isActiveRunState('error')).toBe(false);
  });

  it('validates recognized states', () => {
    expect(isRunState('streaming')).toBe(true);
    expect(isRunState('complete')).toBe(true);
    expect(isRunState('bogus')).toBe(false);
    expect(isRunState(null)).toBe(false);
  });

  it('maps states to labels and falls back safely', () => {
    expect(runStateLabel('running')).toBe('Waiting for response');
    expect(runStateLabel('complete')).toBe('Response complete');
    expect(runStateLabel('unknown')).toBe('unknown');
    expect(runStateLabel(null)).toBe('Idle');
  });

  it('keeps active states in the vocabulary', () => {
    for (const state of ACTIVE_RUN_STATES) {
      expect(RUN_STATE_LIST).toContain(state);
    }
  });

  it('freezes exported constants', () => {
    expect(Object.isFrozen(RUN_STATES)).toBe(true);
    expect(Object.isFrozen(RUN_STATE_LIST)).toBe(true);
    expect(Object.isFrozen(RUN_STATE_LABELS)).toBe(true);
  });
});

describe('setRunState', () => {
  it('writes data-run-state and mirrors aria-busy for active states', () => {
    const el = makeFakeElement();
    setRunState(el, RUN_STATES.STREAMING);
    expect(el.getAttribute('data-run-state')).toBe('streaming');
    expect(el.getAttribute('aria-busy')).toBe('true');
  });

  it('mirrors aria-busy false for terminal states', () => {
    const el = makeFakeElement();
    setRunState(el, RUN_STATES.COMPLETE);
    expect(el.getAttribute('data-run-state')).toBe('complete');
    expect(el.getAttribute('aria-busy')).toBe('false');
  });

  it('falls back to idle for unknown states', () => {
    const el = makeFakeElement();
    setRunState(el, 'not-a-state');
    expect(el.getAttribute('data-run-state')).toBe('idle');
  });

  it('skips aria-busy when disabled', () => {
    const el = makeFakeElement();
    setRunState(el, RUN_STATES.RUNNING, { ariaBusy: false });
    expect(el.getAttribute('aria-busy')).toBeNull();
  });

  it('adds a transient is-complete class that reverts', () => {
    vi.useFakeTimers();
    try {
      const el = makeFakeElement();
      setRunState(el, RUN_STATES.COMPLETE, { transientComplete: true });
      expect(el.classList.add).toHaveBeenCalledWith('is-complete');
      vi.runAllTimers();
      expect(el.classList.remove).toHaveBeenCalledWith('is-complete');
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not add is-complete for non-complete states', () => {
    const el = makeFakeElement();
    setRunState(el, RUN_STATES.ERROR, { transientComplete: true });
    expect(el.classList.add).not.toHaveBeenCalled();
  });

  it('tolerates null elements', () => {
    expect(setRunState(null, RUN_STATES.RUNNING)).toBe('idle');
  });
});

describe('getRunState', () => {
  it('reads the current state', () => {
    const el = makeFakeElement();
    setRunState(el, RUN_STATES.ERROR);
    expect(getRunState(el)).toBe('error');
  });

  it('defaults to idle when unset or invalid', () => {
    const el = makeFakeElement();
    expect(getRunState(el)).toBe('idle');
    el.setAttribute('data-run-state', 'bogus');
    expect(getRunState(el)).toBe('idle');
  });

  it('tolerates null elements', () => {
    expect(getRunState(null)).toBe('idle');
  });
});
