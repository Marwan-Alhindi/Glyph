import { useState } from "react"
import { getLLMColor, getLLMInitials } from "../../../utils/llmColors"
import { useLanguage } from "../../../../contexts/LanguageContext"

function InviteLLM({ onClose, onInvite, invitedLLMs }) {
    const { t } = useLanguage()
    const ti = t.inviteLLM
    const [name, setName] = useState("")
    const [submitting, setSubmitting] = useState(false)

    // Captured once on mount so the preview doesn't jump when the realtime
    // subscription fires and invitedLLMs grows during the invite request.
    const [nextNumber] = useState(
        () => (invitedLLMs.reduce((m, l) => Math.max(m, l.display_number || 0), 0) || 0) + 1
    )
    const previewColor = getLLMColor(nextNumber)

    async function handleConfirm() {
        if (!name.trim() || submitting) return
        setSubmitting(true)
        await onInvite(name, "glyph", "", ["user"])
        setSubmitting(false)
    }

    return (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/60 backdrop-blur-sm">
            <div className="w-full max-w-md mx-4 rounded-2xl border border-[var(--color-line)] bg-[var(--color-surface-1)] shadow-2xl">
                <div className="flex items-center justify-between border-b border-[var(--color-line-soft)] px-5 py-4">
                    <div>
                        <p className="text-base font-semibold text-[var(--color-fg)]">{ti.title}</p>
                        <p className="mt-0.5 text-xs text-[var(--color-fg-muted)]">{ti.subtitle}</p>
                    </div>
                    <button
                        onClick={onClose}
                        aria-label="Close"
                        className="rounded-md p-1 text-[var(--color-fg-muted)] hover:bg-[var(--color-surface-2)]"
                    >
                        <CloseIcon />
                    </button>
                </div>

                <div className="space-y-5 px-5 py-5">
                    {name.trim() && (
                        <div className={`flex items-center gap-3 rounded-xl border ${previewColor.softBorder} ${previewColor.softBg} px-3 py-2.5`}>
                            <span className={`flex h-8 w-8 items-center justify-center rounded-full ${previewColor.avatarBg} text-xs font-semibold ${previewColor.avatarText}`}>
                                {getLLMInitials(name)}
                            </span>
                            <div className="min-w-0">
                                <div className={`truncate text-sm font-medium ${previewColor.text}`}>{name}</div>
                                <div className="text-[10px] text-[var(--color-fg-subtle)]">#{nextNumber}</div>
                            </div>
                        </div>
                    )}

                    <div>
                        <label className="mb-1.5 block text-xs font-medium text-[var(--color-fg-muted)]">{ti.displayName}</label>
                        <input
                            type="text"
                            placeholder="e.g. Glyph"
                            className="w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-surface-2)] px-3 py-2 text-sm text-[var(--color-fg)] placeholder:text-[var(--color-fg-subtle)] outline-none focus:border-[var(--color-fg-subtle)]"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            onKeyDown={(e) => e.key === "Enter" && handleConfirm()}
                            autoFocus
                        />
                    </div>
                </div>

                <div className="flex items-center justify-end gap-2 border-t border-[var(--color-line-soft)] px-5 py-3">
                    <button
                        onClick={onClose}
                        className="rounded-lg px-3 py-2 text-sm text-[var(--color-fg-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-fg)]"
                    >
                        {t.chat.cancel}
                    </button>
                    <button
                        onClick={handleConfirm}
                        disabled={!name.trim() || submitting}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-white px-4 py-2 text-sm font-medium text-black hover:bg-[var(--color-brand)] disabled:opacity-40"
                    >
                        {submitting ? "Inviting…" : ti.inviteBtn}
                    </button>
                </div>
            </div>
        </div>
    )
}

function CloseIcon() {
    return (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
        </svg>
    )
}

export default InviteLLM
