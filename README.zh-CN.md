# Lotus Next

[English](README.md) · [简体中文](README.zh-CN.md)

![Lotus Next 品牌插画：水边一朵发光的莲花，象征清澈与美。](docs/assets/lotus-next-nature-hero.png)

*品牌插画，不是软件截图。莲花象征清澈与美。*

**在浏览器或 Bodhi 桌面应用里跟进 agent 的工作。** Lotus Next 是 [Bamboo](https://github.com/bigduu/Bamboo-agent) 的 React 界面，Bamboo 是 [Zenith](https://github.com/bigduu/Zenith) 本地 AI agent 套件的核心。它把会话、工具活动、权限请求和运行时设置放在同一个地方。

如果你已经在运行 Bamboo，可以直接用浏览器界面；也可以安装 [Bodhi](https://github.com/bigduu/Bodhi-AI/releases/latest)，用桌面外壳来管理引擎。Lotus Next 只提供界面；agent 由 Bamboo 运行，并连接你配置的模型 provider 和工具。

## 你可以做什么

- **实时跟进任务**：查看流式回复、推理过程和工具活动，并回应权限确认或提问对话框。
- **让项目会话井井有条**：切换会话、保留草稿，把会话导出为 Markdown 或 PDF。桌面分栏视图支持第二个可交互的对话窗格。
- **配置会话背后的工具**：打开 provider、MCP 服务、插件、技能和权限的设置，以及工作流、定时任务等运行时功能（取决于所连接的 Bamboo 版本是否支持）。
- **适配不同屏幕尺寸**：响应式的桌面/移动布局，浅色/深色/跟随系统主题，以及适合受限环境的图形安全模式。

以上描述的是当前源码，不保证所有连接的后端或较旧的打包应用都具备相同能力。设置界面本身不提供 provider 凭据、MCP 服务或正在运行的调度器。

## 看一个为任务准备好的项目

![Lotus Next 通过 Bamboo 创建一个演示项目，并为新任务选择工作区。](docs/demos/project-workspace.gif)

[静态图片](docs/demos/project-workspace.png) · [录制与复现说明](docs/demos/README.md)

在审计时的源码 pin 上，连接真实 Bamboo 后端录制的真实浏览器画面。使用的是空的临时工作区；没有调用模型，也不代表任务已完成。这是源码行为，不代表已发布桌面应用的验收结果。

## 从源码试用

要求：Node.js **22.12+**、npm，以及兼容的 Bamboo 服务。按照 Bamboo 的[安装说明](https://github.com/bigduu/Bamboo-agent#readme)单独启动 Bamboo，让 API 监听 `127.0.0.1:9562`。然后在本目录中运行：

```bash
npm ci
npm run dev -- --host 127.0.0.1
```

打开 **http://127.0.0.1:9563**。如果是全新的后端，请先完成 `bamboo init`；初始设置页会引导你完成后端/桌面配置。如果你的 Bamboo 实例还没有 provider，打开 **设置 → 提供方** 进行配置。先在示例工作区里做一个小任务，然后跟进工具活动和权限确认。

显式指定 host 参数会让开发服务器只监听回环地址；仓库里不带参数的 `npm run dev` 会监听网络。Vite 会把 `/api` 和 `/v2` 代理到 9562 端口的 Bamboo。后端不可用时，无法执行任务，也无法提供依赖服务端的设置。

构建生产制品：

```bash
npm run build
# 在另一个已安装 Bamboo 的终端中：
bamboo serve --static-dir /absolute/path/to/lotus-next/dist --port 9562
```

Bamboo 就绪后打开 **http://127.0.0.1:9562**。这样使用的就是你刚构建的前端。发布到 npm 的包只包含前端资源，不是独立的 agent 或 CLI。

## 源码、npm 包与桌面版本

Lotus Next 是当前 Bamboo/Bodhi 源码使用的标准界面。旧的 Lotus 前端在这些项目中只保留为显式的回滚路径，而不是默认的生产前端。

2026-10-03 核对结果：

| 层次 | 核实的标识 |
|---|---|
| Zenith pin 和当时观察到的上游 `main` | `1131c275cb441694a41f996228d9f91473d920f5` |
| npm `latest` | `@bigduu/lotus-next@2026.9.22`，源码 `a480e2bb94f5dd08fe4b01b2f8844a2c9ed03245` |
| 最新公开的 Bodhi 安装包 | `app-v2026.9.20`，锁定 Lotus Next `2026.9.16` |

源码在这个 npm 制品之后还有改动，包括 actor-stream/continuity 和工作流选择相关的工作。这些源码改动**不**代表已包含在 `2026.9.22` 或桌面安装包中。源码 `package.json` 有意保留 `0.0.0`；发布和下游采用是独立的步骤。证据见[版本审计](docs/readme-audit.md)。

## 运行时与本地化

界面使用标准的 `/api/v1` REST 调用，以及一个共享的 `/v2/stream` WebSocket（默认 JSON，可选 MessagePack）。浏览器构建和 Tauri 运行时适配器负责选择后端地址；只提供静态文件并不能替代 Bamboo。

`VITE_BACKEND_BASE_URL` 以及新的浏览器端地址覆盖，接受纯 HTTP(S) origin 或精确的 `/api/v1`。不要使用旧的 `/v1` 别名。不要把凭据放进公开的 `VITE_*` 构建变量。推荐从 Bamboo 的 origin 提供生产界面；远程托管需要相应的后端认证和安全传输配置。

i18next 运行时注册了 `en-US`、`zh-CN`、`zh-TW`、`fr-FR`、`ja-JP` 和 `hi-IN`，按需加载，缺失时回退到 `en-US`。部分较新的界面仍有硬编码的中文文字；这并不表示本地化已经完整。

## 开发与验证

```bash
npm run type-check
npm run test:run
npm run verify
npx playwright install chromium
npm run test:e2e:built
```

`verify` 会检查类型、lint、单元测试、架构、构建和包内容。浏览器测试套件在桌面、平板和手机视口下测试构建产物。它的确定性测试数据与连接真实 Bamboo 的验收流程是分开的；两者都不代表做过实体设备或公网测试。

隔离的真实运行时测试、不可变的已发布制品检查和清单验证，见[验证与打包](docs/verification.md)；构建体积的实测背景见[包体积基线](docs/bundle-baseline.md)。这些是给贡献者的检查，不是安装 Bodhi 的前提条件。

## 许可证

项目自有代码和文档采用 [MIT 许可证](./LICENSE)。第三方组件保留各自的许可证和版权声明。
