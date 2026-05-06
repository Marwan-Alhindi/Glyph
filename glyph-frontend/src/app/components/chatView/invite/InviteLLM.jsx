import { useState } from "react"
import { getLLMColor, getLLMInitials, modelTypeLabel } from "../../../utils/llmColors"
import { FOUNDATION_MODELS, SPECIALIST_AGENTS } from "../../../utils/modelCatalog"

function InviteLLM({ onClose, onInvite, invitedLLMs }) {
    const [mode, setMode] = useState("specialists")
    const [name, setName] = useState(SPECIALIST_AGENTS[0].defaultName)
    const [modelType, setModelType] = useState(SPECIALIST_AGENTS[0].id)

    const nextNumber = (invitedLLMs.reduce((m, l) => Math.max(m, l.display_number || 0), 0) || 0) + 1
    const previewColor = getLLMColor(nextNumber)
    const selectedSpecialist = SPECIALIST_AGENTS.find(agent => agent.id === modelType)
    const selectedFoundation = FOUNDATION_MODELS.find(model => model.id === modelType)
    const selectedOption = selectedSpecialist || selectedFoundation

    function chooseSpecialist(agent) {
        setMode("specialists")
        setModelType(agent.id)
        setName(agent.defaultName)
    }

    function chooseFoundation(model) {
        setMode("models")
        setModelType(model.id)
        setName(model.defaultName)
    }

    function handleConfirm() {
        if (!name.trim()) return
        onInvite(name, modelType, selectedSpecialist?.instructions || "", ["user"])
    }

    return (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/60 backdrop-blur-sm">
            <div className="lp-scroll w-full max-w-2xl mx-4 max-h-[88vh] overflow-y-auto rounded-2xl border border-[var(--color-line)] bg-[var(--color-surface-1)] shadow-2xl">
                {/* Header */}
                <div className="flex items-center justify-between border-b border-[var(--color-line-soft)] px-5 py-4">
                    <div>
                        <p className="text-base font-semibold text-[var(--color-fg)]">Invite a model</p>
                        <p className="mt-0.5 text-xs text-[var(--color-fg-muted)]">Pick a Glyph specialist or a raw foundation model.</p>
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
                    <div className="grid grid-cols-2 gap-1 rounded-xl border border-[var(--color-line)] bg-[var(--color-surface-2)] p-1">
                        <ModeButton active={mode === "specialists"} onClick={() => chooseSpecialist(selectedSpecialist || SPECIALIST_AGENTS[0])}>
                            Specialists
                        </ModeButton>
                        <ModeButton active={mode === "models"} onClick={() => chooseFoundation(selectedFoundation || FOUNDATION_MODELS[0])}>
                            Foundation Models
                        </ModeButton>
                    </div>

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

                    {mode === "specialists" ? (
                        <Field label="Glyph Specialists" hint="Curated model, tools, and behavior.">
                            <div className="grid gap-2 sm:grid-cols-2">
                                {SPECIALIST_AGENTS.map(agent => (
                                    <OptionCard
                                        key={agent.id}
                                        active={modelType === agent.id}
                                        title={agent.label}
                                        meta={agent.poweredBy}
                                        description={agent.description}
                                        tags={agent.strengths}
                                        onClick={() => chooseSpecialist(agent)}
                                    />
                                ))}
                            </div>
                        </Field>
                    ) : (
                        <Field label="Foundation Models" hint="General model choices, no specialist pairing.">
                            <div className="grid gap-2 sm:grid-cols-2">
                                {FOUNDATION_MODELS.map(model => (
                                    <OptionCard
                                        key={model.id}
                                        active={modelType === model.id}
                                        title={model.label}
                                        meta="General tools"
                                        description={model.description}
                                        onClick={() => chooseFoundation(model)}
                                    />
                                ))}
                            </div>
                        </Field>
                    )}

                    <Field label="Display name">
                        <input
                            type="text"
                            placeholder={`e.g. ${selectedOption?.defaultName || "Helper"}`}
                            className="w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-surface-2)] px-3 py-2 text-sm text-[var(--color-fg)] placeholder:text-[var(--color-fg-subtle)] outline-none focus:border-[var(--color-fg-subtle)]"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            autoFocus
                        />
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

function ModeButton({ active, onClick, children }) {
    return (
        <button
            type="button"
            onClick={onClick}
            className={`rounded-lg px-3 py-2 text-xs font-medium transition-colors ${
                active
                    ? "bg-[var(--color-surface-3)] text-[var(--color-fg)]"
                    : "text-[var(--color-fg-subtle)] hover:bg-[var(--color-surface-1)] hover:text-[var(--color-fg-muted)]"
            }`}
        >
            {children}
        </button>
    )
}

function OptionCard({ active, title, meta, description, tags = [], onClick }) {
    return (
        <button
            type="button"
            onClick={onClick}
            className={`min-h-32 rounded-xl border p-3 text-left transition-colors ${
                active
                    ? "border-white/70 bg-white/10"
                    : "border-[var(--color-line)] bg-[var(--color-surface-2)] hover:border-[var(--color-fg-subtle)] hover:bg-[var(--color-surface-3)]"
            }`}
        >
            <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-[var(--color-fg)]">{title}</div>
                    <div className="mt-0.5 text-[10px] text-[var(--color-fg-subtle)]">{meta}</div>
                </div>
                <span className={`mt-0.5 h-2.5 w-2.5 shrink-0 rounded-full border ${active ? "border-white bg-white" : "border-[var(--color-fg-subtle)]"}`} />
            </div>
            <p className="mt-2 text-xs leading-5 text-[var(--color-fg-muted)]">{description}</p>
            {tags.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-1.5">
                    {tags.map(tag => (
                        <span key={tag} className="rounded-md border border-[var(--color-line-soft)] px-1.5 py-0.5 text-[10px] text-[var(--color-fg-subtle)]">
                            {tag}
                        </span>
                    ))}
                </div>
            )}
        </button>
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

function CloseIcon() {
    return (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
        </svg>
    )
}

export default InviteLLM
