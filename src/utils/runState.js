/**
 * @fileoverview Standardized run/feedback state primitives shared by the chat
 * and options surfaces. Defines the single run-state vocabulary used across
 * Prompt Paul: idle, running, streaming, stopping, complete, error, stopped.
 *
 * State is stored as a `data-run-state` attribute on containers and mirrored
 * to `aria-busy` so assistive tech sees active runs. The module is DOM-light:
 * helpers operate on any element-like object ({ setAttribute, classList }),
 * which keeps it unit-testable in a Node environment.
 *
 * @module runState
 */

/** Canonical run states. Order is not semantically significant. */
export const RUN_STATES = Object.freeze({
  /** No run is in progress and no terminal result is pending. */
  IDLE: 'idle',
  /** A run has started but the model has not produced tokens yet. */
  RUNNING: 'running',
  /** Tokens are actively streaming into the message bubble. */
  STREAMING: 'streaming',
  /** The user requested a stop and the run is unwinding. */
  STOPPING: 'stopping',
  /** The run finished successfully. */
  COMPLETE: 'complete',
  /** The run ended with an error. */
  ERROR: 'error',
  /** The run was stopped by the user. */
  STOPPED: 'stopped',
});

/** All valid run-state values. */
export const RUN_STATE_LIST = Object.freeze(Object.values(RUN_STATES));

/** States in which a run is considered active (blocks new runs). */
export const ACTIVE_RUN_STATES = Object.freeze([
  RUN_STATES.RUNNING,
  RUN_STATES.STREAMING,
  RUN_STATES.STOPPING,
]);

/** Human-readable labels for aria-live announcements. */
export const RUN_STATE_LABELS = Object.freeze({
  idle: 'Idle',
  running: 'Waiting for response',
  streaming: 'Generating response',
  stopping: 'Stopping response',
  complete: 'Response complete',
  error: 'Response failed',
  stopped: 'Response stopped',
});

/**
 * Returns true when the value is a recognized run state.
 * @param {string} value - Candidate run-state value.
 * @returns {boolean} True when value is a canonical run state.
 */
export function isRunState(value) {
  return RUN_STATE_LIST.includes(value);
}

/**
 * Returns true when the state represents an active, blocking run.
 * @param {string} state - Run-state value.
 * @returns {boolean} True for running, streaming, or stopping.
 */
export function isActiveRunState(state) {
  return ACTIVE_RUN_STATES.includes(state);
}

/**
 * Returns the human-readable label for a run state.
 * @param {string} state - Run-state value.
 * @returns {string} Label text, falling back to the raw state.
 */
export function runStateLabel(state) {
  if (isRunState(state)) {
    return RUN_STATE_LABELS[state];
  }
  if (state == null) {
    return RUN_STATE_LABELS[RUN_STATES.IDLE];
  }
  return String(state);
}

/**
 * Sets the run state on a container element.
 *
 * Writes `data-run-state`, mirrors `aria-busy` for active states, and
 * optionally applies a transient `is-complete` class that auto-reverts.
 *
 * @param {Object} element - Element-like object with setAttribute/classList.
 * @param {string} state - Canonical run state; unknown values fall back to idle.
 * @param {Object} [options] - Options.
 * @param {boolean} [options.ariaBusy=true] - Mirror aria-busy for active states.
 * @param {boolean} [options.transientComplete=false] - Flash is-complete class.
 * @returns {string} The resolved run state that was applied.
 */
export function setRunState(element, state, options = {}) {
  if (!element || typeof element.setAttribute !== 'function') {
    return RUN_STATES.IDLE;
  }

  const resolved = isRunState(state) ? state : RUN_STATES.IDLE;
  element.setAttribute('data-run-state', resolved);

  if (options.ariaBusy !== false) {
    element.setAttribute('aria-busy', String(isActiveRunState(resolved)));
  }

  if (options.transientComplete && resolved === RUN_STATES.COMPLETE) {
    element.classList.add('is-complete');
    const revert = () => element.classList.remove('is-complete');
    if (typeof setTimeout === 'function') {
      setTimeout(revert, 1500);
    } else {
      revert();
    }
  }

  return resolved;
}

/**
 * Reads the current run state off a container.
 * @param {Object} element - Element-like object.
 * @returns {string} The current data-run-state value or 'idle'.
 */
export function getRunState(element) {
  if (!element || typeof element.getAttribute !== 'function') {
    return RUN_STATES.IDLE;
  }
  const value = element.getAttribute('data-run-state');
  return isRunState(value) ? value : RUN_STATES.IDLE;
}
