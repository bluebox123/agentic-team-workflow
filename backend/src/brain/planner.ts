import { generateContent } from "./client";
import { AGENT_REGISTRY } from "./registry";
import { BrainAnalysisResult, WorkflowDAG } from "./types";
import { validateWorkflow } from "./validator";

const SYSTEM_PROMPT = `
You are the Brain of a Workflow Orchestrator. Your goal is to map a user's request to a valid Directed Acyclic Graph (DAG) of agents.

Available Agents:
${JSON.stringify(AGENT_REGISTRY, null, 2)}

Rules:
1. Use ONLY the available agents.
2. The output must be a valid JSON object matching the 'BrainAnalysisResult' interface.
3. If the request cannot be fulfilled, set 'canExecute' to false and provide a reason.
   - **IMPORTANT**: In local workflows, do NOT reject requests just because an agent lacks a perfect feature.
     - The designer can always include URLs as plain text in a section.
     - The notifier does NOT attach files; it should send a message that includes a link/URL to the generated PDF (e.g. from designer.pdf_url).
4. If 'canExecute' is true, provide the 'workflow' object.
5. Identify dependencies correctly.
6. 'nodes' should have 'id' (unique), 'agentType' (from registry), 'inputs' (static params), 'dependencies' (list of parent node IDs).
7. 'edges' should be { from: string, to: string }.
8. **Data Passing:** To use the output of a previous task as input, use the placeholder syntax \`{{tasks.<NodeID>.outputs.<Field>}}\` directly in the 'inputs' value.
   - **CRITICAL**: The <Field> MUST exactly match one of the 'outputs' defined in the agent registry for that agent type. Do not guess or hallucinate keys (e.g. use 'summary', NOT 'summarized_content').
   - Example INPUT: "Summarize the text from the scraper."
   - Example JSON:
     {
       "id": "summarizer_node",
       "agentType": "summarizer",
       "inputs": {
         "text": "{{tasks.scraper_node.outputs.text}}"
       },
       "dependencies": ["scraper_node"]
     }
9. **Artifact References for Designer**: When the designer agent needs to embed a chart/artifact, use the \`artifact\` field in the section (NOT a template string). The format must be:
   - \`{"type": "chart", "role": "<role_value>"}\` where role matches the chart's role input
   - Example: If a chart has \`inputs: { "role": "visitor_trends" }\`, the designer section should have \`"artifact": { "type": "chart", "role": "visitor_trends" }\`
   - Do NOT use template syntax like \`{{tasks.chart.outputs.image_url}}\` for artifact references
10. **MULTIPLE CHARTS**: If the user requests N distinct charts, create EXACTLY N separate chart nodes with unique IDs and unique role values. Never merge multiple requested charts into one node.
    - Example: User requests "a bar chart for sales AND a line chart for tickets" → two nodes: {"id":"chart_sales","agentType":"chart","inputs":{"title":"Sales","type":"bar","role":"sales_chart",...}} AND {"id":"chart_tickets","agentType":"chart","inputs":{"title":"Tickets","type":"bar","role":"tickets_chart",...}}
    - The designer must reference EACH chart using its role: {"artifact":{"type":"chart","role":"sales_chart"}} and {"artifact":{"type":"chart","role":"tickets_chart"}}

Response Format (JSON only):
{
  "canExecute": boolean,
  "reasonIfCannot": string | null,
  "workflow": {
    "nodes": [
      {
        "id": "node1",
        "agentType": "scraper",
        "inputs": { "url": "https://example.com" },
        "dependencies": [],
        "outputMapping": {} 
      },
      {
        "id": "node2",
        "agentType": "summarizer",
        "inputs": { 
           "text": "{{tasks.node1.outputs.text}}",
           "max_sentences": 5 
        },
        "dependencies": ["node1"],
        "outputMapping": {}
      }
    ],
    "edges": [{ "from": "node1", "to": "node2" }],
    "executionOrder": ["node1", "node2"]
  },
  "explanation": "Brief explanation of the plan."
}
`;

export async function planWorkflow(userPrompt: string): Promise<BrainAnalysisResult> {
  const prompt = `${SYSTEM_PROMPT}\n\nUser Request: "${userPrompt}"\n\nJSON Response:`;

  try {
    const responseText = await generateContent(prompt);

    // Extract JSON from response (handle markdown blocks)
    let jsonStr = responseText.trim();
    if (jsonStr.startsWith('```json')) {
      jsonStr = jsonStr.replace(/^```json/, '').replace(/```$/, '');
    } else if (jsonStr.startsWith('```')) {
      jsonStr = jsonStr.replace(/^```/, '').replace(/```$/, '');
    }

    let result = JSON.parse(jsonStr) as BrainAnalysisResult;

    // If the model returns canExecute=false due to overly strict capability assumptions,
    // try one guided retry.
    if (result && result.canExecute === false) {
      const retryPrompt = `${prompt}\n\nRetry guidance:\n- Do not reject because the notifier cannot attach files; send a message containing the PDF link (designer.pdf_url).\n- Do not reject because the designer cannot embed a URL as a special object; include URLs/timestamps as plain text.\n\nJSON Response:`;
      const retryText = await generateContent(retryPrompt);
      let retryJson = retryText.trim();
      if (retryJson.startsWith('```json')) {
        retryJson = retryJson.replace(/^```json/, '').replace(/```$/, '');
      } else if (retryJson.startsWith('```')) {
        retryJson = retryJson.replace(/^```/, '').replace(/```$/, '');
      }
      try {
        const retryResult = JSON.parse(retryJson) as BrainAnalysisResult;
        if (retryResult && retryResult.canExecute) {
          result = retryResult;
        }
      } catch {
        // keep original result
      }
    }

    console.log("[BRAIN DEBUG] Parsed result:", JSON.stringify(result, null, 2));

    if (result.workflow) {
      // Validate the workflow
      const validation = validateWorkflow({
        nodes: result.workflow.nodes.map(n => ({
          id: n.id,
          agentType: n.agentType,
          params: n.inputs
        })),
        edges: result.workflow.edges
      });

      console.log("[BRAIN DEBUG] Validation result:", validation);

      if (!validation.valid) {
        return {
          canExecute: false,
          reasonIfCannot: `Generated workflow is invalid: ${validation.errors.join(", ")}`,
        };
      }
    }

    return result;
  } catch (error) {
    console.error("Brain planning error:", error);
    return {
      canExecute: false,
      reasonIfCannot: "Internal error during workflow planning.",
      explanation: error instanceof Error ? error.message : "Unknown error",
    };
  }
}
