// Client-side database service using localStorage
import * as db from './localStorageDB';

export interface PageResult {
  pageNumber: number;
  originalImage: string;
  processedImage: string;
  tableData: {
    isTable: boolean;
    rows?: string[][];
    text?: string;
    pageNumber?: number;
  };
  rotationApplied?: number;
}

// Save document and all its pages
export const saveDocumentWithPages = async (
  filename: string,
  fileType: string,
  fileSize: number,
  pageResults: PageResult[]
) => {
  try {
    // 1. Save document
    const documentId = db.saveDocument(filename, fileType, fileSize, pageResults.length);

    // 2. Save each page
    for (const page of pageResults) {
      const pageId = db.savePage(
        documentId,
        page.pageNumber,
        page.originalImage,
        page.processedImage,
        page.rotationApplied || 0,
        page.tableData.isTable,
        page.tableData.text || ''
      );

      // 3. Save table data if it's a table
      if (page.tableData.isTable && page.tableData.rows) {
        db.saveTable(
          pageId,
          page.tableData.rows,
          page.tableData.rows.length,
          page.tableData.rows[0]?.length || 0
        );
      }
    }

    return { success: true, documentId };
  } catch (error) {
    console.error('Error saving document with pages:', error);
    return { success: false, error };
  }
};

// Get all documents
export const getAllDocuments = async () => {
  try {
    return db.getAllDocuments();
  } catch (error) {
    console.error('Error fetching documents:', error);
    return [];
  }
};

// Get document by ID
export const getDocument = async (id: number) => {
  try {
    return db.getDocument(id);
  } catch (error) {
    console.error('Error fetching document:', error);
    return null;
  }
};

// Get pages by document ID
export const getPagesByDocument = async (documentId: number) => {
  try {
    return db.getPagesByDocument(documentId);
  } catch (error) {
    console.error('Error fetching pages:', error);
    return [];
  }
};

// Get table by page ID
export const getTableByPage = async (pageId: number) => {
  try {
    return db.getTableByPage(pageId);
  } catch (error) {
    console.error('Error fetching table:', error);
    return null;
  }
};

// Get all tables
export const getAllTables = async () => {
  try {
    return db.getAllTables();
  } catch (error) {
    console.error('Error fetching tables:', error);
    return [];
  }
};

// Delete document
export const deleteDocument = async (id: number) => {
  try {
    db.deleteDocument(id);
    return { success: true };
  } catch (error) {
    console.error('Error deleting document:', error);
    return { success: false, error };
  }
};

// Get statistics
export const getStatistics = async () => {
  try {
    return db.getStatistics();
  } catch (error) {
    console.error('Error fetching statistics:', error);
    return {
      totalDocuments: 0,
      totalPages: 0,
      totalTables: 0,
      totalSize: 0,
    };
  }
};
