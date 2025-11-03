# 学生成绩查询系统

基于 AWS Serverless 技术栈构建，支持学生、教师、管理员三种角色。

## 📁 项目结构
- `/frontend`: 前端 HTML/CSS/JS
- `/backend`: Lambda 函数源码
- `/config`: 接口与数据库配置
- `/docs`: 架构图与操作截图

## 🔐 测试账号
- 学生：s001 / 123123
- 教师：t001 / 123123
- 管理员：a001 / 123123

## 🌐 访问地址
前端：http://student-frontend-bucket-cloud-work.s3-website-us-east-1.amazonaws.com/  
API：https://h4sypcwygd.execute-api.us-east-1.amazonaws.com/prod

## 📎 部署说明
# 学生成绩查询系统

## 功能简介
- 支持学生、教师、管理员三类用户登录
- 学生可在规定时间内查询个人成绩
- 老师可录入、修改、删除成绩，支持文件上传，还可设置学生查询新成绩时间段
- 管理员可管理用户信息

## 技术栈
- 前端：HTML/CSS/JS
- 后端：Node.js + AWS Lambda
- 数据库：DynamoDB
- 文件存储：S3
- 认证：JWT

## 部署步骤
1. 初始化 DynamoDB 表结构，添加表数据
2.创建 S3 桶用于托管前端网站
3. 上传 `frontend/*` 到 S3，并启用静态网站托管
4. 在 Lambda 中部署所有函数，配置 IAM 权限（访问 DynamoDB、S3）
5. 在 API Gateway 中创建 REST API，连接各 Lambda 函数
6. 配置 S3 事件触发Lambda 

## 运行、测试
1、http://student-frontend-bucket-cloud-work.s3-website-us-east-1.amazonaws.com/，在浏览器访问前端地址，进入index.html登录页面，可实现三种身份登入，学生、老师和管理员，通过学号/工号和密码登录，API Gateway接收前端请求并路由到对应Lambda——login-functoin，后端验证身份后返回JWT Token，验证通过转到相应角色页面。
2、学生登入学生成绩查询页面，显示身份信息（学号，姓名，班级），若在老师设置的时间内可看到自己的成绩，反之则看不到。
3、老师登入进入老师界面，显示身份信息，看到所教科目学生成绩信息，可以修改成绩，可以设置成绩查询时间，可以上传文件导入成绩。
4、管理员登录进入管理员界面，进行用户管理，可以添加、删除老师、学生信息，搜索用户。


## 注意事项
- 所有密码明文存储，不安全，需改进
- 文件上传需设置 CORS ，上传文件仅支持UTF-8及其相关编码文件，可改进
- 启用 CloudWatch 日志监控