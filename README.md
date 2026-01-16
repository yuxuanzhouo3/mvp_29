# MornSpeaker - 实时 AI 语音翻译聊天平台

MornSpeaker 是一款基于 Next.js 开发的实时 AI 语音翻译聊天应用。它支持多语言实时转录、翻译，并提供完整的房间管理和管理员后台功能。

## 🌟 主要功能

- **实时语音聊天**: 支持多人在线语音交流。
- **实时转录与翻译**: 集成 AI 技术，实现语音自动转录为文字并实时翻译。
- **房间管理**: 用户可以创建、加入和管理不同的聊天房间。
- **管理员后台**: 完整的管理面板，用于管理用户、房间、广告位等。
- **多语言支持 (i18n)**: 适配全球化需求，支持多种语言界面。
- **多端适配**: 响应式设计，完美适配移动端和桌面端。

## 🛠 技术栈

- **前端框架**: [Next.js 15 (App Router)](https://nextjs.org/)
- **核心语言**: [TypeScript](https://www.typescriptlang.org/)
- **UI 组件库**: [Radix UI](https://www.radix-ui.com/), [Shadcn UI](https://ui.shadcn.com/)
- **样式**: [Tailwind CSS](https://tailwindcss.com/)
- **后端服务**: [Supabase](https://supabase.com/) (国际版) / [Tencent CloudBase](https://cloudbase.net/) (国内版)
- **AI 能力**: [Alibaba DashScope](https://help.aliyun.com/zh/dashscope/), [OpenAI](https://openai.com/), [Mistral AI](https://mistral.ai/)
- **状态管理**: 基于自定义的 Store 抽象层，支持多种后端切换

## 🚀 快速开始

### 1. 克隆项目

```bash
git clone https://github.com/lzylovec/MornSpeaker_global.git
cd MornSpeaker_global
```

### 2. 安装依赖

推荐使用 `pnpm` 安装依赖：

```bash
pnpm install
```

### 3. 配置环境变量

复制 `.env.example` 文件并重命名为 `.env.local`，然后填入相应的配置：

```bash
cp .env.example .env.local
```

主要配置项：
- `DASHSCOPE_API_KEY`: 阿里云 DashScope API 密钥。
- `NEXT_PUBLIC_SUPABASE_URL` & `NEXT_PUBLIC_SUPABASE_ANON_KEY`: Supabase 项目配置。
- `TENCENT_ENV_ID` (可选): 腾讯云开发环境 ID。

### 4. 启动开发服务器

```bash
pnpm dev
```

打开 [http://localhost:3000](http://localhost:3000) 即可在浏览器中查看。

## 📂 目录结构

```text
├── app/                # Next.js 页面和路由
│   ├── admin/          # 管理员后台页面
│   ├── api/            # API 路由 (转录、翻译等)
│   └── login/          # 登录页面
├── components/         # 可复用 React 组件
│   └── ui/             # Shadcn UI 基础组件
├── hooks/              # 自定义 React Hooks (录音、TTS等)
├── lib/                # 工具函数和核心库
│   ├── store/          # 数据存储抽象层 (Supabase/Cloudbase)
│   └── supabase/       # Supabase 客户端配置
└── public/             # 静态资源文件
```

## 📝 数据库配置

本项目提供了 `supabase_schema.sql` 文件，你可以直接在 Supabase SQL Editor 中运行以初始化数据库表结构。

## 🤝 贡献指南

欢迎任何形式的贡献！你可以提交 Issue 或者发起 Pull Request。

## 📄 许可证

[MIT License](LICENSE)
