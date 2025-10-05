# CRUSH.md - Chrome Extension Development Guide

## Build/Test Commands

- **Testing**: Open HTML files directly in browser for manual testing
  - `test-enhanced-thinking-block.html` - Component testing
  - `test-thinking-block.html` - Basic functionality testing
  - `chat.html` - Chat interface testing
  - `options.html` - Settings page testing

- **Chrome Extension Loading**: Load unpacked extension in Chrome Dev Tools
- **No automated tests yet** - Manual testing via HTML files

## Code Style Guidelines

### Imports & Dependencies
- Use ES6 modules with `.js` extensions for imports
- Import from shared utilities via `../shared/index.js`
- Dependency injection pattern using `container.resolve()`
- Service registration with dependencies array: `container.register('ServiceName', Service, ['Dep1', 'Dep2'])`

### TypeScript/JavaScript Patterns
- **TypeScript**: Use interfaces for type definitions (e.g., `ThinkingStep`, `ToolCall`)
- **Error Handling**: Use centralized `errorHandler` with custom error classes
- **Logging**: Use structured logging with `logger.debug()`, `logger.info()`, `logger.error()`
- **Validation**: Use `validators.validate()` for input validation
- **Security**: Sanitize inputs, mask sensitive data in logs

### Naming Conventions
- **Files**: kebab-case (e.g., `enhanced-thinking-block.js`)
- **Classes**: PascalCase (e.g., `EnhancedThinkingBlock`)
- **Methods**: camelCase with descriptive names (e.g., `handleContentChange`)
- **Constants**: UPPER_SNAKE_CASE for exports
- **Services**: End with "Service" (e.g., `AnalyticsService`)

### Chrome Extension Specific
- **Manifest V3**: Use service workers in background
- **Content Security Policy**: Restrict to 'self' for scripts
- **Permissions**: Request minimum necessary permissions
- **Storage**: Use `chrome.storage.local` for settings
- **Context Menus**: Register via `ContextMenuService`

### Component Architecture
- **Custom Elements**: Extend `HTMLElement` with shadow DOM
- **Lifecycle Methods**: `connectedCallback()`, `disconnectedCallback()`, `attributeChangedCallback()`
- **Modular Design**: Separate core logic, rendering, and event handling
- **Dependency Injection**: Use container for service resolution

### Error Handling & Security
- **Default Deny**: Explicit permission required for error exposure
- **Input Validation**: Validate all external data using validators
- **Sanitization**: Remove sensitive data from logs (api keys, tokens)
- **Structured Errors**: Use custom error classes with codes and context

### Performance Considerations
- **Lazy Loading**: Load modules only when needed
- **Event Delegation**: Use efficient event handling patterns
- **Cleanup**: Remove listeners in `disconnectedCallback()`
- **Memory Management**: Limit log sizes and cleanup resources

### RULES
# Production-Ready Coding Rules

## Core Philosophy
Pragmatic guidelines with cost/benefit awareness, not rigid laws. Use as diagnostic tools, then apply judgment.
Always avoid using mock or simulated data. Instead, clearly inform the user when they are viewing simulated data. For example, in the user interface, explicitly state that the data being displayed is simulated

**Goal**: Maintainable, testable, readable code.

---

## File Size & Structure

### Thresholds
- **400 lines**: Yellow flag - assess responsibilities
- **800 lines**: Red flag - refactor unless genuinely cohesive
- **Cohesion over line count**: 600 cohesive lines beats fragmented code

### Split When
- Different responsibilities
- Unrelated concerns  
- Hard to test in isolation

### Don't Split When
- Highly cohesive code
- Related utility functions
- Declarative UI with styling

---

## Object-Oriented Design

### Use Classes For
- Stateful logic
- Complex behavior
- Multiple instances needed

### Use Functions For
- Pure utilities
- Simple transforms
- Single-use helpers

### Reusability Test
"Will I need a second implementation next quarter?"
- **Yes**: Use interfaces, dependency injection
- **No**: Start simple, refactor when needed

---

## Single Responsibility

### The Real Tests
- One clear reason to change?
- Explainable in one sentence?
- Can delete without hunting across files?

### Split Signals
- "This handles X **and** Y"
- Multiple unrelated concerns
- Changes for different reasons

### Keep Together
- "This handles X **by doing** Y and Z"
- Related functionality
- Single logical unit

---

## Function & Class Size

### Functions
- **Target**: Fit in your head, single abstraction level
- **40 lines**: Good guideline for most cases
- **Split when**: Multiple nesting levels, different concerns

### Classes  
- **200 lines**: Assess responsibilities
- **400+ lines**: Strong split candidate
- **Focus on**: Cohesion over count

---

## Naming & Readability

### Naming Rules
- Be descriptive: `UserRepository` not `DataManager`
- Max 3 words: `EmailValidator` not `UserEmailAddressInputValidator`
- Context matters: Short names OK in small scopes

### Readability Priority
1. Minimal mental jumps
2. Keep related code together
3. Clear intent without comments

---

## Modular Design

### Connection Quality
- **Loose coupling**: Depend on interfaces, not implementations
- **High cohesion**: Related functionality together
- **Clear boundaries**: Easy to test in isolation

### Progressive Enhancement
1. Start simple and working
2. Add abstractions when you feel pain
3. Don't build "just in case" features

---

## Testing & Quality

### Testability Requirements
- All code must be testable in isolation
- Use dependency injection for external dependencies
- Design against abstractions

### Test Structure (AAA Pattern)
- **Arrange**: Set up test data
- **Act**: Call method being tested  
- **Assert**: Check results

---

## Security Essentials

### Core Principles
- **Default Deny**: Explicit permission required
- **Least Privilege**: Minimum necessary permissions
- **Input Validation**: Validate all external data
- **Parameterized Queries**: Never concatenate user input

### Error Handling
- Don't expose system details
- Log security events
- Handle failures gracefully

---

## Code Quality Metrics

### Primary Indicators
- **Cyclomatic Complexity > 10**: Warning flag
- **Cyclomatic Complexity > 20**: Strong refactor signal
- **Maintainability Index < 50**: High priority fix

### Diagnostic Hierarchy
1. Maintainability Index (primary)
2. Cyclomatic Complexity (secondary)  
3. Lines of Code (tertiary smell test)

---

## Architecture Patterns

### When to Use Patterns
- **Coordinators**: Complex navigation flows
- **ViewModels**: Complex UI state
- **Managers**: Shared business logic

### Skip Patterns When
- Simple, linear flows
- One-off logic
- Pattern adds more complexity than it solves

---

## Warning Signs

### Architectural Smells
- Generic names (`Manager`, `Helper`, `Utility`)
- Multiple unrelated concerns
- Difficult to test in isolation
- Frequent changes for different reasons

### Quality Indicators
- **Green**: Clear responsibility, easy to test
- **Yellow**: Some complexity but manageable  
- **Red**: Multiple responsibilities, hard to maintain

---

## Before You Refactor

### Key Questions
1. **Deletion test**: Remove without hunting multiple files?
2. **Understanding test**: Next developer needs 2+ tabs?
3. **Reuse test**: Will I plug in different implementation?

### Code Review Focus
- Does abstraction solve real problem?
- Is code more maintainable after change?
- Can I understand complete feature flow?

---

## Automation & Enforcement

### Quality Gates
- Static analysis in CI/CD
- Security scanning of dependencies
- Block merges violating thresholds
- Free reviewers for architecture decisions

---

## Remember

Good rules serve the code, not the other way around. Favor clarity and simplicity over rigid metrics. When in doubt, choose maintainable over clever.