/**
 * Validation Utilities
 * Common validation functions used across the application
 * Provides consistent validation logic and error messages
 */

/**
 * Validate URL format
 * @param {string} url - URL to validate
 * @param {Object} options - Validation options
 * @returns {Object} Validation result with isValid and error properties
 */
export function validateUrl(url, options = {}) {
    const { allowEmpty = false, requiredProtocols = ['http', 'https'] } = options;

    if (allowEmpty && (!url || url.trim() === '')) {
        return { isValid: true, error: null };
    }

    if (!url || typeof url !== 'string') {
        return { isValid: false, error: 'URL is required and must be a string' };
    }

    const trimmedUrl = url.trim();
    if (trimmedUrl === '') {
        return { isValid: false, error: 'URL cannot be empty' };
    }

    try {
        const urlObj = new URL(trimmedUrl);

        if (requiredProtocols.length > 0 && !requiredProtocols.includes(urlObj.protocol.replace(':', ''))) {
            return {
                isValid: false,
                error: `URL must use one of these protocols: ${requiredProtocols.join(', ')}`
            };
        }

        return { isValid: true, error: null, normalizedUrl: urlObj.toString() };
    } catch (error) {
        return { isValid: false, error: 'Invalid URL format' };
    }
}

/**
 * Validate API key format
 * @param {string} apiKey - API key to validate
 * @param {Object} options - Validation options
 * @returns {Object} Validation result
 */
export function validateApiKey(apiKey, options = {}) {
    const { minLength = 1, allowEmpty = false, pattern = null } = options;

    if (allowEmpty && (!apiKey || apiKey.trim() === '')) {
        return { isValid: true, error: null };
    }

    if (!apiKey || typeof apiKey !== 'string') {
        return { isValid: false, error: 'API key is required and must be a string' };
    }

    const trimmedKey = apiKey.trim();
    if (trimmedKey === '') {
        return { isValid: false, error: 'API key cannot be empty' };
    }

    if (trimmedKey.length < minLength) {
        return {
            isValid: false,
            error: `API key must be at least ${minLength} characters long`
        };
    }

    if (pattern && !pattern.test(trimmedKey)) {
        return { isValid: false, error: 'API key format is invalid' };
    }

    return { isValid: true, error: null, normalizedKey: trimmedKey };
}

/**
 * Validate model name
 * @param {string} modelName - Model name to validate
 * @param {Object} options - Validation options
 * @returns {Object} Validation result
 */
export function validateModelName(modelName, options = {}) {
    const { allowEmpty = false, maxLength = 100 } = options;

    if (allowEmpty && (!modelName || modelName.trim() === '')) {
        return { isValid: true, error: null };
    }

    if (!modelName || typeof modelName !== 'string') {
        return { isValid: false, error: 'Model name is required and must be a string' };
    }

    const trimmedName = modelName.trim();
    if (trimmedName === '') {
        return { isValid: false, error: 'Model name cannot be empty' };
    }

    if (trimmedName.length > maxLength) {
        return {
            isValid: false,
            error: `Model name cannot exceed ${maxLength} characters`
        };
    }

    // Check for invalid characters
    const invalidChars = /[<>:"/\\|?*]/;
    if (invalidChars.test(trimmedName)) {
        return { isValid: false, error: 'Model name contains invalid characters' };
    }

    return { isValid: true, error: null, normalizedName: trimmedName };
}

/**
 * Validate max tokens value
 * @param {number|string} maxTokens - Max tokens to validate
 * @param {Object} options - Validation options
 * @returns {Object} Validation result
 */
export function validateMaxTokens(maxTokens, options = {}) {
    const { min = 1, max = 100000, allowZero = false } = options;

    if (maxTokens === null || maxTokens === undefined) {
        return { isValid: false, error: 'Max tokens is required' };
    }

    const parsed = parseInt(maxTokens);
    if (isNaN(parsed)) {
        return { isValid: false, error: 'Max tokens must be a valid number' };
    }

    if (!allowZero && parsed <= 0) {
        return { isValid: false, error: 'Max tokens must be greater than 0' };
    }

    if (parsed < min) {
        return { isValid: false, error: `Max tokens must be at least ${min}` };
    }

    if (parsed > max) {
        return { isValid: false, error: `Max tokens cannot exceed ${max}` };
    }

    return { isValid: true, error: null, normalizedValue: parsed };
}

/**
 * Validate email format
 * @param {string} email - Email to validate
 * @param {Object} options - Validation options
 * @returns {Object} Validation result
 */
export function validateEmail(email, options = {}) {
    const { allowEmpty = false } = options;

    if (allowEmpty && (!email || email.trim() === '')) {
        return { isValid: true, error: null };
    }

    if (!email || typeof email !== 'string') {
        return { isValid: false, error: 'Email is required and must be a string' };
    }

    const trimmedEmail = email.trim();
    if (trimmedEmail === '') {
        return { isValid: false, error: 'Email cannot be empty' };
    }

    // Basic email regex
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(trimmedEmail)) {
        return { isValid: false, error: 'Invalid email format' };
    }

    return { isValid: true, error: null, normalizedEmail: trimmedEmail.toLowerCase() };
}

/**
 * Validate JSON string
 * @param {string} jsonString - JSON string to validate
 * @param {Object} options - Validation options
 * @returns {Object} Validation result
 */
export function validateJson(jsonString, options = {}) {
    const { allowEmpty = false, allowPrimitives = true } = options;

    if (allowEmpty && (!jsonString || jsonString.trim() === '')) {
        return { isValid: true, error: null };
    }

    if (!jsonString || typeof jsonString !== 'string') {
        return { isValid: false, error: 'JSON string is required' };
    }

    try {
        const parsed = JSON.parse(jsonString);

        if (!allowPrimitives && typeof parsed !== 'object') {
            return {
                isValid: false,
                error: 'JSON must be an object or array'
            };
        }

        return { isValid: true, error: null, parsedValue: parsed };
    } catch (error) {
        return { isValid: false, error: `Invalid JSON: ${error.message}` };
    }
}

/**
 * Validate file size
 * @param {number} size - File size in bytes
 * @param {Object} options - Validation options
 * @returns {Object} Validation result
 */
export function validateFileSize(size, options = {}) {
    const { maxSize = 50 * 1024 * 1024, allowEmpty = false } = options; // Default 50MB

    if (allowEmpty && (!size || size === 0)) {
        return { isValid: true, error: null };
    }

    if (typeof size !== 'number' || size < 0) {
        return { isValid: false, error: 'File size must be a positive number' };
    }

    if (size > maxSize) {
        const maxSizeMB = Math.round(maxSize / (1024 * 1024));
        return {
            isValid: false,
            error: `File size cannot exceed ${maxSizeMB}MB`
        };
    }

    return { isValid: true, error: null };
}

/**
 * Validate MIME type
 * @param {string} mimeType - MIME type to validate
 * @param {Object} options - Validation options
 * @returns {Object} Validation result
 */
export function validateMimeType(mimeType, options = {}) {
    const {
        allowEmpty = false,
        allowedTypes = [],
        allowedCategories = []
    } = options;

    if (allowEmpty && (!mimeType || mimeType.trim() === '')) {
        return { isValid: true, error: null };
    }

    if (!mimeType || typeof mimeType !== 'string') {
        return { isValid: false, error: 'MIME type is required' };
    }

    const trimmedType = mimeType.trim().toLowerCase();
    if (trimmedType === '') {
        return { isValid: false, error: 'MIME type cannot be empty' };
    }

    // Basic MIME type format validation
    const mimeRegex = /^[a-z]+\/[a-z0-9.\-+]+$/;
    if (!mimeRegex.test(trimmedType)) {
        return { isValid: false, error: 'Invalid MIME type format' };
    }

    // Check if type is in allowed types
    if (allowedTypes.length > 0 && !allowedTypes.includes(trimmedType)) {
        return {
            isValid: false,
            error: `MIME type not allowed. Allowed types: ${allowedTypes.join(', ')}`
        };
    }

    // Check if category is allowed
    if (allowedCategories.length > 0) {
        const category = trimmedType.split('/')[0];
        if (!allowedCategories.includes(category)) {
            return {
                isValid: false,
                error: `MIME type category not allowed. Allowed categories: ${allowedCategories.join(', ')}`
            };
        }
    }

    return { isValid: true, error: null, normalizedType: trimmedType };
}

/**
 * Validate profile data
 * @param {Object} profile - Profile object to validate
 * @returns {Object} Validation result with all errors
 */
export function validateProfile(profile) {
    const errors = [];
    const normalized = {};

    if (!profile || typeof profile !== 'object') {
        return {
            isValid: false,
            errors: ['Profile must be an object']
        };
    }

    // Validate name
    if (!profile.name || typeof profile.name !== 'string') {
        errors.push('Profile name is required');
    } else {
        const nameResult = validateModelName(profile.name);
        if (!nameResult.isValid) {
            errors.push(`Profile name: ${nameResult.error}`);
        } else {
            normalized.name = nameResult.normalizedName;
        }
    }

    // Validate LLM endpoint
    if (!profile.llmEndpoint) {
        errors.push('LLM endpoint is required');
    } else {
        const urlResult = validateUrl(profile.llmEndpoint);
        if (!urlResult.isValid) {
            errors.push(`LLM endpoint: ${urlResult.error}`);
        } else {
            normalized.llmEndpoint = urlResult.normalizedUrl;
        }
    }

    // Validate API key
    if (!profile.apiKey) {
        errors.push('API key is required');
    } else {
        const keyResult = validateApiKey(profile.apiKey);
        if (!keyResult.isValid) {
            errors.push(`API key: ${keyResult.error}`);
        } else {
            normalized.apiKey = keyResult.normalizedKey;
        }
    }

    // Validate model name
    if (!profile.modelName) {
        errors.push('Model name is required');
    } else {
        const modelResult = validateModelName(profile.modelName);
        if (!modelResult.isValid) {
            errors.push(`Model name: ${modelResult.error}`);
        } else {
            normalized.modelName = modelResult.normalizedName;
        }
    }

    // Validate max tokens
    if (profile.maxTokens !== undefined) {
        const tokensResult = validateMaxTokens(profile.maxTokens);
        if (!tokensResult.isValid) {
            errors.push(`Max tokens: ${tokensResult.error}`);
        } else {
            normalized.maxTokens = tokensResult.normalizedValue;
        }
    }

    // Validate system prompt (optional)
    if (profile.systemPrompt !== undefined) {
        if (typeof profile.systemPrompt !== 'string') {
            errors.push('System prompt must be a string');
        } else {
            normalized.systemPrompt = profile.systemPrompt.trim();
        }
    }

    return {
        isValid: errors.length === 0,
        errors,
        normalized: { ...profile, ...normalized }
    };
}

/**
 * Validate tool definition
 * @param {Object} tool - Tool definition to validate
 * @returns {Object} Validation result with all errors
 */
export function validateToolDefinition(tool) {
    const errors = [];
    const normalized = {};

    if (!tool || typeof tool !== 'object') {
        return {
            isValid: false,
            errors: ['Tool definition must be an object']
        };
    }

    // Validate name
    if (!tool.name || typeof tool.name !== 'string') {
        errors.push('Tool name is required');
    } else {
        const name = tool.name.trim();
        if (name === '') {
            errors.push('Tool name cannot be empty');
        } else if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
            errors.push('Tool name must contain only letters, numbers, and underscores, and start with a letter or underscore');
        } else {
            normalized.name = name;
        }
    }

    // Validate description
    if (!tool.description || typeof tool.description !== 'string') {
        errors.push('Tool description is required');
    } else {
        const description = tool.description.trim();
        if (description === '') {
            errors.push('Tool description cannot be empty');
        } else if (description.length > 500) {
            errors.push('Tool description cannot exceed 500 characters');
        } else {
            normalized.description = description;
        }
    }

    // Validate endpoint URL (if present)
    if (tool.endpointUrl) {
        const urlResult = validateUrl(tool.endpointUrl);
        if (!urlResult.isValid) {
            errors.push(`Endpoint URL: ${urlResult.error}`);
        } else {
            normalized.endpointUrl = urlResult.normalizedUrl;
        }
    }

    // Validate HTTP method (if present)
    if (tool.httpMethod) {
        const validMethods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];
        const method = tool.httpMethod.toUpperCase();
        if (!validMethods.includes(method)) {
            errors.push(`HTTP method must be one of: ${validMethods.join(', ')}`);
        } else {
            normalized.httpMethod = method;
        }
    }

    // Validate parameters (if present)
    if (tool.parameters !== undefined) {
        if (typeof tool.parameters === 'string') {
            const jsonResult = validateJson(tool.parameters);
            if (!jsonResult.isValid) {
                errors.push(`Parameters: ${jsonResult.error}`);
            } else {
                normalized.parameters = JSON.stringify(jsonResult.parsedValue);
            }
        } else if (typeof tool.parameters === 'object') {
            normalized.parameters = JSON.stringify(tool.parameters);
        } else {
            errors.push('Parameters must be a JSON string or object');
        }
    }

    return {
        isValid: errors.length === 0,
        errors,
        normalized: { ...tool, ...normalized }
    };
}

/**
 * Sanitize HTML string
 * @param {string} html - HTML string to sanitize
 * @returns {string} Sanitized HTML
 */
export function sanitizeHtml(html) {
    if (!html || typeof html !== 'string') {
        return '';
    }

    return html
        .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
        .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, '')
        .replace(/javascript:/gi, '')
        .replace(/on\w+\s*=/gi, '');
}

/**
 * Generate unique ID
 * @param {string} prefix - ID prefix
 * @returns {string} Unique ID
 */
export function generateId(prefix = 'id') {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}