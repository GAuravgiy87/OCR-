'use client';

import { useState, useEffect } from 'react';
import { createWorker } from 'tesseract.js';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import { correctTableData, correctTextData } from '../lib/aiCorrection';
import { saveDocumentWithPages } from '../lib/dbService';

interface TableData {
  isTable: boolean;
  rows?: string[][];
  text?: string;
  pageNumber?: number;
}

interface PageResult {
  pageNumber: number;
  originalImage: string;
  processedImage: string;
  tableData: TableData;
  rotationApplied?: number;
}

export default function Home() {
  const [file, setFile] = useState<File | null>(null);
  const [pageResults, setPageResults] = useState<PageResult[]>([]);
  const [allPages, setAllPages] = useState<PageResult[]>([]); // Store all original pages
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [currentPage, setCurrentPage] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [error, setError] = useState<string>('');
  const [pdfWorkerReady, setPdfWorkerReady] = useState(false);
  const [manualRotation, setManualRotation] = useState<{ [key: number]: number }>({});
  const [showMapping, setShowMapping] = useState(false);
  const [columnMapping, setColumnMapping] = useState<{ [key: string]: string }>({});
  const [mappedData, setMappedData] = useState<string[][] | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [editedData, setEditedData] = useState<{ [pageIndex: number]: string[][] }>({});
  const [isDragging, setIsDragging] = useState(false);
  const [currentPageView, setCurrentPageView] = useState(0);
  const [isRotating, setIsRotating] = useState(false);
  const [aiCorrectionEnabled, setAiCorrectionEnabled] = useState(false);
  const [isAiCorrecting, setIsAiCorrecting] = useState(false);
  const [isSavingToDb, setIsSavingToDb] = useState(false);
  const [currentFileName, setCurrentFileName] = useState<string>('');

  // Predefined columns for mapping
  const predefinedColumns = [
    'Sr. No',
    'Category',
    'RFP Document Reference (Page & Section)',
    'Content of RFP Requiring Clarification',
    'Points of Clarification (Bidder Query)',
    'Response (SRA)'
  ];

  const rotatePageManually = async (pageIndex: number, angle: number) => {
    if (allPages.length === 0) return;
    
    // Prevent multiple simultaneous rotations
    if (isRotating) {
      console.log('Rotation already in progress, ignoring click');
      return;
    }

    try {
      setIsRotating(true);
      console.log(`Rotating ALL pages by ${angle} degrees...`);
      
      // Rotate ALL pages from allPages, not pageResults
      const rotatedResults = await Promise.all(
        allPages.map(async (pageResult) => {
          const rotated = await rotateImage(pageResult.originalImage, angle);
          return {
            ...pageResult,
            originalImage: rotated,
            rotationApplied: (pageResult.rotationApplied || 0) + angle
          };
        })
      );
      
      // Update allPages display immediately
      setAllPages(rotatedResults);
      
      console.log('All images rotated, now reprocessing table data...');
      setLoading(true);
      setProgress(0);

      // Reprocess all pages with the rotation
      const worker = await createWorker('eng', 1, {
        langPath: 'https://tessdata.projectnaptha.com/4.0.0',
        logger: (m) => {
          if (m.status === 'recognizing text') {
            setProgress(Math.round(m.progress * 100));
          }
        },
      });
      
      await worker.setParameters({
        preserve_interword_spaces: '1',
      });

      let firstPageStructure: { rowBoundaries: number[], colBoundaries: number[], tableRegion: any } | null = null;
      const reprocessedResults: PageResult[] = [];

      for (let i = 0; i < rotatedResults.length; i++) {
        const rotatedResult = rotatedResults[i];
        
        if (i === 0) {
          // Process first page normally to get structure
          const quality = await analyzeImageQuality(rotatedResult.originalImage);
          const enhanced = await enhanceImageAdaptive(rotatedResult.originalImage, quality);
          const { rowBoundaries, colBoundaries, tableRegion } = await detectTableStructure(enhanced);
          
          let newTableData: TableData;
          let newProcessedImage = rotatedResult.originalImage;

          if (rowBoundaries.length >= 2 && colBoundaries.length >= 2 && tableRegion) {
            const maskedImage = await maskOutsideTable(enhanced, tableRegion);
            const tableRows = await extractCellData(maskedImage, rowBoundaries, colBoundaries, worker, quality, tableRegion);
            let cleanedTableRows = findHeaderRowAndClean(tableRows);
            
            newTableData = { isTable: true, rows: cleanedTableRows, pageNumber: rotatedResult.pageNumber };
            newProcessedImage = await cropToTableRegion(maskedImage, tableRegion);
            
            // Save structure for other pages
            firstPageStructure = { rowBoundaries, colBoundaries, tableRegion };
            console.log(`First page reprocessed: ${cleanedTableRows.length} rows extracted`);
          } else {
            const { data } = await worker.recognize(enhanced, {
              tessedit_pageseg_mode: '1',
              tessedit_ocr_engine_mode: '1',
              preserve_interword_spaces: '1',
            } as any);
            let text = data.text
              .replace(/[|]/g, 'I')
              .replace(/[`´']/g, "'")
              .replace(/[""]/g, '"')
              .trim();
            
            newTableData = { isTable: false, text, pageNumber: rotatedResult.pageNumber };
          }

          reprocessedResults.push({
            ...rotatedResult,
            processedImage: newProcessedImage,
            tableData: newTableData
          });
        } else if (firstPageStructure) {
          // Use first page structure for subsequent pages
          const quality = await analyzeImageQuality(rotatedResult.originalImage);
          const enhanced = await enhanceImageAdaptive(rotatedResult.originalImage, quality);
          const { rowBoundaries, colBoundaries, tableRegion } = firstPageStructure;
          
          const maskedImage = await maskOutsideTable(enhanced, tableRegion);
          const tableRows = await extractCellData(maskedImage, rowBoundaries, colBoundaries, worker, quality, tableRegion);
          
          const newTableData: TableData = { isTable: true, rows: tableRows, pageNumber: rotatedResult.pageNumber };
          const newProcessedImage = await cropToTableRegion(maskedImage, tableRegion);
          
          console.log(`Page ${rotatedResult.pageNumber} reprocessed with first page structure: ${tableRows.length} rows`);
          
          reprocessedResults.push({
            ...rotatedResult,
            processedImage: newProcessedImage,
            tableData: newTableData
          });
        } else {
          reprocessedResults.push(rotatedResult);
        }
      }

      await worker.terminate();

      // Merge the reprocessed results
      const { mergedResults, allPages: newAllPages } = mergeMultiPageTables(reprocessedResults);
      setPageResults(mergedResults);
      setAllPages(newAllPages);

      // Clear all edited data since we have new data
      setEditedData({});

      console.log(`All pages rotation complete!`);
      setLoading(false);
      setProgress(0);
      setIsRotating(false);
    } catch (error) {
      console.error('Error during manual rotation:', error);
      setError(`Failed to reprocess rotated images: ${error}`);
      setLoading(false);
      setProgress(0);
      setIsRotating(false);
    }
  };

  const exportAllToCSV = () => {
    const allTables = pageResults.filter(r => r.tableData.isTable && r.tableData.rows);
    if (allTables.length === 0) return;
    
    const csv = allTables.map((result, idx) => {
      const header = idx === 0 ? '' : `\n\n--- Page ${result.pageNumber} ---\n`;
      const tableCSV = result.tableData.rows!.map(row => 
        row.map(cell => `"${cell.replace(/"/g, '""')}"`).join(',')
      ).join('\n');
      return header + tableCSV;
    }).join('');
    
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'all_tables.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  const saveToDatabase = async () => {
    if (pageResults.length === 0) return;
    
    setIsSavingToDb(true);
    
    try {
      const filename = currentFileName || 'document.pdf';
      const fileType = filename.toLowerCase().endsWith('.pdf') ? 'pdf' : 'image';
      const fileSize = 0; // We don't have the original file size here
      
      const result = await saveDocumentWithPages(
        filename,
        fileType,
        fileSize,
        pageResults
      );
      
      if (result.success) {
        alert(`Document saved successfully! Document ID: ${result.documentId}`);
      } else {
        alert('Failed to save document to database');
      }
    } catch (error) {
      console.error('Error saving to database:', error);
      alert('Error saving to database');
    } finally {
      setIsSavingToDb(false);
    }
  };

  const applyAICorrection = async () => {
    if (pageResults.length === 0) return;
    
    setIsAiCorrecting(true);
    
    try {
      console.log('Applying AI correction to all pages...');
      
      const correctedResults = await Promise.all(
        pageResults.map(async (result) => {
          if (result.tableData.isTable && result.tableData.rows) {
            // Correct table data
            const correctedRows = await correctTableData(result.tableData.rows);
            return {
              ...result,
              tableData: {
                ...result.tableData,
                rows: correctedRows
              }
            };
          } else if (result.tableData.text) {
            // Correct text data
            const correctedText = await correctTextData(result.tableData.text);
            return {
              ...result,
              tableData: {
                ...result.tableData,
                text: correctedText
              }
            };
          }
          return result;
        })
      );
      
      setPageResults(correctedResults);
      alert('AI correction applied successfully!');
    } catch (error) {
      console.error('Error applying AI correction:', error);
      alert('Error applying AI correction');
    } finally {
      setIsAiCorrecting(false);
    }
  };

  const handleColumnMapping = (predefinedCol: string, extractedCol: string) => {
    const newMapping = {
      ...columnMapping,
      [predefinedCol]: extractedCol
    };
    setColumnMapping(newMapping);
    
    // Auto-apply mapping when any column is mapped
    applyMappingWithData(newMapping);
  };

  const applyMappingWithData = (mapping: { [key: string]: string }) => {
    const firstTable = pageResults.find(r => r.tableData.isTable && r.tableData.rows);
    if (!firstTable || !firstTable.tableData.rows || firstTable.tableData.rows.length < 2) return;

    // Get edited data if available, otherwise use original
    const pageIndex = pageResults.indexOf(firstTable);
    const tableRows = editedData[pageIndex] || firstTable.tableData.rows;

    // Use first row as headers (Sr. No row)
    const extractedHeaders = tableRows[0];
    const dataRows = tableRows.slice(1); // Start from 2nd row

    // Create mapped data with predefined column order
    const mapped: string[][] = [];
    
    // Add header row with predefined columns
    mapped.push(predefinedColumns);

    // Map each data row
    for (const row of dataRows) {
      const mappedRow: string[] = [];
      
      for (const predefinedCol of predefinedColumns) {
        const extractedCol = mapping[predefinedCol];
        if (extractedCol) {
          const colIndex = extractedHeaders.indexOf(extractedCol);
          if (colIndex !== -1 && colIndex < row.length) {
            mappedRow.push(row[colIndex]);
          } else {
            mappedRow.push('');
          }
        } else {
          mappedRow.push('');
        }
      }
      
      mapped.push(mappedRow);
    }

    setMappedData(mapped);
  };

  const handleCellEdit = (pageIndex: number, rowIndex: number, colIndex: number, value: string) => {
    const result = pageResults[pageIndex];
    if (!result || !result.tableData.rows) return;

    // Get current data (edited or original)
    const currentData = editedData[pageIndex] || result.tableData.rows;
    
    // Create a copy and update the cell
    const newData = currentData.map((row, rIdx) => 
      rIdx === rowIndex ? row.map((cell, cIdx) => cIdx === colIndex ? value : cell) : [...row]
    );

    // Update edited data
    setEditedData(prev => ({
      ...prev,
      [pageIndex]: newData
    }));

    // Re-apply mapping if mapping is active
    if (showMapping) {
      applyMappingWithData(columnMapping);
    }
  };

  const toggleEditMode = () => {
    setEditMode(!editMode);
  };

  const applyMapping = () => {
    applyMappingWithData(columnMapping);
  };

  const exportMappedData = () => {
    if (!mappedData) return;
    
    const csv = mappedData.map(row => 
      row.map(cell => `"${cell.replace(/"/g, '""')}"`).join(',')
    ).join('\n');
    
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'mapped_data.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  useEffect(() => {
    // Initialize PDF.js worker - dynamic import to avoid SSR issues
    if (typeof window !== 'undefined') {
      import('pdfjs-dist').then((pdfjsLib) => {
        try {
          pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';
          setPdfWorkerReady(true);
        } catch (err) {
          console.error('Failed to set PDF worker:', err);
          // Fallback to CDN
          pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.js`;
          setPdfWorkerReady(true);
        }
      }).catch(err => {
        console.error('Failed to load PDF.js:', err);
        setError('Failed to initialize PDF support');
      });
    }
  }, []);

  const detectRotation = async (imageData: string): Promise<number> => {
    try {
      // Simplified rotation detection without legacy model
      // Just return 0 for now - user can manually rotate if needed
      console.log('Auto-rotation disabled - use manual rotation buttons if needed');
      return 0;
    } catch (error) {
      console.error('Rotation detection failed:', error);
      return 0;
    }
  };

  const rotateImage = async (imageData: string, angle: number): Promise<string> => {
    if (angle === 0) return imageData;
    
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d')!;
        
        // Normalize angle to 0, 90, 180, 270
        const normalizedAngle = ((angle % 360) + 360) % 360;
        
        if (normalizedAngle === 90 || normalizedAngle === 270) {
          // Swap dimensions for 90/270 degree rotation
          canvas.width = img.height;
          canvas.height = img.width;
        } else {
          canvas.width = img.width;
          canvas.height = img.height;
        }
        
        ctx.translate(canvas.width / 2, canvas.height / 2);
        ctx.rotate((normalizedAngle * Math.PI) / 180);
        ctx.drawImage(img, -img.width / 2, -img.height / 2);
        
        resolve(canvas.toDataURL());
      };
      img.src = imageData;
    });
  };

  const upscaleImage = async (imageData: string, scale: number = 2): Promise<string> => {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d')!;
        
        // Upscale for better OCR
        canvas.width = img.width * scale;
        canvas.height = img.height * scale;
        
        // Use better image smoothing
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        
        resolve(canvas.toDataURL('image/png', 1.0));
      };
      img.src = imageData;
    });
  };

  const analyzeImageQuality = async (imageData: string): Promise<{ quality: 'high' | 'medium' | 'low', brightness: number, contrast: number }> => {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d')!;
        
        // Sample a smaller version for speed
        const sampleSize = 200;
        canvas.width = sampleSize;
        canvas.height = sampleSize;
        ctx.drawImage(img, 0, 0, sampleSize, sampleSize);

        const imageDataObj = ctx.getImageData(0, 0, sampleSize, sampleSize);
        const data = imageDataObj.data;

        let totalBrightness = 0;
        let brightnessValues: number[] = [];

        for (let i = 0; i < data.length; i += 4) {
          const brightness = (data[i] + data[i + 1] + data[i + 2]) / 3;
          totalBrightness += brightness;
          brightnessValues.push(brightness);
        }

        const avgBrightness = totalBrightness / brightnessValues.length;

        // Calculate contrast (standard deviation)
        let variance = 0;
        for (const val of brightnessValues) {
          variance += Math.pow(val - avgBrightness, 2);
        }
        const stdDev = Math.sqrt(variance / brightnessValues.length);

        // Determine quality based on contrast
        let quality: 'high' | 'medium' | 'low';
        if (stdDev > 50) {
          quality = 'high';
        } else if (stdDev > 30) {
          quality = 'medium';
        } else {
          quality = 'low';
        }

        resolve({ quality, brightness: avgBrightness, contrast: stdDev });
      };
      img.src = imageData;
    });
  };

  const enhanceImageAdaptive = async (imageData: string, quality: { quality: 'high' | 'medium' | 'low', brightness: number, contrast: number }): Promise<string> => {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d')!;
        
        canvas.width = img.width;
        canvas.height = img.height;
        ctx.drawImage(img, 0, 0);

        const imageDataObj = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const data = imageDataObj.data;

        if (quality.quality === 'low') {
          // Aggressive enhancement for low quality
          // Apply adaptive histogram equalization
          const histogram = new Array(256).fill(0);
          for (let i = 0; i < data.length; i += 4) {
            const gray = Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
            histogram[gray]++;
          }

          // Calculate cumulative distribution
          const cdf = new Array(256).fill(0);
          cdf[0] = histogram[0];
          for (let i = 1; i < 256; i++) {
            cdf[i] = cdf[i - 1] + histogram[i];
          }

          // Normalize CDF
          const totalPixels = canvas.width * canvas.height;
          const cdfMin = cdf.find(val => val > 0) || 0;
          
          for (let i = 0; i < data.length; i += 4) {
            const gray = Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
            const equalized = Math.round(((cdf[gray] - cdfMin) / (totalPixels - cdfMin)) * 255);
            
            // Apply sharpening
            const sharpened = Math.min(255, Math.max(0, equalized * 1.3));
            
            data[i] = data[i + 1] = data[i + 2] = sharpened;
          }
        } else if (quality.quality === 'medium') {
          // Moderate enhancement
          for (let i = 0; i < data.length; i += 4) {
            const gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
            
            // Adjust brightness if needed
            let adjusted = gray;
            if (quality.brightness < 100) {
              adjusted = gray * 1.3; // Brighten dark images
            } else if (quality.brightness > 180) {
              adjusted = gray * 0.9; // Darken bright images
            }
            
            // Enhance contrast
            const enhanced = Math.min(255, Math.max(0, (adjusted - 128) * 1.4 + 128));
            
            data[i] = data[i + 1] = data[i + 2] = enhanced;
          }
        } else {
          // Minimal enhancement for high quality
          for (let i = 0; i < data.length; i += 4) {
            const gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
            const enhanced = Math.min(255, Math.max(0, (gray - 128) * 1.15 + 128));
            data[i] = data[i + 1] = data[i + 2] = enhanced;
          }
        }

        ctx.putImageData(imageDataObj, 0, 0);
        resolve(canvas.toDataURL());
      };
      img.src = imageData;
    });
  };

  const preprocessImage = async (imageData: string): Promise<string> => {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d')!;
        
        canvas.width = img.width;
        canvas.height = img.height;
        ctx.drawImage(img, 0, 0);

        const imageDataObj = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const data = imageDataObj.data;

        // Apply gentle contrast enhancement without harsh thresholding
        for (let i = 0; i < data.length; i += 4) {
          // Convert to grayscale
          const gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
          
          // Gentle contrast enhancement (preserve details)
          const enhanced = Math.min(255, Math.max(0, (gray - 128) * 1.2 + 128));
          
          data[i] = data[i + 1] = data[i + 2] = enhanced;
        }

        ctx.putImageData(imageDataObj, 0, 0);
        resolve(canvas.toDataURL());
      };
      img.src = imageData;
    });
  };

  const detectTableStructure = async (imageData: string) => {
    return new Promise<{ rowBoundaries: number[], colBoundaries: number[], tableRegion: { x: number, y: number, width: number, height: number } | null }>((resolve) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d')!;
        canvas.width = img.width;
        canvas.height = img.height;
        ctx.drawImage(img, 0, 0);

        const imageDataObj = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const data = imageDataObj.data;

        // Create edge detection map
        const edgeMap = new Uint8Array(canvas.width * canvas.height);
        for (let i = 0; i < data.length; i += 4) {
          const brightness = (data[i] + data[i + 1] + data[i + 2]) / 3;
          edgeMap[i / 4] = brightness < 180 ? 1 : 0;
        }

        // Detect horizontal lines
        const rowLines: number[] = [];
        const minLineLength = Math.floor(canvas.width * 0.3);
        
        for (let y = 1; y < canvas.height - 1; y++) {
          let linePixels = 0;
          let consecutivePixels = 0;
          let maxConsecutive = 0;
          
          for (let x = 0; x < canvas.width; x++) {
            if (edgeMap[y * canvas.width + x] === 1) {
              linePixels++;
              consecutivePixels++;
              maxConsecutive = Math.max(maxConsecutive, consecutivePixels);
            } else {
              consecutivePixels = 0;
            }
          }
          
          if (linePixels >= minLineLength && maxConsecutive > 30) {
            const lastLine = rowLines[rowLines.length - 1];
            if (rowLines.length === 0 || y - lastLine > 25) {
              rowLines.push(y);
            }
          }
        }

        // Detect vertical lines
        const colLines: number[] = [];
        const minColLineLength = Math.floor(canvas.height * 0.3);
        
        for (let x = 1; x < canvas.width - 1; x++) {
          let linePixels = 0;
          let consecutivePixels = 0;
          let maxConsecutive = 0;
          
          for (let y = 0; y < canvas.height; y++) {
            if (edgeMap[y * canvas.width + x] === 1) {
              linePixels++;
              consecutivePixels++;
              maxConsecutive = Math.max(maxConsecutive, consecutivePixels);
            } else {
              consecutivePixels = 0;
            }
          }
          
          if (linePixels >= minColLineLength && maxConsecutive > 30) {
            const lastLine = colLines[colLines.length - 1];
            if (colLines.length === 0 || x - lastLine > 25) {
              colLines.push(x);
            }
          }
        }

        console.log(`Detected ${rowLines.length} row lines and ${colLines.length} column lines`);

        // Define table region and boundaries
        let tableRegion = null;
        let rowBoundaries: number[] = [];
        let colBoundaries: number[] = [];

        if (rowLines.length >= 2 && colLines.length >= 2) {
          // Sort lines
          rowLines.sort((a, b) => a - b);
          colLines.sort((a, b) => a - b);

          // Table region is from first to last line
          tableRegion = {
            x: colLines[0],
            y: rowLines[0],
            width: colLines[colLines.length - 1] - colLines[0],
            height: rowLines[rowLines.length - 1] - rowLines[0]
          };

          // Boundaries are the spaces between lines (cells)
          rowBoundaries = rowLines;
          colBoundaries = colLines;
        }

        resolve({ rowBoundaries, colBoundaries, tableRegion });
      };
      img.src = imageData;
    });
  };

  const enhanceCellImage = async (cellCanvas: HTMLCanvasElement, quality: { quality: 'high' | 'medium' | 'low', brightness: number, contrast: number }): Promise<HTMLCanvasElement> => {
    const ctx = cellCanvas.getContext('2d')!;
    const imageData = ctx.getImageData(0, 0, cellCanvas.width, cellCanvas.height);
    const data = imageData.data;

    if (quality.quality === 'low') {
      // Aggressive denoising and sharpening for low quality
      const tempData = new Uint8ClampedArray(data);
      
      // Apply median filter for noise reduction
      for (let y = 1; y < cellCanvas.height - 1; y++) {
        for (let x = 1; x < cellCanvas.width - 1; x++) {
          const neighbors: number[] = [];
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              const idx = ((y + dy) * cellCanvas.width + (x + dx)) * 4;
              neighbors.push((tempData[idx] + tempData[idx + 1] + tempData[idx + 2]) / 3);
            }
          }
          neighbors.sort((a, b) => a - b);
          const median = neighbors[4]; // Middle value
          
          const idx = (y * cellCanvas.width + x) * 4;
          // Enhance contrast on denoised image
          const enhanced = Math.min(255, Math.max(0, (median - 128) * 1.6 + 128));
          data[idx] = data[idx + 1] = data[idx + 2] = enhanced;
        }
      }
    } else if (quality.quality === 'medium') {
      // Moderate sharpening
      for (let i = 0; i < data.length; i += 4) {
        const gray = (data[i] + data[i + 1] + data[i + 2]) / 3;
        const enhanced = Math.min(255, Math.max(0, (gray - 128) * 1.3 + 128));
        data[i] = data[i + 1] = data[i + 2] = enhanced;
      }
    } else {
      // Minimal processing for high quality
      for (let i = 0; i < data.length; i += 4) {
        const gray = (data[i] + data[i + 1] + data[i + 2]) / 3;
        const enhanced = Math.min(255, Math.max(0, gray * 1.05));
        data[i] = data[i + 1] = data[i + 2] = enhanced;
      }
    }

    ctx.putImageData(imageData, 0, 0);
    return cellCanvas;
  };

  const maskOutsideTable = async (imageData: string, tableRegion: { x: number, y: number, width: number, height: number }): Promise<string> => {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d')!;
        canvas.width = img.width;
        canvas.height = img.height;
        
        // Fill entire canvas with white
        ctx.fillStyle = 'white';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        
        // Draw ONLY the table region
        ctx.drawImage(
          img,
          tableRegion.x, tableRegion.y, tableRegion.width, tableRegion.height,
          tableRegion.x, tableRegion.y, tableRegion.width, tableRegion.height
        );
        
        resolve(canvas.toDataURL('image/png', 1.0));
      };
      img.src = imageData;
    });
  };

  const cropToTableRegion = async (imageData: string, tableRegion: { x: number, y: number, width: number, height: number }): Promise<string> => {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d')!;
        
        // Set canvas to table region size only
        canvas.width = tableRegion.width;
        canvas.height = tableRegion.height;
        
        // Fill with white background
        ctx.fillStyle = 'white';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        
        // Draw only the table region
        ctx.drawImage(
          img,
          tableRegion.x, tableRegion.y, tableRegion.width, tableRegion.height,
          0, 0, tableRegion.width, tableRegion.height
        );
        
        resolve(canvas.toDataURL('image/png', 1.0));
      };
      img.src = imageData;
    });
  };

  const extractCellData = async (
    imageData: string,
    rowBoundaries: number[],
    colBoundaries: number[],
    worker: any,
    quality: { quality: 'high' | 'medium' | 'low', brightness: number, contrast: number },
    tableRegion: { x: number, y: number, width: number, height: number } | null
  ): Promise<string[][]> => {
    // CRITICAL: Mask out everything outside table region first
    let maskedImage = imageData;
    if (tableRegion) {
      console.log('Masking out all data outside table region...');
      maskedImage = await maskOutsideTable(imageData, tableRegion);
    }

    const img = new Image();
    await new Promise((resolve) => {
      img.onload = resolve;
      img.src = maskedImage;
    });

    const numRows = rowBoundaries.length - 1;
    const numCols = colBoundaries.length - 1;
    
    console.log(`Extracting ${numRows} rows x ${numCols} columns from masked image`);
    
    const tableData: string[][] = [];

    for (let r = 0; r < numRows; r++) {
      const row: string[] = [];
      const y1 = rowBoundaries[r];
      const y2 = rowBoundaries[r + 1];
      
      for (let c = 0; c < numCols; c++) {
        const x1 = colBoundaries[c];
        const x2 = colBoundaries[c + 1];
        
        // Cell is between the lines, add margin to avoid borders
        const margin = 5;
        const x = Math.max(0, x1 + margin);
        const y = Math.max(0, y1 + margin);
        const width = Math.max(10, (x2 - x1) - (margin * 2));
        const height = Math.max(10, (y2 - y1) - (margin * 2));

        if (width < 10 || height < 10) {
          row.push('');
          continue;
        }

        // Verify cell is within table region
        if (tableRegion) {
          if (x < tableRegion.x || x + width > tableRegion.x + tableRegion.width ||
              y < tableRegion.y || y + height > tableRegion.y + tableRegion.height) {
            console.log(`Skipping cell at row ${r}, col ${c} - outside table region`);
            row.push('');
            continue;
          }
        }

        // Extract cell from masked image
        const cellCanvas = document.createElement('canvas');
        const cellCtx = cellCanvas.getContext('2d')!;
        cellCanvas.width = width;
        cellCanvas.height = height;
        
        cellCtx.fillStyle = 'white';
        cellCtx.fillRect(0, 0, width, height);
        
        try {
          cellCtx.drawImage(img, x, y, width, height, 0, 0, width, height);
        } catch (e) {
          console.error(`Error drawing cell at row ${r}, col ${c}:`, e);
          row.push('');
          continue;
        }

        // Apply adaptive enhancement
        const enhancedCell = await enhanceCellImage(cellCanvas, quality);

        // Add padding
        const paddedCanvas = document.createElement('canvas');
        const paddedCtx = paddedCanvas.getContext('2d')!;
        const padding = 20;
        paddedCanvas.width = width + padding * 2;
        paddedCanvas.height = height + padding * 2;
        paddedCtx.fillStyle = 'white';
        paddedCtx.fillRect(0, 0, paddedCanvas.width, paddedCanvas.height);
        paddedCtx.drawImage(enhancedCell, padding, padding);

        const cellImageDataUrl = paddedCanvas.toDataURL('image/png', 1.0);

        try {
          const ocrConfig: any = {
            tessedit_pageseg_mode: '6',
            preserve_interword_spaces: '1',
          };

          const { data } = await worker.recognize(cellImageDataUrl, ocrConfig);
          let cellText = data.text.trim();
          
          // Clean up OCR errors
          cellText = cellText
            .replace(/\s+/g, ' ')
            .replace(/\n/g, ' ')
            .replace(/[|]/g, 'I')
            .replace(/[`´']/g, "'")
            .replace(/[""]/g, '"')
            .replace(/[—–]/g, '-')
            .replace(/[…]/g, '...')
            .trim();
          
          row.push(cellText);
        } catch (error) {
          console.error(`Cell OCR error at row ${r}, col ${c}:`, error);
          row.push('');
        }
      }
      
      tableData.push(row);
    }

    console.log(`Extracted ${tableData.length} rows with data`);
    return tableData;
  };

  const findHeaderRowAndClean = (tableData: string[][]): string[][] => {
    if (tableData.length === 0) return tableData;

    // Keywords that indicate a header row
    const headerKeywords = [
      'sr. no', 'sr.no', 'sr no', 'serial', 's.no', 's. no',
      'category', 'reference', 'clarification', 'query', 'response',
      'rfp', 'document', 'page', 'section'
    ];

    // Find the first row that contains header keywords
    let headerRowIndex = -1;
    
    for (let i = 0; i < tableData.length; i++) {
      const row = tableData[i];
      const rowText = row.join(' ').toLowerCase();
      
      // Check if this row contains any header keywords
      const hasHeaderKeyword = headerKeywords.some(keyword => 
        rowText.includes(keyword)
      );
      
      // Also check if first cell looks like "Sr. No" or similar
      const firstCell = row[0]?.toLowerCase().trim() || '';
      const isSerialNumberHeader = 
        firstCell.includes('sr') || 
        firstCell.includes('s.') ||
        firstCell.includes('serial') ||
        firstCell === 'no' ||
        firstCell === 'no.';
      
      if (hasHeaderKeyword || isSerialNumberHeader) {
        headerRowIndex = i;
        console.log(`Found header row at index ${i}:`, row);
        break;
      }
    }

    // If header row found, remove all rows before it
    if (headerRowIndex > 0) {
      console.log(`Removing ${headerRowIndex} rows before header row`);
      return tableData.slice(headerRowIndex);
    }

    // If no header found, return original data
    console.log('No header row detected, keeping all rows');
    return tableData;
  };

  const mergeMultiPageTables = (results: PageResult[]): { mergedResults: PageResult[], allPages: PageResult[] } => {
    if (results.length <= 1) return { mergedResults: results, allPages: results };

    console.log('Checking for multi-page tables to merge...');
    const merged: PageResult[] = [];
    let i = 0;

    while (i < results.length) {
      const current = results[i];
      
      // If not a table, just add it
      if (!current.tableData.isTable || !current.tableData.rows) {
        merged.push(current);
        i++;
        continue;
      }

      // Start a potential merge group
      const currentRows = current.tableData.rows;
      const currentCols = currentRows[0]?.length || 0;
      let mergedRows = [...currentRows];
      let lastPageInGroup = i;

      // Check subsequent pages for matching table structure
      for (let j = i + 1; j < results.length; j++) {
        const next = results[j];
        
        if (!next.tableData.isTable || !next.tableData.rows) break;
        
        const nextRows = next.tableData.rows;
        const nextCols = nextRows[0]?.length || 0;

        // Check if columns match
        if (nextCols === currentCols) {
          console.log(`Page ${next.pageNumber} has matching structure (${nextCols} cols), merging...`);
          
          // Skip header row on continuation pages (first row is usually header)
          const dataRows = nextRows.slice(1);
          mergedRows = [...mergedRows, ...dataRows];
          lastPageInGroup = j;
        } else {
          console.log(`Page ${next.pageNumber} has different structure (${nextCols} vs ${currentCols} cols), stopping merge`);
          break;
        }
      }

      // Create merged result
      if (lastPageInGroup > i) {
        console.log(`Merged pages ${i + 1} to ${lastPageInGroup + 1} into single table with ${mergedRows.length} rows`);
        merged.push({
          ...current,
          tableData: {
            ...current.tableData,
            rows: mergedRows,
            pageNumber: current.pageNumber
          }
        });
      } else {
        merged.push(current);
      }

      i = lastPageInGroup + 1;
    }

    console.log(`Merge complete: ${results.length} pages -> ${merged.length} results`);
    // Return both merged results and all original pages
    return { mergedResults: merged, allPages: results };
  };

  const processImage = async (imageData: string, pageNum: number, worker: any): Promise<PageResult> => {
    try {
      console.log(`Processing page ${pageNum}...`);
      
      // Step 0: Upscale image for better OCR accuracy
      console.log(`Upscaling page ${pageNum} for better OCR...`);
      const upscaled = await upscaleImage(imageData, 2);
      
      // Step 1: Detect if rotation is needed
      const detectedRotation = await detectRotation(upscaled);
      
      // Step 2: Apply rotation if detected
      let correctedImage = upscaled;
      let totalRotation = 0;
      
      if (detectedRotation !== 0) {
        console.log(`Applying detected rotation of ${detectedRotation} degrees`);
        correctedImage = await rotateImage(upscaled, detectedRotation);
        totalRotation = detectedRotation;
      } else {
        console.log(`No rotation needed for page ${pageNum}`);
      }

      // Step 3: Analyze image quality
      const quality = await analyzeImageQuality(correctedImage);
      console.log(`Page ${pageNum} quality:`, quality);

      // Step 4: Apply adaptive enhancement
      const enhanced = await enhanceImageAdaptive(correctedImage, quality);

      // Step 5: Detect table structure
      const { rowBoundaries, colBoundaries, tableRegion } = await detectTableStructure(enhanced);
      const numRows = rowBoundaries.length > 0 ? rowBoundaries.length - 1 : 0;
      const numCols = colBoundaries.length > 0 ? colBoundaries.length - 1 : 0;
      console.log(`Page ${pageNum} - Detected ${numRows} rows x ${numCols} columns`);
      if (tableRegion) {
        console.log(`Table region: x=${tableRegion.x}, y=${tableRegion.y}, w=${tableRegion.width}, h=${tableRegion.height}`);
      }

      // Gentle preprocessing for display
      let processed = await preprocessImage(correctedImage);

      let tableData: TableData;

      if (rowBoundaries.length >= 2 && colBoundaries.length >= 2 && tableRegion) {
        // Mask out everything outside table first
        console.log(`Masking page ${pageNum} - keeping only table region...`);
        const maskedImage = await maskOutsideTable(enhanced, tableRegion);
        
        // Extract cells from masked image
        console.log(`Extracting table data from page ${pageNum}...`);
        const tableRows = await extractCellData(maskedImage, rowBoundaries, colBoundaries, worker, quality, tableRegion);
        
        // Find header row (Sr. No) and remove all rows before it
        let cleanedTableRows = findHeaderRowAndClean(tableRows);
        console.log(`After cleaning: Table has ${cleanedTableRows.length} rows (including header)`);
        
        tableData = { isTable: true, rows: cleanedTableRows, pageNumber: pageNum };
        
        // Show cropped table as processed image
        const croppedTable = await cropToTableRegion(maskedImage, tableRegion);
        processed = croppedTable;
      } else {
        // Fallback: OCR entire image with best settings
        console.log(`No table detected on page ${pageNum}, using full page OCR...`);
        const ocrConfig: any = {
          tessedit_pageseg_mode: '1', // Auto with OSD
          tessedit_ocr_engine_mode: '1', // LSTM only
          preserve_interword_spaces: '1',
        };

        const { data } = await worker.recognize(enhanced, ocrConfig);
        let text = data.text;
        
        // Clean up text
        text = text
          .replace(/[|]/g, 'I')
          .replace(/[`´']/g, "'")
          .replace(/[""]/g, '"')
          .trim();
        
        tableData = { isTable: false, text, pageNumber: pageNum };
      }

      return {
        pageNumber: pageNum,
        originalImage: correctedImage,
        processedImage: processed,
        tableData,
        rotationApplied: totalRotation
      };
    } catch (error) {
      console.error(`Error processing page ${pageNum}:`, error);
      throw error;
    }
  };

  const processImageWithStructure = async (
    imageData: string, 
    pageNum: number, 
    worker: any,
    structure: { rowBoundaries: number[], colBoundaries: number[], tableRegion: any }
  ): Promise<PageResult> => {
    try {
      console.log(`Processing page ${pageNum} with predefined structure...`);
      
      const upscaled = await upscaleImage(imageData, 2);
      const detectedRotation = await detectRotation(upscaled);
      
      let correctedImage = upscaled;
      let totalRotation = 0;
      
      if (detectedRotation !== 0) {
        console.log(`Applying detected rotation of ${detectedRotation} degrees`);
        correctedImage = await rotateImage(upscaled, detectedRotation);
        totalRotation = detectedRotation;
      }

      const quality = await analyzeImageQuality(correctedImage);
      const enhanced = await enhanceImageAdaptive(correctedImage, quality);

      // Use the provided structure instead of detecting
      const { rowBoundaries, colBoundaries, tableRegion } = structure;
      const numRows = rowBoundaries.length - 1;
      const numCols = colBoundaries.length - 1;
      console.log(`Page ${pageNum} - Using structure: ${numRows} rows x ${numCols} columns`);

      let processed = await preprocessImage(correctedImage);

      // Mask out everything outside table
      const maskedImage = await maskOutsideTable(enhanced, tableRegion);
      
      // Extract cells using predefined structure
      const tableRows = await extractCellData(maskedImage, rowBoundaries, colBoundaries, worker, quality, tableRegion);
      
      // For continuation pages, skip header detection - just use all rows
      console.log(`Page ${pageNum}: Extracted ${tableRows.length} rows`);
      
      const tableData: TableData = { isTable: true, rows: tableRows, pageNumber: pageNum };
      
      const croppedTable = await cropToTableRegion(maskedImage, tableRegion);
      processed = croppedTable;

      return {
        pageNumber: pageNum,
        originalImage: correctedImage,
        processedImage: processed,
        tableData,
        rotationApplied: totalRotation
      };
    } catch (error) {
      console.error(`Error processing page ${pageNum} with structure:`, error);
      throw error;
    }
  };

  const convertPdfPageToImage = async (page: any, scale: number = 4): Promise<string> => {
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d')!;
    canvas.width = viewport.width;
    canvas.height = viewport.height;

    await page.render({
      canvasContext: context,
      viewport: viewport
    }).promise;

    return canvas.toDataURL('image/png', 1.0);
  };

  const processPDF = async (file: File) => {
    try {
      const pdfjsLib = await import('pdfjs-dist');
      const arrayBuffer = await file.arrayBuffer();
      const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
      const pdf = await loadingTask.promise;
      const numPages = pdf.numPages;
      setTotalPages(numPages);

      // Initialize worker with best settings
      const worker = await createWorker('eng', 1, {
        langPath: 'https://tessdata.projectnaptha.com/4.0.0',
        logger: (m) => console.log(m),
      });
      
      // Configure for best accuracy
      await worker.setParameters({
        preserve_interword_spaces: '1',
      });

      const results: PageResult[] = [];
      let firstPageStructure: { rowBoundaries: number[], colBoundaries: number[], tableRegion: any } | null = null;

      for (let pageNum = 1; pageNum <= numPages; pageNum++) {
        setCurrentPage(pageNum);
        setProgress(Math.round((pageNum / numPages) * 100));

        const page = await pdf.getPage(pageNum);
        const imageData = await convertPdfPageToImage(page);
        
        // For first page, detect structure normally
        if (pageNum === 1) {
          const result = await processImage(imageData, pageNum, worker);
          results.push(result);
          
          // Save first page structure if it's a table
          if (result.tableData.isTable && result.tableData.rows) {
            const upscaled = await upscaleImage(imageData, 2);
            const enhanced = await enhanceImageAdaptive(upscaled, await analyzeImageQuality(upscaled));
            firstPageStructure = await detectTableStructure(enhanced);
            console.log(`First page structure saved: ${firstPageStructure.rowBoundaries.length - 1} rows x ${firstPageStructure.colBoundaries.length - 1} cols`);
          }
        } else {
          // For subsequent pages, use first page's structure if available
          if (firstPageStructure && firstPageStructure.rowBoundaries.length >= 2 && firstPageStructure.colBoundaries.length >= 2) {
            console.log(`Page ${pageNum}: Using first page's table structure`);
            const result = await processImageWithStructure(imageData, pageNum, worker, firstPageStructure);
            results.push(result);
          } else {
            const result = await processImage(imageData, pageNum, worker);
            results.push(result);
          }
        }
      }

      await worker.terminate();
      
      // Merge multi-page tables with same structure
      const { mergedResults, allPages } = mergeMultiPageTables(results);
      
      return { mergedResults, allPages };
    } catch (err) {
      console.error('PDF Processing Error:', err);
      throw new Error(`Failed to process PDF: ${err}`);
    }
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    const droppedFile = e.dataTransfer.files?.[0];
    if (droppedFile) {
      await processFile(droppedFile);
    }
  };

  const processFile = async (uploadedFile: File) => {

    if (!pdfWorkerReady && uploadedFile.type === 'application/pdf') {
      setError('PDF worker is still loading. Please wait a moment and try again.');
      return;
    }

    setFile(uploadedFile);
    setCurrentPageView(0);
    setPageResults([]);
    setLoading(true);
    setProgress(0);
    setCurrentPage(0);
    setTotalPages(0);
    setError('');

    try {
      const fileType = uploadedFile.type;

      if (fileType === 'application/pdf') {
      const { mergedResults, allPages } = await processPDF(uploadedFile);
        setPageResults(mergedResults);
        setAllPages(allPages);
        // await indexExtractedResults(results); // Disabled - feature not implemented
        setLoading(false);
        // Process as image
        setTotalPages(1);
        const reader = new FileReader();
        reader.onload = async (event) => {
          try {
            const imageData = event.target?.result as string;
            const worker = await createWorker('eng', 1, {
              langPath: 'https://tessdata.projectnaptha.com/4.0.0',
              logger: (m) => {
                if (m.status === 'recognizing text') {
                  setProgress(Math.round(m.progress * 100));
                }
              },
            });
            
            // Configure for best accuracy
            await worker.setParameters({
              preserve_interword_spaces: '1',
            });

            const result = await processImage(imageData, 1, worker);
            setPageResults([result]);
            await worker.terminate();
            setLoading(false);
          } catch (err) {
            console.error('Image Processing Error:', err);
            setError(`Failed to process image: ${err}`);
            setLoading(false);
          }
        };
        reader.onerror = () => {
          setError('Failed to read file');
          setLoading(false);
        };
        reader.readAsDataURL(uploadedFile);
      }
    } catch (error) {
      console.error('Processing Error:', error);
      setError(`Error processing file: ${error}`);
      setLoading(false);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const uploadedFile = e.target.files?.[0];
    if (!uploadedFile) return;
    setCurrentFileName(uploadedFile.name);
    await processFile(uploadedFile);
  };

  const goToNextPage = () => {
    if (currentPageView < pageResults.length - 1) {
      setCurrentPageView(currentPageView + 1);
      // Smooth scroll to top
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  const goToPreviousPage = () => {
    if (currentPageView > 0) {
      setCurrentPageView(currentPageView - 1);
      // Smooth scroll to top
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Loading Indicator */}
      {(isRotating || isAiCorrecting) && (
        <div className="fixed inset-0 bg-black/30 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-2xl p-6 flex items-center gap-4 border border-gray-200">
            <div className="relative w-12 h-12 flex-shrink-0">
              <div className="absolute inset-0 border-4 border-blue-600 rounded-full border-t-transparent animate-spin"></div>
              <svg className="absolute inset-0 m-auto w-6 h-6 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                {isAiCorrecting ? (
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                ) : (
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                )}
              </svg>
            </div>
            <div>
              <p className="text-base font-semibold text-gray-900">
                {isAiCorrecting ? 'AI Processing' : 'Processing'}
              </p>
              <p className="text-sm text-gray-600">
                {isAiCorrecting ? 'Correcting OCR errors...' : 'Rotating & extracting...'}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <header className="bg-white border-b border-gray-200 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 md:px-8 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-blue-600 rounded-lg flex items-center justify-center">
                <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
              </div>
              <div>
                <h1 className="text-xl font-semibold text-gray-900">Document OCR</h1>
                <p className="text-xs text-gray-500">Extract tables and text from documents</p>
              </div>
            </div>
            {pageResults.length > 0 && (
              <div className="flex items-center gap-2 px-3 py-1.5 bg-green-50 border border-green-200 rounded-md">
                <svg className="w-4 h-4 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span className="text-sm font-medium text-green-700">{pageResults.length} page{pageResults.length > 1 ? 's' : ''}</span>
              </div>
            )}
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 md:px-8 py-6">

        {/* Upload Section */}
        {pageResults.length === 0 && (
          <div className="max-w-3xl mx-auto">
            <div className="bg-white rounded-lg shadow-sm border border-gray-200">
              <div className="p-6">
                <div
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop}
                  className={`relative transition-all duration-200 ${
                    isDragging 
                      ? 'border-2 border-blue-600 bg-blue-50' 
                      : 'border-2 border-dashed border-gray-300 hover:border-gray-400 hover:bg-gray-50'
                  } rounded-lg p-16`}
                >
                  <input
                    type="file"
                    accept="image/*,application/pdf"
                    onChange={handleFileUpload}
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                    id="file-upload"
                  />
                  <label htmlFor="file-upload" className="cursor-pointer">
                    <div className="flex flex-col items-center justify-center gap-4">
                      <div className={`w-16 h-16 rounded-lg flex items-center justify-center transition-colors ${
                        isDragging ? 'bg-blue-600' : 'bg-gray-100'
                      }`}>
                        <svg className={`w-8 h-8 transition-colors ${
                          isDragging ? 'text-white' : 'text-gray-600'
                        }`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                        </svg>
                      </div>
                      <div className="text-center">
                        <p className="text-lg font-medium text-gray-900 mb-1">
                          {isDragging ? 'Drop your file here' : 'Upload a document'}
                        </p>
                        <p className="text-sm text-gray-500">
                          Drag and drop or click to browse
                        </p>
                        <p className="text-xs text-gray-400 mt-2">
                          Supports PDF, PNG, JPG • Max 50MB
                        </p>
                      </div>
                    </div>
                  </label>
                </div>

                {loading && (
                  <div className="mt-6 bg-blue-50 rounded-lg p-4 border border-blue-200">
                    <div className="flex items-center justify-between mb-3">
                      <span className="text-sm font-medium text-gray-900">
                        {totalPages > 0 
                          ? `Processing page ${currentPage} of ${totalPages}` 
                          : 'Processing document...'}
                      </span>
                      <span className="text-sm font-semibold text-blue-600">
                        {progress}%
                      </span>
                    </div>
                    <div className="w-full bg-blue-200 rounded-full h-2 overflow-hidden">
                      <div
                        className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                        style={{ width: `${progress}%` }}
                      ></div>
                    </div>
                  </div>
                )}

                {error && (
                  <div className="mt-6 p-4 bg-red-50 border border-red-200 rounded-lg">
                    <div className="flex items-start gap-3">
                      <svg className="w-5 h-5 text-red-600 mt-0.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                      </svg>
                      <p className="text-sm text-red-800">{error}</p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Action Bar */}
        {pageResults.length > 0 && (
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 mb-6">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-2">
                <svg className="w-5 h-5 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span className="text-sm font-medium text-gray-700">
                  Extraction complete
                </span>
              </div>
              <div className="flex flex-wrap gap-2">
                {pageResults.some(r => r.tableData.isTable) && (
                  <>
                    <button
                      onClick={() => setShowMapping(!showMapping)}
                      className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 transition-colors"
                    >
                      {showMapping ? 'Hide Mapping' : 'Map Columns'}
                    </button>
                    <button
                      onClick={exportAllToCSV}
                      className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 transition-colors"
                    >
                      Export CSV
                    </button>
                    <button
                      onClick={applyAICorrection}
                      disabled={isAiCorrecting}
                      className={`px-4 py-2 text-sm font-medium text-white rounded-md transition-colors ${
                        isAiCorrecting 
                          ? 'bg-gray-400 cursor-not-allowed' 
                          : 'bg-orange-600 hover:bg-orange-700'
                      }`}
                    >
                      {isAiCorrecting ? 'Correcting...' : 'AI Correction'}
                    </button>
                    <button
                      onClick={saveToDatabase}
                      disabled={isSavingToDb}
                      className={`px-4 py-2 text-sm font-medium text-white rounded-md transition-colors ${
                        isSavingToDb 
                          ? 'bg-gray-400 cursor-not-allowed' 
                          : 'bg-purple-600 hover:bg-purple-700'
                      }`}
                    >
                      {isSavingToDb ? 'Saving...' : 'Save to DB'}
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Chat feature disabled - component not implemented
        {pageResults.length > 0 && (
          <div className="mt-8">
            <h2 className="text-2xl font-bold mb-4">Ask about this document</h2>
            <ChatWithDocument />
          </div>
        )}
        */}

        {showMapping && pageResults.length > 0 && pageResults.some(r => r.tableData.isTable && r.tableData.rows) && (
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 mb-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Column Mapping</h3>
            
            <div className="mb-6 bg-gray-50 rounded-lg p-4 border border-gray-200">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {predefinedColumns.map((predefinedCol) => {
                  const firstTable = pageResults.find(r => r.tableData.isTable && r.tableData.rows);
                  if (!firstTable) return null;
                  const pageIndex = pageResults.indexOf(firstTable);
                  const tableRows = editedData[pageIndex] || firstTable.tableData.rows;
                  const extractedHeaders = tableRows?.[0] || [];
                  return (
                    <div key={predefinedCol} className="flex flex-col gap-2">
                      <label className="text-xs font-medium text-gray-700 uppercase">
                        {predefinedCol}
                      </label>
                      <select
                        value={columnMapping[predefinedCol] || ''}
                        onChange={(e) => handleColumnMapping(predefinedCol, e.target.value)}
                        className="px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm text-gray-900 bg-white"
                      >
                        <option value="">-- Select Column --</option>
                        {extractedHeaders.map((col, idx) => (
                          <option key={idx} value={col}>
                            {col || `Column ${idx + 1}`}
                          </option>
                        ))}
                      </select>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="flex flex-wrap gap-3">
              {mappedData && (
                <button
                  onClick={() => saveMappedDataToDatabase(false)}
                  className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 transition-colors"
                >
                  Save
                </button>
              )}
              {mappedData && (
                <button
                  onClick={exportMappedData}
                  className="px-4 py-2 text-sm font-medium text-white bg-green-600 rounded-md hover:bg-green-700 transition-colors"
                >
                  Download Mapped Data
                </button>
              )}
            </div>

            {mappedData && (
              <div className="mt-6 bg-gray-50 rounded-lg p-4 border border-gray-200">
                <div className="flex items-center justify-between mb-3">
                  <h4 className="text-sm font-semibold text-gray-900">
                    Mapped Data Preview
                  </h4>
                  <span className="text-xs text-gray-600">
                    {mappedData.length - 1} rows × {mappedData[0].length} columns
                  </span>
                </div>
                <div className="bg-white rounded-md border border-gray-200 overflow-auto max-h-96">
                  <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                      <tr>
                        {mappedData[0].map((header, idx) => (
                          <th
                            key={idx}
                            className="px-4 py-3 text-left text-xs font-medium text-gray-700 uppercase tracking-wider"
                          >
                            {header}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                      {mappedData.slice(1).map((row, rowIndex) => (
                        <tr key={rowIndex} className="hover:bg-gray-50">
                          {row.map((cell, cellIndex) => (
                            <td
                              key={cellIndex}
                              className="px-4 py-3 text-sm text-gray-900 whitespace-nowrap"
                            >
                              {cell || '-'}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Two column layout: Images on left, Table on right */}
        {pageResults.length > 0 && allPages.length > 0 && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            
            {/* LEFT SIDE: All page images stacked */}
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
              <div className="flex items-center justify-between mb-6 pb-4 border-b border-gray-200">
                <div>
                  <h2 className="text-lg font-semibold text-gray-900">
                    {allPages.length === 1 ? 'Document Image' : `All Pages (${allPages.length} pages)`}
                  </h2>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      rotatePageManually(0, -90);
                    }}
                    disabled={loading}
                    className={`flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-md transition-colors ${
                      loading 
                        ? 'bg-gray-100 text-gray-400 cursor-not-allowed' 
                        : 'bg-purple-600 text-white hover:bg-purple-700'
                    }`}
                    title="Rotate all pages 90° counter-clockwise"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" style={{ transform: 'scaleX(-1)' }}>
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                    Left
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      rotatePageManually(0, 90);
                    }}
                    disabled={loading}
                    className={`flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-md transition-colors ${
                      loading 
                        ? 'bg-gray-100 text-gray-400 cursor-not-allowed' 
                        : 'bg-blue-600 text-white hover:bg-blue-700'
                    }`}
                    title="Rotate all pages 90° clockwise"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                    Right
                  </button>
                </div>
              </div>

              {/* Display all page images stacked */}
              <div className="space-y-6 max-h-[800px] overflow-y-auto">
                {allPages.map((result, idx) => (
                  <div key={idx} className="border-b border-gray-200 pb-6 last:border-b-0 last:pb-0">
                    <h3 className="text-sm font-medium text-gray-700 mb-3">
                      Page {result.pageNumber}
                      {result.rotationApplied !== undefined && result.rotationApplied !== 0 && (
                        <span className="ml-2 text-xs text-green-600">
                          (Rotated {result.rotationApplied}°)
                        </span>
                      )}
                    </h3>
                    <img
                      src={result.processedImage}
                      alt={`Page ${result.pageNumber} processed`}
                      className="w-full border border-gray-300 rounded"
                    />
                  </div>
                ))}
              </div>
            </div>

            {/* RIGHT SIDE: One merged table with all data */}
            {pageResults[0].tableData.isTable && pageResults[0].tableData.rows && (
              <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-semibold text-gray-900">
                    Extracted Table ({pageResults[0].tableData.rows.length - 1} rows)
                  </h3>
                  <button
                    onClick={() => setEditMode(!editMode)}
                    className="px-3 py-1.5 text-sm font-medium text-blue-600 hover:text-blue-700 border border-blue-600 rounded-md hover:bg-blue-50 transition-colors"
                  >
                    {editMode ? 'Done Editing' : 'Edit Table'}
                  </button>
                </div>
                
                <div className="overflow-auto max-h-[800px]">
                  <table className="min-w-full divide-y divide-gray-200 border border-gray-300">
                    <thead className="bg-gray-50 sticky top-0">
                      <tr>
                        {pageResults[0].tableData.rows[0].map((header, colIdx) => (
                          <th
                            key={colIdx}
                            className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider border-r border-gray-300 last:border-r-0"
                          >
                            {header}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                      {(editedData[0] || pageResults[0].tableData.rows).slice(1).map((row, rowIdx) => (
                        <tr key={rowIdx} className="hover:bg-gray-50">
                          {row.map((cell, colIdx) => (
                            <td
                              key={colIdx}
                              className="px-4 py-3 text-sm text-gray-900 border-r border-gray-300 last:border-r-0"
                            >
                              {editMode ? (
                                <input
                                  type="text"
                                  value={cell}
                                  onChange={(e) => handleCellEdit(0, rowIdx + 1, colIdx, e.target.value)}
                                  className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                                />
                              ) : (
                                cell
                              )}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}

      </div>
    </div>
  );
}


