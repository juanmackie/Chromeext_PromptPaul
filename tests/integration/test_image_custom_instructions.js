/**
 * Test script for unified custom instructions functionality
 * Run this in the browser console after loading the extension
 */

// Test data setup
const testInstructions = [
  {
    id: 'test-universal-1',
    name: 'Analyze Image Colors',
    content: 'Please analyze the color scheme and palette of this image in detail.',
    modalities: ['text', 'image', 'video', 'audio'], // All modalities now supported
    tool_choice: 'none',
  },
  {
    id: 'test-universal-2',
    name: 'Summarize Content',
    content: 'Please summarize the following content into bullet points.',
    modalities: ['text', 'image', 'video', 'audio'], // All modalities now supported
    tool_choice: 'none',
  },
  {
    id: 'test-universal-3',
    name: 'Extract Text from Image',
    content: 'Extract and list any text visible in this image.',
    modalities: ['text', 'image', 'video', 'audio'], // All modalities now supported
    tool_choice: 'auto',
  },
];

// Test functions
async function testUnifiedCustomInstructions() {
  console.log('🧪 Testing Unified Custom Instructions');

  try {
    // 1. Test saving test instructions
    console.log('📝 Setting up test instructions...');
    await chrome.storage.local.set({ instructions: testInstructions });
    console.log('✅ Test instructions saved');

    // 2. Test universal modality support (all instructions now support all modalities)
    console.log('🔍 Testing universal modality support...');
    const universalInstructions = testInstructions.filter(
      inst => inst.modalities.includes('image') && inst.modalities.includes('text')
    );
    console.log(
      `Expected universal menu items: ${universalInstructions.length}`,
      universalInstructions
    );

    // 3. Test instruction retrieval by ID
    console.log('🔎 Testing instruction retrieval...');
    const result = await chrome.storage.local.get(['instructions']);
    const instructions = result.instructions || [];

    const testId = 'test-universal-1';
    const foundInstruction = instructions.find(inst => inst.id === testId);

    if (foundInstruction) {
      console.log('✅ Successfully found instruction by ID:', foundInstruction.name);
      console.log('   Content:', foundInstruction.content);
      console.log('   Modalities:', foundInstruction.modalities);
      console.log('   Tool choice:', foundInstruction.tool_choice);
    } else {
      console.log('❌ Failed to find instruction by ID:', testId);
    }

    // 4. Test that all instructions support both text and image
    console.log('🎯 Testing universal modality support...');
    const allInstructionsSupportBoth = instructions.every(
      inst => inst.modalities.includes('image') && inst.modalities.includes('text')
    );
    console.log(`All instructions support both text and image: ${allInstructionsSupportBoth}`);

    console.log('🎉 Test completed! Check the results above.');

    return {
      success: true,
      universalInstructionsFound: universalInstructions.length,
      instructionRetrieved: !!foundInstruction,
      allInstructionsUniversal: allInstructionsSupportBoth,
    };
  } catch (error) {
    console.error('❌ Test failed:', error);
    return { success: false, error: error.message };
  }
}

// Test scenarios
const testScenarios = {
  'Happy Path': {
    description: 'Valid universal instruction with all modalities',
    instructionId: 'test-universal-1',
    expectedModalities: ['text', 'image', 'video', 'audio'], // All modalities now supported
    shouldAppearInMenu: true,
  },
  'Missing Instruction': {
    description: 'Non-existent instruction ID',
    instructionId: 'non-existent',
    expectedModalities: [],
    shouldAppearInMenu: false,
  },
  'Universal Modalities': {
    description: 'Universal instruction with all modalities',
    instructionId: 'test-universal-2',
    expectedModalities: ['text', 'image', 'video', 'audio'], // All modalities now supported
    shouldAppearInMenu: true,
  },
  'Image with Auto Tools': {
    description: 'Universal instruction with auto tool choice',
    instructionId: 'test-universal-3',
    expectedModalities: ['text', 'image', 'video', 'audio'], // All modalities now supported
    shouldAppearInMenu: true,
  },
};

// Run comprehensive test
async function runComprehensiveTest() {
  console.log('🚀 Running Comprehensive Unified Custom Instructions Test');
  console.log('='.repeat(60));

  // Setup test data
  await testUnifiedCustomInstructions();

  // Test each scenario
  for (const [scenarioName, scenario] of Object.entries(testScenarios)) {
    console.log(`\n📋 Testing Scenario: ${scenarioName}`);
    console.log(`   Description: ${scenario.description}`);

    const result = await chrome.storage.local.get(['instructions']);
    const instructions = result.instructions || [];
    const instruction = instructions.find(inst => inst.id === scenario.instructionId);

    if (scenario.instructionId === 'non-existent') {
      if (!instruction) {
        console.log('   ✅ Correctly handled missing instruction');
      } else {
        console.log('   ❌ Should not have found instruction');
      }
    } else if (instruction) {
      const supportsImage = instruction.modalities.includes('image');
      const supportsText = instruction.modalities.includes('text');
      const appearsInMenu = supportsImage && supportsText;

      if (appearsInMenu === scenario.shouldAppearInMenu) {
        console.log(`   ✅ Menu appearance correct: ${appearsInMenu}`);
      } else {
        console.log(
          `   ❌ Menu appearance wrong: expected ${scenario.shouldAppearInMenu}, got ${appearsInMenu}`
        );
      }

      console.log(`   📝 Modalities: ${instruction.modalities.join(', ')}`);
      console.log(`   🔧 Tool choice: ${instruction.tool_choice}`);
      console.log(`   🖼️  Supports image: ${supportsImage}`);
      console.log(`   📄 Supports text: ${supportsText}`);
    } else {
      console.log('   ❌ Instruction not found');
    }
  }

  console.log(`\n${  '='.repeat(60)}`);
  console.log('🏁 Comprehensive test completed!');
  console.log('\n💡 Next steps:');
  console.log('   1. Right-click on an image and check context menu');
  console.log('   2. Verify "Custom Instructions" menu appears (not under "Analyze Image")');
  console.log('   3. Test custom instruction execution on images');
  console.log('   4. Test custom instruction execution on text');
  console.log('   5. Verify tool choice is respected');
  console.log('   6. Verify images are processed with base64 content, not just URL');
}

// Export for manual testing
window.testUnifiedCustomInstructions = testUnifiedCustomInstructions;
window.runComprehensiveTest = runComprehensiveTest;
window.testScenarios = testScenarios;

console.log('🧪 Unified test functions loaded. Run runComprehensiveTest() to start testing.');
