import { StateGraph, END, START, Annotation } from "@langchain/langgraph";
import { BaseMessage, HumanMessage, SystemMessage, AIMessage } from "@langchain/core/messages";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import { ChatGroq } from "@langchain/groq";
import { AgentState, createInitialState } from "./state";
import { allTools, setToolState } from "./tools";
import { buildAgentPrompt } from "./prompt";

// State annotation for LangGraph
const StateAnnotation = Annotation.Root({
  query: Annotation<string>,
  docSourceId: Annotation<string>,
  docsSiteUrl: Annotation<string>,
  productName: Annotation<string>,
  messages: Annotation<BaseMessage[]>({
    reducer: (x, y) => x.concat(y),
  }),
  searchResults: Annotation<AgentState["searchResults"]>,
  rerankedResults: Annotation<AgentState["rerankedResults"]>,
  webResults: Annotation<AgentState["webResults"]>,
  confidence: Annotation<AgentState["confidence"]>,
  topScore: Annotation<number>,
  hopCount: Annotation<number>,
  usedWebFallback: Annotation<boolean>,
  answer: Annotation<string | undefined>,
  sources: Annotation<string[]>,
  finished: Annotation<boolean>,
});

type GraphState = typeof StateAnnotation.State;

// Create the model with tools
function getModel() {
  return new ChatGroq({
    model: "llama-3.3-70b-versatile",
    temperature: 0,
  }).bindTools(allTools);
}

// Agent node - calls the LLM
async function agentNode(state: GraphState): Promise<Partial<GraphState>> {
  // Set state for tools to access
  setToolState(state as AgentState);
  
  const model = getModel();
  
  // Build messages if empty
  let messages = state.messages;
  if (messages.length === 0) {
    const systemPrompt = buildAgentPrompt(state.productName, state.docsSiteUrl);
    messages = [
      new SystemMessage(systemPrompt),
      new HumanMessage(state.query),
    ];
  }
  
  const response = await model.invoke(messages);
  
  return {
    messages: [response],
  };
}

// Router - decide to continue or end
function shouldContinue(state: GraphState): "tools" | "end" {
  const lastMessage = state.messages[state.messages.length - 1] as AIMessage;
  
  // Check if finished
  if (state.finished) {
    return "end";
  }
  
  // Check for tool calls
  if (lastMessage.tool_calls && lastMessage.tool_calls.length > 0) {
    return "tools";
  }
  
  return "end";
}

// Build the graph
function buildGraph() {
  const toolNode = new ToolNode(allTools);
  
  const workflow = new StateGraph(StateAnnotation)
    .addNode("agent", agentNode)
    .addNode("tools", toolNode)
    .addEdge(START, "agent")
    .addConditionalEdges("agent", shouldContinue, {
      tools: "tools",
      end: END,
    })
    .addEdge("tools", "agent");
  
  return workflow.compile();
}

// Export the compiled graph
export const queryAgent = buildGraph();

// Convenience function to run the agent
export async function runQueryAgent(
  query: string,
  docSourceId: string,
  docsSiteUrl: string,
  productName: string,
): Promise<{
  answer: string;
  sources: string[];
  confidence: "high" | "medium" | "low";
  usedWebFallback: boolean;
}> {
  const initialState = createInitialState(query, docSourceId, docsSiteUrl, productName);
  
  const result = await queryAgent.invoke(initialState as GraphState);
  
  return {
    answer: result.answer || "Unable to generate answer.",
    sources: result.sources || [],
    confidence: result.confidence || "low",
    usedWebFallback: result.usedWebFallback || false,
  };
}
