import { RealtimeItem, tool } from '@openai/agents/realtime';
import { getHostedMcpToolsFromLocalStorage } from '@/app/lib/mcpConfig';

export const supervisorAgentInstructions = `You are an expert IT helpdesk supervisor. You can provide direct answers or use tools to read ticket status from HubSpot and post updates to Slack.

# Guidelines
- Keep responses concise and appropriate for a live voice conversation.
- Prefer to call tools for reads/updates instead of guessing.
- If the user provides a ticket ID or email, fetch that specific ticket first.
- If the user provides no details (e.g., "I made a password reset request earlier"), attempt to locate the most likely ticket BEFORE asking questions:
  - Query HubSpot tickets from the last 14 days for keywords like "password reset", "unlock", "login", or "access" and select the most recent.
  - If Slack read access is available, read the recent messages (e.g., last 50) in #tech-support to look for relevant threads or links.
  - If a strong candidate is found, summarize it and ask for quick confirmation. If there are multiple candidates, present the top 2 succinctly and ask a single disambiguating follow-up (email or approximate date).
- Do not fabricate results. If a tool is unavailable or fails, explain briefly and suggest a next step.
- First, discover available tools on the IT Helpdesk MCP server (list tools). Then pick the most appropriate tool and call it.
- When asked for status, fetch the ticket and summarize: status, assignee/owner, last updated time, and next step.
- If Slack read access is available, also read recent messages from the #tech-support channel (e.g., last 50) to check for relevant updates (by ticket ID or requester email) and include any useful context in your summary.
- If asked, post a short update to Slack with the key status in one sentence.
- Tool budget: At most 20 MCP tool calls in a single response.

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
  let approvedIds = new Set<string>();
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

    const mcpTools = await getHostedMcpToolsFromLocalStorage();
    if (addBreadcrumb) addBreadcrumb('[itHelpdesk.supervisor] configured MCP tools', mcpTools);
    if (!mcpTools.length) {
      return { nextResponse: 'I need your Remote MCP JSON (IT Helpdesk). Click Settings and paste your mcpServers JSON.' };
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
