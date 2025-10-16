import { NextRequest, NextResponse } from 'next/server';
import { Agent, run, MCPServerStdio } from '@openai/agents';
import { parseMcpConfig } from '@/app/lib/mcpConfig';
import { execSync } from 'child_process';

// Resolve the full path to a command (needed for Next.js API routes)
function resolveCommandPath(command: string, fallbackPaths: string[]): string {
  try {
    // Try to find command using 'which'
    const cmdPath = execSync(`which ${command}`, { encoding: 'utf-8' }).trim();
    return cmdPath;
  } catch {
    // Fallback to common locations
    for (const path of fallbackPaths) {
      try {
        execSync(`test -f ${path}`, { encoding: 'utf-8' });
        return path;
      } catch {
        // continue
      }
    }
    // Last resort - return command as-is
    return command;
  }
}

const NPX_PATH = resolveCommandPath('npx', [
  '/usr/local/bin/npx',
  '/opt/homebrew/bin/npx',
  '/usr/bin/npx',
  process.env.HOME + '/.nvm/current/bin/npx',
]);

const NODE_PATH = resolveCommandPath('node', [
  '/usr/local/bin/node',
  '/opt/homebrew/bin/node',
  '/usr/bin/node',
  process.env.HOME + '/.nvm/current/bin/node',
]);

// Build PATH environment variable with node/npx directories
function buildEnvPath(): string {
  const paths = new Set<string>();

  // Add directories containing node and npx
  const npxDir = NPX_PATH.substring(0, NPX_PATH.lastIndexOf('/'));
  const nodeDir = NODE_PATH.substring(0, NODE_PATH.lastIndexOf('/'));
  if (npxDir) paths.add(npxDir);
  if (nodeDir) paths.add(nodeDir);

  // Add existing PATH if available
  if (process.env.PATH) {
    process.env.PATH.split(':').forEach(p => paths.add(p));
  }

  return Array.from(paths).join(':');
}

const ENV_PATH = buildEnvPath();

console.log('[mcp-agent] Resolved npx path:', NPX_PATH);
console.log('[mcp-agent] Resolved node path:', NODE_PATH);
console.log('[mcp-agent] Built PATH:', ENV_PATH);

// POST /api/mcp-agent
// Execute a query using stdio MCP servers from the config
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { mcpConfig, instructions, conversationHistory, userMessage, maxTurns = 20 } = body;

    if (!mcpConfig) {
      return NextResponse.json({ error: 'Missing mcpConfig' }, { status: 400 });
    }

    if (!userMessage) {
      return NextResponse.json({ error: 'Missing userMessage' }, { status: 400 });
    }

    // Parse config to separate stdio and hosted servers
    const { stdio } = parseMcpConfig(mcpConfig);

    // For now, we only support stdio servers in this endpoint
    // Hosted servers continue to use the Responses API
    if (stdio.length === 0) {
      return NextResponse.json({
        error: 'No stdio MCP servers found in config. Use the Responses API for hosted servers.'
      }, { status: 400 });
    }

    // Initialize stdio MCP servers using fullCommand
    const mcpServers: MCPServerStdio[] = [];
    for (const server of stdio) {
      // Build the full command string with resolved npx path
      const resolvedCommand = server.command === 'npx' ? NPX_PATH : server.command;
      const argsString = (server.args || []).join(' ');
      const fullCommand = `${resolvedCommand} ${argsString}`.trim();

      // Merge user env with our PATH
      const mergedEnv = {
        ...server.env,
        PATH: ENV_PATH,
        HOME: process.env.HOME || server.env?.HOME,
      };

      const mcpServer = new MCPServerStdio({
        name: server.label,
        fullCommand,
        env: mergedEnv,
      });
      mcpServers.push(mcpServer);
    }

    // Connect all servers
    await Promise.all(mcpServers.map((s) => s.connect()));

    try {
      console.log(`[mcp-agent] Connected to ${mcpServers.length} MCP server(s)`);

      // Build the full conversation context
      let fullContext = '';
      if (conversationHistory && conversationHistory.length > 0) {
        fullContext = `==== Conversation History ====\n${JSON.stringify(conversationHistory, null, 2)}\n\n`;
      }
      fullContext += `==== Current User Message ====\n${userMessage}`;

      // Create agent with MCP servers (SDK handles tool conversion automatically)
      const agent = new Agent({
        name: 'IT Helpdesk Supervisor',
        instructions: instructions || 'You are a helpful assistant with access to MCP tools.',
        mcpServers,
      });

      console.log('[mcp-agent] Running agent...');

      // Run the agent
      const result = await run(agent, fullContext, { maxTurns });

      // Extract the final output
      const finalOutput = result.finalOutput;

      console.log('[mcp-agent] Agent execution completed successfully');

      return NextResponse.json({
        success: true,
        response: finalOutput,
      });
    } finally {
      // Clean up: close all MCP servers
      await Promise.all(mcpServers.map((s) => s.close()));
    }
  } catch (error: any) {
    console.error('MCP agent error:', error);
    return NextResponse.json({
      error: error.message || 'Internal server error'
    }, { status: 500 });
  }
}
