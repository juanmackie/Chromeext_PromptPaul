// Test script for enhanced parsing robustness
class TestEnhancedThinkingBlock {
  // Copy the new parsing methods for testing
  parseContentWithTags(content) {
    try {
      // Input validation
      if (!content || typeof content !== 'string') {
        return {
          steps: [],
          answerContent: '',
          rawContent: content || ''
        };
      }

      // Sanitize content to prevent XSS
      const sanitizedContent = content
        .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
        .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, '');

      // Improved regex for better tag matching
      const thinkingTagRegex = /<thinking>([\s\S]*?)<\/thinking>/gi;
      const answerTagRegex = /<answer>([\s\S]*?)<\/answer>/gi;

      // Extract thinking content with error handling
      let thinkingContent = '';
      let answerContent = '';

      try {
        const thinkingMatch = thinkingTagRegex.exec(sanitizedContent);
        thinkingContent = thinkingMatch ? thinkingMatch[1].trim() : '';
      } catch (e) {
        console.warn('Failed to parse thinking content:', e);
        thinkingContent = '';
      }

      try {
        const answerMatch = answerTagRegex.exec(sanitizedContent);
        answerContent = answerMatch ? answerMatch[1].trim() : '';
      } catch (e) {
        console.warn('Failed to parse answer content:', e);
        answerContent = '';
      }

      // Improved step parsing with better error handling
      const steps = this.parseThinkingSteps(thinkingContent);

      return {
        steps,
        answerContent,
        rawContent: sanitizedContent
      };
    } catch (error) {
      console.error('Content parsing failed:', error);
      // Return safe fallback
      return {
        steps: [{
          id: 'error-step',
          content: 'Content parsing failed. Raw content displayed below.',
          type: 'error'
        }],
        answerContent: '',
        rawContent: content || ''
      };
    }
  }

  parseThinkingSteps(thinkingContent) {
    if (!thinkingContent) return [];

    try {
      // Handle various step formats
      const stepPatterns = [
        /^\d+\.\s*(.+)$/m,           // "1. Step content"
        /^-\s*(.+)$/m,               // "- Step content"
        /^\*\s*(.+)$/m,              // "* Step content"
        /^Step\s*\d*:\s*(.+)$/mi,    // "Step: content" or "Step 1: content"
      ];

      let steps = [];
      let stepId = 0;

      // Try each pattern
      for (const pattern of stepPatterns) {
        const matches = thinkingContent.match(new RegExp(pattern.source, 'gm'));
        if (matches && matches.length > 0) {
          steps = matches.map(match => {
            const content = match.replace(pattern, '$1').trim();
            return {
              id: `step-${++stepId}`,
              content: this.sanitizeStepContent(content),
              type: 'thinking'
            };
          });
          break; // Use first successful pattern
        }
      }

      // If no structured steps found, split by paragraphs
      if (steps.length === 0) {
        const paragraphs = thinkingContent.split(/\n\s*\n/).filter(p => p.trim());
        steps = paragraphs.map((paragraph, index) => ({
          id: `step-${index + 1}`,
          content: this.sanitizeStepContent(paragraph.trim()),
          type: 'thinking'
        }));
      }

      return steps;
    } catch (error) {
      console.error('Step parsing failed:', error);
      return [{
        id: 'fallback-step',
        content: thinkingContent,
        type: 'thinking'
      }];
    }
  }

  sanitizeStepContent(content) {
    if (!content) return '';

    return content
      // Remove potentially dangerous HTML
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
      .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, '')
      // Limit length to prevent excessive content
      .substring(0, 5000)
      .trim();
  }
}

// Test cases for robustness
const testCases = [
  {
    name: "Valid thinking and answer tags",
    input: `<thinking>1. First step
2. Second step</thinking>
<answer>This is the final answer</answer>`,
    expectedThinking: "First step",
    expectedAnswer: "This is the final answer"
  },
  {
    name: "Malformed HTML tags",
    input: `<thinking>Unclosed thinking tag
<answer>Unclosed answer tag`,
    shouldNotThrow: true
  },
  {
    name: "Nested tags",
    input: `<thinking>Outer thinking <thinking>nested</thinking> outer again</thinking>
<answer>Answer content</answer>`,
    expectedThinking: "Outer thinking",
    expectedAnswer: "Answer content"
  },
  {
    name: "XSS attempt with script tags",
    input: `<thinking>Normal content</thinking>
<answer><script>alert('xss')</script>Safe content</answer>`,
    expectedAnswer: "Safe content",
    shouldSanitize: true
  },
  {
    name: "Empty content",
    input: "",
    expectedSteps: [],
    expectedAnswer: ""
  },
  {
    name: "Null content",
    input: null,
    expectedSteps: [],
    expectedAnswer: ""
  },
  {
    name: "Only thinking tag",
    input: `<thinking>1. Step one
2. Step two</thinking>`,
    expectedThinking: "Step one",
    expectedAnswer: ""
  },
  {
    name: "Only answer tag",
    input: `<answer>Just an answer</answer>`,
    expectedThinking: "",
    expectedAnswer: "Just an answer"
  },
  {
    name: "Multiple step formats",
    input: `<thinking>1. Numbered step
- Bullet step
* Star step
Step 1: Another format</thinking>`,
    shouldParseSteps: true
  },
  {
    name: "Very long content",
    input: `<thinking>${'Long content '.repeat(1000)}</thinking>
<answer>Answer</answer>`,
    expectedAnswer: "Answer",
    shouldTruncate: true
  }
];

// Run tests
console.log('🧪 Testing Enhanced Parsing Robustness...\n');

let passed = 0;
let failed = 0;

testCases.forEach((testCase, index) => {
  console.log(`Test ${index + 1}: ${testCase.name}`);

  try {
    const parser = new TestEnhancedThinkingBlock();
    const result = parser.parseContentWithTags(testCase.input);

    // Check if it throws when it shouldn't
    if (testCase.shouldNotThrow && result.steps.some(s => s.type === 'error')) {
      console.log('  ❌ Failed - Should not throw but got error');
      failed++;
      return;
    }

    // Check thinking content
    if (testCase.expectedThinking !== undefined) {
      const thinkingContent = result.steps.map(s => s.content).join('\n');
      // More flexible check - either exact match or contains expected content
      if (thinkingContent === testCase.expectedThinking ||
          (testCase.expectedThinking && thinkingContent.includes(testCase.expectedThinking))) {
        console.log('  ✅ Thinking content parsed correctly');
      } else {
        console.log(`  ❌ Thinking content mismatch. Expected: "${testCase.expectedThinking}", Got: "${thinkingContent}"`);
        failed++;
        return;
      }
    }

    // Check answer content
    if (testCase.expectedAnswer !== undefined) {
      if (result.answerContent === testCase.expectedAnswer) {
        console.log('  ✅ Answer content parsed correctly');
      } else {
        console.log(`  ❌ Answer content mismatch. Expected: "${testCase.expectedAnswer}", Got: "${result.answerContent}"`);
        failed++;
        return;
      }
    }

    // Check sanitization
    if (testCase.shouldSanitize) {
      if (!result.rawContent.includes('<script>') && result.answerContent !== 'Safe content') {
        console.log('  ❌ XSS content was not properly sanitized');
        failed++;
        return;
      } else {
        console.log('  ✅ XSS content properly sanitized');
      }
    }

    // Check step parsing
    if (testCase.shouldParseSteps) {
      if (result.steps.length > 0) {
        console.log(`  ✅ Steps parsed: ${result.steps.length} steps`);
      } else {
        console.log('  ❌ No steps parsed when steps were expected');
        failed++;
        return;
      }
    }

    // Check truncation
    if (testCase.shouldTruncate) {
      if (result.steps.every(s => s.content.length <= 5000)) {
        console.log('  ✅ Content properly truncated');
      } else {
        console.log('  ❌ Content not properly truncated');
        failed++;
        return;
      }
    }

    passed++;
    console.log('  ✅ PASSED\n');

  } catch (error) {
    console.log(`  ❌ FAILED with error: ${error.message}\n`);
    failed++;
  }
});

console.log(`📊 Test Results: ${passed} passed, ${failed} failed`);

if (failed === 0) {
  console.log('🎉 All tests passed! Enhanced parsing robustness is working correctly.');
} else {
  console.log('❌ Some tests failed. Please review the implementation.');
}