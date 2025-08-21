import { EventEmitter } from "node:events";
import * as fs from "node:fs";
import * as path from "node:path";
import type { Logger } from "./logger";
import type { LogLevel } from "./types";

/**
 * Runtime configuration for dynamic log level management
 */

export interface RuntimeConfigOptions {
  configFile?: string;
  watchConfig?: boolean;
  enableHttpEndpoint?: boolean;
  httpPort?: number;
  enableSignalHandlers?: boolean;
  defaultLevel?: LogLevel;
  levelOverrides?: Map<string, LogLevel>;
}

export class RuntimeConfig extends EventEmitter {
  private options: RuntimeConfigOptions;
  private loggers: Map<string, Logger> = new Map();
  private currentLevel: LogLevel;
  private levelOverrides: Map<string, LogLevel>;
  private configWatcher?: fs.FSWatcher;
  private httpServer?: any;

  constructor(options: RuntimeConfigOptions = {}) {
    super();
    this.options = {
      watchConfig: options.watchConfig ?? false,
      enableHttpEndpoint: options.enableHttpEndpoint ?? false,
      httpPort: options.httpPort ?? 3001,
      enableSignalHandlers: options.enableSignalHandlers ?? true,
      defaultLevel: options.defaultLevel ?? "info",
      ...options,
    };

    this.currentLevel = this.options.defaultLevel || "info";
    this.levelOverrides = options.levelOverrides || new Map();

    this.initialize();
  }

  private initialize(): void {
    // Load config from file if specified
    if (this.options.configFile) {
      this.loadConfigFile();

      // Watch config file for changes
      if (this.options.watchConfig) {
        this.watchConfigFile();
      }
    }

    // Set up signal handlers for runtime level changes
    if (this.options.enableSignalHandlers) {
      this.setupSignalHandlers();
    }

    // Set up HTTP endpoint for runtime configuration
    if (this.options.enableHttpEndpoint) {
      this.setupHttpEndpoint();
    }

    // Load from environment variables
    this.loadFromEnvironment();
  }

  /**
   * Register a logger for runtime configuration
   */
  registerLogger(name: string, logger: Logger): void {
    this.loggers.set(name, logger);

    // Apply current configuration
    const level = this.levelOverrides.get(name) || this.currentLevel;
    logger.setLevel(level);
  }

  /**
   * Unregister a logger
   */
  unregisterLogger(name: string): void {
    this.loggers.delete(name);
  }

  /**
   * Set the global log level
   */
  setGlobalLevel(level: LogLevel): void {
    this.currentLevel = level;

    // Update all registered loggers
    for (const [name, logger] of Array.from(this.loggers)) {
      if (!this.levelOverrides.has(name)) {
        logger.setLevel(level);
      }
    }

    this.emit("levelChanged", { type: "global", level });
  }

  /**
   * Set log level for a specific logger
   */
  setLoggerLevel(name: string, level: LogLevel): void {
    this.levelOverrides.set(name, level);

    const logger = this.loggers.get(name);
    if (logger) {
      logger.setLevel(level);
    }

    this.emit("levelChanged", { type: "logger", name, level });
  }

  /**
   * Clear level override for a specific logger
   */
  clearLoggerLevel(name: string): void {
    this.levelOverrides.delete(name);

    const logger = this.loggers.get(name);
    if (logger) {
      logger.setLevel(this.currentLevel);
    }

    this.emit("levelChanged", {
      type: "logger",
      name,
      level: this.currentLevel,
    });
  }

  /**
   * Get current configuration
   */
  getConfig(): { global: LogLevel; overrides: Record<string, LogLevel> } {
    const overrides: Record<string, LogLevel> = {};
    for (const [name, level] of Array.from(this.levelOverrides)) {
      overrides[name] = level;
    }

    return {
      global: this.currentLevel,
      overrides,
    };
  }

  /**
   * Load configuration from file
   */
  private loadConfigFile(): void {
    if (!this.options.configFile) return;

    try {
      const configPath = path.resolve(this.options.configFile);
      const configData = fs.readFileSync(configPath, "utf8");
      const config = JSON.parse(configData);

      if (config.global) {
        this.setGlobalLevel(config.global as LogLevel);
      }

      if (config.overrides) {
        for (const [name, level] of Object.entries(config.overrides)) {
          this.setLoggerLevel(name, level as LogLevel);
        }
      }

      this.emit("configLoaded", config);
    } catch (error) {
      this.emit("configError", error);
    }
  }

  /**
   * Watch configuration file for changes
   */
  private watchConfigFile(): void {
    if (!this.options.configFile) return;

    const configPath = path.resolve(this.options.configFile);

    this.configWatcher = fs.watch(configPath, (eventType) => {
      if (eventType === "change") {
        this.loadConfigFile();
      }
    });
  }

  /**
   * Load configuration from environment variables
   */
  private loadFromEnvironment(): void {
    // Global level from LOG_LEVEL
    const globalLevel = process.env.LOG_LEVEL as LogLevel;
    if (globalLevel) {
      this.setGlobalLevel(globalLevel);
    }

    // Logger-specific levels from LOG_LEVEL_<NAME>
    for (const [key, value] of Object.entries(process.env)) {
      if (key.startsWith("LOG_LEVEL_")) {
        const loggerName = key.substring(10).toLowerCase();
        this.setLoggerLevel(loggerName, value as LogLevel);
      }
    }
  }

  /**
   * Set up signal handlers for runtime level changes
   */
  private setupSignalHandlers(): void {
    // SIGUSR1: Increase log level (more verbose)
    process.on("SIGUSR1", () => {
      const levels: LogLevel[] = [
        "trace",
        "debug",
        "info",
        "warn",
        "error",
        "fatal",
      ];
      const currentIndex = levels.indexOf(this.currentLevel);
      if (currentIndex > 0) {
        this.setGlobalLevel(levels[currentIndex - 1]);
        console.log(`Log level changed to: ${levels[currentIndex - 1]}`);
      }
    });

    // SIGUSR2: Decrease log level (less verbose)
    process.on("SIGUSR2", () => {
      const levels: LogLevel[] = [
        "trace",
        "debug",
        "info",
        "warn",
        "error",
        "fatal",
      ];
      const currentIndex = levels.indexOf(this.currentLevel);
      if (currentIndex < levels.length - 1) {
        this.setGlobalLevel(levels[currentIndex + 1]);
        console.log(`Log level changed to: ${levels[currentIndex + 1]}`);
      }
    });
  }

  /**
   * Set up HTTP endpoint for runtime configuration
   */
  private setupHttpEndpoint(): void {
    const http = require("node:http");

    this.httpServer = http.createServer((req: any, res: any) => {
      // CORS headers
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader(
        "Access-Control-Allow-Methods",
        "GET, POST, PUT, DELETE, OPTIONS",
      );
      res.setHeader("Access-Control-Allow-Headers", "Content-Type");

      // Handle preflight
      if (req.method === "OPTIONS") {
        res.writeHead(200);
        res.end();
        return;
      }

      const url = new URL(req.url, `http://${req.headers.host}`);

      // GET /config - Get current configuration
      if (req.method === "GET" && url.pathname === "/config") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(this.getConfig()));
        return;
      }

      // PUT /config/global - Set global level
      if (req.method === "PUT" && url.pathname === "/config/global") {
        let body = "";
        req.on("data", (chunk: any) => {
          body += chunk;
        });
        req.on("end", () => {
          try {
            const { level } = JSON.parse(body);
            this.setGlobalLevel(level);
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ success: true, level }));
          } catch (error) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: (error as Error).message }));
          }
        });
        return;
      }

      // PUT /config/logger/:name - Set logger-specific level
      const loggerMatch = url.pathname.match(/^\/config\/logger\/(.+)$/);
      if (req.method === "PUT" && loggerMatch) {
        const loggerName = loggerMatch[1];
        let body = "";
        req.on("data", (chunk: any) => {
          body += chunk;
        });
        req.on("end", () => {
          try {
            const { level } = JSON.parse(body);
            this.setLoggerLevel(loggerName, level);
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(
              JSON.stringify({ success: true, logger: loggerName, level }),
            );
          } catch (error) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: (error as Error).message }));
          }
        });
        return;
      }

      // DELETE /config/logger/:name - Clear logger-specific level
      if (req.method === "DELETE" && loggerMatch) {
        const loggerName = loggerMatch[1];
        this.clearLoggerLevel(loggerName);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: true, logger: loggerName }));
        return;
      }

      // 404 for unknown routes
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Not found" }));
    });

    this.httpServer.listen(this.options.httpPort, () => {
      console.log(
        `Runtime config HTTP endpoint listening on port ${this.options.httpPort}`,
      );
    });
  }

  /**
   * Clean up resources
   */
  async close(): Promise<void> {
    if (this.configWatcher) {
      this.configWatcher.close();
    }

    if (this.httpServer) {
      return new Promise((resolve) => {
        this.httpServer.close(() => resolve());
      });
    }
  }
}

/**
 * Global runtime configuration instance
 */
let globalRuntimeConfig: RuntimeConfig | undefined;

/**
 * Initialize global runtime configuration
 */
export function initializeRuntimeConfig(
  options?: RuntimeConfigOptions,
): RuntimeConfig {
  if (!globalRuntimeConfig) {
    globalRuntimeConfig = new RuntimeConfig(options);
  }
  return globalRuntimeConfig;
}

/**
 * Get global runtime configuration
 */
export function getRuntimeConfig(): RuntimeConfig | undefined {
  return globalRuntimeConfig;
}

/**
 * Create a logger with runtime configuration
 */
export function createConfigurableLogger(
  name: string,
  logger: Logger,
  runtimeConfig?: RuntimeConfig,
): Logger {
  const config = runtimeConfig || globalRuntimeConfig;
  if (config) {
    config.registerLogger(name, logger);
  }
  return logger;
}

/**
 * CLI tool for runtime configuration
 */
export class LogLevelCLI {
  static async setLevel(
    target: string,
    level: LogLevel,
    port = 3001,
  ): Promise<void> {
    const http = require("node:http");

    const options = {
      hostname: "localhost",
      port,
      path: target === "global" ? "/config/global" : `/config/logger/${target}`,
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
    };

    const data = JSON.stringify({ level });

    return new Promise((resolve, reject) => {
      const req = http.request(options, (res: any) => {
        let body = "";
        res.on("data", (chunk: any) => {
          body += chunk;
        });
        res.on("end", () => {
          if (res.statusCode === 200) {
            console.log(`Successfully set log level for ${target} to ${level}`);
            resolve();
          } else {
            reject(new Error(`Failed: ${body}`));
          }
        });
      });

      req.on("error", reject);
      req.write(data);
      req.end();
    });
  }

  static async getConfig(port = 3001): Promise<void> {
    const http = require("node:http");

    const options = {
      hostname: "localhost",
      port,
      path: "/config",
      method: "GET",
    };

    return new Promise((resolve, reject) => {
      const req = http.request(options, (res: any) => {
        let body = "";
        res.on("data", (chunk: any) => {
          body += chunk;
        });
        res.on("end", () => {
          if (res.statusCode === 200) {
            const config = JSON.parse(body);
            console.log("Current configuration:");
            console.log(`  Global level: ${config.global}`);
            if (Object.keys(config.overrides).length > 0) {
              console.log("  Logger overrides:");
              for (const [name, level] of Object.entries(config.overrides)) {
                console.log(`    ${name}: ${level}`);
              }
            }
            resolve();
          } else {
            reject(new Error(`Failed: ${body}`));
          }
        });
      });

      req.on("error", reject);
      req.end();
    });
  }
}
