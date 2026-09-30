export type Screen =
  | 'onboarding'
  | 'home'
  | 'question-bank'
  | 'practice'
  | 'practice-result'
  | 'exam-setup'
  | 'exam'
  | 'exam-result'
  | 'wrong-questions'
  | 'score-records'
  | 'watch-history'
  | 'favorites'
  | 'video-detail'
  | 'learning'
  | 'profile'
  | 'search'
  | 'notifications'
  | 'achievements'
  | 'settings'

export type Tab = 'home' | 'questions' | 'materials' | 'wrong' | 'learning' | 'profile'

export type NDTMethod = 'UT' | 'RT' | 'MT' | 'PT' | 'ET' | 'VT' | '综合'

export type Difficulty = 'easy' | 'medium' | 'hard'

export type Level = 1 | 2

export interface Question {
  id: string
  text: string
  options: Array<{ key: string; text: string }>
  correct: string
  explanation: string
  category: NDTMethod
  level: Level
  difficulty: Difficulty
  knowledgePoint: string
  standard?: string
  tags?: string[]
}

export interface WrongRecord {
  questionId: string
  wrongCount: number
  lastWrongDate: string
  history: Array<{ date: string; answer: string; correct: boolean }>
  mastered: boolean
}

export interface Category {
  id: NDTMethod
  name: NDTMethod
  fullName: string
  description: string
  color: string
  gradient: [string, string]
  questionCount: number
  completedCount: number
  icon: string
}

export interface Achievement {
  id: string
  title: string
  description: string
  icon: string
  color: string
  gradient: [string, string]
  earned: boolean
  earnedDate?: string
  progress?: number
  maxProgress?: number
}

export interface TrainingSet {
  id: string
  title: string
  category: NDTMethod
  questionCount: number
  completedCount: number
  estimatedMinutes: number
  difficulty: Difficulty
  description: string
  gradient: [string, string]
  lastStudied?: string
}
