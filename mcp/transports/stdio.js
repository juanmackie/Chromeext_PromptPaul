/**
 * Stdio Transport Implementation
 * Single Responsibility: Handle process-based MCP servers via stdin/stdout
 * Testability: Dependency injection for process spawning and stream handling
 */

import { McpTransport } from './base.js';

export class StdioTransport extends McpTransport {
  constructor(config, processManager = null, logger = console) {
    super(config, logger);
    this.processManager = processManager || new ProcessManager();
    this.process = null;
    this.stdoutBuffer = '';
    this.stderrBuffer = '';
    this.isRestarting = false;
    this.restartAttempts = 0;
    this.maxRestartAttempts = 3;
  }

  /**
   * Validate stdio-specific configuration
   */
  validateConfig(config) {
    const baseConfig = super.validateConfig(config);
    
    if (!baseConfig.command || typeof baseConfig.command !== 'string') {
      throw new Error('Stdio transport requires command string');
    }

    if (baseConfig.args && !Array.isArray(baseConfig.args)) {
      throw new Error('Args must be an array');
    }

    if (baseConfig.env && typeof baseConfig.env !== 'object') {
      throw new Error('Environment must be an object');
    }

    return {
      command: baseConfig.command,
      args: baseConfig.args || [],
      env: baseConfig.env || {},
      cwd: baseConfig.cwd || process.cwd(),
      timeout: baseConfig.timeout || 30000,
      restartOnFailure: baseConfig.restartOnFailure !== false
    };
  }

  /**
   * Connect to MCP server via process spawn
   */
  async connect() {
    if (this.isConnected) {
      this.logger.warn('Stdio transport already connected');
      return;
    }

    try {
      this.logger.info(`Starting MCP server: ${this.config.command} ${this.config.args.join(' ')}`);
      
      this.process = await this.processManager.spawn({
        command: this.config.command,
        args: this.config.args,
        env: { ...process.env, ...this.config.env },
        cwd: this.config.cwd
      });

      this.setupProcessHandlers();
      this.setConnected(true);
      this.restartAttempts = 0;
      
      this.logger.info(`MCP server started with PID: ${this.process.pid}`);
    } catch (error) {
      this.logger.error('Failed to start MCP server:', error);
      this.emit('error', { error, transportId: this.connectionId });
      throw error;
    }
  }

  /**
   * Setup process event handlers
   */
  setupProcessHandlers() {
    if (!this.process) return;

    // Handle stdout messages
    this.process.stdout.on('data', (data) => {
      this.handleStdoutData(data.toString());
    });

    // Handle stderr logging
    this.process.stderr.on('data', (data) => {
      this.handleStderrData(data.toString());
    });

    // Handle process exit
    this.process.on('exit', (code, signal) => {
      this.handleProcessExit(code, signal);
    });

    // Handle process errors
    this.process.on('error', (error) => {
      this.handleProcessError(error);
    });
  }

  /**
   * Handle stdout data and parse JSON-RPC messages
   */
  handleStdoutData(data) {
    this.stdoutBuffer += data;
    
    // Process complete messages (delimited by newlines)
    const lines = this.stdoutBuffer.split('\n');
    this.stdoutBuffer = lines.pop() || ''; // Keep incomplete line in buffer

    for (const line of lines) {
      const trimmedLine = line.trim();
      if (!trimmedLine) continue;

      try {
        const message = JSON.parse(trimmedLine);
        this.validateMessage(message);
        this.emit('message', { message, transportId: this.connectionId });
      } catch (error) {
        this.logger.warn('Invalid JSON-RPC message received:', trimmedLine, error);
        this.emit('invalidMessage', { 
          data: trimmedLine, 
          error, 
          transportId: this.connectionId 
        });
      }
    }
  }

  /**
   * Handle stderr data for logging
   */
  handleStderrData(data) {
    this.stderrBuffer += data;
    
    const lines = this.stderrBuffer.split('\n');
    this.stderrBuffer = lines.pop() || '';

    for (const line of lines) {
      const trimmedLine = line.trim();
      if (trimmedLine) {
        this.logger.info(`MCP Server [stderr]: ${trimmedLine}`);
        this.emit('serverLog', { 
          level: 'info', 
          message: trimmedLine, 
          transportId: this.connectionId 
        });
      }
    }
  }

  /**
   * Handle process exit
   */
  handleProcessExit(code, signal) {
    this.logger.warn(`MCP server exited with code ${code}, signal ${signal}`);
    this.setConnected(false);
    this.process = null;

    if (this.config.restartOnFailure && 
        !this.isRestarting && 
        this.restartAttempts < this.maxRestartAttempts) {
      this.attemptRestart();
    } else {
      this.emit('processExit', { 
        code, 
        signal, 
        transportId: this.connectionId 
      });
    }
  }

  /**
   * Handle process errors
   */
  handleProcessError(error) {
    this.logger.error('MCP server process error:', error);
    this.setConnected(false);
    this.emit('error', { error, transportId: this.connectionId });
  }

  /**
   * Attempt to restart the process
   */
  async attemptRestart() {
    if (this.isRestarting) return;

    this.isRestarting = true;
    this.restartAttempts++;
    
    const delay = Math.min(1000 * Math.pow(2, this.restartAttempts - 1), 10000);
    this.logger.info(`Attempting to restart MCP server in ${delay}ms (attempt ${this.restartAttempts}/${this.maxRestartAttempts})`);

    setTimeout(async () => {
      try {
        await this.connect();
        this.emit('restarted', { 
          attempts: this.restartAttempts, 
          transportId: this.connectionId 
        });
      } catch (error) {
        this.logger.error('Failed to restart MCP server:', error);
        if (this.restartAttempts >= this.maxRestartAttempts) {
          this.emit('restartFailed', { 
            attempts: this.restartAttempts, 
            error, 
            transportId: this.connectionId 
          });
        }
      } finally {
        this.isRestarting = false;
      }
    }, delay);
  }

  /**
   * Send message to MCP server via stdin
   */
  async send(message) {
    if (!this.process || !this.isConnected) {
      throw new Error('Stdio transport not connected');
    }

    const messageStr = JSON.stringify(message) + '\n';
    
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Message send timeout'));
      }, this.config.timeout);

      this.process.stdin.write(messageStr, (error) => {
        clearTimeout(timeout);
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      });
    });
  }

  /**
   * Disconnect from MCP server
   */
  async disconnect() {
    if (!this.isConnected) {
      return;
    }

    this.logger.info('Disconnecting stdio transport');
    this.setConnected(false);

    if (this.process) {
      try {
        // Gracefully close stdin
        this.process.stdin.end();
        
        // Wait for process to exit gracefully
        await this.waitForProcessExit(5000);
      } catch (error) {
        this.logger.warn('Graceful shutdown failed, forcing termination');
        this.process.kill('SIGTERM');
        
        // Force kill if still running
        setTimeout(() => {
          if (this.process && !this.process.killed) {
            this.process.kill('SIGKILL');
          }
        }, 2000);
      }
      
      this.process = null;
    }

    this.stdoutBuffer = '';
    this.stderrBuffer = '';
  }

  /**
   * Wait for process to exit
   */
  waitForProcessExit(timeout) {
    return new Promise((resolve, reject) => {
      if (!this.process) {
        resolve();
        return;
      }

      const timer = setTimeout(() => {
        reject(new Error('Process exit timeout'));
      }, timeout);

      this.process.once('exit', () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  /**
   * Get transport type
   */
  getType() {
    return 'stdio';
  }

  /**
   * Cleanup resources
   */
  destroy() {
    this.disconnect();
    super.destroy();
  }
}

/**
 * Process Manager for dependency injection and testing
 * Single Responsibility: Abstract process spawning for testability
 */
class ProcessManager {
  async spawn(options) {
    const { spawn } = await import('child_process');
    
    return spawn(options.command, options.args, {
      env: options.env,
      cwd: options.cwd,
      stdio: ['pipe', 'pipe', 'pipe']
    });
  }
}

export { ProcessManager };