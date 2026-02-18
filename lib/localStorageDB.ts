// Simple localStorage-based database for browser
// This works immediately without any installation
// Note: Images are NOT stored to avoid quota issues

export interface Document {
  id: number;
  filename: string;
  fileType: string;
  fileSize: number;
  totalPages: number;
  uploadDate: string;
}

export interface Page {
  id: number;
  documentId: number;
  pageNumber: number;
  // Images removed to save space
  rotationApplied: number;
  isTable: boolean;
  extractedText?: string;
}

export interface ExtractedTable {
  id: number;
  pageId: number;
  tableData: string[][];
  rowCount: number;
  columnCount: number;
}

// Helper to get next ID
const getNextId = (key: string): number => {
  try {
    const items = JSON.parse(localStorage.getItem(key) || '[]');
    return items.length > 0 ? Math.max(...items.map((item: any) => item.id)) + 1 : 1;
  } catch (error) {
    console.error('Error getting next ID:', error);
    return 1;
  }
};

// Document operations
export const saveDocument = (
  filename: string,
  fileType: string,
  fileSize: number,
  totalPages: number
): number => {
  try {
    const documents = JSON.parse(localStorage.getItem('documents') || '[]');
    const id = getNextId('documents');
    
    const newDoc: Document = {
      id,
      filename,
      fileType,
      fileSize,
      totalPages,
      uploadDate: new Date().toISOString(),
    };
    
    documents.push(newDoc);
    localStorage.setItem('documents', JSON.stringify(documents));
    return id;
  } catch (error) {
    console.error('Error saving document:', error);
    throw error;
  }
};

export const getAllDocuments = (): Document[] => {
  try {
    return JSON.parse(localStorage.getItem('documents') || '[]');
  } catch (error) {
    console.error('Error getting documents:', error);
    return [];
  }
};

export const getDocument = (id: number): Document | null => {
  const documents = getAllDocuments();
  return documents.find(doc => doc.id === id) || null;
};

export const deleteDocument = (id: number): void => {
  try {
    const documents = getAllDocuments();
    const filtered = documents.filter(doc => doc.id !== id);
    localStorage.setItem('documents', JSON.stringify(filtered));
    
    // Also delete related pages and tables
    const pages = getPagesByDocument(id);
    pages.forEach(page => {
      deletePage(page.id);
    });
  } catch (error) {
    console.error('Error deleting document:', error);
  }
};

// Page operations (without images to save space)
export const savePage = (
  documentId: number,
  pageNumber: number,
  originalImage: string, // Not stored
  processedImage: string, // Not stored
  rotationApplied: number,
  isTable: boolean,
  extractedText?: string
): number => {
  try {
    const pages = JSON.parse(localStorage.getItem('pages') || '[]');
    const id = getNextId('pages');
    
    const newPage: Page = {
      id,
      documentId,
      pageNumber,
      rotationApplied,
      isTable,
      extractedText,
    };
    
    pages.push(newPage);
    localStorage.setItem('pages', JSON.stringify(pages));
    return id;
  } catch (error) {
    console.error('Error saving page:', error);
    throw error;
  }
};

export const getPagesByDocument = (documentId: number): Page[] => {
  const pages = JSON.parse(localStorage.getItem('pages') || '[]');
  return pages.filter((page: Page) => page.documentId === documentId);
};

export const getPage = (id: number): Page | null => {
  const pages = JSON.parse(localStorage.getItem('pages') || '[]');
  return pages.find((page: Page) => page.id === id) || null;
};

export const deletePage = (id: number): void => {
  const pages = JSON.parse(localStorage.getItem('pages') || '[]');
  const filtered = pages.filter((page: Page) => page.id !== id);
  localStorage.setItem('pages', JSON.stringify(filtered));
  
  // Also delete related table
  const table = getTableByPage(id);
  if (table) {
    deleteTable(table.id);
  }
};

// Table operations
export const saveTable = (
  pageId: number,
  tableData: string[][],
  rowCount: number,
  columnCount: number
): number => {
  const tables = JSON.parse(localStorage.getItem('tables') || '[]');
  const id = getNextId('tables');
  
  const newTable: ExtractedTable = {
    id,
    pageId,
    tableData,
    rowCount,
    columnCount,
  };
  
  tables.push(newTable);
  localStorage.setItem('tables', JSON.stringify(tables));
  return id;
};

export const getTableByPage = (pageId: number): ExtractedTable | null => {
  const tables = JSON.parse(localStorage.getItem('tables') || '[]');
  return tables.find((table: ExtractedTable) => table.pageId === pageId) || null;
};

export const getAllTables = (): ExtractedTable[] => {
  return JSON.parse(localStorage.getItem('tables') || '[]');
};

export const deleteTable = (id: number): void => {
  const tables = JSON.parse(localStorage.getItem('tables') || '[]');
  const filtered = tables.filter((table: ExtractedTable) => table.id !== id);
  localStorage.setItem('tables', JSON.stringify(filtered));
};

// Statistics
export const getStatistics = () => {
  const documents = getAllDocuments();
  const pages = JSON.parse(localStorage.getItem('pages') || '[]');
  const tables = getAllTables();
  
  return {
    totalDocuments: documents.length,
    totalPages: pages.length,
    totalTables: tables.length,
    totalSize: documents.reduce((sum, doc) => sum + doc.fileSize, 0),
  };
};

// Search
export const searchDocuments = (query: string): Document[] => {
  const documents = getAllDocuments();
  const pages = JSON.parse(localStorage.getItem('pages') || '[]');
  
  return documents.filter(doc => {
    // Search in filename
    if (doc.filename.toLowerCase().includes(query.toLowerCase())) {
      return true;
    }
    
    // Search in page text
    const docPages = pages.filter((page: Page) => page.documentId === doc.id);
    return docPages.some((page: Page) => 
      page.extractedText?.toLowerCase().includes(query.toLowerCase())
    );
  });
};

// Cleanup
export const cleanupOldData = (daysOld: number = 30): number => {
  const documents = getAllDocuments();
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - daysOld);
  
  let deletedCount = 0;
  documents.forEach(doc => {
    if (new Date(doc.uploadDate) < cutoffDate) {
      deleteDocument(doc.id);
      deletedCount++;
    }
  });
  
  return deletedCount;
};

export default {
  saveDocument,
  getAllDocuments,
  getDocument,
  deleteDocument,
  savePage,
  getPagesByDocument,
  getPage,
  saveTable,
  getTableByPage,
  getAllTables,
  searchDocuments,
  getStatistics,
  cleanupOldData,
};
