import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  const checks = {
    timestamp: new Date().toISOString(),
    nextjs: 'OK',
    flask: 'UNKNOWN',
    ollama: 'UNKNOWN',
  };

  try {
    // Check Flask API
    const flaskResponse = await fetch('http://10.7.32.74:5000/health', {
      method: 'GET',
      signal: AbortSignal.timeout(5000), // 5 second timeout
    });
    
    if (flaskResponse.ok) {
      checks.flask = 'OK';
      const data = await flaskResponse.json();
      checks.ollama = data.ollama || 'UNKNOWN';
    } else {
      checks.flask = `ERROR: ${flaskResponse.status}`;
    }
  } catch (error: any) {
    checks.flask = `ERROR: ${error.message}`;
  }

  return NextResponse.json(checks);
}
