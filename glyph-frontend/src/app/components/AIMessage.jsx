import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism'
import { useState } from 'react'

function AIMessage({ text }) {
    const [copied, setCopied] = useState(null)

    function copyToClipboard(code, id) {
        navigator.clipboard.writeText(code)
        setCopied(id)
        setTimeout(() => setCopied(null), 2000)
    }

    if (!text) return null

    return (
        <div className="prose prose-invert max-w-none text-sm leading-relaxed">
            <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                    code({ inline, className, children, ...props }) {
                        const match = /language-(\w+)/.exec(className || '')
                        const codeString = String(children).replace(/\n$/, '')
                        const codeId = codeString.slice(0, 24)

                        if (!inline && match) {
                            return (
                                <div className="relative my-3 overflow-hidden rounded-xl border border-[var(--color-line)]">
                                    <div className="flex items-center justify-between border-b border-[var(--color-line-soft)] bg-[var(--color-surface-3)] px-3 py-1.5 text-[11px] text-[var(--color-fg-muted)]">
                                        <span className="font-mono uppercase tracking-wider">{match[1]}</span>
                                        <button
                                            onClick={() => copyToClipboard(codeString, codeId)}
                                            className="rounded-md px-2 py-0.5 text-[10px] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-fg)]"
                                        >
                                            {copied === codeId ? '✓ Copied' : 'Copy'}
                                        </button>
                                    </div>
                                    <SyntaxHighlighter
                                        style={oneDark}
                                        language={match[1]}
                                        PreTag="div"
                                        customStyle={{
                                            margin: 0,
                                            borderRadius: 0,
                                            padding: '14px 16px',
                                            background: 'transparent',
                                            fontSize: '12.5px',
                                        }}
                                        {...props}
                                    >
                                        {codeString}
                                    </SyntaxHighlighter>
                                </div>
                            )
                        }

                        if (!inline && !match) {
                            return (
                                <div className="relative my-3 overflow-hidden rounded-xl border border-[var(--color-line)]">
                                    <div className="flex items-center justify-end border-b border-[var(--color-line-soft)] bg-[var(--color-surface-3)] px-3 py-1.5 text-[11px] text-[var(--color-fg-muted)]">
                                        <button
                                            onClick={() => copyToClipboard(codeString, codeId)}
                                            className="rounded-md px-2 py-0.5 text-[10px] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-fg)]"
                                        >
                                            {copied === codeId ? '✓ Copied' : 'Copy'}
                                        </button>
                                    </div>
                                    <SyntaxHighlighter
                                        style={oneDark}
                                        language="text"
                                        PreTag="div"
                                        customStyle={{
                                            margin: 0,
                                            borderRadius: 0,
                                            padding: '14px 16px',
                                            background: 'transparent',
                                            fontSize: '12.5px',
                                        }}
                                        {...props}
                                    >
                                        {codeString}
                                    </SyntaxHighlighter>
                                </div>
                            )
                        }

                        return (
                            <code
                                className="rounded bg-[var(--color-surface-3)] px-1.5 py-0.5 font-mono text-[12px] text-[var(--color-fg)]"
                                {...props}
                            >
                                {children}
                            </code>
                        )
                    },
                    p({ children }) {
                        return <p className="mb-3 last:mb-0 text-[var(--color-fg)]">{children}</p>
                    },
                    ul({ children }) {
                        return <ul className="mb-3 list-disc space-y-1 pl-5 text-[var(--color-fg)]">{children}</ul>
                    },
                    ol({ children }) {
                        return <ol className="mb-3 list-decimal space-y-1 pl-5 text-[var(--color-fg)]">{children}</ol>
                    },
                    li({ children }) {
                        return <li className="text-[var(--color-fg)]">{children}</li>
                    },
                    h1({ children }) {
                        return <h1 className="mb-2 text-lg font-semibold tracking-tight text-[var(--color-fg)]">{children}</h1>
                    },
                    h2({ children }) {
                        return <h2 className="mb-2 text-base font-semibold tracking-tight text-[var(--color-fg)]">{children}</h2>
                    },
                    h3({ children }) {
                        return <h3 className="mb-2 text-sm font-semibold tracking-tight text-[var(--color-fg)]">{children}</h3>
                    },
                    strong({ children }) {
                        return <strong className="font-semibold text-[var(--color-fg)]">{children}</strong>
                    },
                    em({ children }) {
                        return <em className="italic text-[var(--color-fg-muted)]">{children}</em>
                    },
                    blockquote({ children }) {
                        return (
                            <blockquote className="my-3 border-l-2 border-[var(--color-line)] pl-3 italic text-[var(--color-fg-muted)]">
                                {children}
                            </blockquote>
                        )
                    },
                    table({ children }) {
                        return (
                            <div className="my-3 overflow-x-auto rounded-lg border border-[var(--color-line)]">
                                <table className="min-w-full border-collapse text-sm">{children}</table>
                            </div>
                        )
                    },
                    th({ children }) {
                        return (
                            <th className="border-b border-[var(--color-line)] bg-[var(--color-surface-3)] px-3 py-2 text-left font-semibold text-[var(--color-fg)]">
                                {children}
                            </th>
                        )
                    },
                    td({ children }) {
                        return (
                            <td className="border-b border-[var(--color-line-soft)] px-3 py-2 text-[var(--color-fg)]">
                                {children}
                            </td>
                        )
                    },
                    hr() {
                        return <hr className="my-4 border-[var(--color-line-soft)]" />
                    },
                    a({ href, children }) {
                        return (
                            <a
                                href={href}
                                className="text-sky-300 underline-offset-2 hover:underline"
                                target="_blank"
                                rel="noopener noreferrer"
                            >
                                {children}
                            </a>
                        )
                    },
                }}
            >
                {text}
            </ReactMarkdown>
        </div>
    )
}

export default AIMessage
