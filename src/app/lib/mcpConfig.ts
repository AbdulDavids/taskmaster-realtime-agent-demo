// Build hosted MCP tool(s) from saved Taskmaster token and URL.
// Optional JSON-based MCP config support (Claude-style)
export type McpServerConfig = {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
};

export type McpConfig = {
  mcpServers?: Record<string, McpServerConfig>;
};

export type HostedMcpServer = {
  label: string;
  url: string;
  headers?: Record<string, string>;
};

export type StdioMcpServer = {
  label: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
};

export type ParsedMcpServers = {
  hosted: HostedMcpServer[];
  stdio: StdioMcpServer[];
};

function substituteEnv(value: string, env: Record<string, string> = {}) {
  return value.replace(/\$\{([^}]+)\}/g, (_m, v) => (env[v] ?? ""));
}

function isStdioServer(cfg: McpServerConfig): boolean {
  const args = cfg.args || [];
  // mcp-remote is a stdio client that connects to remote servers
  // It should be treated as a stdio server, not hosted
  if (args.includes("mcp-remote")) {
    return true;
  }
  // Check if any arg looks like a URL (without mcp-remote)
  if (args.some((a) => /^https?:\/\//.test(a))) {
    return false;
  }
  // Otherwise, it's a stdio server (e.g., npx with package name, or --transport stdio)
  return true;
}

export function parseMcpConfig(jsonText: string): ParsedMcpServers {
  let parsed: McpConfig;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    throw new Error("Invalid JSON for MCP config");
  }

  const hosted: HostedMcpServer[] = [];
  const stdio: StdioMcpServer[] = [];
  const entries = Object.entries(parsed.mcpServers || {});

  for (const [label, cfg] of entries) {
    const args = cfg.args || [];
    const env = cfg.env || {};

    if (isStdioServer(cfg)) {
      // Stdio server (e.g., npx slack-mcp-server, etc.)
      if (!cfg.command) continue;
      stdio.push({
        label,
        command: cfg.command,
        args: args.map((a) => substituteEnv(a, env)),
        env,
      });
    } else {
      // Remote/hosted server
      let url = "";
      const headers: Record<string, string> = {};

      // Find URL
      if (args.length >= 2 && args[0] === "mcp-remote" && /^https?:\/\//.test(args[1])) {
        url = substituteEnv(args[1], env);
      } else {
        const maybeUrl = args.find((a) => /^https?:\/\//.test(a));
        if (maybeUrl) url = substituteEnv(maybeUrl, env);
      }

      // Parse --header Key:Value entries
      for (let i = 0; i < args.length; i++) {
        if (args[i] === "--header") {
          const kv = args[i + 1] || "";
          const expanded = substituteEnv(kv, env);
          const splitIdx = expanded.indexOf(":");
          if (splitIdx > 0) {
            const k = expanded.slice(0, splitIdx).trim();
            const v = expanded.slice(splitIdx + 1).trim();
            if (k) headers[k] = v;
          }
          i++;
        }
      }

      if (url) hosted.push({ label, url, headers: Object.keys(headers).length ? headers : undefined });
    }
  }

  return { hosted, stdio };
}

// Legacy function for backward compatibility
export function parseMcpConfigToHostedServers(jsonText: string): HostedMcpServer[] {
  return parseMcpConfig(jsonText).hosted;
}

export async function getHostedMcpToolsFromLocalStorage(): Promise<any[]> {
  if (typeof window === "undefined") return [];
  const rawJson = window.localStorage.getItem("mcpConfig");
  if (!rawJson || !rawJson.trim()) return [];
  const servers = parseMcpConfigToHostedServers(rawJson);
  return servers.map((s) => ({
    type: "mcp",
    server_label: s.label,
    server_url: s.url,
    headers: s.headers,
    require_approval: 'never',
  }));
}
