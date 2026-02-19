'use client';

import { useState } from 'react';
import * as db from '../../lib/localStorageDB';

export default function DebugPage() {
  const [output, setOutput] = useState('');

  const checkDatabase = () => {
    const documents = db.getAllDocuments();
    const tables = db.getAllTables();
    const mappedExcels = db.getAllMappedExcels();
    const stats = db.getStatistics();

    let result = '='.repeat(60) + '\n';
    result += 'DATABASE DEBUG INFO\n';
    result += '='.repeat(60) + '\n\n';

    result += `Statistics:\n`;
    result += `- Total Documents: ${stats.totalDocuments}\n`;
    result += `- Total Pages: ${stats.totalPages}\n`;
    result += `- Total Tables: ${stats.totalTables}\n`;
    result += `- Total Mapped Excels: ${stats.totalMappedExcels}\n\n`;

    result += '='.repeat(60) + '\n';
    result += 'DOCUMENTS:\n';
    result += '='.repeat(60) + '\n';
    documents.forEach(doc => {
      result += `\nDocument ID: ${doc.id}\n`;
      result += `  Filename: ${doc.filename}\n`;
      result += `  Type: ${doc.fileType}\n`;
      result += `  Pages: ${doc.totalPages}\n`;
      result += `  Upload Date: ${new Date(doc.uploadDate).toLocaleString()}\n`;
    });

    result += '\n' + '='.repeat(60) + '\n';
    result += 'TABLES:\n';
    result += '='.repeat(60) + '\n';
    tables.forEach(table => {
      result += `\nTable ID: ${table.id}\n`;
      result += `  Page ID: ${table.pageId}\n`;
      result += `  Size: ${table.rowCount} rows x ${table.columnCount} columns\n`;
      result += `  Data preview (first 3 rows):\n`;
      table.tableData.slice(0, 3).forEach((row: string[], idx: number) => {
        result += `    Row ${idx}: ${row.join(' | ')}\n`;
      });
    });

    result += '\n' + '='.repeat(60) + '\n';
    result += 'MAPPED EXCELS:\n';
    result += '='.repeat(60) + '\n';
    mappedExcels.forEach(excel => {
      result += `\nMapped Excel ID: ${excel.id}\n`;
      result += `  Document ID: ${excel.documentId}\n`;
      result += `  Size: ${excel.rowCount} rows x ${excel.columnCount} columns\n`;
      result += `  Created: ${new Date(excel.createdDate).toLocaleString()}\n`;
      result += `  Column Mapping:\n`;
      Object.entries(excel.columnMapping).forEach(([target, source]) => {
        result += `    ${target} -> ${source}\n`;
      });
      result += `  Mapped Text Length: ${excel.mappedText?.length || 0} characters\n`;
      result += `  Mapped Text Preview:\n`;
      const preview = excel.mappedText?.substring(0, 500) || 'No text';
      result += `    ${preview}...\n`;
    });

    result += '\n' + '='.repeat(60) + '\n';
    result += 'CONTEXT FOR OLLAMA:\n';
    result += '='.repeat(60) + '\n';
    
    // Simulate what would be sent to Ollama
    const pages = JSON.parse(localStorage.getItem('pages') || '[]');
    let context = `Total Documents: ${documents.length}\n`;
    context += `Total Tables: ${tables.length}\n`;
    context += `Total Mapped Excel Files: ${mappedExcels.length}\n\n`;
    
    if (mappedExcels.length > 0) {
      context += 'Mapped Excel Files:\n';
      mappedExcels.forEach((excel, idx) => {
        const document = documents.find(d => d.id === excel.documentId);
        context += `\nMapped Excel ${idx + 1}:\n`;
        context += `- Excel ID: ${excel.id}\n`;
        context += `- From Document: ${document?.filename || 'Unknown'}\n`;
        context += `- Mapped Data:\n${excel.mappedText}\n`;
      });
    }
    
    result += `Context Length: ${context.length} characters\n\n`;
    result += context;

    setOutput(result);
    console.log(result);
  };

  const testSimplePrompt = async () => {
    setOutput('Testing simple prompt...\n');
    
    try {
      const response = await fetch('/api/llm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          prompt: 'Say hello in one word.' 
        }),
      });

      const data = await response.json();
      setOutput(prev => prev + '\nResponse:\n' + JSON.stringify(data, null, 2));
    } catch (error: any) {
      setOutput(prev => prev + '\nError:\n' + error.message);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 p-8">
      <div className="max-w-7xl mx-auto">
        <h1 className="text-3xl font-bold text-gray-900 mb-8">Debug Page</h1>

        <div className="bg-white rounded-lg shadow p-6 mb-6">
          <div className="flex gap-4">
            <button
              onClick={checkDatabase}
              className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
            >
              Check Database
            </button>
            <button
              onClick={testSimplePrompt}
              className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700"
            >
              Test Simple Prompt
            </button>
            <button
              onClick={() => setOutput('')}
              className="px-4 py-2 bg-gray-600 text-white rounded-md hover:bg-gray-700"
            >
              Clear
            </button>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-xl font-semibold mb-4">Output:</h2>
          <pre className="bg-gray-50 p-4 rounded-md overflow-auto max-h-[600px] text-xs font-mono whitespace-pre-wrap">
            {output || 'Click a button to see output...'}
          </pre>
        </div>
      </div>
    </div>
  );
}
