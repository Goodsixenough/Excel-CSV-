import * as XLSX from 'xlsx';

self.onmessage = async (e) => {
  const { file1, file2, selectedCols, file2DataRowStartIndex = 1 } = e.data;

  try {
    self.postMessage({ type: 'progress', message: '正在读取第二个文件 (日频数据)...', progress: 10 });

    const buffer2 = await file2.arrayBuffer();
    const wb2 = XLSX.read(buffer2, { cellDates: true });
    const sheet2 = wb2.Sheets[wb2.SheetNames[0]];
    const rows2 = XLSX.utils.sheet_to_json(sheet2, { header: 1, defval: "" }) as any[][];

    if (rows2.length < 2) throw new Error("第二个文件数据为空或格式不正确");

    // Build Map
    self.postMessage({ type: 'progress', message: '正在建立日期索引...', progress: 30 });
    const dateMap = new Map<string, any[]>();

    const formatDate = (val: any) => {
        if (!val) return "";
        if (val instanceof Date) {
            const yyyy = val.getFullYear();
            const mm = String(val.getMonth() + 1).padStart(2, '0');
            const dd = String(val.getDate()).padStart(2, '0');
            return `${yyyy}-${mm}-${dd}`;
        }
        if (typeof val === 'string') {
            return val.trim().split(/[\sT]/)[0]; // Handles "2023-10-01 10:05" or "2023-10-01T10:05"
        }
        return String(val).trim();
    };

    for (let i = file2DataRowStartIndex; i < rows2.length; i++) {
        const row = rows2[i];
        if (row.length > 1) {
            const dateKey = formatDate(row[1]); // 2nd column (index 1)
            if (dateKey) {
                dateMap.set(dateKey, row);
            }
        }
    }

    self.postMessage({ type: 'progress', message: '正在读取第一个文件 (分钟级数据)...', progress: 50 });
    const buffer1 = await file1.arrayBuffer();
    const wb1 = XLSX.read(buffer1, { cellDates: true });
    const sheet1 = wb1.Sheets[wb1.SheetNames[0]];
    const rows1 = XLSX.utils.sheet_to_json(sheet1, { header: 1, defval: "" }) as any[][];

    if (rows1.length < 1) throw new Error("第一个文件数据为空");

    self.postMessage({ type: 'progress', message: '正在合并数据 (约13万行)...', progress: 70 });
    const result: any[][] = [];
    const header1 = rows1[0];
    const appendedHeaders = selectedCols.map((c: any) => c.name);
    result.push([...header1, ...appendedHeaders]);

    for (let i = 1; i < rows1.length; i++) {
        const row1 = rows1[i];
        if (row1.length === 0) continue;

        const dateKey = formatDate(row1[0]); // 1st column (index 0)
        const row2 = dateMap.get(dateKey);

        const appended = selectedCols.map((c: any) => row2 ? row2[c.index] : "");
        result.push([...row1, ...appended]);

        if (i % 10000 === 0) {
            const p = 70 + Math.floor((i / rows1.length) * 20);
            self.postMessage({ type: 'progress', message: `正在合并数据... (${i}/${rows1.length})`, progress: p });
        }
    }

    self.postMessage({ type: 'progress', message: '正在生成 Excel 文件...', progress: 95 });
    const newSheet = XLSX.utils.aoa_to_sheet(result);
    const newWb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(newWb, newSheet, "Merged Data");

    const outBuffer = XLSX.write(newWb, { bookType: 'xlsx', type: 'array' });
    const blob = new Blob([outBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });

    const previewData = result.slice(0, 6); // Header + 5 rows

    self.postMessage({ type: 'complete', blob, previewData });

  } catch (error: any) {
    self.postMessage({ type: 'error', error: error.message });
  }
};
