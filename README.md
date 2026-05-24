# NodeGet-StatusShow

一个服务器状态展示页，NodeGet的公开探针页面

欢迎开发者基于此版本进行定制，也欢迎 pr 到本项目

## 开发

```bash
npm i
npm run dev
```

## 一键部署

此为官方最推荐的部署方式，方便升级至新版

Fork 本仓库，配置 `NODEGET_CONFIG` 环境变量，然后在 Cloudflare Pages / Vercel / EdgeOne 等静态托管平台构建部署。

要更新版本则就在 fork 的 GitHub 仓库点击 sync 就行，可以轻松且可控的升级

## NodeGet 规范主题

本主题按 NodeGet 规范主题结构构建，编译结果会包含控制面板导入和主题分发需要的关键文件：

```text
nodeget-theme.json
nodeget-theme-files.json
config.json
custom.css
custom.js
download.html
```

`nodeget-theme.json` 用于主题元信息和表单化配置，`nodeget-theme-files.json` 用于控制面板自动读取主题文件，`config.json` 用于保存用户偏好和 Visitor Token。

构建后默认生成无 token 的 `config.json` 模板，避免把本地测试 token 写入分发包。需要部署真实站点时，用 `NODEGET_CONFIG` 或构建后手动替换 `dist/config.json`。

官方写法示例见 `public/config.example.json`：

```json
{
  "user_preferences": {
    "site_name": "NodeGet Status",
    "site_logo": "https://example.com/logo.png",
    "footer": "Powered by NodeGet"
  },
  "site_tokens": [
    {
      "name": "master server node 1",
      "backend_url": "wss://HOST1",
      "token": "Your Visitor Token"
    }
  ]
}
```

本项目原有字段仍然可用：

```json
{
  "theme_config": {
    "site_name": "NodeGet Status",
    "site_logo": "https://example.com/logo.png",
    "footer": "Powered by NodeGet"
  },
  "site_tokens": [
    {
      "name": "master server node 1",
      "backend_url": "wss://HOST1",
      "token": "Your Visitor Token"
    }
  ]
}
```

`site_tokens[].websocket` 和 `site_tokens[].backend_url` 等价；`site_log` 和 `site_logo` 等价；`theme_repo` 和 `repository` 等价。

## 编译结果下载

本项目 build 完是纯静态站， 丢哪都行

执行 `npm run build` 后会在 `dist/` 下生成完整静态文件和版本 ZIP，方便把静态文件部署到其他地方。

如果部署为主题分发站点，也可以打开 `/download.html` 从当前站点按 `nodeget-theme-files.json` 文件清单打包下载。

## 环境变量
推荐使用官方规范的 `NODEGET_CONFIG` 在构建后生成 `dist/config.json`：

```bash
NODEGET_CONFIG='{"user_preferences":{"site_name":"狼牙的探针","site_logo":"https://example.com/logo.png","footer":"Powered by NodeGet"},"site_tokens":[{"name":"master-1","backend_url":"wss://m1.example.com","token":"abc123"}]}'
```

如果没有 `NODEGET_CONFIG`，构建脚本会生成 `nodeget-theme.json` 中 `user_preferences_form` 默认值对应的无 token 配置模板。

> 环境变量是 **build 时** 注入的 改完之后必须重新部署一次才会生效 在面板里光改不重新跑 build 是没用的

兼容旧的 `SITE_*` 写法：

```
SITE_NAME=狼牙的探针
SITE_LOGO=https://example.com/logo.png
SITE_FOOTER=Powered by NodeGet
SITE_1=name="master-1",backend_url="wss://m1.example.com",token="abc123"
SITE_2=name="master-2",websocket="wss://m2.example.com",token="xyz789" 
```

前三个对应 `site_name` / `site_logo` / `footer` 不写就用默认值

`SITE_n` 是主控 值用 `key="value"` 拿逗号串起来 支持 `name` / `backend_url` / `websocket` / `token` 字段 值里要塞引号或反斜杠的话用 `\"` 和 `\\` 转义

从 `SITE_1` 开始连续往上数 中间断了就停 所以加新主控接着 `SITE_3` `SITE_4` 就行

一个 `SITE_n` 都没设的话脚本会保留默认无 token 模板。本地 `npm run dev` 仍然读取 `public/config.json`，方便本地调试。

可以只有一个 `SITE_1`，不强制 `SITE_2` `SITE_3` 之类的
