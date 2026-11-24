# CONTENT-003 批量收集、提取、导入与追溯

## 私人工作目录

使用公开链接、本机已有资料和独立清单。工具运行于 Python 3.12、Node.js 24、Poppler 与 Pillow。原件、题文、图片、导入清单、数据库、执行明细与备份放在仓库外。正常应用 IPC 继续执行文件导入、内容校验、不可变修订保存、区域关联及知识点绑定。Windows 原生执行器使用以 `org.shandong-study.content003-isolated` 为标识构建的专用二进制及进程内的本机 WebView2 测试桥接。发布配置和 IPC 沿用现有产品。构建命令：

```powershell
npm run tauri -- build --debug --no-bundle --config content003-isolated.json
```

配置文件内容为 `{"identifier":"org.shandong-study.content003-isolated"}`。把产物复制到私人目录并核对确实为该标识构建的二进制，再运行导入器。运行时避免与其他该配置的实例重叠。以下命令在 `poc-001b` 下运行，参数使用仓库外绝对路径。

```text
python scripts/content003_collect.py <collection-plan.json> <private-root>
python scripts/content003_extract.py <private-root> <original.pdf> <anchors.json>
python scripts/content003_extract.py <private-root> <original.pdf> <rendered.json> --selection <regions.json>
node scripts/content003_native.mjs restore <private-root> <binary> <baseline.knowbackup>
node scripts/content003_native.mjs backup <private-root> <binary> <before-batch.knowbackup>
node scripts/content003_native.mjs preview <private-root> <binary> <batch.json> <journal.json>
node scripts/content003_native.mjs import <private-root> <binary> <batch.json> <journal.json>
python scripts/content003_trace.py <study.sqlite3> <baseline-trace.json> <journal.json> <trace.json> --as-of YYYY-MM-DD
python scripts/content002_trace_audit.py <study.sqlite3> <trace.json> --private-root <private-root> --mode full --as-of YYYY-MM-DD
python scripts/content003_evidence.py <final.knowbackup> <fresh-empty-path> --before <baseline-study.sqlite3>
```

## 清单和断点

- 收集清单逐行包含 `id`、`paper_key`、`path`、`year`、`region`、`subject`、`role`、`source_url` 与 `download_url` 或 `local_path`。如有上游证据，可指定预计 `bytes`、`sha256`、`pages`。工具顺序下载，校验暂存文件后再移入正式路径。成功文件在后续运行中复检并复用。失败进入待确认。本工具接受已发现的文件索引或由人工核实的直链。资源配对和异版判断使用稳定卷别键，完全相同文件使用 SHA-256。文件清单同时提供 PDF 实际页数和阶段计时。
- 文件确认与试卷拆分独立推进。下载后先确认卷首、年份卷别、连续题号、末题、缺页和必要附件。配套材料的角色按实际内容登记。只有卷面完整且具备必要作答附件的试卷可标为完整，缺参考答案的完整纸面原卷另列。截图范围使用从零起算页码及归一化 `[x0,y0,x1,y1]`，跨页按原顺序列多个区域。提取工具可给出文本的坐标线索，并能渲染纯扫描页的明确选区。
- 批量导入清单为 `{version:1,papers:[],questions:[]}`。试卷包含稳定 `key`、`title`、`subject`、年份地区、`source_url`、`complete` 和按角色登记的 `files`，文件含路径、页数、哈希和具体来源。应用来源栏长度不足时，`application_source` 用来源入口，侧车保留完整链接。试题含 `key`、学科、原卷键、稳定 `source_key`、多页区域、题型、整数总分和知识点 ID。可填写题干、答案、解析文本，也可提供应用格式的 `content`（包括 v1/v2 富文本与小问）。`images` 和 `analysis_images` 按顺序列出带哈希的 PNG。无原卷题提供 `source.kind/url/path/sha256`。同一材料只保存一个逻辑题，开放题的参考作答和评分说明分别标明。
- 初始导入登记为 `{"version":1,"papers":{},"questions":{}}`。应用事务成功后，以同步临时文件和重命名更新登记。出现已写应用、未更新登记时，重跑以原卷字节哈希、卷名和学科找回文件 ID，以试题稳定 ID 找回并比较初始修订、区域和附件，然后补登记。正式用户后续修订及先前组卷固定引用不经此流程编辑。独立错误逐项记录，成功项留存。异常终止后若遗留登记锁，确认专用应用和导入进程均已退出，再移除该批的 `.lock` 后重跑。
- 确认为同一题时使用显式 `duplicate_of` 与原卷区域 IPC，只增加出现记录。相同字节截图或结构化题面签名是待核候选。不同排版截图、选项重排、异文改编和既有未指纹化记录需要 DEC-039 的内容核对。卷别冲突及同名异版须先审查，不自动建立新的原卷。
- 一批开始前保存应用备份。应用退出后更新侧车并全库审计，保存备份、私有原件及同状态文件清单。备份独立解包逐项复算哈希，再用应用实际预检、切换、重启。失败注入只在专用库及合成测试夹具中执行。

## 来源结构 v2

`resources` 登记每个 PDF 文件版本。`links` 登记实际的卷、文件、题号、题目、修订与区域，并可列配套答案来源。新增 `question_sources` 记录稳定来源 ID、原始 URL、哈希、来源类型与每条修订的答案、解析、审核事实。其 PDF 条目通过文件来源 ID 和卷内题号双向到达 `links`。独立网页、截图和私人文档登记自己的受控原件及字节哈希。一个稳定来源 ID 可在追加修订后复用，必须保留旧行。独立题也须逐修订登记。导入器从明确提交的初始修订重建登记，全库审计报告后续尚未登记的修订。

每卷拆题状态为 `awaiting_split`、`partial` 或 `split_complete`。完整性登记为 `complete` 或 `missing_required_material`。文件发现、下载、待文件确认与异常队列来自收集输出，入库后由实际 PDF 记录和拆分状态反映。内容审核来自相应修订的实际审核记录。

`scoped` 检查声明的卷及相应登记，也可沿用 CONTENT-002 v1 参数。`full` 从数据库反查全部卷、文件版本、题目、当前与历史修订、出现关系、区域和固定引用。v2 可对确实不属个人库的记录提供 `exclusions`，每项须有实际记录 ID、记录类别和证据。本次扩充实际库无排除项。解析字段的存在状态和人工核实完整性的工作记录分开。
