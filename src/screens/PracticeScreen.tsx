import React, { useState, useCallback, useEffect, useRef } from 'react'
import { practiceApi, type BankQuestion, type QuestionMyState } from '../api/client'
import {
  ChevronLeftIcon, HeartIcon, ClockIcon, CheckIcon, XIcon, ChevronRightIcon,
  GridIcon, TrashIcon, FlagIcon,
} from '../components/icons'
import { QuestionReportSheet } from '../components/QuestionReportSheet'
import { AiExplainPanel } from '../components/AiExplainPanel'
import { QuestionSolutionPanel } from '../components/QuestionSolutionPanel'
import { RichText } from '../components/RichText'
import { stripRichText } from '../data/richText'
import { QTYPE_LABELS, answersMatch, normalizeMultiAnswer } from '../data/qtypes'
import { useSoftKeyboard } from '../hooks/useSoftKeyboard'

/* ============================================================
   答题页（苹果式浅色）
   结构保持：顶栏 / 进度条 / 题目卡片 / 选项卡片 / 解析面板 / 底部操作 / 退出弹窗
   - 顶栏「题目导航」按钮 → 打开导航面板（网格题号），点击题号跳题
   - 导航颜色 = 我最近一次作答结果（服务端 my_state，一直保留）：对=绿 / 错=红 / 未做=浅灰
     本次会话内答题后立即更新颜色；交卷后服务端与本地一致
   - 导航面板底部「清除全部记录」：删除该范围（方向 / 章节）的我的答题记录，可重新做
   数据来源（全部实时）：
     - 出题：GET /api/practice/questions?category=&topic=（顺序返回范围内全部题目）
     - 交卷：POST /api/practice/submit（每道题写入 answer_records，按登录账号保存）
   ============================================================ */

interface PracticeScreenProps {
  categoryId: string
  /** 章节（topic1），按章节练习时传入 */
  topic?: string
  /** 出题方式：sequential 顺序（默认）/ random 随机 / wrong 错题重练（随机顺序） */
  mode?: 'sequential' | 'random' | 'wrong'
  /** 题型筛选：judge 判断 / single 选择 / calc 计算 / short 简答（空 = 不限） */
  qtype?: string
  /** 管理员创建的题库 id（传了就按题库出题，忽略 categoryId/topic） */
  setId?: number
  /** 顶栏展示用标题（自定义题库名） */
  title?: string
  onExit: () => void
  onComplete: (correct: number, total: number, timeSeconds: number) => void
}

type AnswerState = null | 'correct' | 'wrong'

function formatTime(s: number) {
  const m = Math.floor(s / 60)
  const sec = s % 60
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
}

/** 题目类型标签：判断 / 选择 / 多选 / 计算 / 计算选择 / 简答（代码与后端 QTYPE_NAMES 一致） */
function qtypeLabel(q: BankQuestion): string {
  return QTYPE_LABELS[q.qtype] || '选择题'
}

/** 简答题 / 无选项题：展示参考答案后由考生自评 */
function isSelfAssess(q: BankQuestion): boolean {
  return q.qtype === 'short' || !q.options || q.options.length === 0
}

/** 无选项的计算题：给一个答案输入框，考生先写自己的答案，
 *  提交后系统判分并出现折叠的「题目原题讲解」（解答过程来自题库，题库没配才用 AI） */
function isCalcInput(q: BankQuestion): boolean {
  return q.qtype === 'calc' && (!q.options || q.options.length === 0)
}

export function PracticeScreen({ categoryId, topic, mode = 'sequential', qtype, setId, title, onExit, onComplete }: PracticeScreenProps) {
  /* ── 服务端题目加载 ── */
  const [questions, setQuestions] = useState<BankQuestion[]>([])
  const [scopeTotal, setScopeTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [reloadTick, setReloadTick] = useState(0)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setLoadError('')
    practiceApi
      .questions(categoryId, mode, 2000, { topic, qtype: qtype || undefined, setId })
      .then(res => {
        if (cancelled) return
        setQuestions(res.questions)
        setScopeTotal(res.total_in_scope)
        setLoading(false)
      })
      .catch(err => {
        if (cancelled) return
        setLoadError(err instanceof Error ? err.message : '题目加载失败')
        setLoading(false)
      })
    return () => { cancelled = true }
  }, [categoryId, mode, qtype, topic, setId, reloadTick])

  const [currentIndex, setCurrentIndex] = useState(0)
  const [selected, setSelected] = useState<string | null>(null)
  const [answerState, setAnswerState] = useState<AnswerState>(null)
  const [showExplanation, setShowExplanation] = useState(false)
  const [elapsedSeconds, setElapsedSeconds] = useState(0)
  const [showExitModal, setShowExitModal] = useState(false)
  const [isFavorited, setIsFavorited] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  /** 交卷只执行一次（查看结果 / 退出两条路径共用） */
  const submittedRef = useRef(false)

  /* ── 做题导航状态 ── */
  /** 服务端保留的历史状态：question_id → 对/错（清除记录后为空） */
  const [serverStates, setServerStates] = useState<Record<number, QuestionMyState>>({})
  /** 本次会话的作答：index → {selected, correct}（跳题后能还原已答界面） */
  const [sessionStates, setSessionStates] = useState<Record<number, { selected: string; correct: boolean }>>({})
  /** 导航面板开关 */
  const [showNavigator, setShowNavigator] = useState(false)
  /** 题目疑问（纠错上报）弹层 */
  const [showReport, setShowReport] = useState(false)
  /** 简答题：是否已展开参考答案 */
  const [shortRevealed, setShortRevealed] = useState(false)
  /** 计算题：考生正在输入框里写的答案（提交后写进 sessionStates，切题会被还原） */
  const [calcDraft, setCalcDraft] = useState('')
  /** 清除本组记录的两步确认 */
  const [confirmClear, setConfirmClear] = useState(false)
  const [clearing, setClearing] = useState(false)
  /** v1.85 软键盘弹出（在计算题答案框里打字）时收起底部「上一题 / 下一题」操作条，
      屏幕上只留输入框和键盘；收起键盘后自动恢复 */
  const softKeyboard = useSoftKeyboard()

  /* ── 练习进度（续做） ── */
  /** 进度是否已加载完成（加载完成前不保存，避免用空状态覆盖服务器进度） */
  const progressLoadedRef = useRef(false)
  /** 保存进度的防抖计时器 */
  const saveTimerRef = useRef<number | null>(null)

  const currentQ: BankQuestion | undefined = questions[currentIndex]
  const total = questions.length
  const progress = total > 0 ? (currentIndex / total) * 100 : 0

  useEffect(() => {
    const timer = setInterval(() => setElapsedSeconds(s => s + 1), 1000)
    return () => clearInterval(timer)
  }, [])

  /* 题目加载后：用服务端 my_state 初始化导航颜色；同时读取已保存进度续做 */
  useEffect(() => {
    if (loading) return
    const map: Record<number, QuestionMyState> = {}
    for (const q of questions) map[q.id] = q.my_state ?? null
    setServerStates(map)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [questions, loading])

  /** 某道题导航面板的颜色：本次会话 > 服务端保留 > 未做 */
  const navStateOf = useCallback(
    (index: number): 'correct' | 'wrong' | null => {
      const s = sessionStates[index]
      if (s) return s.correct ? 'correct' : 'wrong'
      const q = questions[index]
      return q ? (serverStates[q.id] ?? null) : null
    },
    [sessionStates, questions, serverStates],
  )

  const answeredCount = Object.keys(sessionStates).length
  const correctCount = Object.values(sessionStates).filter(s => s.correct).length

  /* 题目加载完成后：读取服务端保存的进度，若有则从上次位置继续 */
  useEffect(() => {
    if (loading || progressLoadedRef.current) return
    let cancelled = false
    practiceApi
      .getProgress(categoryId, { topic, qtype, setId, mode })
      .then(prog => {
        if (cancelled) return
        progressLoadedRef.current = true
        if (prog.has_progress && prog.question_ids?.length) {
          // 进度里的题目顺序快照和当前加载的题目一致时才恢复（题库可能已变）
          const ids = prog.question_ids
          const loadedIds = questions.map(q => q.id)
          const sameSet = ids.length === loadedIds.length && ids.every((id, i) => id === loadedIds[i])
          if (sameSet) {
            const restored = prog.answers || {}
            setSessionStates(restored)
            const idx = Math.min(prog.current_index ?? 0, total - 1)
            setCurrentIndex(idx)
            const s = restored[idx]
            setSelected(s ? s.selected : null)
            setAnswerState(s ? (s.correct ? 'correct' : 'wrong') : null)
            setCalcDraft(s && isCalcInput(questions[idx]) ? s.selected : '')
            setShortRevealed(Boolean(s) && isSelfAssess(questions[idx]))
            setShowExplanation(Boolean(s))
          }
        }
      })
      .catch(() => {
        // 读取失败不阻塞答题，只是无法续做
        progressLoadedRef.current = true
      })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, categoryId, mode, qtype, topic, setId, questions, total])

  /* 答题状态或当前题号变化后：防抖保存进度到服务端（加载完成前不保存） */
  useEffect(() => {
    if (!progressLoadedRef.current || loading) return
    // 还没开始做题（没有任何作答且还在第 0 题）时不保存，避免产生空进度
    if (Object.keys(sessionStates).length === 0 && currentIndex === 0) return
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current)
    saveTimerRef.current = window.setTimeout(() => {
      if (questions.length === 0) return
      practiceApi
        .saveProgress({
          category: categoryId,
          topic: topic || '',
          qtype: qtype || '',
          set_id: setId || 0,
          mode,
          question_ids: questions.map(q => q.id),
          answers: sessionStates,
          current_index: currentIndex,
        })
        .catch(() => {
          // 保存失败静默忽略（下次答题会再保存）
        })
    }, 600)
    return () => {
      if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionStates, currentIndex, questions, loading])

  /** 交卷：把本轮答题记录保存到服务端（只执行一次）；进度保留，下次进来接着做 */
  const submitAnswers = useCallback(async () => {
    if (submittedRef.current || answeredCount === 0) return
    submittedRef.current = true
    setSubmitting(true)
    const answers = Object.entries(sessionStates).map(([idx, s]) => ({
      question_id: questions[Number(idx)].id,
      user_answer: s.selected,
      is_correct: s.correct,
    }))
    try {
      await practiceApi.submit(categoryId, elapsedSeconds, answers)
    } catch {
      // 保存失败不打断流程（练习结果页照常展示），下次答题会照常重试保存
    } finally {
      setSubmitting(false)
    }
  }, [sessionStates, questions, categoryId, elapsedSeconds, answeredCount])

  const handleSelect = useCallback((key: string) => {
    if (answerState !== null || !currentQ) return
    // 多选题：点击是「勾选 / 取消勾选」，选好后由底部「提交答案」统一判分
    if (currentQ.qtype === 'multi') {
      setSelected(prev => {
        const cur = prev || ''
        return cur.includes(key)
          ? cur.replace(key, '')
          : normalizeMultiAnswer(cur + key)
      })
      return
    }
    setSelected(key)

    const isCorrect = answersMatch(currentQ.qtype, key, currentQ.answer)
    setAnswerState(isCorrect ? 'correct' : 'wrong')
    setSessionStates(prev => ({
      ...prev,
      [currentIndex]: { selected: key, correct: isCorrect },
    }))

    setTimeout(() => setShowExplanation(true), 600)
  }, [answerState, currentQ, currentIndex])

  /** 多选题提交：按字母集合判分（选了 AC 而答案是 CA 也算对） */
  const handleSubmitMulti = useCallback(() => {
    if (answerState !== null || !currentQ || !selected) return
    const isCorrect = answersMatch('multi', selected, currentQ.answer)
    setAnswerState(isCorrect ? 'correct' : 'wrong')
    setSessionStates(prev => ({
      ...prev,
      [currentIndex]: { selected: normalizeMultiAnswer(selected), correct: isCorrect },
    }))
    setTimeout(() => setShowExplanation(true), 600)
  }, [answerState, currentQ, currentIndex, selected])

  /** 切到指定题目：做过的还原「当时选的选项 + 判定结果」，没做过的从新开始。
   *  原地直接换题（不做先淡出再淡入的弹出式过渡），内容即刻更换。 */
  const goTo = useCallback((index: number, closeNav = false) => {
    if (index < 0 || index >= total) return
    if (index === currentIndex) {
      if (closeNav) setShowNavigator(false)
      return
    }
    setCurrentIndex(index)
    const s = sessionStates[index]
    setSelected(s ? s.selected : null)
    setAnswerState(s ? (s.correct ? 'correct' : 'wrong') : null)
    setCalcDraft(s && isCalcInput(questions[index]) ? s.selected : '')
    setShortRevealed(Boolean(s) && isSelfAssess(questions[index]))
    setShowExplanation(Boolean(s))
    setIsFavorited(false)
    if (closeNav) setShowNavigator(false)
  }, [currentIndex, total, sessionStates, questions])

  /** 上一题：回到前一题，做过的会还原当时选的选项 */
  const handlePrev = useCallback(() => {
    goTo(currentIndex - 1)
  }, [goTo, currentIndex])

  /** 下一题：最后一题则交卷并进入结果页 */
  const handleNext = useCallback(() => {
    if (currentIndex + 1 >= total) {
      // 最后一题：先交卷保存，再进入结果页
      submitAnswers().finally(() => {
        onComplete(correctCount, total, elapsedSeconds)
      })
      return
    }
    goTo(currentIndex + 1)
  }, [currentIndex, total, correctCount, elapsedSeconds, onComplete, submitAnswers, goTo])

  /** 计算题提交：判分口径与考试完全一致（忽略首尾空白与大小写），
   *  提交后即可展开「题目原题讲解」看解答过程 */
  const handleSubmitCalc = useCallback(() => {
    if (answerState !== null || !currentQ) return
    const text = calcDraft.trim()
    if (!text) return
    const isCorrect = answersMatch('calc', text, currentQ.answer)
    setSelected(text)
    setAnswerState(isCorrect ? 'correct' : 'wrong')
    setSessionStates(prev => ({
      ...prev,
      [currentIndex]: { selected: text, correct: isCorrect },
    }))
  }, [answerState, currentQ, currentIndex, calcDraft])

  /** 简答题自评：对照参考答案后自己判定对错 */
  const handleSelfAssess = useCallback((selfCorrect: boolean) => {
    if (answerState !== null || !currentQ) return
    setSelected(selfCorrect ? '对' : '错')
    setAnswerState(selfCorrect ? 'correct' : 'wrong')
    setSessionStates(prev => ({
      ...prev,
      [currentIndex]: { selected: selfCorrect ? '对' : '错', correct: selfCorrect },
    }))
  }, [answerState, currentQ, currentIndex])

  /** 跳题（导航面板点题号）：做过的还原作答界面，未答的全新 */
  const jumpTo = useCallback((index: number) => {
    goTo(index, true)
  }, [goTo])

  /** 清除记录：删该范围（方向 / 章节）的我的答题记录，重置会话状态重新做 */
  const handleClearAll = useCallback(() => {
    if (clearing) return
    if (!confirmClear) {
      setConfirmClear(true)
      return
    }
    setClearing(true)
    practiceApi
      .reset(categoryId, topic, setId)
      .then(() => {
        // 删除该范围的练习进度（下次进来从头开始）
        practiceApi.deleteProgress(categoryId, { topic, qtype, setId, mode }).catch(() => {})
        // 旧会话作答不再提交（记录刚被删掉）；清空本地状态后重新拉题（my_state 已归零）
        submittedRef.current = true
        // 重置进度标记：重新加载题目后会再次读取进度（此时服务器进度已删除，读不到 → 从头开始）
        progressLoadedRef.current = false
        setSessionStates({})
        setSelected(null)
        setAnswerState(null)
        setCalcDraft('')
        setShortRevealed(false)
        setShowExplanation(false)
        setCurrentIndex(0)
        setConfirmClear(false)
        setShowNavigator(false)
        setReloadTick(t => t + 1)
        setTimeout(() => {
          submittedRef.current = false
        }, 0)
      })
      .finally(() => setClearing(false))
  }, [clearing, confirmClear, categoryId, topic, setId, qtype, mode])

  /** 退出弹窗「保存并退出」：已答的题上传为学习记录，同时保存进度，下次进来接着做 */
  const handleExit = useCallback(() => {
    // 立即保存一次进度（跳过防抖），确保退出时服务器进度是最新的；
    // 还没开始做题（无作答且在第 0 题）时不保存，避免产生空进度
    if (saveTimerRef.current) {
      window.clearTimeout(saveTimerRef.current)
      saveTimerRef.current = null
    }
    if (questions.length > 0 && (Object.keys(sessionStates).length > 0 || currentIndex > 0)) {
      practiceApi
        .saveProgress({
          category: categoryId,
          topic: topic || '',
          qtype: qtype || '',
          set_id: setId || 0,
          mode,
          question_ids: questions.map(q => q.id),
          answers: sessionStates,
          current_index: currentIndex,
        })
        .catch(() => {
          // 退出前保存失败：下次进来无法续做，但不阻塞退出
        })
    }
    // 已作答的题目上传为学习记录（进度不删，续做照旧）
    submitAnswers().finally(onExit)
  }, [onExit, questions, sessionStates, currentIndex, categoryId, topic, qtype, setId, mode, submitAnswers])

  /* ── 加载中 / 加载失败 / 无题 ── */
  if (loading) {
    return (
      <div className="app-shell flex flex-col items-center justify-center bg-page" style={{ height: '100dvh' }}>
        <div className="w-8 h-8 rounded-full border-2 animate-spin" style={{ borderColor: 'var(--accent)', borderTopColor: 'transparent' }} />
        <p className="text-sm mt-4" style={{ color: 'var(--text-3)' }}>正在从题库取题…</p>
      </div>
    )
  }

  if (loadError || !currentQ) {
    return (
      <div className="app-shell flex flex-col bg-page" style={{ height: '100dvh' }}>
        <div className="px-4 pt-12 pb-3">
          <button
            onClick={onExit}
            className="w-9 h-9 gb gb-ghost gb-sm flex items-center justify-center"
            style={{ background: 'var(--chip-bg)', border: '1px solid var(--chip-border)' }}
          >
            <ChevronLeftIcon size={18} color="var(--text-2)" />
          </button>
        </div>
        <div className="flex-1 flex flex-col items-center justify-center gap-3 px-8 text-center">
          <p className="text-sm" style={{ color: 'var(--text-1)' }}>
            {loadError ? (loadError as string) : `「${title || topic || categoryId}」暂无可练习的题目`}
          </p>
          <button onClick={onExit} className="mt-2 px-6 py-3 gb gb-primary gb-lg text-sm font-semibold">
            返回
          </button>
        </div>
      </div>
    )
  }

  const optionColors = {
    correct: { bg: 'var(--ok-weak)', border: 'var(--ok-border)', text: 'var(--ok)' },
    wrong:   { bg: 'var(--err-weak)', border: 'var(--err-border)', text: 'var(--err)' },
    reveal:  { bg: 'rgba(111,163,124,0.20)', border: 'var(--ok-border)', text: 'var(--ok)' },
    picked:  { bg: 'var(--accent-weak)', border: 'var(--accent-border)', text: 'var(--accent)' },
    default: { bg: 'var(--chip-bg-soft)', border: 'var(--inset-hi)', text: 'var(--text-1)' },
    dimmed:  { bg: 'var(--chip-bg-soft)', border: 'var(--inset-hi)', text: 'var(--text-3)' },
  }

  /** 我选的选项字母（多选题是 'AC' 这种串，单选/判断是单字母） */
  const selectedKeys = selected || ''
  /** 正确答案的选项字母集合（多选题含多个字母） */
  const answerKeys = currentQ.answer || ''

  function getOptionStyle(key: string) {
    if (!answerState) {
      // 多选未提交：已勾选的选项高亮（单选/判断没选之前都是常态样式）
      return selectedKeys.includes(key) ? optionColors.picked : optionColors.default
    }
    // 答错：我先错选的标红；正确答案（多选可能多个）一律标绿；其余置灰
    if (answerState === 'wrong' && selectedKeys.includes(key) && !answerKeys.includes(key)) {
      return optionColors.wrong
    }
    if (answerKeys.includes(key)) return optionColors.correct
    return optionColors.dimmed
  }

  function getOptionIcon(key: string): React.ReactNode | null {
    if (!answerState) {
      // 多选题勾选态给个对勾反馈，单选/判断未作答不显示图标
      return currentQ!.qtype === 'multi' && selectedKeys.includes(key)
        ? <CheckIcon size={12} strokeWidth={2.4} />
        : null
    }
    if (answerState === 'wrong' && selectedKeys.includes(key) && !answerKeys.includes(key)) {
      return <XIcon size={12} strokeWidth={2.4} />
    }
    if (answerKeys.includes(key)) return <CheckIcon size={12} strokeWidth={2.4} />
    return null
  }

  const hasExplanation = Boolean((currentQ as BankQuestion & { explanation?: string }).explanation)
  /** 顶栏范围标签：错题重练/随机刷题带方式前缀；自定义题库显示题库名 */
  const modeLabel = mode === 'wrong' ? '错题重练' : mode === 'random' ? '随机刷题' : ''
  const rangeLabel = title || (topic ? `${categoryId} · ${topic}` : categoryId)
  const scopeLabel = [modeLabel, rangeLabel].filter(Boolean).join(' · ')
  /** 无选项计算题：独立分支（输入框作答 → 判分 → 折叠「题目原题讲解」） */
  const calcInput = isCalcInput(currentQ)
  /** 需要「对照参考答案自评」的题：简答题等（计算题已单独走 calcInput 分支） */
  const selfAssess = !calcInput && isSelfAssess(currentQ)
  /** 多选题：点选项是勾选，选完由「提交答案」统一判分 */
  const isMulti = currentQ.qtype === 'multi'
  /** 题库里配置的解答过程（「题目原题讲解」内容；空 = 考生端由 AI 生成） */
  const solutionText = (currentQ as BankQuestion & { explanation?: string }).explanation

  return (
    <div className="app-shell flex flex-col bg-page" style={{ height: '100dvh', overflow: 'hidden' }}>
      {/* ── 顶栏 ── */}
      <div className="flex items-center justify-between px-4 pt-12 pb-3">
        <button
          onClick={() => setShowExitModal(true)}
          className="w-9 h-9 gb gb-ghost gb-sm flex items-center justify-center"
          style={{ background: 'var(--chip-bg)', border: '1px solid var(--chip-border)' }}
        >
          <ChevronLeftIcon size={18} color="var(--text-2)" />
        </button>

        <div className="flex flex-col items-center">
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold px-2 py-0.5 rounded-md" style={{ background: 'var(--accent-weak)', color: 'var(--accent)' }}>
              {scopeLabel}
            </span>
          </div>
          <span className="text-xs font-medium mt-0.5" style={{ color: 'var(--text-2)', fontVariantNumeric: 'tabular-nums' }}>
            {currentIndex + 1} / {total}
          </span>
        </div>

        <div className="flex items-center gap-2">
          {/* 题目疑问：答案疑似有误时上报管理员 */}
          <button
            onClick={() => setShowReport(true)}
            aria-label="题目疑问"
            className="w-9 h-9 gb gb-ghost gb-sm flex items-center justify-center"
            style={{ background: 'var(--chip-bg)', border: '1px solid var(--chip-border)' }}
          >
            <FlagIcon size={15} color="var(--text-2)" />
          </button>
          <button
            onClick={() => setShowNavigator(true)}
            aria-label="题目导航"
            className="w-9 h-9 gb gb-ghost gb-sm flex items-center justify-center"
            style={{ background: 'var(--chip-bg)', border: '1px solid var(--chip-border)' }}
          >
            <GridIcon size={16} color="var(--text-2)" />
          </button>
          <div className="flex items-center gap-1 px-2.5 py-1.5 gb-sm text-xs gb-soft" style={{ background: 'var(--chip-bg)', border: '1px solid var(--chip-border)', color: 'var(--text-2)', fontVariantNumeric: 'tabular-nums', borderRadius: 12 }}>
            <ClockIcon size={13} />
            {formatTime(elapsedSeconds)}
          </div>
        </div>
      </div>

      {/* ── 进度条 ── */}
      <div className="px-4 mb-4">
        <div className="h-1 rounded-full overflow-hidden" style={{ background: 'var(--track)' }}>
          <div
            className="h-full rounded-full progress-fill"
            style={{ width: `${progress}%`, background: 'var(--accent)' }}
          />
        </div>
      </div>

      {/* ── 可滚动内容 ── */}
      <div className="flex-1 overflow-y-auto px-4" style={{ overscrollBehavior: 'contain' }}>
        {/* 题目卡片（切题时原地直接更换，无过渡动画） */}
        <div className="card p-5 mb-4">
          <div className="flex items-center gap-2 mb-3 flex-wrap">
            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full" style={{ background: 'var(--accent-weak)', color: 'var(--accent)' }}>
              {qtypeLabel(currentQ)}
            </span>
            {currentQ.topic && (
              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full" style={{ background: 'var(--surface-warm)', color: 'var(--text-2)', border: '1px solid var(--line)' }}>
                {currentQ.topic}
              </span>
            )}
          </div>

          <p
            className="text-base leading-relaxed font-medium"
            style={{ color: 'var(--text-1)', letterSpacing: '-0.005em' }}
          >
            <RichText text={currentQ.content} />
          </p>
        </div>

        {/* ── 计算题（无选项）：先输入自己的答案，提交后判分并出现折叠的「题目原题讲解」 ── */}
        {calcInput && (
          <div className="mb-4">
            {!answerState && (
              <div className="card p-4">
                <p className="text-xs font-medium mb-2" style={{ color: 'var(--text-3)' }}>我的答案</p>
                <textarea
                  value={calcDraft}
                  onChange={e => setCalcDraft(e.target.value)}
                  rows={2}
                  maxLength={200}
                  placeholder="写下你算出的答案（数值或文字，带单位也可以）"
                  className="w-full rounded-xl px-3 py-2.5 text-sm outline-none resize-none"
                  style={{ background: 'var(--field-bg)', border: '1px solid var(--line)', color: 'var(--text-1)' }}
                />
                <button
                  onClick={handleSubmitCalc}
                  disabled={!calcDraft.trim()}
                  className="w-full h-12 mt-3 gb gb-primary gb-lg rounded-2xl text-sm font-semibold"
                  style={calcDraft.trim() ? undefined : { opacity: 0.45 }}
                >
                  提交答案
                </button>
                <p className="text-[10px] mt-2 text-center" style={{ color: 'var(--text-3)' }}>
                  提交后自动判分，并在「题目原题讲解」里给出解答过程
                </p>
              </div>
            )}

            {answerState && (
              <>
                <div
                  className="card p-4 mb-3 anim-slide-up"
                  style={{ borderTop: `3px solid ${answerState === 'correct' ? 'var(--ok)' : 'var(--err)'}` }}
                >
                  <div className="flex items-center gap-2">
                    {answerState === 'correct'
                      ? <CheckIcon size={15} strokeWidth={2.4} color="var(--ok)" />
                      : <XIcon size={15} strokeWidth={2.4} color="var(--err)" />}
                    <span className="text-sm font-bold" style={{ color: answerState === 'correct' ? 'var(--ok)' : 'var(--err)' }}>
                      {answerState === 'correct' ? '回答正确' : '回答错误'}
                    </span>
                  </div>
                  <p className="text-xs mt-2" style={{ color: 'var(--text-3)' }}>
                    我的答案：<span style={{ color: 'var(--text-2)' }}>{selected}</span>
                  </p>
                </div>

                {/* 题目原题讲解：默认折叠，点标题栏展开。
                    题库配了解答过程就直接显示，没配则由 AI 分步生成（附「不一定正确」提示） */}
                <QuestionSolutionPanel
                  questionId={currentQ.id}
                  answer={currentQ.answer}
                  explanation={solutionText}
                />
              </>
            )}
          </div>
        )}

        {/* ── 选项（简答题：查看参考答案 + 自评） ── */}
        {selfAssess ? (
          <div className="mb-4">
            {!shortRevealed && !answerState && (
              <button
                onClick={() => setShortRevealed(true)}
                className="w-full card p-4 text-center card-tap text-sm font-semibold"
                style={{ color: 'var(--accent)' }}
              >
                我已作答，查看参考答案
              </button>
            )}

            {shortRevealed && !answerState && (
              <div className="anim-slide-up">
                <div className="card p-4 mb-3">
                  <p className="text-xs font-medium mb-2" style={{ color: 'var(--text-3)' }}>参考答案</p>
                  <p className="text-sm leading-relaxed whitespace-pre-wrap" style={{ color: 'var(--text-1)' }}>
                    <RichText text={currentQ.answer} />
                  </p>
                </div>
                <p className="text-xs text-center mb-3" style={{ color: 'var(--text-2)' }}>对照参考答案，你的作答算对还是错？</p>
                <div className="flex gap-3">
                  <button
                    onClick={() => handleSelfAssess(false)}
                    className="flex-1 h-12 rounded-2xl text-sm font-semibold flex items-center justify-center gap-2 tap"
                    style={{ background: 'var(--err-weak)', border: '1px solid var(--err-border)', color: 'var(--err)' }}
                  >
                    <XIcon size={15} strokeWidth={2.2} />
                    答错了
                  </button>
                  <button
                    onClick={() => handleSelfAssess(true)}
                    className="flex-1 h-12 rounded-2xl text-sm font-semibold flex items-center justify-center gap-2 tap"
                    style={{ background: 'var(--ok-weak)', border: '1px solid var(--ok-border)', color: 'var(--ok)' }}
                  >
                    <CheckIcon size={15} strokeWidth={2.2} />
                    答对了
                  </button>
                </div>
              </div>
            )}

            {answerState && (
              <div
                className="card p-4 anim-slide-up"
                style={{ borderTop: `3px solid ${answerState === 'correct' ? 'var(--ok)' : 'var(--err)'}` }}
              >
                <div className="flex items-center gap-2 mb-2">
                  {answerState === 'correct'
                    ? <CheckIcon size={15} strokeWidth={2.4} color="var(--ok)" />
                    : <XIcon size={15} strokeWidth={2.4} color="var(--err)" />}
                  <span className="text-sm font-bold" style={{ color: answerState === 'correct' ? 'var(--ok)' : 'var(--err)' }}>
                    {answerState === 'correct' ? '已记为答对' : '已记为答错'}
                  </span>
                </div>
                <p className="text-xs font-medium mb-1" style={{ color: 'var(--text-3)' }}>参考答案</p>
                <p className="text-sm leading-relaxed whitespace-pre-wrap" style={{ color: 'var(--text-2)' }}>
                  <RichText text={currentQ.answer} />
                </p>
              </div>
            )}

            {/* AI 解析：简答题自评后同样可用（让 AI 讲清答题要点） */}
            {answerState && (
              <div className="mt-3">
                <AiExplainPanel questionId={currentQ.id} />
              </div>
            )}
          </div>
        ) : (
        <div className="space-y-3 mb-4">
          {currentQ.options.map(opt => {
            const style = getOptionStyle(opt.key)
            const icon = getOptionIcon(opt.key)
            const isAnswered = answerState !== null

            return (
              <div
                key={opt.key}
                className={`answer-card relative rounded-2xl px-4 py-3.5 flex items-start gap-3 ${isAnswered ? 'answered' : ''}`}
                onClick={() => handleSelect(opt.key)}
                style={{ background: style.bg, border: `1.5px solid ${style.border}` }}
              >
                <div
                  className="w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold flex-shrink-0 mt-0.5"
                  style={{
                    background:
                      answerState === null
                        ? 'var(--track)'
                        : answerKeys.includes(opt.key)
                        ? 'var(--ok-weak)'
                        : answerState === 'wrong' && selectedKeys.includes(opt.key)
                        ? 'var(--err-weak)'
                        : 'var(--track)',
                    color: style.text,
                  }}
                >
                  {icon || opt.key}
                </div>

                <p className="text-sm leading-relaxed flex-1" style={{ color: style.text }}>
                  <RichText text={opt.text} noZoom />
                </p>
              </div>
            )
          })}
        </div>
        )}

        {/* ── 判定结果面板（选择/判断题；简答题与计算题已在上方单独呈现） ── */}
        {showExplanation && !selfAssess && !calcInput && (
          <div className="mb-4 anim-slide-up">
            <div
              className="card overflow-hidden"
              style={{ borderTop: `3px solid ${answerState === 'correct' ? 'var(--ok)' : 'var(--err)'}` }}
            >
              <div className="flex items-center gap-3 px-5 py-4" style={{ borderBottom: '1px solid var(--line)' }}>
                <div
                  className="w-8 h-8 rounded-xl flex items-center justify-center"
                  style={{
                    background: answerState === 'correct' ? 'var(--ok-weak)' : 'var(--err-weak)',
                    color: answerState === 'correct' ? 'var(--ok)' : 'var(--err)',
                  }}
                >
                  {answerState === 'correct' ? <CheckIcon size={15} strokeWidth={2.4} /> : <XIcon size={15} strokeWidth={2.4} />}
                </div>
                <div>
                  <div className="text-sm font-bold" style={{ color: answerState === 'correct' ? 'var(--ok)' : 'var(--err)' }}>
                    {answerState === 'correct' ? '回答正确' : '回答错误'}
                  </div>
                  {answerState === 'wrong' && (
                    <div className="text-xs mt-0.5" style={{ color: 'var(--text-2)' }}>
                      正确答案：<span className="font-bold" style={{ color: 'var(--ok)' }}>{currentQ.answer}</span>
                      <span className="ml-2" style={{ color: 'var(--text-3)' }}>
                        {currentQ.options.filter(o => answerKeys.includes(o.key)).map(o => stripRichText(o.text)).join(' / ')}
                      </span>
                    </div>
                  )}
                </div>
              </div>

              {hasExplanation && (
                <div className="px-5 py-4">
                  <p className="text-xs font-medium mb-2 tracking-wide" style={{ color: 'var(--text-3)' }}>解析</p>
                  <p className="text-sm leading-relaxed" style={{ color: 'var(--text-2)' }}>
                    <RichText text={(currentQ as BankQuestion & { explanation?: string }).explanation} />
                  </p>
                </div>
              )}

              <div className="flex items-center gap-4 px-5 py-3" style={{ borderTop: '1px solid var(--line)' }}>
                {currentQ.topic && (
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px]" style={{ color: 'var(--text-3)' }}>知识点</span>
                    <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full" style={{ background: 'var(--accent-weak)', color: 'var(--accent)' }}>
                      {currentQ.topic}
                    </span>
                  </div>
                )}
              </div>
            </div>

            {/* AI 解析：本题作答结果下方，点一下让 AI 讲透这道题 */}
            <div className="mt-3">
              <AiExplainPanel questionId={currentQ.id} />
            </div>
          </div>
        )}

        <div className="h-24" />
      </div>

      {/* ── 底部操作条：上一题 / 下一题（v1.85：软键盘弹出时整条收起，只留键盘） ── */}
      {!softKeyboard && (
      <div
        className="px-4 pt-3 pb-8"
        style={{
          background: 'linear-gradient(180deg, transparent 0%, var(--bg) 40%)',
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
        }}
      >
        {!answerState && (
          <div className="flex items-center justify-center gap-2 mb-2.5">
            <div className="w-1.5 h-1.5 rounded-full dot-pulse" style={{ background: 'var(--accent)' }} />
            <span className="text-xs" style={{ color: 'var(--text-3)' }}>
              {calcInput
                ? '计算题：写下你的答案后点「提交答案」，系统自动判分'
                : selfAssess
                ? '先作答，再对照参考答案'
                : isMulti
                ? `多选题：可选多个，选好后点「提交答案」${selectedKeys ? `（已选 ${selectedKeys}）` : ''}`
                : '选择一个答案后自动判对错'}
            </span>
          </div>
        )}
        <div className="flex gap-2">
          <button
            onClick={handlePrev}
            disabled={currentIndex === 0}
            className="gb gb-ghost gb-lg h-[52px] shrink-0 flex items-center justify-center gap-1.5 font-semibold text-sm"
            style={{ paddingLeft: 18, paddingRight: 18 }}
          >
            <ChevronLeftIcon size={17} color="var(--text-2)" />
            上一题
          </button>
          {/* 多选题：选完再点「提交答案」判分（单选/判断题点选项即判分，不需要这一步） */}
          {isMulti && !answerState && (
            <button
              onClick={handleSubmitMulti}
              disabled={!selectedKeys}
              className="gb gb-primary gb-lg h-[52px] flex-1 flex items-center justify-center font-semibold text-sm"
              style={selectedKeys ? undefined : { opacity: 0.45 }}
            >
              提交答案
            </button>
          )}
          <button
            onClick={handleNext}
            disabled={submitting}
            className="gb gb-success gb-lg h-[52px] flex-1 flex items-center justify-center gap-2 font-semibold text-base"
          >
            {currentIndex + 1 >= total
              ? (submitting ? '正在保存…' : '查看结果')
              : ((isMulti || calcInput) && !answerState ? '跳过' : '下一题')}
            {!(currentIndex + 1 >= total && submitting) && !((isMulti || calcInput) && !answerState) && (
              <ChevronRightIcon size={18} color="#FFFFFF" />
            )}
          </button>
        </div>
      </div>
      )}

      {/* ── 题目导航面板 ── */}
      {showNavigator && (
        <div className="fixed inset-0 z-50">
          <div className="absolute inset-0 bg-black/30" onClick={() => setShowNavigator(false)} />
          <div
            className="absolute bottom-0 left-1/2 -translate-x-1/2 w-full max-w-[430px] rounded-t-3xl anim-sheet-in"
            style={{ background: 'var(--surface-raised)', border: '1px solid var(--line)', boxShadow: '0 -4px 24px rgba(27,30,35,0.08)' }}
          >
            <div className="flex justify-center pt-3 pb-2">
              <div className="w-10 h-1 rounded-full" style={{ background: 'var(--hairline)' }} />
            </div>
            <div className="px-5 pb-8" style={{ maxHeight: '70vh', overflowY: 'auto' }}>
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-bold text-lg" style={{ color: 'var(--text-1)' }}>题目导航</h3>
                <span className="text-xs" style={{ color: 'var(--text-3)', fontVariantNumeric: 'tabular-nums' }}>
                  已做 {answeredCount} / {total}
                </span>
              </div>

              {/* 题号网格：对=绿 / 错=红 / 本次已答（还原界面）/ 未做=浅灰 */}
              <div className="grid grid-cols-5 gap-2.5 mb-5">
                {questions.map((q, i) => {
                  const nav = navStateOf(i)
                  const inSession = i in sessionStates
                  const isCurrent = i === currentIndex
                  return (
                    <button
                      key={q.id}
                      onClick={() => jumpTo(i)}
                      className="aspect-square rounded-xl text-sm font-bold flex items-center justify-center transition-colors duration-150 tap"
                      style={{
                        background: nav === 'correct'
                          ? 'var(--ok-weak)'
                          : nav === 'wrong'
                          ? 'var(--err-weak)'
                          : 'var(--chip-bg-soft)',
                        color: nav === 'correct'
                          ? 'var(--ok)'
                          : nav === 'wrong'
                          ? 'var(--err)'
                          : 'var(--text-2)',
                        border: isCurrent
                          ? '2px solid var(--accent)'
                          : `1px solid ${nav ? (nav === 'correct' ? 'var(--ok-border)' : 'var(--err-border)') : 'var(--chip-border)'}`,
                        fontVariantNumeric: 'tabular-nums',
                      }}
                    >
                      {i + 1}
                    </button>
                  )
                })}
              </div>

              {/* 图例 */}
              <div className="flex items-center gap-4 mb-5 text-[10px]" style={{ color: 'var(--text-3)' }}>
                <span className="inline-flex items-center gap-1.5">
                  <span className="w-3 h-3 rounded" style={{ background: 'var(--ok-weak)', border: '1px solid var(--ok-border)' }} /> 做对
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="w-3 h-3 rounded" style={{ background: 'var(--err-weak)', border: '1px solid var(--err-border)' }} /> 做错
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="w-3 h-3 rounded" style={{ background: 'var(--chip-bg-soft)', border: '1px solid var(--chip-border)' }} /> 未做
                </span>
              </div>

              {/* 清除记录（两步确认）——错题重练不提供：清除会删掉整个范围的答题记录，
                  而错题重练只想重做出错的题，两者语义冲突 */}
              {mode !== 'wrong' && (
                <>
                  <button
                    onClick={handleClearAll}
                    disabled={clearing}
                    className="w-full h-12 rounded-2xl text-sm font-semibold flex items-center justify-center gap-2 tap"
                    style={{
                      background: confirmClear ? 'var(--err-weak)' : 'transparent',
                      border: `1px solid ${confirmClear ? 'var(--err-border)' : 'var(--line)'}`,
                      color: confirmClear ? 'var(--err)' : 'var(--text-2)',
                      opacity: clearing ? 0.6 : 1,
                    }}
                  >
                    <TrashIcon size={15} />
                    {confirmClear ? '再点一次确认清除（不可恢复）' : '清除全部记录，重新做'}
                  </button>
                  <p className="text-[10px] mt-2 text-center" style={{ color: 'var(--text-3)' }}>
                    清除只删除这 {scopeTotal || total} 题的我的答题记录，导航颜色与统计随之归零
                  </p>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── 退出弹窗 ── */}
      {showExitModal && (
        <div className="fixed inset-0 z-50 flex items-end justify-center">
          <div className="absolute inset-0 bg-black/30" onClick={() => setShowExitModal(false)} />
          <div
            className="relative w-full max-w-[430px] rounded-t-3xl px-5 pt-5 pb-10 anim-sheet-in"
            style={{ background: 'var(--surface-raised)', border: '1px solid var(--line)', boxShadow: '0 -4px 24px rgba(27,30,35,0.08)' }}
          >
            <div className="flex justify-center mb-4">
              <div className="w-10 h-1 rounded-full" style={{ background: 'var(--hairline)' }} />
            </div>

            <h3 className="font-bold text-lg mb-2" style={{ color: 'var(--text-1)' }}>保存并退出？</h3>
            <p className="text-sm mb-5" style={{ color: 'var(--text-2)' }}>
              已答的题会上传为学习记录，进度同时保存，下次进来从这题继续
            </p>

            <div className="card p-4 mb-6 grid grid-cols-3 gap-4 text-center">
              <div>
                <div className="text-xl font-bold" style={{ color: 'var(--text-1)', fontVariantNumeric: 'tabular-nums' }}>{answeredCount}</div>
                <div className="text-xs mt-1" style={{ color: 'var(--text-3)' }}>已完成</div>
              </div>
              <div>
                <div className="text-xl font-bold" style={{ color: 'var(--ok)', fontVariantNumeric: 'tabular-nums' }}>{correctCount}</div>
                <div className="text-xs mt-1" style={{ color: 'var(--text-3)' }}>回答正确</div>
              </div>
              <div>
                <div className="text-xl font-bold" style={{ color: 'var(--text-1)', fontVariantNumeric: 'tabular-nums' }}>{formatTime(elapsedSeconds)}</div>
                <div className="text-xs mt-1" style={{ color: 'var(--text-3)' }}>学习时长</div>
              </div>
            </div>

            <div className="space-y-3">
              <button
                onClick={handleExit}
                disabled={submitting}
                className="w-full h-12 gb gb-primary gb-lg rounded-2xl text-sm font-semibold"
                style={{ opacity: submitting ? 0.6 : 1 }}
              >
                {submitting ? '正在保存…' : '保存并退出'}
              </button>
              <button
                onClick={() => setShowExitModal(false)}
                className="w-full h-12 gb gb-ghost rounded-2xl text-sm font-semibold"
              >
                继续答题
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── 题目疑问（纠错上报）弹层 ── */}
      {showReport && currentQ && (
        <QuestionReportSheet question={currentQ} onClose={() => setShowReport(false)} />
      )}
    </div>
  )
}
