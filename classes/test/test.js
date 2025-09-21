/**
 * Test file for verifying the class structure
 */

import { 
  BaseManager, 
  BaseViewModel, 
  BaseCoordinator,
  ConfigManager,
  ToolManager,
  MCPManager,
  InstructionManager,
  StorageManager,
  UIManager,
  ChatViewModel,
  OptionsViewModel,
  ChatCoordinator,
  OptionsCoordinator,
  BackgroundCoordinator
} from '../index.js';

// Test that all classes can be imported without errors
console.log('Testing class imports...');

try {
  // Test base classes
  console.log('Base classes imported successfully');
  
  // Test managers
  const configManager = new ConfigManager();
  const toolManager = new ToolManager();
  const mcpManager = new MCPManager();
  const instructionManager = new InstructionManager();
  const storageManager = new StorageManager();
  const uiManager = new UIManager();
  console.log('Manager classes instantiated successfully');
  
  // Test view models
  const chatViewModel = new ChatViewModel();
  const optionsViewModel = new OptionsViewModel();
  console.log('ViewModel classes instantiated successfully');
  
  // Test coordinators
  const chatCoordinator = new ChatCoordinator();
  const optionsCoordinator = new OptionsCoordinator();
  const backgroundCoordinator = new BackgroundCoordinator();
  console.log('Coordinator classes instantiated successfully');
  
  console.log('All tests passed!');
} catch (error) {
  console.error('Test failed:', error);
}