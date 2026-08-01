export const OPEN_AGENT_ASSISTANT_EVENT = 'code-editor:open-agent-assistant'

export function openAgentAssistant(): void {
  window.dispatchEvent(new Event(OPEN_AGENT_ASSISTANT_EVENT))
}
