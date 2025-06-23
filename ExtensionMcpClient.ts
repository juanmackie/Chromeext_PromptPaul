import { Client, ClientTransport } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import {
    CallToolResultSchema,
    ListToolsResultSchema,
    // Assuming we might need these later, based on McpHub.ts
    // ListResourcesResultSchema,
    // ListResourceTemplatesResultSchema,
    // ReadResourceResultSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

// Assuming schemas.ts might be useful for server config validation later
// import { ServerConfigSchema } from "./schemas"; // Path might need adjustment

// Define a basic server configuration structure for the extension
export const ExtensionServerConfigSchema = z.object({
    name: z.string(),
    url: z.string().url(),
    type: z.enum(["sse", "streamableHttp"]),
    // Add other relevant fields from McpServerConfig or ServerConfigSchema if needed
    // e.g., headers, disabled, timeout
    headers: z.record(z.string()).optional(),
    timeout: z.number().optional().default(30000), // Default timeout 30s
});

export type ExtensionServerConfig = z.infer<typeof ExtensionServerConfigSchema>;

export type McpTool = z.infer<typeof ListToolsResultSchema>["tools"][number];
export type McpToolCallResponse = z.infer<typeof CallToolResultSchema>;

// Define the structure for elicitation notifications (based on background.js and mcp_server.js)
const ElicitationNotificationBaseSchema = z.object({
    tool_name: z.string(),
    request_id: z.string(), // The ID the client must send back (server's ID for this elicitation step)
    original_llm_tool_call_id: z.string().optional(), // The ID of the initial tools/call request from the LLM via client
});

export const MissingParametersNotificationSchema = ElicitationNotificationBaseSchema.extend({
    missing_parameters: z.array(z.object({
        name: z.string(),
        type: z.string(),
        description: z.string().optional(),
    })),
    // original_llm_tool_call_id is inherited from ElicitationNotificationBaseSchema
});
export type MissingParametersNotification = z.infer<typeof MissingParametersNotificationSchema>;

export const RequestConsentNotificationSchema = ElicitationNotificationBaseSchema.extend({
    permissions_hint: z.string().optional(),
    // original_llm_tool_call_id is inherited from ElicitationNotificationBaseSchema
});
export type RequestConsentNotification = z.infer<typeof RequestConsentNotificationSchema>;


// Define a generic notification schema for the SDK's notification handler
// This will help in routing different notification types.
const GenericNotificationSchema = z.object({
    method: z.string(),
    params: z.any().optional(),
});


export class ExtensionMcpClient {
    private client: Client | null = null;
    private transport: ClientTransport | null = null;
    private config: ExtensionServerConfig;
    private clientInfo: { name: string; version: string };

    // Callbacks for elicitation, to be set by background.js
    public onMissingParameters: ((params: MissingParametersNotification) => void) | null = null;
    public onRequestConsent: ((params: RequestConsentNotification) => void) | null = null;
    public onGenericNotification: ((method: string, params: any) => void) | null = null;


    constructor(config: ExtensionServerConfig, clientInfo = { name: "PromptPaulExtensionClient", version: "0.1.0" }) {
        this.config = config;
        this.clientInfo = clientInfo;
    }

    private validateConfig(): boolean {
        const result = ExtensionServerConfigSchema.safeParse(this.config);
        if (!result.success) {
            console.error("Invalid MCP server configuration:", result.error);
            return false;
        }
        this.config = result.data; // Use validated and potentially defaulted data
        return true;
    }

    async connect(): Promise<boolean> {
        if (!this.validateConfig()) {
            return false;
        }

        if (this.client && this.client.state !== "closed") {
            console.log(`Already connected or connecting to ${this.config.name}`);
            return true;
        }

        this.client = new Client(this.clientInfo, { capabilities: { elicitation: {} } }); // Declare elicitation capability

        console.log(`Attempting to connect to MCP server: ${this.config.name} at ${this.config.url} using ${this.config.type}`);

        try {
            switch (this.config.type) {
                case "sse":
                    // Note: ReconnectingEventSource might be needed for robust SSE if not handled by SDK's SSEClientTransport
                    // For now, using the SDK's transport directly.
                    // global.EventSource = ReconnectingEventSource; // This was in McpHub, might be needed if SDK's SSE is basic
                    this.transport = new SSEClientTransport(new URL(this.config.url), {
                        requestInit: { headers: this.config.headers },
                        // eventSourceInit: { withCredentials: !!this.config.headers?.["Authorization"] } // Example option
                    });
                    break;
                case "streamableHttp":
                    this.transport = new StreamableHTTPClientTransport(new URL(this.config.url), {
                        requestInit: { headers: this.config.headers },
                    });
                    break;
                default:
                    console.error(`Unknown transport type: ${this.config.type}`);
                    return false;
            }

            this.transport.onerror = (error) => {
                console.error(`Transport error for "${this.config.name}":`, error);
                // Optionally, notify background.js or UI about the disconnection
            };

            // McpHub.ts has transport.onclose handling. SDK transports might handle this internally
            // or expose similar events if needed.

            await this.client.connect(this.transport);
            console.log(`Successfully connected to ${this.config.name}`);

            this.setupNotificationHandlers();

            return true;
        } catch (error) {
            console.error(`Failed to connect to ${this.config.name}:`, error);
            this.client = null;
            this.transport = null;
            return false;
        }
    }

    private setupNotificationHandlers() {
        if (!this.client) return;

        // Specific handler for tool/missingParameters
        this.client.setNotificationHandler(
            z.object({ method: z.literal("tool/missingParameters"), params: MissingParametersNotificationSchema }),
            (notification) => {
                console.log("[ExtensionMcpClient] Received tool/missingParameters notification:", notification.params);
                if (this.onMissingParameters) {
                    this.onMissingParameters(notification.params);
                } else {
                    console.warn("[ExtensionMcpClient] onMissingParameters callback not set.");
                }
            }
        );

        // Specific handler for tool/requestConsent
        this.client.setNotificationHandler(
            z.object({ method: z.literal("tool/requestConsent"), params: RequestConsentNotificationSchema }),
            (notification) => {
                console.log("[ExtensionMcpClient] Received tool/requestConsent notification:", notification.params);
                if (this.onRequestConsent) {
                    this.onRequestConsent(notification.params);
                } else {
                    console.warn("[ExtensionMcpClient] onRequestConsent callback not set.");
                }
            }
        );

        // Fallback for other notifications
        this.client.fallbackNotificationHandler = (notification:any) => {
            console.log(`[ExtensionMcpClient] Received fallback/generic notification:`, notification);
            // Attempt to parse with a generic schema to see if it has method and params
            const parsed = GenericNotificationSchema.safeParse(notification);
            if (parsed.success) {
                if (this.onGenericNotification) {
                    this.onGenericNotification(parsed.data.method, parsed.data.params);
                } else {
                     console.warn(`[ExtensionMcpClient] onGenericNotification callback not set. Method: ${parsed.data.method}`);
                }
            } else {
                 console.warn("[ExtensionMcpClient] Received a fallback notification that doesn't match GenericNotificationSchema:", notification);
            }
        };

        console.log("[ExtensionMcpClient] Notification handlers set up.");
    }


    async listTools(): Promise<McpTool[]> {
        if (!this.client || this.client.state !== "connected") {
            throw new Error("Client not connected. Call connect() first.");
        }
        try {
            const response = await this.client.request(
                { method: "tools/list" },
                ListToolsResultSchema,
                { timeout: this.config.timeout }
            );
            return response?.tools || [];
        } catch (error) {
            console.error(`Failed to fetch tools from ${this.config.name}:`, error);
            throw error;
        }
    }

    async callTool(toolName: string, toolArguments?: Record<string, unknown>): Promise<McpToolCallResponse> {
        if (!this.client || this.client.state !== "connected") {
            throw new Error("Client not connected. Call connect() first.");
        }
        try {
            const result = await this.client.request(
                {
                    method: "tools/call", // Standard MCP method
                    params: {
                        name: toolName,
                        arguments: toolArguments,
                    },
                },
                CallToolResultSchema,
                { timeout: this.config.timeout }
            );
            // Ensure content is always an array as per McpHub.ts
            return {
                ...result,
                content: result.content ?? [],
            };
        } catch (error) {
            console.error(`Failed to call tool "${toolName}" on ${this.config.name}:`, error);
            throw error;
        }
    }

    // Method to send elicitation responses (parametersFilled, consentResponse)
    // These are typically notifications or specific requests the server defines.
    // Assuming the server expects these as requests.
    async sendElicitationResponse(method: string, params: Record<string, unknown>): Promise<any> {
        if (!this.client || this.client.state !== "connected") {
            throw new Error("Client not connected. Call connect() first.");
        }
        try {
            // For elicitation responses, the server might not return a meaningful "result"
            // in the same way a tool call does. It might just be an acknowledgement.
            // We'll use a generic schema or expect a simple success/error.
            const response = await this.client.request(
                { method, params },
                z.any(), // Using z.any() for now, refine if server has specific response schema
                { timeout: this.config.timeout }
            );
            console.log(`[ExtensionMcpClient] Elicitation response for "${method}" sent. Server response:`, response);
            return response;
        } catch (error) {
            console.error(`[ExtensionMcpClient] Failed to send elicitation response for "${method}":`, error);
            throw error;
        }
    }


    async disconnect(): Promise<void> {
        if (this.client && this.client.state !== "closed") {
            try {
                await this.client.close();
                console.log(`Disconnected from ${this.config.name}`);
            } catch (error) {
                console.error(`Error disconnecting from ${this.config.name}:`, error);
            }
        }
        if (this.transport) {
            try {
                await this.transport.close();
            } catch (error) {
                // Transport close errors might be less critical if client.close() succeeded
                console.warn(`Error closing transport for ${this.config.name}:`, error);
            }
        }
        this.client = null;
        this.transport = null;
    }

    isConnected(): boolean {
        return this.client?.state === "connected";
    }

    getClientState(): string | null {
        return this.client?.state ?? null;
    }
}

// Example Usage (for testing, would be in background.js normally)
/*
async function testMcpClient() {
    const config: ExtensionServerConfig = {
        name: "TestServer",
        url: "http://localhost:3000/mcp", // Adjust to your mcp_server.js URL
        type: "streamableHttp", // or "sse"
        timeout: 10000
    };

    const mcpClient = new ExtensionMcpClient(config);

    mcpClient.onMissingParameters = (params) => {
        console.log("Need to ask user for params:", params);
        // Example: prompt user, then call:
        // mcpClient.sendElicitationResponse("tool/parametersFilled", { request_id: params.request_id, filled_parameters: { ... } });
    };

    mcpClient.onRequestConsent = (params) => {
        console.log("Need to ask user for consent:", params);
        // Example: prompt user, then call:
        // mcpClient.sendElicitationResponse("tool/consentResponse", { request_id: params.request_id, decision: "allow" });
    };

    if (await mcpClient.connect()) {
        try {
            const tools = await mcpClient.listTools();
            console.log("Available tools:", tools);

            if (tools.length > 0) {
                // Assuming a tool named "echo_test" exists from tool_manifest.json
                // that requires a parameter "message"
                // const toolName = tools[0].name;
                // const result = await mcpClient.callTool(toolName, { message: "Hello from ExtensionMcpClient" });
                // console.log(`Result of calling ${toolName}:`, result);
            }
        } catch (error) {
            console.error("Error during MCP operations:", error);
        } finally {
            // await mcpClient.disconnect();
        }
    }
}

// testMcpClient();
*/
