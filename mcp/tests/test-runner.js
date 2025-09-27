/**
 * Test Runner
 * Single Responsibility: Execute and coordinate all test suites
 * Testability: Centralized test execution with comprehensive reporting
 */

import { TransportTestSuite } from './transport-tests.js';
import { IntegrationTestSuite } from './integration-tests.js';

export class McpTestRunner {
  constructor(logger = console) {
    this.logger = logger;
    this.testSuites = new Map();
    this.overallResults = null;
  }

  /**
   * Initialize test runner with all test suites
   */
  initialize() {
    this.testSuites.set('transport', new TransportTestSuite(this.logger));
    this.testSuites.set('integration', new IntegrationTestSuite(this.logger));
    
    this.logger.info('MCP Test Runner initialized with test suites:', Array.from(this.testSuites.keys()));
  }

  /**
   * Run all test suites
   */
  async runAllTests() {
    this.logger.info('='.repeat(60));
    this.logger.info('STARTING MCP COMPREHENSIVE TEST SUITE');
    this.logger.info('='.repeat(60));
    
    const startTime = Date.now();
    const suiteResults = new Map();
    let overallSuccess = true;

    for (const [suiteName, testSuite] of this.testSuites) {
      this.logger.info(`\n${'='.repeat(40)}`);
      this.logger.info(`RUNNING ${suiteName.toUpperCase()} TESTS`);
      this.logger.info('='.repeat(40));
      
      try {
        const result = await testSuite.runAllTests();
        suiteResults.set(suiteName, result);
        
        if (!result.summary.success) {
          overallSuccess = false;
        }
        
        this.logSuiteResults(suiteName, result);
      } catch (error) {
        this.logger.error(`Failed to run ${suiteName} test suite:`, error);
        suiteResults.set(suiteName, {
          summary: { total: 0, passed: 0, failed: 1, success: false },
          error: error.message
        });
        overallSuccess = false;
      }
    }

    const endTime = Date.now();
    const duration = endTime - startTime;

    this.overallResults = {
      success: overallSuccess,
      duration: duration,
      suites: Object.fromEntries(suiteResults),
      summary: this.calculateOverallSummary(suiteResults),
      timestamp: new Date().toISOString()
    };

    this.logOverallResults();
    return this.overallResults;
  }

  /**
   * Run specific test suite
   */
  async runTestSuite(suiteName) {
    const testSuite = this.testSuites.get(suiteName);
    if (!testSuite) {
      throw new Error(`Test suite '${suiteName}' not found. Available: ${Array.from(this.testSuites.keys()).join(', ')}`);
    }

    this.logger.info(`Running ${suiteName} test suite...`);
    return await testSuite.runAllTests();
  }

  /**
   * Run specific test within a suite
   */
  async runSpecificTest(suiteName, testName) {
    const testSuite = this.testSuites.get(suiteName);
    if (!testSuite) {
      throw new Error(`Test suite '${suiteName}' not found`);
    }

    if (typeof testSuite[testName] !== 'function') {
      throw new Error(`Test '${testName}' not found in suite '${suiteName}'`);
    }

    this.logger.info(`Running specific test: ${suiteName}.${testName}`);
    return await testSuite[testName]();
  }

  /**
   * Calculate overall summary from all suite results
   */
  calculateOverallSummary(suiteResults) {
    let totalTests = 0;
    let totalPassed = 0;
    let totalSkipped = 0;
    let totalFailed = 0;

    for (const result of suiteResults.values()) {
      if (result.summary) {
        totalTests += result.summary.total || 0;
        totalPassed += result.summary.passed || 0;
        totalSkipped += result.summary.skipped || 0;
        totalFailed += result.summary.failed || 0;
      } else if (result.error) {
        totalTests += 1;
        totalFailed += 1;
      }
    }

    return {
      total: totalTests,
      passed: totalPassed,
      skipped: totalSkipped,
      failed: totalFailed,
      success: totalFailed === 0,
      passRate: totalTests > 0 ? ((totalPassed / totalTests) * 100).toFixed(1) : 0
    };
  }

  /**
   * Log suite results
   */
  logSuiteResults(suiteName, result) {
    const { summary } = result;
    
    this.logger.info(`\n${suiteName.toUpperCase()} SUITE RESULTS:`);
    this.logger.info(`Total Tests: ${summary.total}`);
    this.logger.info(`Passed: ${summary.passed}`);
    if (summary.skipped > 0) {
      this.logger.info(`Skipped: ${summary.skipped}`);
    }
    this.logger.info(`Failed: ${summary.failed}`);
    this.logger.info(`Success: ${summary.success ? 'YES' : 'NO'}`);
    
    if (summary.failed > 0) {
      this.logger.error(`\nFAILED TESTS IN ${suiteName.toUpperCase()}:`);
      result.results?.filter(r => r.status === 'FAIL').forEach(test => {
        this.logger.error(`❌ ${test.test}: ${test.message}`);
      });
    }
  }

  /**
   * Log overall results
   */
  logOverallResults() {
    const { summary, duration } = this.overallResults;
    
    this.logger.info('\n' + '='.repeat(60));
    this.logger.info('OVERALL TEST RESULTS');
    this.logger.info('='.repeat(60));
    this.logger.info(`Total Tests: ${summary.total}`);
    this.logger.info(`Passed: ${summary.passed} (${summary.passRate}%)`);
    if (summary.skipped > 0) {
      this.logger.info(`Skipped: ${summary.skipped}`);
    }
    this.logger.info(`Failed: ${summary.failed}`);
    this.logger.info(`Duration: ${(duration / 1000).toFixed(2)}s`);
    this.logger.info(`Overall Success: ${summary.success ? '✅ YES' : '❌ NO'}`);
    this.logger.info('='.repeat(60));

    if (summary.success) {
      this.logger.info('🎉 ALL TESTS PASSED! MCP implementation is working correctly.');
    } else {
      this.logger.error('💥 SOME TESTS FAILED! Please review the failures above.');
    }
  }

  /**
   * Generate HTML test report
   */
  generateHtmlReport() {
    if (!this.overallResults) {
      throw new Error('No test results available. Run tests first.');
    }

    const html = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>MCP Test Results</title>
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; margin: 40px; }
        .header { background: #f8f9fa; padding: 20px; border-radius: 8px; margin-bottom: 30px; }
        .success { color: #28a745; }
        .failure { color: #dc3545; }
        .skip { color: #ffc107; }
        .suite { margin: 20px 0; border: 1px solid #dee2e6; border-radius: 8px; }
        .suite-header { background: #e9ecef; padding: 15px; font-weight: bold; }
        .test-result { padding: 10px 15px; border-bottom: 1px solid #dee2e6; }
        .test-result:last-child { border-bottom: none; }
        .test-pass { background: #d4edda; }
        .test-fail { background: #f8d7da; }
        .test-skip { background: #fff3cd; }
        .summary { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 20px; margin: 20px 0; }
        .stat-card { background: white; border: 1px solid #dee2e6; padding: 20px; border-radius: 8px; text-align: center; }
        .stat-number { font-size: 2em; font-weight: bold; }
    </style>
</head>
<body>
    <div class="header">
        <h1>MCP Test Results</h1>
        <p><strong>Timestamp:</strong> ${this.overallResults.timestamp}</p>
        <p><strong>Duration:</strong> ${(this.overallResults.duration / 1000).toFixed(2)}s</p>
        <p><strong>Overall Status:</strong> 
            <span class="${this.overallResults.success ? 'success' : 'failure'}">
                ${this.overallResults.success ? '✅ PASSED' : '❌ FAILED'}
            </span>
        </p>
    </div>

    <div class="summary">
        <div class="stat-card">
            <div class="stat-number">${this.overallResults.summary.total}</div>
            <div>Total Tests</div>
        </div>
        <div class="stat-card">
            <div class="stat-number success">${this.overallResults.summary.passed}</div>
            <div>Passed</div>
        </div>
        <div class="stat-card">
            <div class="stat-number skip">${this.overallResults.summary.skipped}</div>
            <div>Skipped</div>
        </div>
        <div class="stat-card">
            <div class="stat-number failure">${this.overallResults.summary.failed}</div>
            <div>Failed</div>
        </div>
        <div class="stat-card">
            <div class="stat-number">${this.overallResults.summary.passRate}%</div>
            <div>Pass Rate</div>
        </div>
    </div>

    ${Object.entries(this.overallResults.suites).map(([suiteName, suiteResult]) => `
        <div class="suite">
            <div class="suite-header">
                ${suiteName.toUpperCase()} Tests
                <span class="${suiteResult.summary?.success ? 'success' : 'failure'}">
                    (${suiteResult.summary?.passed || 0}/${suiteResult.summary?.total || 0})
                </span>
            </div>
            ${suiteResult.results ? suiteResult.results.map(test => `
                <div class="test-result test-${test.status.toLowerCase()}">
                    <strong>${test.test}</strong>: ${test.status} - ${test.message}
                </div>
            `).join('') : `
                <div class="test-result test-fail">
                    <strong>Suite Error</strong>: ${suiteResult.error || 'Unknown error'}
                </div>
            `}
        </div>
    `).join('')}

</body>
</html>`;

    return html;
  }

  /**
   * Save test results to file
   */
  saveResults(format = 'json', filename = null) {
    if (!this.overallResults) {
      throw new Error('No test results available. Run tests first.');
    }

    const timestamp = new Date().toISOString().split('T')[0];
    const defaultFilename = `mcp_test_results_${timestamp}.${format}`;
    const outputFilename = filename || defaultFilename;

    let content;
    if (format === 'json') {
      content = JSON.stringify(this.overallResults, null, 2);
    } else if (format === 'html') {
      content = this.generateHtmlReport();
    } else {
      throw new Error(`Unsupported format: ${format}. Use 'json' or 'html'.`);
    }

    // In browser environment, trigger download
    if (typeof window !== 'undefined') {
      const blob = new Blob([content], { 
        type: format === 'json' ? 'application/json' : 'text/html' 
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = outputFilename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      
      this.logger.info(`Test results downloaded as ${outputFilename}`);
    } else {
      // In Node.js environment, write to file
      const fs = require('fs');
      fs.writeFileSync(outputFilename, content);
      this.logger.info(`Test results saved to ${outputFilename}`);
    }

    return outputFilename;
  }

  /**
   * Get test results
   */
  getResults() {
    return this.overallResults;
  }

  /**
   * Reset test runner
   */
  reset() {
    this.overallResults = null;
    this.testSuites.clear();
  }
}

/**
 * Convenience function to run all tests
 */
export async function runMcpTests(logger = console) {
  const runner = new McpTestRunner(logger);
  runner.initialize();
  return await runner.runAllTests();
}

/**
 * Convenience function for browser usage
 */
export function createTestRunner() {
  const runner = new McpTestRunner();
  runner.initialize();
  return runner;
}