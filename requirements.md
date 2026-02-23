# OCR Navigation Fix - Requirements Document

## 1. Problem Statement

### 1.1 Current Issue
After processing a document with OCR, users navigate to "AI Chat" (`/chat`) or "Save to DB" (`/database`) pages. When they attempt to return to view the OCR results, they are redirected to the upload page, losing all processed OCR data.

### 1.2 Root Cause Analysis

**State Management Issue:**
- All OCR results are stored in local React component state (`useState`) in `app/page.tsx`
- State includes: `pageResults`, `allPages`, `mappedData`, `columnMapping`, `editedData`, etc.
- Navigation to `/chat` or `/database` causes the main page component to unmount
- Component unmount destroys all local state
- No persistence mechanism exists for OCR session data

**Routing Architecture Issue:**
- Single route (`/`) handles both upload and results display
- No separate route for viewing OCR results
- No URL-based state management (no document ID in URL)
- Back navigation from `/chat` or `/database` returns to `/` which shows upload interface

**Existing Document Persistence Pattern:**
- Application has a "Save to Database" feature that persists documents
- Saved documents can be viewed at `/document/[id]` route
- This pattern loads data from localStorage database
- However, unsaved OCR sessions are not persisted

### 1.3 Impact
- Poor user experience - users lose work when navigating
- Forces users to save to database before exploring features
- Prevents casual exploration of AI chat or database features
- No way to return to in-progress OCR session

## 2. User Stories

### 2.1 Primary User Stories

**US-1: Session Persistence**
As a user, I want my OCR results to persist when I navigate to other pages, so that I don't lose my work.

**Acceptance Criteria:**
- OCR results remain available after navigating to `/chat` or `/database`
- Returning to the results page shows the same data
- Session persists across page refreshes (optional enhancement)
- Multiple OCR sessions can be maintained (optional enhancement)

**US-2: Dedicated Results Route**
As a user, I want a dedicated URL for viewing my OCR results, so that I can bookmark or share the results page.

**Acceptance Criteria:**
- OCR results are displayed at a dedicated route (e.g., `/result/[sessionId]`)
- URL contains session identifier
- Direct navigation to results URL works correctly
- Upload page remains at `/` route

**US-3: Seamless Navigation**
As a user, I want to navigate between OCR results, AI chat, and database pages without losing context, so that I can explore all features freely.

**Acceptance Criteria:**
- Navigation buttons maintain session context
- Back button returns to results page, not upload page
- Session ID is passed via URL parameters to `/chat` and `/database`
- All pages can access the current session data

**US-4: Clear Upload Flow**
As a user, I want a clear indication when I'm starting a new OCR session vs. viewing existing results, so that I understand the application state.

**Acceptance Criteria:**
- Upload page clearly indicates it's for new documents
- Results page clearly shows it's displaying processed data
- Option to start new session from results page
- Confirmation before abandoning unsaved session (optional)

### 2.2 Secondary User Stories

**US-5: Session Management**
As a user, I want to manage multiple OCR sessions, so that I can work with multiple documents simultaneously.

**Acceptance Criteria:**
- Can maintain multiple active sessions
- Can switch between sessions
- Can delete old sessions
- Session list shows document names and timestamps

**US-6: Auto-Save Sessions**
As a user, I want my OCR sessions to be automatically saved temporarily, so that I don't lose work if I close the browser.

**Acceptance Criteria:**
- Sessions are saved to sessionStorage or localStorage
- Sessions persist across page refreshes
- Sessions expire after a reasonable time (e.g., 24 hours)
- Clear indication of session status (saved/unsaved)

## 3. Functional Requirements

### 3.1 Session Storage

**FR-1: Session Data Structure**
- Create a session object containing all OCR state:
  - `sessionId`: Unique identifier (UUID or timestamp)
  - `fileName`: Original file name
  - `fileType`: File type (PDF/image)
  - `pageResults`: Processed OCR results
  - `allPages`: All page images
  - `mappedData`: Column-mapped data (if any)
  - `columnMapping`: Column mapping configuration
  - `editedData`: User edits to table data
  - `timestamp`: Session creation time
  - `documentId`: Database document ID (if saved)

**FR-2: Session Persistence**
- Store session data in sessionStorage for current browser session
- Optionally store in localStorage for persistence across sessions
- Implement session expiration (24-48 hours)
- Clean up expired sessions automatically

**FR-3: Session Retrieval**
- Load session by ID from storage
- Validate session data integrity
- Handle missing or corrupted sessions gracefully
- Provide fallback to upload page if session not found

### 3.2 Routing Structure

**FR-4: New Route Structure**
```
/ (Upload page)
  - File upload interface
  - Drag & drop support
  - Recent sessions list (optional)

/result/[sessionId] (Results page)
  - Display OCR results
  - Table editing
  - Column mapping
  - Export options
  - Navigation to chat/database with session context

/chat?sessionId=[sessionId] (Chat page - existing, enhanced)
  - Load session data by sessionId
  - Provide document context to AI
  - Back button returns to /result/[sessionId]

/database?sessionId=[sessionId] (Database page - existing, enhanced)
  - Load session data by sessionId
  - Show current session in context
  - Back button returns to /result/[sessionId]

/document/[id] (Saved document page - existing)
  - Load from database
  - Same functionality as results page
  - For permanently saved documents
```

**FR-5: Navigation Flow**
```
Upload (/) 
  → Process File 
  → Redirect to /result/[sessionId]

Results (/result/[sessionId])
  → AI Chat (/chat?sessionId=[sessionId])
  → Database (/database?sessionId=[sessionId])
  → Save to DB → /document/[id]
  → New Upload → / (with confirmation)

Chat (/chat?sessionId=[sessionId])
  → Back → /result/[sessionId]

Database (/database?sessionId=[sessionId])
  → Back → /result/[sessionId]
```

### 3.3 State Management

**FR-6: Session Context**
- Create a session management utility/hook
- Provide functions: `createSession()`, `getSession()`, `updateSession()`, `deleteSession()`
- Handle session lifecycle
- Manage session storage operations

**FR-7: URL State Synchronization**
- Session ID in URL matches active session
- URL updates when session changes
- Browser back/forward buttons work correctly
- Deep linking to specific sessions works

### 3.4 User Interface

**FR-8: Upload Page Enhancements**
- Clear "Upload New Document" heading
- Recent sessions list (optional)
- Session management options (optional)

**FR-9: Results Page Enhancements**
- Display session information (file name, timestamp)
- "New Upload" button to start fresh session
- Session status indicator (saved/unsaved)
- All existing OCR result features

**FR-10: Navigation Enhancements**
- Update navigation buttons to include sessionId
- Breadcrumb navigation (optional)
- Clear back button behavior
- Session context in page headers

## 4. Non-Functional Requirements

### 4.1 Performance
- Session save/load operations complete in < 100ms
- No noticeable delay when navigating between pages
- Efficient storage usage (compress large images if needed)

### 4.2 Reliability
- Session data integrity maintained across navigation
- Graceful handling of storage quota exceeded
- Automatic recovery from corrupted sessions

### 4.3 Usability
- Intuitive navigation flow
- Clear visual feedback for session state
- Minimal user confusion about current context
- Consistent UI patterns across pages

### 4.4 Compatibility
- Works in all modern browsers (Chrome, Firefox, Safari, Edge)
- Respects browser storage limitations
- Handles private/incognito mode gracefully

## 5. Technical Constraints

### 5.1 Existing Architecture
- Next.js 14+ with App Router
- Client-side state management (React hooks)
- localStorage for database simulation
- No backend server for session management

### 5.2 Storage Limitations
- sessionStorage: ~5-10MB per origin
- localStorage: ~5-10MB per origin
- Large PDF files may exceed limits
- Need compression or selective storage strategy

### 5.3 Backward Compatibility
- Existing `/document/[id]` route must continue working
- Database viewer functionality unchanged
- Chat functionality unchanged
- No breaking changes to saved documents

## 6. Success Criteria

### 6.1 Functional Success
- ✅ Users can navigate to chat/database and return to results
- ✅ OCR results persist across navigation
- ✅ Session ID visible in URL
- ✅ Back button returns to results page
- ✅ All existing features work in new structure

### 6.2 User Experience Success
- ✅ Zero data loss during navigation
- ✅ Clear indication of current session
- ✅ Intuitive navigation flow
- ✅ Fast page transitions (< 200ms perceived)

### 6.3 Technical Success
- ✅ Clean separation of upload and results pages
- ✅ Reusable session management utilities
- ✅ Minimal code duplication
- ✅ Maintainable routing structure

## 7. Out of Scope

### 7.1 Explicitly Excluded
- Backend server implementation
- User authentication/authorization
- Multi-user session sharing
- Cloud storage integration
- Real-time collaboration
- Session synchronization across devices

### 7.2 Future Enhancements
- Session history with thumbnails
- Session search and filtering
- Batch processing multiple documents
- Session export/import
- Advanced session analytics

## 8. Dependencies

### 8.1 Internal Dependencies
- Existing OCR processing logic in `app/page.tsx`
- Database service in `lib/dbService.ts`
- localStorage database in `lib/localStorageDB.ts`
- Toast and modal components

### 8.2 External Dependencies
- Next.js routing (App Router)
- React hooks (useState, useEffect, useRouter, useSearchParams)
- Browser storage APIs (sessionStorage/localStorage)
- UUID generation library (optional, can use timestamp)

## 9. Risks and Mitigations

### 9.1 Storage Quota Exceeded
**Risk:** Large PDF files may exceed browser storage limits
**Mitigation:** 
- Implement storage size checks
- Compress images before storing
- Store only essential data
- Provide clear error messages
- Fallback to in-memory storage

### 9.2 Session Data Corruption
**Risk:** Corrupted session data causes application errors
**Mitigation:**
- Validate session data on load
- Implement error boundaries
- Provide session recovery options
- Clear corrupted sessions automatically

### 9.3 Browser Compatibility
**Risk:** Storage APIs behave differently across browsers
**Mitigation:**
- Test on all major browsers
- Implement feature detection
- Provide fallbacks for unsupported features
- Document browser requirements

### 9.4 User Confusion
**Risk:** Users don't understand new navigation flow
**Mitigation:**
- Clear visual indicators
- Helpful tooltips and messages
- Consistent navigation patterns
- User testing and feedback

## 10. Acceptance Testing Scenarios

### 10.1 Basic Navigation Flow
1. Upload a PDF document
2. Verify redirect to `/result/[sessionId]`
3. Click "AI Chat" button
4. Verify navigation to `/chat?sessionId=[sessionId]`
5. Click back button
6. Verify return to `/result/[sessionId]` with data intact

### 10.2 Session Persistence
1. Upload and process a document
2. Navigate to chat page
3. Refresh browser
4. Verify session data still available
5. Navigate back to results
6. Verify all data intact

### 10.3 Multiple Sessions
1. Upload document A
2. Note sessionId A
3. Navigate to upload page
4. Upload document B
5. Note sessionId B
6. Navigate to sessionId A URL
7. Verify document A data displayed
8. Navigate to sessionId B URL
9. Verify document B data displayed

### 10.4 Save to Database
1. Upload and process a document
2. Map columns and edit data
3. Click "Save to Database"
4. Verify redirect to `/document/[id]`
5. Verify all data saved correctly
6. Navigate back to upload page
7. Verify clean state for new upload

### 10.5 Error Handling
1. Navigate to `/result/invalid-session-id`
2. Verify graceful error handling
3. Verify redirect to upload page with message
4. Clear browser storage
5. Navigate to previous sessionId
6. Verify appropriate error message

## 11. Documentation Requirements

### 11.1 Code Documentation
- JSDoc comments for session management functions
- Inline comments for complex routing logic
- README updates for new routing structure

### 11.2 User Documentation
- Update user guide with new navigation flow
- Add screenshots of new UI elements
- Document session management features

### 11.3 Developer Documentation
- Architecture decision records (ADR)
- Session data structure specification
- Migration guide from old to new structure
