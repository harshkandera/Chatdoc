export type StreamEvent =
  | { type: "agent_start"; runId: string }
  | { type: "tool_start"; tool: string; input: unknown }
  | { type: "tool_end"; tool: string; result: unknown }
  | { type: "token"; content: string }
  | { type: "text"; content: string }
  | {
      type: "finish";
      sources?: string[];
      confidence?: string;
      usedWebFallback?: boolean;
    }
  | { type: "error"; message: string };

export type AgentEvent =
  | { type: "tool_start"; tool: string; input: unknown }
  | { type: "tool_end"; tool: string; result: unknown };
