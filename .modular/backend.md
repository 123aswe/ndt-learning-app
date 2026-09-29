# Backend（数据/类型地图）

> 本项目无后端、无 API。本文件登记数据模型与 Mock 数据，供前端定位字段。

## 1. 数据模型（src/types.ts）
| 类型 | 关键字段 |
| ---- | ---- |
| Question | id / text / options[{key,text}] / correct / explanation / category(NDTMethod) / level / difficulty / knowledgePoint / standard |
| Category | id(NDTMethod) / name / fullName / description / questionCount / completedCount / icon |
| TrainingSet | id / title / category / questionCount / completedCount / estimatedMinutes / difficulty / description |
| Achievement | id / title / description / icon / earned / progress / maxProgress |
| WrongRecord | questionId / wrongCount / lastWrongDate / history[{date,answer,correct}] / mastered |
| userStats（普通对象） | name / level / xp / todayCorrect / todayTotal / streak / weeklyQuestions / totalQuestions / accuracy / weeklyAccuracy / knowledgeBreakdown |

## 2. Mock 数据（src/data/mockData.ts）
| 数据 | 说明 |
| ---- | ---- |
| questions | 21 道真实 NDT 题目（UT/RT/MT/PT），含解析与知识点 |
| categories | 7 个分类（UT/RT/MT/PT/ET/VT/综合），含题数与完成数 |
| trainingSets | 4 个训练集 |
| achievements | 6 个成就（3 已获得） |
| wrongRecords | 4 条错题记录 |
| userStats | 用户统计（姓名张明远、连续 12 天、正确率 81% 等） |

## 3. 视觉字段映射（2026-09-29 重构后）
- 旧版 `Category.color / gradient`（高饱和品牌色）不再直接用于背景渐变
- 新版视觉规则：分类用「低饱和主色 + 图标」呈现，进度统一用主色 `#5F8D8C`，状态用 `#6FA37C`/`#C17B7B`，见 `.modular/ui-brief.md`
- 数据字段本身不变（结构不动，只改渲染方式）

## 4. 变更历史
| 日期 | 变更 |
| ---- | ---- |
| 2026-09-29 | 数据模型未变；仅视觉渲染方式调整（渐变 → 低饱和纯色） |
