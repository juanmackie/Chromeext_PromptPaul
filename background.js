import { BackgroundCoordinator } from './classes/coordinators/BackgroundCoordinator.js';

// Initialize the background coordinator
const backgroundCoordinator = new BackgroundCoordinator();

// Start the background coordinator when the extension is loaded
backgroundCoordinator.start().catch(error => {
  console.error('Failed to start BackgroundCoordinator:', error);
});

// Listen for extension shutdown to clean up resources
chrome.runtime.onSuspend?.addListener(() => {
  console.log('Extension suspending, stopping BackgroundCoordinator');
  backgroundCoordinator.stop().catch(error => {
    console.error('Error stopping BackgroundCoordinator:', error);
  });
});

console.log('Background service worker script started.');