// src/index.ts
export interface Env {
  GROQ_API_KEY: string;
}

// The URL of your repository's agent directory
const AGENTS_REPO_URL = 'https://raw.githubusercontent.com/zzzzzzzzzzzzzzzzzzzzzzzzz1/agency-agents/main';

// A simplified mapping of departments to agent files
// In a real app, you might fetch a manifest file to get this dynamically.
const AGENT_MANIFEST = {
  engineering: 'engineering/engineering-ai-engineer.md',
  design: 'design/design-ui-designer.md',
  finance: 'finance/finance-analyst.md',
  // ... add more agents as needed
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // Only handle POST requests to the root path
    if (request.method !== 'POST' || new URL(request.url).pathname !== '/') {
      return new Response('Send a POST request with a JSON body containing a "prompt" field.', { status: 400 });
    }

    const { prompt } = await request.json() as { prompt: string };
    if (!prompt) {
      return new Response('Missing "prompt" in request body.', { status: 400 });
    }

    // 1. Orchestrator: Decide which agent(s) to use
    // We use Groq to analyze the prompt and select a department.
    // For simplicity, we ask the model to return a JSON object with the department name.
    const orchestratorResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.GROQ_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile', // A capable model for routing
        messages: [
          {
            role: 'system',
            content: `You are a manager. Based on the user's request, decide which single department is best suited to handle it. Respond ONLY with a JSON object like {"department": "engineering"} or {"department": "design"}. Available departments: ${Object.keys(AGENT_MANIFEST).join(', ')}.`
          },
          { role: 'user', content: prompt }
        ],
        response_format: { type: 'json_object' },
        temperature: 0.1,
      }),
    });

    if (!orchestratorResponse.ok) {
      return new Response('Orchestrator LLM call failed.', { status: 502 });
    }

    const orchestratorData = await orchestratorResponse.json();
    const routingDecision = JSON.parse(orchestratorData.choices[0].message.content);
    const department = routingDecision.department;

    // 2. Fetch the chosen agent's role definition
    const agentPath = AGENT_MANIFEST[department];
    if (!agentPath) {
      return new Response(`No agent found for department: ${department}`, { status: 404 });
    }

    const agentResponse = await fetch(`${AGENTS_REPO_URL}/${agentPath}`);
    const agentPersona = await agentResponse.text();

    // 3. Delegate to the specialized agent
    // We send a new request to Groq, using the agent's persona as the system prompt.
    const specialistResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.GROQ_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [
          { role: 'system', content: agentPersona },
          { role: 'user', content: prompt }
        ],
      }),
    });

    if (!specialistResponse.ok) {
      return new Response('Specialist LLM call failed.', { status: 502 });
    }

    const specialistData = await specialistResponse.json();
    const finalAnswer = specialistData.choices[0].message.content;

    // 4. Return the final answer
    return new Response(finalAnswer, {
      headers: { 'Content-Type': 'text/plain' },
    });
  },
};