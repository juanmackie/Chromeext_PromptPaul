export class SandboxManager {
    constructor() {
        this.sandboxes = {};
    }

    async startSandbox(tool) {
        if (this.sandboxes[tool.id]) {
            console.log(`Sandbox for ${tool.name} is already running.`);
            return this.sandboxes[tool.id];
        }

        console.log(`Starting sandbox for ${tool.name}...`);
        // This is a placeholder for the actual sandbox implementation.
        // In a real implementation, this would involve calling the E2B API or a similar service.
        const sandbox = {
            id: tool.id,
            tool: tool,
            status: 'running',
            url: tool.mcpServerUrl,
            stop: async () => {
                console.log(`Stopping sandbox for ${tool.name}...`);
                delete this.sandboxes[tool.id];
            }
        };

        this.sandboxes[tool.id] = sandbox;
        return sandbox;
    }

    async stopSandbox(toolId) {
        const sandbox = this.sandboxes[toolId];
        if (sandbox) {
            await sandbox.stop();
        }
    }

    getSandbox(toolId) {
        return this.sandboxes[toolId];
    }
}
