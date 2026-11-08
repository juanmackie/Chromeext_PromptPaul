#!/usr/bin/env node
/**
 * @fileoverview Compare equivalent Act benchmark reports for a pull request gate.
 * @module compareActScores
 */

const fs = require('fs');

function readReport(filePath) {
  const report = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  if (
    !Array.isArray(report.tasks) ||
    report.tasks.length === 0 ||
    !Number.isFinite(report.overallPassRate) ||
    report.overallPassRate < 0 ||
    report.overallPassRate > 1 ||
    !report.provider ||
    !report.model ||
    !Number.isInteger(report.runsPerTask) ||
    report.runsPerTask < 1 ||
    !Array.isArray(report.records) ||
    report.records.length !== report.tasks.length * report.runsPerTask ||
    new Set(report.tasks).size !== report.tasks.length
  ) {
    throw new Error(`Invalid Act benchmark report: ${filePath}`);
  }
  return report;
}

function compareActScores(baseline, candidate) {
  const sameTasks =
    baseline.tasks.length === candidate.tasks.length &&
    baseline.tasks.every((task, index) => task === candidate.tasks[index]);
  if (
    !sameTasks ||
    baseline.provider !== candidate.provider ||
    baseline.model !== candidate.model ||
    baseline.runsPerTask !== candidate.runsPerTask
  ) {
    throw new Error(
      'Act benchmark reports must use the same model, tasks, provider, and run count.'
    );
  }
  return {
    baselinePassRate: baseline.overallPassRate,
    candidatePassRate: candidate.overallPassRate,
    passed: candidate.overallPassRate >= baseline.overallPassRate,
  };
}

if (require.main === module) {
  try {
    const [baselinePath, candidatePath] = process.argv.slice(2);
    if (!baselinePath || !candidatePath) {
      throw new Error('Usage: node scripts/compare-act-scores.js <baseline.json> <candidate.json>');
    }
    const result = compareActScores(readReport(baselinePath), readReport(candidatePath));
    console.log(
      `Act score: baseline ${Math.round(result.baselinePassRate * 100)}%, ` +
        `candidate ${Math.round(result.candidatePassRate * 100)}% — ${result.passed ? 'held or improved' : 'regressed'}`
    );
    if (!result.passed) process.exitCode = 1;
  } catch (error) {
    console.error(`Act score gate failed: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = { compareActScores, readReport };
