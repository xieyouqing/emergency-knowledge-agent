# 第三方、开源与原创声明

> 比赛要求：使用 AI 工具、开源框架、公开 API、第三方组件须标注来源与许可类型；核心功能逻辑与 AI 融合方案须为本次赛事原创，不得直接复用已完成项目的核心模块。

## 1. 运行依赖

| 名称 | 用途 | 许可 / 性质 | 是否随包分发 |
|---|---|---|---|
| Node.js | 本地/云端代理运行时 | MIT | 否（服务器/本机安装） |
| Python 3 标准库 | 知识校验、构建、部署辅助脚本 | PSF License | 否 |
| Nginx | 线上反向代理 | BSD-2-Clause | 否（服务器安装） |
| Certbot / Let's Encrypt | HTTPS 证书 | Apache-2.0 / 免费 CA | 否 |
| DeepSeek API | 语义判定、工具选择、日常扩写 | 商业 API，按其服务条款使用 | 否（仅服务端调用） |

前端**没有引入** React/Vue/jQuery 等第三方框架，也没有第三方 UI 库；`app/` 下均为本项目代码。

## 2. AI 工具使用

开发过程中使用 AI 编程助手辅助生成、修改代码与文档；所有生成内容经项目成员运行测试、人工复核后合入。AI 助手不参与最终知识条目的专业结论；步骤顺序由人签署（S11）。

本项目未直接复用任何已完成项目的核心模块。核心设计（工具注册表、前置门、双模式路由、来源闸、评测脚本）在本仓库内实现，可逐文件核查。

## 3. 知识内容来源

每条知识条目在 `knowledge/<id>.json` 的 `source` / `source.supplementary` 中逐条标注：

- 发布机构与文件名
- 原始发布页 URL
- 获取/核对日期
- 逐字原文摘录
- 补充来源的 `supports` 用途

主要来源包括中国红十字会、国家卫生健康委/全国 12320 管理中心、应急管理部、地方红十字会与政府网站。来源逐字比对脚本：`tools/check_source_quote.py`。

知识内容为公开科普整理，不能替代专业急救；对外不得宣称“医学正确”“专家认证”。

## 4. 未使用/未分发的第三方资产

- 未打包商业字体、商业图标库、商业图片
- 未使用第三方 TTS 音频文件；朗读由浏览器/系统语音合成实时生成
- 未使用第三方 ASR SDK；ASR 走云服务 API
- 未分发 DeepSeek 模型权重；仅调用 API

## 5. 复核方式

```bash
python tools/validate_knowledge.py
python tools/check_source_quote.py
node tools/selftest_m1.mjs
node tools/selftest_tools.mjs
npm run verify
```

如有第三方许可疑问，以各项目官方许可文本为准。
