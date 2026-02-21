/**
 * @fileoverview Shared utility for building tool_choice payloads for LLM API requests.
 * Eliminates ~170 lines of duplicate code between background.js and chat.js.
 * @module toolChoiceBuilder
 */

/**
 * Builds the tool_choice payload for LLM API requests.
 * @param {Object} options - Configuration options
 * @param {Array} options.formattedTools - Array of tools in OpenAI format: {type: 'function', function: {name, description, parameters}}
 * @param {string} options.toolChoice - Tool choice strategy: 'none', 'auto', or specific tool name
 * @param {string[]} [options.reservedTools=['load_skill']] - Tool names that remain available even when toolChoice='none'
 * @returns {Object} The tool_choice payload to spread into request body: {tools, tool_choice}
 */
export function buildToolChoicePayload(options) {
    const { formattedTools, toolChoice, reservedTools = ['load_skill'] } = options;

    const loadSkillTool = formattedTools.find(t => t.function.name === 'load_skill');
    const fallbackAutoPayload = formattedTools.length > 0
        ? { tools: formattedTools, tool_choice: 'auto' }
        : {};

    if (toolChoice === 'none') {
        return loadSkillTool
            ? { tools: [loadSkillTool], tool_choice: 'auto' }
            : {};
    }

    if (formattedTools.length === 0) {
        return {};
    }

    if (toolChoice === 'auto') {
        return { tools: formattedTools, tool_choice: 'auto' };
    }

    if (typeof toolChoice === 'string') {
        const specificTool = formattedTools.find(t => t.function.name === toolChoice);
        if (specificTool) {
            return {
                tools: [specificTool],
                tool_choice: { type: 'function', function: { name: toolChoice } }
            };
        }
    }

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

    return fallbackAutoPayload;
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
