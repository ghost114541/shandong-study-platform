# DEV-011 产品身份与版本

| 环境 | 应用标识 | 用途 |
| --- | --- | --- |
| POC | `org.shandong-study.poc001b` | 历史演示及独立数据 |
| DEV-010.1 | `org.shandong-study.dev010-1d0f1b6b` | 历史专项验收及独立资料 |
| DEV-011 | `org.shandong-study.knowpaper-preview` | 稳定的 Preview 身份，供 0.2.0 和 0.2.1 共用 |
| V1.0 | 待正式发行前确认 | 永久身份和用户迁移另行决策 |

Preview 使用 `%APPDATA%\org.shandong-study.knowpaper-preview` 作为配置根。SQLite、图片、PDF、旧版 JSON 默认为此处，或位于 `data-protection/root.json` 指定的活动库。相同标识保留 WebView2 配置及资源库控制日志的定位规则。独立库和回退库沿用 DEV-010.1 的路径管理。旧 POC 和专项配置可通过显式创建并恢复 `.knowbackup` 迁移。

安装项以 Preview 标识为 HKCU 子键。程序叫 `knowpaper-preview.exe`，开始菜单和桌面展示知卷 KnowPaper（测试版）。发布者字段 KnowPaper 表示项目名称。Authenticode 独立检查记录于各构建 Manifest。

A 和 B 为 `0.2.0` 与 `0.2.1`。正常构建以 Tauri 配置、前端包、Cargo 版本及锁文件同步变更。Rust crate 的内部名称继续供已有模块和历史脚本引用。
