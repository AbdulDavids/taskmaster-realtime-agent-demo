import { RealtimeItem, tool } from '@openai/agents/realtime';
import { getHostedMcpToolsFromLocalStorage } from '@/app/lib/mcpConfig';

export const supervisorAgentInstructions = `You are an expert Taskmaster supervisor agent for Speakeasy's Taskmaster app. You can provide direct answers or use tools to manage boards, lists, and cards.

# Guidelines
- Keep responses concise and appropriate for a live voice conversation.
- Prefer to call tools for actions (create/update/read) over guessing. If details are missing, ask the user for the exact missing fields (e.g., board name, list name, card title).
- Do not fabricate results. If a tool is unavailable or fails, explain briefly and suggest a next step.
- If the user asks for anything outside Taskmaster scope or risky operations, ask for confirmation or decline.

- First, discover available tools on the Taskmaster MCP server (list tools). Then pick the most appropriate tool and call it. Do not ask the user for details you can retrieve via tools.

- When asked to "list projects" or "what tasks do I have", proactively use the Taskmaster tools to fetch the answer.

- Tool budget: In any single response, you may call at most 5 MCP tools in total. If you reach 5 calls and still need information, stop and summarize what you have, then ask one specific follow-up question to proceed.

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

/**
 * Iterate until the model produces a final message. For hosted MCP tools we
 * expect the Responses API to perform the tool calls, so most runs will have
 * no local function_call items to handle.
 */
async function drainUntilFinal(body: any, response: any, addBreadcrumb?: (t: string, d?: any) => void) {
  let current = response;
  const approvedIds = new Set<string>();
  let mcpCallCount = 0;
  while (true) {
    if (current?.error) return { error: 'Something went wrong.' };
    const output: any[] = current.output ?? [];
    if (addBreadcrumb) addBreadcrumb('[supervisorAgent] responses.output', output.map((i: any) => ({ type: i.type })));
    // Auto-approve any pending MCP approval requests to keep the demo flowing
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
    // Count MCP tool calls for budgeting
    mcpCallCount += output.filter((i) => i.type === 'mcp_call').length;
    if (mcpCallCount >= 5) {
      return 'I reached my tool budget (5 calls). Could you specify the exact board or project so I can proceed efficiently?';
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

    // No local tools for Taskmaster supervisor. If the model returned a tool
    // call here, we don't execute it locally; we simply re-send to let the model
    // progress after its own tool usage (hosted MCP) or to surface an error.
    current = await fetchResponsesMessage(body);
  }
}

export const getNextResponseFromSupervisor = tool({
  name: 'getNextResponseFromSupervisor',
  description: 'Generates the next response using remote Taskmaster MCP tools when necessary.',
  parameters: {
    type: 'object',
    properties: {
      relevantContextFromLastUserMessage: {
        type: 'string',
        description: 'Key information from the latest user message relevant to Taskmaster actions.',
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
    if (addBreadcrumb) addBreadcrumb('[supervisorAgent] configured MCP tools', mcpTools);
    if (!mcpTools.length) {
      return { nextResponse: 'I need your Remote MCP JSON. Click "MCP Config" and paste your mcpServers JSON.' };
    }

    const body: any = {
      model: 'gpt-4.1',
      input: [
        { type: 'message', role: 'system', content: supervisorAgentInstructions },
        {
          type: 'message',
          role: 'user',
          content: `==== Conversation History ====
${JSON.stringify(filteredLogs, null, 2)}

==== Relevant Context From Last User Message ===
${relevantContextFromLastUserMessage}
`,
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
