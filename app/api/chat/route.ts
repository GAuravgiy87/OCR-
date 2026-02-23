import { NextRequest, NextResponse } from 'next/server';

/**
 * Chat API Route
 * Handles both Local LLM (Ollama) and Gemini API modes
 * Returns formatted answers with table data
 */

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { question, context, mode = 'local' } = body;

    if (!question || !context) {
      return NextResponse.json(
        { error: 'Question and context are required' },
        { status: 400 }
      );
    }

    // Enhanced prompt for better table formatting
    const prompt = `You are a helpful AI assistant that specializes in analyzing documents and presenting data in clear, structured formats.

Context (Document Data):
${context}

Question: ${question}

Instructions:
1. Analyze the context carefully to find relevant information
2. If the context contains table data, present it as a markdown table
3. Always format tabular data as proper markdown tables with headers and rows
4. If asked about documents or data, show the actual content, not just metadata
5. Be comprehensive - show all relevant data, not just summaries
6. If the answer is not in the context, say "I don't have enough information to answer this question."
7. Use clear formatting with headers, bullet points, or tables as appropriate

Example of good table formatting:
| Column 1 | Column 2 | Column 3 |
|----------|----------|----------|
| Data 1   | Data 2   | Data 3   |
| Data 4   | Data 5   | Data 6   |

Answer:`;

    const startTime = Date.now();

    /** =========================
     * LOCAL LLM (OLLAMA)
     ========================== */
    if (mode === 'local') {
      const llmResponse = await fetch('http://localhost:3000/api/llm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt,
          temperature: 0.3,
          max_tokens: 2000  // Allow longer responses for tables
        }),
      });

      if (!llmResponse.ok) {
        const err = await llmResponse.text();
        return NextResponse.json(
          { error: 'Local LLM failed', details: err },
          { status: 500 }
        );
      }

      const data = await llmResponse.json();

      return NextResponse.json({
        answer: data.output || 'No response generated',
        latency_ms: Date.now() - startTime,
        mode: 'local'
      });
    }

    /** =========================
     * GEMINI MODE
     ========================== */
    if (mode === 'gemini') {
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) {
        return NextResponse.json(
          { error: 'GEMINI_API_KEY not configured' },
          { status: 500 }
        );
      }

      const geminiResponse = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            generationConfig: {
              temperature: 0.3,
              topP: 0.8,
              maxOutputTokens: 2048  // Allow longer responses
            },
            contents: [
              {
                role: 'user',
                parts: [{ text: prompt }]
              }
            ]
          }),
        }
      );

      if (!geminiResponse.ok) {
        const err = await geminiResponse.text();
        return NextResponse.json(
          { error: 'Gemini API failed', details: err },
          { status: 500 }
        );
      }

      const data = await geminiResponse.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text || 'No response generated';

      return NextResponse.json({
        answer: text,
        latency_ms: Date.now() - startTime,
        mode: 'gemini'
      });
    }

    return NextResponse.json(
      { error: 'Invalid mode. Use local or gemini' },
      { status: 400 }
    );
  } catch (error: any) {
    return NextResponse.json(
      { error: 'Chat API crashed', details: error.message },
      { status: 500 }
    );
  }
}
