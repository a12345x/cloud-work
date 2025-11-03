// admin-users/index.js - 支持分页、搜索、排序
const AWS = require('aws-sdk');
const docClient = new AWS.DynamoDB.DocumentClient();

exports.handler = async (event) => {
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type,Authorization'
    };

    // 处理预检请求 (CORS preflight)
    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers, body: '' };
    }

    // TODO: 替换为真实 JWT 验证
    const isAuthenticated = true;
    if (!isAuthenticated) {
        return {
            statusCode: 403,
            headers,
            body: JSON.stringify({ success: false, error: '无权访问' })
        };
    }

    const tableName = 'grades-system-table';

    let body;
    try {
        body = event.body ? JSON.parse(event.body) : {};
    } catch (e) {
        return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ success: false, error: '无效的 JSON 格式' })
        };
    }

    const action = body.action;
    const user = body.user || {}; // 提取 user 对象
    const page = Math.max(1, parseInt(body.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(body.limit) || 10));
    const offset = (page - 1) * limit;

    if (!action) {
        return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ success: false, error: '缺少 action 参数' })
        };
    }

    try {
        // ✅ 获取用户列表
        if (action === 'getUsers') {
            const searchTerm = (body.search || '').toLowerCase();

            const params = {
                TableName: tableName,
                FilterExpression: 'SK = :sk',
                ExpressionAttributeValues: { ':sk': 'METADATA' },
                ProjectionExpression: 'PK, #name, #class, subject, #role',
                ExpressionAttributeNames: {
                    '#name': 'name',
                    '#class': 'class',
                    '#role': 'role'
                }
            };

            const result = await docClient.scan(params).promise();
            let items = result.Items || [];

            const users = items
                .filter(item => {
                    const pk = item.PK || '';
                    return ['STUDENT#', 'TEACHER#', 'ADMIN#'].some(prefix => pk.startsWith(prefix));
                })
                .map(item => {
                    const [rolePrefix, id] = item.PK.split('#');
                    const role = rolePrefix.toLowerCase();
                    return {
                        id,
                        name: item.name || '未知',
                        role,
                        class: item.class || item.subject || ''
                    };
                })
                .filter(u => {
                    if (!searchTerm) return true;
                    return (
                        u.id.toLowerCase().includes(searchTerm) ||
                        u.name.toLowerCase().includes(searchTerm) ||
                        u.class.toLowerCase().includes(searchTerm)
                    );
                })
                .sort((a, b) => a.name.localeCompare(b.name, 'zh'));

            const total = users.length;
            const paginatedUsers = users.slice(offset, offset + limit);

            return {
                statusCode: 200,
                headers,
                body: JSON.stringify({
                    success: true,
                    data: paginatedUsers,
                    totalPages: Math.ceil(total / limit),
                    total
                })
            };
        }

        // ✅ 创建用户
        if (action === 'createUser') {
            const { id, name, password = '123123', role, class: className } = user;

            if (!id || !name || !role) {
                return {
                    statusCode: 400,
                    headers,
                    body: JSON.stringify({
                        success: false,
                        error: '缺少必要字段: id, name, role'
                    })
                };
            }

            const validRoles = ['student', 'teacher', 'admin'];
            if (!validRoles.includes(role)) {
                return {
                    statusCode: 400,
                    headers,
                    body: JSON.stringify({
                        success: false,
                        error: '角色必须是 student、teacher 或 admin'
                    })
                };
            }

            const PK = `${role.toUpperCase()}#${id}`;
            const checkParams = {
                TableName: tableName,
                Key: { PK, SK: 'METADATA' }
            };

            const existing = await docClient.get(checkParams).promise();
            if (existing.Item) {
                return {
                    statusCode: 409,
                    headers,
                    body: JSON.stringify({
                        success: false,
                        error: '用户已存在'
                    })
                };
            }

            const hashedPassword = password; // TODO: 使用 bcrypt.hash(password, 10)

            const params = {
                TableName: tableName,
                Item: {
                    PK,
                    SK: 'METADATA',
                    name,
                    password: hashedPassword,
                    role,
                    timestamp: new Date().toISOString()
                },
                ConditionExpression: 'attribute_not_exists(PK)'
            };

            if (role === 'student') {
                params.Item.class = className || '未分配班级';
            } else if (role === 'teacher') {
                params.Item.subject = className || '未分配科目';
            }

            await docClient.put(params).promise();

            return {
                statusCode: 200,
                headers,
                body: JSON.stringify({
                    success: true,
                    message: '用户创建成功'
                })
            };
        }

        // ✅ 删除用户（接收 { id, role }）
        if (action === 'deleteUser') {
            const { id, role } = user;

            if (!id || !role) {
                return {
                    statusCode: 400,
                    headers,
                    body: JSON.stringify({
                        success: false,
                        error: '删除操作需要提供 id 和 role'
                    })
                };
            }

            const PK = `${role.toUpperCase()}#${id}`;
            const params = {
                TableName: tableName,
                Key: { PK, SK: 'METADATA' }
            };

            try {
                await docClient.delete(params).promise();
                return {
                    statusCode: 200,
                    headers,
                    body: JSON.stringify({
                        success: true,
                        message: '用户删除成功'
                    })
                };
            } catch (error) {
                console.error('删除用户错误:', error);
                if (error.code === 'ResourceNotFoundException') {
                    return {
                        statusCode: 404,
                        headers,
                        body: JSON.stringify({
                            success: false,
                            error: '用户不存在'
                        })
                    };
                }
                throw error;
            }
        }

        // ❌ 未知 action
        return {
            statusCode: 400,
            headers,
            body: JSON.stringify({
                success: false,
                error: `不支持的操作: ${action}`
            })
        };
    } catch (error) {
        console.error('Lambda 错误:', error);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({
                success: false,
                error: '服务器内部错误',
                details: error.message
            })
        };
    }
};