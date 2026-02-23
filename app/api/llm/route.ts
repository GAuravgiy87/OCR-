/**
 * Local LLM API Route
 * 
 * This API endpoint handles communication with the local Ollama LLM server.
 * It acts as a proxy between the frontend and Ollama, providing error handling
 * and response formatting.
 * 
 * Endpoint: POST /api/llm
 * 
 * Request Body:
 * {
 *   prompt: string  // The prompt to send to the LLM
 * }
 * 
 * Response:
 * {
 *   success: boolean
 *   output: string           // The LLM's response
 *   processingTime: number   // Time taken in milliseconds
 * }
 * 
 * Error Response:
 * {
 *   error: string
 *   details: string
 * }
 * 
 * Configuration:
 * - Ollama URL: http://localhost:11434/api/generate
 * - Model: qwen2.5:1.5b
 * - Timeout: 5 minutes (300,000ms)
 * - Stream: false (waits for complete response)
 * 
 * Common Errors:
 * - 400: Missing prompt in request
 * - 503: Cannot connect to Ollama (not running)
 * - 504: Request timeout (>5 minutes)
 * - 500: Other processing errors
 * 
 * @module api/llm
 */

import { NextRequest, NextResponse } from 'next/server';

/**
 * POST handler for LLM requests
 * 
 * Forwards prompts to the local Ollama server and returns the response.
 * Includes comprehensive error handling and logging.
 * 
 * @param {NextRequest} request - The incoming HTTP request
 * @returns {Promise<NextResponse>} JSON response with LLM output or error
 */
export async function POST(request: NextRequest) {
  const startTime = Date.now();
  
  try {
    // Parse and validate request body
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
    console.log('[LLM API] Sending to Ollama at http://localhost:11434/api/generate');

    // Set up timeout controller for long-running requests
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 300000); // 5 minutes

    try {
      // Call Ollama API with qwen2.5:1.5b model
      const response = await fetch('http://localhost:11434/api/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'qwen2.5:1.5b',
          prompt: prompt,
          stream: false, // Wait for complete response
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      const elapsed = Date.now() - startTime;
      console.log(`[LLM API] Response received in ${elapsed}ms`);

      // Handle non-OK responses from Ollama
      if (!response.ok) {
        const errorText = await response.text();
        console.error('[LLM API] Ollama error:', response.status, errorText);
        return NextResponse.json(
          { 
            error: 'Ollama server error', 
            details: `Status ${response.status}: ${errorText}. Make sure Ollama is running and qwen2.5:1.5b model is installed.` 
          },
          { status: response.status }
        );
      }

      // Parse and validate Ollama response
      const data = await response.json();
      console.log('[LLM API] Ollama response keys:', Object.keys(data));

      if (!data.response) {
        console.error('[LLM API] Missing response field:', data);
        return NextResponse.json(
          { error: 'Invalid response from Ollama', details: 'No response field in output' },
          { status: 500 }
        );
      }

      console.log('[LLM API] Success! Output length:', data.response.length);
      
      // Return successful response
      return NextResponse.json({
        success: true,
        output: data.response,
        processingTime: elapsed,
      });

    } catch (fetchError: any) {
      clearTimeout(timeoutId);
      
      // Handle timeout errors
      if (fetchError.name === 'AbortError') {
        console.error('[LLM API] Request timeout after 5 minutes');
        return NextResponse.json(
          { error: 'Request timeout', details: 'Ollama took too long to respond (>5 minutes)' },
          { status: 504 }
        );
      }

      // Handle connection errors (Ollama not running)
      if (fetchError.code === 'ECONNREFUSED' || fetchError.message.includes('fetch failed')) {
        console.error('[LLM API] Cannot connect to Ollama');
        return NextResponse.json(
          { 
            error: 'Cannot connect to Ollama', 
            details: 'Make sure Ollama is running on http://localhost:11434. Run: ollama serve' 
          },
          { status: 503 }
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
