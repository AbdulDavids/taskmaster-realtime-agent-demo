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

function substituteEnv(value: string, env: Record<string, string> = {}) {
  return value.replace(/\$\{([^}]+)\}/g, (_m, v) => (env[v] ?? ""));
}

export function parseMcpConfigToHostedServers(jsonText: string): HostedMcpServer[] {
  let parsed: McpConfig;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    throw new Error("Invalid JSON for MCP config");
  }

  const servers: HostedMcpServer[] = [];
  const entries = Object.entries(parsed.mcpServers || {});
  for (const [label, cfg] of entries) {
    const args = cfg.args || [];
    const env = cfg.env || {};
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

    if (url) servers.push({ label, url, headers: Object.keys(headers).length ? headers : undefined });
  }

  return servers;
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
