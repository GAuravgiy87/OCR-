'use client';

import { useState, useEffect, Suspense } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import Toast, { ToastType } from '../../../components/Toast';
import ConfirmModal from '../../../components/ConfirmModal';

interface TableData {
  isTable: boolean;
  rows?: string[][];
  text?: string;
  pageNumber?: number;
}

interface PageResult {
  pageNumber: number;
  originalImage: string;
  processedImage: string;
  tableData: TableData;
  rotationApplied?: number;
}

function DocumentViewContent() {
  const params = useParams();
  const router = useRouter();
  const documentId = params.id as string;

  // Document state
  const [pageResults, setPageResults] = useState<PageResult[]>([]);
  const [allPages, setAllPages] = useState<PageResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>('');
  const [currentFileName, setCurrentFileName] = useState<string>('');
  
  // UI state
  const [showMapping, setShowMapping] = useState(false);
  const [columnMapping, setColumnMapping] = useState<{ [key: string]: string }>({});
  const [mappedData, setMappedData] = useState<string[][] | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [editedData, setEditedData] = useState<{ [pageIndex: number]: string[][] }>({});
  const [isSavingToDb, setIsSavingToDb] = useState(false);

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
   * Load document data from database by ID
   */
  const loadDocumentById = async (docId: string) => {
    setLoading(true);
    setError('');

    try {
      console.log(`[LoadDocument] Fetching document ID: ${docId}`);

      // Fetch document metadata
      const docResponse = await fetch(`/api/documents?id=${docId}`);
      if (!docResponse.ok) {
        if (docResponse.status === 404) {
          throw new Error('Document not found. It may have been deleted.');
        }
        throw new Error('Failed to fetch document');
      }
      const document = await docResponse.json();
      setCurrentFileName(document.filename);

      // Fetch pages for this document
      const pagesResponse = await fetch(`/api/pages?documentId=${docId}`);
      if (!pagesResponse.ok) {
        throw new Error('Failed to fetch pages');
      }
      const pages = await pagesResponse.json();

      if (pages.length === 0) {
        throw new Error('No pages found for this document');
      }

      // Fetch all tables
      const tablesResponse = await fetch('/api/tables');
      if (!tablesResponse.ok) {
        throw new Error('Failed to fetch tables');
      }
      const allTables = await tablesResponse.json();

      // Reconstruct PageResult array from database data
      const reconstructedResults: PageResult[] = pages.map((page: any) => {
        const table = allTables.find((t: any) => t.pageId === page.id);

        let tableData: TableData;
        if (table) {
          tableData = {
            isTable: true,
            rows: table.tableData,
            pageNumber: page.pageNumber,
          };
        } else if (page.extractedText) {
          tableData = {
            isTable: false,
            text: page.extractedText,
            pageNumber: page.pageNumber,
          };
        } else {
          tableData = {
            isTable: false,
            text: '',
            pageNumber: page.pageNumber,
          };
        }

        return {
          pageNumber: page.pageNumber,
          originalImage: page.originalImage,
          processedImage: page.processedImage,
          tableData,
          rotationApplied: page.rotationApplied || 0,
        };
      });

      reconstructedResults.sort((a, b) => a.pageNumber - b.pageNumber);

      setPageResults(reconstructedResults);
      setAllPages(reconstructedResults);

      console.log(`[LoadDocument] Successfully loaded ${reconstructedResults.length} pages`);
    } catch (error: any) {
      console.error('[LoadDocument] Error:', error);
      setError(error.message || 'Failed to load document');
      showToast(error.message || 'Failed to load document', 'error');
      
      if (error.message?.includes('not found')) {
        setTimeout(() => router.push('/'), 2000);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (documentId) {
      loadDocumentById(documentId);
    }
  }, [documentId]);

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
    a.download = `${currentFileName}_tables.csv`;
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
    a.download = `${currentFileName}_mapped.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const saveMappedDataToDatabase = async () => {
    if (!mappedData || mappedData.length === 0) {
      showToast('No mapped data to save', 'warning');
      return;
    }

    setIsSavingToDb(true);

    try {
      const response = await fetch('/api/mapped-data', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          documentId: parseInt(documentId),
          mappedData: mappedData,
          columnMapping: columnMapping,
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

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-indigo-50 via-white to-purple-50 flex items-center justify-center">
        <div className="text-center">
          <div className="w-16 h-16 bg-gradient-to-r from-indigo-600 to-purple-600 rounded-full flex items-center justify-center mx-auto mb-4 animate-pulse">
            <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          </div>
          <p className="text-gray-600">Loading document...</p>
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
          <h2 className="text-xl font-semibold text-gray-900 mb-2">Error Loading Document</h2>
          <p className="text-gray-600 mb-6">{error}</p>
          <Link
            href="/"
            className="inline-flex items-center gap-2 px-6 py-3 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
            Back to Home
          </Link>
        </div>
      </div>
    );
  }

  return (
    <>
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 md:px-8 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Link
                href="/"
                className="p-2 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors"
                title="Back to home"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                </svg>
              </Link>
              <div className="w-10 h-10 bg-blue-600 rounded-lg flex items-center justify-center">
                <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
              </div>
              <div>
                <h1 className="text-xl font-semibold text-gray-900">{currentFileName}</h1>
                <p className="text-xs text-gray-500">Document ID: {documentId}</p>
              </div>
            </div>
            
            <div className="flex items-center gap-4">
              {pageResults.length > 0 && (
                <div className="flex items-center gap-2 px-3 py-1.5 bg-green-50 border border-green-200 rounded-md">
                  <svg className="w-4 h-4 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <span className="text-sm font-medium text-green-700">{pageResults.length} page{pageResults.length > 1 ? 's' : ''}</span>
                </div>
              )}
              
              <Link
                href={`/database?docId=${documentId}`}
                className="px-4 py-2 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors flex items-center gap-2"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 7v10c0 2.21 1.79 4 4 4h8c0 2.21 1.79 4 4 4h8c0-2.21-1.79-4-4-4H8c-2.21 0-4-1.79-4-4V7" />
                </svg>
                Database
              </Link>
              
              <Link
                href={`/chat?docId=${documentId}`}
                className="px-4 py-2 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors flex items-center gap-2"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
                </svg>
                AI Chat
              </Link>
            </div>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 md:px-8 py-6">
        {/* Action Bar */}
        {pageResults.length > 0 && (
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 mb-6">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-2">
                <svg className="w-5 h-5 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span className="text-sm font-medium text-gray-700">
                  Document loaded successfully
                </span>
              </div>
              <div className="flex flex-wrap gap-2">
                {pageResults.some(r => r.tableData.isTable) && (
                  <>
                    <button
                      onClick={() => setShowMapping(!showMapping)}
                      className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 transition-colors"
                    >
                      {showMapping ? 'Hide Mapping' : 'Map Columns'}
                    </button>
                    <button
                      onClick={exportAllToCSV}
                      className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 transition-colors"
                    >
                      Export CSV
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Column Mapping Section */}
        {showMapping && pageResults.length > 0 && pageResults.some(r => r.tableData.isTable && r.tableData.rows) && (
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 mb-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Column Mapping</h3>
            
            <div className="mb-6 bg-gray-50 rounded-lg p-4 border border-gray-200">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {predefinedColumns.map((predefinedCol) => {
                  const firstTable = pageResults.find(r => r.tableData.isTable && r.tableData.rows);
                  if (!firstTable) return null;
                  const pageIndex = pageResults.indexOf(firstTable);
                  const tableRows = editedData[pageIndex] || firstTable.tableData.rows;
                  const extractedHeaders = tableRows?.[0] || [];
                  return (
                    <div key={predefinedCol} className="flex flex-col gap-2">
                      <label className="text-xs font-medium text-gray-700 uppercase">
                        {predefinedCol}
                      </label>
                      <select
                        value={columnMapping[predefinedCol] || ''}
                        onChange={(e) => handleColumnMapping(predefinedCol, e.target.value)}
                        className="px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm text-gray-900 bg-white"
                      >
                        <option value="">-- Select Column --</option>
                        {extractedHeaders.map((col, idx) => (
                          <option key={idx} value={col}>
                            {col || `Column ${idx + 1}`}
                          </option>
                        ))}
                      </select>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="flex flex-wrap gap-3">
              {mappedData && (
                <>
                  <button
                    onClick={saveMappedDataToDatabase}
                    disabled={isSavingToDb}
                    className={`px-4 py-2 text-sm font-medium text-white rounded-md transition-colors ${
                      isSavingToDb 
                        ? 'bg-gray-400 cursor-not-allowed' 
                        : 'bg-blue-600 hover:bg-blue-700'
                    }`}
                  >
                    {isSavingToDb ? 'Saving...' : 'Save to Database'}
                  </button>
                  <button
                    onClick={exportMappedData}
                    className="px-4 py-2 text-sm font-medium text-white bg-green-600 rounded-md hover:bg-green-700 transition-colors"
                  >
                    Download Mapped Data
                  </button>
                </>
              )}
            </div>

            {mappedData && (
              <div className="mt-6 bg-gray-50 rounded-lg p-4 border border-gray-200">
                <div className="flex items-center justify-between mb-3">
                  <h4 className="text-sm font-semibold text-gray-900">
                    Mapped Data Preview
                  </h4>
                  <span className="text-xs text-gray-600">
                    {mappedData.length - 1} rows × {mappedData[0].length} columns
                  </span>
                </div>
                <div className="bg-white rounded-md border border-gray-200 overflow-auto max-h-96">
                  <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                      <tr>
                        {mappedData[0].map((header, idx) => (
                          <th
                            key={idx}
                            className="px-4 py-3 text-left text-xs font-medium text-gray-700 uppercase tracking-wider"
                          >
                            {header}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                      {mappedData.slice(1).map((row, rowIndex) => (
                        <tr key={rowIndex} className="hover:bg-gray-50">
                          {row.map((cell, cellIndex) => (
                            <td
                              key={cellIndex}
                              className="px-4 py-3 text-sm text-gray-900 whitespace-nowrap"
                            >
                              {cell || '-'}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Two column layout: Images on left, Table on right */}
        {pageResults.length > 0 && allPages.length > 0 && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            
            {/* LEFT SIDE: All page images stacked */}
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
              <div className="flex items-center justify-between mb-6 pb-4 border-b border-gray-200">
                <div>
                  <h2 className="text-lg font-semibold text-gray-900">
                    {allPages.length === 1 ? 'Document Image' : `All Pages (${allPages.length} pages)`}
                  </h2>
                </div>
              </div>

              <div className="space-y-6 max-h-[800px] overflow-y-auto">
                {allPages.map((result, idx) => (
                  <div key={idx} className="border-b border-gray-200 pb-6 last:border-b-0 last:pb-0">
                    <h3 className="text-sm font-medium text-gray-700 mb-3">
                      Page {result.pageNumber}
                      {result.rotationApplied !== undefined && result.rotationApplied !== 0 && (
                        <span className="ml-2 text-xs text-green-600">
                          (Rotated {result.rotationApplied}°)
                        </span>
                      )}
                    </h3>
                    <img
                      src={result.processedImage}
                      alt={`Page ${result.pageNumber} processed`}
                      className="w-full border border-gray-300 rounded"
                    />
                  </div>
                ))}
              </div>
            </div>

            {/* RIGHT SIDE: Merged table with all data */}
            {pageResults[0].tableData.isTable && pageResults[0].tableData.rows && (
              <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-semibold text-gray-900">
                    Extracted Table ({pageResults[0].tableData.rows.length - 1} rows)
                  </h3>
                  <button
                    onClick={() => setEditMode(!editMode)}
                    className="px-3 py-1.5 text-sm font-medium text-blue-600 hover:text-blue-700 border border-blue-600 rounded-md hover:bg-blue-50 transition-colors"
                  >
                    {editMode ? 'Done Editing' : 'Edit Table'}
                  </button>
                </div>
                
                <div className="overflow-auto max-h-[800px]">
                  <table className="min-w-full divide-y divide-gray-200 border border-gray-300">
                    <thead className="bg-gray-50 sticky top-0">
                      <tr>
                        {pageResults[0].tableData.rows[0].map((header, colIdx) => (
                          <th
                            key={colIdx}
                            className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider border-r border-gray-300 last:border-r-0"
                          >
                            {header}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                      {(editedData[0] || pageResults[0].tableData.rows).slice(1).map((row, rowIdx) => (
                        <tr key={rowIdx} className="hover:bg-gray-50">
                          {row.map((cell, colIdx) => (
                            <td
                              key={colIdx}
                              className="px-4 py-3 text-sm text-gray-900 border-r border-gray-300 last:border-r-0"
                            >
                              {editMode ? (
                                <input
                                  type="text"
                                  value={cell}
                                  onChange={(e) => handleCellEdit(0, rowIdx + 1, colIdx, e.target.value)}
                                  className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                                />
                              ) : (
                                cell
                              )}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}

      </div>
    </div>

    {/* Toast Notification */}
    {toast && (
      <Toast
        message={toast.message}
        type={toast.type}
        onClose={() => setToast(null)}
      />
    )}

    {/* Confirmation Modal */}
    <ConfirmModal
      isOpen={confirmModal.isOpen}
      title={confirmModal.title}
      message={confirmModal.message}
      onConfirm={() => {
        confirmModal.onConfirm();
        setConfirmModal({ ...confirmModal, isOpen: false });
      }}
      onCancel={() => setConfirmModal({ ...confirmModal, isOpen: false })}
      type="warning"
    />
    </>
  );
}

export default function DocumentViewPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-gradient-to-br from-indigo-50 via-white to-purple-50 flex items-center justify-center">
        <div className="text-center">
          <div className="w-16 h-16 bg-gradient-to-r from-indigo-600 to-purple-600 rounded-full flex items-center justify-center mx-auto mb-4 animate-pulse">
            <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </div>
          <p className="text-gray-600">Loading document...</p>
        </div>
      </div>
    }>
      <DocumentViewContent />
    </Suspense>
  );
}
