import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  const startTime = Date.now();
  
  try {
    // Parse incoming request
    const body = await request.json();
    const { prompt } = body;

    if (!prompt) {
      console.error('[LLM API] Missing prompt in request');
      return NextResponse.json(
        { error: 'Prompt is required' },
        { status: 400 }
      );
    }

    console.log('[LLM API] Received prompt:', prompt.substring(0, 100) + '...');
    console.log('[LLM API] Forwarding to VM Flask API at http://10.7.32.74:5000/api/input');

    // Forward request to VM Flask API
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 300000); // 300 second (5 minute) timeout

    try {
      const response = await fetch('http://10.7.32.74:5000/api/input', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ prompt }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      const elapsed = Date.now() - startTime;
      console.log(`[LLM API] Response received in ${elapsed}ms`);

      if (!response.ok) {
        const errorText = await response.text();
        console.error('[LLM API] Flask API error:', response.status, errorText);
        return NextResponse.json(
          { 
            error: 'LLM server error', 
            details: `Status ${response.status}: ${errorText}` 
          },
          { status: response.status }
        );
      }

      // Parse Flask API response
      const data = await response.json();
      console.log('[LLM API] Flask response status:', data.status);
      console.log('[LLM API] Flask response keys:', Object.keys(data));
      console.log('[LLM API] Full response:', JSON.stringify(data).substring(0, 200));

      // Validate response format
      if (data.status !== 'success') {
        console.error('[LLM API] Non-success status:', data);
        return NextResponse.json(
          { error: 'LLM processing failed', details: data.error || data.message || 'Unknown error' },
          { status: 500 }
        );
      }
      
      if (!data.output) {
        console.error('[LLM API] Missing output field:', data);
        return NextResponse.json(
          { error: 'Invalid response from LLM server', details: 'No output field in response' },
          { status: 500 }
        );
      }

      console.log('[LLM API] Success! Output length:', data.output.length);
      
      // Return the output
      return NextResponse.json({
        success: true,
        output: data.output,
        processingTime: elapsed,
      });

    } catch (fetchError: any) {
      clearTimeout(timeoutId);
      
      if (fetchError.name === 'AbortError') {
        console.error('[LLM API] Request timeout after 300 seconds');
        return NextResponse.json(
          { error: 'Request timeout', details: 'LLM server took too long to respond (>5 minutes)' },
          { status: 504 }
        );
      }

      throw fetchError;
    }

  } catch (error: any) {
    const elapsed = Date.now() - startTime;
    console.error('[LLM API] Error after', elapsed, 'ms:', error);
    
    return NextResponse.json(
      { 
        error: 'Failed to process request', 
        details: error.message,
        type: error.name 
      },
      { status: 500 }
    );
  }
}
