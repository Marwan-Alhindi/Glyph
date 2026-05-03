import { useState } from "react"
import { getLLMColor, getLLMInitials, modelTypeLabel } from "../utils/llmColors"

function InviteLLM({ onClose, onInvite, invitedLLMs }) {
    const [name, setName] = useState("")
    const [modelType, setModelType] = useState("openai")
    const [instructions, setInstructions] = useState("")
    const [connections, setConnections] = useState(["user"])

    const nextNumber = (invitedLLMs.reduce((m, l) => Math.max(m, l.display_number || 0), 0) || 0) + 1
    const previewColor = getLLMColor(nextNumber)

    function toggleConnection(id) {
        setConnections(prev => (prev.includes(id) ? prev.filter(c => c !== id) : [...prev, id]))
    }

    function handleConfirm() {
        if (!name.trim()) return
        onInvite(name, modelType, instructions, connections)
    }

    return (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/60 backdrop-blur-sm">
            <div className="lp-scroll w-full max-w-md mx-4 max-h-[88vh] overflow-y-auto rounded-2xl border border-[var(--color-line)] bg-[var(--color-surface-1)] shadow-2xl">
                {/* Header */}
                <div className="flex items-center justify-between border-b border-[var(--color-line-soft)] px-5 py-4">
                    <div>
                        <p className="text-base font-semibold text-[var(--color-fg)]">Invite a model</p>
                        <p className="mt-0.5 text-xs text-[var(--color-fg-muted)]">Pick a model and how it should behave.</p>
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
                    {/* Preview */}
                    <div className={`flex items-center gap-3 rounded-xl border ${previewColor.softBorder} ${previewColor.softBg} px-3 py-2.5`}>
                        <span className={`flex h-8 w-8 items-center justify-center rounded-full ${previewColor.avatarBg} text-xs font-semibold ${previewColor.avatarText}`}>
                            {name ? getLLMInitials(name) : '?'}
                        </span>
                        <div className="min-w-0">
                            <div className={`truncate text-sm font-medium ${previewColor.text}`}>
                                {name || 'New model'}
                            </div>
                            <div className="text-[10px] text-[var(--color-fg-subtle)]">
                                {modelTypeLabel(modelType)} · #{nextNumber}
                            </div>
                        </div>
                    </div>

                    <Field label="Display name">
                        <input
                            type="text"
                            placeholder="e.g. Aria, Nova, Helper"
                            className="w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-surface-2)] px-3 py-2 text-sm text-[var(--color-fg)] placeholder:text-[var(--color-fg-subtle)] outline-none focus:border-[var(--color-fg-subtle)]"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            autoFocus
                        />
                    </Field>

                    <Field label="Model">
                        <select
                            value={modelType}
                            onChange={(e) => setModelType(e.target.value)}
                            className="w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-surface-2)] px-3 py-2 text-sm text-[var(--color-fg)] outline-none focus:border-[var(--color-fg-subtle)]"
                        >
                            <option value="openai">ChatGPT (GPT-4o)</option>
                        </select>
                    </Field>

                    <Field label="Instructions" hint="Guide the model's tone, role, or focus.">
                        <textarea
                            rows={3}
                            placeholder="You are a senior product designer. Be concise and pragmatic."
                            className="w-full resize-none rounded-lg border border-[var(--color-line)] bg-[var(--color-surface-2)] px-3 py-2 text-sm text-[var(--color-fg)] placeholder:text-[var(--color-fg-subtle)] outline-none focus:border-[var(--color-fg-subtle)]"
                            value={instructions}
                            onChange={(e) => setInstructions(e.target.value)}
                        />
                    </Field>

                    <Field label="Connect to" hint="Decide who this model can read.">
                        <div className="space-y-1.5">
                            <ConnectionRow
                                checked={connections.includes("user")}
                                onChange={() => toggleConnection("user")}
                                avatar={
                                    <span className="flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-br from-emerald-400 to-sky-400 text-[10px] font-semibold text-black">
                                        U
                                    </span>
                                }
                                label="All teammates"
                                sub="Reads messages from any human in the chat"
                            />
                            {invitedLLMs.map(llm => {
                                const c = getLLMColor(llm.display_number)
                                return (
                                    <ConnectionRow
                                        key={llm.id}
                                        checked={connections.includes(llm.id)}
                                        onChange={() => toggleConnection(llm.id)}
                                        avatar={
                                            <span className={`flex h-7 w-7 items-center justify-center rounded-full ${c.avatarBg} text-[10px] font-semibold ${c.avatarText}`}>
                                                {getLLMInitials(llm.display_name)}
                                            </span>
                                        }
                                        label={llm.display_name}
                                        sub={`${modelTypeLabel(llm.model_type)} · #${llm.display_number}`}
                                    />
                                )
                            })}
                            {invitedLLMs.length === 0 && (
                                <p className="px-1 text-xs text-[var(--color-fg-subtle)]">No other models in this chat yet.</p>
                            )}
                        </div>
                    </Field>
                </div>

                {/* Footer */}
                <div className="flex items-center justify-end gap-2 border-t border-[var(--color-line-soft)] px-5 py-3">
                    <button
                        onClick={onClose}
                        className="rounded-lg px-3 py-2 text-sm text-[var(--color-fg-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-fg)]"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleConfirm}
                        disabled={!name.trim()}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-white px-4 py-2 text-sm font-medium text-black hover:bg-[var(--color-brand)] disabled:opacity-40"
                    >
                        Invite model →
                    </button>
                </div>
            </div>
        </div>
    )
}

function Field({ label, hint, children }) {
    return (
        <div>
            <div className="mb-1.5 flex items-center justify-between">
                <span className="text-xs font-medium text-[var(--color-fg-muted)]">{label}</span>
                {hint && <span className="text-[10px] text-[var(--color-fg-subtle)]">{hint}</span>}
            </div>
            {children}
        </div>
    )
}

function ConnectionRow({ checked, onChange, avatar, label, sub }) {
    return (
        <label
            className={`flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2 transition-colors ${
                checked
                    ? 'border-[var(--color-fg-subtle)] bg-[var(--color-surface-2)]'
                    : 'border-[var(--color-line-soft)] bg-[var(--color-surface-2)]/40 hover:bg-[var(--color-surface-2)]'
            }`}
        >
            <input
                type="checkbox"
                checked={checked}
                onChange={onChange}
                className="h-4 w-4 accent-white"
            />
            {avatar}
            <div className="min-w-0">
                <div className="truncate text-sm text-[var(--color-fg)]">{label}</div>
                <div className="truncate text-[10px] text-[var(--color-fg-subtle)]">{sub}</div>
            </div>
        </label>
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
