// Stable color identity for each LLM in a chat.
// We pick by display_number so the same LLM keeps the same color
// across renders, sessions, and panes.

const PALETTE = [
  {
    name: "emerald",
    avatarBg: "bg-emerald-500",
    avatarText: "text-emerald-950",
    text: "text-emerald-300",
    softBg: "bg-emerald-500/10",
    softBorder: "border-emerald-500/30",
    ring: "ring-emerald-500/60",
    dot: "bg-emerald-400",
    glow: "shadow-[0_0_24px_-6px_rgba(16,185,129,0.55)]",
    hex: "#10b981",
  },
  {
    name: "sky",
    avatarBg: "bg-sky-500",
    avatarText: "text-sky-950",
    text: "text-sky-300",
    softBg: "bg-sky-500/10",
    softBorder: "border-sky-500/30",
    ring: "ring-sky-500/60",
    dot: "bg-sky-400",
    glow: "shadow-[0_0_24px_-6px_rgba(14,165,233,0.55)]",
    hex: "#0ea5e9",
  },
  {
    name: "violet",
    avatarBg: "bg-violet-500",
    avatarText: "text-violet-950",
    text: "text-violet-300",
    softBg: "bg-violet-500/10",
    softBorder: "border-violet-500/30",
    ring: "ring-violet-500/60",
    dot: "bg-violet-400",
    glow: "shadow-[0_0_24px_-6px_rgba(139,92,246,0.55)]",
    hex: "#8b5cf6",
  },
  {
    name: "amber",
    avatarBg: "bg-amber-400",
    avatarText: "text-amber-950",
    text: "text-amber-300",
    softBg: "bg-amber-400/10",
    softBorder: "border-amber-400/30",
    ring: "ring-amber-400/60",
    dot: "bg-amber-400",
    glow: "shadow-[0_0_24px_-6px_rgba(251,191,36,0.55)]",
    hex: "#fbbf24",
  },
  {
    name: "rose",
    avatarBg: "bg-rose-500",
    avatarText: "text-rose-950",
    text: "text-rose-300",
    softBg: "bg-rose-500/10",
    softBorder: "border-rose-500/30",
    ring: "ring-rose-500/60",
    dot: "bg-rose-400",
    glow: "shadow-[0_0_24px_-6px_rgba(244,63,94,0.55)]",
    hex: "#f43f5e",
  },
  {
    name: "cyan",
    avatarBg: "bg-cyan-500",
    avatarText: "text-cyan-950",
    text: "text-cyan-300",
    softBg: "bg-cyan-500/10",
    softBorder: "border-cyan-500/30",
    ring: "ring-cyan-500/60",
    dot: "bg-cyan-400",
    glow: "shadow-[0_0_24px_-6px_rgba(6,182,212,0.55)]",
    hex: "#06b6d4",
  },
  {
    name: "fuchsia",
    avatarBg: "bg-fuchsia-500",
    avatarText: "text-fuchsia-950",
    text: "text-fuchsia-300",
    softBg: "bg-fuchsia-500/10",
    softBorder: "border-fuchsia-500/30",
    ring: "ring-fuchsia-500/60",
    dot: "bg-fuchsia-400",
    glow: "shadow-[0_0_24px_-6px_rgba(217,70,239,0.55)]",
    hex: "#d946ef",
  },
  {
    name: "lime",
    avatarBg: "bg-lime-400",
    avatarText: "text-lime-950",
    text: "text-lime-300",
    softBg: "bg-lime-400/10",
    softBorder: "border-lime-400/30",
    ring: "ring-lime-400/60",
    dot: "bg-lime-400",
    glow: "shadow-[0_0_24px_-6px_rgba(163,230,53,0.55)]",
    hex: "#a3e635",
  },
];

export function getLLMColor(displayNumber) {
  const n = Number.isFinite(displayNumber) ? Math.max(1, displayNumber) : 1;
  return PALETTE[(n - 1) % PALETTE.length];
}

export function getLLMInitials(displayName) {
  if (!displayName) return "AI";
  const parts = displayName.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function modelTypeLabel(modelType) {
  switch (modelType) {
    case "openai":
      return "GPT-4o";
    case "anthropic":
      return "Claude";
    case "google":
      return "Gemini";
    case "perplexity":
      return "Perplexity";
    default:
      return modelType || "Model";
  }
}
