'use client';

import { useState, useRef, useEffect } from 'react';
import * as db from '../lib/localStorageDB';

interface Message {
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

export default function ChatSidebar() {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const getContextFromDatabase = () => {
    const documents = db.getAllDocuments();
    const tables = db.getAllTables();
    const mappedExcels = db.getAllMappedExcels();
    const pages = JSON.parse(localStorage.getItem('pages') || '[]');
    
    let context = '=== DATABASE CONTENTS ===\n\n';
    context += `Total Documents: ${documents.length}\n`;
    context += `Total Tables: ${tables.length}\n`;
    context += `Total Mapped Excel Files: ${mappedExcels.length}\n\n`;
    
    // Add all documents info
    context += '=== DOCUMENTS ===\n';
    documents.forEach(doc => {
      context += `Document ID ${doc.id}: ${doc.filename} (${doc.totalPages} pages, uploaded ${new Date(doc.uploadDate).toLocaleDateString()})\n`;
    });
    context += '\n';
    
    // Add all page text content
    context += '=== EXTRACTED TEXT FROM PAGES ===\n';
    pages.forEach((page: any) => {
      if (page.extractedText && page.extractedText.trim()) {
        const document = documents.find(d => d.id === page.documentId);
        context += `\nFrom Document: ${document?.filename || 'Unknown'} (Page ${page.pageNumber}):\n`;
        context += page.extractedText + '\n';
      }
    });
    context += '\n';
    
    // Add table data (limit to first 3 tables, first 5 rows each)
    const maxTables = 3;
    const tablesToShow = tables.slice(0, maxTables);
    
    if (tablesToShow.length > 0) {
      context += '=== EXTRACTED TABLES ===\n';
      tablesToShow.forEach((table, idx) => {
        const page = pages.find((p: any) => p.id === table.pageId);
        const document = page ? documents.find(d => d.id === page.documentId) : null;
        
        context += `\nTable ${idx + 1} from ${document?.filename || 'Unknown'} (Page ${page?.pageNumber || 'N/A'}):\n`;
        
        const rowLimit = 5;
        table.tableData.slice(0, rowLimit).forEach((row: string[], rowIdx: number) => {
          context += `${row.join(' | ')}\n`;
        });
        if (table.tableData.length > rowLimit) {
          context += `... (${table.tableData.length - rowLimit} more rows)\n`;
        }
      });
      
      if (tables.length > maxTables) {
        context += `\n(${tables.length - maxTables} more tables not shown)\n`;
      }
      context += '\n';
    }
    
    // Add ALL mapped Excel data (this is the cleaned/processed data)
    if (mappedExcels.length > 0) {
      context += '=== MAPPED/PROCESSED DATA (MOST IMPORTANT) ===\n';
      context += 'This is the cleaned and organized data from the documents:\n\n';
      
      mappedExcels.forEach((excel, idx) => {
        const document = documents.find(d => d.id === excel.documentId);
        
        context += `Mapped Data ${idx + 1} from ${document?.filename || 'Unknown'}:\n`;
        
        // Include full mapped text (limited to 3000 chars per file)
        const textLimit = 3000;
        const limitedText = excel.mappedText.length > textLimit 
          ? excel.mappedText.substring(0, textLimit) + '\n... (truncated)'
          : excel.mappedText;
        context += limitedText + '\n\n';
      });
    }
    
    console.log('[Chat] Context size:', context.length, 'characters');
    
    // If context is too large, prioritize mapped Excel data
    const maxContextSize = 5000;
    if (context.length > maxContextSize) {
      console.warn('[Chat] Context too large, prioritizing mapped data...');
      
      // Rebuild with only mapped Excel data
      context = '=== DATABASE CONTENTS ===\n\n';
      context += '=== MAPPED/PROCESSED DATA ===\n';
      context += 'This is the cleaned and organized data from the documents:\n\n';
      
      mappedExcels.forEach((excel, idx) => {
        const document = documents.find(d => d.id === excel.documentId);
        context += `Data from ${document?.filename || 'Unknown'}:\n`;
        const textLimit = 2000;
        const limitedText = excel.mappedText.length > textLimit 
          ? excel.mappedText.substring(0, textLimit) + '\n... (truncated)'
          : excel.mappedText;
        context += limitedText + '\n\n';
      });
    }
    
    return context;
  };

  const handleSend = async () => {
    if (!input.trim() || isLoading) return;

    const userMessage: Message = {
      role: 'user',
      content: input,
      timestamp: new Date(),
    };

    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);

    try {
      const context = getContextFromDatabase();
      
      // Log what we're sending
      console.log('='.repeat(60));
      console.log('[Chat] Sending to API');
      console.log('='.repeat(60));
      console.log('[Chat] Question:', input);
      console.log('[Chat] Context length:', context.length, 'characters');
      console.log('[Chat] Context preview:', context.substring(0, 500) + '...');
      console.log('='.repeat(60));
      
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: input,
          context: context,
        }),
      });

      const data = await response.json();
      
      console.log('[Chat] Response status:', response.status);
      console.log('[Chat] Response data:', data);
      
      if (!response.ok) {
        throw new Error(data.details || data.error || 'Failed to get response');
      }
      
      const assistantMessage: Message = {
        role: 'assistant',
        content: data.answer,
        timestamp: new Date(),
      };

      setMessages(prev => [...prev, assistantMessage]);
    } catch (error: any) {
      console.error('Chat error:', error);
      const errorMessage: Message = {
        role: 'assistant',
        content: `Error: ${error.message}\n\nPlease check:\n1. VM Flask API is running at http://10.7.32.74:5000\n2. Ollama is running inside VM\n3. Network connection is working\n4. LLM might need more time (try a simpler question)`,
        timestamp: new Date(),
      };
      setMessages(prev => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <>
      {/* Chat Toggle Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="fixed bottom-6 right-6 w-14 h-14 bg-blue-600 hover:bg-blue-700 text-white rounded-full shadow-lg flex items-center justify-center z-50 transition-transform hover:scale-110"
        title="Ask AI about your data"
      >
        {isOpen ? (
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        ) : (
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
          </svg>
        )}
      </button>

      {/* Chat Sidebar */}
      {isOpen && (
        <div className="fixed bottom-24 right-6 w-96 h-[600px] bg-white rounded-lg shadow-2xl flex flex-col z-50 border border-gray-200">
          {/* Header */}
          <div className="px-4 py-3 bg-blue-600 text-white rounded-t-lg flex items-center justify-between">
            <div className="flex items-center gap-2">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
              </svg>
              <h3 className="font-semibold">Ask AI</h3>
            </div>
            <button
              onClick={() => setMessages([])}
              className="text-white hover:text-gray-200 text-sm"
              title="Clear chat"
            >
              Clear
            </button>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4 scroll-smooth">
            {messages.length === 0 && (
              <div className="text-center text-gray-500 mt-8">
                <svg className="w-12 h-12 mx-auto mb-3 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
                </svg>
                <p className="text-sm">Ask me anything about your extracted data!</p>
                <p className="text-xs mt-2 text-gray-400">Try: "What documents do I have?" or "Show me the data from table 1"</p>
              </div>
            )}
            
            {messages.map((message, idx) => (
              <div
                key={idx}
                className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-[80%] rounded-lg px-4 py-2 ${
                    message.role === 'user'
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-100 text-gray-900'
                  }`}
                >
                  <p className="text-sm whitespace-pre-wrap">{message.content}</p>
                  <p className={`text-xs mt-1 ${
                    message.role === 'user' ? 'text-blue-100' : 'text-gray-500'
                  }`}>
                    {message.timestamp.toLocaleTimeString()}
                  </p>
                </div>
              </div>
            ))}
            
            {isLoading && (
              <div className="flex justify-start">
                <div className="bg-gray-100 rounded-lg px-4 py-3 max-w-[80%]">
                  <div className="flex items-center gap-2 mb-2">
                    <div className="flex gap-1">
                      <div className="w-2 h-2 bg-blue-500 rounded-full animate-bounce"></div>
                      <div className="w-2 h-2 bg-blue-500 rounded-full animate-bounce" style={{ animationDelay: '0.1s' }}></div>
                      <div className="w-2 h-2 bg-blue-500 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></div>
                    </div>
                    <span className="text-sm text-gray-600">Processing with Llama2...</span>
                  </div>
                  <p className="text-xs text-gray-500">This may take 2-10 minutes depending on the question complexity and data size</p>
                </div>
              </div>
            )}
            
            <div ref={messagesEndRef} />
          </div>

          {/* Input */}
          <div className="p-4 border-t border-gray-200">
            <div className="flex gap-2">
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Ask a question..."
                className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                disabled={isLoading}
              />
              <button
                onClick={handleSend}
                disabled={isLoading || !input.trim()}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
