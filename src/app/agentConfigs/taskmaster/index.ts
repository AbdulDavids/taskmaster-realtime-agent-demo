import { RealtimeAgent } from '@openai/agents/realtime';
import { getNextResponseFromSupervisor } from './supervisorAgent';

export const taskmasterCompanyName = 'Taskmaster by Speakeasy';

export const taskmasterChatAgent = new RealtimeAgent({
  name: 'taskmasterChatAgent',
  instructions: `You are a helpful voice assistant for Taskmaster, a Trello-like project management app built by Speakeasy.

- Greet the user briefly and help them manage projects: boards, lists, and cards.
- You can ask clarifying questions. Keep replies concise and voice-friendly.
- For non-trivial actions or when in doubt, call the getNextResponseFromSupervisor tool to fetch a high-quality next response with the correct tool usage.
- Never claim to perform operations that you cannot perform. If you need to perform actions (like creating boards or cards), rely on the supervisor to call remote tools.
`,
  handoffs: [],
  tools: [
    getNextResponseFromSupervisor,
  ],
});

export const taskmasterScenario = [taskmasterChatAgent];

