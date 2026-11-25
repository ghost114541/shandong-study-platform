# CONTENT-003.2 独立验收后最小补丁

补丁基线为 `f631338ff367d9dcc5b6c70ecb5d832d60c7835a`。实际执行测试的源码提交为 `030a6a1a7f0c1781efc8dd44275622ee4a5a9e73`。最终交付在原分支，交付提交只追加报告和脱敏证据。交付 HEAD 的完整 SHA 由发布结果单列。关键脚本的 Git blob 与实际执行字节均记录 SHA-256。

## PDF 导入窗口

批处理用 UTF-8 的「导入试卷 PDF」与 Rust 对话框匹配。导入、备份和恢复三个标题均进入跨语言契约校验。文件选择测试替身也校验传入标题。Windows 原生工具沿用窗口进程和标题的精确匹配。

## 多修订重复题

在原基线复现把新原卷挂到初始修订时的 `current_revision_unmapped` 与 `revision_history_gap`。同一道逻辑题可以在多份试卷出现。新出现关系确认了题目和原卷区域，具体修订的内容与核对依据仍由该修订的来源记录提供。

新重复题登记使用独立出现关系，侧车在 `paper_occurrences` 中记录该关系并核对原卷文件与区域。侧车继续分别审计修订来源、固定引用、内容核对和正式审核。已有登记和旧版侧车仍可读。SQLite Schema 9、内容 v1/v2、`.studyzip` v1、`.knowbackup` v1 和 DEC-039/040/041 沿用原协议。

## 执行范围

验证使用独立 Windows 调试构建和合成应用库。真实私人库只做只读检查，确认前后指纹、业务表及资源一致。CONTENT-003.2 历史报告和日志保留。此记录等待网页端最终独立复验。

[验收矩阵](CONTENT-003.2_PATCH_TEST_RESULTS.md) · [版本哈希](poc-001b/output/content003-2-patch/source-binding.json) · [原生日志](poc-001b/output/content003-2-patch/native.log) · [已知问题](CONTENT-003.2_KNOWN_ISSUES.md)
