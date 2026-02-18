import { NextRequest, NextResponse } from 'next/server';
import { saveTable, getTableByPage, getAllTables } from '@/lib/database';

// GET tables
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const pageId = searchParams.get('pageId');

    if (pageId) {
      const table = getTableByPage(parseInt(pageId));
      if (!table) {
        return NextResponse.json({ error: 'Table not found' }, { status: 404 });
      }
      return NextResponse.json(table);
    }

    const tables = getAllTables();
    return NextResponse.json(tables);
  } catch (error) {
    console.error('Error fetching tables:', error);
    return NextResponse.json({ error: 'Failed to fetch tables' }, { status: 500 });
  }
}

// POST new table
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { pageId, tableData, rowCount, columnCount } = body;

    if (!pageId || !tableData) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const tableId = saveTable(
      pageId,
      tableData,
      rowCount || tableData.length,
      columnCount || (tableData[0]?.length || 0)
    );

    return NextResponse.json({ id: tableId, message: 'Table saved successfully' });
  } catch (error) {
    console.error('Error saving table:', error);
    return NextResponse.json({ error: 'Failed to save table' }, { status: 500 });
  }
}
