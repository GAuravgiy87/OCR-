import { NextRequest, NextResponse } from 'next/server';
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";

export async function POST(request: NextRequest) {
  console.log('AI Correct API called');
  try {
    const body = await request.json();
    console.log('Request body:', { type: body.type, dataLength: Array.isArray(body.data) ? body.data.length : body.data?.length });
    const { type, data } = body;

    if (!type || !data) {
      console.error('Missing type or data');
      return NextResponse.json({ error: 'Missing type or data' }, { status: 400 });
    }

    // Check API key
    const apiKey = process.env.GOOGLE_API_KEY || process.env.NEXT_PUBLIC_GOOGLE_API_KEY;
    console.log('API Key present:', !!apiKey);
    if (!apiKey) {
      console.error('Google API key not found');
      return NextResponse.json({ error: 'AI not configured' }, { status: 503 });
    }

    // Initialize AI
    let model;
    try {
      console.log('Initializing AI model...');
      model = new ChatGoogleGenerativeAI({
        model: "gemini-pro",
        apiKey: apiKey,
        temperature: 0.1,
        maxRetries: 2,
      });
      console.log('AI model initialized successfully');
    } catch (error) {
      console.error('Failed to initialize AI:', error);
      return NextResponse.json({ error: 'AI initialization failed' }, { status: 503 });
    }

    if (type === 'table') {
      // Correct table data
      const tableRows = data as string[][];
      
      // Limit table size to avoid timeout
      if (tableRows.length > 50) {
        console.warn('Table too large, processing first 50 rows');
        const limitedRows = tableRows.slice(0, 50);
        const tableText = limitedRows.map(row => row.join(' | ')).join('\n');
        
        const prompt = `Fix OCR errors in this table. Keep same structure. Return only corrected table with " | " separators:\n\n${tableText}`;
        
        const response = await model.invoke(prompt);
        const correctedText = response.content.toString().trim();
        const correctedRows = correctedText.split('\n').map(line => 
          line.split(' | ').map(cell => cell.trim())
        );
        
        // Combine corrected rows with remaining rows
        const finalRows = [...correctedRows, ...tableRows.slice(50)];
        return NextResponse.json({ correctedData: finalRows });
      }
      
      const tableText = tableRows.map(row => row.join(' | ')).join('\n');
      const prompt = `Fix OCR errors in this table. Keep same structure. Return only corrected table with " | " separators:\n\n${tableText}`;

      const response = await model.invoke(prompt);
      const correctedText = response.content.toString().trim();
      
      const correctedRows = correctedText.split('\n').map(line => 
        line.split(' | ').map(cell => cell.trim())
      );
      
      return NextResponse.json({ correctedData: correctedRows });

    } else if (type === 'text') {
      // Correct text data
      const text = data as string;
      
      // Limit text size
      const limitedText = text.length > 2000 ? text.substring(0, 2000) : text;
      const prompt = `Fix OCR errors in this text. Return only corrected text:\n\n${limitedText}`;

      const response = await model.invoke(prompt);
      const correctedText = response.content.toString().trim();
      
      return NextResponse.json({ correctedData: correctedText });

    } else {
      return NextResponse.json({ error: 'Invalid type' }, { status: 400 });
    }

  } catch (error: any) {
    console.error('AI correction error:', error);
    return NextResponse.json({ 
      error: 'AI correction failed', 
      details: error.message 
    }, { status: 500 });
  }
}
