import { getLLMColor, getLLMInitials, modelTypeLabel } from "../../../utils/llmColors"
import { findMentions } from "../../../utils/mentions"

function LLMContext({ llm, messages, invitedLLMs = [], onClose }) {
    const c = getLLMColor(llm.display_number)
    const llmMentionables = invitedLLMs.map(item => ({
        id: item.id,
        display_name: item.display_name,
        kind: 'llm',
        llm: item,
    }))

    const connections = llm.llm_connections || []
    const connectedToUser = connections.some(c => c.target_type === 'user')
    const connectedLlmIds = connections.filter(c => c.target_type === 'llm').map(c => c.target_llm_id)

    const relevantMessages = messages.filter(msg => {
        if (msg.sender_type === 'llm' && msg.sender_llm_id === llm.id) return true
        if (msg.sender_type === 'user') {
            const mentions = findMentions(msg.content, llmMentionables)
            if (mentions.length === 0) return connectedToUser
            return mentions.some(m => m.kind === 'llm' && m.llm?.id === llm.id)
        }
        if (msg.sender_type === 'llm' && connectedLlmIds.includes(msg.sender_llm_id)) return true
        return false
    })

    function estimateTokens(text) {
        return Math.ceil((text || '').length / 4)
    }

    const systemPromptTokens = estimateTokens(llm.model_instruct)

    const contributorMap = {}
    relevantMessages.forEach(msg => {
        const llmInfo = msg.invited_llms
        const key = msg.sender_type === 'user' ? 'user' : `${llmInfo?.display_name || 'LLM'} #${llmInfo?.display_number || '?'}`
        if (!contributorMap[key]) {
            contributorMap[key] = { tokens: 0, type: msg.sender_type === 'user' ? 'user' : 'llm', displayNumber: llmInfo?.display_number }
        }
        contributorMap[key].tokens += estimateTokens(msg.content)
    })

    const totalTokens = systemPromptTokens + Object.values(contributorMap).reduce((sum, c) => sum + c.tokens, 0)

    const breakdown = [
        { label: 'System prompt', tokens: systemPromptTokens, hex: '#a78bfa' },
        ...Object.entries(contributorMap).map(([name, data]) => ({
            label: name === 'user' ? 'Teammates' : name,
            tokens: data.tokens,
            hex: data.type === 'user' ? '#facc15' : (getLLMColor(data.displayNumber).hex || '#10b981'),
        })),
    ]

    return (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/60 backdrop-blur-sm">
            <div className="lp-scroll w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto rounded-2xl border border-[var(--color-line)] bg-[var(--color-surface-1)] shadow-2xl">
                {/* Header */}
                <div className={`flex items-center justify-between border-b ${c.softBorder} ${c.softBg} px-5 py-4`}>
                    <div className="flex items-center gap-3">
                        <span className={`flex h-10 w-10 items-center justify-center rounded-full ${c.avatarBg} text-sm font-semibold ${c.avatarText}`}>
                            {getLLMInitials(llm.display_name)}
                        </span>
                        <div>
                            <p className={`text-sm font-semibold ${c.text}`}>
                                {llm.display_name} <span className="text-[var(--color-fg-subtle)] font-normal">· #{llm.display_number}</span>
                            </p>
                            <p className="text-[11px] text-[var(--color-fg-muted)]">{modelTypeLabel(llm.model_type)}</p>
                        </div>
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
                    {/* Visible messages */}
                    <Section label={`Visible messages (${relevantMessages.length})`}>
                        <div className="lp-scroll max-h-56 space-y-2 overflow-y-auto pr-1">
                            {relevantMessages.length === 0 && (
                                <p className="text-xs text-[var(--color-fg-subtle)]">No messages yet.</p>
                            )}
                            {relevantMessages.map(msg => {
                                const llmInfo = msg.invited_llms
                                const isUser = msg.sender_type === 'user'
                                const cc = isUser ? null : getLLMColor(llmInfo?.display_number)
                                return (
                                    <div key={msg.id} className="rounded-lg border border-[var(--color-line-soft)] bg-[var(--color-surface-2)] p-3 text-sm">
                                        <p className={`mb-1 text-[10px] font-semibold uppercase tracking-widest ${isUser ? 'text-amber-300' : cc.text}`}>
                                            {isUser ? 'Teammate' : `${llmInfo?.display_name} · #${llmInfo?.display_number}`}
                                        </p>
                                        <p className="line-clamp-3 text-[var(--color-fg)]">{msg.content}</p>
                                    </div>
                                )
                            })}
                        </div>
                    </Section>

                    {/* Context usage */}
                    <Section label="Context usage" hint={`~${totalTokens.toLocaleString()} tokens`}>
                        {totalTokens > 0 && (
                            <div className="mb-3 flex h-2 overflow-hidden rounded-full bg-[var(--color-surface-3)]">
                                {breakdown.map((item, i) => (
                                    <div
                                        key={i}
                                        style={{
                                            width: `${(item.tokens / totalTokens) * 100}%`,
                                            backgroundColor: item.hex,
                                        }}
                                        title={`${item.label}: ${item.tokens} tokens`}
                                    />
                                ))}
                            </div>
                        )}
                        <div className="space-y-1.5">
                            {breakdown.map((item, i) => {
                                const pct = totalTokens > 0 ? ((item.tokens / totalTokens) * 100).toFixed(1) : 0
                                return (
                                    <div key={i} className="flex items-center justify-between text-xs">
                                        <div className="flex items-center gap-2">
                                            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: item.hex }} />
                                            <span className="text-[var(--color-fg)]">{item.label}</span>
                                        </div>
                                        <span className="text-[var(--color-fg-muted)]">~{item.tokens.toLocaleString()} ({pct}%)</span>
                                    </div>
                                )
                            })}
                        </div>
                    </Section>
                </div>

                <div className="flex justify-end border-t border-[var(--color-line-soft)] px-5 py-3">
                    <button
                        onClick={onClose}
                        className="rounded-lg px-3 py-2 text-sm text-[var(--color-fg-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-fg)]"
                    >
                        Close
                    </button>
                </div>
            </div>
        </div>
    )
}

function Section({ label, hint, children }) {
    return (
        <div>
            <div className="mb-2 flex items-center justify-between">
                <span className="text-[10px] font-semibold uppercase tracking-widest text-[var(--color-fg-subtle)]">
                    {label}
                </span>
                {hint && <span className="text-[10px] text-[var(--color-fg-subtle)]">{hint}</span>}
            </div>
            {children}
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

export default LLMContext
