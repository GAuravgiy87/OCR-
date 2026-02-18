import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

// Database file location
const DB_PATH = path.join(process.cwd(), 'data', 'ocr-data.db');

// Ensure data directory exists
const dataDir = path.join(process.cwd(), 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

// Initialize database
const db = new Database(DB_PATH);

// Enable foreign keys
db.pragma('foreign_keys = ON');

// Create tables
const initDB = () => {
  // Documents table - stores PDF/image metadata
  db.exec(`
    CREATE TABLE IF NOT EXISTS documents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      filename TEXT NOT NULL,
      file_type TEXT NOT NULL,
      file_size INTEGER NOT NULL,
      total_pages INTEGER NOT NULL,
      upload_date DATETIME DEFAULT CURRENT_TIMESTAMP,
      file_data BLOB,
      thumbnail BLOB
    )
  `);

  // Pages table - stores individual page data
  db.exec(`
    CREATE TABLE IF NOT EXISTS pages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      document_id INTEGER NOT NULL,
      page_number INTEGER NOT NULL,
      original_image BLOB,
      processed_image BLOB,
      rotation_applied INTEGER DEFAULT 0,
      is_table BOOLEAN DEFAULT 0,
      extracted_text TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
    )
  `);

  // Tables table - stores extracted table data
  db.exec(`
    CREATE TABLE IF NOT EXISTS extracted_tables (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      page_id INTEGER NOT NULL,
      table_data TEXT NOT NULL,
      row_count INTEGER,
      column_count INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (page_id) REFERENCES pages(id) ON DELETE CASCADE
    )
  `);

  // Create indexes for better performance
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_pages_document_id ON pages(document_id);
    CREATE INDEX IF NOT EXISTS idx_tables_page_id ON extracted_tables(page_id);
    CREATE INDEX IF NOT EXISTS idx_documents_upload_date ON documents(upload_date);
  `);

  console.log('Database initialized successfully');
};

// Initialize database on import
initDB();

// Document operations
export const saveDocument = (
  filename: string,
  fileType: string,
  fileSize: number,
  totalPages: number,
  fileData?: Buffer,
  thumbnail?: Buffer
) => {
  const stmt = db.prepare(`
    INSERT INTO documents (filename, file_type, file_size, total_pages, file_data, thumbnail)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  
  const result = stmt.run(filename, fileType, fileSize, totalPages, fileData, thumbnail);
  return result.lastInsertRowid;
};

export const getDocument = (id: number) => {
  const stmt = db.prepare('SELECT * FROM documents WHERE id = ?');
  return stmt.get(id);
};

export const getAllDocuments = () => {
  const stmt = db.prepare(`
    SELECT 
      id, 
      filename, 
      file_type, 
      file_size, 
      total_pages, 
      upload_date,
      thumbnail
    FROM documents 
    ORDER BY upload_date DESC
  `);
  return stmt.all();
};

export const deleteDocument = (id: number) => {
  const stmt = db.prepare('DELETE FROM documents WHERE id = ?');
  return stmt.run(id);
};

// Page operations
export const savePage = (
  documentId: number,
  pageNumber: number,
  originalImage: string,
  processedImage: string,
  rotationApplied: number,
  isTable: boolean,
  extractedText?: string
) => {
  const stmt = db.prepare(`
    INSERT INTO pages (
      document_id, 
      page_number, 
      original_image, 
      processed_image, 
      rotation_applied, 
      is_table, 
      extracted_text
    )
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  
  const result = stmt.run(
    documentId,
    pageNumber,
    originalImage,
    processedImage,
    rotationApplied,
    isTable ? 1 : 0,
    extractedText
  );
  return result.lastInsertRowid;
};

export const getPagesByDocument = (documentId: number) => {
  const stmt = db.prepare(`
    SELECT * FROM pages 
    WHERE document_id = ? 
    ORDER BY page_number
  `);
  return stmt.all(documentId);
};

export const getPage = (id: number) => {
  const stmt = db.prepare('SELECT * FROM pages WHERE id = ?');
  return stmt.get(id);
};

// Table operations
export const saveTable = (
  pageId: number,
  tableData: string[][],
  rowCount: number,
  columnCount: number
) => {
  const stmt = db.prepare(`
    INSERT INTO extracted_tables (page_id, table_data, row_count, column_count)
    VALUES (?, ?, ?, ?)
  `);
  
  const result = stmt.run(
    pageId,
    JSON.stringify(tableData),
    rowCount,
    columnCount
  );
  return result.lastInsertRowid;
};

export const getTableByPage = (pageId: number) => {
  const stmt = db.prepare('SELECT * FROM extracted_tables WHERE page_id = ?');
  const result = stmt.get(pageId) as any;
  
  if (result) {
    result.table_data = JSON.parse(result.table_data);
  }
  
  return result;
};

export const getAllTables = () => {
  const stmt = db.prepare(`
    SELECT 
      t.*,
      p.page_number,
      d.filename
    FROM extracted_tables t
    JOIN pages p ON t.page_id = p.id
    JOIN documents d ON p.document_id = d.id
    ORDER BY t.created_at DESC
  `);
  
  const results = stmt.all() as any[];
  return results.map(row => ({
    ...row,
    table_data: JSON.parse(row.table_data)
  }));
};

// Search operations
export const searchDocuments = (query: string) => {
  const stmt = db.prepare(`
    SELECT DISTINCT d.*
    FROM documents d
    LEFT JOIN pages p ON d.id = p.document_id
    WHERE d.filename LIKE ? OR p.extracted_text LIKE ?
    ORDER BY d.upload_date DESC
  `);
  
  const searchTerm = `%${query}%`;
  return stmt.all(searchTerm, searchTerm);
};

// Statistics
export const getStatistics = () => {
  const stats = {
    totalDocuments: db.prepare('SELECT COUNT(*) as count FROM documents').get() as any,
    totalPages: db.prepare('SELECT COUNT(*) as count FROM pages').get() as any,
    totalTables: db.prepare('SELECT COUNT(*) as count FROM extracted_tables').get() as any,
    totalSize: db.prepare('SELECT SUM(file_size) as size FROM documents').get() as any,
  };
  
  return {
    totalDocuments: stats.totalDocuments.count,
    totalPages: stats.totalPages.count,
    totalTables: stats.totalTables.count,
    totalSize: stats.totalSize.size || 0,
  };
};

// Cleanup old data (optional)
export const cleanupOldData = (daysOld: number = 30) => {
  const stmt = db.prepare(`
    DELETE FROM documents 
    WHERE upload_date < datetime('now', '-' || ? || ' days')
  `);
  return stmt.run(daysOld);
};

// Export database instance for advanced queries
export { db };

export default {
  saveDocument,
  getDocument,
  getAllDocuments,
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
