# Code Documentation

## Overview

This document provides comprehensive documentation for the OCR application codebase, including architecture, file structure, and detailed explanations of key components.

## Project Structure

```
ocr-app/
├── app/                          # Next.js app directory
│   ├── api/                      # API routes
│   │   ├── ai-correct/          # AI correction endpoint
│   │   ├── chat/                # Chat endpoint (Local LLM + Gemini)
│   │   ├── documents/           # Document CRUD operations
│   │   ├── health/              # Health check endpoint
│   │   ├── index/               # Vector indexing endpoint
│   │   ├── llm/                 # Local LLM (Ollama) endpoint
│   │   ├── mapped-data/         # Mapped Excel data operations
│   │   ├── pages/               # Page CRUD operations
│   │   ├── statistics/          # Database statistics
│   │   └── tables/              # Table CRUD operations
│   ├── chat/                    # Chat page (full-page chat interface)
│   ├── database/                # Database viewer page
│   ├── debug/                   # Debug utilities page
│   ├── document/[id]/           # Document detail page
│   ├── upload/                  # Upload page
│   ├── globals.css              # Global styles and animations
│   ├── layout.tsx               # Root layout component
│   └── page.tsx                 # Main OCR processing page
├── components/                   # Reusable React components
│   ├── ConfirmModal.tsx         # Confirmation dialog component
│   └── Toast.tsx                # Toast notification component
├── lib/                         # Utility libraries
│   ├── aiCorrection.ts          # AI-powered OCR correction
│   ├── database.ts              # SQLite database operations
│   ├── dbService.ts             # Database service layer
│   ├── indexing.ts              # Vector indexing for search
│   ├── localStorageDB.ts        # LocalStorage database operations
│   └── vectorStore.ts           # Vector storage utilities
├── public/                      # Static assets
└── data/                        # Database files
```

## Core Components

### 1. Toast Component (`components/Toast.tsx`)

**Purpose:** Provides user feedback through temporary notifications.

**Features:**
- 4 types: success, error, info, warning
- Auto-dismisses after 5 seconds (configurable)
- Slide-in animation from right
- Manual close button
- Color-coded styling

**Usage:**
```tsx
const [toast, setToast] = useState<{message: string, type: ToastType} | null>(null);

const showToast = (message: string, type: ToastType = 'info') => {
  setToast({ message, type });
};

// In JSX:
{toast && (
  <Toast
    message={toast.message}
    type={toast.type}
    onClose={() => setToast(null)}
  />
)}
```

**Props:**
- `message: string` - The notification message
- `type: ToastType` - Visual style (success/error/info/warning)
- `onClose: () => void` - Callback when toast closes
- `duration?: number` - Auto-dismiss duration in ms (default: 5000)

### 2. ConfirmModal Component (`components/ConfirmModal.tsx`)

**Purpose:** Replaces native browser confirm() dialogs with a styled modal.

**Features:**
- Backdrop overlay
- Centered modal with scale-in animation
- Customizable title, message, and buttons
- 3 visual types: danger, warning, info
- Icon-based visual feedback

**Usage:**
```tsx
const [confirmModal, setConfirmModal] = useState({
  isOpen: false,
  title: '',
  message: '',
  onConfirm: () => {}
});

const showConfirm = (title: string, message: string, onConfirm: () => void) => {
  setConfirmModal({ isOpen: true, title, message, onConfirm });
};

// In JSX:
<ConfirmModal
  isOpen={confirmModal.isOpen}
  title={confirmModal.title}
  message={confirmModal.message}
  onConfirm={() => {
    confirmModal.onConfirm();
    setConfirmModal({ ...confirmModal, isOpen: false });
  }}
  onCancel={() => setConfirmModal({ ...confirmModal, isOpen: false })}
  type="danger"
/>
```

**Props:**
- `isOpen: boolean` - Whether modal is visible
- `title: string` - Modal heading
- `message: string` - Detailed message
- `confirmText?: string` - Confirm button text (default: "Confirm")
- `cancelText?: string` - Cancel button text (default: "Cancel")
- `onConfirm: () => void` - Callback when confirmed
- `onCancel: () => void` - Callback when cancelled
- `type?: 'danger' | 'warning' | 'info'` - Visual style (default: "warning")

## API Routes

### 1. LLM API (`app/api/llm/route.ts`)

**Endpoint:** `POST /api/llm`

**Purpose:** Communicates with local Ollama server for LLM inference.

**Request Body:**
```json
{
  "prompt": "string"
}
```

**Response:**
```json
{
  "success": true,
  "output": "string",
  "processingTime": 1234
}
```

**Configuration:**
- URL: `http://localhost:11434/api/generate`
- Model: `qwen2.5:1.5b`
- Timeout: 5 minutes
- Stream: false

**Error Handling:**
- 400: Missing prompt
- 503: Cannot connect to Ollama
- 504: Request timeout
- 500: Other errors

### 2. Chat API (`app/api/chat/route.ts`)

**Endpoint:** `POST /api/chat`

**Purpose:** Routes chat requests to either Local LLM or Gemini API.

**Request Body:**
```json
{
  "question": "string",
  "context": "string",
  "mode": "local" | "gemini"
}
```

**Response:**
```json
{
  "answer": "string"
}
```

**Modes:**
- `local`: Uses Ollama via `/api/llm`
- `gemini`: Uses Google Gemini API (requires `GEMINI_API_KEY`)

**Prompt Structure:**
1. Role definition
2. Instructions for answering
3. Database context
4. User question
5. Answer format guidelines

## Pages

### 1. Main OCR Page (`app/page.tsx`)

**Purpose:** Upload and process documents with OCR.

**Features:**
- PDF and image upload
- Multi-page processing
- Table detection and extraction
- Manual rotation controls
- Column mapping
- AI correction
- Database saving
- Export to CSV

**Key Functions:**
- `processFile()` - Handles file upload and processing
- `processPDF()` - Processes PDF documents
- `processImage()` - Processes single images
- `rotatePageManually()` - Rotates all pages
- `saveToDatabase()` - Saves to database
- `saveMappedDataToDatabase()` - Saves mapped data
- `applyAICorrection()` - Applies AI correction

**State Management:**
- `pageResults` - Processed page data
- `allPages` - Original page images
- `mappedData` - Column-mapped data
- `editedData` - User-edited table data
- `currentDocId` - Saved document ID
- `toast` - Toast notification state
- `confirmModal` - Confirmation modal state

### 2. Chat Page (`app/chat/page.tsx`)

**Purpose:** Full-page chat interface for document Q&A.

**Features:**
- Document-specific chat (via `?docId=` param)
- LLM mode selector (Local/Gemini)
- Markdown table rendering
- Copy table to clipboard
- Conversation history
- Loading states

**Key Functions:**
- `getContextFromDatabase()` - Builds context from database
- `handleSend()` - Sends message to API
- `copyTableToClipboard()` - Copies markdown tables
- `hasTable()` - Detects tables in content

**Dependencies:**
- `react-markdown` - Markdown rendering
- `remark-gfm` - GitHub Flavored Markdown (tables)

### 3. Database Viewer (`app/database/page.tsx`)

**Purpose:** View and manage database contents.

**Features:**
- Statistics dashboard
- Document list with delete
- Table viewer
- Mapped Excel viewer
- Confirmation modals for deletions
- Toast notifications

**Key Functions:**
- `loadData()` - Loads all database data
- `handleDelete()` - Deletes document with confirmation
- `formatBytes()` - Formats file sizes

## TypeScript Types

### Core Types

```typescript
// Table data structure
interface TableData {
  isTable: boolean;
  rows?: string[][];
  text?: string;
  pageNumber?: number;
}

// Page result from OCR processing
interface PageResult {
  pageNumber: number;
  originalImage: string;
  processedImage: string;
  tableData: TableData;
  rotationApplied?: number;
}

// Toast notification types
type ToastType = 'success' | 'error' | 'info' | 'warning';

// Chat message
interface Message {
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

// LLM mode
type LLMMode = 'local' | 'gemini';
```

## Styling

### Global Styles (`app/globals.css`)

**CSS Variables:**
```css
--background: #f8fafc;      /* Light gray background */
--foreground: #0f172a;      /* Dark text */
--primary: #2563eb;         /* Blue primary */
--primary-dark: #1e40af;    /* Darker blue */
--secondary: #64748b;       /* Gray secondary */
--border: #e2e8f0;          /* Light border */
--card: #ffffff;            /* White card */
```

**Animations:**
- `slide-in-right` - Toast entrance (0.3s)
- `scale-in` - Modal entrance (0.2s)

**Custom Scrollbar:**
- Width: 8px
- Track: Light gray (#f1f5f9)
- Thumb: Medium gray (#cbd5e1)
- Hover: Darker gray (#94a3b8)

## Database Schema

### LocalStorage Collections

**documents:**
```typescript
{
  id: number;
  filename: string;
  fileType: 'pdf' | 'image';
  fileSize: number;
  totalPages: number;
  uploadDate: string;
}
```

**pages:**
```typescript
{
  id: number;
  documentId: number;
  pageNumber: number;
  originalImage: string;
  processedImage: string;
  extractedText: string;
  rotationApplied: number;
}
```

**tables:**
```typescript
{
  id: number;
  pageId: number;
  tableData: string[][];
  rowCount: number;
  columnCount: number;
}
```

**mapped_excels:**
```typescript
{
  id: number;
  documentId: number;
  mappedData: string[][];
  mappedText: string;
  columnMapping: { [key: string]: string };
  rowCount: number;
  columnCount: number;
  createdDate: string;
}
```

## Environment Variables

### Required

None (application works without any environment variables)

### Optional

**GEMINI_API_KEY:**
- Purpose: Enable Gemini API mode in chat
- Format: String (API key from Google AI Studio)
- Usage: Set in `.env.local`

```bash
GEMINI_API_KEY=your_api_key_here
```

## Dependencies

### Core Dependencies

```json
{
  "next": "^15.x",
  "react": "^19.x",
  "react-dom": "^19.x",
  "tesseract.js": "^5.x",
  "pdfjs-dist": "^4.x",
  "react-markdown": "^10.x",
  "remark-gfm": "^4.x"
}
```

### Development Dependencies

```json
{
  "typescript": "^5.x",
  "tailwindcss": "^4.x",
  "@types/node": "^22.x",
  "@types/react": "^19.x"
}
```

## Best Practices

### 1. Error Handling

Always use try-catch blocks and provide user feedback:

```typescript
try {
  // Operation
  showToast('Success!', 'success');
} catch (error) {
  console.error('Error:', error);
  showToast('Error occurred', 'error');
}
```

### 2. Confirmation for Destructive Actions

Always confirm before deleting:

```typescript
showConfirm(
  'Delete Document',
  'Are you sure? This cannot be undone.',
  () => {
    deleteDocument();
    showToast('Deleted successfully', 'success');
  }
);
```

### 3. Loading States

Show loading indicators for async operations:

```typescript
const [isLoading, setIsLoading] = useState(false);

const handleAction = async () => {
  setIsLoading(true);
  try {
    await performAction();
  } finally {
    setIsLoading(false);
  }
};
```

### 4. TypeScript Strict Mode

Always define proper types:

```typescript
// Good
interface Props {
  message: string;
  onClose: () => void;
}

// Avoid
const props: any = { ... };
```

### 5. Component Documentation

Add JSDoc comments to all components:

```typescript
/**
 * Component description
 * 
 * @param {Props} props - Component props
 * @returns {JSX.Element} Rendered component
 */
export default function Component(props: Props) {
  // ...
}
```

## Testing

### Manual Testing Checklist

- [ ] Upload PDF document
- [ ] Upload image document
- [ ] Rotate pages
- [ ] Edit table cells
- [ ] Map columns
- [ ] Save to database
- [ ] Export CSV
- [ ] Chat with Local LLM
- [ ] Chat with Gemini API
- [ ] Copy table from chat
- [ ] Delete document (with confirmation)
- [ ] View database statistics

### Common Issues

**Ollama not connecting:**
- Check if Ollama is running: `ollama list`
- Start Ollama: `ollama serve`
- Verify model: `ollama pull qwen2.5:1.5b`

**PDF processing fails:**
- Check PDF.js worker is loaded
- Verify PDF is not corrupted
- Check browser console for errors

**Tables not detected:**
- Ensure document has clear table borders
- Try manual rotation if table is skewed
- Check image quality

## Performance Optimization

### 1. Image Processing

- Upscale images 2x for better OCR
- Use adaptive enhancement based on quality
- Mask out non-table regions

### 2. Context Management

- Limit context size to prevent token overflow
- Prioritize mapped data over raw tables
- Filter by document ID when available

### 3. State Management

- Use local state for UI interactions
- Debounce expensive operations
- Memoize computed values

## Security Considerations

### 1. Data Privacy

- All processing happens locally (except Gemini mode)
- No data sent to external servers (Local LLM mode)
- LocalStorage data stays in browser

### 2. Input Validation

- Validate file types before processing
- Sanitize user input in chat
- Limit file sizes

### 3. API Security

- Use environment variables for API keys
- Never expose keys in client code
- Implement rate limiting (future enhancement)

## Future Enhancements

1. **Persistent Storage:** Move from LocalStorage to IndexedDB
2. **Streaming Responses:** Real-time token streaming for chat
3. **Multi-Document Chat:** Query across multiple documents
4. **Export Options:** PDF, Excel, JSON exports
5. **Advanced OCR:** Support for handwriting recognition
6. **Collaboration:** Share documents and chat history
7. **Cloud Sync:** Optional cloud backup
8. **Mobile Support:** Responsive design improvements

## Contributing

When adding new features:

1. Add comprehensive JSDoc comments
2. Update TypeScript types
3. Add error handling with toast notifications
4. Use confirmation modals for destructive actions
5. Test with multiple document types
6. Update this documentation

## Support

For issues or questions:
- Check console logs for detailed error messages
- Verify Ollama is running for Local LLM mode
- Ensure all dependencies are installed
- Review this documentation for usage examples
