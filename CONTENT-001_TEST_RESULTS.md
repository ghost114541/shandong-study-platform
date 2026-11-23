# CONTENT-001 执行与测试证据

执行日期 2026-11-24。Windows x64 原生 Tauri Debug 应用从基线 `82da6023bf91f5aa4712a6feae835d6c970390f7` 构建，仅用外置配置覆盖试点应用 ID。试点实例先迁移到 `C:\download\KnowPaper\CONTENT-001-private` 下的独立资源库再导入，WebView2 配置和素材证据也在同一私人目录。既有 Preview 数据库仅做只读统计。未更改应用源码、Schema 9 或文件协议。

| 验证 | 结果 | 观察 |
| --- | --- | --- |
| 分支与工作区 | PASS | 目标远程分支初始查询为空。DEV-013 远程头与本地起点均为指定 SHA。 |
| 获取与来源 CSV | PASS | Windows 直连 DNS 失败，改用已配置的系统代理，不修改系统设置。正常下载四份 PDF，逐件 SHA-256 与登记表相符。27 个资源 ID 唯一，父资源引用全部可解析，6 行已导入。 |
| PDF 完整性抽查 | PASS（数学试点） | Poppler 读取 7、2、7、9 页。数学原题版 PDF 第 1–4 页为试题，第 5–7 页为答案附页，保留原字节。卷首题版页数与转载重排后的文件页数不同。第 1 页经渲染确认公式与选项可读。9 页同卷版本保留候选。 |
| 只读脚本 | PASS | `python -B -m unittest discover -s poc-001b/tests -p test_content001_counts.py -v`，3/3。检查不存在路径、Schema 拒绝、逻辑去重、用户修订优先、复合题字段覆盖和测试库字节未改写。 |
| 前端回归与构建 | PASS | `npm test` 37/37。Vite 型检和打包通过。第一次 MSVC 找不到 UCRT/Windows SDK 头，补现有 NuGet 缓存后链接库路径修正，最终原生构建成功。试点 EXE SHA-256 `a0fb0c770008ab94f5589d908564e96a99cd4ade7ab0189fb4bdf442edb0ec60`。 |
| 三类 PDF 导入与查看 | PASS | 原生文件选择器和生产 IPC 导入同一卷的原卷、答案与解析。3/3 SHA-256 与原文件吻合，三个角色的首屏 PDF.js canvas 均就绪，截图留在私人目录。对 WebView2 页面拦截外部 HTTPS 后执行。 |
| 检索、知识点、双向定位 | PASS | 经现有命令写入 3 道题，检索读回各自的当前用户修订。绑定 3 个知识点节点，3/3 可从题到原卷 PDF 第 1 页区域，也可从区域读回题。调用使用应用支持的零基分页。 |
| 自定义组卷 | PASS | 固定 3 条修订引用，重启后核对同一组卷的顺序、引用与三个 PDF 角色。前期单题试组卷也保留。 |
| 完整备份 | PASS | 用原生保存对话框生成 `CONTENT-001-3Q.knowbackup`。容器 v1、Schema 9，清单 4/4 文件长度及 SHA-256 验证一致。隔离解出的数据库聚合与活动库一致。 |
| 真实样本其他路径 | NOT TESTED | 本轮未执行用户确认后的应用恢复切换、第三方图片单独导入、网页题批量导入、实际打印、九科逐题内容核对、macOS 实机。安装或打印回归沿用历史证据。 |

## 试点日志摘要

```text
PRIVATE_ROOT_OK
IMPORTED original 7 acb3d58de5a2538d739d9e246f175c4ec275c4d6179bf1a82cfb6ba4ecdf965d
IMPORTED answer 2 26cb7ee800f1fe799a6b2b985a74f6bc3e7a476793cf11b4ff51261cba296191
IMPORTED analysis 7 0258864d62ea7682a6ac33fe2eb9eafb6f8c2e8f469affda9694fb1dff42f353
SEARCH_KNOWLEDGE_AND_BIDIRECTIONAL_OK 1
ADDITIONAL_QUESTION_OK 2 2
ADDITIONAL_QUESTION_OK 3 3
COMPOSITION_PIN_OK 1,2,3
PDFJS_3_ROLES_OK
BACKUP_OK 4
RESTART_OK
```

失败尝试保存在私人目录。试点驱动最初误用检索返回字段和从 1 开始的页码，之后修正返回字段、零基分页和单题查询词。重试复用已保存的源文件和题目。聚合验证发现 Windows 扩展盘符路径创建的 SQLite URI 不被接受，统计脚本已处理本地盘符前缀，并重跑实际库和合成回归。历史验收保持 DEV-012、DEV-013 CONDITIONAL PASS，Apple Silicon 实机 BLOCKED。
