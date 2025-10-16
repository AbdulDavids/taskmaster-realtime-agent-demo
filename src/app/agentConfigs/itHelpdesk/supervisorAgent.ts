import { RealtimeItem, tool } from '@openai/agents/realtime';
import { getHostedMcpToolsFromLocalStorage, parseMcpConfig } from '@/app/lib/mcpConfig';

export const supervisorAgentInstructions = `You are an expert IT helpdesk supervisor. You can provide direct answers or use tools to read ticket status from HubSpot and post updates to Slack.

# Guidelines
- Keep responses concise and appropriate for a live voice conversation.
- Prefer to call tools for reads/updates instead of guessing.
- If the user provides a ticket ID or email, fetch that specific ticket first.
- If the user provides no details (e.g., "I made a password reset request earlier"), attempt to locate the most likely ticket BEFORE asking questions:
  - Query HubSpot tickets from the last 14 days for keywords like "password reset", "unlock", "login", or "access" and select the most recent.
  - **ALWAYS check the #tech-support Slack channel** for recent messages (read at least the last 50 messages) to look for relevant discussions, ticket references, or updates.
  - If a strong candidate is found, summarize it and ask for quick confirmation. If there are multiple candidates, present the top 2 succinctly and ask a single disambiguating follow-up (email or approximate date).
- Do not fabricate results. If a tool is unavailable or fails, explain briefly and suggest a next step.
- When asked for ticket status:
  1. First, fetch the ticket from HubSpot
  2. **Then, ALWAYS read recent messages from the #tech-support Slack channel** (at least 50 messages) to check for any updates, discussions, or context about this ticket
  3. Summarize: status, assignee/owner, last updated time, next step, and any relevant Slack discussions
- If asked to post an update, post a short message to the #tech-support Slack channel with the key status in one sentence.
- Tool budget: At most 20 MCP tool calls in a single response.

# Important
- **The #tech-support channel is the primary communication channel for IT support tickets.**
- **ALWAYS check #tech-support for context when looking up or discussing tickets.**
- Use Slack channel tools to read messages, not just to post updates.

# Output
- Provide a single short message the chat agent can read verbatim.
`;

async function fetchResponsesMessage(body: any) {
  const response = await fetch('/api/responses', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...body, parallel_tool_calls: false }),
  });

  if (!response.ok) {
    console.warn('responses proxy error', response.status, response.statusText);
    return { error: 'Something went wrong.' };
  }

  return await response.json();
}

async function drainUntilFinal(body: any, response: any, addBreadcrumb?: (t: string, d?: any) => void) {
  let current = response;
  const approvedIds = new Set<string>();
  let mcpCallCount = 0;
  while (true) {
    if (current?.error) return { error: 'Something went wrong.' };
    const output: any[] = current.output ?? [];
    if (addBreadcrumb) addBreadcrumb('[itHelpdesk.supervisor] responses.output', output.map((i: any) => ({ type: i.type })));

    const approvals = output.filter((i) => i.type === 'mcp_approval_request');
    for (const req of approvals) {
      const reqId = req.approval_request_id || req.id;
      if (reqId && !approvedIds.has(reqId)) {
        body.input.push({
          type: 'mcp_approval_response',
          approval_request_id: reqId,
          approve: true,
        });
        approvedIds.add(reqId);
      }
    }
    if (approvals.length) {
      current = await fetchResponsesMessage(body);
      continue;
    }

    mcpCallCount += output.filter((i) => i.type === 'mcp_call').length;
    if (mcpCallCount >= 20) {
      return 'I reached my tool budget (20 calls). Could you share the exact ticket ID or email to proceed efficiently?';
    }

    const toolCalls = output.filter((i) => i.type === 'function_call');
    if (!toolCalls.length) {
      const assistantMessages = output.filter((i) => i.type === 'message');
      const text = assistantMessages
        .flatMap((m: any) => (m.content || []))
        .filter((c: any) => c.type === 'output_text')
        .map((c: any) => c.text)
        .join('');
      return text;
    }

    current = await fetchResponsesMessage(body);
  }
}

export const getNextResponseFromSupervisor = tool({
  name: 'getNextResponseFromSupervisor',
  description: 'Generates the next response using IT Helpdesk MCP tools (HubSpot + Slack) when necessary.',
  parameters: {
    type: 'object',
    properties: {
      relevantContextFromLastUserMessage: {
        type: 'string',
        description: 'Key information from the latest user message relevant to IT ticket actions.',
      },
    },
    required: ['relevantContextFromLastUserMessage'],
    additionalProperties: false,
  },
  execute: async (input, details) => {
    const { relevantContextFromLastUserMessage } = input as { relevantContextFromLastUserMessage: string };
    const history: RealtimeItem[] = (details?.context as any)?.history ?? [];
    const filteredLogs = history.filter((log) => log.type === 'message');
    const addBreadcrumb = (details?.context as any)?.addTranscriptBreadcrumb as undefined | ((t: string, d?: any) => void);

    // Get the raw MCP config
    const rawMcpConfig = typeof window !== 'undefined' ? window.localStorage.getItem('mcpConfig') : null;
    if (!rawMcpConfig || !rawMcpConfig.trim()) {
      return { nextResponse: 'I need your MCP config. Click Settings and paste your mcpServers JSON.' };
    }

    // Parse to detect stdio vs hosted servers
    const { stdio, hosted } = parseMcpConfig(rawMcpConfig);
    if (addBreadcrumb) addBreadcrumb('[itHelpdesk.supervisor] parsed MCP config', { stdioCount: stdio.length, hostedCount: hosted.length });

    // If there are stdio servers, use the new agent-based API
    if (stdio.length > 0) {
      try {
        const response = await fetch('/api/mcp-agent', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            mcpConfig: rawMcpConfig,
            instructions: supervisorAgentInstructions,
            conversationHistory: filteredLogs,
            userMessage: relevantContextFromLastUserMessage,
            maxTurns: 20,
          }),
        });

        if (!response.ok) {
          console.warn('mcp-agent error', response.status, response.statusText);
          const errorData = await response.json().catch(() => ({}));
          return { error: errorData.error || 'Something went wrong with stdio MCP servers.' };
        }

        const result = await response.json();
        if (result.error) {
          return { error: result.error };
        }

        if (addBreadcrumb) addBreadcrumb('[itHelpdesk.supervisor] stdio MCP response', { toolsAvailable: result.toolsAvailable });
        return { nextResponse: result.response };
      } catch (err: any) {
        console.error('stdio MCP error', err);
        return { error: 'Failed to execute stdio MCP agent.' };
      }
    }

    // Fall back to hosted servers via Responses API
    const mcpTools = await getHostedMcpToolsFromLocalStorage();
    if (addBreadcrumb) addBreadcrumb('[itHelpdesk.supervisor] configured hosted MCP tools', mcpTools);
    if (!mcpTools.length) {
      return { nextResponse: 'No hosted MCP servers found. Please check your config.' };
    }

    const body: any = {
      model: 'gpt-4.1',
      input: [
        { type: 'message', role: 'system', content: supervisorAgentInstructions },
        {
          type: 'message',
          role: 'user',
          content: `==== Conversation History ====\n${JSON.stringify(filteredLogs, null, 2)}\n\n==== Relevant Context From Last User Message ===\n${relevantContextFromLastUserMessage}\n`,
        },
      ],
      tools: mcpTools,
    };

    const response = await fetchResponsesMessage(body);
    if (response.error) return { error: 'Something went wrong.' };
    const finalText = await drainUntilFinal(body, response, addBreadcrumb);
    if ((finalText as any)?.error) return { error: 'Something went wrong.' };
    return { nextResponse: finalText as string };
  },
});
