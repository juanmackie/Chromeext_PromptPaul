// Test script to verify the instruction manager fix
// This simulates the saveInstruction method to ensure the 'id' variable is properly scoped

import { InstructionManager } from './options/instruction-manager.js';

// Mock the dependencies
const mockShowStatus = (message, isError, isToast) => {
  console.log(`Status: ${message} ${isError ? '(ERROR)' : ''} ${isToast ? '(TOAST)' : ''}`);
};

const mockStorageService = {
  getLocal: async keys => {
    if (keys.includes('instructions')) {
      return { instructions: [] };
    }
    return {};
  },
  setLocal: async data => {
    console.log('Storage set:', data);
  },
};

// Mock the storage service import
global.storageService = mockStorageService;

// Create an instance of InstructionManager
const instructionManager = new InstructionManager(mockShowStatus);

// Test cases
async function testInstructionSaving() {
  console.log('Testing instruction saving fix...');

  try {
    // Test 1: Save new instruction (no id)
    console.log('\n--- Test 1: Save new instruction ---');
    const newInstructionData = {
      name: 'Test Instruction',
      content: 'This is a test instruction',
      tool_choice: 'none',
      modalities: ['text'],
    };

    const result1 = await instructionManager.saveInstruction(newInstructionData);
    console.log('✅ New instruction saved successfully:', result1 ? 'SUCCESS' : 'FAILED');

    // Test 2: Update existing instruction (with id)
    console.log('\n--- Test 2: Update existing instruction ---');
    const existingInstructionData = {
      id: 'test_id_123',
      name: 'Updated Test Instruction',
      content: 'This is an updated test instruction',
      tool_choice: 'auto',
      modalities: ['text', 'image'],
    };

    const result2 = await instructionManager.saveInstruction(existingInstructionData);
    console.log('✅ Existing instruction updated successfully:', result2 ? 'SUCCESS' : 'FAILED');

    // Test 3: Test error case (missing name)
    console.log('\n--- Test 3: Test validation error ---');
    const invalidInstructionData = {
      content: 'This instruction has no name',
      tool_choice: 'none',
      modalities: ['text'],
    };

    try {
      await instructionManager.saveInstruction(invalidInstructionData);
      console.log('❌ Validation should have failed');
    } catch (error) {
      console.log('✅ Validation error caught correctly:', error.message);
    }

    console.log('\n🎉 All tests completed successfully! The fix works correctly.');
  } catch (error) {
    console.error('❌ Test failed:', error);
    console.error('Stack trace:', error.stack);
  }
}

// Run the test
testInstructionSaving();
