import React, { useCallback, useEffect, useRef, useState } from 'react'
import { libraryApi, ApiError, type MaterialItem, type MaterialComment } from '../api/client'
import { Avatar } from '../components/Avatar'
import { AiVideoSummary } from '../components/AiVideoSummary'
import {
  ChevronLeftIcon, EyeIcon, HeartIcon, MessageIcon, PlayIcon, TrashIcon, XIcon,
} from '../components/icons'
import { formatCount, formatMoment } from '../data/format'

/* ============================================================
   视频详情页（B 站式布局 · 苹果式浅色）
   结构：返回栏 → 应用内播放器 → 标题与统计（播放量 / 收藏数 / 评论数）
        → 收藏按钮 → 简介 → 评论区（发表 + 楼中楼列表）
   数据全部实时（改动即落库，刷新 / 换设备一致）：
     GET    /api/library/{id}                详情（含播放量/收藏数/我是否收藏）
     POST   /api/library/{id}/view           进页面记一次播放（每次打开 +1）
     POST   /api/library/{id}/favorite       收藏 / DELETE 取消收藏
     GET    /api/library/{id}/comments       评论列表（楼中楼：顶层 + replies）
     POST   /api/library/{id}/comments       发表评论 / 回复（带 parent_id，对方收通知）
     DELETE /api/library/comments/{cid}      删除自己的评论（顶层连回复一起删）
   修改注意：
     - 根元素必须是唯一一个 .scroll-area（本工程滚动结构约定，见 FRONTEND.md §11）
     - 颜色一律 var(--token)，图标用 icons.tsx 的线性图标（深色模式）
     - 播放量只在进入页面时记一次（ref 挡住开发模式重复执行）
     - 楼中楼两层：回复一律挂根评论；点评论内容 / 回复按钮 = 把它设为回复目标
   ============================================================ */

const COMMENT_MAX = 200

interface VideoDetailScreenProps {
  materialId: number
  onBack: () => void
}

export function VideoDetailScreen({ materialId, onBack }: VideoDetailScreenProps) {
  const [item, setItem] = useState<MaterialItem | null>(null)
  /** 顶层评论列表（回复嵌在各自的 replies 里） */
  const [comments, setComments] = useState<MaterialComment[]>([])
  /** 评论总数（含回复，来自服务端 total） */
  const [commentTotal, setCommentTotal] = useState(0)
  const [draft, setDraft] = useState('')
  const [error, setError] = useState('')
  const [commentError, setCommentError] = useState('')
  const [posting, setPosting] = useState(false)
  const [favBusy, setFavBusy] = useState(false)
  /** 正在回复谁（null = 发表顶层评论） */
  const [replyTarget, setReplyTarget] = useState<MaterialComment | null>(null)
  const recorded = useRef(false)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)

  /* 详情 + 评论：一次并发拉齐 */
  useEffect(() => {
    let cancelled = false
    setError('')
    Promise.all([libraryApi.detail(materialId), libraryApi.comments(materialId)])
      .then(([detail, cmt]) => {
        if (cancelled) return
        setItem(detail)
        setComments(cmt.items)
        setCommentTotal(cmt.total)
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : '视频加载失败')
      })
    return () => {
      cancelled = true
    }
  }, [materialId])

  /* 播放量：进入本页记一次（每次打开 +1，B 站式口径） */
  useEffect(() => {
    if (recorded.current) return
    recorded.current = true
    libraryApi
      .recordView(materialId)
      .then(res => setItem(prev => (prev ? { ...prev, view_count: res.view_count, fav_count: res.fav_count } : prev)))
      .catch(() => { /* 记不上不影响观看 */ })
  }, [materialId])

  const toggleFavorite = useCallback(async () => {
    if (!item || favBusy) return
    setFavBusy(true)
    try {
      const res = item.favorited
        ? await libraryApi.unfavorite(item.id)
        : await libraryApi.favorite(item.id)
      setItem(prev => (prev ? { ...prev, favorited: res.favorited, fav_count: res.fav_count } : prev))
    } catch (err) {
      if (!(err instanceof ApiError)) throw err
    } finally {
      setFavBusy(false)
    }
  }, [item, favBusy])

  /* 点评论（内容或「回复」按钮）→ 设为回复目标并聚焦输入框 */
  const startReply = useCallback((c: MaterialComment) => {
    setReplyTarget(c)
    setCommentError('')
    requestAnimationFrame(() => textareaRef.current?.focus())
  }, [])

  const cancelReply = useCallback(() => setReplyTarget(null), [])

  /* 发表：有 replyTarget = 回复（后端会归到根评论并通知对方） */
  const submitComment = useCallback(async () => {
    const content = draft.trim()
    if (!content || posting) return
    setPosting(true)
    setCommentError('')
    try {
      const parentId = replyTarget ? replyTarget.parent_id || replyTarget.id : 0
      const res = await libraryApi.addComment(materialId, content, parentId)
      const newItem = res.item
      if (newItem.parent_id) {
        // 回复：插到根评论的 replies 尾部（列表按 id 正序）
        setComments(prev =>
          prev.map(c =>
            c.id === newItem.parent_id
              ? { ...c, replies: [...(c.replies ?? []), newItem], reply_count: (c.reply_count ?? 0) + 1 }
              : c,
          ),
        )
        setReplyTarget(null)
      } else {
        setComments(prev => [newItem, ...prev])
      }
      setCommentTotal(n => n + 1)
      setDraft('')
    } catch (err) {
      setCommentError(err instanceof Error ? err.message : '评论发布失败')
    } finally {
      setPosting(false)
    }
  }, [draft, posting, materialId, replyTarget])

  /* 删除自己的评论（服务端同步删库：顶层连楼中楼一起删） */
  const removeComment = useCallback(async (comment: MaterialComment) => {
    try {
      await libraryApi.deleteComment(comment.id)
      const removed = 1 + (comment.parent_id ? 0 : (comment.reply_count ?? 0))
      setCommentTotal(n => Math.max(0, n - removed))
      if (comment.parent_id) {
        // 删的是回复：从根评论的 replies 里移除
        setComments(prev =>
          prev.map(c =>
            c.id === comment.parent_id
              ? { ...c, replies: (c.replies ?? []).filter(r => r.id !== comment.id), reply_count: Math.max(0, (c.reply_count ?? 1) - 1) }
              : c,
          ),
        )
      } else {
        setComments(prev => prev.filter(c => c.id !== comment.id))
      }
      if (replyTarget && (replyTarget.id === comment.id || replyTarget.parent_id === comment.id)) {
        setReplyTarget(null)
      }
    } catch (err) {
      setCommentError(err instanceof Error ? err.message : '删除失败')
    }
  }, [replyTarget])

  /* ── 单条评论内容行（顶层 / 回复共用） ── */
  const renderComment = useCallback((c: MaterialComment, isReply: boolean) => (
    <div key={c.id} className={isReply ? 'flex items-start gap-2.5' : 'flex items-start gap-3'}>
      <Avatar value={c.avatar} name={c.nickname} size={isReply ? 26 : 32} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`font-semibold ${isReply ? 'text-[11px]' : 'text-xs'}`} style={{ color: 'var(--text-1)' }}>
            {c.nickname}
          </span>
          {isReply && c.reply_to && (
            <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full" style={{ background: 'var(--accent-weak)', color: 'var(--accent)' }}>
              回复 @{c.reply_to}
            </span>
          )}
          <span className="text-[10px]" style={{ color: 'var(--text-3)' }}>{formatMoment(c.created_at)}</span>
          {c.is_mine && (
            <button
              onClick={() => removeComment(c)}
              className="ml-auto inline-flex items-center gap-1 text-[10px] tap"
              style={{ color: 'var(--text-3)' }}
            >
              <TrashIcon size={11} /> 删除
            </button>
          )}
        </div>
        {/* 点内容即回复该条 */}
        <p
          onClick={() => startReply(c)}
          className={`mt-1 leading-relaxed cursor-pointer ${isReply ? 'text-[11px]' : 'text-xs'}`}
          style={{ color: 'var(--text-2)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}
        >
          {c.content}
        </p>
        {!isReply && (
          <button
            onClick={() => startReply(c)}
            className="mt-1.5 inline-flex items-center gap-1 text-[10px] font-semibold tap"
            style={{ color: 'var(--accent)' }}
          >
            <MessageIcon size={11} /> 回复
          </button>
        )}
      </div>
    </div>
  ), [removeComment, startReply])

  return (
    <div className="scroll-area bg-page">
      <div className="ui-stagger" style={{ paddingBottom: 56 }}>
        {/* 返回栏 */}
        <div className="px-5 pt-12 pb-3 flex items-center gap-3">
          <button
            onClick={onBack}
            aria-label="返回"
            className="w-9 h-9 rounded-full flex items-center justify-center tap"
            style={{ background: 'var(--chip-bg)', border: '1px solid var(--chip-border)', color: 'var(--text-2)' }}
          >
            <ChevronLeftIcon size={17} />
          </button>
          <span className="text-sm font-semibold" style={{ color: 'var(--text-2)' }}>
            {item ? item.category_name : '视频详情'}
          </span>
        </div>

        {error && (
          <div className="px-5 pb-3">
            <div className="card p-4">
              <p className="text-xs" style={{ color: 'var(--err)' }}>{error}（请确认后端服务已启动）</p>
            </div>
          </div>
        )}

        {/* 播放器 */}
        <div className="px-4">
          <div className="rounded-2xl overflow-hidden" style={{ background: '#000' }}>
            <video
              key={materialId}
              src={libraryApi.fileUrl(materialId)}
              controls
              autoPlay
              playsInline
              poster={item?.has_cover ? libraryApi.coverUrl(materialId) : undefined}
              className="w-full block"
              style={{ aspectRatio: '16 / 9', objectFit: 'contain', background: '#000' }}
            />
          </div>
        </div>

        {/* 标题 + 统计 + 收藏 */}
        <div className="px-5 pt-4">
          <h1 className="text-base font-bold leading-snug" style={{ color: 'var(--text-1)', letterSpacing: '-0.01em' }}>
            {item?.title ?? '加载中…'}
          </h1>

          <div className="flex items-center gap-3 mt-2 flex-wrap">
            <span className="inline-flex items-center gap-1 text-[11px]" style={{ color: 'var(--text-3)' }}>
              <EyeIcon size={12} color="var(--text-3)" />
              <span style={{ fontVariantNumeric: 'tabular-nums' }}>{formatCount(item?.view_count ?? 0)}</span> 次播放
            </span>
            <span className="inline-flex items-center gap-1 text-[11px]" style={{ color: 'var(--text-3)' }}>
              <HeartIcon size={12} color="var(--text-3)" />
              <span style={{ fontVariantNumeric: 'tabular-nums' }}>{formatCount(item?.fav_count ?? 0)}</span> 收藏
            </span>
            <span className="inline-flex items-center gap-1 text-[11px]" style={{ color: 'var(--text-3)' }}>
              <MessageIcon size={12} color="var(--text-3)" />
              <span style={{ fontVariantNumeric: 'tabular-nums' }}>{commentTotal}</span> 评论
            </span>
          </div>

          <div className="flex items-center gap-2 mt-3">
            <button
              onClick={toggleFavorite}
              disabled={favBusy || !item}
              className="px-3.5 py-2 rounded-full text-xs font-semibold inline-flex items-center gap-1.5 tap"
              style={{
                background: item?.favorited ? 'var(--accent-fill)' : 'var(--accent-weak)',
                color: item?.favorited ? 'var(--on-accent)' : 'var(--accent)',
                border: '1px solid var(--accent-border)',
                opacity: favBusy ? 0.6 : 1,
              }}
            >
              <HeartIcon size={13} color={item?.favorited ? 'var(--on-accent)' : 'var(--accent)'} />
              {item?.favorited ? '已收藏' : '收藏'}
              <span style={{ fontVariantNumeric: 'tabular-nums' }}>{formatCount(item?.fav_count ?? 0)}</span>
            </button>
            {item?.method && (
              <span
                className="text-[10px] font-semibold px-2.5 py-1 rounded-full"
                style={{ background: 'var(--chip-bg-soft)', color: 'var(--text-2)', border: '1px solid var(--chip-border)' }}
              >
                {item.method} 方向
              </span>
            )}
          </div>
        </div>

        {/* 简介 */}
        <div className="px-4 mt-4">
          <div className="card p-4">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-xs font-bold tracking-wide" style={{ color: 'var(--text-2)' }}>视频简介</h2>
            </div>
            <p className="text-xs leading-relaxed" style={{ color: 'var(--text-2)' }}>
              {item?.description || '管理员暂未填写简介。'}
            </p>
          </div>
        </div>

        {/* AI 概括：抽帧看画面 + 标题简介，先抓重点再决定要不要精看 */}
        <div className="px-4 mt-4">
          <AiVideoSummary materialId={materialId} />
        </div>

        {/* 评论区（楼中楼） */}
        <div className="px-4 mt-4">
          <div className="card p-4">
            <div className="flex items-center gap-2 mb-3">
              <span style={{ color: 'var(--accent)' }}><MessageIcon size={15} /></span>
              <h2 className="text-xs font-bold tracking-wide" style={{ color: 'var(--text-2)' }}>
                评论 {commentTotal}
              </h2>
            </div>

            {/* 回复目标提示条 */}
            {replyTarget && (
              <div
                className="mb-2 px-3 py-2 rounded-xl flex items-center gap-2 text-[11px]"
                style={{ background: 'var(--accent-weak)', color: 'var(--accent)', border: '1px solid var(--accent-border)' }}
              >
                <span className="flex-1 min-w-0 truncate">回复 @{replyTarget.nickname}：{replyTarget.content}</span>
                <button onClick={cancelReply} aria-label="取消回复" className="shrink-0 tap">
                  <XIcon size={12} />
                </button>
              </div>
            )}

            {/* 发表评论 / 回复 */}
            <div className="rounded-2xl p-3" style={{ background: 'var(--field-bg)', border: '1px solid var(--line)' }}>
              <textarea
                ref={textareaRef}
                value={draft}
                onChange={e => setDraft(e.target.value.slice(0, COMMENT_MAX))}
                rows={3}
                placeholder={replyTarget ? `回复 @${replyTarget.nickname}…` : '说点什么…（学习心得、疑问都可以）'}
                className="w-full bg-transparent outline-none resize-none text-xs leading-relaxed"
                style={{ color: 'var(--text-1)' }}
              />
              <div className="flex items-center justify-between mt-2">
                <span className="text-[10px]" style={{ color: 'var(--text-3)', fontVariantNumeric: 'tabular-nums' }}>
                  {draft.length} / {COMMENT_MAX}
                </span>
                <div className="flex items-center gap-2">
                  {draft && (
                    <button
                      onClick={() => { setDraft(''); cancelReply() }}
                      className="w-7 h-7 rounded-full flex items-center justify-center tap"
                      style={{ background: 'var(--chip-bg)', color: 'var(--text-3)' }}
                      aria-label="清空"
                    >
                      <XIcon size={12} />
                    </button>
                  )}
                  <button
                    onClick={submitComment}
                    disabled={posting || !draft.trim()}
                    className="px-3.5 py-1.5 rounded-full text-xs font-semibold tap"
                    style={{
                      background: draft.trim() ? 'var(--accent-fill)' : 'var(--track)',
                      color: draft.trim() ? 'var(--on-accent)' : 'var(--text-3)',
                    }}
                  >
                    {posting ? '发布中…' : replyTarget ? '回复' : '发布'}
                  </button>
                </div>
              </div>
            </div>

            {commentError && (
              <p className="text-[11px] mt-2" style={{ color: 'var(--err)' }}>{commentError}</p>
            )}

            {/* 评论列表：顶层 + 楼中楼回复 */}
            <div className="mt-4 space-y-4">
              {comments.length === 0 ? (
                <div className="flex flex-col items-center gap-2 py-6 text-center">
                  <span style={{ color: 'var(--accent)', opacity: 0.6 }}><MessageIcon size={22} /></span>
                  <p className="text-xs" style={{ color: 'var(--text-3)' }}>还没有评论，来说第一句吧</p>
                </div>
              ) : (
                comments.map(c => (
                  <div key={c.id}>
                    {renderComment(c, false)}
                    {(c.replies?.length ?? 0) > 0 && (
                      <div
                        className="mt-2.5 ml-9 pl-3 py-2.5 space-y-2.5 rounded-xl"
                        style={{ background: 'var(--surface-warm)', borderLeft: '2px solid var(--accent-border)' }}
                      >
                        {(c.replies ?? []).map(r => renderComment(r, true))}
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* 返回列表 */}
        <div className="px-4 mt-5">
          <button
            onClick={onBack}
            className="w-full card px-4 py-3.5 flex items-center justify-center gap-2 card-tap text-xs font-semibold"
            style={{ color: 'var(--text-2)' }}
          >
            <PlayIcon size={13} color="var(--text-3)" /> 返回视频列表
          </button>
        </div>
      </div>
    </div>
  )
}
