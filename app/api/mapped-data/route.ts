import { NextRequest, NextResponse } from 'next/server';
import { saveMappedExcel, getAllMappedExcels, getMappedExcelsByDocument } from '@/lib/localStorageDB';

export async function POST(req: NextRequest) {
  try {
    const { documentId, mappedData, columnMapping, mappedText } = await req.json();
    
    if (!documentId || !mappedData || !columnMapping) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      );
    }
    
    const id = saveMappedExcel(documentId, mappedData, columnMapping);
    
    // Trigger indexing automatically
    try {
      await fetch(`${process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000'}/api/index`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mappedId: id }),
      });
      console.log(`Indexing triggered for mapped data ID: ${id}`);
    } catch (indexError) {
      console.error('Failed to trigger indexing:', indexError);
      // Don't fail the request if indexing fails
    }
    
    return NextResponse.json({ id, success: true });
  } catch (error: any) {
    console.error('Error saving mapped data:', error);
    return NextResponse.json(
      { error: 'Failed to save mapped data', details: error.message },
      { status: 500 }
    );
  }
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const documentId = searchParams.get('documentId');
    
    if (documentId) {
      const mappedExcels = getMappedExcelsByDocument(parseInt(documentId));
      return NextResponse.json(mappedExcels);
    }
    
    const allMappedExcels = getAllMappedExcels();
    return NextResponse.json(allMappedExcels);
  } catch (error: any) {
    console.error('Error fetching mapped data:', error);
    return NextResponse.json(
      { error: 'Failed to fetch mapped data', details: error.message },
      { status: 500 }
    );
  }
}
