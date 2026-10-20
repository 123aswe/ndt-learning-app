import { ChevronLeftIcon } from '../components/icons'
import { LEGAL_DOCS, type LegalKey } from '../data/legal'

/* ============================================================
   法律文本页（《服务协议》/《隐私政策》）
   - 职责：整屏展示 legal.ts 里的一篇文档，返回按钮回到登录页
   - 数据来源：src/data/legal.ts（只改文字，不改本文件）
   - 滚动结构：根元素必须是唯一的 .scroll-area 容器（height:100dvh + overflow-y:auto），
     顶栏与正文都放在它内部随页面一起滚动。不要在外层再套 .app-shell
     （.app-shell 是 overflow:hidden，会把超出的正文裁掉、导致无法滑动看全）
   - 修改注意：改设计规范请查根目录 FRONTEND.md §10 / §11
   ============================================================ */

interface LegalScreenProps {
  docKey: LegalKey
  onBack: () => void
}

export function LegalScreen({ docKey, onBack }: LegalScreenProps) {
  const doc = LEGAL_DOCS[docKey]

  return (
    <div className="scroll-area bg-page ui-stagger">
      {/* 顶栏：返回 + 标题 */}
      <div className="flex items-center gap-3 px-5 pt-14 pb-4">
        <button
          onClick={onBack}
          aria-label="返回"
          className="gb gb-ghost gb-sm flex h-9 w-9 items-center justify-center"
          style={{ background: 'var(--chip-bg)', border: '1px solid var(--chip-border)' }}
        >
          <ChevronLeftIcon size={18} color="var(--text-2)" />
        </button>
        <h1 className="text-xl font-bold" style={{ color: 'var(--text-1)' }}>{doc.title}</h1>
      </div>

      {/* 正文（随整页一起上下滑动） */}
      <div className="px-4" style={{ paddingBottom: 48 }}>
        <div className="card rounded-2xl p-5">
          <p className="text-xs" style={{ color: 'var(--text-3)' }}>更新日期：{doc.updatedAt}</p>

          <p className="mt-4 text-[13px] leading-relaxed" style={{ color: 'var(--text-2)' }}>
            {doc.intro}
          </p>

          {doc.sections.map((section) => (
            <section key={section.heading} className="mt-6">
              <h2 className="text-[15px] font-bold" style={{ color: 'var(--text-1)' }}>
                {section.heading}
              </h2>
              {section.paragraphs.map((text, index) => (
                <p
                  key={index}
                  className="mt-2.5 text-[13px] leading-relaxed"
                  style={{ color: 'var(--text-2)' }}
                >
                  {text}
                </p>
              ))}
            </section>
          ))}

          <div
            className="mt-7 rounded-xl p-3.5 text-[12px] leading-relaxed"
            style={{ background: 'var(--accent-weak)', color: 'var(--accent)' }}
          >
            本文本为平台当前执行的版本。若您对内容有疑问，可通过页面底部联系方式与管理员沟通。
          </div>
        </div>

        {/* 返回按钮 */}
        <button
          onClick={onBack}
          className="gb gb-primary gb-lg mt-4 flex w-full items-center justify-center text-base font-semibold"
          style={{ height: 52 }}
        >
          我已阅读，返回
        </button>
      </div>
    </div>
  )
}
