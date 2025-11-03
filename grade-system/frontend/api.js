const API_BASE = 'https://h4sypcwygd.execute-api.us-east-1.amazonaws.com/prod';

const Api = {
    /**
     * 统一请求方法
     * 所有接口统一使用 POST + action 模式，便于 API Gateway 路由
     * 新增 skipAuth 参数，用于登录等无需 token 的请求
     */
    async request(endpoint, data = {}, method = 'POST', skipAuth = false) {
        let url = `${API_BASE}${endpoint}`; // ✅ 改为 let，允许后续拼接

        // 增强 token 判断：防止 'null' 或 'undefined' 字符串被当作有效 token
        const token = !skipAuth ? localStorage.getItem('token') : null;
        const hasToken = token && token !== 'null' && token !== 'undefined';

        const config = {
            method,
            headers: {
                'Content-Type': 'application/json',
                ...(hasToken ? { 'Authorization': `Bearer ${token}` } : {})
            }
        };

        // 如果是 GET 请求，并且有数据，则拼接到 query string
        if (method === 'GET' && Object.keys(data).length > 0) {
            const queryString = new URLSearchParams(data).toString();
            url += (url.includes('?') ? '&' : '?') + queryString;
        } else if (method !== 'GET') {
            // 非 GET 请求才发送 body
            config.body = JSON.stringify(data);
        }

        try {
            const response = await fetch(url, config);

            // ✅ 统一处理未授权：自动登出
            if (response.status === 401) {
                console.warn('认证失效，正在登出...');
                logout();
                return { error: '登录已过期，请重新登录' };
            }

            let result;
            try {
                result = await response.json();
            } catch (e) {
                return { error: '服务器返回数据格式错误' };
            }

            // ✅ 如果后端返回 error 字段，前端统一处理
            if (result.error) {
                return { error: result.error };
            }

            return result;
        } catch (error) {
            console.error('API 请求失败:', error);
            return { error: '网络错误，请检查连接或重试' };
        }
    },

    // -----------------------------
    // ✅ 已实现的业务方法
    // -----------------------------

    getTeacherInfo(teacherId) {
        return this.request(`/teachers/${teacherId}`, { action: 'getTeacherInfo', teacherId });
    },

    getSubjectGrades(teacherId, subject) {
        return this.request('/grades/subject', { teacherId, subject }, 'GET');
    },

    setViewPeriod(teacherId, startTime, endTime) {
        return this.request('/view-period', { action: 'setViewPeriod', teacherId, startTime, endTime });
    },

    uploadGrades(teacherId, fileData, fileType) {
        return this.request('/grades/upload', { action: 'uploadGrades', teacherId, fileData, fileType });
    },

    /**
     * 获取用户列表（支持搜索、分页）
     */
    getUsers(search = '', page = 1, limit = 10) {
        return this.request('/users/manage', {
            action: 'getUsers',
            search,
            page,
            limit
        });
    },

    /**
     * 创建新用户记录
     * ✅ 修复：后端期望结构为 { action, user: { id, name, role, class } }
     * 原先错误地将字段平铺在根对象，导致 action 被覆盖或 user 为空
     */
    createUserRecord(user) {
        // 角色映射：中文 → 英文
        const roleMap = {
            '学生': 'student',
            '教师': 'teacher',
            '管理员': 'admin'
        };

        const userData = {
            action: 'createUser',
            user: {
                id: user.id?.trim(),
                name: user.name?.trim(),
                role: roleMap[user.role] || user.role?.trim(),
                class: user.className?.trim(),
                password: user.password?.trim() // 后端会使用默认值，但传入更安全
            }
        };

        // 前端校验
        if (!userData.user.id) return Promise.resolve({ error: '缺少用户ID' });
        if (!userData.user.name) return Promise.resolve({ error: '缺少用户名' });
        if (!userData.user.role) return Promise.resolve({ error: '缺少用户角色' });

        return this.request('/users/manage', userData);
    },

    /**
     * 删除用户记录
     * ✅ 修复：使用正确的 action 名称，并传递完整的 user 对象 ({ id, role })
     */
    deleteUserRecord(user) {
        return this.request('/users/manage', {
            action: 'deleteUser',   // ✅ 修复：原为 'delete'，现改为 'deleteUser'
            user                    // ✅ 传入 { id, role } 结构，符合后端预期
        });
    },

    /**
     * 用户登录（跳过认证 token）
     */
    login(id, password) {
        localStorage.removeItem('token');
        return this.request('/auth/login', { action: 'login', id, password }, 'POST', true);
    },

    getGrades(studentId) {
        console.log("📡 正在请求成绩:", studentId); 
        return this.request('/grades?studentId=' + encodeURIComponent(studentId), {}, 'GET');
    },

    async updateGrade(studentId, subject, grade, semester) {
        const userStr = localStorage.getItem('user');
        if (!userStr || userStr === 'null' || userStr === 'undefined') {
            return { error: '用户未登录，请重新登录' };
        }

        let user;
        try {
            user = JSON.parse(userStr);
        } catch (e) {
            console.error('解析用户信息失败:', e);
            return { error: '用户数据异常，请重新登录' };
        }

        const teacherId = user.teacherId || user.id;
        if (!teacherId) {
            console.error('用户信息中缺少 teacherId 或 id:', user);
            return { error: '身份信息不完整，无法确定教师ID' };
        }

        return this.request('/grades/update', {
            studentId,
            subject,
            grade,
            semester,
            teacherId
        }, 'POST');
    }
};

// -----------------------------
// ✅ 暴露全局登出函数
// -----------------------------
function logout() {
    localStorage.removeItem('user');
    localStorage.removeItem('token');
    window.location.href = 'index.html';
}

// -----------------------------
// ✅ 支持 ES Module 导出
// -----------------------------
export { Api, logout };

// -----------------------------
// ✅ 兼容全局使用（开发调试）
// -----------------------------
if (typeof window !== 'undefined') {
    window.Api = Api;
    window.logout = logout;
}