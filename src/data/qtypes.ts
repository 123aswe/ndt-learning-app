/* ============================================================
   题型标签与判分口径（跨端一致常量：与 server/modules/bank.py 同步）
     judge 判断 / single 选择 / multi 多选 / calc 计算 / calcsel 计算选择 / short 简答
   App 内统一从这里取，别再各页面各写一份
   （components/RandomDrillSheet.tsx、screens/ExamSetupScreen.tsx 里还留着历史副本，改动时一起看）
   ============================================================ */

export const QTYPE_LABELS: Record<string, string> = {
  judge: '判断题',
  single: '选择题',
  multi: '多选题',
  calc: '计算题',
  calcsel: '计算选择题',
  short: '简答题',
}

/** 展示顺序：与后端 QTYPE_NAMES 声明顺序、后台题库管理一致 */
export const QTYPE_ORDER = ['judge', 'single', 'multi', 'calc', 'calcsel', 'short'] as const

/** 多选题：答案是字母集合（如 'ACD'），判分与选项顺序无关 */
export const MULTI_QTYPES = ['multi']

/** 需要在选项里选的题型（单选 / 多选 / 计算选择题）——这三个必须有选项才能作答 */
export const CHOICE_QTYPES = ['single', 'multi', 'calcsel']

/** 多选答案归一：只留字母、去重、按字母升序（'C、a' → 'AC'），与后端 normalize_multi_answer 同口径 */
export function normalizeMultiAnswer(raw: string): string {
  return Array.from(new Set((raw || '').toUpperCase().replace(/[^A-Z]/g, ''))).sort().join('')
}

/** 判分：多选按字母集合比，其余去空白转大写比（与后端 bank.answers_match 同口径） */
export function answersMatch(qtype: string, userAnswer: string, correct: string): boolean {
  if (MULTI_QTYPES.includes(qtype)) {
    return normalizeMultiAnswer(userAnswer) === normalizeMultiAnswer(correct)
  }
  return (userAnswer || '').trim().toUpperCase() === (correct || '').trim().toUpperCase()
}

/** 需要「对照参考答案自评」的题：简答题，以及没有选项的计算题（考生自己写算式再核对） */
export function isSelfAssessQtype(qtype: string, optionCount: number): boolean {
  return qtype === 'short' || !optionCount
}
