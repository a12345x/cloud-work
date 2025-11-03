// upload-grades/index.js
const AWS = require('aws-sdk');
const csv = require('csv-parser');
const XLSX = require('xlsx');
const stream = require('stream');

const docClient = new AWS.DynamoDB.DocumentClient();
const TABLE_NAME = process.env.TABLE_NAME || 'grades-system-table';

// ✅ 修改：parseCSV 接收 Buffer，让 csv-parser 自动处理字符编码
function parseCSV(buffer) {
    return new Promise((resolve, reject) => {
        const results = [];
        const parseStream = csv();
        const inputStream = new stream.PassThrough();
        inputStream.end(buffer); // 直接传 Buffer
        inputStream.pipe(parseStream);
        parseStream.on('data', data => results.push(data));
        parseStream.on('end', () => resolve(results));
        parseStream.on('error', reject);
    });
}

function parseExcel(buffer) {
    const wb = XLSX.read(buffer, { type: 'buffer' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    return XLSX.utils.sheet_to_json(ws);
}

exports.handler = async (event) => {
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST,OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type'
    };

    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers, body: '' };
    }

    try {
        const body = JSON.parse(event.body);
        const { teacherId, fileData, fileType } = body;

        if (!teacherId) {
            return { 
                statusCode: 400, 
                headers, 
                body: JSON.stringify({ error: '缺少 teacherId' }) 
            };
        }
        if (!fileData) {
            return { 
                statusCode: 400, 
                headers, 
                body: JSON.stringify({ error: '缺少 fileData' }) 
            };
        }
        if (!fileType || !['csv', 'xlsx', 'xls'].includes(fileType)) {
            return { 
                statusCode: 400, 
                headers, 
                body: JSON.stringify({ error: '不支持的文件类型' }) 
            };
        }

        let records;
        if (fileType === 'csv') {
            let buffer;
            try {
                // ✅ 只做 Base64 解码，不转字符串
                buffer = Buffer.from(fileData, 'base64');
            } catch (e) {
                console.error('Base64 decode failed:', e);
                return { 
                    statusCode: 400, 
                    headers, 
                    body: JSON.stringify({ error: 'Base64 解码失败' }) 
                };
            }
            try {
                // ✅ 将 Buffer 传给 parseCSV，由 csv-parser 处理 UTF-8
                records = await parseCSV(buffer);
            } catch (e) {
                console.error('CSV parsing failed:', e);
                return {
                    statusCode: 400,
                    headers,
                    body: JSON.stringify({ 
                        error: 'CSV 解析失败，可能是编码问题或格式错误', 
                        detail: e.message 
                    })
                };
            }
        } else if (fileType === 'xlsx' || fileType === 'xls') {
            const buffer = Buffer.from(fileData, 'base64');
            records = parseExcel(buffer);
        } else {
            return { 
                statusCode: 400, 
                headers, 
                body: JSON.stringify({ error: '不支持的文件类型' }) 
            };
        }

        const success = [];
        const failures = [];

        for (let i = 0; i < records.length; i += 25) {
            const batch = records.slice(i, i + 25);
            const writes = [];

            for (const row of batch) {
                const { studentId, subject, grade, semester } = row;

                if (!studentId || !subject || grade == null || !semester) {
                    failures.push({ row, error: '缺少必要字段' });
                    continue;
                }

                const g = parseFloat(grade);
                if (isNaN(g) || g < 0 || g > 100) {
                    failures.push({ row, error: '成绩无效' });
                    continue;
                }

                // ✅ 已移除权限校验：直接允许录入
                writes.push({
                    PutRequest: {
                        Item: {
                            PK: `STUDENT#${studentId}`,
                            SK: `GRADE#${subject}`,
                            student_id: studentId,
                            subject,
                            grade: g,
                            semester,
                            teacherId,
                            timestamp: new Date().toISOString()
                        }
                    }
                });
            }

            if (writes.length > 0) {
                try {
                    await docClient.batchWrite({ RequestItems: { [TABLE_NAME]: writes } }).promise();
                    success.push(...writes.map(w => w.PutRequest.Item));
                } catch (e) {
                    failures.push(...writes.map(w => ({ row: w.PutRequest.Item, error: e.message })));
                }
            }
        }

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                successCount: success.length,
                failureCount: failures.length,
                failures
            })
        };

    } catch (error) {
        console.error('Upload error:', error);

        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({
                error: '上传失败',
                detail: error.message,
                stack: process.env.NODE_ENV === 'development' || process.env.DEBUG === 'true' 
                    ? error.stack 
                    : undefined
            })
        };
    }
};