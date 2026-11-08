/**
 * @fileoverview Owns bounded structured-answer decoding and live card projections for one run.
 * @module AnswerWireRuntime
 */

import {
  ANSWER_FORMAT,
  createAnswerCardDecoder,
  createAnswerCardProgressiveParser,
  normalizeAnswerCards,
} from '../utils/answerSchema.js';

export const MAX_ANSWER_WIRE_CHARS = 256 * 1024;

/**
 * @param {{ emitEvent: Function, emitReadableAnswer: Function }} adapters
 */
export class AnswerWireRuntime {
  constructor({ emitEvent, emitReadableAnswer }) {
    this.emitEvent = emitEvent;
    this.emitReadableAnswer = emitReadableAnswer;
  }

  reset(run) {
    this.invalidate(run);
    run.answerWireText = '';
    run.answerRuntimeFallback = '';
    run.answerTurn = Math.max(0, Number(run.answerTurn) || 0) + 1;
    run.answerCardDecoder =
      run.config?.answerFormat === ANSWER_FORMAT ? createAnswerCardDecoder() : null;
    run.answerProgressParser = run.answerCardDecoder
      ? createAnswerCardProgressiveParser({ sources: run.webSearch?.sources || [] })
      : null;
    run.progressiveAnswerBlocks = 0;
    run.answerCards = null;
  }

  invalidate(run) {
    if (!run?.progressiveAnswerBlocks) return;
    run.progressiveAnswerBlocks = 0;
    this.emitEvent(run, {
      type: 'answer_cards',
      answerTurn: Number(run.answerTurn) || 0,
      answerCards: null,
      invalid: true,
    });
  }

  emitProgress(run, update) {
    if (!run?.answerProgressParser || !update) return;
    if (update.invalid) {
      this.invalidate(run);
      return;
    }
    if (!Array.isArray(update.blocks) || update.blocks.length <= run.progressiveAnswerBlocks)
      return;
    run.progressiveAnswerBlocks = update.blocks.length;
    const referencedIds = new Set(update.blocks.flatMap((block) => block.sourceIds || []));
    const sources = (Array.isArray(run.webSearch?.sources) ? run.webSearch.sources : [])
      .filter((source) => referencedIds.has(source?.id))
      .slice(0, 12)
      .map((source) => ({
        id: String(source.id).slice(0, 64),
        title: String(source.title || '').slice(0, 240),
        url: String(source.url || '').slice(0, 2_000),
      }));
    this.emitEvent(run, {
      type: 'answer_cards',
      answerTurn: Number(run.answerTurn) || 0,
      answerCards: update,
      ...(sources.length ? { grounding: { sources } } : {}),
    });
  }

  append(run, delta) {
    const text = String(delta || '');
    if (!text) return;
    if (!run.answerCardDecoder) {
      this.emitReadableAnswer(run, text);
      return;
    }
    if (run.answerWireText.length + text.length > MAX_ANSWER_WIRE_CHARS) {
      const error = new Error('Structured answer output exceeded the run limit.');
      error.code = 'ANSWER_FORMAT_OUTPUT_LIMIT';
      throw error;
    }
    run.answerWireText += text;
    this.emitReadableAnswer(run, run.answerCardDecoder.push(text));
    if (run.answerProgressParser) {
      this.emitProgress(run, run.answerProgressParser.push(text));
    }
  }

  finishTurn(run) {
    if (!run.answerCardDecoder) return;
    this.emitReadableAnswer(run, run.answerCardDecoder.finish());
  }

  normalizeForHistory(run) {
    if (run.config?.answerFormat !== ANSWER_FORMAT) return;
    this.invalidate(run);
    run.answerProgressParser?.disable();
    const normalized = normalizeAnswerCards(run.answerWireText || '');
    run.accumulatedText = normalized.status === 'missing_fallback' ? '' : normalized.content;
    run.answerCards = null;
  }

  replace(run, wireText) {
    if (!run.answerCardDecoder) {
      run.accumulatedText = String(wireText || '');
      return;
    }
    this.invalidate(run);
    run.answerWireText = '';
    run.answerCardDecoder = createAnswerCardDecoder();
    run.answerProgressParser = createAnswerCardProgressiveParser({
      sources: run.webSearch?.sources || [],
    });
    run.progressiveAnswerBlocks = 0;
    run.answerRuntimeFallback = '';
    run.answerCards = null;
    run.accumulatedText = '';
    run.outputSafetyCheckLength = 0;
    this.append(run, wireText);
  }
}
