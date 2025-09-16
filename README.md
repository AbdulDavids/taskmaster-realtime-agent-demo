# Taskmaster Realtime Agent Demo

A minimal demo using the OpenAI Realtime API + Agents SDK with hosted MCP tools.

## About the OpenAI Agents SDK

This project uses the [OpenAI Agents SDK](https://github.com/openai/openai-agents-js), a toolkit for building, managing, and deploying advanced AI agents. The SDK provides:

- A unified interface for defining agent behaviors and tool integrations.
- Built-in support for agent orchestration, state management, and event handling.
- Easy integration with the OpenAI Realtime API for low-latency, streaming interactions.
- Extensible patterns for multi-agent collaboration, handoffs, tool use, and guardrails.

For full documentation, guides, and API references, see the official [OpenAI Agents SDK Documentation](https://github.com/openai/openai-agents-js#readme).

## Setup

- npm i
- Set `OPENAI_API_KEY` in your environment (or copy `.env.sample` to `.env`)
- npm run dev
- Open http://localhost:3000
- Click Settings → paste your MCP JSON, set appearance/audio/logs/codec

## MCP JSON example

```json
{
  "mcpServers": {
    "GramAcmetodo": {
      "command": "npx",
      "args": ["mcp-remote", "https://app.getgram.ai/mcp/ritza-rzx-acmetodo-demo"]
    }
  }
}
```

## Notes
- The supervisor passes your hosted MCP server(s) to the Responses API and guides the model to list/call tools.
- Logs are off by default; enable in Settings.
- Push‑to‑talk shows a “Talk” hold button; otherwise you get a Mute/Unmute toggle.

## Agent profiles

- Default: Taskmaster project assistant
- IT Helpdesk: geared for ticket status (HubSpot) and Slack updates

You can switch profiles in the header dropdown, or via URL param `?profile=it`.
