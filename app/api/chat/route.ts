import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { question, context } = body;

    if (!question) {
      return NextResponse.json({ error: 'Question is required' }, { status: 400 });
    }

    console.log('[Chat API] ========================================');
    console.log('[Chat API] Received question:', question);
    console.log('[Chat API] Context length:', context?.length || 0, 'characters');
    
    // Build prompt with database context for local LLM
    const prompt = `You are a helpful AI assistant that answers questions based on data from extracted documents and tables.

IMPORTANT INSTRUCTIONS:
1. Read through ALL the data provided in the Database Context below
2. Search for information that answers the user's question
3. The question might be asked in different ways, but look for the relevant information
4. If you find the answer in the data, provide it clearly
5. If the information is not in the data, say "I don't have that information in the database"
6. Always cite which document or table the information came from

DATABASE CONTEXT:
${context}

USER QUESTION: ${question}

ANSWER (based only on the data above):`;

    console.log('[Chat API] Total prompt length:', prompt.length, 'characters');
    console.log('[Chat API] Sending to local LLM...');
    
    const startTime = Date.now();
    
    // Call local LLM via our API route
    const llmResponse = await fetch('http://localhost:3000/api/llm', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ prompt }),
    });

    const elapsed = Date.now() - startTime;
    console.log('[Chat API] LLM responded in', elapsed, 'ms');

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
    console.log('[Chat API] Answer length:', answer.length, 'characters');
    console.log('[Chat API] ========================================');
    
    return NextResponse.json({ answer });

  } catch (error: any) {
    console.error('[Chat API] Error:', error);
    return NextResponse.json({ 
      error: 'Failed to get answer', 
      details: error.message 
    }, { status: 500 });
  }
}
