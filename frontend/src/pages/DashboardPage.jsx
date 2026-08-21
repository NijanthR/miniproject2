import { useEffect, useRef, useState } from 'react'
import {
  FiArrowDown,
  FiBookOpen,
  FiCheck,
  FiCode,
  FiCopy,
  FiDownload,
  FiHelpCircle,
  FiPlay,
  FiRefreshCw,
  FiThumbsDown,
  FiThumbsUp,
  FiTrash2,
  FiVolume2,
  FiVolumeX,
  FiZap,
} from 'react-icons/fi'
import { RiSparklingFill } from 'react-icons/ri'
import ReactMarkdown from 'react-markdown'
import rehypeKatex from 'rehype-katex'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import { useNavigate } from 'react-router-dom'

import ChatBody from '../components/ChatBody.jsx'
import ChatInput from '../components/ChatInput.jsx'
import { useTheme } from '../context/ThemeContext.jsx'
import { buildApiUrl } from '../config/api.js'

const CHAT_CONVERSATION_ID_KEY = 'teaching-assistant-conversation-id'
const CHAT_MESSAGES_KEY = 'teaching-assistant-chat-messages'
const PROFILE_STORAGE_KEY = 'teaching-assistant-google-user'

function formatDuration(seconds) {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(reader.error || new Error('Failed to read file.'))
    reader.readAsDataURL(file)
  })
}

function readBlobAsDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(reader.error || new Error('Failed to read audio.'))
    reader.readAsDataURL(blob)
  })
}

function getConversationStorageKey() {
  try {
    const raw = localStorage.getItem(PROFILE_STORAGE_KEY)
    const profile = raw ? JSON.parse(raw) : null
    const identity = String(profile?.sub || profile?.email || '').trim().toLowerCase()
    if (identity) return `${CHAT_CONVERSATION_ID_KEY}:${identity}`
  } catch {
    // Ignore parsing errors and fall back to shared key.
  }
  return CHAT_CONVERSATION_ID_KEY
}

function getMessagesStorageKey() {
  try {
    const raw = localStorage.getItem(PROFILE_STORAGE_KEY)
    const profile = raw ? JSON.parse(raw) : null
    const identity = String(profile?.sub || profile?.email || '').trim().toLowerCase()
    if (identity) return `${CHAT_MESSAGES_KEY}:${identity}`
  } catch {
    // Ignore parsing errors and fall back to shared key.
  }
  return CHAT_MESSAGES_KEY
}

function normalizeAssistantText(text = '') {
  let cleaned = String(text).trim()
  if (cleaned.length >= 2 && cleaned.startsWith('"') && cleaned.endsWith('"')) {
    cleaned = cleaned.slice(1, -1).trim()
  }
  cleaned = cleaned.replace(/\r\n/g, '\n')
  cleaned = cleaned.replace(/\\\[(.*?)\\\]/gs, (_, expr) => `$$${expr.trim()}$$`)
  cleaned = cleaned.replace(/\\\((.*?)\\\)/gs, (_, expr) => `$${expr.trim()}$`)
  return cleaned
}

function markdownToPlainText(text = '') {
  return String(text)
    .replace(/```[\s\S]*?```/g, (match) => match.replace(/```/g, '').trim())
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s{0,3}>\s?/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '• ')
    .replace(/^\s*\d+\.\s+/gm, '')
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/\*(.*?)\*/g, '$1')
    .replace(/__(.*?)__/g, '$1')
    .replace(/_(.*?)_/g, '$1')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

async function exportPdfDocument({ fileName, title, sections }) {
  const { jsPDF } = await import('jspdf')
  const doc = new jsPDF({ unit: 'pt', format: 'a4' })
  const pageWidth = doc.internal.pageSize.getWidth()
  const pageHeight = doc.internal.pageSize.getHeight()
  const margin = 40
  const maxTextWidth = pageWidth - margin * 2
  const lineHeight = 16
  const dividerGap = 10
  let y = margin

  const ensureSpace = (requiredHeight) => {
    if (y + requiredHeight <= pageHeight - margin) return
    doc.addPage()
    y = margin
  }

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(18)
  const titleLines = doc.splitTextToSize(title, maxTextWidth)
  ensureSpace(titleLines.length * lineHeight)
  doc.text(titleLines, margin, y)
  y += titleLines.length * lineHeight + 8

  doc.setDrawColor(210)
  doc.setLineWidth(0.6)
  doc.line(margin, y, pageWidth - margin, y)
  y += dividerGap

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  const generatedAt = `Generated: ${new Date().toLocaleString()}`
  ensureSpace(lineHeight)
  doc.text(generatedAt, margin, y)
  y += lineHeight + 14

  for (const [index, section] of sections.entries()) {
    const heading = String(section.heading || '').trim()
    const body = String(section.body || '').trim()
    if (!heading && !body) continue

    if (heading) {
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(13)
      const numberedHeading = `${index + 1}. ${heading}`
      const headingLines = doc.splitTextToSize(numberedHeading, maxTextWidth)
      ensureSpace(headingLines.length * lineHeight + 6)
      doc.text(headingLines, margin, y)
      y += headingLines.length * lineHeight + 6
    }

    if (body) {
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(11)
      const bodyLines = doc.splitTextToSize(body, maxTextWidth)
      for (const line of bodyLines) {
        ensureSpace(lineHeight)
        doc.text(line, margin, y)
        y += lineHeight
      }
      y += 10

    y += 10
    if (y < pageHeight - margin - dividerGap) {
      doc.setDrawColor(230)
      doc.setLineWidth(0.4)
      doc.line(margin, y, pageWidth - margin, y)
      y += dividerGap
    }
    }
  }

  doc.save(fileName)
}

async function extractApiError(response) {
  const contentType = response.headers.get('content-type') || ''

  if (contentType.includes('application/json')) {
    const data = await response.json()
    return data?.details || data?.error || `Request failed. Status ${response.status}.`
  }

  const rawText = await response.text()
  const cleaned = String(rawText || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (cleaned) return cleaned.slice(0, 220)

  return `Request failed. Status ${response.status}.`
}

function enhanceAssistantMarkdown(text = '') {
  const importantLinePattern = /^(important|key point|takeaway|warning)\s*[:.-]\s*(.+)$/i
  return text
    .split('\n')
    .map((line) => {
      const match = line.trim().match(importantLinePattern)
      if (match) {
        const label = `${match[1].charAt(0).toUpperCase()}${match[1].slice(1).toLowerCase()}`
        return `> **${label}:** ${match[2]}`
      }
      return line
    })
    .join('\n')
}

function toSentenceCase(value = '') {
  const text = String(value).trim().replace(/\s+/g, ' ')
  if (!text) return ''
  return text.charAt(0).toUpperCase() + text.slice(1)
}

function cleanTopicTitle(raw = '') {
  let cleaned = String(raw || '')
    .replace(/^#+\s*/, '')
    .replace(/^(\d+[.)]\s*|step\s*\d+:?\s*|[A-Z]\.\s*)/i, '')
    .replace(/^(topic|concept|part|section|module|overview|module \d+)\s*:\s*/i, '')
    .replace(/^(ai|ml|python|javascript)\s*:\s*/i, '')
    .replace(/[*_`]/g, '')
    .replace(/[.:;,-]+$/, '')
    .trim()

  if (!cleaned) return ''
  return toSentenceCase(cleaned)
}

function extractPromptTopic(prompt = '') {
  const cleaned = String(prompt || '')
    .replace(/\s+/g, ' ')
    .replace(/[?!.]+$/g, '')
    .trim()

  if (!cleaned) return ''

  const greetingPattern = /^(hi|hello|hey|yo|hola|namaste|good\s+(morning|afternoon|evening)|how are you|what'?s up|sup|thanks?|thank you)$/i
  if (greetingPattern.test(cleaned)) return ''

  const patterns = [
    /(?:about|on|regarding|for)\s+([^?.!,;]+)/i,
    /(?:what is|what are|explain|teach|describe|help me understand|summarize)\s+([^?.!,;]+)/i,
  ]

  for (const pattern of patterns) {
    const match = cleaned.match(pattern)
    if (match?.[1]) {
      return cleanTopicTitle(match[1])
    }
  }

  if (cleaned.length <= 60) return cleanTopicTitle(cleaned)
  return cleanTopicTitle(cleaned.split(' ').slice(0, 6).join(' '))
}

function suggestStudyTopics(text = '', userPrompt = '') {
  const cleaned = normalizeAssistantText(text)
  const lines = cleaned.split('\n').map((l) => l.trim()).filter(Boolean)

  const ignoredPatterns = [
    /^(introduction|summary|conclusion|takeaway|takeaways|key takeaways?|important topics?|overview|example|examples|code|python code|dry run|problem statement|complexity|approach|prerequisites|note|important|definition)$/i,
    /^(step \d+|part \d+|section \d+)$/i,
  ]

  const extracted = []
  const addTopic = (raw) => {
    const topic = cleanTopicTitle(raw)
    if (!topic || topic.length < 3 || topic.length > 50) return
    if (ignoredPatterns.some((rgx) => rgx.test(topic))) return
    if (extracted.some((t) => t.toLowerCase() === topic.toLowerCase())) return
    extracted.push(topic)
  }

  // 1. Extract markdown headings (##, ###)
  for (const line of lines) {
    const headingMatch = line.match(/^#{1,4}\s+(.+)$/)
    if (headingMatch) {
      addTopic(headingMatch[1])
    }
  }

  // 2. Extract bold lead-in titles from bullet lists (e.g. "- **Gradient Descent:** ...")
  for (const line of lines) {
    const boldMatch = line.match(/^(?:[-*•]|\d+[.)])\s+\*\*([^*]+)\*\*(?:\s*[:–-]\s*|\s*$)/)
    if (boldMatch) {
      addTopic(boldMatch[1])
    }
  }

  // 3. Extract standalone bold lines
  for (const line of lines) {
    const standaloneBold = line.match(/^\*\*([^*]{3,45})\*\*$/)
    if (standaloneBold) {
      addTopic(standaloneBold[1])
    }
  }

  // 4. If fewer than 3, extract capitalized technical multi-word terms
  if (extracted.length < 3) {
    const phraseMatches = cleaned.match(/\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,2})\b/g) || []
    for (const phrase of phraseMatches) {
      if (extracted.length >= 4) break
      addTopic(phrase)
    }
  }

  // 5. If still empty, fall back to clean domain topics derived from user prompt
  if (!extracted.length) {
    const promptTopic = cleanTopicTitle(extractPromptTopic(userPrompt) || 'Core Subject')
    return [
      `Foundations of ${promptTopic}`,
      `Core Mechanics & Working`,
      `Practical Implementation`,
      `Optimization & Edge Cases`,
    ]
  }

  return extracted.slice(0, 5)
}

function getContextualTopicSnippet(topic = '', text = '') {
  const plainText = markdownToPlainText(text)
  const cleanTop = cleanTopicTitle(topic)
  if (!cleanTop || !plainText) return 'Key concept covered in this study module.'

  const cleanTokens = cleanTop.toLowerCase().split(/\s+/).filter((t) => t.length > 2)
  const sentences = plainText.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean)

  for (const sentence of sentences) {
    const lower = sentence.toLowerCase()
    const hasKey = cleanTokens.some((tok) => lower.includes(tok))
    if (hasKey && sentence.length >= 25 && sentence.length <= 160 && !sentence.startsWith('#')) {
      return sentence.replace(/^[-*•]\s*/, '').trim()
    }
  }

  return `Core mechanics and practical applications of ${cleanTop.toLowerCase()}.`
}

function summarizeLearningPoints(text = '', topics = []) {
  const plain = markdownToPlainText(text)
  const lines = plain.split('\n').map((l) => l.trim()).filter(Boolean)

  const takeaways = []

  // 1. Look for explicit bullet points or key takeaways
  for (const line of lines) {
    const bulletMatch = line.match(/^[•\-*]\s*(.+)$/)
    if (bulletMatch) {
      const candidate = bulletMatch[1].trim()
      if (candidate.length >= 18 && candidate.length <= 150) {
        if (!takeaways.some((t) => t.toLowerCase() === candidate.toLowerCase())) {
          takeaways.push(toSentenceCase(candidate))
        }
      }
    }
    if (takeaways.length >= 4) break
  }

  // 2. Fallback: extract strong summary sentences
  if (takeaways.length < 2) {
    const sentences = plain.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter((s) => s.length >= 25 && s.length <= 150)
    for (const sent of sentences) {
      if (takeaways.length >= 3) break
      if (!takeaways.some((t) => t.toLowerCase() === sent.toLowerCase())) {
        takeaways.push(toSentenceCase(sent))
      }
    }
  }

  // 3. Find real conclusion
  const conclusionSentence = [...lines].reverse().find((l) =>
    /^(in summary|to summarize|overall|in conclusion|the key takeaway|in short|therefore)/i.test(l)
  )

  let conclusion = ''
  if (conclusionSentence) {
    conclusion = conclusionSentence.replace(/^[•\-*]\s*/, '').trim()
  } else if (topics.length >= 2) {
    conclusion = `Master ${topics[0]} as the foundational step, then explore ${topics.slice(1, 3).join(' and ')} to build end-to-end mastery.`
  } else {
    conclusion = 'Review the core concepts above and test your knowledge with interactive practice challenges.'
  }

  return {
    takeaways: takeaways.slice(0, 4),
    conclusion,
  }
}

function StudyFlowGraph({ topics, messageText = '', onTakeTest }) {
  if (!topics?.length) return null

  return (
    <div className="mt-4 overflow-hidden rounded-3xl border border-teal-500/20 bg-linear-to-b from-teal-50/60 via-slate-50/40 to-cyan-50/40 dark:from-slate-900/60 dark:via-slate-900/40 dark:to-teal-950/30 p-4.5 sm:p-5 shadow-xs backdrop-blur-xs">
      <div className="flex items-center justify-between gap-2 border-b border-teal-500/10 dark:border-slate-800 pb-3">
        <div className="flex items-center gap-2">
          <span className="grid h-6 w-6 place-items-center rounded-lg bg-teal-500/10 text-teal-600 dark:text-teal-400">
            <FiZap className="h-3.5 w-3.5" />
          </span>
          <p className="text-xs font-bold uppercase tracking-wider text-teal-800 dark:text-teal-300">
            Interactive Learning Flow
          </p>
        </div>
        <span className="text-[11px] font-semibold text-slate-400">
          {topics.length} Key Milestones
        </span>
      </div>

      {/* Horizontal roadmap nodes */}
      <div className="mt-3.5 overflow-x-auto pb-2">
        <div className="inline-flex min-w-full items-center gap-2.5">
          {topics.map((topic, index) => (
            <div key={`${topic}-${index}`} className="inline-flex items-center gap-2.5 shrink-0">
              <button
                type="button"
                onClick={() => onTakeTest && onTakeTest(topic)}
                className="group flex items-center gap-2 rounded-2xl border border-teal-500/20 bg-white dark:bg-slate-800/90 px-3.5 py-2 text-xs font-bold text-slate-800 dark:text-slate-200 shadow-xs transition-all duration-200 hover:-translate-y-0.5 hover:border-teal-500 hover:shadow-md hover:text-teal-600 dark:hover:text-teal-400 active:scale-95"
                title={`Practice test on ${topic}`}
              >
                <span className="grid h-5 w-5 place-items-center rounded-full bg-teal-500 text-[10px] font-extrabold text-white shadow-xs">
                  {index + 1}
                </span>
                <span>{topic}</span>
              </button>
              {index < topics.length - 1 ? (
                <span className="text-teal-400 dark:text-teal-600 font-bold">→</span>
              ) : null}
            </div>
          ))}
        </div>
      </div>

      {/* Concept Quick Explanations */}
      <div className="mt-3 grid gap-2 sm:grid-cols-2 pt-2.5 border-t border-teal-500/10 dark:border-slate-800">
        {topics.slice(0, 4).map((topic, idx) => (
          <div
            key={`snippet-${topic}-${idx}`}
            className="rounded-2xl border border-slate-200/70 dark:border-slate-800/80 bg-white/70 dark:bg-slate-900/60 p-3 shadow-xs"
          >
            <div className="flex items-center gap-1.5 mb-1">
              <span className="h-1.5 w-1.5 rounded-full bg-teal-500" />
              <p className="text-xs font-bold text-slate-900 dark:text-slate-100">{topic}</p>
            </div>
            <p className="text-[11px] leading-relaxed text-slate-600 dark:text-slate-400 line-clamp-2">
              {getContextualTopicSnippet(topic, messageText)}
            </p>
          </div>
        ))}
      </div>
    </div>
  )
}

function ResponseSummary({ takeaways, conclusion }) {
  if (!takeaways?.length && !conclusion) return null

  return (
    <div className="mt-4 rounded-3xl border border-slate-200/80 dark:border-slate-800 bg-white/80 dark:bg-slate-900/50 p-4.5 sm:p-5 shadow-xs backdrop-blur-xs">
      {takeaways?.length ? (
        <div>
          <div className="flex items-center gap-2 mb-2.5">
            <span className="grid h-6 w-6 place-items-center rounded-lg bg-teal-500/10 text-teal-600 dark:text-teal-400">
              <FiCheck className="h-3.5 w-3.5" />
            </span>
            <p className="text-xs font-bold uppercase tracking-wider text-teal-800 dark:text-teal-300">
              Key Takeaways
            </p>
          </div>
          <ul className="space-y-1.5 pl-1">
            {takeaways.map((point, index) => (
              <li key={`${index}-${point.slice(0, 24)}`} className="flex items-start gap-2 text-xs text-slate-700 dark:text-slate-300 leading-relaxed">
                <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-teal-500" />
                <span>{point}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {conclusion && (
        <div className={`${takeaways?.length ? 'mt-3.5 pt-3 border-t border-slate-100 dark:border-slate-800' : ''}`}>
          <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-1">
            Executive Summary
          </p>
          <p className="text-xs font-medium leading-relaxed text-slate-700 dark:text-slate-300">
            {conclusion}
          </p>
        </div>
      )}
    </div>
  )
}

function InteractiveCodeSnippet({ codeText }) {
  const [copied, setCopied] = useState(false)
  const handleCopy = () => {
    if (!codeText.trim()) return
    navigator.clipboard?.writeText(codeText)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const isPython = /(?:def\s+|import\s+|print\s*\(|class\s+)/.test(codeText)
  const isJs = /(?:const\s+|let\s+|var\s+|function\s+|console\.log)/.test(codeText)
  const langLabel = isPython ? 'Python' : isJs ? 'JavaScript' : 'Code'

  return (
    <div className="my-3 overflow-hidden rounded-2xl border border-slate-700/80 bg-slate-900 shadow-md">
      <div className="flex items-center justify-between border-b border-slate-800 bg-slate-950/70 px-4 py-2 text-xs">
        <span className="font-mono text-[11px] font-semibold uppercase tracking-wider text-teal-400">
          {langLabel}
        </span>
        <button
          type="button"
          onClick={handleCopy}
          className="flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800/80 px-2.5 py-1 text-[11px] font-medium text-slate-300 transition-all hover:bg-slate-700 hover:text-white active:scale-95"
          title="Copy snippet"
        >
          {copied ? (
            <>
              <FiCheck className="h-3.5 w-3.5 text-emerald-400" />
              <span className="text-emerald-400 font-semibold">Copied!</span>
            </>
          ) : (
            <>
              <FiCopy className="h-3.5 w-3.5" />
              <span>Copy</span>
            </>
          )}
        </button>
      </div>
      <pre className="overflow-x-auto p-4 text-[0.88em] leading-relaxed text-slate-100 font-mono">
        <code>{codeText}</code>
      </pre>
    </div>
  )
}

function renderAssistantMessage(text) {
  const getShortSymbolLabel = (value = '') => {
    const token = String(value || '').trim().toLowerCase()
    const symbolMap = {
      w: 'w (weight)',
      b: 'b (bias/intercept)',
      x: 'x (input feature)',
      y: 'y (target output)',
    }
    return symbolMap[token] || String(value || '').trim()
  }

  const shouldUseFullCodeBox = (value = '') => {
    const snippet = String(value || '').trim()
    if (!snippet) return false

    // Ignore single tokens like x, y, numpy, n_samples.
    if (/^[A-Za-z_][A-Za-z0-9_.]*$/.test(snippet)) return false

    const nonEmptyLines = snippet
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)

    // Function/line-sized snippets should be highlighted, not shown in a full code box.
    if (nonEmptyLines.length < 3) return false

    // Larger snippets with clear code syntax are good candidates for the full code box.
    return /(?:\bimport\b|\bfrom\b|\bdef\b|\bclass\b|\breturn\b|\bif\b|\bfor\b|\bwhile\b|\bprint\s*\(|\bconsole\.log\s*\(|\blet\b|\bconst\b|\bvar\b|=|\(|\)|\[|\]|\{|\}|:)/.test(snippet)
  }

  const cleaned = normalizeAssistantText(text)
  if (!cleaned) return null
  const enhanced = enhanceAssistantMarkdown(cleaned)
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm, remarkMath]}
      rehypePlugins={[rehypeKatex]}
      components={{
        p: ({ children }) => <p className="whitespace-pre-wrap text-[15px] leading-7">{children}</p>,
        ul: ({ children }) => <ul className="list-disc space-y-1.5 pl-5 text-[15px] leading-7">{children}</ul>,
        ol: ({ children }) => <ol className="list-decimal space-y-1.5 pl-5 text-[15px] leading-7">{children}</ol>,
        li: ({ children }) => <li>{children}</li>,
        blockquote: ({ children }) => (
          <blockquote className="rounded-r-xl border-l-4 border-amber-500 bg-amber-50/70 px-3 py-2 text-[15px] text-slate-700">
            {children}
          </blockquote>
        ),
        h1: ({ children }) => <h1 className="text-2xl font-bold leading-tight text-slate-900">{children}</h1>,
        h2: ({ children }) => <h2 className="text-xl font-semibold leading-tight text-slate-900">{children}</h2>,
        h3: ({ children }) => <h3 className="text-lg font-semibold leading-snug text-slate-800">{children}</h3>,
        strong: ({ children }) => <strong className="font-bold text-slate-900">{children}</strong>,
        code: ({ inline, children }) => {
          if (inline) {
            return <code className="rounded bg-slate-100 px-1 py-0.5 text-[0.85em] text-slate-700">{children}</code>
          }
          const codeText = String(children || '')
          const trimmedCode = codeText.trim()

          // Render tiny variable snippets inline-style so they stay with explanation text.
          if (!trimmedCode.includes('\n') && /^[A-Za-z]{1,2}$/.test(trimmedCode)) {
            return (
              <span className="inline rounded bg-slate-100 px-1.5 py-0.5 text-[0.9em] text-slate-700">
                {getShortSymbolLabel(trimmedCode)}
              </span>
            )
          }

          if (!shouldUseFullCodeBox(codeText)) {
            return (
              <pre className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/60 px-3 py-2 text-[0.9em] leading-7 text-slate-700 dark:text-slate-300 font-mono">
                <code>{codeText.trim()}</code>
              </pre>
            )
          }
          return <InteractiveCodeSnippet codeText={codeText} />
        },
        pre: ({ children }) => <>{children}</>,
        a: ({ children, href }) => (
          <a className="text-teal-600 underline underline-offset-2" href={href} target="_blank" rel="noreferrer">
            {children}
          </a>
        ),
      }}
    >
      {enhanced}
    </ReactMarkdown>
  )
}

function DashboardPage({ size }) {
  const isMobile = size === 'mobile'
  const navigate = useNavigate()
  const [messagesStorageKey, setMessagesStorageKey] = useState(getMessagesStorageKey())
  const [messages, setMessages] = useState(() => {
    try {
      const raw = localStorage.getItem(getMessagesStorageKey())
      const parsed = raw ? JSON.parse(raw) : []
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return []
    }
  })
  const [conversationStorageKey, setConversationStorageKey] = useState(getConversationStorageKey())
  const [conversationId, setConversationId] = useState(() => {
    try {
      return localStorage.getItem(getConversationStorageKey()) || ''
    } catch {
      return ''
    }
  })
  const [isGenerating, setIsGenerating] = useState(false)
  const [regeneratingMessageId, setRegeneratingMessageId] = useState(null)
  const [inputValue, setInputValue] = useState('')
  const [selectedModelId, setSelectedModelId] = useState('gemini-3.5-flash')
  const [audioFile, setAudioFile] = useState(null)
  const [attachedFiles, setAttachedFiles] = useState([])
  const [isFollowing, setIsFollowing] = useState(true)
  const [copiedId, setCopiedId] = useState(null)
  const [speakingId, setSpeakingId] = useState(null)
  const [messageReactions, setMessageReactions] = useState({})
  const listRef = useRef(null)
  const messagesEndRef = useRef(null)
  const typingTimerRef = useRef(null)
  const historyLoadedRef = useRef(false)

  // Scroll smoothly to the bottom of the conversation
  const scrollToBottom = (behavior = 'smooth') => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior, block: 'end' })
    } else if (listRef.current) {
      listRef.current.scrollTo({ top: listRef.current.scrollHeight, behavior })
    }
  }

  useEffect(() => {
    if (!isFollowing) return
    scrollToBottom('smooth')
  }, [messages, isFollowing])

  useEffect(() => {
    return () => {
      if (typingTimerRef.current) {
        clearTimeout(typingTimerRef.current)
        typingTimerRef.current = null
      }
    }
  }, [])

  useEffect(() => {
    const handleStorage = (event) => {
      if (event.key !== PROFILE_STORAGE_KEY) return
      const nextKey = getConversationStorageKey()
      const nextMessagesKey = getMessagesStorageKey()
      if (nextKey !== conversationStorageKey) {
        setConversationStorageKey(nextKey)
        setMessagesStorageKey(nextMessagesKey)
        historyLoadedRef.current = false
        setConversationId(() => {
          try {
            return localStorage.getItem(nextKey) || ''
          } catch {
            return ''
          }
        })
        setMessages(() => {
          try {
            const raw = localStorage.getItem(nextMessagesKey)
            const parsed = raw ? JSON.parse(raw) : []
            const safeMessages = Array.isArray(parsed) ? parsed : []
            if (safeMessages.length) return safeMessages

            // Avoid accidental clearing when identity storage changes but chat already exists in memory.
            if (messages.length) {
              localStorage.setItem(nextMessagesKey, JSON.stringify(messages))
              return messages
            }

            return []
          } catch {
            return messages.length ? messages : []
          }
        })
      }
    }

    window.addEventListener('storage', handleStorage)
    return () => window.removeEventListener('storage', handleStorage)
  }, [conversationStorageKey, messages])

  useEffect(() => {
    try {
      localStorage.setItem(messagesStorageKey, JSON.stringify(messages))
    } catch {
      // Ignore storage errors and keep in-memory state.
    }
  }, [messages, messagesStorageKey])

  useEffect(() => {
    const nextMessagesKey = getMessagesStorageKey()
    if (nextMessagesKey === messagesStorageKey) return

    setMessagesStorageKey(nextMessagesKey)
    setMessages(() => {
      try {
        const raw = localStorage.getItem(nextMessagesKey)
        const parsed = raw ? JSON.parse(raw) : []
        const safeMessages = Array.isArray(parsed) ? parsed : []
        if (safeMessages.length) return safeMessages

        // Keep existing chat when storage key changes and destination key is empty.
        if (messages.length) {
          localStorage.setItem(nextMessagesKey, JSON.stringify(messages))
          return messages
        }

        return []
      } catch {
        return messages.length ? messages : []
      }
    })
  }, [messagesStorageKey, messages])

  useEffect(() => {
    if (!conversationId || historyLoadedRef.current) return

    let cancelled = false

    const loadHistory = async () => {
      try {
        const response = await fetch(buildApiUrl(`/api/chat/history/?conversation_id=${encodeURIComponent(conversationId)}`))
        if (!response.ok) return

        const data = await response.json()
        if (cancelled) return

        const restored = Array.isArray(data?.messages)
          ? data.messages
              .filter((item) => item?.role === 'user' || item?.role === 'assistant')
              .map((item) => ({
                id: `server-${item.id}`,
                role: item.role,
                text: String(item.text || ''),
                files: [],
                audio: null,
              }))
          : []

        if (restored.length) {
          setMessages(restored)
          setIsFollowing(true)
        }
      } catch (err) {
        console.error('Failed to load chat history:', err)
      } finally {
        historyLoadedRef.current = true
      }
    }

    loadHistory()

    return () => {
      cancelled = true
    }
  }, [conversationId])

  const handleScroll = () => {
    const el = listRef.current
    if (!el) return
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
    // If user scrolled up by more than 80px, stop auto-scrolling
    if (distanceFromBottom > 80) {
      setIsFollowing(false)
    } else if (distanceFromBottom < 30) {
      setIsFollowing(true)
    }
  }

  const scrollToLatest = () => {
    setIsFollowing(true)
    scrollToBottom('smooth')
  }

  const copyToClipboard = async (value = '') => {
    const text = String(value || '')
    if (!text.trim()) return
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      const textarea = document.createElement('textarea')
      textarea.value = text
      textarea.setAttribute('readonly', '')
      textarea.style.position = 'fixed'
      textarea.style.opacity = '0'
      document.body.appendChild(textarea)
      textarea.select()
      document.execCommand('copy')
      document.body.removeChild(textarea)
    }
  }

  const handleCopyResponse = async (messageId, assistantText) => {
    await copyToClipboard(assistantText)
    setCopiedId(messageId)
    setTimeout(() => setCopiedId((curr) => (curr === messageId ? null : curr)), 2000)
  }

  const handleToggleSpeak = (messageId, text) => {
    if (!('speechSynthesis' in window)) {
      alert('Text-to-speech is not supported in this browser.')
      return
    }
    if (speakingId === messageId) {
      window.speechSynthesis.cancel()
      setSpeakingId(null)
      return
    }
    window.speechSynthesis.cancel()
    const plainText = text.replace(/[`*#_~[\]()]/g, '').slice(0, 1200)
    const utterance = new SpeechSynthesisUtterance(plainText)
    utterance.onend = () => setSpeakingId(null)
    utterance.onerror = () => setSpeakingId(null)
    setSpeakingId(messageId)
    window.speechSynthesis.speak(utterance)
  }

  const handleReaction = (messageId, type) => {
    setMessageReactions((prev) => ({
      ...prev,
      [messageId]: prev[messageId] === type ? null : type,
    }))
  }

  const starterPrompts = [
    {
      icon: <FiZap className="h-5 w-5 text-amber-500" />,
      title: 'Explain Concepts',
      desc: 'Explain Dynamic Programming with intuitive examples',
      prompt: 'Explain Dynamic Programming with intuitive real-world examples and Python snippets.',
      category: 'Algorithms',
    },
    {
      icon: <FiCode className="h-5 w-5 text-teal-500" />,
      title: 'Python Sandbox',
      desc: 'Write and test a Binary Search tree in Python',
      prompt: 'Write a complete Python implementation of a Binary Search Tree with insert, search, and traverse methods.',
      category: 'Data Structures',
    },
    {
      icon: <FiBookOpen className="h-5 w-5 text-indigo-500" />,
      title: 'Prepare Exam Questions',
      desc: 'Create 5 practice questions for Operating Systems',
      prompt: 'Create 5 challenging multiple-choice questions on Operating Systems (Deadlocks & Memory Management) with answers and explanations.',
      category: 'Exam Prep',
    },
    {
      icon: <FiHelpCircle className="h-5 w-5 text-emerald-500" />,
      title: 'System Design Basics',
      desc: 'How does load balancing and caching work?',
      prompt: 'Explain how Load Balancing and Redis Caching work together in scalable web architectures.',
      category: 'System Design',
    },
  ]

  const handleTakeTest = (topic) => {
    const trimmed = String(topic || '').trim()
    if (!trimmed) return
    navigate(`/app/test?topic=${encodeURIComponent(trimmed)}`)
  }

  const handleRegenerateResponse = async (assistantMessageId) => {
    if (isGenerating || regeneratingMessageId) return

    const assistantIndex = messages.findIndex((m) => m.id === assistantMessageId)
    if (assistantIndex === -1) return
    const targetMessage = messages[assistantIndex]
    if (!targetMessage || targetMessage.role !== 'assistant') return

    const previousUser = [...messages.slice(0, assistantIndex)].reverse().find((m) => m.role === 'user')
    const promptText = previousUser?.text?.trim()
    if (!promptText) return

    setRegeneratingMessageId(assistantMessageId)
    setMessages((prevMessages) => prevMessages.map((msg) => (
      msg.id === assistantMessageId ? { ...msg, text: 'Regenerating response...' } : msg
    )))

    try {
      const response = await fetch(buildApiUrl('/api/chat/'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: promptText,
          model: selectedModelId,
          language,
          conversation_id: conversationId || undefined,
          save_history: false,
          images: [],
          audio: null,
        }),
      })

      let data = null
      if ((response.headers.get('content-type') || '').includes('application/json')) {
        data = await response.json()
      }

      if (!response.ok) {
        const details = data?.details || data?.error || await extractApiError(response)
        throw new Error(details)
      }

      if (data?.conversation_id && data.conversation_id !== conversationId) {
        setConversationId(data.conversation_id)
        try {
          localStorage.setItem(conversationStorageKey, data.conversation_id)
        } catch {
          // Ignore storage errors and continue with in-memory state.
        }
      }

      setMessages((prevMessages) => prevMessages.map((msg) => (
        msg.id === assistantMessageId ? { ...msg, text: '' } : msg
      )))
      await animateAssistantResponse(assistantMessageId, data.reply || '')
    } catch (err) {
      setMessages((prevMessages) => prevMessages.map((msg) => (
        msg.id === assistantMessageId ? { ...msg, text: `Error: ${err.message}` } : msg
      )))
    } finally {
      setRegeneratingMessageId(null)
    }
  }

  const handleDownloadSingleResponsePdf = async (assistantMessageId) => {
    const messageIndex = messages.findIndex((m) => m.id === assistantMessageId)
    if (messageIndex === -1) return
    const message = messages[messageIndex]
    if (!message || message.role !== 'assistant') return

    const previousUser = [...messages.slice(0, messageIndex)].reverse().find((m) => m.role === 'user')
    const responseText = markdownToPlainText(normalizeAssistantText(message.text || ''))
    const promptText = previousUser ? markdownToPlainText(previousUser.text || '') : ''

    try {
      await exportPdfDocument({
        fileName: `chat-response-${messageIndex + 1}.pdf`,
        title: 'Chat Response Export',
        sections: [
          promptText ? { heading: 'User Prompt', body: promptText } : null,
          { heading: 'Assistant Response', body: responseText || '(empty response)' },
        ].filter(Boolean),
      })
    } catch (err) {
      console.error('Failed to export response PDF:', err)
    }
  }

  const handleDownloadEntireChatPdf = async () => {
    const sections = messages.map((message, index) => {
      const role = message.role === 'assistant' ? 'Assistant' : 'User'
      const body = markdownToPlainText(normalizeAssistantText(message.text || '')) || '(no text)'
      return {
        heading: `${index + 1}. ${role}`,
        body,
      }
    })

    if (!sections.length) return

    try {
      await exportPdfDocument({
        fileName: 'chat-conversation.pdf',
        title: 'Full Chat Export',
        sections,
      })
    } catch (err) {
      console.error('Failed to export full chat PDF:', err)
    }
  }

  const handleDeleteChat = () => {
    if (!messages.length) return

    const shouldDelete = window.confirm('Delete this chat permanently? This cannot be undone.')
    if (!shouldDelete) return

    if (typingTimerRef.current) {
      clearTimeout(typingTimerRef.current)
      typingTimerRef.current = null
    }

    // Revoke any temporary object URLs attached to user-uploaded files.
    messages.forEach((msg) => {
      if (!Array.isArray(msg?.files)) return
      msg.files.forEach((file) => {
        if (file?.url) {
          URL.revokeObjectURL(file.url)
        }
      })
    })

    try {
      localStorage.removeItem(messagesStorageKey)
      localStorage.removeItem(conversationStorageKey)
    } catch {
      // Ignore storage failures and continue resetting in-memory state.
    }

    historyLoadedRef.current = true
    setConversationId('')
    setMessages([])
    setInputValue('')
    setAudioFile(null)
    setAttachedFiles([])
    setIsGenerating(false)
    setRegeneratingMessageId(null)
    setIsFollowing(true)
  }

  const animateAssistantResponse = async (messageId, fullText) => {
    const text = String(fullText || '')
    const chunks = text.match(/\S+\s*/g) || []

    if (!chunks.length) {
      setMessages((prevMessages) => prevMessages.map((msg) => (
        msg.id === messageId ? { ...msg, text } : msg
      )))
      return
    }

    if (typingTimerRef.current) {
      clearTimeout(typingTimerRef.current)
      typingTimerRef.current = null
    }

    await new Promise((resolve) => {
      let idx = 0

      const step = () => {
        idx = Math.min(idx + 1, chunks.length)
        const nextText = chunks.slice(0, idx).join('')

        setMessages((prevMessages) => prevMessages.map((msg) => (
          msg.id === messageId ? { ...msg, text: nextText } : msg
        )))

        if (idx >= chunks.length) {
          typingTimerRef.current = null
          resolve()
          return
        }

        typingTimerRef.current = setTimeout(step, 24)
      }

      step()
    })
  }

  const handleSubmit = async () => {
    const trimmedValue = inputValue.trim()
    const imageFiles = attachedFiles.filter((file) => file.type.startsWith('image/'))
    const documentFiles = attachedFiles.filter((file) => !file.type.startsWith('image/'))
    let images = []
    let documents = []
    let audioPayload = null
    try {
      images = imageFiles.length
        ? await Promise.all(
            imageFiles.map(async (file) => ({
              name: file.name,
              type: file.type,
              dataUrl: await readFileAsDataUrl(file),
            }))
          )
        : []
      documents = documentFiles.length
        ? await Promise.all(
            documentFiles.map(async (file) => ({
              name: file.name,
              type: file.type || 'application/octet-stream',
              dataUrl: await readFileAsDataUrl(file),
            }))
          )
        : []
      audioPayload = audioFile
        ? {
            name: 'recording',
            type: audioFile.mimeType || 'audio/webm',
            duration: audioFile.duration ?? 0,
            dataUrl: await readBlobAsDataUrl(audioFile.blob),
          }
        : null
    } catch (err) {
      setMessages((prevMessages) => [
        ...prevMessages,
        { id: `${Date.now()}-assistant`, role: 'assistant', text: `Error: ${err.message}` },
      ])
      return
    }

    if (!trimmedValue && images.length === 0 && documents.length === 0 && !audioPayload) return
    const timestamp = Date.now()
    const userMessageId = `${timestamp}-user`
    const assistantId = `${timestamp}-assistant`
    setIsFollowing(true)
    setMessages((prevMessages) => [
      ...prevMessages,
      {
        id: userMessageId,
        role: 'user',
        text: trimmedValue,
        audio: audioFile ?? null,
        files: attachedFiles.map((f) => ({
          name: f.name,
          type: f.type,
          url: f.type.startsWith('image/') ? URL.createObjectURL(f) : null,
        })),
      },
    ])
    setInputValue('')
    setAudioFile(null)
    setAttachedFiles([])
    setIsGenerating(true)

    try {
      const response = await fetch(buildApiUrl('/api/chat/'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: trimmedValue,
          model: selectedModelId,
          language,
          conversation_id: conversationId || undefined,
          images,
          documents,
          audio: audioPayload,
        }),
      })
      let data = null
      if ((response.headers.get('content-type') || '').includes('application/json')) {
        data = await response.json()
      }

      if (!response.ok) {
        const details = data?.details || data?.error || await extractApiError(response)
        throw new Error(details)
      }

      if (data?.conversation_id && data.conversation_id !== conversationId) {
        setConversationId(data.conversation_id)
        try {
          localStorage.setItem(conversationStorageKey, data.conversation_id)
        } catch {
          // Ignore storage errors and continue with in-memory state.
        }
      }

      const transcript = String(data?.transcript || '').trim()
      if (audioPayload && transcript) {
        setMessages((prevMessages) => prevMessages.map((msg) => (
          msg.id === userMessageId ? { ...msg, text: transcript } : msg
        )))
      }

      setMessages((prevMessages) => [
        ...prevMessages,
        { id: assistantId, role: 'assistant', text: '' },
      ])
      setIsGenerating(false)
      await animateAssistantResponse(assistantId, data.reply || '')
    } catch (err) {
      const errText = err?.message === 'Failed to fetch'
        ? 'Cannot connect to backend server. Please make sure the backend is running (python manage.py runserver).'
        : (err?.message || 'Unexpected error.')
      setMessages((prevMessages) => [
        ...prevMessages,
        { id: assistantId, role: 'assistant', text: `Error: ${errText}` },
      ])
    } finally {
      setIsGenerating(false)
    }
  }

  const { t, language } = useTheme()

  return (
    <div className={`relative flex h-full min-h-0 w-full flex-col overflow-hidden ${t.pageBg}`}>
      <div
        ref={listRef}
        onScroll={handleScroll}
        className="min-h-0 flex-1 overflow-y-auto"
      >
        {messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center text-center px-4 py-8 max-w-3xl mx-auto animate-fade-in select-none">
            <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-teal-500/30 bg-teal-500/10 px-4 py-1 text-xs font-bold text-teal-800 dark:text-teal-300 shadow-xs">
              <RiSparklingFill className="h-3.5 w-3.5 text-teal-600 dark:text-teal-400 animate-pulse" />
              AI Learning Companion
            </div>
            <h1 className="text-3xl sm:text-4xl font-black tracking-tight text-slate-900 dark:text-white">
              How can I help you study today?
            </h1>
            <p className="mt-2 text-sm sm:text-base font-normal text-slate-600 dark:text-slate-300 max-w-lg">
              Ask deep questions, run code, generate customized MCQ & coding tests, or practice mock interviews.
            </p>

            <div className="mt-8 grid grid-cols-1 sm:grid-cols-2 gap-3.5 w-full text-left">
              {starterPrompts.map((item, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => {
                    setInputValue(item.prompt)
                  }}
                  className="group flex flex-col justify-between rounded-2xl border border-slate-200 dark:border-slate-800 bg-white/95 dark:bg-slate-900/90 p-4.5 shadow-sm backdrop-blur-md transition-all duration-200 hover:-translate-y-1 hover:border-teal-500 hover:shadow-md active:scale-98 cursor-pointer"
                >
                  <div className="flex items-start justify-between">
                    <span className="grid h-9 w-9 place-items-center rounded-xl bg-teal-50 dark:bg-slate-800 transition-transform group-hover:scale-110">
                      {item.icon}
                    </span>
                    <span className="rounded-full bg-slate-100 dark:bg-slate-800 px-2.5 py-0.5 text-[10px] font-bold text-slate-600 dark:text-slate-300">
                      {item.category}
                    </span>
                  </div>
                  <div className="mt-3">
                    <h3 className="text-sm font-bold text-slate-900 dark:text-white group-hover:text-teal-600 dark:group-hover:text-teal-400 transition-colors">
                      {item.title}
                    </h3>
                    <p className="mt-1 text-xs text-slate-600 dark:text-slate-400 line-clamp-2">
                      {item.desc}
                    </p>
                  </div>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="mx-auto w-full max-w-4xl px-4 py-6 space-y-6">
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={handleDeleteChat}
                disabled={!messages.length || isGenerating || Boolean(regeneratingMessageId)}
                className={`inline-flex items-center gap-2 rounded-xl border px-3 py-1.5 text-xs font-semibold transition-all hover:scale-105 active:scale-95 ${t.actionBtn}`}
                title="Delete current chat"
                aria-label="Delete current chat"
              >
                <FiTrash2 className="h-3.5 w-3.5" />
                Delete Chat
              </button>
              <button
                type="button"
                onClick={handleDownloadEntireChatPdf}
                className={`inline-flex items-center gap-2 rounded-xl border px-3 py-1.5 text-xs font-semibold transition-all hover:scale-105 active:scale-95 ${t.actionBtn}`}
              >
                <FiDownload className="h-3.5 w-3.5" />
                Download PDF
              </button>
            </div>

            {messages.map((message, index) => {
              const previousUserMessage = message.role === 'assistant'
                ? [...messages.slice(0, index)].reverse().find((item) => item.role === 'user')
                : null
              const suggestedTopics = message.role === 'assistant'
                ? suggestStudyTopics(message.text, previousUserMessage?.text || '')
                : []
              const summary = message.role === 'assistant' ? summarizeLearningPoints(message.text, suggestedTopics) : null
              return (
                <div
                  key={message.id}
                >
                  {message.role === 'user' ? (
                    <div className="flex justify-end animate-slide-up">
                      <div className={`max-w-[96%] -mr-5 rounded-2xl px-5 py-3 text-sm leading-6 shadow-xs ${t.userMsgBg} ${t.userMsgText}`}>
                        {message.text && <p>{message.text}</p>}
                        {message.files?.length > 0 && (
                          <div className={`${message.text ? 'mt-2' : ''} flex flex-wrap gap-2`}>
                            {message.files.map((f, i) => (
                              <div key={i} className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white/60 overflow-hidden">
                                {f.url ? (
                                  <img src={f.url} alt={f.name} className="max-h-60 w-full rounded-xl object-cover" />
                                ) : (
                                  <div className="flex items-center gap-1.5 px-3 py-2">
                                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 shrink-0 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                                    <span className="max-w-35 truncate text-xs text-slate-700">{f.name}</span>
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                        {message.audio && (
                          <div className={`${message.text ? 'mt-2' : ''} flex items-center gap-2 rounded-xl border border-slate-200 bg-white/60 px-3 py-2`}>
                            <div className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-teal-100 text-teal-600">
                              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4M9 11V7a3 3 0 016 0v4" /></svg>
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="text-xs font-medium text-slate-700">Voice recording</p>
                              <p className="text-[11px] text-slate-400">{formatDuration(message.audio.duration ?? 0)}</p>
                            </div>
                            <audio controls className="h-7 max-w-40" style={{ accentColor: '#14b8a6' }}>
                              <source src={message.audio.url} type={message.audio.mimeType} />
                            </audio>
                          </div>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-start gap-3 animate-fade-in">
                      <div className="mt-0.5 shrink-0 text-teal-500">
                        <RiSparklingFill className="h-5 w-5" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div
                          className={`w-full max-w-[96%] rounded-2xl border px-5 py-3.5 shadow-sm transition-all ${t.inputContainer}`}
                          style={{ marginLeft: '-37px' }}
                        >
                          <div className={`assistant-markdown space-y-3 text-sm leading-7 ${t.assistantText}`}>
                            {renderAssistantMessage(message.text)}
                          </div>
                          <StudyFlowGraph
                            topics={suggestedTopics}
                            messageText={message.text}
                            onTakeTest={handleTakeTest}
                          />
                          <ResponseSummary takeaways={summary?.takeaways} conclusion={summary?.conclusion} />
                          {suggestedTopics.length ? (
                            <div className="mt-4 flex flex-wrap gap-2">
                              {suggestedTopics.slice(0, 3).map((topic) => (
                                <button
                                  key={`test-${topic}`}
                                  type="button"
                                  onClick={() => handleTakeTest(topic)}
                                  className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition-all hover:scale-105 active:scale-95 ${t.inputBtnBg} ${t.inputBtn}`}
                                >
                                  Take test: {topic}
                                </button>
                              ))}
                            </div>
                          ) : null}
                        </div>
                        <div className="mt-3 flex items-center gap-2 text-xs flex-wrap">
                          {/* Thumbs Up */}
                          <button
                            type="button"
                            onClick={() => handleReaction(message.id, 'like')}
                            className={`flex items-center gap-1 rounded-lg px-2.5 py-1 transition-all active:scale-90 ${
                              messageReactions[message.id] === 'like'
                                ? 'bg-teal-100 text-teal-700 dark:bg-teal-950/60 dark:text-teal-300 font-semibold'
                                : t.actionBtn
                            }`}
                            title="Helpful response"
                          >
                            <FiThumbsUp className="h-3.5 w-3.5" />
                          </button>

                          {/* Thumbs Down */}
                          <button
                            type="button"
                            onClick={() => handleReaction(message.id, 'dislike')}
                            className={`flex items-center gap-1 rounded-lg px-2.5 py-1 transition-all active:scale-90 ${
                              messageReactions[message.id] === 'dislike'
                                ? 'bg-rose-100 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300 font-semibold'
                                : t.actionBtn
                            }`}
                            title="Not helpful"
                          >
                            <FiThumbsDown className="h-3.5 w-3.5" />
                          </button>

                          {/* Speak Aloud TTS */}
                          <button
                            type="button"
                            onClick={() => handleToggleSpeak(message.id, message.text)}
                            className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1 transition-all active:scale-90 ${
                              speakingId === message.id
                                ? 'bg-teal-500 text-white shadow-xs animate-pulse font-semibold'
                                : t.actionBtn
                            }`}
                            title={speakingId === message.id ? 'Stop reading' : 'Read aloud'}
                          >
                            {speakingId === message.id ? (
                              <>
                                <FiVolumeX className="h-3.5 w-3.5" />
                                <span>Stop</span>
                              </>
                            ) : (
                              <>
                                <FiVolume2 className="h-3.5 w-3.5" />
                                <span>Listen</span>
                              </>
                            )}
                          </button>

                          {/* Regenerate */}
                          <button
                            type="button"
                            onClick={() => handleRegenerateResponse(message.id)}
                            className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1 transition-all active:scale-90 ${t.actionBtn}`}
                            title="Regenerate this response"
                            disabled={Boolean(regeneratingMessageId) || isGenerating}
                          >
                            <FiRefreshCw className={`h-3.5 w-3.5 ${regeneratingMessageId === message.id ? 'animate-spin' : ''}`} />
                            <span>Retry</span>
                          </button>

                          {/* Copy */}
                          <button
                            type="button"
                            onClick={() => handleCopyResponse(message.id, message.text)}
                            className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1 transition-all active:scale-90 ${
                              copiedId === message.id
                                ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300 font-semibold'
                                : t.actionBtn
                            }`}
                            title="Copy response"
                          >
                            {copiedId === message.id ? (
                              <>
                                <FiCheck className="h-3.5 w-3.5 text-emerald-500" />
                                <span className="text-emerald-600 dark:text-emerald-400 font-semibold">Copied!</span>
                              </>
                            ) : (
                              <>
                                <FiCopy className="h-3.5 w-3.5" />
                                <span>Copy</span>
                              </>
                            )}
                          </button>

                          {/* Download PDF */}
                          <button
                            type="button"
                            onClick={() => handleDownloadSingleResponsePdf(message.id)}
                            className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1 transition-all active:scale-90 ${t.actionBtn}`}
                            title="Download this response as PDF"
                          >
                            <FiDownload className="h-3.5 w-3.5" />
                            <span>PDF</span>
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}

            {isGenerating ? (
              <div>
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 shrink-0 text-teal-500">
                    <RiSparklingFill className="h-5 w-5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className={`w-full max-w-[96%] rounded-2xl border px-5 py-4 shadow-sm ${t.inputContainer}`} style={{ marginLeft: '-37px' }}>
                      <div className="flex items-center gap-1.5 text-slate-500" aria-label="Assistant is generating a response" role="status">
                        <span className="h-2 w-2 rounded-full bg-current animate-bounce" style={{ animationDelay: '0ms' }} />
                        <span className="h-2 w-2 rounded-full bg-current animate-bounce" style={{ animationDelay: '120ms' }} />
                        <span className="h-2 w-2 rounded-full bg-current animate-bounce" style={{ animationDelay: '240ms' }} />
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            ) : null}
            <div ref={messagesEndRef} className="h-4 w-full pointer-events-none" />
          </div>
        )}
      </div>

      {messages.length > 0 && !isFollowing ? (
        <div className="pointer-events-none absolute inset-x-0 bottom-20 flex justify-center">
          <button
            type="button"
            onClick={scrollToLatest}
            className={`pointer-events-auto rounded-full border px-4 py-1.5 text-xs font-medium shadow-sm ${t.scrollBtnBg}`}
          >
            ↓ Latest
          </button>
        </div>
      ) : null}

      <div className="shrink-0 px-6 pb-4 pt-3">
        <div className="mx-auto w-full max-w-4xl">
          <ChatInput
            placeholder="Ask anything"
            showAddButton={!isMobile}
            containerClassName={`${t.inputContainer} border-t-transparent shadow-md`}
            inputClassName={`text-base ${t.inputText}`}
            buttonClassName={t.inputBtn}
            value={inputValue}
            onChange={(event) => setInputValue(event.target.value)}
            onSubmit={handleSubmit}
            selectedModelId={selectedModelId}
            onModelChange={setSelectedModelId}
            audioFile={audioFile}
            onAudioRecorded={(file) => setAudioFile(file)}
            onRemoveAudio={() => setAudioFile(null)}
            attachedFiles={attachedFiles}
            onFilesAttached={(files) => setAttachedFiles((prev) => [...prev, ...files])}
            onRemoveFile={(i) => setAttachedFiles((prev) => prev.filter((_, idx) => idx !== i))}
          />
        </div>
      </div>
    </div>
  )
}

export default DashboardPage
