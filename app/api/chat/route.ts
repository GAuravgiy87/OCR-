import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { question, context } = body;

    if (!question) {
      return NextResponse.json({ error: 'Question is required' }, { status: 400 });
    }

    // Get DeepSeek API key
    const apiKey = process.env.DEEPSEEK_API_KEY || process.env.NEXT_PUBLIC_DEEPSEEK_API_KEY;
    if (!apiKey) {
      console.error('DeepSeek API key not found');
      return NextResponse.json({ error: 'AI not configured' }, { status: 503 });
    }

    console.log('Sending question to DeepSeek...');
    
    // Use DeepSeek API (OpenAI-compatible)
    const response = await fetch(
      'https://api.deepseek.com/v1/chat/completions',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: 'deepseek-chat',
          messages: [
            {
              role: 'system',
              content: 'You are a helpful assistant that answers questions about extracted table data from documents. Provide clear, concise answers based on the data provided. When asked which file a table is from, look at the "From Document" field in the context.'
            },
            {
              role: 'user',
              content: `Database Context:\n${context}\n\nUser Question: ${question}`
            }
          ],
          temperature: 0.7,
          max_tokens: 1500
        })
      }
    );

    if (!response.ok) {
      const errorData = await response.json();
      console.error('DeepSeek API error:', errorData);
      return NextResponse.json({ 
        error: 'Failed to get AI response', 
        details: errorData.error?.message || 'Unknown error'
      }, { status: response.status });
    }

    const data = await response.json();
    const answer = data.choices?.[0]?.message?.content || 'No response generated';

    console.log('Received answer from DeepSeek');
    return NextResponse.json({ answer });

  } catch (error: any) {
    console.error('Chat API error:', error);
    return NextResponse.json({ 
      error: 'Failed to get answer', 
      details: error.message 
    }, { status: 500 });
  }
}
