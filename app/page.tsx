'use client';

import { useState, useEffect } from 'react';
import { createWorker } from 'tesseract.js';
import * as pdfjsLib from 'pdfjs-dist';

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

  const rotatePageManually = async (pageIndex: number, angle: number) => {
    const result = pageResults[pageIndex];
    if (!result) return;

    const currentRotation = manualRotation[pageIndex] || 0;
    const newRotation = (currentRotation + angle) % 360;
    
    setManualRotation(prev => ({ ...prev, [pageIndex]: newRotation }));

    // Rotate the original image
    const rotated = await rotateImage(result.originalImage, angle);
    
    // Update the result
    const updatedResults = [...pageResults];
    updatedResults[pageIndex] = {
      ...result,
      originalImage: rotated,
      rotationApplied: (result.rotationApplied || 0) + angle
    };
    setPageResults(updatedResults);
  };

  const exportToCSV = (tableData: TableData, pageNum: number) => {
    if (!tableData.rows) return;
    
    const csv = tableData.rows.map(row => 
      row.map(cell => `"${cell.replace(/"/g, '""')}"`).join(',')
    ).join('\n');
    
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `table_page_${pageNum}.csv`;
    a.click();
    URL.revokeObjectURL(url);
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

  const processImage = async (imageData: string, pageNum: number, worker: any): Promise<PageResult> => {
    try {
      console.log(`Processing page ${pageNum}...`);
      
      // Step 0: Upscale image for better OCR accuracy
      console.log(`Upscaling page ${pageNum} for better OCR...`);
      const upscaled = await upscaleImage(imageData, 2);
      
      // FORCE: Rotate 90 degrees clockwise FIRST
      console.log(`Force rotating page ${pageNum} by 90 degrees clockwise`);
      let rotatedImage = await rotateImage(upscaled, 90);
      let totalRotation = 90;
      
      // Step 1: Detect if additional rotation is needed
      const additionalRotation = await detectRotation(rotatedImage);
      
      // Step 2: Apply additional rotation if detected
      let correctedImage = rotatedImage;
      if (additionalRotation !== 0) {
        console.log(`Applying additional rotation of ${additionalRotation} degrees`);
        correctedImage = await rotateImage(rotatedImage, additionalRotation);
        totalRotation += additionalRotation;
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
        tableData = { isTable: true, rows: tableRows, pageNumber: pageNum };
        
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

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const uploadedFile = e.target.files?.[0];
    if (!uploadedFile) return;

    if (!pdfWorkerReady && uploadedFile.type === 'application/pdf') {
      setError('PDF worker is still loading. Please wait a moment and try again.');
      return;
    }

    setFile(uploadedFile);
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
        setLoading(false);
      } else {
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

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-8">
      <div className="max-w-7xl mx-auto">
        <h1 className="text-4xl font-bold text-center mb-8 text-indigo-900">
          Advanced Table OCR Extractor
        </h1>

        <div className="bg-white rounded-lg shadow-xl p-8 mb-8">
          <label className="block mb-4">
            <span className="text-lg font-semibold text-gray-700 mb-2 block">
              Upload Image or PDF
            </span>
            <input
              type="file"
              accept="image/*,application/pdf"
              onChange={handleFileUpload}
              className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-indigo-50 file:text-indigo-700 hover:file:bg-indigo-100 cursor-pointer"
            />
          </label>

          {loading && (
            <div className="mt-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-indigo-700">
                  {totalPages > 0 
                    ? `Processing page ${currentPage} of ${totalPages}...` 
                    : 'Processing...'}
                </span>
                <span className="text-sm font-medium text-indigo-700">
                  {progress}%
                </span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2.5">
                <div
                  className="bg-indigo-600 h-2.5 rounded-full transition-all duration-300"
                  style={{ width: `${progress}%` }}
                ></div>
              </div>
            </div>
          )}

          {error && (
            <div className="mt-4 p-4 bg-red-50 border border-red-200 rounded-lg">
              <p className="text-sm text-red-800">{error}</p>
            </div>
          )}
        </div>

        {pageResults.length > 0 && (
          <div className="bg-white rounded-lg shadow-xl p-6 mb-8">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-semibold text-gray-800">
                Extracted {pageResults.length} page{pageResults.length > 1 ? 's' : ''}
              </h2>
              {pageResults.some(r => r.tableData.isTable) && (
                <button
                  onClick={exportAllToCSV}
                  className="px-6 py-2 text-sm font-medium text-white bg-green-600 rounded-lg hover:bg-green-700 transition-colors"
                >
                  Export All to CSV
                </button>
              )}
            </div>
          </div>
        )}

        {pageResults.map((result, index) => (
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
              <div className="flex gap-2">
                <button
                  onClick={() => rotatePageManually(index, 90)}
                  className="px-3 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
                  title="Rotate 90° clockwise"
                >
                  ↻ 90°
                </button>
                <button
                  onClick={() => rotatePageManually(index, -90)}
                  className="px-3 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
                  title="Rotate 90° counter-clockwise"
                >
                  ↺ 90°
                </button>
              </div>
            </div>
            
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
              <div>
                <h3 className="text-xl font-semibold mb-4 text-gray-800">
                  Original Image
                </h3>
                <img
                  src={result.originalImage}
                  alt={`Page ${result.pageNumber} Original`}
                  className="w-full h-auto rounded-lg border-2 border-gray-200 mb-4"
                />
                <h3 className="text-xl font-semibold mb-4 text-gray-800 mt-6">
                  Processed Image
                </h3>
                <img
                  src={result.processedImage}
                  alt={`Page ${result.pageNumber} Processed`}
                  className="w-full h-auto rounded-lg border-2 border-gray-200"
                />
              </div>

              <div>
                <h3 className="text-xl font-semibold mb-4 text-gray-800">
                  Extracted Table Data
                </h3>
                {result.tableData.isTable && result.tableData.rows && (
                  <button
                    onClick={() => exportToCSV(result.tableData, result.pageNumber)}
                    className="mb-4 px-4 py-2 text-sm font-medium text-white bg-green-600 rounded-lg hover:bg-green-700 transition-colors"
                  >
                    Export to CSV
                  </button>
                )}
                <div className="bg-gray-50 rounded-lg p-4 border border-gray-200 overflow-auto max-h-[800px]">
                  {result.tableData.isTable && result.tableData.rows ? (
                    <div className="overflow-x-auto">
                      <table className="min-w-full border-collapse border-2 border-gray-600">
                        <tbody>
                          {result.tableData.rows.map((row, rowIndex) => (
                            <tr 
                              key={rowIndex} 
                              className={
                                rowIndex === 0 
                                  ? 'bg-indigo-200 font-bold' 
                                  : rowIndex % 2 === 1 
                                  ? 'bg-white' 
                                  : 'bg-gray-100'
                              }
                            >
                              {row.map((cell, cellIndex) => (
                                <td
                                  key={cellIndex}
                                  className="border border-gray-400 px-3 py-2 text-xs text-gray-900 align-top"
                                >
                                  <div className="min-h-[20px]">
                                    {cell || ''}
                                  </div>
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <pre className="whitespace-pre-wrap font-mono text-sm text-gray-800">
                      {result.tableData.text}
                    </pre>
                  )}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
