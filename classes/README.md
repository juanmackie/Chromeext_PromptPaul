# Prompt Paul Chrome Extension - Class Structure

This directory contains the refactored class structure for the Prompt Paul Chrome Extension, organized according to the specified architectural principles.

## Directory Structure

```
classes/
├── coordinators/     # Coordinator classes for flow management
├── managers/         # Manager classes for business logic
├── viewmodels/       # ViewModel classes for UI logic
└── test/            # Test files
```

## Architectural Patterns

### 1. Single Responsibility Principle
Each class has a single, well-defined responsibility:
- **Managers**: Handle business logic and data operations
- **ViewModels**: Manage UI state and logic
- **Coordinators**: Control navigation and flow between components

### 2. Manager Pattern
Managers encapsulate specific business logic:
- `ConfigManager` - Handles configuration operations
- `ToolManager` - Manages tool definitions and operations
- `MCPManager` - Handles MCP protocol interactions
- `InstructionManager` - Manages custom instructions
- `StorageManager` - Abstracts storage operations
- `UIManager` - Handles UI-related operations

### 3. ViewModel Pattern
ViewModels manage UI state:
- `ChatViewModel` - Manages chat UI state
- `OptionsViewModel` - Manages options UI state

### 4. Coordinator Pattern
Coordinators manage navigation and flow:
- `ChatCoordinator` - Coordinates chat functionality
- `OptionsCoordinator` - Coordinates options functionality
- `BackgroundCoordinator` - Coordinates background operations

## Base Classes

### BaseManager
Abstract base class for all managers, providing:
- Common initialization and cleanup methods
- Configuration validation
- Error handling

### BaseViewModel
Abstract base class for all view models, providing:
- Observer pattern implementation
- State management
- Notification system

### BaseCoordinator
Abstract base class for all coordinators, providing:
- Child coordinator management
- Navigation handling
- Error handling

## Usage

The classes are designed to be imported and used within the Chrome extension environment:

```javascript
import { ChatCoordinator } from './classes/coordinators/ChatCoordinator.js';
import { ConfigManager } from './classes/managers/ConfigManager.js';

const chatCoordinator = new ChatCoordinator();
const configManager = new ConfigManager();
```

## Benefits of This Structure

1. **Modularity**: Each class can be developed, tested, and maintained independently
2. **Reusability**: Classes can be reused across different parts of the extension
3. **Testability**: Each class can be unit tested in isolation
4. **Maintainability**: Clear separation of concerns makes the codebase easier to understand
5. **Scalability**: New features can be added by creating new classes that follow the established patterns