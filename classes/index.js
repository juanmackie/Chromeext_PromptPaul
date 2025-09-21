/**
 * Main entry point for the Prompt Paul Chrome Extension
 * This file exports all the main classes and coordinators
 */

// Export base classes
export { BaseManager } from './managers/BaseManager.js';
export { BaseViewModel } from './viewmodels/BaseViewModel.js';
export { BaseCoordinator } from './coordinators/BaseCoordinator.js';

// Export managers
export { ConfigManager } from './managers/ConfigManager.js';
export { ToolManager } from './managers/ToolManager.js';
export { MCPManager } from './managers/MCPManager.js';
export { InstructionManager } from './managers/InstructionManager.js';
export { StorageManager } from './managers/StorageManager.js';
export { UIManager } from './managers/UIManager.js';

// Export view models
export { ChatViewModel } from './viewmodels/ChatViewModel.js';
export { OptionsViewModel } from './viewmodels/OptionsViewModel.js';

// Export coordinators
export { ChatCoordinator } from './coordinators/ChatCoordinator.js';
export { OptionsCoordinator } from './coordinators/OptionsCoordinator.js';
export { BackgroundCoordinator } from './coordinators/BackgroundCoordinator.js';