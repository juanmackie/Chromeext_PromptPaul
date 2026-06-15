# Contributing to Prompt Paul

Thank you for your interest in contributing to Prompt Paul! This document provides guidelines and instructions for contributing.

## Code of Conduct

By participating in this project, you agree to maintain a respectful and inclusive environment for everyone.

## How to Contribute

### Reporting Issues

1. Check existing issues to avoid duplicates
2. Use a clear and descriptive title
3. Include steps to reproduce the issue
4. Describe expected vs. actual behavior
5. Include browser version and extension version
6. Add screenshots if applicable

### Suggesting Features

1. Check existing issues and discussions
2. Describe the feature in detail
3. Explain the use case and benefits
4. Consider implementation approach

### Pull Requests

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/your-feature`
3. Make your changes
4. Run tests: `npm run validate`
5. Commit with clear messages
6. Push to your fork
7. Open a pull request

## Development Setup

See [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) for detailed setup instructions.

### Quick Start

```bash
git clone https://github.com/juanmackie/Chromeext_PromptPaul.git
cd Chromeext_PromptPaul
npm install
npm run validate
```

## Coding Standards

### JavaScript

- Use ES6+ syntax with modules
- Follow the existing code style
- Use meaningful variable and function names
- Add JSDoc comments for public functions
- Keep functions focused and single-purpose

### JSDoc Requirements

All exported functions and classes should have JSDoc comments:

```javascript
/**
 * Description of the function
 * @param {string} input - Input parameter description
 * @param {Object} [options] - Optional parameters
 * @returns {Object} Return value description
 */
```

### Module Structure

Each module should:

1. Start with `@fileoverview` and `@module` JSDoc tags
2. Import dependencies at the top
3. Export public functions/classes
4. Keep internal functions private

### Testing

- Add tests for new functionality in `scripts/test-runner.js`
- Run `npm run test` to verify all tests pass
- Run `npm run smoke` for quick validation

### Commit Messages

Follow conventional commit format:

```
type(scope): description

[optional body]

[optional footer]
```

Types:

- `feat` - New feature
- `fix` - Bug fix
- `docs` - Documentation
- `refactor` - Code refactoring
- `test` - Testing
- `chore` - Maintenance

Examples:

```
feat(chat): add streaming state manager
fix(ui): resolve duplicate tool call display
docs: update architecture documentation
refactor(chat): extract ChatMedia module
```

## Pull Request Process

1. Ensure your code follows the coding standards
2. Update documentation if needed
3. Add tests for new functionality
4. Verify all tests pass: `npm run validate`
5. Ensure commits are squashed and messages are clean
6. Request review from maintainers

### Review Checklist

- [ ] Code follows project style
- [ ] JSDoc comments are complete
- [ ] Tests pass
- [ ] Documentation updated
- [ ] No linting errors
- [ ] Changes are focused and necessary

## Module Architecture

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the full architecture documentation.

### Chat Modules

When modifying chat functionality:

- **ChatUI.js** - UI rendering and DOM changes
- **ChatAPI.js** - API call orchestration
- **ChatSkills.js** - Skill and command handling
- **ChatVoice.js** - Voice input changes
- **ChatMedia.js** - Media processing changes
- **ChatStream.js** - Streaming and state changes
- **chat.js** - Event listeners and orchestration

## Questions?

- Open an issue for discussion
- Check existing documentation
- Review the architecture guide

---

Thank you for contributing to Prompt Paul!
