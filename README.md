# LiDe NodeGet Show

一个基于 NodeGet 的公开探针前端主题，支持节点状态表格、健康地图、多维榜单、详情页图表和主题分发导入。

<a href="https://dash.nodeget.com/#/dashboard/theme-management?add=https://nodeget.org">
  <img src="https://dash.nodeget.com/deploy-button.png" alt="deploy button" width="230px" />
</a>

## 预览

在线预览：

<https://nodeget.org>

主题分发地址：

<https://nodeget.org/>

## 关于 NodeGet

NodeGet 是一个节点监控与探针展示产品。

- 官网：<https://nodeget.com/>
- 后端仓库：[NodeSeekDev/NodeGet](https://github.com/NodeSeekDev/NodeGet)
- 原始前端主题：[NodeSeekDev/NodeGet-StatusShow](https://github.com/NodeSeekDev/NodeGet-StatusShow)

本仓库只是一个 NodeGet 前端主题，修改自 [NodeSeekDev/NodeGet-StatusShow](https://github.com/NodeSeekDev/NodeGet-StatusShow)，不包含 NodeGet 后端服务。

## 安装

推荐通过 NodeGet 控制面板导入主题分发地址：

```text
https://nodeget.org/
```

也可以直接点击上方 Deploy to NodeGet 按钮。

完整主题安装教程请参考官方文档：

<https://nodeget.com/guide/theme/quick-install.html>

## 主题特性

- 默认表格视图，适合节点较多时快速浏览
- 健康状态地图，显示节点覆盖地区和访问者位置
- 多维榜单，包含在线时长、网络质量、流量消耗、硬件负载
- 详情页图表，支持资源、Ping、TCP Ping、流量等维度
- 支持 NodeGet 规范主题分发
- 支持 `nodeget-theme.json` 表单化配置
- 支持 `nodeget-theme-files.json` 文件清单
- 支持 Cloudflare Pages 静态部署

## 主题配置

本主题支持 NodeGet 规范配置：

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

示例文件见：

```text
public/config.example.json
```

## 开发

```bash
npm install
npm run dev
```

构建：

```bash
npm run build
```

构建结果在：

```text
dist/
```

## 说明

本仓库仅提供前端主题代码。使用前需要先部署或使用已有的 NodeGet 后端，并在 NodeGet 控制面板中创建 Visitor Token。

Token 会随静态前端配置下发给浏览器，这是 NodeGet 静态主题的正常使用方式。请使用权限受限的 Visitor Token，不要使用管理权限 Token。

## License

GPL-3.0
