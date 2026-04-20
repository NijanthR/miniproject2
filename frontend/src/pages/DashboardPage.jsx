import { useEffect, useRef, useState } from 'react'
import { FiCopy, FiDownload, FiPlay, FiRefreshCw, FiThumbsDown, FiThumbsUp, FiTrash2 } from 'react-icons/fi'
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

function getBaseStudySubject(topics = []) {
  return (
    topics.find((topic) => /(regression|classification|algorithm|model|neural network|probability|statistics)/i.test(topic)) ||
    topics[0] ||
    'the concept'
  )
}

function expandTopicForBeginners(topic, baseSubject) {
  const clean = String(topic || '').replace(/^the\s+/i, '').trim()
  if (/^core idea$/i.test(clean)) return `Core idea of ${baseSubject}`
  if (/^equation$/i.test(clean)) return `Model equation of ${baseSubject}`
  if (/^intuition$/i.test(clean)) return `Intuition behind ${baseSubject}`
  return toSentenceCase(topic)
}

function getTopicMeaning(topic) {
  const value = String(topic || '').toLowerCase()
  if (value.includes('core idea')) return 'The main intuition in simple words.'
  if (value.includes('equation')) return 'The formula that connects inputs and output.'
  if (value.includes('beta') || value.includes('coefficient')) return 'A number that shows how strongly a feature affects the result.'
  if (value.includes('feature')) return 'An input variable used for prediction.'
  if (value.includes('intercept')) return 'The starting value when input is zero.'
  if (value.includes('common confusion')) return 'A frequent misunderstanding and how to avoid it.'
  if (value.includes('quick recap')) return 'A short summary to lock in understanding.'
  if (value.includes('given') || value.includes('problem statement')) return 'What information is provided and what is being asked.'
  if (value.includes('complexity')) return 'How performance changes with input size and edge cases.'
  if (value.includes('time strategy')) return 'How to prioritize steps and avoid spending too long.'
  return 'A key concept to understand before moving to the next step.'
}

function extractPromptTopic(prompt = '') {
  const cleaned = String(prompt || '')
    .replace(/\s+/g, ' ')
    .replace(/[?!.]+$/g, '')
    .trim()

  if (!cleaned) return ''

  const greetingPattern = /^(hi|hello|hey|yo|hola|namaste|good\s+(morning|afternoon|evening)|how are you|what'?s up|sup|thanks?|thank you)$/i
  if (greetingPattern.test(cleaned)) return ''

  const lower = cleaned.toLowerCase()
  const patterns = [
    /(?:about|on|regarding|for)\s+([^?.!,;]+)/i,
    /(?:what is|what are|explain|teach|describe|help me understand|summarize)\s+([^?.!,;]+)/i,
  ]

  for (const pattern of patterns) {
    const match = cleaned.match(pattern)
    if (match?.[1]) {
      return toSentenceCase(match[1])
    }
  }

  if (lower.length <= 80) return toSentenceCase(cleaned)
  return toSentenceCase(cleaned.split(' ').slice(0, 10).join(' '))
}

function isLikelyStudyRequest(prompt = '', response = '') {
  const promptText = String(prompt || '').trim().toLowerCase()
  const responseText = String(response || '').trim().toLowerCase()

  if (!promptText && !responseText) return false

  const greetingOrSmallTalkPattern = /(^(hi|hello|hey|yo|hola|namaste)\b|how are you|what'?s up|sup\b|good\s+(morning|afternoon|evening)|thank(s| you)?\b|bye\b)/i
  const studyKeywordPattern = /(explain|teach|learn|study|topic|concept|define|definition|difference|compare|how|why|what is|solve|problem|equation|formula|derivation|example|exercise|chapter|syllabus|exam|test|quiz|revision|algorithm|model|theorem|proof|interview)/i
  const structurePattern = /(^\s*[-*]\s+|^\s*\d+\.\s+|^\s*#{1,3}\s+)/m
  const mathPattern = /(\$[^$]+\$|\b\d+\b|=|\+|-|\*|\/|\^)/

  if (greetingOrSmallTalkPattern.test(promptText) && !studyKeywordPattern.test(promptText)) {
    return false
  }

  if (studyKeywordPattern.test(promptText)) return true
  if (studyKeywordPattern.test(responseText)) return true
  if (structurePattern.test(responseText)) return true
  if (mathPattern.test(responseText) && promptText.split(/\s+/).length >= 3) return true

  return false
}

function tokenizeTopic(value = '') {
  const stopWords = new Set([
    'the', 'a', 'an', 'and', 'or', 'to', 'of', 'in', 'on', 'for', 'is', 'are', 'with', 'from', 'by', 'about',
    'what', 'how', 'why', 'when', 'where', 'which', 'who', 'it', 'this', 'that', 'these', 'those', 'explain',
    'describe', 'teach', 'help', 'understand',
  ])

  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length >= 3 && !stopWords.has(token))
}

function areTopicsRelated(candidate = '', promptTopic = '') {
  const promptTokens = tokenizeTopic(promptTopic)
  if (!promptTokens.length) return true
  const candidateTokens = new Set(tokenizeTopic(candidate))
  return promptTokens.some((token) => candidateTokens.has(token))
}

function getResponseFocusAreas(text = '') {
  const value = String(text || '').toLowerCase()
  const focus = []

  const add = (item) => {
    if (!item) return
    if (focus.includes(item)) return
    focus.push(item)
  }

  if (/(what is|definition|defined as|means|refers to)/.test(value)) add('basics')
  if (/(how it works|workflow|steps|process|works by)/.test(value)) add('how it works')
  if (/(equation|formula|beta|coefficient|slope|intercept)/.test(value)) add('equation and interpretation')
  if (/(assumption|normality|linearity|independence|multicollinearity)/.test(value)) add('assumptions')
  if (/(example|sample|case study|scenario)/.test(value)) add('examples')
  if (/(application|use case|real world|industry)/.test(value)) add('applications')

  return focus.slice(0, 4)
}

function getPromptFocusAreas(prompt = '') {
  const value = String(prompt || '').toLowerCase()
  const focus = []

  const add = (item) => {
    if (!item) return
    if (focus.includes(item)) return
    focus.push(item)
  }

  if (/(what is|what are|define|definition|meaning)/.test(value)) add('basics')
  if (/(how|work|process|steps|mechanism)/.test(value)) add('how it works')
  if (/(equation|formula|derive|interpret|slope|intercept|coefficient)/.test(value)) add('equation and interpretation')
  if (/(assumption|condition|constraint|validity)/.test(value)) add('assumptions')
  if (/(example|solve|problem|practice|numerical|sample)/.test(value)) add('examples')
  if (/(application|use case|real world|industry|where used)/.test(value)) add('applications')

  return focus.slice(0, 4)
}

function buildClearSuggestion(topic, focus) {
  const cleanTopic = String(topic || '').trim()
  const cleanFocus = String(focus || '').trim()
  if (!cleanTopic || !cleanFocus) return ''

  if (cleanFocus === 'basics') return `Basics of ${cleanTopic}`
  if (cleanFocus === 'how it works') return `How ${cleanTopic} works`
  if (cleanFocus === 'equation and interpretation') return `${cleanTopic}: equation and interpretation`
  if (cleanFocus === 'assumptions') return `${cleanTopic}: assumptions and checks`
  if (cleanFocus === 'examples') return `${cleanTopic}: examples and solving`
  if (cleanFocus === 'applications') return `${cleanTopic}: practical applications`
  return `${cleanTopic}: ${cleanFocus}`
}

function detectQuestionStyle(prompt = '', response = '') {
  const value = `${prompt} ${response}`.toLowerCase()

  if (/(code|implement|function|python|javascript|java|c\+\+|algorithm|program)/.test(value)) return 'coding'
  if (/(compare|difference|vs\.?|versus|distinguish)/.test(value)) return 'comparison'
  if (/(solve|numerical|calculate|find|compute|problem)/.test(value)) return 'problem-solving'
  if (/(steps|process|workflow|pipeline|how.*works)/.test(value)) return 'process'
  if (/(exam|test|interview|mcq|revision|prepare)/.test(value)) return 'exam'
  if (/(what is|define|definition|meaning|introduce|basics)/.test(value)) return 'definition'

  return 'conceptual'
}

function getStudyFlowTemplate(topic, style) {
  const cleanTopic = String(topic || '').trim() || 'this topic'

  if (style === 'definition') {
    return [
      `Core idea of ${cleanTopic}`,
      `${cleanTopic}: key terms`,
      `${cleanTopic}: simple example`,
      `${cleanTopic}: common confusion`,
      `${cleanTopic}: quick recap`,
    ]
  }

  if (style === 'process') {
    return [
      `${cleanTopic}: goal`,
      `${cleanTopic}: inputs`,
      `How ${cleanTopic} works`,
      `${cleanTopic}: output interpretation`,
      `${cleanTopic}: real-world flow`,
    ]
  }

  if (style === 'problem-solving') {
    return [
      `${cleanTopic}: problem statement`,
      `${cleanTopic}: choose method`,
      `${cleanTopic}: step-by-step solving`,
      `${cleanTopic}: verify result`,
      `${cleanTopic}: practice variation`,
    ]
  }

  if (style === 'comparison') {
    return [
      `${cleanTopic}: option A`,
      `${cleanTopic}: option B`,
      `${cleanTopic}: key differences`,
      `${cleanTopic}: when to use each`,
      `${cleanTopic}: pitfalls`,
    ]
  }

  if (style === 'coding') {
    return [
      `${cleanTopic}: problem statement`,
      `${cleanTopic}: approach`,
      `${cleanTopic}: code structure`,
      `${cleanTopic}: dry run`,
      `${cleanTopic}: complexity and edge cases`,
    ]
  }

  if (style === 'exam') {
    return [
      `${cleanTopic}: high-yield basics`,
      `${cleanTopic}: must-know concepts`,
      `${cleanTopic}: question patterns`,
      `${cleanTopic}: time strategy`,
      `${cleanTopic}: final revision`,
    ]
  }

  return [
    `Basics of ${cleanTopic}`,
    `How ${cleanTopic} works`,
    `${cleanTopic}: equation and interpretation`,
    `${cleanTopic}: examples and solving`,
    `${cleanTopic}: intuition`,
  ]
}

function suggestStudyTopics(text = '', userPrompt = '') {
  const cleaned = normalizeAssistantText(text)
    .replace(/\$\$[\s\S]*?\$\$/g, ' ')
    .replace(/\$[^$]*\$/g, ' ')

  if (!isLikelyStudyRequest(userPrompt, cleaned)) return []

  const lines = cleaned.split('\n').map((line) => line.trim()).filter(Boolean)
  const candidates = []

  for (const line of lines) {
    const headingMatch = line.match(/^#{1,3}\s+(.{3,80})$/)
    if (headingMatch) {
      candidates.push(headingMatch[1])
      continue
    }

    const sectionMatch = line.match(/^\d+(?:\.\d+)?\s+(.{3,80})$/)
    if (sectionMatch) {
      candidates.push(sectionMatch[1])
    }

    const bulletLabelMatch = line.match(/^(?:[-*]|\d+\.)\s+([^:]{3,70}):/)
    if (bulletLabelMatch) {
      candidates.push(bulletLabelMatch[1])
    }

    const definitionMatch = line.match(/^([A-Za-z][A-Za-z0-9_ ()/-]{2,70})\s+(?:is|are|means|refers to)\s+/i)
    if (definitionMatch) {
      candidates.push(definitionMatch[1])
    }
  }

  const ignored = new Set([
    'introduction',
    'summary',
    'conclusion',
    'example',
    'what it is',
    'the goal',
    'how it works',
    'how it works simply',
    'important topics',
    'key takeaways',
  ])
  const normalized = candidates
    .map((item) => item.replace(/[*_`#>]/g, '').replace(/[.:]+$/, '').trim())
    .map(toSentenceCase)
    .filter((item) => item.length >= 3 && item.length <= 60)
    .filter((item) => !ignored.has(item.toLowerCase()))

  const baseSubject = getBaseStudySubject(normalized)
  const expanded = normalized.map((topic) => expandTopicForBeginners(topic, baseSubject))

  const deduped = []
  for (const item of expanded) {
    if (deduped.some((existing) => existing.toLowerCase() === item.toLowerCase())) continue
    deduped.push(item)
    if (deduped.length >= 6) break
  }

  const promptTopic = extractPromptTopic(userPrompt)
  if (!promptTopic) return deduped

  const style = detectQuestionStyle(userPrompt, cleaned)
  const templateTopics = getStudyFlowTemplate(promptTopic, style)
  const related = deduped.filter((topic) => areTopicsRelated(topic, promptTopic))
  const promptFocusAreas = getPromptFocusAreas(userPrompt)
  const focusAreas = getResponseFocusAreas(cleaned)
  const mergedFocusAreas = [...promptFocusAreas, ...focusAreas].filter((item, index, arr) => arr.indexOf(item) === index)

  const suggestions = []
  const addSuggestion = (value) => {
    const topic = String(value || '').trim()
    if (!topic) return
    if (suggestions.some((item) => item.toLowerCase() === topic.toLowerCase())) return
    suggestions.push(topic)
  }

  templateTopics.forEach(addSuggestion)
  mergedFocusAreas.forEach((focus) => addSuggestion(buildClearSuggestion(promptTopic, focus)))

  related.forEach((topic) => {
    const singleWord = /^\w+$/.test(topic)
    if (singleWord) {
      addSuggestion(`${promptTopic}: ${topic.toLowerCase()} concepts`)
      return
    }
    addSuggestion(topic)
  })

  if (suggestions.length >= 3) return suggestions.slice(0, 6)

  const enriched = []
  const addUnique = (value) => {
    const topic = String(value || '').trim()
    if (!topic) return
    if (enriched.some((item) => item.toLowerCase() === topic.toLowerCase())) return
    enriched.push(topic)
  }

  related.forEach(addUnique)
  deduped.forEach((topic) => {
    const singleWord = /^\w+$/.test(topic)
    if (singleWord) {
      addUnique(`${promptTopic}: ${topic.toLowerCase()} concepts`)
    } else {
      addUnique(`${promptTopic}: ${topic}`)
    }
  })

  if (!enriched.length) {
    addUnique(buildClearSuggestion(promptTopic, 'basics'))
    addUnique(buildClearSuggestion(promptTopic, 'how it works'))
    addUnique(buildClearSuggestion(promptTopic, 'applications'))
  }

  enriched.forEach(addSuggestion)

  if (suggestions.length < 3) {
    addSuggestion(buildClearSuggestion(promptTopic, 'basics'))
    addSuggestion(buildClearSuggestion(promptTopic, 'how it works'))
    addSuggestion(buildClearSuggestion(promptTopic, 'equation and interpretation'))
    addSuggestion(buildClearSuggestion(promptTopic, 'examples'))
    addSuggestion(buildClearSuggestion(promptTopic, 'applications'))
  }

  return suggestions.slice(0, 6)
}

function summarizeLearningPoints(text = '', topics = []) {
  const cleaned = normalizeAssistantText(text)
    .replace(/\$\$[\s\S]*?\$\$/g, ' ')
    .replace(/\$[^$]*\$/g, ' ')
    .replace(/[*_`>#]/g, ' ')

  const lines = cleaned.split('\n').map((line) => line.trim()).filter(Boolean)
  const importantPattern = /^(important|key point|takeaway|warning)\s*[:.-]\s*(.+)$/i
  const bulletPattern = /^(?:[-*]|\d+\.)\s+(.{12,180})$/
  const sentencePattern = /[^.!?]+[.!?]/g
  const takeaways = []

  for (const line of lines) {
    const important = line.match(importantPattern)
    if (important) takeaways.push(toSentenceCase(important[2]))

    const bullet = line.match(bulletPattern)
    if (bullet) takeaways.push(toSentenceCase(bullet[1]))
  }

  const fullText = lines.join(' ')
  const sentences = (fullText.match(sentencePattern) || [])
    .map((s) => s.trim())
    .filter((s) => s.length >= 18 && s.length <= 180)

  for (const sentence of sentences) {
    if (takeaways.length >= 6) break
    takeaways.push(toSentenceCase(sentence))
  }

  const uniqueTakeaways = []
  for (const point of takeaways) {
    if (uniqueTakeaways.some((existing) => existing.toLowerCase() === point.toLowerCase())) continue
    uniqueTakeaways.push(point)
    if (uniqueTakeaways.length >= 3) break
  }

  const explicitConclusion = sentences.find((s) => /^(in summary|overall|therefore|to conclude|conclusion)/i.test(s))
  const fallbackConclusion = topics.length
    ? `To study this well, start with ${topics[0]}, then move step-by-step through ${topics.slice(1).join(', ')}.`
    : (sentences[0] || 'Focus on the main concept first, then practice with examples to build confidence.')

  return {
    takeaways: uniqueTakeaways,
    conclusion: explicitConclusion || fallbackConclusion,
  }
}

function ResponseSummary({ takeaways, conclusion }) {
  if (!takeaways?.length && !conclusion) return null

  return (
    <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Key Takeaways</p>
      {takeaways?.length ? (
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-700">
          {takeaways.map((point, index) => (
            <li key={`${index}-${point.slice(0, 24)}`}>{point}</li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-sm text-slate-600">No key takeaways found for this response.</p>
      )}

      <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Conclusion</p>
      <p className="mt-1 text-sm leading-6 text-slate-700">{conclusion}</p>
    </div>
  )
}

function StudyFlowGraph({ topics, flowStyle = 'conceptual' }) {
  if (!topics?.length) return null

  const flowPalette = {
    coding: 'border-indigo-200 bg-indigo-50',
    comparison: 'border-amber-200 bg-amber-50',
    'problem-solving': 'border-rose-200 bg-rose-50',
    process: 'border-sky-200 bg-sky-50',
    exam: 'border-emerald-200 bg-emerald-50',
    definition: 'border-violet-200 bg-violet-50',
    conceptual: 'border-teal-200 bg-teal-50',
  }
  const nodeTone = flowPalette[flowStyle] || flowPalette.conceptual

  return (
    <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Important Topics</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {topics.slice(0, 4).map((topic) => (
          <span key={topic} className="rounded-full border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700">
            {topic}
          </span>
        ))}
      </div>

      <div className="mt-2 space-y-1">
        {topics.slice(0, 3).map((topic) => (
          <p key={`${topic}-meaning`} className="text-xs text-slate-600">
            <span className="font-semibold text-slate-700">{topic}:</span> {getTopicMeaning(topic)}
          </p>
        ))}
      </div>

      <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Study Flow Graph</p>
      <div className="mt-2 overflow-x-auto pb-1">
        <div className="inline-flex min-w-full items-center gap-2">
          {topics.map((topic, index) => (
            <div key={`${topic}-${index}`} className="inline-flex items-center gap-2">
              <div className={`rounded-xl border px-3 py-2 text-xs font-semibold text-slate-700 shadow-sm ${nodeTone}`}>
                {topic}
              </div>
              {index < topics.length - 1 ? <span className="text-slate-400">→</span> : null}
            </div>
          ))}
        </div>
      </div>
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
        code: ({ inline, className, children }) => {
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
              <pre className="overflow-x-auto rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[0.9em] leading-7 text-slate-700">
                <code>{codeText.trim()}</code>
              </pre>
            )
          }
          const handleCopy = () => {
            if (!codeText.trim()) return
            navigator.clipboard?.writeText(codeText)
          }
          return (
            <div className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-900">
              <div className="flex items-center justify-between border-b border-slate-800 px-4 py-2 text-xs text-slate-300">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleCopy}
                    className="rounded-full border border-slate-700 px-2 py-1 text-[11px] text-slate-200 hover:bg-slate-800"
                  >
                    <FiCopy className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    className="flex items-center gap-1 rounded-full border border-slate-700 px-2.5 py-1 text-[11px] text-slate-200 hover:bg-slate-800"
                  >
                    <FiPlay className="h-3.5 w-3.5" />
                    Run
                  </button>
                </div>
              </div>
              <pre className="overflow-x-auto p-4 text-[0.85em] leading-relaxed text-slate-100">
                <code>{codeText}</code>
              </pre>
            </div>
          )
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
  const [selectedModelId, setSelectedModelId] = useState('gemini-2.5-flash')
  const [audioFile, setAudioFile] = useState(null)
  const [attachedFiles, setAttachedFiles] = useState([])
  const [isFollowing, setIsFollowing] = useState(true)
  const listRef = useRef(null)
  const latestUserRef = useRef(null)
  const typingTimerRef = useRef(null)
  const historyLoadedRef = useRef(false)

  // Index of the last user message
  const lastUserIdx = messages.reduce((acc, m, i) => (m.role === 'user' ? i : acc), -1)

  // Scroll latest user message to top of container with a viewport-relative offset
  const scrollToUser = () => {
    const el = listRef.current
    const target = latestUserRef.current
    if (!el || !target) return
    const offset = Math.min(25, Math.max(70, window.innerHeight * 0.25))
    el.scrollTo({ top: target.offsetTop - offset, behavior: 'smooth' })
  }

  useEffect(() => {
    if (!isFollowing) return
    scrollToUser()
  }, [messages])

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
    setIsFollowing(distanceFromBottom <= 48)
  }

  const scrollToLatest = () => {
    scrollToUser()
    setIsFollowing(true)
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

  const handleCopyResponse = async (assistantText) => {
    await copyToClipboard(assistantText)
  }

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
      setMessages((prevMessages) => [
        ...prevMessages,
        { id: assistantId, role: 'assistant', text: `Error: ${err.message}` },
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
          <div className="flex h-full items-center justify-center text-center px-4">
            <ChatBody variant="landing" size={size} />
          </div>
        ) : (
          <div className="mx-auto w-full max-w-4xl px-4 py-6 space-y-6">
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={handleDeleteChat}
                disabled={!messages.length || isGenerating || Boolean(regeneratingMessageId)}
                className={`inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-medium ${t.actionBtn}`}
                title="Delete current chat"
                aria-label="Delete current chat"
              >
                <FiTrash2 className="h-4 w-4" />
                Delete Chat
              </button>
              <button
                type="button"
                onClick={handleDownloadEntireChatPdf}
                className={`inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-medium ${t.actionBtn}`}
              >
                <FiDownload className="h-4 w-4" />
                Download Chat PDF
              </button>
            </div>

            {messages.map((message, index) => {
              const isLastUser = message.role === 'user' && index === lastUserIdx
              const isLastMsg = index === messages.length - 1
              const previousUserMessage = message.role === 'assistant'
                ? [...messages.slice(0, index)].reverse().find((item) => item.role === 'user')
                : null
              const suggestedTopics = message.role === 'assistant'
                ? suggestStudyTopics(message.text, previousUserMessage?.text || '')
                : []
              const flowStyle = message.role === 'assistant'
                ? detectQuestionStyle(previousUserMessage?.text || '', message.text)
                : 'conceptual'
              const summary = message.role === 'assistant' ? summarizeLearningPoints(message.text, suggestedTopics) : null
              return (
                <div
                  key={message.id}
                  ref={isLastUser ? latestUserRef : null}
                  style={isLastMsg && message.role === 'assistant' ? { minHeight: 'calc(100svh - 200px)' } : {}}
                >
                  {message.role === 'user' ? (
                    <div className="flex justify-end">
                      <div className={`max-w-[96%] -mr-5 rounded-2xl px-5 py-3 text-sm leading-6 ${t.userMsgBg} ${t.userMsgText}`}>
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
                    <div className="flex items-start gap-3">
                      <div className="mt-0.5 shrink-0 text-teal-500">
                        <RiSparklingFill className="h-5 w-5" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div
                          className={`w-full max-w-[96%] rounded-2xl border px-5 py-3 shadow-sm ${t.inputContainer}`}
                          style={{ marginLeft: '-37px' }}
                        >
                          <div className={`assistant-markdown space-y-3 text-sm leading-7 ${t.assistantText}`}>
                            {renderAssistantMessage(message.text)}
                          </div>
                          <StudyFlowGraph topics={suggestedTopics} flowStyle={flowStyle} />
                          <ResponseSummary takeaways={summary?.takeaways} conclusion={summary?.conclusion} />
                          {suggestedTopics.length ? (
                            <div className="mt-4 flex flex-wrap gap-2">
                              {suggestedTopics.slice(0, 3).map((topic) => (
                                <button
                                  key={`test-${topic}`}
                                  type="button"
                                  onClick={() => handleTakeTest(topic)}
                                  className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${t.inputBtnBg} ${t.inputBtn}`}
                                >
                                  Take test: {topic}
                                </button>
                              ))}
                            </div>
                          ) : null}
                        </div>
                        <div className="mt-3 flex items-center gap-3">
                          <button className={`rounded p-1 ${t.actionBtn}`}><FiThumbsUp className="h-4 w-4" /></button>
                          <button className={`rounded p-1 ${t.actionBtn}`}><FiThumbsDown className="h-4 w-4" /></button>
                          <button
                            type="button"
                            onClick={() => handleRegenerateResponse(message.id)}
                            className={`rounded p-1 ${t.actionBtn}`}
                            title="Regenerate this response"
                            aria-label="Regenerate this response"
                            disabled={Boolean(regeneratingMessageId) || isGenerating}
                          >
                            <FiRefreshCw className={`h-4 w-4 ${regeneratingMessageId === message.id ? 'animate-spin' : ''}`} />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleCopyResponse(message.text)}
                            className={`rounded p-1 ${t.actionBtn}`}
                            title="Copy response"
                            aria-label="Copy response"
                          >
                            <FiCopy className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDownloadSingleResponsePdf(message.id)}
                            className={`rounded p-1 ${t.actionBtn}`}
                            title="Download this response as PDF"
                            aria-label="Download this response as PDF"
                          >
                            <FiDownload className="h-4 w-4" />
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
