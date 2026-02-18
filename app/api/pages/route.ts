import { NextRequest, NextResponse } from 'next/server';
import { savePage, getPagesByDocument, getPage } from '@/lib/database';

// GET pages
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    const documentId = searchParams.get('documentId');

    if (id) {
      const page = getPage(parseInt(id));
      if (!page) {
        return NextResponse.json({ error: 'Page not found' }, { status: 404 });
      }
      return NextResponse.json(page);
    }

    if (documentId) {
      const pages = getPagesByDocument(parseInt(documentId));
      return NextResponse.json(pages);
    }

    return NextResponse.json({ error: 'Missing id or documentId parameter' }, { status: 400 });
  } catch (error) {
    console.error('Error fetching pages:', error);
    return NextResponse.json({ error: 'Failed to fetch pages' }, { status: 500 });
  }
}

// POST new page
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      documentId,
      pageNumber,
      originalImage,
      processedImage,
      rotationApplied,
      isTable,
      extractedText
    } = body;

    if (!documentId || !pageNumber || !originalImage || !processedImage) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const pageId = savePage(
      documentId,
      pageNumber,
      originalImage,
      processedImage,
      rotationApplied || 0,
      isTable || false,
      extractedText
    );

    return NextResponse.json({ id: pageId, message: 'Page saved successfully' });
  } catch (error) {
    console.error('Error saving page:', error);
    return NextResponse.json({ error: 'Failed to save page' }, { status: 500 });
  }
}
