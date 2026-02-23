'use client';

import { useState, useRef, useEffect, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import * as db from '../../lib/localStorageDB';
import Toast, { ToastType } from '../../components/Toast';

interface Message {
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

interface ChatHistory {
  id: string;
  title: string;
  lastMessage: string;
  timestamp: Date;
  messages: Message[];
}

type LLMMode = 'local' | 'gemini';

function ChatPageContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const docId = searchParams.get('docId');

  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [llmMode, setLlmMode] = useState<LLMMode>('local');
  const [toast, setToast] = useState<{ message: string; type: ToastType } | null>(null);
  const [chatHistory, setChatHistory] = useState<ChatHistory[]>([]);
  const [currentChatId, setCurrentChatId] = useState<string>('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const showToast = (message: string, type: ToastType = 'info') => {
    setToast({ message, type });
  };

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = textareaRef.current.scrollHeight + 'px';
    }
  }, [input]);

  // Load chat history from localStorage
  useEffect(() => {
    const savedHistory = localStorage.getItem('chatHistory');
    if (savedHistory) {
      const parsed = JSON.parse(savedHistory);
      const history = parsed.map((h: any) => ({
        ...h,
        timestamp: new Date(h.timestamp),
        messages: h.messages.map((m: any) => ({
          ...m,
          timestamp: new Date(m.timestamp)
        }))
      }));
      setChatHistory(history);
      
      // Load the most recent chat
      if (history.length > 0 && !currentChatId) {
        setCurrentChatId(history[0].id);
        setMessages(history[0].messages);
      }
    }
  }, []);

  // Save chat history to localStorage
  const saveChatHistory = (history: ChatHistory[]) => {
    localStorage.setItem('chatHistory', JSON.stringify(history));
    setChatHistory(history);
  };

  const getContextFromDatabase = () => {
    const documents = db.getAllDocuments();
    const tables = db.getAllTables();
    const mappedExcels = db.getAllMappedExcels();
    const pages = JSON.parse(localStorage.getItem('pages') || '[]');
    
    let context = '=== DATABASE CONTENTS ===\n\n';
    
    if (docId) {
      const document = documents.find(d => d.id === parseInt(docId));
      if (document) {
        context += `Document: ${document.filename} (ID: ${docId})\n`;
        context += `Total Pages: ${document.totalPages}\n\n`;
        
        const docPages = pages.filter((p: any) => p.documentId === parseInt(docId));
        
        // Add extracted text
        const pagesWithText = docPages.filter((p: any) => p.extractedText && p.extractedText.trim());
        if (pagesWithText.length > 0) {
          context += '=== EXTRACTED TEXT ===\n';
          pagesWithText.forEach((page: any) => {
            context += `\nPage ${page.pageNumber}:\n${page.extractedText}\n`;
          });
        }
        
        // Add tables with ALL rows in markdown format
        const docTables = tables.filter((t: any) => {
          const page = pages.find((p: any) => p.id === t.pageId);
          return page && page.documentId === parseInt(docId);
        });
        
        if (docTables.length > 0) {
          context += '\n=== EXTRACTED TABLES (Complete Data) ===\n';
          docTables.forEach((table, idx) => {
            const page = pages.find((p: any) => p.id === table.pageId);
            context += `\nTable ${idx + 1} from Page ${page?.pageNumber || 'N/A'}:\n`;
            context += `Total Rows: ${table.tableData.length}\n`;
            context += `Total Columns: ${table.tableData[0]?.length || 0}\n\n`;
            
            // Format as markdown table
            if (table.tableData.length > 0) {
              // Header row
              context += '| ' + table.tableData[0].join(' | ') + ' |\n';
              // Separator
              context += '|' + table.tableData[0].map(() => '---').join('|') + '|\n';
              // Data rows (show ALL rows, not just 10)
              table.tableData.slice(1).forEach((row: string[]) => {
                context += '| ' + row.join(' | ') + ' |\n';
              });
            }
            context += '\n';
          });
        }
        
        // Add mapped/processed data
        const docMappedExcels = mappedExcels.filter((m: any) => m.documentId === parseInt(docId));
        if (docMappedExcels.length > 0) {
          context += '\n=== MAPPED/PROCESSED DATA ===\n';
          docMappedExcels.forEach((excel, idx) => {
            context += `\nMapped Data ${idx + 1}:\n`;
            context += `Rows: ${excel.rowCount}, Columns: ${excel.columnCount}\n\n`;
            
            // Format as markdown table
            if (excel.mappedData && excel.mappedData.length > 0) {
              // Header row
              context += '| ' + excel.mappedData[0].join(' | ') + ' |\n';
              // Separator
              context += '|' + excel.mappedData[0].map(() => '---').join('|') + '|\n';
              // Data rows
              excel.mappedData.slice(1).forEach((row: string[]) => {
                context += '| ' + row.join(' | ') + ' |\n';
              });
            }
            context += '\n';
          });
        }
      }
    } else {
      // Show all documents with their data
      context += `Total Documents: ${documents.length}\n`;
      context += `Total Tables: ${tables.length}\n`;
      context += `Total Mapped Excel Files: ${mappedExcels.length}\n\n`;
      
      context += '=== ALL DOCUMENTS ===\n';
      documents.forEach(doc => {
        context += `\n${doc.filename} (ID: ${doc.id})\n`;
        context += `- Pages: ${doc.totalPages}\n`;
        context += `- Uploaded: ${new Date(doc.uploadDate).toLocaleDateString()}\n`;
      });
      
      // Show all tables with data
      if (tables.length > 0) {
        context += '\n\n=== ALL TABLES ===\n';
        tables.forEach((table, idx) => {
          const page = pages.find((p: any) => p.id === table.pageId);
          const doc = documents.find((d: any) => d.id === page?.documentId);
          
          context += `\nTable ${idx + 1} from ${doc?.filename || 'Unknown'} (Page ${page?.pageNumber || 'N/A'}):\n`;
          context += `Rows: ${table.tableData.length}, Columns: ${table.tableData[0]?.length || 0}\n\n`;
          
          // Format as markdown table (limit to 20 rows for all documents view)
          if (table.tableData.length > 0) {
            context += '| ' + table.tableData[0].join(' | ') + ' |\n';
            context += '|' + table.tableData[0].map(() => '---').join('|') + '|\n';
            const rowsToShow = Math.min(20, table.tableData.length - 1);
            table.tableData.slice(1, rowsToShow + 1).forEach((row: string[]) => {
              context += '| ' + row.join(' | ') + ' |\n';
            });
            if (table.tableData.length > 21) {
              context += `\n... (${table.tableData.length - 21} more rows)\n`;
            }
          }
          context += '\n';
        });
      }
      
      // Show mapped data
      if (mappedExcels.length > 0) {
        context += '\n=== ALL MAPPED DATA ===\n';
        mappedExcels.forEach((excel, idx) => {
          const doc = documents.find(d => d.id === excel.documentId);
          context += `\nMapped Data ${idx + 1} from ${doc?.filename || 'Unknown'}:\n`;
          context += `Rows: ${excel.rowCount}, Columns: ${excel.columnCount}\n\n`;
          
          // Show first 15 rows
          if (excel.mappedData && excel.mappedData.length > 0) {
            context += '| ' + excel.mappedData[0].join(' | ') + ' |\n';
            context += '|' + excel.mappedData[0].map(() => '---').join('|') + '|\n';
            const rowsToShow = Math.min(15, excel.mappedData.length - 1);
            excel.mappedData.slice(1, rowsToShow + 1).forEach((row: string[]) => {
              context += '| ' + row.join(' | ') + ' |\n';
            });
            if (excel.mappedData.length > 16) {
              context += `\n... (${excel.mappedData.length - 16} more rows)\n`;
            }
          }
          context += '\n';
        });
      }
    }
    
    console.log('[Chat] Context size:', context.length, 'characters');
    return context;
  };

  const handleSend = async () => {
    if (!input.trim() || isLoading) return;

    const userMessage: Message = {
      role: 'user',
      content: input,
      timestamp: new Date(),
    };

    const newMessages = [...messages, userMessage];
    setMessages(newMessages);
    setInput('');
    setIsLoading(true);

    try {
      const context = getContextFromDatabase();
      
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: input,
          context: context,
          mode: llmMode,
        }),
      });

      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.details || data.error || 'Failed to get response');
      }
      
      // Get the answer from the response
      const answerContent = data.answer || 'No response received';
      
      const assistantMessage: Message = {
        role: 'assistant',
        content: answerContent,
        timestamp: new Date(),
      };

      const updatedMessages = [...newMessages, assistantMessage];
      setMessages(updatedMessages);

      // Update or create chat history
      const chatTitle = input.slice(0, 50) + (input.length > 50 ? '...' : '');
      const chatId = currentChatId || Date.now().toString();
      
      const updatedHistory = chatHistory.filter(h => h.id !== chatId);
      updatedHistory.unshift({
        id: chatId,
        title: chatTitle,
        lastMessage: answerContent.slice(0, 100),
        timestamp: new Date(),
        messages: updatedMessages
      });

      if (!currentChatId) {
        setCurrentChatId(chatId);
      }

      saveChatHistory(updatedHistory.slice(0, 20)); // Keep last 20 chats
    } catch (error: any) {
      console.error('Chat error:', error);
      showToast(`Error: ${error.message}`, 'error');
      
      const errorMessage: Message = {
        role: 'assistant',
        content: `Error: ${error.message}\n\nPlease check:\n1. ${llmMode === 'local' ? 'Ollama is running (http://localhost:11434)' : 'Gemini API key is configured'}\n2. Network connection is working\n3. Try a simpler question`,
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

  const copyTableToClipboard = async (content: string) => {
    const tableRegex = /\|(.+)\|/g;
    const tables = content.match(tableRegex);
    
    if (tables) {
      const tableText = tables.join('\n');
      try {
        await navigator.clipboard.writeText(tableText);
        showToast('Table copied to clipboard!', 'success');
      } catch (error) {
        showToast('Failed to copy table', 'error');
      }
    }
  };

  const hasTable = (content: string) => {
    return content.includes('|') && content.includes('---');
  };

  const startNewChat = () => {
    setMessages([]);
    setCurrentChatId('');
  };

  const loadChat = (chat: ChatHistory) => {
    setCurrentChatId(chat.id);
    setMessages(chat.messages);
  };

  const deleteChat = (chatId: string) => {
    const updatedHistory = chatHistory.filter(h => h.id !== chatId);
    saveChatHistory(updatedHistory);
    if (currentChatId === chatId) {
      startNewChat();
    }
  };

  return (
    <>
      <div className="h-screen flex flex-col bg-gray-50">
        {/* Fixed Top Navbar */}
        <header className="flex-none bg-white border-b border-gray-200 shadow-sm">
          <div className="h-16 px-4 flex items-center justify-between">
            {/* Left: Back + App Name */}
            <div className="flex items-center gap-3">
              <Link
                href={docId ? `/document/${docId}` : '/'}
                className="p-2 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors"
                title="Back"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                </svg>
              </Link>
              <div className="flex items-center gap-2">
                <div className="w-9 h-9 bg-blue-600 rounded-lg flex items-center justify-center">
                  <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
                  </svg>
                </div>
                <div>
                  <h1 className="text-base font-semibold text-gray-900">AI Chat</h1>
                  <p className="text-xs text-gray-500">
                    {docId ? `Document ${docId}` : 'All documents'}
                  </p>
                </div>
              </div>
            </div>

            {/* Center: Navigation Pills */}
            <div className="flex items-center gap-2 bg-gray-100 rounded-full p-1">
              <button
                onClick={() => router.push(docId ? `/database?docId=${docId}` : '/database')}
                className="px-4 py-1.5 text-sm font-medium text-gray-600 hover:text-gray-900 rounded-full transition-colors"
              >
                Database
              </button>
              <button
                className="px-4 py-1.5 text-sm font-medium bg-white text-blue-600 rounded-full shadow-sm"
              >
                AI Chat
              </button>
            </div>

            {/* Right: LLM Toggle + Clear */}
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2 bg-gray-100 rounded-lg p-1">
                <button
                  onClick={() => setLlmMode('local')}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                    llmMode === 'local'
                      ? 'bg-white text-blue-600 shadow-sm'
                      : 'text-gray-600 hover:text-gray-900'
                  }`}
                >
                  Local LLM
                </button>
                <button
                  onClick={() => setLlmMode('gemini')}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                    llmMode === 'gemini'
                      ? 'bg-white text-blue-600 shadow-sm'
                      : 'text-gray-600 hover:text-gray-900'
                  }`}
                >
                  Gemini
                </button>
              </div>
              
              <button
                onClick={startNewChat}
                className="px-3 py-1.5 text-sm font-medium text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors"
                title="New chat"
              >
                Clear
              </button>
            </div>
          </div>
        </header>

        {/* Main Content Area */}
        <div className="flex-1 flex overflow-hidden">
          {/* Left Sidebar: Chat History */}
          <aside className="w-80 bg-white border-r border-gray-200 flex flex-col">
            <div className="flex-none p-4 border-b border-gray-200">
              <button
                onClick={startNewChat}
                className="w-full px-4 py-2.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors flex items-center justify-center gap-2"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                New Chat
              </button>
            </div>
            
            <div className="flex-1 overflow-y-auto">
              {chatHistory.length === 0 ? (
                <div className="p-4 text-center text-sm text-gray-500">
                  No chat history yet
                </div>
              ) : (
                <div className="divide-y divide-gray-100">
                  {chatHistory.map((chat) => (
                    <div
                      key={chat.id}
                      className={`p-4 cursor-pointer hover:bg-gray-50 transition-colors ${
                        currentChatId === chat.id ? 'bg-blue-50 border-l-4 border-blue-600' : ''
                      }`}
                      onClick={() => loadChat(chat)}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <h3 className="text-sm font-medium text-gray-900 truncate">
                            {chat.title}
                          </h3>
                          <p className="text-xs text-gray-500 truncate mt-1">
                            {chat.lastMessage}
                          </p>
                          <p className="text-xs text-gray-400 mt-1">
                            {chat.timestamp.toLocaleDateString()}
                          </p>
                        </div>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            deleteChat(chat.id);
                          }}
                          className="flex-none p-1 text-gray-400 hover:text-red-600 rounded"
                          title="Delete chat"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </aside>

          {/* Right: Chat Area */}
          <main className="flex-1 flex flex-col bg-gray-50">
            {/* Messages Container - Scrollable */}
            <div className="flex-1 overflow-y-auto">
              <div className="max-w-4xl mx-auto px-4 py-6">
                {messages.length === 0 && (
                  <div className="text-center mt-20">
                    <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-4">
                      <svg className="w-8 h-8 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
                      </svg>
                    </div>
                    <h2 className="text-xl font-semibold text-gray-900 mb-2">Start a conversation</h2>
                    <p className="text-gray-600 mb-6">
                      Ask me anything about your {docId ? 'document' : 'documents'}!
                    </p>
                    <div className="flex flex-wrap gap-2 justify-center">
                      <button
                        onClick={() => setInput('What documents do I have?')}
                        className="px-4 py-2 text-sm bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
                      >
                        What documents do I have?
                      </button>
                      <button
                        onClick={() => setInput('Show me the data in table format')}
                        className="px-4 py-2 text-sm bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
                      >
                        Show me the data in table format
                      </button>
                      <button
                        onClick={() => setInput('Summarize the key information')}
                        className="px-4 py-2 text-sm bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
                      >
                        Summarize the key information
                      </button>
                    </div>
                  </div>
                )}

                <div className="space-y-4">
                  {messages.map((message, idx) => (
                    <div
                      key={idx}
                      className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
                    >
                      <div
                        className={`max-w-[75%] rounded-lg px-4 py-3 ${
                          message.role === 'user'
                            ? 'bg-blue-600 text-white'
                            : 'bg-white border border-gray-200 shadow-sm'
                        }`}
                      >
                        {message.role === 'assistant' ? (
                          <div className="prose prose-sm max-w-none">
                            <ReactMarkdown
                              remarkPlugins={[remarkGfm]}
                              components={{
                                table: ({ node, ...props }) => (
                                  <div className="my-4 overflow-x-auto">
                                    <table className="min-w-full divide-y divide-gray-300 border border-gray-300" {...props} />
                                  </div>
                                ),
                                thead: ({ node, ...props }) => (
                                  <thead className="bg-gray-50" {...props} />
                                ),
                                th: ({ node, ...props }) => (
                                  <th className="px-3 py-2 text-left text-xs font-semibold text-gray-900 border-r border-gray-300 last:border-r-0" {...props} />
                                ),
                                tbody: ({ node, ...props }) => (
                                  <tbody className="divide-y divide-gray-200 bg-white" {...props} />
                                ),
                                tr: ({ node, ...props }) => (
                                  <tr className="hover:bg-gray-50" {...props} />
                                ),
                                td: ({ node, ...props }) => (
                                  <td className="px-3 py-2 text-sm text-gray-700 border-r border-gray-300 last:border-r-0" {...props} />
                                ),
                              }}
                            >
                              {message.content}
                            </ReactMarkdown>
                            
                            {hasTable(message.content) && (
                              <button
                                onClick={() => copyTableToClipboard(message.content)}
                                className="mt-2 px-3 py-1.5 text-xs font-medium text-blue-600 hover:text-blue-700 border border-blue-600 rounded-md hover:bg-blue-50 transition-colors flex items-center gap-1"
                              >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                                </svg>
                                Copy Table
                              </button>
                            )}
                          </div>
                        ) : (
                          <p className="text-sm whitespace-pre-wrap">{message.content}</p>
                        )}
                        <p className={`text-xs mt-2 ${
                          message.role === 'user' ? 'text-blue-100' : 'text-gray-500'
                        }`}>
                          {message.timestamp.toLocaleTimeString()}
                        </p>
                      </div>
                    </div>
                  ))}

                  {isLoading && (
                    <div className="flex justify-start">
                      <div className="bg-white border border-gray-200 rounded-lg px-4 py-3 shadow-sm">
                        <div className="flex items-center gap-2">
                          <div className="flex gap-1">
                            <div className="w-2 h-2 bg-blue-500 rounded-full animate-bounce"></div>
                            <div className="w-2 h-2 bg-blue-500 rounded-full animate-bounce" style={{ animationDelay: '0.1s' }}></div>
                            <div className="w-2 h-2 bg-blue-500 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></div>
                          </div>
                          <span className="text-sm text-gray-600">
                            {llmMode === 'local' ? 'Processing with Ollama...' : 'Processing with Gemini...'}
                          </span>
                        </div>
                      </div>
                    </div>
                  )}

                  <div ref={messagesEndRef} />
                </div>
              </div>
            </div>

            {/* Fixed Bottom Input Bar */}
            <div className="flex-none border-t border-gray-200 bg-white">
              <div className="max-w-4xl mx-auto px-4 py-4">
                <div className="flex gap-3 items-end">
                  <button
                    className="flex-none p-3 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
                    title="Upload document"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                    </svg>
                  </button>
                  
                  <textarea
                    ref={textareaRef}
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder="Type a message..."
                    className="flex-1 px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm resize-none max-h-32 overflow-y-auto"
                    disabled={isLoading}
                    rows={1}
                  />
                  
                  <button
                    onClick={handleSend}
                    disabled={isLoading || !input.trim()}
                    className={`flex-none p-3 rounded-lg transition-colors ${
                      isLoading || !input.trim()
                        ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                        : 'bg-blue-600 text-white hover:bg-blue-700'
                    }`}
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                    </svg>
                  </button>
                </div>
              </div>
            </div>
          </main>
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
    </>
  );
}

export default function ChatPage() {
  return (
    <Suspense fallback={
      <div className="h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="w-16 h-16 bg-blue-600 rounded-full flex items-center justify-center mx-auto mb-4 animate-pulse">
            <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
            </svg>
          </div>
          <p className="text-gray-600">Loading chat...</p>
        </div>
      </div>
    }>
      <ChatPageContent />
    </Suspense>
  );
}
