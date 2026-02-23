import { NextResponse } from 'next/server';
import { getStatistics } from '@/lib/localStorageDB';

// GET statistics
export async function GET() {
  try {
    const stats = getStatistics();
    return NextResponse.json(stats);
  } catch (error) {
    console.error('Error fetching statistics:', error);
    return NextResponse.json({ error: 'Failed to fetch statistics' }, { status: 500 });
  }
}
