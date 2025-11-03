// get-grades/index.js
const AWS = require('aws-sdk');
const docClient = new AWS.DynamoDB.DocumentClient();

const TABLE_NAME = process.env.TABLE_NAME || 'grades-system-table';

async function isViewPeriodActive() {
    const params = {
        TableName: TABLE_NAME,
        Key: {
            PK: 'SYSTEM#VIEW_PERIOD',
            SK: 'CONFIG'
        }
    };
    try {
        const res = await docClient.get(params).promise();
        if (!res.Item) return true;
        const now = new Date();
        const start = new Date(res.Item.startTime);
        const end = new Date(res.Item.endTime);
        return now >= start && now <= end;
    } catch (e) {
        console.error('Check view period error:', e);
        return true;
    }
}

exports.handler = async (event) => {
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET,OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type'
    };

    if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

    try {
        const studentId = event.queryStringParameters?.studentId;
        if (!studentId) {
            return { statusCode: 400, headers, body: JSON.stringify({ error: '缺少 studentId' }) };
        }

        if (!(await isViewPeriodActive())) {
            return { statusCode: 403, headers, body: JSON.stringify({ error: '成绩暂未开放查看' }) };
        }

        const data = await docClient.query({
            TableName: TABLE_NAME,
            KeyConditionExpression: 'PK = :pk',
            ExpressionAttributeValues: { ':pk': `STUDENT#${studentId}` }
        }).promise();

        const metadata = data.Items.find(i => i.SK === 'METADATA');
        const grades = data.Items
            .filter(i => i.SK.startsWith('GRADE#'))
            .map(i => ({ subject: i.subject, grade: i.grade, semester: i.semester }));

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                success: true,
                studentId,
                name: metadata?.name || '未知',
                class: metadata?.class,
                grades
            })
        };
    } catch (error) {
        console.error('Get grades error:', error);
        return { statusCode: 500, headers, body: JSON.stringify({ error: '服务器错误' }) };
    }
};