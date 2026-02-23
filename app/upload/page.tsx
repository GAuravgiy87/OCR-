'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { createWorker } from 'tesseract.js';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import { correctTableData, correctTextData } from '../../lib/aiCorrection';
import { saveDocumentWithPages } from '../../lib/dbService';
import Toast, { ToastType } from '../../components/Toast';
import ConfirmModal from '../../components/ConfirmModal';

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

export default function UploadPage() {
  const router = useRouter();
  
  // File upload state
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [progressText, setProgressText] = useState('');
  
  // Toast notification state
  const [toast, setToast] = useState<{ message: string; type: ToastType } | null>(null);
  
  // Confirmation modal state
  const [confirmModal, setConfirmModal] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
  }>({
    isOpen: false,
    title: '',
    message: '',
    onConfirm: () => {},
  });

  const showToast = (message: string, type: ToastType = 'info') => {
    setToast({ message, type });
  };

  const showConfirm = (title: string, message: string, onConfirm: () => void) => {
    setConfirmModal({
      isOpen: true,
      title,
      message,
      onConfirm,
    });
  };

  // Initialize PDF.js worker
  useEffect(() => {
    pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';
  }, []);
  // Image processing functions
  const upscaleImage = async (imageData: string, scale: number = 2): Promise<string> => {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d')!;
        
        canvas.width = img.width * scale;
        canvas.height = img.height * scale;
        
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        
        resolve(canvas.toDataURL('image/png'));
      };
      img.src = imageData;
    });
  };

  const detectRotation = async (imageData: string): Promise<number> => {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d')!;
        
        const sampleSize = Math.min(200, img.width, img.height);
        canvas.width = sampleSize;
        canvas.height = sampleSize;
        
        ctx.drawImage(img, 0, 0, sampleSize, sampleSize);
        const imageData = ctx.getImageData(0, 0, sampleSize, sampleSize);
        const data = imageData.data;
        
        let horizontalEdges = 0;
        let verticalEdges = 0;
        
        for (let y = 1; y < sampleSize - 1; y++) {
          for (let x = 1; x < sampleSize - 1; x++) {
            const idx = (y * sampleSize + x) * 4;
            const current = data[idx];
            const right = data[idx + 4];
            const bottom = data[(y + 1) * sampleSize * 4 + x * 4];
            
            if (Math.abs(current - right) > 30) horizontalEdges++;
            if (Math.abs(current - bottom) > 30) verticalEdges++;
          }
        }
        
        const ratio = horizontalEdges / (verticalEdges + 1);
        
        if (ratio > 1.5) {
          resolve(90);
        } else if (ratio < 0.7) {
          resolve(270);
        } else {
          resolve(0);
        }
      };
      img.src = imageData;
    });
  };

  const analyzeImageQuality = async (imageData: string): Promise<'low' | 'medium' | 'high'> => {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d')!;
        
        const sampleSize = 200;
        canvas.width = sampleSize;
        canvas.height = sampleSize;
        
        ctx.drawImage(img, 0, 0, sampleSize, sampleSize);
        const pixels = ctx.getImageData(0, 0, sampleSize, sampleSize);
        const data = pixels.data;
        
        let totalBrightness = 0;
        let brightnessValues = [];
        
        for (let i = 0; i < data.length; i += 4) {
          const brightness = (data[i] + data[i + 1] + data[i + 2]) / 3;
          totalBrightness += brightness;
          brightnessValues.push(brightness);
        }
        
        const avgBrightness = totalBrightness / brightnessValues.length;
        
        let variance = 0;
        for (const val of brightnessValues) {
          variance += Math.pow(val - avgBrightness, 2);
        }
        const stdDev = Math.sqrt(variance / brightnessValues.length);
        
        if (stdDev > 50) {
          resolve('high');
        } else if (stdDev > 30) {
          resolve('medium');
        } else {
          resolve('low');
        }
      };
      img.src = imageData;
    });
  };

  const enhanceImageAdaptive = async (imageData: string, quality: 'low' | 'medium' | 'high'): Promise<string> => {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d')!;
        
        canvas.width = img.width;
        canvas.height = img.height;
        ctx.drawImage(img, 0, 0);
        
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const data = imageData.data;
        
        if (quality === 'low') {
          // Aggressive enhancement for low quality
          for (let i = 0; i < data.length; i += 4) {
            const gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
            const enhanced = Math.min(255, Math.max(0, (gray - 128) * 1.6 + 128));
            data[i] = data[i + 1] = data[i + 2] = enhanced;
          }
        } else if (quality === 'medium') {
          // Moderate enhancement
          for (let i = 0; i < data.length; i += 4) {
            const gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
            const enhanced = Math.min(255, Math.max(0, (gray - 128) * 1.4 + 128));
            data[i] = data[i + 1] = data[i + 2] = enhanced;
          }
        } else {
          // Light enhancement for high quality
          for (let i = 0; i < data.length; i += 4) {
            const gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
            const enhanced = Math.min(255, Math.max(0, (gray - 128) * 1.15 + 128));
            data[i] = data[i + 1] = data[i + 2] = enhanced;
          }
        }
        
        ctx.putImageData(imageData, 0, 0);
        resolve(canvas.toDataURL('image/png'));
      };
      img.src = imageData;
    });
  };
  const detectTableStructure = async (imageData: string) => {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d')!;
        
        canvas.width = img.width;
        canvas.height = img.height;
        ctx.drawImage(img, 0, 0);
        
        const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const data = pixels.data;
        const width = canvas.width;
        const height = canvas.height;
        
        // Convert to binary (black/white)
        const edgeMap = new Uint8Array(width * height);
        for (let i = 0; i < data.length; i += 4) {
          const brightness = (data[i] + data[i + 1] + data[i + 2]) / 3;
          edgeMap[i / 4] = brightness < 180 ? 1 : 0;
        }
        
        // Detect horizontal lines
        const rowLines = [];
        const minLineLength = width * 0.3;
        
        for (let y = 0; y < height; y++) {
          let linePixels = 0;
          let consecutivePixels = 0;
          let maxConsecutive = 0;
          
          for (let x = 0; x < width; x++) {
            if (edgeMap[y * width + x] === 1) {
              linePixels++;
              consecutivePixels++;
              maxConsecutive = Math.max(maxConsecutive, consecutivePixels);
            } else {
              consecutivePixels = 0;
            }
          }
          
          if (linePixels >= minLineLength && maxConsecutive > 30) {
            const lastLine = rowLines[rowLines.length - 1];
            if (!lastLine || y - lastLine > 25) {
              rowLines.push(y);
            }
          }
        }
        
        // Detect vertical lines
        const colLines = [];
        const minColLineLength = height * 0.3;
        
        for (let x = 0; x < width; x++) {
          let linePixels = 0;
          let consecutivePixels = 0;
          let maxConsecutive = 0;
          
          for (let y = 0; y < height; y++) {
            if (edgeMap[y * width + x] === 1) {
              linePixels++;
              consecutivePixels++;
              maxConsecutive = Math.max(maxConsecutive, consecutivePixels);
            } else {
              consecutivePixels = 0;
            }
          }
          
          if (linePixels >= minColLineLength && maxConsecutive > 30) {
            const lastLine = colLines[colLines.length - 1];
            if (!lastLine || x - lastLine > 25) {
              colLines.push(x);
            }
          }
        }
        
        const isTable = rowLines.length >= 2 && colLines.length >= 2;
        
        resolve({
          isTable,
          rowLines: rowLines.sort((a, b) => a - b),
          colLines: colLines.sort((a, b) => a - b),
          boundaries: isTable ? {
            top: Math.min(...rowLines),
            bottom: Math.max(...rowLines),
            left: Math.min(...colLines),
            right: Math.max(...colLines)
          } : null
        });
      };
      img.src = imageData;
    });
  };

  const extractCellData = async (imageData: string, rowLines: number[], colLines: number[], worker: any): Promise<string[][]> => {
    const tableData: string[][] = [];
    
    for (let r = 0; r < rowLines.length - 1; r++) {
      const row: string[] = [];
      
      for (let c = 0; c < colLines.length - 1; c++) {
        const cellCanvas = document.createElement('canvas');
        const cellCtx = cellCanvas.getContext('2d')!;
        
        const cellX = colLines[c];
        const cellY = rowLines[r];
        const cellWidth = colLines[c + 1] - colLines[c];
        const cellHeight = rowLines[r + 1] - rowLines[r];
        
        const padding = 5;
        cellCanvas.width = cellWidth + (padding * 2);
        cellCanvas.height = cellHeight + (padding * 2);
        
        cellCtx.fillStyle = 'white';
        cellCtx.fillRect(0, 0, cellCanvas.width, cellCanvas.height);
        
        const img = new Image();
        await new Promise((resolve) => {
          img.onload = resolve;
          img.src = imageData;
        });
        
        cellCtx.drawImage(
          img,
          cellX, cellY, cellWidth, cellHeight,
          padding, padding, cellWidth, cellHeight
        );
        
        const cellImageData = cellCanvas.toDataURL('image/png');
        
        try {
          const { data } = await worker.recognize(cellImageData);
          let text = data.text.trim();
          
          text = text.replace(/[|\\]/g, '');
          text = text.replace(/\s+/g, ' ');
          text = text.trim();
          
          row.push(text);
        } catch (error) {
          console.error('OCR error for cell:', error);
          row.push('');
        }
      }
      
      tableData.push(row);
    }
    
    return tableData;
  };
  const processImage = async (imageData: string, pageNumber: number, worker: any): Promise<PageResult> => {
    try {
      setProgressText(`Processing page ${pageNumber}...`);
      
      // Step 1: Upscale for better OCR
      const upscaled = await upscaleImage(imageData, 2);
      
      // Step 2: Detect rotation
      const rotation = await detectRotation(upscaled);
      let processedImage = upscaled;
      
      if (rotation !== 0) {
        processedImage = await rotateImage(upscaled, rotation);
      }
      
      // Step 3: Analyze quality and enhance
      const quality = await analyzeImageQuality(processedImage);
      const enhanced = await enhanceImageAdaptive(processedImage, quality);
      
      // Step 4: Detect table structure
      const structure: any = await detectTableStructure(enhanced);
      
      let tableData: TableData;
      
      if (structure.isTable) {
        setProgressText(`Extracting table data from page ${pageNumber}...`);
        
        // Extract table data
        const rows = await extractCellData(enhanced, structure.rowLines, structure.colLines, worker);
        
        tableData = {
          isTable: true,
          rows: rows,
          pageNumber: pageNumber
        };
      } else {
        setProgressText(`Extracting text from page ${pageNumber}...`);
        
        // Extract as plain text
        const { data } = await worker.recognize(enhanced);
        let text = data.text.trim();
        
        // Clean up text
        text = text.replace(/\s+/g, ' ').trim();
        
        tableData = {
          isTable: false,
          text: text,
          pageNumber: pageNumber
        };
      }
      
      return {
        pageNumber,
        originalImage: imageData,
        processedImage: enhanced,
        tableData,
        rotationApplied: rotation
      };
      
    } catch (error) {
      console.error(`Error processing page ${pageNumber}:`, error);
      throw error;
    }
  };

  const rotateImage = async (imageData: string, degrees: number): Promise<string> => {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d')!;
        
        const radians = (degrees * Math.PI) / 180;
        
        if (degrees === 90 || degrees === 270) {
          canvas.width = img.height;
          canvas.height = img.width;
        } else {
          canvas.width = img.width;
          canvas.height = img.height;
        }
        
        ctx.translate(canvas.width / 2, canvas.height / 2);
        ctx.rotate(radians);
        ctx.drawImage(img, -img.width / 2, -img.height / 2);
        
        resolve(canvas.toDataURL('image/png'));
      };
      img.src = imageData;
    });
  };

  const processPDF = async (file: File): Promise<PageResult[]> => {
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument(arrayBuffer).promise;
    const totalPages = pdf.numPages;
    
    const worker = await createWorker('eng', 1);
    await worker.setParameters({
      tessedit_pageseg_mode: '6',
      preserve_interword_spaces: '1'
    } as any);
    
    const results: PageResult[] = [];
    
    for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
      setProgress((pageNum - 1) / totalPages * 100);
      
      const page = await pdf.getPage(pageNum);
      const viewport = page.getViewport({ scale: 4 });
      
      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d')!;
      canvas.height = viewport.height;
      canvas.width = viewport.width;
      
      await page.render({
        canvasContext: context,
        viewport: viewport,
        canvas: canvas
      }).promise;
      
      const imageData = canvas.toDataURL('image/png');
      const result = await processImage(imageData, pageNum, worker);
      results.push(result);
    }
    
    await worker.terminate();
    return results;
  };

  const processImageFile = async (file: File): Promise<PageResult[]> => {
    const imageData = await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onload = (e) => resolve(e.target?.result as string);
      reader.readAsDataURL(file);
    });
    
    const worker = await createWorker('eng', 1);
    await worker.setParameters({
      tessedit_pageseg_mode: '6',
      preserve_interword_spaces: '1'
    } as any);
    
    const result = await processImage(imageData, 1, worker);
    await worker.terminate();
    
    return [result];
  };
  const handleFileUpload = async (uploadedFile: File) => {
    if (!uploadedFile) return;
    
    setFile(uploadedFile);
    setLoading(true);
    setProgress(0);
    setProgressText('Starting processing...');
    
    try {
      let pageResults: PageResult[];
      
      if (uploadedFile.type === 'application/pdf') {
        pageResults = await processPDF(uploadedFile);
      } else {
        pageResults = await processImageFile(uploadedFile);
      }
      
      setProgressText('Saving to database...');
      
      // Save to database and get document ID
      const result = await saveDocumentWithPages(
        uploadedFile.name,
        uploadedFile.type,
        uploadedFile.size,
        pageResults
      );
      
      if (!result.success) {
        throw new Error('Failed to save document to database');
      }
      
      const documentId = result.documentId;
      
      setProgressText('Processing complete!');
      setProgress(100);
      
      showToast('Document processed successfully!', 'success');
      
      // Redirect to document view page
      setTimeout(() => {
        router.push(`/document/${documentId}`);
      }, 1000);
      
    } catch (error: any) {
      console.error('Processing error:', error);
      showToast(`Error: ${error.message}`, 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const droppedFile = e.dataTransfer.files[0];
    if (droppedFile && (droppedFile.type === 'application/pdf' || droppedFile.type.startsWith('image/'))) {
      handleFileUpload(droppedFile);
    } else {
      showToast('Please upload a PDF or image file', 'error');
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      handleFileUpload(selectedFile);
    }
  };

  return (
    <>
      <div className="min-h-screen bg-gradient-to-br from-indigo-50 via-white to-purple-50">
        {/* Header */}
        <header className="bg-white/80 backdrop-blur-sm border-b border-gray-200 sticky top-0 z-10">
          <div className="max-w-7xl mx-auto px-4 md:px-8 py-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-gradient-to-r from-indigo-600 to-purple-600 rounded-xl flex items-center justify-center">
                  <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                </div>
                <div>
                  <h1 className="text-2xl font-bold bg-gradient-to-r from-indigo-600 to-purple-600 bg-clip-text text-transparent">
                    OCR Document Processor
                  </h1>
                  <p className="text-sm text-gray-600">Extract tables and text from PDFs and images</p>
                </div>
              </div>
              
              <div className="flex items-center gap-4">
                <Link
                  href="/"
                  className="p-2 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors flex items-center gap-2"
                  title="Back to home"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                  </svg>
                  Home
                </Link>
                <Link
                  href="/database"
                  className="px-4 py-2 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors flex items-center gap-2"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 7v10c0 2.21 1.79 4 4 4h8c0 2.21 1.79 4 4 4h8c0-2.21-1.79-4-4-4H8c-2.21 0-4-1.79-4-4V7" />
                  </svg>
                  Database
                </Link>
                <Link
                  href="/chat"
                  className="px-4 py-2 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors flex items-center gap-2"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
                  </svg>
                  AI Chat
                </Link>
              </div>
            </div>
          </div>
        </header>

        {/* Main Content */}
        <main className="max-w-4xl mx-auto px-4 md:px-8 py-12">
          {!loading ? (
            <div className="text-center">
              <div className="mb-8">
                <div className="w-24 h-24 bg-gradient-to-r from-indigo-600 to-purple-600 rounded-full flex items-center justify-center mx-auto mb-6">
                  <svg className="w-12 h-12 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                  </svg>
                </div>
                <h2 className="text-3xl font-bold text-gray-900 mb-4">Upload Your Document</h2>
                <p className="text-lg text-gray-600 mb-8">
                  Drag and drop a PDF or image file to extract tables and text with AI-powered OCR
                </p>
              </div>

              {/* Upload Area */}
              <div
                onDrop={handleDrop}
                onDragOver={(e) => e.preventDefault()}
                onDragEnter={(e) => e.preventDefault()}
                className="border-2 border-dashed border-indigo-300 rounded-2xl p-12 bg-gradient-to-br from-indigo-50/50 to-purple-50/50 hover:border-indigo-400 transition-colors cursor-pointer group"
              >
                <input
                  type="file"
                  accept=".pdf,image/*"
                  onChange={handleFileSelect}
                  className="hidden"
                  id="file-upload"
                />
                <label htmlFor="file-upload" className="cursor-pointer">
                  <div className="flex flex-col items-center">
                    <div className="w-16 h-16 bg-indigo-100 rounded-full flex items-center justify-center mb-4 group-hover:bg-indigo-200 transition-colors">
                      <svg className="w-8 h-8 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                      </svg>
                    </div>
                    <h3 className="text-xl font-semibold text-gray-900 mb-2">Choose a file or drag it here</h3>
                    <p className="text-gray-600 mb-4">PDF documents and image files (PNG, JPG, JPEG)</p>
                    <div className="px-6 py-3 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors">
                      Browse Files
                    </div>
                  </div>
                </label>
              </div>

              {/* Features */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-12">
                <div className="text-center p-6 bg-white rounded-xl shadow-sm border border-gray-100">
                  <div className="w-12 h-12 bg-green-100 rounded-lg flex items-center justify-center mx-auto mb-4">
                    <svg className="w-6 h-6 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                  <h3 className="font-semibold text-gray-900 mb-2">Smart Table Detection</h3>
                  <p className="text-sm text-gray-600">Automatically detects and extracts table structures with high accuracy</p>
                </div>
                
                <div className="text-center p-6 bg-white rounded-xl shadow-sm border border-gray-100">
                  <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center mx-auto mb-4">
                    <svg className="w-6 h-6 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                    </svg>
                  </div>
                  <h3 className="font-semibold text-gray-900 mb-2">AI-Powered OCR</h3>
                  <p className="text-sm text-gray-600">Advanced OCR with automatic image enhancement and rotation correction</p>
                </div>
                
                <div className="text-center p-6 bg-white rounded-xl shadow-sm border border-gray-100">
                  <div className="w-12 h-12 bg-purple-100 rounded-lg flex items-center justify-center mx-auto mb-4">
                    <svg className="w-6 h-6 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                  </div>
                  <h3 className="font-semibold text-gray-900 mb-2">Multiple Export Formats</h3>
                  <p className="text-sm text-gray-600">Export extracted data as CSV, Excel, or use our AI chat assistant</p>
                </div>
              </div>
            </div>
          ) : (
            /* Processing State */
            <div className="text-center">
              <div className="mb-8">
                <div className="w-24 h-24 bg-gradient-to-r from-indigo-600 to-purple-600 rounded-full flex items-center justify-center mx-auto mb-6 animate-pulse">
                  <svg className="w-12 h-12 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                </div>
                <h2 className="text-3xl font-bold text-gray-900 mb-4">Processing Document</h2>
                <p className="text-lg text-gray-600 mb-8">{progressText}</p>
              </div>

              {/* Progress Bar */}
              <div className="max-w-md mx-auto mb-8">
                <div className="bg-gray-200 rounded-full h-3 overflow-hidden">
                  <div 
                    className="bg-gradient-to-r from-indigo-600 to-purple-600 h-full rounded-full transition-all duration-300 ease-out"
                    style={{ width: `${progress}%` }}
                  />
                </div>
                <p className="text-sm text-gray-600 mt-2">{Math.round(progress)}% complete</p>
              </div>

              {file && (
                <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 max-w-md mx-auto">
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 bg-indigo-100 rounded-lg flex items-center justify-center">
                      <svg className="w-6 h-6 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                    </div>
                    <div className="flex-1 text-left">
                      <p className="font-medium text-gray-900">{file.name}</p>
                      <p className="text-sm text-gray-600">{(file.size / 1024 / 1024).toFixed(2)} MB</p>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </main>
      </div>

      {/* Toast Notification */}
      {toast && (
        <Toast
          message={toast.message}
          type={toast.type}
          onClose={() => setToast(null)}
        />
      )}

      {/* Confirmation Modal */}
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
    </>
  );
}