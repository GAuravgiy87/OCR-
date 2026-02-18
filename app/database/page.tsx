'use client';

import { useState, useEffect } from 'react';
import * as db from '../../lib/localStorageDB';

export default function DatabaseViewer() {
  const [documents, setDocuments] = useState<any[]>([]);
  const [tables, setTables] = useState<any[]>([]);
  const [stats, setStats] = useState<any>(null);
  const [selectedTable, setSelectedTable] = useState<any>(null);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = () => {
    setDocuments(db.getAllDocuments());
    setTables(db.getAllTables());
    setStats(db.getStatistics());
  };

  const handleDelete = (id: number) => {
    if (confirm('Are you sure you want to delete this document?')) {
      db.deleteDocument(id);
      loadData();
    }
  };

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
  };

  return (
    <div className="min-h-screen bg-slate-50 p-8">
      <div className="max-w-7xl mx-auto">
        <h1 className="text-3xl font-bold text-gray-900 mb-8">Database Viewer</h1>

        {/* Statistics */}
        {stats && (
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
            <div className="bg-white rounded-lg shadow p-6">
              <div className="text-sm text-gray-600">Total Documents</div>
              <div className="text-2xl font-bold text-blue-600">{stats.totalDocuments}</div>
            </div>
            <div className="bg-white rounded-lg shadow p-6">
              <div className="text-sm text-gray-600">Total Pages</div>
              <div className="text-2xl font-bold text-green-600">{stats.totalPages}</div>
            </div>
            <div className="bg-white rounded-lg shadow p-6">
              <div className="text-sm text-gray-600">Total Tables</div>
              <div className="text-2xl font-bold text-purple-600">{stats.totalTables}</div>
            </div>
            <div className="bg-white rounded-lg shadow p-6">
              <div className="text-sm text-gray-600">Total Size</div>
              <div className="text-2xl font-bold text-orange-600">{formatBytes(stats.totalSize)}</div>
            </div>
          </div>
        )}

        {/* Documents List */}
        <div className="bg-white rounded-lg shadow mb-8">
          <div className="px-6 py-4 border-b border-gray-200">
            <h2 className="text-xl font-semibold text-gray-900">Documents</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">ID</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Filename</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Type</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Pages</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Size</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Upload Date</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Actions</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {documents.map((doc) => (
                  <tr key={doc.id}>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{doc.id}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{doc.filename}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{doc.fileType}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{doc.totalPages}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{formatBytes(doc.fileSize)}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {new Date(doc.uploadDate).toLocaleString()}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm">
                      <button
                        onClick={() => handleDelete(doc.id)}
                        className="text-red-600 hover:text-red-900"
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {documents.length === 0 && (
              <div className="text-center py-8 text-gray-500">No documents found</div>
            )}
          </div>
        </div>

        {/* Tables List */}
        <div className="bg-white rounded-lg shadow">
          <div className="px-6 py-4 border-b border-gray-200">
            <h2 className="text-xl font-semibold text-gray-900">Extracted Tables</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Table ID</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Document</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Page</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Rows</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Columns</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Actions</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {tables.map((table) => {
                  // Find the page and document for this table
                  const pages = JSON.parse(localStorage.getItem('pages') || '[]');
                  const page = pages.find((p: any) => p.id === table.pageId);
                  const document = page ? documents.find(d => d.id === page.documentId) : null;
                  
                  return (
                    <tr key={table.id}>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{table.id}</td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {document ? (
                          <div>
                            <div className="font-medium">{document.filename}</div>
                            <div className="text-xs text-gray-500">Doc ID: {document.id}</div>
                          </div>
                        ) : (
                          <span className="text-gray-400">Unknown</span>
                        )}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {page ? `Page ${page.pageNumber}` : 'N/A'}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{table.rowCount}</td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{table.columnCount}</td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm">
                        <button
                          onClick={() => setSelectedTable(table)}
                          className="text-blue-600 hover:text-blue-900"
                        >
                          View Data
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {tables.length === 0 && (
              <div className="text-center py-8 text-gray-500">No tables found</div>
            )}
          </div>
        </div>

        {/* Table Data Modal */}
        {selectedTable && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
            <div className="bg-white rounded-lg shadow-xl max-w-6xl w-full max-h-[90vh] overflow-auto">
              <div className="px-6 py-4 border-b border-gray-200 flex justify-between items-center">
                <h3 className="text-lg font-semibold">Table Data (ID: {selectedTable.id})</h3>
                <button
                  onClick={() => setSelectedTable(null)}
                  className="text-gray-500 hover:text-gray-700"
                >
                  ✕
                </button>
              </div>
              <div className="p-6 overflow-auto">
                <table className="min-w-full divide-y divide-gray-200 border border-gray-300">
                  <tbody className="bg-white divide-y divide-gray-200">
                    {selectedTable.tableData.map((row: string[], rowIdx: number) => (
                      <tr key={rowIdx} className={rowIdx === 0 ? 'bg-blue-50 font-semibold' : ''}>
                        {row.map((cell: string, cellIdx: number) => (
                          <td
                            key={cellIdx}
                            className="px-4 py-2 text-sm text-gray-900 border-r border-gray-200"
                          >
                            {cell}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
