import { NextRequest, NextResponse } from 'next/server';
import { getMappedExcel } from '@/lib/localStorageDB';

export async function POST(req: NextRequest) {
  try {
    const { mappedId } = await req.json();
    
    if (!mappedId) {
      return NextResponse.json(
        { error: 'mappedId is required' },
        { status: 400 }
      );
    }
    
    console.log(`[Indexing] Starting indexing for mapped data ID: ${mappedId}`);
    
    const mapped = getMappedExcel(mappedId);
    if (!mapped) {
      return NextResponse.json(
        { error: 'Mapped data not found' },
        { status: 404 }
      );
    }
    
    // Note: Vector store indexing is disabled for now
    // This endpoint exists for future implementation
    console.log(`[Indexing] Mapped data found with ${mapped.mappedData.length} rows`);
    
    return NextResponse.json({
      success: true,
      count: mapped.mappedData.length - 1, // Exclude header
      mappedId,
      message: 'Indexing feature is currently disabled',
    });
  } catch (error: any) {
    console.error('[Indexing] Error:', error);
    return NextResponse.json(
      { error: 'Indexing failed', details: error.message },
      { status: 500 }
    );
  }
}
