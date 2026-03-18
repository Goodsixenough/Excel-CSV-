import React, { useState, useRef, useCallback } from 'react';
import * as XLSX from 'xlsx';
import { UploadCloud, FileSpreadsheet, CheckSquare, Square, Download, Loader2, AlertCircle, Table } from 'lucide-react';

// Helper to get Excel column letter (A, B, C...)
const getColumnLetter = (colIndex: number) => {
  let letter = '';
  while (colIndex >= 0) {
    letter = String.fromCharCode((colIndex % 26) + 65) + letter;
    colIndex = Math.floor(colIndex / 26) - 1;
  }
  return letter;
};

export default function App() {
  const [file1, setFile1] = useState<File | null>(null);
  const [file2, setFile2] = useState<File | null>(null);
  const [file2Format, setFile2Format] = useState<'type1' | 'type2'>('type1');
  const [file2Headers, setFile2Headers] = useState<{index: number, letter: string, name: string}[]>([]);
  const [selectedIndices, setSelectedIndices] = useState<number[]>([]);
  const [previewData, setPreviewData] = useState<any[][] | null>(null);
  
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [statusMessage, setStatusMessage] = useState('');
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [isDragging1, setIsDragging1] = useState(false);
  const [isDragging2, setIsDragging2] = useState(false);

  const workerRef = useRef<Worker | null>(null);

  const processFile1 = (file: File) => {
    setFile1(file);
    setResultUrl(null);
    setPreviewData(null);
    setError(null);
  };

  const processFile2 = async (file: File, format: 'type1' | 'type2') => {
    setFile2(file);
    setResultUrl(null);
    setPreviewData(null);
    setError(null);

    try {
      const buffer = await file.arrayBuffer();
      const headerRowIdx = format === 'type1' ? 0 : 2;
      const wb = XLSX.read(buffer, { sheetRows: headerRowIdx + 5 }); // Read first few rows to be safe
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as any[][];
      if (rows.length > headerRowIdx) {
        const headersRow = rows[headerRowIdx] || [];
        const maxCols = Math.max(headersRow.length, 26);
        const headers = Array.from({ length: maxCols }).map((_, i) => {
          let h = headersRow[i];
          let name = h !== undefined && h !== null && h !== '' ? String(h) : `列 ${getColumnLetter(i)}`;
          return {
            index: i,
            letter: getColumnLetter(i),
            name
          };
        });

        if (format === 'type2') {
          headers.push({ index: -1, letter: '新增', name: '电压' });
        }

        setFile2Headers(headers);

        if (format === 'type1') {
          // Default order: D(3), E(4), F(5), M(12), N(13), Q(16), T(19), W(22), X(23), G(6), O(14), P(15)
          const defaultTargetIndices = [3, 4, 5, 12, 13, 16, 19, 22, 23, 6, 14, 15];
          setSelectedIndices(defaultTargetIndices);
        } else {
          // Default order: D(3), E(4), G(6), M(12), R(17), I(8), H(7), F(5), J(9), K(10), 新增(-1)
          const defaultTargetIndices = [3, 4, 6, 12, 17, 8, 7, 5, 9, 10, -1];
          setSelectedIndices(defaultTargetIndices);
        }
      }
    } catch (err) {
      setError('读取第二个文件表头失败，请确保它是有效的 Excel 或 CSV 文件。');
    }
  };

  const handleFile1Change = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      processFile1(e.target.files[0]);
    }
  };

  const handleFile2Change = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      processFile2(e.target.files[0], file2Format);
    }
  };

  const handleFormatChange = (format: 'type1' | 'type2') => {
    setFile2Format(format);
    if (file2) {
      processFile2(file2, format);
    }
  };

  const onDragOver1 = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging1(true);
  }, []);

  const onDragLeave1 = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging1(false);
  }, []);

  const onDrop1 = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging1(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      processFile1(e.dataTransfer.files[0]);
    }
  }, []);

  const onDragOver2 = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging2(true);
  }, []);

  const onDragLeave2 = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging2(false);
  }, []);

  const onDrop2 = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging2(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      processFile2(e.dataTransfer.files[0], file2Format);
    }
  }, [file2Format]);

  const toggleColumn = (idx: number) => {
    setSelectedIndices(prev => 
      prev.includes(idx) ? prev.filter(i => i !== idx) : [...prev, idx]
    );
  };

  const getOutputFileName = () => {
    if (!file1) return '合并结果.xlsx';
    const originalName = file1.name;
    const lastDotIndex = originalName.lastIndexOf('.');
    if (lastDotIndex === -1) return `${originalName}+日度数据.xlsx`;
    const nameWithoutExt = originalName.substring(0, lastDotIndex);
    return `${nameWithoutExt}+日度数据.xlsx`;
  };

  const startMerge = () => {
    if (!file1 || !file2) {
      setError('请先上传两个文件。');
      return;
    }
    if (selectedIndices.length === 0) {
      setError('请至少选择一列要拼接的数据。');
      return;
    }

    setIsProcessing(true);
    setProgress(0);
    setStatusMessage('准备合并...');
    setError(null);
    setResultUrl(null);
    setPreviewData(null);

    workerRef.current = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });

    workerRef.current.onmessage = (e) => {
      const { type, message, progress, blob, error, previewData } = e.data;
      if (type === 'progress') {
        setStatusMessage(message);
        setProgress(progress);
      } else if (type === 'complete') {
        const url = URL.createObjectURL(blob);
        setResultUrl(url);
        setPreviewData(previewData);
        setIsProcessing(false);
        setStatusMessage('合并完成！');
        setProgress(100);
        workerRef.current?.terminate();
      } else if (type === 'error') {
        setError(`合并失败: ${error}`);
        setIsProcessing(false);
        workerRef.current?.terminate();
      }
    };

    const selectedCols = selectedIndices.map(idx => {
      const header = file2Headers.find(h => h.index === idx);
      return { index: idx, name: header ? header.name : `列 ${getColumnLetter(idx)}` };
    });

    workerRef.current.postMessage({
      file1,
      file2,
      selectedCols,
      file2DataRowStartIndex: file2Format === 'type1' ? 1 : 3
    });
  };

  return (
    <div className="min-h-screen bg-slate-50 p-8 font-sans text-slate-900">
      <div className="max-w-4xl mx-auto space-y-8">
        <header className="text-center space-y-2">
          <h1 className="text-3xl font-bold tracking-tight text-slate-900">数据合并工具</h1>
          <p className="text-slate-500">将日频数据按日期拼接到分钟级数据后面 (支持 Excel / CSV)</p>
        </header>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* File 1 Upload */}
          <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
            <div className="flex items-center space-x-3 mb-4">
              <div className="p-2 bg-indigo-50 text-indigo-600 rounded-lg">
                <FileSpreadsheet className="w-6 h-6" />
              </div>
              <div>
                <h2 className="font-semibold text-lg">第一个文件</h2>
                <p className="text-xs text-slate-500">分钟级数据 (第1列为时间)</p>
              </div>
            </div>
            <label 
              className={`flex flex-col items-center justify-center w-full h-32 border-2 border-dashed rounded-xl cursor-pointer transition-colors ${
                isDragging1 
                  ? 'border-indigo-500 bg-indigo-50' 
                  : 'border-slate-300 bg-slate-50 hover:bg-slate-100'
              }`}
              onDragOver={onDragOver1}
              onDragLeave={onDragLeave1}
              onDrop={onDrop1}
            >
              <div className="flex flex-col items-center justify-center pt-5 pb-6 pointer-events-none">
                <UploadCloud className={`w-8 h-8 mb-2 ${isDragging1 ? 'text-indigo-500' : 'text-slate-400'}`} />
                <p className="text-sm text-slate-500 text-center px-4">
                  {file1 ? <span className="font-medium text-indigo-600">{file1.name}</span> : '点击或拖拽上传文件'}
                </p>
              </div>
              <input type="file" className="hidden" accept=".csv, .xlsx, .xls" onChange={handleFile1Change} />
            </label>
          </div>

          {/* File 2 Upload */}
          <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
            <div className="flex items-center space-x-3 mb-4">
              <div className="p-2 bg-emerald-50 text-emerald-600 rounded-lg">
                <FileSpreadsheet className="w-6 h-6" />
              </div>
              <div>
                <h2 className="font-semibold text-lg">第二个文件</h2>
                <p className="text-xs text-slate-500">日频数据 (第2列为时间)</p>
              </div>
            </div>

            <div className="mb-4 flex flex-col space-y-2 text-sm bg-slate-50 p-3 rounded-lg border border-slate-200">
              <span className="text-slate-600 font-medium">文件格式:</span>
              <div className="flex flex-col space-y-2">
                <label className="flex items-center space-x-2 cursor-pointer">
                  <input 
                    type="radio" 
                    name="file2Format" 
                    value="type1" 
                    checked={file2Format === 'type1'} 
                    onChange={() => handleFormatChange('type1')}
                    className="text-indigo-600 focus:ring-indigo-500"
                  />
                  <span>标准格式 (表头在第1行)</span>
                </label>
                <label className="flex items-center space-x-2 cursor-pointer">
                  <input 
                    type="radio" 
                    name="file2Format" 
                    value="type2" 
                    checked={file2Format === 'type2'} 
                    onChange={() => handleFormatChange('type2')}
                    className="text-indigo-600 focus:ring-indigo-500"
                  />
                  <span>特殊格式 (表头在第3行，K列为电压)</span>
                </label>
              </div>
            </div>

            <label 
              className={`flex flex-col items-center justify-center w-full h-32 border-2 border-dashed rounded-xl cursor-pointer transition-colors ${
                isDragging2 
                  ? 'border-emerald-500 bg-emerald-50' 
                  : 'border-slate-300 bg-slate-50 hover:bg-slate-100'
              }`}
              onDragOver={onDragOver2}
              onDragLeave={onDragLeave2}
              onDrop={onDrop2}
            >
              <div className="flex flex-col items-center justify-center pt-5 pb-6 pointer-events-none">
                <UploadCloud className={`w-8 h-8 mb-2 ${isDragging2 ? 'text-emerald-500' : 'text-slate-400'}`} />
                <p className="text-sm text-slate-500 text-center px-4">
                  {file2 ? <span className="font-medium text-emerald-600">{file2.name}</span> : '点击或拖拽上传文件'}
                </p>
              </div>
              <input type="file" className="hidden" accept=".csv, .xlsx, .xls" onChange={handleFile2Change} />
            </label>
          </div>
        </div>

        {/* Column Selection */}
        {file2Headers.length > 0 && (
          <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <h2 className="font-semibold text-lg mb-4">选择要拼接的列</h2>
            <div className="flex flex-wrap gap-3">
              {file2Headers.map((col) => {
                const isSelected = selectedIndices.includes(col.index);
                const isDateCol = col.index === 1; // 2nd column is date
                return (
                  <button
                    key={col.index}
                    onClick={() => !isDateCol && toggleColumn(col.index)}
                    disabled={isDateCol}
                    className={`flex items-center space-x-2 px-3 py-1.5 rounded-lg border text-sm transition-all ${
                      isDateCol 
                        ? 'bg-slate-100 border-slate-200 text-slate-400 cursor-not-allowed' 
                        : isSelected 
                          ? 'bg-indigo-50 border-indigo-200 text-indigo-700 shadow-sm' 
                          : 'bg-white border-slate-200 text-slate-600 hover:border-indigo-300 hover:bg-indigo-50/50'
                    }`}
                  >
                    {isSelected ? <CheckSquare className="w-4 h-4" /> : <Square className="w-4 h-4" />}
                    <span>
                      <span className="font-mono text-xs text-slate-400 mr-1">[{col.letter}]</span>
                      {col.name} {isDateCol && '(时间列)'}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Error Message */}
        {error && (
          <div className="bg-red-50 text-red-600 p-4 rounded-xl flex items-start space-x-3">
            <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
            <p className="text-sm">{error}</p>
          </div>
        )}

        {/* Action Area */}
        <div className="flex flex-col items-center space-y-6 pt-4">
          {!resultUrl && (
            <button
              onClick={startMerge}
              disabled={isProcessing || !file1 || !file2}
              className={`flex items-center justify-center space-x-2 w-full max-w-md py-4 rounded-xl font-medium text-white transition-all ${
                isProcessing || !file1 || !file2
                  ? 'bg-slate-300 cursor-not-allowed'
                  : 'bg-indigo-600 hover:bg-indigo-700 shadow-md hover:shadow-lg active:scale-[0.98]'
              }`}
            >
              {isProcessing ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  <span>{statusMessage}</span>
                </>
              ) : (
                <span>开始合并</span>
              )}
            </button>
          )}

          {/* Progress Bar */}
          {isProcessing && (
            <div className="w-full max-w-md space-y-2">
              <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                <div 
                  className="h-full bg-indigo-600 transition-all duration-300 ease-out"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <p className="text-xs text-center text-slate-500">{progress}%</p>
            </div>
          )}

          {/* Download Button */}
          {resultUrl && (
            <div className="flex flex-col items-center space-y-4 animate-in zoom-in-95 duration-500 w-full">
              <div className="bg-emerald-50 text-emerald-700 px-6 py-3 rounded-full text-sm font-medium">
                🎉 合并成功！
              </div>
              <a
                href={resultUrl}
                download={getOutputFileName()}
                className="flex items-center justify-center space-x-2 w-full max-w-md px-8 py-4 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-medium shadow-md hover:shadow-lg transition-all active:scale-[0.98]"
              >
                <Download className="w-5 h-5" />
                <span>下载 {getOutputFileName()}</span>
              </a>
              <button 
                onClick={() => {
                  setResultUrl(null);
                  setPreviewData(null);
                  setProgress(0);
                }}
                className="text-sm text-slate-500 hover:text-slate-700 underline underline-offset-4"
              >
                重新合并
              </button>

              {/* Preview Table */}
              {previewData && previewData.length > 0 && (
                <div className="w-full mt-8 bg-white p-6 rounded-2xl shadow-sm border border-slate-200 animate-in fade-in slide-in-from-bottom-4 duration-500 overflow-hidden">
                  <div className="flex items-center space-x-2 mb-4">
                    <Table className="w-5 h-5 text-indigo-600" />
                    <h2 className="font-semibold text-lg">合并结果预览 (前5行)</h2>
                  </div>
                  <div className="overflow-x-auto rounded-lg border border-slate-200">
                    <table className="w-full text-sm text-left whitespace-nowrap">
                      <thead className="text-xs text-slate-500 bg-slate-50 uppercase border-b border-slate-200">
                        <tr>
                          {previewData[0].map((header: string, i: number) => (
                            <th key={i} className="px-4 py-3 font-medium">{header}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {previewData.slice(1).map((row: any[], rowIndex: number) => (
                          <tr key={rowIndex} className="hover:bg-slate-50/50">
                            {previewData[0].map((_, colIndex: number) => (
                              <td key={colIndex} className="px-4 py-2 text-slate-600">
                                {row[colIndex] !== undefined && row[colIndex] !== null ? String(row[colIndex]) : ''}
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
    </div>
  );
}
