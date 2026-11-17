# DEV-004 重复题关联、高级组合筛选与侧边预览

分支为 `dev/dev-004-advanced-search`，基准为 `d474607c14b7a1ebe7920cfe8b615516c024efc1`。本轮范围对应原计划 [DEV-005 组合检索与侧边预览](docs/07-development-plan.md)。原计划 DEV-004 的独立附件文件服务仍待完成。

阶段 A 通过统一的逻辑题 SQL 视图修复归并后检索。搜索与知识点计数按主逻辑题归一化；详情显示原始关联题目，解除操作只删除明确选中的原题关联。已有重复题修订、审核、原卷题位与组卷固定引用均保留。

阶段 B 增加 Schema 3、本地难度与标签、独立原卷出处标注、组合检索与侧边预览。SQLite 编辑器可创建原卷或按 ID 关联已有原卷，维护本地年份、地区和来源。列表点击在同一工作区读取一题，正文使用已有 KaTeX 和图片渲染，答案需要手动展开。打开完整编辑器后返回时重新查询原筛选和页码。

新 IPC 为 `question_knowledge_links`、`question_metadata`、`save_question_metadata`、`add_paper_occurrence`、`save_paper_metadata`。扩展 `search_questions` 的筛选和排序参数。已有 SQLite 文件路径、DEC-039 至 DEC-041 及 POC-001B JSON 入口沿用原设计。

[Schema 3](DEV-004_SCHEMA.md) · [查询设计](DEV-004_SEARCH_DESIGN.md) · [测试证据](DEV-004_TEST_RESULTS.md) · [遗留事项](DEV-004_KNOWN_ISSUES.md)
