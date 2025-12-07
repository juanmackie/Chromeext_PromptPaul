/**
 * Verification script for unified custom instructions implementation
 * This script tests that the changes work correctly
 */

// Test that unified custom instructions work for both text and image contexts
async function verifyUnifiedImplementation() {
  console.log('🔍 Verifying Unified Custom Instructions Implementation');
  console.log('='.repeat(60));

  try {
    // 1. Test that imageCustom_ handling is removed from media analysis
    console.log('📋 Testing 1: imageCustom_ handling removed from media analysis');

    // Check that context menu handler no longer includes imageCustom_ in media analysis
    const backgroundContent = await fetch('background.js').then(r => r.text());
    const hasImageCustomHandling = backgroundContent.includes(
      'info.menuItemId.startsWith("imageCustom_")'
    );

    if (!hasImageCustomHandling) {
      console.log('   ✅ imageCustom_ handling successfully removed from media analysis');
    } else {
      console.log('   ❌ imageCustom_ handling still present in media analysis');
    }

    // 2. Test that custom_ handler includes image detection
    console.log('\n📋 Testing 2: custom_ handler includes image detection');
    const hasImageDetection = backgroundContent.includes(
      "if (info.mediaType === 'image' && info.srcUrl)"
    );

    if (hasImageDetection) {
      console.log('   ✅ Image detection added to custom_ handler');
    } else {
      console.log('   ❌ Image detection missing from custom_ handler');
    }

    // 3. Test that updateImageCustomInstructions function is removed
    console.log('\n📋 Testing 3: updateImageCustomInstructions function removed');
    const hasUpdateFunction = backgroundContent.includes(
      'function updateImageCustomInstructions()'
    );

    if (!hasUpdateFunction) {
      console.log('   ✅ updateImageCustomInstructions function successfully removed');
    } else {
      console.log('   ❌ updateImageCustomInstructions function still present');
    }

    // 4. Test that existingImageCustomMenuItems is removed
    console.log('\n📋 Testing 4: existingImageCustomMenuItems set removed');
    const hasImageCustomSet = backgroundContent.includes('existingImageCustomMenuItems');

    if (!hasImageCustomSet) {
      console.log('   ✅ existingImageCustomMenuItems set successfully removed');
    } else {
      console.log('   ❌ existingImageCustomMenuItems set still present');
    }

    // 5. Test that test file is updated
    console.log('\n📋 Testing 5: Test file updated for unified structure');
    const testContent = await fetch('tests/integration/test_image_custom_instructions.js').then(r =>
      r.text()
    );
    const hasUniversalTest = testContent.includes('testUnifiedCustomInstructions');

    if (hasUniversalTest) {
      console.log('   ✅ Test file updated with unified test functions');
    } else {
      console.log('   ❌ Test file not updated properly');
    }

    // Summary
    const allTestsPassed =
      !hasImageCustomHandling &&
      hasImageDetection &&
      !hasUpdateFunction &&
      !hasImageCustomSet &&
      hasUniversalTest;

    console.log('\n' + '='.repeat(60));
    if (allTestsPassed) {
      console.log('🎉 All verification tests passed!');
      console.log('\n✅ Unified custom instructions implementation is complete:');
      console.log('   • Single "Custom Instructions" menu for all contexts');
      console.log('   • Proper image handling in custom_ handler');
      console.log('   • Duplicate code removed');
      console.log('   • Tests updated for unified structure');
    } else {
      console.log('❌ Some verification tests failed. Please review the issues above.');
    }

    return allTestsPassed;
  } catch (error) {
    console.error('❌ Verification failed:', error);
    return false;
  }
}

// Export for manual testing
window.verifyUnifiedImplementation = verifyUnifiedImplementation;

console.log(
  '🔍 Verification functions loaded. Run verifyUnifiedImplementation() to start verification.'
);
