import { NextRequest, NextResponse } from 'next/server';
import { saveDocument, getAllDocuments, getDocument, deleteDocument } from '@/lib/database';

// GET all documents
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (id) {
      const document = getDocument(parseInt(id));
      if (!document) {
        return NextResponse.json({ error: 'Document not found' }, { status: 404 });
      }
      return NextResponse.json(document);
    }

    const documents = getAllDocuments();
    return NextResponse.json(documents);
  } catch (error) {
    console.error('Error fetching documents:', error);
    return NextResponse.json({ error: 'Failed to fetch documents' }, { status: 500 });
  }
}

// POST new document
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { filename, fileType, fileSize, totalPages, fileData, thumbnail } = body;

    if (!filename || !fileType || !fileSize || !totalPages) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const documentId = saveDocument(
      filename,
      fileType,
      fileSize,
      totalPages,
      fileData ? Buffer.from(fileData, 'base64') : undefined,
      thumbnail ? Buffer.from(thumbnail, 'base64') : undefined
    );

    return NextResponse.json({ id: documentId, message: 'Document saved successfully' });
  } catch (error) {
    console.error('Error saving document:', error);
    return NextResponse.json({ error: 'Failed to save document' }, { status: 500 });
  }
}

// DELETE document
export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ error: 'Document ID required' }, { status: 400 });
    }

    deleteDocument(parseInt(id));
    return NextResponse.json({ message: 'Document deleted successfully' });
  } catch (error) {
    console.error('Error deleting document:', error);
    return NextResponse.json({ error: 'Failed to delete document' }, { status: 500 });
  }
}
