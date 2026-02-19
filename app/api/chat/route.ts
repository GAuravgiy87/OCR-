import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { question, context } = body;

    if (!question) {
      return NextResponse.json({ error: 'Question is required' }, { status: 400 });
    }

    console.log('[Chat API] Received question:', question);
    
    // Build prompt with database context for local LLM
    const prompt = `You are a helpful assistant that answers questions about extracted table data from documents.

Database Context:
${context}

User Question: ${question}

Please provide a clear, concise answer based on the data provided. When asked which file a table is from, look at the "From Document" field in the context.

Answer:`;

    console.log('[Chat API] Sending to local LLM...');
    
    // Call local LLM via our API route
    const llmResponse = await fetch('http://localhost:3000/api/llm', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ prompt }),
    });

    if (!llmResponse.ok) {
      const errorData = await llmResponse.json();
      console.error('[Chat API] LLM API error:', errorData);
      return NextResponse.json({ 
        error: 'Failed to get AI response', 
        details: errorData.details || errorData.error || 'Unknown error'
      }, { status: llmResponse.status });
    }

    const data = await llmResponse.json();
    const answer = data.output || 'No response generated';

    console.log('[Chat API] Received answer from local LLM');
    return NextResponse.json({ answer });

  } catch (error: any) {
    console.error('[Chat API] Error:', error);
    return NextResponse.json({ 
      error: 'Failed to get answer', 
      details: error.message 
    }, { status: 500 });
  }
}
