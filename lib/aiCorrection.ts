// Client-side AI correction using fetch to call API
export const correctTableData = async (tableRows: string[][]): Promise<string[][]> => {
  // Return original data if no rows
  if (!tableRows || tableRows.length === 0) {
    return tableRows;
  }

  try {
    console.log('AI: Analyzing and correcting OCR errors...');
    
    const response = await fetch('/api/ai-correct', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'table',
        data: tableRows
      })
    });

    if (!response.ok) {
      console.warn('AI correction API failed, using original data');
      return tableRows;
    }

    const result = await response.json();
    
    // Validate that structure is maintained
    if (result.correctedData && result.correctedData.length === tableRows.length) {
      console.log('AI: Corrections applied successfully');
      return result.correctedData;
    } else {
      console.warn('AI correction changed structure, using original data');
      return tableRows;
    }
    
  } catch (error) {
    console.error('AI correction failed:', error);
    return tableRows; // Return original data if AI fails
  }
};

export const correctTextData = async (text: string): Promise<string> => {
  // Return original text if empty
  if (!text) {
    return text;
  }

  try {
    console.log('AI: Correcting text OCR errors...');
    
    const response = await fetch('/api/ai-correct', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'text',
        data: text
      })
    });

    if (!response.ok) {
      console.warn('AI correction API failed, using original text');
      return text;
    }

    const result = await response.json();
    
    console.log('AI: Text corrections applied');
    return result.correctedData || text;
    
  } catch (error) {
    console.error('AI text correction failed:', error);
    return text;
  }
};
