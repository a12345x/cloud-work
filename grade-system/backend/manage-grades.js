// manage-grades/index.js
const AWS = require('aws-sdk');
const docClient = new AWS.DynamoDB.DocumentClient();

const TABLE_NAME = process.env.TABLE_NAME || 'grades-system-table';

// ✅ 【修改】支持从 body、query string、path 参数中获取 teacherId
function getTeacherId(event) {
    // 1. 优先从 body 中获取（POST 请求）
    if (event.body) {
        try {
            const body = JSON.parse(event.body);
            if (body.teacherId) return body.teacherId;
        } catch (e) {
            console.warn('解析 body 失败:', e.message);
        }
    }

    // 2. 其次从查询参数中获取（GET 请求）
    if (event.queryStringParameters?.teacherId) {
        return event.queryStringParameters.teacherId;
    }

    // 3. 最后从路径参数中获取（如 /teachers/T001）
    if (event.pathParameters?.id) {
        return event.pathParameters.id;
    }

    return null;
}

async function getTeacherSubjects(teacherId) {
    const res = await docClient.get({
        TableName: TABLE_NAME,
        Key: { PK: `TEACHER#${teacherId}`, SK: 'METADATA' }
    }).promise();
    return res.Item?.subjects || [];
}

async function getTeacherInfo(teacherId) {
    const res = await docClient.get({
        TableName: TABLE_NAME,
        Key: { PK: `TEACHER#${teacherId}`, SK: 'METADATA' }
    }).promise();

    if (!res.Item) {
        return null;
    }

    return {
        teacherId: teacherId,
        name: res.Item.name || '未知教师',
        subject: res.Item.subject || '未知科目',
        subjects: res.Item.subjects || [],
        email: res.Item.email
    };
}

exports.handler = async (event) => {
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET,PUT,POST,OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type,Authorization,X-Amz-Date,Cache-Control,X-API-Key'
    };

    if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

    // ✅ 修改：不要用 401 表示参数缺失，改用 403 + 更明确的错误信息
    const teacherId = getTeacherId(event);
    if (!teacherId) {
        return { 
            statusCode: 403, 
            headers, 
            body: JSON.stringify({ error: '无权访问：缺少教师ID' }) 
        };
    }

    try {
        // GET /teachers/{id}
        if (event.httpMethod === 'GET' && event.path.startsWith('/teachers/')) {
            const id = event.pathParameters?.id;
            if (id !== teacherId) return { statusCode: 403, headers, body: JSON.stringify({ error: '无权访问' }) };
            const subjects = await getTeacherSubjects(teacherId);
            return { statusCode: 200, headers, body: JSON.stringify({ teacherId, subjects }) };
        }

        // GET /grades/subject?subject=xxx
        if (event.httpMethod === 'GET' && event.path === '/grades/subject') {
            const subject = event.queryStringParameters?.subject;
            if (!subject) return { statusCode: 400, headers, body: JSON.stringify({ error: '缺少 subject' }) };
            const subjects = await getTeacherSubjects(teacherId);
            if (!subjects.includes(subject)) return { statusCode: 403, headers, body: JSON.stringify({ error: '无权限' }) };

            const scan = await docClient.scan({
                TableName: TABLE_NAME,
                FilterExpression: 'attribute_exists(grade) AND subject = :s',
                ExpressionAttributeValues: { ':s': subject }
            }).promise();

            // 补全学生姓名
            const studentIds = [...new Set(scan.Items.map(i => i.student_id))];
            const names = {};
            for (const id of studentIds) {
                const meta = await docClient.get({
                    TableName: TABLE_NAME,
                    Key: { PK: `STUDENT#${id}`, SK: 'METADATA' }
                }).promise();
                names[id] = meta.Item?.name || '未知';
            }

            const grades = scan.Items.map(i => ({
                student_id: i.student_id,
                name: names[i.student_id],
                grade: i.grade,
                semester: i.semester,
                timestamp: i.timestamp
            }));

            return { statusCode: 200, headers, body: JSON.stringify({ subject, grades }) };
        }

        // POST /view-period
        if (event.httpMethod === 'POST' && event.path === '/view-period') {
            const { startTime, endTime } = JSON.parse(event.body || '{}');
            if (!startTime || !endTime) return { statusCode: 400, headers, body: JSON.stringify({ error: '缺少时间' }) };
            await docClient.put({
                TableName: TABLE_NAME,
                Item: {
                    PK: 'SYSTEM#VIEW_PERIOD',
                    SK: 'CONFIG',
                    startTime,
                    endTime,
                    updatedBy: teacherId,
                    timestamp: new Date().toISOString()
                }
            }).promise();
            return { statusCode: 200, headers, body: JSON.stringify({ message: '设置成功' }) };
        }

        // POST /teachers/{id} with action=getTeacherInfo
        if (event.httpMethod === 'POST' && event.path.startsWith('/teachers/')) {
            const pathId = event.path.split('/')[2]; // /teachers/t001 → t001
            if (pathId !== teacherId) {
                return { statusCode: 403, headers, body: JSON.stringify({ error: '无权访问该教师信息' }) };
            }

            const body = JSON.parse(event.body || '{}');
            if (body.action !== 'getTeacherInfo') {
                return { statusCode: 400, headers, body: JSON.stringify({ error: '不支持的操作' }) };
            }

            const info = await getTeacherInfo(teacherId);
            if (!info) {
                return { statusCode: 404, headers, body: JSON.stringify({ error: '教师信息未找到' }) };
            }

            return { statusCode: 200, headers, body: JSON.stringify(info) };
        }

        // ✅ 新增：POST /grades/update - 修改或录入成绩
        if (event.httpMethod === 'POST' && event.path === '/grades/update') {
            const body = JSON.parse(event.body || '{}');
            const { studentId, subject, grade, semester } = body;

            if (!studentId || !subject || grade == null || !semester) {
                return { statusCode: 400, headers, body: JSON.stringify({ error: '缺少必要参数：studentId, subject, grade, semester' }) };
            }

            // 验证教师是否有权限教授该科目
            const subjects = await getTeacherSubjects(teacherId);
            if (!subjects.includes(subject)) {
                return { statusCode: 403, headers, body: JSON.stringify({ error: '无权修改该科目成绩' }) };
            }

            // 写入成绩（主键：PK=STUDENT#<id>, SK=GRADE#<subject>#<semester>）
            await docClient.put({
                TableName: TABLE_NAME,
                Item: {
                    PK: `STUDENT#${studentId}`,
                    SK: `GRADE#${subject}#${semester}`,
                    student_id: studentId,
                    subject,
                    grade,
                    semester,
                    teacherId,
                    timestamp: new Date().toISOString()
                }
            }).promise();

            return { statusCode: 200, headers, body: JSON.stringify({ message: '成绩更新成功', studentId, subject, grade, semester }) };
        }

        return { statusCode: 404, headers, body: JSON.stringify({ error: 'Not Found' }) };
    } catch (error) {
        console.error('Manage grades error:', error);
        return { statusCode: 500, headers, body: JSON.stringify({ error: '服务器错误' }) };
    }
};