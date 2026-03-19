/**
 * @fileoverview Shared utility for building tool_choice payloads for LLM API requests.
 * Note: Policy decisions (e.g., preserving load_skill in 'none' mode) are now handled
 * by the orchestrator. This file contains only mechanical formatting functions.
 * @module toolChoiceBuilder
 */

/**
 * Normalizes tool_choice value to a consistent string format.
 * Handles both string and array formats stored in user instructions.
 * @param {string|Array|undefined} tc - The tool_choice value to normalize
 * @returns {string} Normalized tool_choice: 'none', 'auto', or a tool name
 */
export function normalizeToolChoice(tc) {
    if (!tc) return 'none';
    if (Array.isArray(tc)) {
        if (tc.length === 0) return 'none';
        return tc[0];
    }
    return String(tc);
}

/**
 * Builds the tool_choice payload for LLM API requests.
 * @param {Object} options - Configuration options
 * @param {Array} options.formattedTools - Array of tools in OpenAI format: {type: 'function', function: {name, description, parameters}}
 * @param {string} options.toolChoice - Tool choice strategy: 'none', 'auto', or specific tool name
 * @returns {Object} The tool_choice payload to spread into request body: {tools, tool_choice}
 */
export function buildToolChoicePayload(options) {
    const { formattedTools, toolChoice } = options;

    // If no tools or none requested, return empty
    if (formattedTools.length === 0 || toolChoice === 'none') {
        return {};
    }

    // Auto mode - use all available tools
    if (toolChoice === 'auto') {
        return { tools: formattedTools, tool_choice: 'auto' };
    }

    // Specific tool requested
    if (typeof toolChoice === 'string') {
        const specificTool = formattedTools.find(t => t.function.name === toolChoice);
        if (specificTool) {
            return {
                tools: [specificTool],
                tool_choice: { type: 'function', function: { name: toolChoice } }
            };
        }
    }

    // Array of tools selected
    if (Array.isArray(toolChoice) && toolChoice.length > 0) {
        const selectedTools = formattedTools.filter(tool =>
            toolChoice.includes(tool.function.name)
        );
        if (selectedTools.length > 0) {
            const tcObject = selectedTools.length === 1
                ? { type: 'function', function: { name: selectedTools[0].function.name } }
                : 'auto';
            return { tools: selectedTools, tool_choice: tcObject };
        }
    }

    // Fallback to auto mode
    return { tools: formattedTools, tool_choice: 'auto' };
}

/**
 * Formats raw tool definitions into OpenAI-compatible format.
 * @param {Array} tools - Raw tool definitions with name, description, and parameters (string or object)
 * @returns {Array} Formatted tools array
 */
export function formatToolsForLlm(tools) {
    return tools.map(tool => {
        try {
            const parameters = typeof tool.parameters === 'string'
                ? JSON.parse(tool.parameters)
                : (tool.parametersForLlm || tool.parameters || {});

            return {
                type: 'function',
                function: {
                    name: tool.name,
                    description: tool.description,
                    parameters: parameters
                }
            };
        } catch (e) {
            console.error(`toolChoiceBuilder: Error parsing parameters for tool ${tool.name}:`, e);
            return null;
        }
    }).filter(tool => tool !== null);
}
