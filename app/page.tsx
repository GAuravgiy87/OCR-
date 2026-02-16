'use client';

import { useState, useEffect } from 'react';
import { createWorker } from 'tesseract.js';
import * as pdfjsLib from 'pdfjs-dist';
import { indexExtractedResults } from '../lib/indexing';
import ChatWithDocument from '../components/ChatWithDocument';

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
    const result = pageResults[pageIndex];
    if (!result) return;
    
    // Prevent multiple simultaneous rotations
    if (isRotating) {
      console.log('Rotation already in progress, ignoring click');
      return;
    }

    try {
      setIsRotating(true);
      console.log(`Rotating page ${result.pageNumber} by ${angle} degrees...`);
      
      const currentRotation = manualRotation[pageIndex] || 0;
      const newRotation = (currentRotation + angle) % 360;
      
      setManualRotation(prev => ({ ...prev, [pageIndex]: newRotation }));

      // Step 1: Rotate the original image FIRST and show it immediately
      const rotated = await rotateImage(result.originalImage, angle);
      
      // Update the display immediately with rotated image
      const updatedResultsTemp = [...pageResults];
      updatedResultsTemp[pageIndex] = {
        ...result,
        originalImage: rotated,
        rotationApplied: (result.rotationApplied || 0) + angle
      };
      setPageResults(updatedResultsTemp);
      
      console.log('Image rotated, now reprocessing table data...');

      // Step 2: Now show loading and reprocess the table data
      setLoading(true);
      setProgress(0);

      // Create a temporary worker for reprocessing
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

      // Process the rotated image
      const quality = await analyzeImageQuality(rotated);
      const enhanced = await enhanceImageAdaptive(rotated, quality);
      const { rowBoundaries, colBoundaries, tableRegion } = await detectTableStructure(enhanced);
      
      let newTableData: TableData;
      let newProcessedImage = rotated;

      if (rowBoundaries.length >= 2 && colBoundaries.length >= 2 && tableRegion) {
        const maskedImage = await maskOutsideTable(enhanced, tableRegion);
        const tableRows = await extractCellData(maskedImage, rowBoundaries, colBoundaries, worker, quality, tableRegion);
        const cleanedTableRows = findHeaderRowAndClean(tableRows);
        
        newTableData = { isTable: true, rows: cleanedTableRows, pageNumber: result.pageNumber };
        newProcessedImage = await cropToTableRegion(maskedImage, tableRegion);
        
        console.log(`Table reprocessed: ${cleanedTableRows.length} rows extracted`);
      } else {
        // Fallback to full page OCR
        console.log('No table detected, using full page OCR');
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
        
        newTableData = { isTable: false, text, pageNumber: result.pageNumber };
      }

      await worker.terminate();

      // Step 3: Update with new table data
      const updatedResults = [...pageResults];
      updatedResults[pageIndex] = {
        ...result,
        originalImage: rotated,
        processedImage: newProcessedImage,
        tableData: newTableData,
        rotationApplied: (result.rotationApplied || 0) + angle
      };
      setPageResults(updatedResults);

      // Clear edited data for this page since we have new data
      setEditedData(prev => {
        const newData = { ...prev };
        delete newData[pageIndex];
        return newData;
      });

      console.log(`Page ${result.pageNumber} rotation complete!`);
      setLoading(false);
      setProgress(0);
      setIsRotating(false);
    } catch (error) {
      console.error('Error during manual rotation:', error);
      setError(`Failed to reprocess rotated image: ${error}`);
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
    // Initialize PDF.js worker
    if (typeof window !== 'undefined') {
      try {
        pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';
        setPdfWorkerReady(true);
      } catch (err) {
        console.error('Failed to set PDF worker:', err);
        // Fallback to CDN
        pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.js`;
        setPdfWorkerReady(true);
      }
    }
  }, []);

  const detectRotation = async (imageData: string): Promise<number> => {
    try {
      // Create a temporary worker just for rotation detection
      const tempWorker = await createWorker('eng', 1);
      
      // Use OSD (Orientation and Script Detection)
      const { data } = await tempWorker.detect(imageData);
      await tempWorker.terminate();
      
      // Tesseract returns rotation in degrees
      let rotation = 0;
      if (data.orientation_degrees) {
        rotation = data.orientation_degrees;
      }
      
      // Normalize to 0, 90, 180, 270
      rotation = Math.round(rotation / 90) * 90;
      rotation = ((rotation % 360) + 360) % 360;
      
      console.log('Detected rotation:', rotation, 'degrees');
      return rotation;
    } catch (error) {
      console.error('Rotation detection failed, trying alternative method:', error);
      
      // Fallback: Try to detect based on aspect ratio and text direction
      return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
          // If image is significantly wider than tall, might be rotated
          const aspectRatio = img.width / img.height;
          
          // Most documents are portrait (taller than wide)
          // If aspect ratio > 1.5, likely rotated 90 or 270 degrees
          if (aspectRatio > 1.5) {
            console.log('Image appears rotated based on aspect ratio');
            resolve(90); // Try 90 degree rotation
          } else {
            resolve(0);
          }
        };
        img.src = imageData;
      });
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
        const cleanedTableRows = findHeaderRowAndClean(tableRows);
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

      for (let pageNum = 1; pageNum <= numPages; pageNum++) {
        setCurrentPage(pageNum);
        setProgress(Math.round((pageNum / numPages) * 100));

        const page = await pdf.getPage(pageNum);
        const imageData = await convertPdfPageToImage(page);
        const result = await processImage(imageData, pageNum, worker);
        results.push(result);
      }

      await worker.terminate();
      return results;
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
      const results = await processPDF(uploadedFile);
        setPageResults(results);
        await indexExtractedResults(results); // add this line
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
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-100 p-4 md:p-8">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="text-center mb-10">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-2xl mb-4 shadow-lg">
            <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          </div>
          <h1 className="text-4xl md:text-5xl font-bold bg-gradient-to-r from-indigo-600 to-purple-600 bg-clip-text text-transparent mb-2">
            Advanced Table OCR Extractor
          </h1>
          <p className="text-gray-600 text-lg">Extract and analyze tables from images and PDFs with AI precision</p>
        </div>

        {/* Upload Section - Hide when results are available */}
        {pageResults.length === 0 && (
          <div className="bg-white rounded-2xl shadow-xl p-6 md:p-8 mb-8 border border-gray-100 hover:shadow-2xl transition-shadow duration-300">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 bg-indigo-100 rounded-lg flex items-center justify-center">
                <svg className="w-5 h-5 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                </svg>
              </div>
              <div>
                <span className="text-lg font-semibold text-gray-800 block">
                  Upload Your Document
                </span>
                <span className="text-sm text-gray-500">Drag & drop or click to upload • Supports images (PNG, JPG) and PDF files</span>
              </div>
            </div>
            
            <div
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              className={`relative transition-all duration-300 ${
                isDragging 
                  ? 'border-4 border-indigo-500 bg-indigo-50 scale-[1.02]' 
                  : 'border-2 border-dashed border-gray-300 hover:border-indigo-400'
              } rounded-xl p-8`}
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
                  <div className={`w-16 h-16 rounded-2xl flex items-center justify-center transition-all duration-300 ${
                    isDragging 
                      ? 'bg-indigo-600 scale-110' 
                      : 'bg-gradient-to-br from-indigo-500 to-purple-600'
                  }`}>
                    <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                    </svg>
                  </div>
                  <div className="text-center">
                    <p className="text-lg font-semibold text-gray-700 mb-1">
                      {isDragging ? 'Drop your file here' : 'Drag & drop your file here'}
                    </p>
                    <p className="text-sm text-gray-500">
                      or <span className="text-indigo-600 font-semibold">browse</span> to choose a file
                    </p>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-gray-400">
                    <span className="px-3 py-1 bg-gray-100 rounded-full">PNG</span>
                    <span className="px-3 py-1 bg-gray-100 rounded-full">JPG</span>
                    <span className="px-3 py-1 bg-gray-100 rounded-full">PDF</span>
                  </div>
                </div>
              </label>
            </div>

            {loading && (
              <div className="mt-6 bg-gradient-to-r from-indigo-50 to-purple-50 rounded-xl p-5 border border-indigo-100">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 bg-indigo-600 rounded-full animate-pulse"></div>
                    <span className="text-sm font-semibold text-indigo-900">
                      {totalPages > 0 
                        ? `Processing page ${currentPage} of ${totalPages}` 
                        : 'Processing your document'}
                    </span>
                  </div>
                  <span className="text-sm font-bold text-indigo-700 bg-white px-3 py-1 rounded-full">
                    {progress}%
                  </span>
                </div>
                <div className="w-full bg-indigo-200 rounded-full h-3 overflow-hidden shadow-inner">
                  <div
                    className="bg-gradient-to-r from-indigo-500 to-purple-600 h-3 rounded-full transition-all duration-500 ease-out shadow-lg"
                    style={{ width: `${progress}%` }}
                  ></div>
                </div>
              </div>
            )}

            {error && (
              <div className="mt-6 p-4 bg-red-50 border-l-4 border-red-500 rounded-lg shadow-sm">
                <div className="flex items-start gap-3">
                  <svg className="w-5 h-5 text-red-500 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                  </svg>
                  <p className="text-sm text-red-800 font-medium">{error}</p>
                </div>
              </div>
            )}
          </div>
        )}

        {pageResults.length > 0 && (
          <div className="bg-gradient-to-r from-green-50 to-emerald-50 rounded-2xl shadow-lg p-6 mb-8 border border-green-200">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 bg-green-500 rounded-xl flex items-center justify-center shadow-md">
                  <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <div>
                  <h2 className="text-xl font-bold text-gray-800">
                    Successfully Extracted!
                  </h2>
                  <p className="text-sm text-gray-600">
                    {pageResults.length} page{pageResults.length > 1 ? 's' : ''} processed
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap gap-3">
                {pageResults.some(r => r.tableData.isTable) && (
                  <>
                    <button
                      onClick={() => setShowMapping(!showMapping)}
                      className="px-6 py-2.5 text-sm font-semibold text-white bg-gradient-to-r from-indigo-500 to-purple-600 rounded-xl hover:from-indigo-600 hover:to-purple-700 transition-all duration-200 shadow-md hover:shadow-lg transform hover:-translate-y-0.5"
                    >
                      <span className="flex items-center gap-2">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                        </svg>
                        {showMapping ? 'Hide Mapping' : 'Map Columns'}
                      </span>
                    </button>
                    <button
                      onClick={exportAllToCSV}
                      className="px-6 py-2.5 text-sm font-semibold text-white bg-gradient-to-r from-green-500 to-emerald-600 rounded-xl hover:from-green-600 hover:to-emerald-700 transition-all duration-200 shadow-md hover:shadow-lg transform hover:-translate-y-0.5"
                    >
                      <span className="flex items-center gap-2">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                        </svg>
                        Export All to CSV
                      </span>
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        )}

        {pageResults.length > 0 && (
          <div className="mt-8">
            <h2 className="text-2xl font-bold mb-4">Ask about this document</h2>
            <ChatWithDocument />
          </div>
        )}

        {showMapping && pageResults.length > 0 && pageResults.some(r => r.tableData.isTable && r.tableData.rows) && (
          <div className="bg-white rounded-2xl shadow-xl p-6 md:p-8 mb-8 border border-gray-100">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 bg-purple-100 rounded-lg flex items-center justify-center">
                <svg className="w-5 h-5 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                </svg>
              </div>
              <h2 className="text-2xl font-bold text-gray-800">Column Mapping</h2>
            </div>
            


            <div className="mb-6 bg-gradient-to-br from-gray-50 to-slate-50 rounded-xl p-6 border border-gray-200">
              <h3 className="text-lg font-semibold mb-4 text-gray-800 flex items-center gap-2">
                <svg className="w-5 h-5 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
                Map to Predefined Columns
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {predefinedColumns.map((predefinedCol) => {
                  const firstTable = pageResults.find(r => r.tableData.isTable && r.tableData.rows);
                  if (!firstTable) return null;
                  const pageIndex = pageResults.indexOf(firstTable);
                  const tableRows = editedData[pageIndex] || firstTable.tableData.rows;
                  const extractedHeaders = tableRows?.[0] || [];
                  return (
                    <div key={predefinedCol} className="flex flex-col gap-2">
                      <label className="text-xs font-bold text-gray-700 uppercase tracking-wide">
                        {predefinedCol}
                      </label>
                      <select
                        value={columnMapping[predefinedCol] || ''}
                        onChange={(e) => handleColumnMapping(predefinedCol, e.target.value)}
                        className="px-4 py-2.5 border-2 border-gray-300 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-gray-900 font-medium bg-white hover:border-indigo-400 transition-colors cursor-pointer"
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
              <button
                onClick={applyMapping}
                className="px-6 py-2.5 text-sm font-semibold text-indigo-700 bg-indigo-100 rounded-xl hover:bg-indigo-200 transition-all duration-200 shadow-sm hover:shadow-md transform hover:-translate-y-0.5"
              >
                <span className="flex items-center gap-2">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                  Refresh Mapping
                </span>
              </button>
              {mappedData && (
                <button
                  onClick={exportMappedData}
                  className="px-6 py-2.5 text-sm font-semibold text-white bg-gradient-to-r from-green-500 to-emerald-600 rounded-xl hover:from-green-600 hover:to-emerald-700 transition-all duration-200 shadow-md hover:shadow-lg transform hover:-translate-y-0.5"
                >
                  <span className="flex items-center gap-2">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                    Download Excel
                  </span>
                </button>
              )}
            </div>

            {mappedData && (
              <div className="mt-8 bg-gradient-to-br from-green-50 to-emerald-50 rounded-xl p-6 border border-green-200">
                <div className="flex flex-col md:flex-row md:items-center justify-between mb-4 gap-3">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-green-500 rounded-lg flex items-center justify-center shadow-sm">
                      <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                    </div>
                    <div>
                      <h3 className="text-lg font-bold text-gray-800">
                        Mapped Data Preview
                      </h3>
                      <p className="text-sm text-gray-600">
                        {mappedData.length - 1} rows × {mappedData[0].length} columns
                      </p>
                    </div>
                  </div>
                </div>
                <div className="bg-white rounded-xl border-2 border-green-300 overflow-auto max-h-[600px] shadow-inner">
                  <table className="min-w-full border-collapse">
                    <thead className="sticky top-0 bg-gradient-to-r from-green-600 to-emerald-600 text-white shadow-md">
                      <tr>
                        {mappedData[0].map((header, idx) => (
                          <th
                            key={idx}
                            className="border-r border-green-500 last:border-r-0 px-4 py-3 text-left text-sm font-bold"
                          >
                            {header}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {mappedData.slice(1).map((row, rowIndex) => (
                        <tr 
                          key={rowIndex} 
                          className={`${rowIndex % 2 === 0 ? 'bg-white' : 'bg-green-50'} hover:bg-green-100 transition-colors`}
                        >
                          {row.map((cell, cellIndex) => (
                            <td
                              key={cellIndex}
                              className="border border-gray-200 px-4 py-2.5 text-sm text-gray-900"
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

        {/* Navigation Controls */}
        {pageResults.length > 1 && (
          <div className="bg-white rounded-2xl shadow-lg p-4 mb-8 border border-gray-100">
            <div className="flex items-center justify-between">
              <button
                onClick={goToPreviousPage}
                disabled={currentPageView === 0}
                className={`flex items-center gap-2 px-6 py-2.5 rounded-xl font-semibold transition-all duration-200 ${
                  currentPageView === 0
                    ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                    : 'bg-gradient-to-r from-indigo-500 to-purple-600 text-white hover:from-indigo-600 hover:to-purple-700 shadow-md hover:shadow-lg transform hover:-translate-y-0.5'
                }`}
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
                Previous
              </button>
              
              <div className="flex items-center gap-3">
                <span className="text-sm font-medium text-gray-600">Page</span>
                <div className="flex items-center gap-2">
                  {pageResults.map((_, idx) => (
                    <button
                      key={idx}
                      onClick={() => {
                        setCurrentPageView(idx);
                        window.scrollTo({ top: 0, behavior: 'smooth' });
                      }}
                      className={`w-10 h-10 rounded-lg font-bold transition-all duration-200 ${
                        idx === currentPageView
                          ? 'bg-gradient-to-r from-indigo-500 to-purple-600 text-white shadow-md scale-110'
                          : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                      }`}
                    >
                      {idx + 1}
                    </button>
                  ))}
                </div>
                <span className="text-sm font-medium text-gray-600">of {pageResults.length}</span>
              </div>
              
              <button
                onClick={goToNextPage}
                disabled={currentPageView === pageResults.length - 1}
                className={`flex items-center gap-2 px-6 py-2.5 rounded-xl font-semibold transition-all duration-200 ${
                  currentPageView === pageResults.length - 1
                    ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                    : 'bg-gradient-to-r from-indigo-500 to-purple-600 text-white hover:from-indigo-600 hover:to-purple-700 shadow-md hover:shadow-lg transform hover:-translate-y-0.5'
                }`}
              >
                Next
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </button>
            </div>
          </div>
        )}

        {pageResults.filter((_, index) => index === currentPageView).map((result, index) => {
          const actualIndex = currentPageView;
          return (
          <div key={index} className="mb-12 bg-white rounded-lg shadow-xl p-6">
            <div className="flex items-center justify-between mb-6">
              <div>
                {totalPages > 1 && (
                  <h2 className="text-2xl font-bold text-indigo-900">
                    Page {result.pageNumber} of {totalPages}
                  </h2>
                )}
                {result.rotationApplied !== undefined && result.rotationApplied !== 0 && (
                  <p className="text-sm text-green-600 mt-1">
                    ✓ Auto-rotated {result.rotationApplied}° to correct orientation
                  </p>
                )}
              </div>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    rotatePageManually(actualIndex, 90);
                  }}
                  disabled={loading}
                  className={`group px-5 py-2.5 text-sm font-bold rounded-xl transition-all duration-200 flex items-center gap-2 shadow-md ${
                    loading 
                      ? 'bg-gray-200 text-gray-400 cursor-not-allowed' 
                      : 'bg-gradient-to-r from-blue-500 to-indigo-600 text-white hover:from-blue-600 hover:to-indigo-700 hover:shadow-lg transform hover:-translate-y-0.5 active:translate-y-0'
                  }`}
                  title="Rotate 90° clockwise and reprocess table"
                >
                  <svg className={`w-5 h-5 ${loading ? '' : 'group-hover:rotate-90 transition-transform duration-300'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                  <span>Rotate Right</span>
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    rotatePageManually(actualIndex, -90);
                  }}
                  disabled={loading}
                  className={`group px-5 py-2.5 text-sm font-bold rounded-xl transition-all duration-200 flex items-center gap-2 shadow-md ${
                    loading 
                      ? 'bg-gray-200 text-gray-400 cursor-not-allowed' 
                      : 'bg-gradient-to-r from-purple-500 to-pink-600 text-white hover:from-purple-600 hover:to-pink-700 hover:shadow-lg transform hover:-translate-y-0.5 active:translate-y-0'
                  }`}
                  title="Rotate 90° counter-clockwise and reprocess table"
                >
                  <svg className={`w-5 h-5 ${loading ? '' : 'group-hover:-rotate-90 transition-transform duration-300'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                  <span>Rotate Left</span>
                </button>
              </div>
            </div>
            
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 md:gap-8">
              <div className="space-y-6">
                <div className="bg-gradient-to-br from-blue-50 to-indigo-50 rounded-xl p-4 border border-blue-200">
                  <h3 className="text-lg font-bold mb-3 text-gray-800 flex items-center gap-2">
                    <svg className="w-5 h-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                    Original Image
                  </h3>
                  <img
                    src={result.originalImage}
                    alt={`Page ${result.pageNumber} Original`}
                    className="w-full h-auto rounded-lg border-2 border-blue-300 shadow-md hover:shadow-lg transition-shadow"
                  />
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-bold text-gray-800 flex items-center gap-2">
                    <svg className="w-5 h-5 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M3 14h18m-9-4v8m-7 0h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                    </svg>
                    Extracted Table Data
                  </h3>
                  <button
                    onClick={toggleEditMode}
                    className={`px-4 py-2 text-sm font-semibold rounded-xl transition-all duration-200 shadow-md hover:shadow-lg transform hover:-translate-y-0.5 flex items-center gap-2 ${
                      editMode 
                        ? 'bg-gradient-to-r from-red-500 to-pink-600 text-white hover:from-red-600 hover:to-pink-700' 
                        : 'bg-gradient-to-r from-blue-500 to-indigo-600 text-white hover:from-blue-600 hover:to-indigo-700'
                    }`}
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      {editMode ? (
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      ) : (
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                      )}
                    </svg>
                    {editMode ? 'Done Editing' : 'Edit Table'}
                  </button>
                </div>
                <div className="bg-gradient-to-br from-gray-50 to-slate-50 rounded-xl p-4 border-2 border-gray-200 overflow-auto max-h-[800px] shadow-inner">
                  {result.tableData.isTable && result.tableData.rows ? (
                    <div className="overflow-x-auto">
                      <table className="min-w-full border-collapse border-2 border-gray-400 shadow-sm">
                        <tbody>
                          {(() => {
                            const tableRows = editedData[actualIndex] || result.tableData.rows;
                            // Display all rows (first row is now the header with Sr. No)
                            return tableRows.map((row, rowIndex) => (
                              <tr 
                                key={rowIndex} 
                                className={
                                  rowIndex === 0 
                                    ? 'bg-gradient-to-r from-indigo-500 to-purple-600 text-white font-bold' 
                                    : rowIndex % 2 === 0
                                    ? 'bg-white hover:bg-blue-50' 
                                    : 'bg-gray-50 hover:bg-blue-50'
                                }
                              >
                                {row.map((cell, cellIndex) => (
                                  <td
                                    key={cellIndex}
                                    className={`border border-gray-300 px-3 py-2 text-xs align-top transition-colors ${
                                      rowIndex === 0 ? 'text-white' : 'text-gray-900'
                                    }`}
                                  >
                                    {editMode ? (
                                      <input
                                        type="text"
                                        value={cell}
                                        onChange={(e) => handleCellEdit(actualIndex, rowIndex, cellIndex, e.target.value)}
                                        className="w-full min-w-[100px] px-2 py-1.5 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-gray-900 hover:border-indigo-400 transition-colors"
                                      />
                                    ) : (
                                      <div className="min-h-[20px]">
                                        {cell || ''}
                                      </div>
                                    )}
                                  </td>
                                ))}
                              </tr>
                            ));
                          })()}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <pre className="whitespace-pre-wrap font-mono text-sm text-gray-800 p-4 bg-white rounded-lg border border-gray-300">
                      {result.tableData.text}
                    </pre>
                  )}
                </div>
              </div>
            </div>
          </div>
        );
        })}
      </div>
    </div>
  );
}
