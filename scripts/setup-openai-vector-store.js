import process from 'node:process';

async function setupVectorStore() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.error('OPENAI_API_KEY environment variable is required');
    process.exit(1);
  }

  const response = await fetch('https://api.openai.com/v1/vector_stores', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
      'OpenAI-Beta': 'assistants=v2',
    },
    body: JSON.stringify({}),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to create vector store: ${text}`);
  }

  const data = await response.json();
  console.log('Vector store created:', data.id);
}

setupVectorStore().catch(err => {
  console.error('Vector store setup failed:', err);
  process.exit(1);
});
