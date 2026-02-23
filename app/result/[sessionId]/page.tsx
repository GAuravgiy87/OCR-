'use client';

import { useState, useEffect, Suspense } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { getSession, updateSession, deleteSession } from '../../../lib/sessionManager';
import { PageResult } from '../../../lib/types';
import Toast, { ToastType } from '../../../components/Toast';
import ConfirmModal from '../../../components/ConfirmModal';
import { saveDocumentWithPages } from '../../../lib/dbService';

/**
 * Results Page Content Component
 * Displays OCR results for a specific session
 */
function ResultsPageContent() {
  const params = useParams();
  const router = useRouter();
  const sessionId = params.sessionId as string;

  // Session state
  const [pageResults, setPageResults] = useState<PageResult[]>([]);
  const [allPages, setAllPages] = useState<PageResult[]>([]);
  const [fileName, setFileName] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>('');
  
  // UI state
  const [showMapping, setShowMapping] = useState(false);
  const [columnMapping, setColumnMapping] = useState<{ [key: string]: string }>({});
  const [mappedData, setMappedData] = useState<string[][] | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [editedData, setEditedData] = useState<{ [pageIndex: number]: string[][] }>({});
  const [isSavingToDb, setIsSavingToDb] = useState(false);
  const [currentDocId, setCurrentDocId] = useState<number | null>(null);

  // Toast and modal state
  const [toast, setToast] = useState<{ message: string; type: ToastType } | null>(null);
  const [confirmModal, setConfirmModal] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
  }>({
    isOpen: false,
    title: '',
    message: '',
    onConfirm: () => {},
  });

  // Predefined columns for mapping
  const predefinedColumns = [
    'Sr. No',
    'Category',
    'RFP Document Reference (Page & Section)',
    'Content of RFP Requiring Clarification',
    'Points of Clarification (Bidder Query)',
    'Response (SRA)'
  ];

  const showToast = (message: string, type: ToastType = 'info') => {
    setToast({ message, type });
  };


  const showConfirm = (title: string, message: string, onConfirm: () => void) => {
    setConfirmModal({
      isOpen: true,
      title,
      message,
      onConfirm,
    });
  };

  /**
   * Load session data on mount
   */
  useEffect(() => {
    if (!sessionId) {
      setError('No session ID provided');
      setLoading(false);
      return;
    }

    console.log(`[ResultsPage] Loading session: ${sessionId}`);
    
    const session = getSession(sessionId);
    
    if (!session) {
      setError('Session not found or expired');
      setLoading(false);
      setTimeout(() => router.push('/'), 2000);
      return;
    }

    // Load session data into state
    setPageResults(session.pageResults);
    setAllPages(session.allPages);
    setFileName(session.fileName);
    setMappedData(session.mappedData);
    setColumnMapping(session.columnMapping);
    setEditedData(session.editedData);
    setCurrentDocId(session.documentId);
    
    setLoading(false);
    console.log(`[ResultsPage] Session loaded: ${session.fileName}`);
  }, [sessionId, router]);

  /**
   * Save current state to session whenever it changes
   */
  useEffect(() => {
    if (!sessionId || loading) return;

    updateSession(sessionId, {
      pageResults,
      allPages,
      mappedData,
      columnMapping,
      editedData,
      documentId: currentDocId,
    });
  }, [sessionId, pageResults, allPages, mappedData, columnMapping, editedData, currentDocId, loading]);

  const handleColumnMapping = (predefinedCol: string, extractedCol: string) => {
    const newMapping = {
      ...columnMapping,
      [predefinedCol]: extractedCol
    };
    setColumnMapping(newMapping);
    applyMappingWithData(newMapping);
  };

  const applyMappingWithData = (mapping: { [key: string]: string }) => {
    const firstTable = pageResults.find(r => r.tableData.isTable && r.tableData.rows);
    if (!firstTable || !firstTable.tableData.rows || firstTable.tableData.rows.length < 2) return;

    const pageIndex = pageResults.indexOf(firstTable);
    const tableRows = editedData[pageIndex] || firstTable.tableData.rows;
    const extractedHeaders = tableRows[0];
    const dataRows = tableRows.slice(1);

    const mapped: string[][] = [];
    mapped.push(predefinedColumns);

    for (const row of dataRows) {
      const mappedRow: string[] = [];
      
      for (const predefinedCol of predefinedColumns) {
        const extractedCol = mapping[predefinedCol];
        if (extractedCol) {
          const colIndex = extractedHeaders.indexOf(extractedCol);
          if (colIndex !== -1 && colIndex < row.length) {
            mappedRow.push(row[colIndex]);
          } else {
            mappedRow.push('');
          }
        } else {
          mappedRow.push('');
        }
      }
      
      mapped.push(mappedRow);
    }

    setMappedData(mapped);
  };

  const handleCellEdit = (pageIndex: number, rowIndex: number, colIndex: number, value: string) => {
    const result = pageResults[pageIndex];
    if (!result || !result.tableData.rows) return;

    const currentData = editedData[pageIndex] || result.tableData.rows;
    const newData = currentData.map((row, rIdx) => 
      rIdx === rowIndex ? row.map((cell, cIdx) => cIdx === colIndex ? value : cell) : [...row]
    );

    setEditedData(prev => ({
      ...prev,
      [pageIndex]: newData
    }));

    if (showMapping) {
      applyMappingWithData(columnMapping);
    }
  };

  const exportAllToCSV = () => {
    const allTables = pageResults.filter(r => r.tableData.isTable && r.tableData.rows);
    if (allTables.length === 0) return;
    
    const csv = allTables.map((result, idx) => {
      const header = idx === 0 ? '' : `\n\n--- Page ${result.pageNumber} ---\n`;
      const tableCSV = result.tableData.rows!.map(row => 
        row.map(cell => `"${cell.replace(/"/g, '""')}"`).join(',')
      ).join('\n');
      return header + tableCSV;
    }).join('');
    
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${fileName}_tables.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportMappedData = () => {
    if (!mappedData) return;
    
    const csv = mappedData.map(row => 
      row.map(cell => `"${cell.replace(/"/g, '""')}"`).join(',')
    ).join('\n');
    
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${fileName}_mapped.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };


  const saveToDatabase = async () => {
    if (pageResults.length === 0) return;
    
    setIsSavingToDb(true);
    
    try {
      const fileType = fileName.toLowerCase().endsWith('.pdf') ? 'pdf' : 'image';
      const fileSize = 0;
      
      const result = await saveDocumentWithPages(
        fileName,
        fileType,
        fileSize,
        pageResults
      );
      
      if (result.success) {
        setCurrentDocId(result.documentId);
        showToast(`Document saved successfully! Document ID: ${result.documentId}`, 'success');
        
        // Redirect to saved document page after a short delay
        setTimeout(() => {
          router.push(`/document/${result.documentId}`);
        }, 1500);
      } else {
        showToast('Failed to save document to database', 'error');
      }
    } catch (error) {
      console.error('Error saving to database:', error);
      showToast('Error saving to database', 'error');
    } finally {
      setIsSavingToDb(false);
    }
  };

  const saveMappedDataToDatabase = async () => {
    if (!mappedData || mappedData.length === 0) {
      showToast('No mapped data to save', 'warning');
      return;
    }

    if (!currentDocId) {
      showToast('Please save the document to database first', 'warning');
      return;
    }

    setIsSavingToDb(true);

    try {
      const mappedText = mappedData.map(row => 
        row.map(cell => `"${cell.replace(/"/g, '""')}"`).join(',')
      ).join('\n');

      const response = await fetch('/api/mapped-data', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          documentId: currentDocId,
          mappedData: mappedData,
          columnMapping: columnMapping,
          mappedText: mappedText,
        }),
      });

      const data = await response.json();

      if (response.ok && data.success) {
        showToast(`Mapped data saved successfully! ID: ${data.id}`, 'success');
        console.log('[SaveMappedData] Saved with ID:', data.id);
      } else {
        throw new Error(data.error || 'Failed to save mapped data');
      }
    } catch (error: any) {
      console.error('[SaveMappedData] Error:', error);
      showToast(error.message || 'Error saving mapped data', 'error');
    } finally {
      setIsSavingToDb(false);
    }
  };

  const handleNewUpload = () => {
    showConfirm(
      'Start New Upload',
      'Are you sure you want to start a new upload? Current session will remain saved.',
      () => {
        router.push('/');
      }
    );
  };

  const handleDeleteSession = () => {
    showConfirm(
      'Delete Session',
      'Are you sure you want to delete this session? This action cannot be undone.',
      () => {
        deleteSession(sessionId);
        showToast('Session deleted', 'success');
        setTimeout(() => router.push('/'), 1000);
      }
    );
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-indigo-50 via-white to-purple-50 flex items-center justify-center">
        <div className="text-center">
          <div className="w-16 h-16 bg-gradient-to-r from-indigo-600 to-purple-600 rounded-full flex items-center justify-center mx-auto mb-4 animate-pulse">
            <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          </div>
          <p className="text-gray-600">Loading session...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-indigo-50 via-white to-purple-50 flex items-center justify-center">
        <div className="text-center max-w-md">
          <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <h2 className="text-xl font-semibold text-gray-900 mb-2">Session Not Found</h2>
          <p className="text-gray-600 mb-6">{error}</p>
          <Link
            href="/"
            className="inline-flex items-center gap-2 px-6 py-3 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
            Back to Upload
          </Link>
        </div>
      </div>
    );
  }

