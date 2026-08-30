/**
 * @fileoverview Incremental parser that separates inline reasoning from answer text.
 *
 * Some reasoning models (local/self-hosted Qwen QwQ, DeepSeek-R1 GGUF, and some
 * OpenAI-compatible gateways) do NOT expose a separate `reasoning_content` field.
 * Instead they stream their chain-of-thought inline in `content`, wrapped in
 * `<think>…</think>` (or `<thinking>…</thinking>`) tags. This parser pulls that
 * thinking out of the answer stream so it can be routed to the reasoning panel,
 * while normal text: including HTML like `<!DOCTYPE html>`: passes through
 * untouched.
 *
 * @module inlineReasoning
 */

// Longer variants first so a full match is found before its shorter prefix.
const OPEN_TAGS = ['<thinking>', '<think>'];
const CLOSE_TAGS = ['</thinking>', '</think>'];

/**
 * Create a stateful parser for a single streaming response.
 *
 * The parser is fed deltas via `push()`; tag boundaries split across deltas are
 * buffered internally and resolved once enough text arrives. Call `flush()` once
 * the stream ends to drain any held-back tail.
 *
 * @returns {{
 *   push: (text: string) => { content: string, reasoning: string },
 *   flush: () => { content: string, reasoning: string },
 *   readonly inThink: boolean,
 *   readonly sawThink: boolean,
 * }}
 */
export function createThinkParser() {
  let inThink = false;
  let sawThink = false;
  let pending = '';

  function push(text) {
    let content = '';
    let reasoning = '';
    if (!text) return { content, reasoning };

    const buf = pending + text;
    pending = '';

    const emit = (s) => {
      if (inThink) reasoning += s;
      else content += s;
    };

    let i = 0;
    while (i < buf.length) {
      const lt = buf.indexOf('<', i);
      if (lt === -1) {
        emit(buf.slice(i));
        break;
      }
      if (lt > i) emit(buf.slice(i, lt));

      const tags = inThink ? CLOSE_TAGS : OPEN_TAGS;
      const remainder = buf.slice(lt);
      const lower = remainder.toLowerCase();

      // Full tag → toggle state and skip past it.
      const matched = tags.find((tag) => lower.startsWith(tag));
      if (matched) {
        if (inThink) {
          inThink = false;
        } else {
          inThink = true;
          sawThink = true;
        }
        i = lt + matched.length;
        continue;
      }

      // Possible tag still being received → hold the tail for the next delta.
      const isPartial = tags.some((tag) => remainder.length < tag.length && tag.startsWith(lower));
      if (isPartial) {
        pending = remainder;
        break;
      }

      // A stray '<' that isn't a tag (e.g. `<div>`, `<!DOCTYPE`) → plain text.
      emit('<');
      i = lt + 1;
    }

    return { content, reasoning };
  }

  function flush() {
    const out = { content: '', reasoning: '' };
    if (pending) {
      if (inThink) out.reasoning = pending;
      else out.content = pending;
      pending = '';
    }
    return out;
  }

  return {
    push,
    flush,
    get inThink() {
      return inThink;
    },
    get sawThink() {
      return sawThink;
    },
  };
}
