# PromptPaul Tool/Function Calling Implementation Plan

This plan outlines the steps to implement a tool/function calling feature within the PromptPaul Chrome extension, allowing the AI to leverage predefined tools based on user interaction or instructions.

## Phase 1: Tool Definition & Configuration

1.  **Modify `options.html`:**
    *   Add a new section titled "Tool Definitions".
    *   Include fields for:
        *   Tool Name (e.g., `scheduleInspection`)
        *   Tool Description (e.g., "Book an inspection appointment")
        *   Parameters (JSON Schema): Provide a `<textarea>` for users to input the JSON Schema definition for the tool's parameters. Include an example placeholder.
    *   Add "Save Tool", "Edit Tool", "Delete Tool" buttons and a table to list defined tools.
2.  **Modify `options.js`:**
    *   Implement CRUD (Create, Read, Update, Delete) functions for tools, similar to the existing "Instructions" handling.
    *   Store tool definitions in `chrome.storage.sync` under a new key, e.g., `promptPaulTools`. Each tool object should contain `name`, `description`, and `parameters` (as a string or parsed JSON).
    *   Add validation for the JSON Schema input.
3.  **Linking Tools to Instructions (Optional Enhancement):**
    *   In the "Instructions" section of `options.html`, add a multi-select dropdown populated with the names of defined tools.
    *   Modify the instruction saving logic in `options.js` to store an array of linked `toolNames` within each instruction object in `chrome.storage.sync`.

## Phase 2: Integrating Tool Calls into the Chat Flow

1.  **Modify `chat.js` - `makeApiCall` Function:**
    *   **Fetch Tools:** Before making the API call, retrieve the defined tools from `chrome.storage.sync` (`promptPaulTools`).
    *   **Format for API:** Format the fetched tool definitions according to the specific LLM API's requirements (e.g., the `tools` array for OpenAI API). This formatted list will be included in the API request payload.
    *   **Send Request:** Include the formatted tool definitions in the `fetch` request to the LLM API.
2.  **Modify `chat.js` - API Response Handling:**
    *   **Detect Tool Call:** After receiving the API response (`responseData`), check if the response indicates a tool call (e.g., check for `responseData.choices[0].message.tool_calls` or similar structure based on the API).
    *   **If Tool Call Detected:**
        *   Add the AI's message *requesting* the tool call to the `conversationHistory`.
        *   Display a temporary message in the chat like "⚙️ Using tool: `[tool_name]`...".
        *   Extract the `tool_name` and `arguments` from the response.
        *   **Send to Background for Execution:** Use `chrome.runtime.sendMessage` to send a message to `background.js` requesting execution. Include error handling and a callback to process the result.
    *   **If No Tool Call:** Proceed with the existing logic to display the regular LLM response.
3.  **Modify `background.js` - Tool Execution:**
    *   **Tool Registry:** Create a simple object mapping tool names to their corresponding JavaScript functions (e.g., `toolImplementations`). *Security Note:* This prevents arbitrary code execution.
    *   **Message Listener:** Add a listener for `chrome.runtime.onMessage` to handle the `executePromptPaulTool` action. Parse arguments, find the tool function in the registry, execute it (handling async), and send the result or error back via `sendResponse`. Ensure `return true;` for asynchronous responses.
4.  **Modify `chat.js` - Handling Tool Result:**
    *   Create a new function `handleToolResult(toolName, toolResult)`.
    *   **Add to History:** Add a new message object to `conversationHistory` representing the tool's output (e.g., `role: 'tool'`).
    *   **Call API Again:** Call `makeApiCall()` again with the updated history to get the final AI response.

## Phase 3: Refinements

*   **Error Handling:** Implement robust error handling throughout the process.
*   **UI Feedback:** Improve UI feedback during tool execution.
*   **Tool Definition UI:** Consider enhancing the JSON Schema editing experience.

## Sequence Diagram

```mermaid
sequenceDiagram
    participant User
    participant OptionsUI (options.js/html)
    participant Storage (chrome.storage.sync)
    participant ChatUI (chat.js)
    participant Background (background.js)
    participant LLM_API
    participant ToolRegistry (in background.js)

    User->>OptionsUI: Defines Tool (Name, Desc, Schema)
    OptionsUI->>Storage: Save Tool Definition

    User->>ChatUI: Enters chat message
    ChatUI->>ChatUI: Add User message to history
    ChatUI->>Storage: Get Tool Definitions
    Storage-->>ChatUI: Tool Definitions
    ChatUI->>LLM_API: Send messages + formatted tool definitions
    LLM_API-->>ChatUI: Response (requests tool_call for 'ToolX')
    ChatUI->>ChatUI: Add tool_call request to history
    ChatUI->>User: Display "Using tool: ToolX..."
    ChatUI->>Background: Request Tool Execution ('executePromptPaulTool', name='ToolX', args)
    Background->>ToolRegistry: Find & Execute ToolX(args)
    ToolRegistry-->>Background: Tool Result Data
    Background->>ChatUI: Send Tool Result (callback response)
    ChatUI->>ChatUI: Add tool result message to history
    ChatUI->>LLM_API: Send updated history (incl. tool_call & result)
    LLM_API-->>ChatUI: Final Response (using tool result)
    ChatUI->>User: Display final response