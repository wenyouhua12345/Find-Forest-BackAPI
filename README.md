# 巡林后端 API

基于 Express.js 的林业巡检管理后端系统，提供用户管理、任务调度、AI 智能分析、病虫害检测等功能。

## 技术栈

- **框架**: Express.js 4.x
- **数据库**: PostgreSQL（连接池，最大 35 连接）
- **认证**: bcryptjs 密码加密 / 微信小程序登录
- **AI 服务**: 火山引擎豆包大模型（doubao-seed-1-6-251015）
- **病虫害检测**: 外部 Python AI 服务（病树检测 / 害虫识别）
- **文件上传**: Multer（支持图片上传）
- **定时任务**: node-schedule（每日自动派发巡林任务）
- **天气服务**: tianqiapi.com

## 目录结构

```
backend/
├── app.js                          # 入口文件
├── package.json
├── .env                            # 环境变量配置
├── config/
│   └── database.js                 # PostgreSQL 连接池配置
├── controllers/
│   ├── userController.js           # 主要业务逻辑（用户、任务、AI、反馈、轨迹、天气）
│   ├── TreeDetectionService.js     # 病树检测服务客户端
│   └── PestDetectionService.js     # 害虫检测服务客户端
├── routes/
│   └── userRoutes.js               # 路由定义
├── scripts/
│   └── initDatabase.js             # 数据库初始化脚本
├── public/
│   ├── avatars/                    # 用户头像
│   ├── detected_trees/             # 病树检测结果图片
│   ├── detected_pests/             # 害虫检测结果图片
│   ├── feedback/                   # 反馈图片
│   └── audio/                      # 音频输出
└── uploads/
    ├── temp/                       # Multer 临时上传目录
    ├── tasks/                      # 任务相关图片
    └── chat_images/                # AI 聊天图片
```

## 快速开始

### 环境要求

- Node.js >= 16
- PostgreSQL 数据库

### 安装与运行

```bash
# 1. 安装依赖
npm install

# 2. 配置环境变量（编辑 .env 文件）
# 参考下方环境变量说明

# 3. 初始化数据库
node scripts/initDatabase.js

# 4. 开发模式启动
npm run dev

# 5. 生产模式启动
npm start
```

服务默认运行在 `http://localhost:3000`。

### 环境变量

| 变量名 | 说明 |
|--------|------|
| `DB_HOST` | PostgreSQL 主机地址 |
| `DB_PORT` | PostgreSQL 端口 |
| `DB_NAME` | 数据库名称 |
| `DB_USER` | 数据库用户 |
| `DB_PASSWORD` | 数据库密码 |
| `PORT` | Express 服务端口（默认 3000） |
| `NODE_ENV` | 运行环境（development / production） |
| `WECHAT_APPID` | 微信小程序 AppID |
| `WECHAT_SECRET` | 微信小程序密钥 |
| `JWT_SECRET` | JWT 令牌密钥 |

## API 接口

### 用户管理

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/user/register` | 用户注册 |
| POST | `/api/user/login` | 用户名密码登录 |
| POST | `/api/user/fastlogin` | 微信小程序快捷登录 |
| POST | `/api/user/openidcheck` | 检查 OpenID 是否已注册 |
| POST | `/api/user/reset-password` | 重置密码（管理员） |
| GET | `/api/user/profile` | 获取用户档案 |
| PUT | `/api/user/profile` | 更新用户档案 |
| GET | `/api/user/getusers` | 获取所有用户列表 |
| POST | `/api/user/avatar` | 上传头像（8MB，jpg/png/gif） |
| DELETE | `/api/user/avatar` | 删除头像 |

### 任务管理

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/user/create` | 创建并分配任务 |
| GET | `/api/user/tasks` | 按用户 ID 获取任务 |
| GET | `/api/user/getalltasks` | 获取所有任务 |
| PUT | `/api/user/:taskId` | 更新任务状态 |
| GET | `/api/user/detail/:taskId` | 获取任务详情（含提交记录） |
| POST | `/api/user/submit-task` | 提交任务（支持描述、图片、GPS） |
| POST | `/api/user/upload-task-image` | 上传任务图片 |

### AI 智能服务

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/user/chatai` | AI 对话（支持图片和文本） |
| POST | `/api/user/generate-weekly-report` | 生成 AI 周报（基于近 30 天数据） |
| POST | `/api/user/evaluate-user` | AI 员工评估 |
| POST | `/api/user/describe-pest` | AI 害虫描述（昆虫学家视角） |

### 病树检测

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/user/detect-tree` | 单张图片病树检测 |
| POST | `/api/user/detect-trees/batch` | 批量检测（最多 10 张） |
| GET | `/api/user/detect-tree/health` | 检测服务健康检查 |
| GET | `/api/user/test-python` | Python 服务连接测试 |

### 害虫检测

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/user/detect-pest` | 单张图片害虫识别 |
| POST | `/api/user/batch-detect-pests` | 批量害虫识别 |
| GET | `/api/user/pest-health` | 害虫服务健康检查 |
| GET | `/api/user/supported-pests` | 获取支持的害虫类型列表 |

### 反馈管理

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/user/feedback/upload` | 上传反馈图片 |
| POST | `/api/user/feedback/submit` | 提交反馈 |
| GET | `/api/user/feedback/list` | 获取个人反馈列表 |
| GET | `/api/user/feedback/admin/list` | 管理员获取全部反馈 |
| PUT | `/api/user/feedback/audit` | 审核反馈 |
| GET | `/api/user/feedback/detail` | 获取反馈详情 |

### 轨迹追踪

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/user/track/upload` | 上传巡逻轨迹（GCJ02 坐标） |
| GET | `/api/user/track/query` | 按任务 ID 查询轨迹 |
| PUT | `/api/user/track/update` | 更新轨迹 |

### 天气

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/user/weather` | 获取当前天气（支持城市参数） |

### 健康检查

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/health` | 服务健康检查 |

## 定时任务

系统每天 **08:00** 自动执行以下逻辑：

1. 从 tianqiapi.com 获取南平地区天气
2. 如果天气非雨天，为所有用户创建当日巡林任务（截止时间 18:00）
3. 自动将过期任务标记为 `expired`

## 数据库表

### users 表
存储用户基本信息（姓名、角色、部门、联系方式、头像等）

### logins 表
存储用户登录凭据（用户名、bcrypt 加密密码、微信 OpenID）

## 安全注意事项

- 生产环境部署前，请将 `.env` 中的数据库密码和 API 密钥替换为实际安全凭据
- 建议启用 JWT 令牌认证机制以保护 API 接口
- 建议添加请求速率限制防止接口滥用
