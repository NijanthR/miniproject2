import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import {
  FiAward,
  FiCheck,
  FiCheckCircle,
  FiCode,
  FiCopy,
  FiCpu,
  FiHelpCircle,
  FiPlay,
  FiRefreshCw,
  FiRotateCcw,
  FiXCircle,
  FiZap,
} from 'react-icons/fi'
import { useTheme } from '../context/ThemeContext.jsx'
import { buildApiUrl } from '../config/api.js'

const LEVEL_ORDER = ['easy', 'medium', 'hard']
const QUESTION_COUNT = 15

async function requestGeneratedMcqQuestions(topic, level, count = QUESTION_COUNT) {
  const response = await fetch(buildApiUrl('/api/test/mcq/generate/'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      topic,
      difficulty: level,
      count,
    }),
  })

  const payload = await response.json().catch(() => null)
  if (response.ok) {
    return Array.isArray(payload?.questions) ? payload.questions : []
  }

  // Fallback path: if backend route is not available on the running server instance,
  // generate questions through the existing chat endpoint.
  if (response.status === 404) {
    return requestGeneratedMcqQuestionsViaChat(topic, level, count)
  }

  const message = payload?.details || payload?.error || `Request failed with status ${response.status}`
  throw new Error(message)
}

function extractJsonObject(text) {
  const raw = String(text || '').trim()
  if (!raw) return null

  const fenced = raw
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim()

  const start = fenced.indexOf('{')
  const end = fenced.lastIndexOf('}')
  if (start < 0 || end < 0 || end <= start) return null

  try {
    return JSON.parse(fenced.slice(start, end + 1))
  } catch {
    return null
  }
}

async function requestGeneratedMcqQuestionsViaChat(topic, level, count) {
  const prompt = [
    `Generate exactly ${count} MCQ questions for topic: ${topic}.`,
    `Difficulty: ${level}.`,
    'Output ONLY valid JSON using this schema:',
    '{"questions":[{"text":"...","options":["A","B","C","D"],"answerIndex":0}]}',
    'Rules: exactly 4 options, one correct answer, no explanations, no markdown text outside JSON.',
  ].join(' ')

  const response = await fetch(buildApiUrl('/api/chat/'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: prompt,
      model: 'gemini-3.5-flash',
      save_history: false,
    }),
  })

  const payload = await response.json().catch(() => null)
  if (!response.ok) {
    const message = payload?.details || payload?.error || `Request failed with status ${response.status}`
    throw new Error(message)
  }

  const parsed = extractJsonObject(payload?.reply)
  const questions = Array.isArray(parsed?.questions) ? parsed.questions : []

  const normalized = questions
    .slice(0, count)
    .map((item, idx) => {
      const text = String(item?.text || item?.question || '').trim()
      const options = Array.isArray(item?.options) ? item.options.map((o) => String(o || '').trim()) : []
      const answerIndex = Number(item?.answerIndex ?? item?.correct_index ?? item?.answer_index)
      return {
        id: `q-${level}-${idx + 1}`,
        text,
        options,
        answerIndex,
      }
    })
    .filter((q) => q.text && q.options.length === 4 && Number.isInteger(q.answerIndex) && q.answerIndex >= 0 && q.answerIndex <= 3)

  if (normalized.length < count) {
    throw new Error('Model returned invalid question format. Please try again.')
  }

  return normalized
}

async function requestGeneratedCodingChallenge(topic, difficulty = 'medium') {
  const response = await fetch(buildApiUrl('/api/test/coding/generate/'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ topic, difficulty }),
  })

  const payload = await response.json().catch(() => null)
  if (response.ok) {
    return payload?.challenge || null
  }

  // Fallback path: if backend route is unavailable in the running server,
  // generate a coding challenge through the existing chat endpoint.
  if (response.status === 404) {
    return requestGeneratedCodingChallengeViaChat(topic, difficulty)
  }

  const message = payload?.details || payload?.error || `Request failed with status ${response.status}`
  throw new Error(message)
}

function normalizeCodingChallengePayload(raw, topic) {
  if (!raw || typeof raw !== 'object') return null

  const title = String(raw.title || `${topic} Coding Challenge`).trim()
  const description = String(raw.description || '').trim()
  const functionName = String(raw.function_name || '').trim()
  const functionSignature = String(raw.function_signature || '').trim()
  const starterCode = String(raw.starter_code || '').trim()

  const constraints = Array.isArray(raw.constraints)
    ? raw.constraints.map((item) => String(item || '').trim()).filter(Boolean)
    : []

  const examples = Array.isArray(raw.examples)
    ? raw.examples
        .map((item) => ({
          input: String(item?.input || '').trim(),
          output: String(item?.output || '').trim(),
        }))
        .filter((item) => item.input && item.output)
    : []

  const normalizeCases = (cases, limit) =>
    Array.isArray(cases)
      ? cases
          .slice(0, limit)
          .map((item) => ({
            args: Array.isArray(item?.args) ? item.args : [],
            kwargs: item?.kwargs && typeof item.kwargs === 'object' && !Array.isArray(item.kwargs) ? item.kwargs : {},
            expected: item?.expected,
          }))
          .filter((item) => Array.isArray(item.args))
      : []

  let visibleTestCases = normalizeCases(raw.visible_test_cases, 2)
  let hiddenTestCases = normalizeCases(raw.hidden_test_cases, 4)

  if ((visibleTestCases.length !== 2 || hiddenTestCases.length !== 4) && Array.isArray(raw.test_cases)) {
    const allCases = normalizeCases(raw.test_cases, 6)
    if (visibleTestCases.length !== 2) {
      visibleTestCases = allCases.slice(0, 2)
    }
    if (hiddenTestCases.length !== 4) {
      hiddenTestCases = allCases.slice(2, 6)
    }
  }

  if (!description || !functionName || !functionSignature || visibleTestCases.length !== 2 || hiddenTestCases.length !== 4) {
    return null
  }

  return {
    title,
    description,
    function_name: functionName,
    function_signature: functionSignature,
    constraints,
    examples,
    starter_code: starterCode || `${functionSignature}\n    pass`,
    visible_test_cases: visibleTestCases,
    hidden_test_cases: hiddenTestCases,
  }
}

function buildDefaultCodingChallenge(topic) {
  return {
    title: `${topic} - Basic Function Practice`,
    description: 'Implement solve(text) that returns the reversed string.',
    function_name: 'solve',
    function_signature: 'def solve(text):',
    constraints: ['Input is a string', 'Return a string', 'Use O(n) time'],
    examples: [
      { input: '"hello"', output: '"olleh"' },
      { input: '"abc"', output: '"cba"' },
    ],
    starter_code: 'def solve(text):\n    # Write your code here\n    return ""',
    visible_test_cases: [
      { args: ['hello'], kwargs: {}, expected: 'olleh' },
      { args: ['abc'], kwargs: {}, expected: 'cba' },
    ],
    hidden_test_cases: [
      { args: ['a'], kwargs: {}, expected: 'a' },
      { args: ['racecar'], kwargs: {}, expected: 'racecar' },
      { args: ['ab cd'], kwargs: {}, expected: 'dc ba' },
      { args: ['Python'], kwargs: {}, expected: 'nohtyP' },
    ],
  }
}

async function requestGeneratedCodingChallengeViaChat(topic, difficulty) {
  const prompt = [
    `Generate one Python coding challenge for topic: ${topic}.`,
    `Difficulty: ${difficulty}.`,
    'Output ONLY valid JSON with schema:',
    '{"title":"...","description":"...","function_name":"...","function_signature":"def name(...):","constraints":["..."],"examples":[{"input":"...","output":"..."}],"starter_code":"def name(...):\\n    pass","visible_test_cases":[{"args":[...],"kwargs":{},"expected":...}],"hidden_test_cases":[{"args":[...],"kwargs":{},"expected":...}]}',
    'Rules: include exactly 2 visible_test_cases and exactly 4 hidden_test_cases. No markdown text outside JSON.',
  ].join(' ')

  const response = await fetch(buildApiUrl('/api/chat/'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: prompt,
      model: 'gemini-3.5-flash',
      save_history: false,
    }),
  })

  const payload = await response.json().catch(() => null)
  if (!response.ok) {
    const message = payload?.details || payload?.error || `Request failed with status ${response.status}`
    throw new Error(message)
  }

  const parsed = extractJsonObject(payload?.reply)
  const normalized = normalizeCodingChallengePayload(parsed, topic)
  if (normalized) {
    return normalized
  }

  return buildDefaultCodingChallenge(topic)
}

async function requestRunCodingTest(code, functionName, testCases) {
  const response = await fetch(buildApiUrl('/api/test/coding/run/'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      code,
      function_name: functionName,
      test_cases: testCases,
    }),
  })

  const payload = await response.json().catch(() => null)
  if (response.ok) {
    return payload
  }

  if (response.status === 404) {
    throw new Error('Run endpoint is unavailable (404). Restart backend server to load /api/test/coding/run/.')
  }

  const message = payload?.details || payload?.error || `Request failed with status ${response.status}`
  throw new Error(message)
}

function extractCodeSnippet(text) {
  const raw = String(text || '').trim()
  if (!raw) return ''

  const fencedMatch = raw.match(/```(?:python)?\s*([\s\S]*?)```/i)
  if (fencedMatch?.[1]) {
    const fencedContent = fencedMatch[1].trim()
    const parsedFromFence = extractJsonObject(fencedContent)
    if (parsedFromFence && typeof parsedFromFence.solution_code === 'string') {
      return parsedFromFence.solution_code.trim()
    }
    return fencedContent
  }

  const parsed = extractJsonObject(raw)
  if (parsed && typeof parsed.solution_code === 'string') {
    return parsed.solution_code.trim()
  }

  return raw
}

async function requestCodingSolution(challenge, topic, difficulty) {
  const functionSignature = String(challenge?.function_signature || '').trim()
  const functionName = String(challenge?.function_name || '').trim()
  const description = String(challenge?.description || '').trim()
  const constraints = Array.isArray(challenge?.constraints) ? challenge.constraints : []
  const examples = Array.isArray(challenge?.examples) ? challenge.examples : []

  const prompt = [
    `Solve this Python challenge for topic: ${topic}.`,
    `Difficulty: ${difficulty}.`,
    `Function signature: ${functionSignature}.`,
    `Function name: ${functionName}.`,
    `Description: ${description}.`,
    `Constraints: ${JSON.stringify(constraints)}.`,
    `Examples: ${JSON.stringify(examples)}.`,
    'Return ONLY valid JSON with this schema:',
    '{"solution_code":"def ..."}',
    'Rules: produce complete working code only, no explanation, no markdown outside JSON.',
  ].join(' ')

  const response = await fetch(buildApiUrl('/api/chat/'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: prompt,
      model: 'gemini-3.5-flash',
      save_history: false,
    }),
  })

  const payload = await response.json().catch(() => null)
  if (!response.ok) {
    const message = payload?.details || payload?.error || `Request failed with status ${response.status}`
    throw new Error(message)
  }

  const code = extractCodeSnippet(payload?.reply)
  if (!code) {
    throw new Error('Could not generate solution code. Please try again.')
  }

  return code
}

function CodingComponent({
  topic,
  challenge,
  codingDifficulty,
  onCodingDifficultyChange,
  onGenerateChallenge,
  isGeneratingChallenge,
  challengeError,
  code,
  onCodeChange,
  onResetCode,
  onGetSolution,
  isGettingSolution,
  solutionError,
  onRunCode,
  isRunningCode,
  runError,
  runResult,
}) {
  const { t } = useTheme()
  const hasChallenge = Boolean(challenge)
  const tests = Array.isArray(runResult?.results) ? runResult.results : []
  const visibleTests = Array.isArray(challenge?.visible_test_cases) ? challenge.visible_test_cases : []
  const hiddenTests = Array.isArray(challenge?.hidden_test_cases) ? challenge.hidden_test_cases : []

  return (
    <section className={`mt-8 rounded-3xl border px-5 py-6 shadow-md backdrop-blur-md transition-all sm:px-7 ${t.inputContainer}`}>
      <div className="flex items-center gap-2">
        <span className="grid h-8 w-8 place-items-center rounded-xl bg-teal-500 text-white shadow-xs">
          <FiCode className="h-4 w-4" />
        </span>
        <h2 className={`text-xl font-bold ${t.assistantText}`}>Coding Arena</h2>
      </div>
      <p className={`mt-1 text-sm ${t.assistantText}`}>
        Topic: <span className="font-bold text-teal-600 dark:text-teal-400">{topic}</span>
      </p>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200/80 bg-white/70 px-4 py-3 shadow-xs dark:border-slate-800 dark:bg-slate-900/40">
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Difficulty:</span>
          <div className="inline-flex shrink-0 items-center rounded-xl border border-slate-200/80 bg-slate-100/90 p-1 dark:border-slate-800 dark:bg-slate-900/80">
            {LEVEL_ORDER.map((level) => (
              <button
                key={level}
                type="button"
                onClick={() => onCodingDifficultyChange(level)}
                className={`rounded-lg px-3.5 py-1.5 text-xs font-bold capitalize transition-all duration-150 ${
                  codingDifficulty === level
                    ? 'bg-linear-to-tr from-teal-600 to-teal-500 text-white shadow-xs'
                    : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'
                }`}
              >
                {level}
              </button>
            ))}
          </div>
        </div>
        <button
          type="button"
          onClick={onGenerateChallenge}
          disabled={isGeneratingChallenge}
          className="flex items-center gap-2 rounded-xl bg-linear-to-tr from-teal-600 to-teal-500 px-5 py-2 text-xs font-bold text-white shadow-md shadow-teal-500/25 transition-all hover:scale-105 active:scale-95 disabled:opacity-50"
        >
          <FiRefreshCw className={`h-3.5 w-3.5 ${isGeneratingChallenge ? 'animate-spin' : ''}`} />
          <span>{isGeneratingChallenge ? 'Generating Challenge...' : 'Generate New Challenge'}</span>
        </button>
      </div>

      {challengeError && (
        <div className="mt-3 rounded-xl border border-rose-300 bg-rose-50 px-4 py-3 dark:border-rose-700 dark:bg-rose-950/30">
          <p className="text-sm text-rose-700 dark:text-rose-300">{challengeError}</p>
        </div>
      )}

      {hasChallenge && (
        <>
          <div className="mt-4 rounded-xl border bg-white/70 px-4 py-4 dark:bg-slate-900/30">
            <p className={`text-base font-semibold ${t.assistantText}`}>{challenge.title}</p>
            <p className={`mt-2 text-sm ${t.assistantText}`}>{challenge.description}</p>
            <div className="mt-3 rounded-lg border bg-slate-50 px-3 py-2 text-xs text-slate-700 dark:bg-slate-900/40 dark:text-slate-200">
              Required function: <span className="font-semibold">{challenge.function_signature}</span>
            </div>

            {Array.isArray(challenge.constraints) && challenge.constraints.length > 0 && (
              <div className="mt-3">
                <p className={`text-xs font-semibold uppercase tracking-wide ${t.assistantText}`}>Constraints</p>
                <ul className={`mt-1 list-disc space-y-1 pl-5 text-sm ${t.assistantText}`}>
                  {challenge.constraints.map((item, idx) => (
                    <li key={`${item}-${idx}`}>{item}</li>
                  ))}
                </ul>
              </div>
            )}

            {Array.isArray(challenge.examples) && challenge.examples.length > 0 && (
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {challenge.examples.map((item, idx) => (
                  <div key={`${idx}-${item.input}`} className="rounded-lg border bg-white/70 px-3 py-2 text-xs dark:bg-slate-900/40">
                    <p className={`font-semibold ${t.assistantText}`}>Example {idx + 1}</p>
                    <p className={`mt-1 ${t.assistantText}`}>Input: {item.input}</p>
                    <p className={t.assistantText}>Output: {item.output}</p>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="mt-4 rounded-xl border bg-white/70 px-4 py-4 dark:bg-slate-900/30">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <p className={`text-sm font-semibold ${t.assistantText}`}>Code Editor (Python)</p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={onResetCode}
                  className={`rounded-full px-3 py-1.5 text-xs font-semibold ${t.inputBtnBg} ${t.inputBtn}`}
                >
                  Reset Starter
                </button>
                <button
                  type="button"
                  onClick={onGetSolution}
                  disabled={isGettingSolution || !hasChallenge}
                  className={`rounded-full px-3 py-1.5 text-xs font-semibold ${t.inputBtnBg} ${t.inputBtn}`}
                >
                  {isGettingSolution ? 'Getting...' : 'Get Solution'}
                </button>
                <button
                  type="button"
                  onClick={onRunCode}
                  disabled={isRunningCode || !code.trim()}
                  className={`rounded-full px-4 py-1.5 text-xs font-semibold ${t.inputBtnBg} ${t.inputBtn}`}
                >
                  {isRunningCode ? 'Running...' : 'Run Code'}
                </button>
              </div>
            </div>

            <textarea
              value={code}
              onChange={(e) => onCodeChange(e.target.value)}
              spellCheck={false}
              rows={15}
              className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-3 font-mono text-sm text-slate-100 outline-none placeholder:text-slate-400"
            />
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl border bg-white/70 px-4 py-3 dark:bg-slate-900/30">
              <p className={`text-xs font-semibold uppercase tracking-wide ${t.assistantText}`}>
                Visible Test Cases ({visibleTests.length})
              </p>
              <div className="mt-2 space-y-2">
                {visibleTests.map((item, idx) => (
                  <div key={`visible-${idx}`} className="rounded-lg border px-3 py-2 text-xs">
                    <p className={t.assistantText}>Case {idx + 1}</p>
                    <p className={`mt-1 ${t.assistantText}`}>Input: {JSON.stringify(item.args)}</p>
                    <p className={t.assistantText}>Expected: {JSON.stringify(item.expected)}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-xl border bg-white/70 px-4 py-3 dark:bg-slate-900/30">
              <p className={`text-xs font-semibold uppercase tracking-wide ${t.assistantText}`}>
                Hidden Test Cases ({hiddenTests.length})
              </p>
              <div className="mt-2 space-y-2">
                {hiddenTests.map((_, idx) => (
                  <div key={`hidden-${idx}`} className="rounded-lg border px-3 py-2 text-xs">
                    <p className={t.assistantText}>Hidden Case {idx + 1}</p>
                    <p className={`mt-1 ${t.assistantText}`}>Input and expected output are hidden.</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </>
      )}

      {runError && (
        <div className="mt-3 rounded-xl border border-rose-300 bg-rose-50 px-4 py-3 dark:border-rose-700 dark:bg-rose-950/30">
          <p className="text-sm text-rose-700 dark:text-rose-300">{runError}</p>
        </div>
      )}

      {solutionError && (
        <div className="mt-3 rounded-xl border border-rose-300 bg-rose-50 px-4 py-3 dark:border-rose-700 dark:bg-rose-950/30">
          <p className="text-sm text-rose-700 dark:text-rose-300">{solutionError}</p>
        </div>
      )}

      {runResult && (
        <div className="mt-4 space-y-3">
          <div className="rounded-xl border border-teal-300 bg-teal-50 px-4 py-3 dark:border-teal-800 dark:bg-teal-900/20">
            <p className="text-sm font-semibold text-teal-900 dark:text-teal-200">
              Test Cases: {runResult.passed || 0} / {runResult.total || 0} passed
            </p>
          </div>

          {runResult.runtime_error && (
            <div className="rounded-xl border border-rose-300 bg-rose-50 px-4 py-3 dark:border-rose-700 dark:bg-rose-950/30">
              <p className="text-xs font-semibold uppercase tracking-wide text-rose-700 dark:text-rose-300">Runtime Error</p>
              <pre className="mt-2 overflow-x-auto whitespace-pre-wrap text-xs text-rose-700 dark:text-rose-300">{runResult.runtime_error}</pre>
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl border bg-white/70 px-4 py-3 dark:bg-slate-900/30">
              <p className={`text-xs font-semibold uppercase tracking-wide ${t.assistantText}`}>Output</p>
              <pre className={`mt-2 overflow-x-auto whitespace-pre-wrap text-xs ${t.assistantText}`}>
                {runResult.stdout || '(no output)'}
              </pre>
            </div>
            <div className="rounded-xl border bg-white/70 px-4 py-3 dark:bg-slate-900/30">
              <p className={`text-xs font-semibold uppercase tracking-wide ${t.assistantText}`}>Errors</p>
              <pre className={`mt-2 overflow-x-auto whitespace-pre-wrap text-xs ${t.assistantText}`}>
                {runResult.stderr || '(no stderr)'}
              </pre>
            </div>
          </div>

          <div className="rounded-xl border bg-white/70 px-4 py-3 dark:bg-slate-900/30">
            <p className={`text-xs font-semibold uppercase tracking-wide ${t.assistantText}`}>Test Case Results</p>
            {tests.length === 0 ? (
              <p className={`mt-2 text-sm ${t.assistantText}`}>No test case results yet.</p>
            ) : (
              <div className="mt-2 space-y-2">
                {tests.map((item) => (
                  <div
                    key={`test-${item.index}`}
                    className={`rounded-lg border px-3 py-2 text-xs ${
                      item.passed
                        ? 'border-emerald-400 bg-emerald-50 dark:bg-emerald-950/30'
                        : 'border-rose-400 bg-rose-50 dark:bg-rose-950/30'
                    }`}
                  >
                    <p className={`font-semibold ${t.assistantText}`}>
                      {item.passed ? '✓' : '✗'} {item.label || (item.is_hidden ? `Hidden Case ${item.index}` : `Case ${item.index}`)}:
                      {' '}
                      {item.passed ? 'Passed' : 'Failed'}
                    </p>
                    {!item.is_hidden && <p className={`mt-1 ${t.assistantText}`}>Input: {JSON.stringify(item.input)}</p>}
                    {!item.is_hidden && <p className={t.assistantText}>Expected: {JSON.stringify(item.expected)}</p>}
                    <p className={t.assistantText}>Actual: {JSON.stringify(item.actual)}</p>
                    {item.error && <pre className={`mt-1 overflow-x-auto whitespace-pre-wrap ${t.assistantText}`}>{item.error}</pre>}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {!hasChallenge && !isGeneratingChallenge && (
        <p className={`mt-4 text-sm ${t.assistantText}`}>
          Generate a challenge to start coding, then run your code to see output, errors, and test case checks.
        </p>
      )}
      {!topic && (
        <p className={`mt-4 text-sm ${t.assistantText}`}>Enter a topic and click Generate first.</p>
      )}
    </section>
  )
}

function McqTestComponent({
  topic,
  selectedDifficulty,
  onDifficultySelect,
  questions,
  isGeneratingQuestions,
  generationError,
  answers,
  onAnswerChange,
  onSubmit,
  result,
  isFullscreen,
  t,
}) {
  const attemptedCount = Object.keys(answers).length
  const isSubmitted = Boolean(result)
  const progress = questions.length ? Math.round((attemptedCount / questions.length) * 100) : 0

  const getScoreRating = (pct) => {
    if (pct === 100) return { title: 'Outstanding!', badge: 'Mastered 🌟', color: 'text-emerald-500' }
    if (pct >= 80) return { title: 'Great Job!', badge: 'Proficient 👍', color: 'text-teal-500' }
    if (pct >= 60) return { title: 'Good Effort!', badge: 'Developing 📈', color: 'text-amber-500' }
    return { title: 'Keep Practicing!', badge: 'Review Needed 📚', color: 'text-rose-500' }
  }

  const scoreRating = result ? getScoreRating(result.percentage) : null

  return (
    <section className={`mt-8 rounded-3xl border px-5 py-6 shadow-md transition-all sm:px-7 backdrop-blur-md ${t.inputContainer}`}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="grid h-8 w-8 place-items-center rounded-xl bg-teal-500 text-white shadow-xs">
              <FiZap className="h-4 w-4" />
            </span>
            <h2 className={`text-xl font-bold ${t.assistantText}`}>MCQ Test Arena</h2>
          </div>
          <p className={`mt-1.5 text-sm ${t.assistantText}`}>
            Topic: <span className="font-bold text-teal-600 dark:text-teal-400">{topic}</span>
          </p>
          {!isFullscreen && (
            <p className={`mt-0.5 text-xs opacity-75 ${t.assistantText}`}>
              Choose a difficulty to generate {QUESTION_COUNT} customized questions.
            </p>
          )}
        </div>
        {!isFullscreen && (
          <div className="grid w-full grid-cols-3 gap-2 rounded-2xl border border-teal-500/20 bg-white/70 p-1 sm:w-auto dark:bg-slate-900/40">
            {LEVEL_ORDER.map((level) => {
              const isSelected = selectedDifficulty === level
              return (
                <button
                  key={level}
                  type="button"
                  onClick={() => onDifficultySelect(level)}
                  disabled={isGeneratingQuestions}
                  className={`rounded-xl px-4 py-2 text-xs font-bold capitalize transition-all hover:scale-105 active:scale-95 ${
                    isSelected ? 'bg-teal-500 text-white shadow-sm' : `${t.inputBtnBg} ${t.inputBtn}`
                  }`}
                >
                  {level}
                </button>
              )
            })}
          </div>
        )}
      </div>

      {!isFullscreen && !questions.length && (
        <div className="mt-6 rounded-2xl border border-dashed border-teal-500/30 p-6 text-center">
          <p className={`text-sm font-medium ${t.assistantText}`}>
            Select a difficulty (Easy, Medium, or Hard) to begin your interactive quiz.
          </p>
        </div>
      )}

      {isGeneratingQuestions && (
        <div className="mt-6 flex items-center justify-center gap-3 rounded-2xl border border-teal-500/20 bg-teal-50/60 dark:bg-teal-950/20 p-5">
          <FiRefreshCw className="h-5 w-5 animate-spin text-teal-500" />
          <span className="text-sm font-semibold text-teal-700 dark:text-teal-300">
            Generating questions with AI Engine...
          </span>
        </div>
      )}

      {generationError && (
        <div className="mt-4 rounded-2xl border border-rose-300 bg-rose-50 px-4 py-3.5 dark:border-rose-700 dark:bg-rose-950/30">
          <p className="text-sm font-semibold text-rose-700 dark:text-rose-300">{generationError}</p>
        </div>
      )}

      {questions.length > 0 && (
        <>
          <div className="mt-5 rounded-2xl border border-teal-500/20 bg-white/70 p-4.5 shadow-xs dark:bg-slate-900/30">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="inline-flex items-center gap-1.5 rounded-lg bg-teal-100 dark:bg-teal-950/60 px-2.5 py-1 text-xs font-bold capitalize text-teal-800 dark:text-teal-300">
                Difficulty: {selectedDifficulty}
              </span>
              <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">
                Answered: {attemptedCount} / {questions.length} ({progress}%)
              </span>
            </div>
            <div className="mt-2.5 h-2.5 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
              <div
                className="h-full rounded-full bg-linear-to-r from-teal-500 to-cyan-500 transition-all duration-300"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>

          <div className="mt-6 space-y-4">
            {questions.map((question, qIdx) => (
              <div
                key={question.id}
                className="rounded-3xl border border-slate-200/80 bg-white/95 p-5 shadow-xs transition-all hover:shadow-md dark:border-slate-800 dark:bg-slate-900/50"
              >
                <div className="flex items-start gap-3">
                  <span className="grid h-6 w-6 shrink-0 place-items-center rounded-lg bg-teal-500/10 text-xs font-bold text-teal-600 dark:text-teal-400">
                    {qIdx + 1}
                  </span>
                  <p className={`text-sm font-semibold leading-relaxed ${t.assistantText}`}>{question.text}</p>
                </div>

                <div className="mt-4 grid gap-2.5 sm:grid-cols-2">
                  {question.options.map((option, optionIndex) => {
                    const checked = answers[question.id] === optionIndex
                    const isCorrectOption = optionIndex === question.answerIndex
                    const isWrongSelected = isSubmitted && checked && !isCorrectOption
                    const isCorrectHighlight = isSubmitted && isCorrectOption

                    let optionClass = 'border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-800/60 hover:border-teal-400 hover:bg-teal-50/40 dark:hover:bg-slate-800'
                    if (isCorrectHighlight) {
                      optionClass = 'border-emerald-500 bg-emerald-50 text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200 ring-2 ring-emerald-500/30 font-semibold'
                    } else if (isWrongSelected) {
                      optionClass = 'border-rose-500 bg-rose-50 text-rose-900 dark:bg-rose-950/40 dark:text-rose-200 ring-2 ring-rose-500/30'
                    } else if (checked) {
                      optionClass = 'border-teal-500 bg-teal-50/80 dark:bg-teal-950/40 ring-2 ring-teal-500/20 font-semibold'
                    }

                    return (
                      <label
                        key={`${question.id}-${optionIndex}`}
                        className={`flex items-center gap-3 rounded-2xl border p-3 text-sm transition-all duration-150 ${optionClass} ${
                          isSubmitted ? 'cursor-default' : 'cursor-pointer hover:scale-[1.01] active:scale-[0.99]'
                        }`}
                      >
                        <input
                          type="radio"
                          name={question.id}
                          checked={checked}
                          disabled={isSubmitted}
                          onChange={() => onAnswerChange(question.id, optionIndex)}
                          className="hidden"
                        />
                        <span
                          className={`grid h-7 w-7 shrink-0 place-items-center rounded-xl border text-xs font-bold transition-colors ${
                            checked || isCorrectHighlight
                              ? 'border-transparent bg-teal-500 text-white'
                              : 'border-slate-300 dark:border-slate-600 bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300'
                          }`}
                        >
                          {String.fromCharCode(65 + optionIndex)}
                        </span>
                        <span className="flex-1 text-xs leading-relaxed">{option}</span>
                        {isCorrectHighlight && <FiCheckCircle className="h-4 w-4 text-emerald-500 shrink-0" />}
                        {isWrongSelected && <FiXCircle className="h-4 w-4 text-rose-500 shrink-0" />}
                      </label>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>

          {!isSubmitted && (
            <div className="mt-6 flex justify-end border-t border-slate-200 pt-5 dark:border-slate-800">
              <button
                type="button"
                onClick={onSubmit}
                className="flex items-center gap-2 rounded-2xl bg-linear-to-tr from-teal-600 to-teal-500 px-6 py-3 text-sm font-bold text-white shadow-lg shadow-teal-500/25 transition-all hover:scale-105 active:scale-95"
              >
                <FiAward className="h-4 w-4" />
                Submit Test ({attemptedCount}/{questions.length} answered)
              </button>
            </div>
          )}
        </>
      )}

      {result && (
        <div className="mt-8 rounded-3xl border border-teal-500/30 bg-linear-to-b from-teal-50/90 to-cyan-50/90 dark:from-slate-900/90 dark:to-teal-950/40 p-6 shadow-lg text-center animate-slide-up">
          <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-linear-to-tr from-teal-500 to-cyan-400 text-white shadow-lg shadow-teal-500/30 font-extrabold text-2xl">
            {result.percentage}%
          </div>
          <h3 className="mt-4 text-xl font-bold text-slate-900 dark:text-white">
            {scoreRating?.title}
          </h3>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
            You answered <span className="font-bold text-teal-600 dark:text-teal-400">{result.correct}</span> out of{' '}
            <span className="font-bold">{result.total}</span> questions correctly.
          </p>
          <div className="mt-4 inline-flex items-center gap-2 rounded-full bg-teal-100 dark:bg-teal-950/60 px-4 py-1.5 text-xs font-bold text-teal-800 dark:text-teal-200">
            <span>Rating: {scoreRating?.badge}</span>
            <span>•</span>
            <span className="capitalize">{result.level} level</span>
          </div>
        </div>
      )}
    </section>
  )
}

function TestPage() {
  const { t } = useTheme()
  const location = useLocation()
  const testScreenRef = useRef(null)
  const [topic, setTopic] = useState('')
  const [generatedTopic, setGeneratedTopic] = useState('')
  const [selectedType, setSelectedType] = useState('mcq')
  const [mode, setMode] = useState(null)
  const [selectedDifficulty, setSelectedDifficulty] = useState('')
  const [questions, setQuestions] = useState([])
  const [answers, setAnswers] = useState({})
  const [result, setResult] = useState(null)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [isGeneratingQuestions, setIsGeneratingQuestions] = useState(false)
  const [generationError, setGenerationError] = useState('')
  const [codingDifficulty, setCodingDifficulty] = useState('medium')
  const [codingChallenge, setCodingChallenge] = useState(null)
  const [codingCode, setCodingCode] = useState('')
  const [isGeneratingCodingChallenge, setIsGeneratingCodingChallenge] = useState(false)
  const [codingChallengeError, setCodingChallengeError] = useState('')
  const [isRunningCode, setIsRunningCode] = useState(false)
  const [codingRunError, setCodingRunError] = useState('')
  const [codingRunResult, setCodingRunResult] = useState(null)
  const [isGettingSolution, setIsGettingSolution] = useState(false)
  const [codingSolutionError, setCodingSolutionError] = useState('')

  const canGenerate = useMemo(() => topic.trim().length > 0, [topic])

  useEffect(() => {
    const params = new URLSearchParams(location.search)
    const nextTopic = String(params.get('topic') || '').trim()
    if (nextTopic) {
      setTopic(nextTopic)
    }
  }, [location.search])

  useEffect(() => {
    const onFullScreenChange = () => {
      setIsFullscreen(document.fullscreenElement === testScreenRef.current)
    }
    document.addEventListener('fullscreenchange', onFullScreenChange)
    return () => document.removeEventListener('fullscreenchange', onFullScreenChange)
  }, [])

  const loadCodingChallenge = async (topicValue, difficultyValue) => {
    if (!topicValue) return

    setIsGeneratingCodingChallenge(true)
    setCodingChallengeError('')
    setCodingRunError('')
    setCodingSolutionError('')
    setCodingRunResult(null)

    try {
      const challenge = await requestGeneratedCodingChallenge(topicValue, difficultyValue)
      setCodingChallenge(challenge)
      setCodingCode(challenge?.starter_code || '')
    } catch (err) {
      setCodingChallengeError(String(err?.message || 'Failed to generate coding challenge. Please try again.'))
    } finally {
      setIsGeneratingCodingChallenge(false)
    }
  }

  const handleGenerate = async () => {
    const trimmed = topic.trim()
    if (!trimmed) return

    if (selectedType === 'coding' && !document.fullscreenElement) {
      try {
        if (testScreenRef.current?.requestFullscreen) {
          await testScreenRef.current.requestFullscreen()
        }
      } catch {
        try {
          await document.documentElement.requestFullscreen()
        } catch {
          // Fullscreen can fail if browser policy blocks it.
        }
      }
    }

    setGeneratedTopic(trimmed)
    setMode(selectedType)
    setSelectedDifficulty('')
    setQuestions([])
    setAnswers({})
    setResult(null)
    setGenerationError('')
    setIsGeneratingQuestions(false)
    setCodingChallenge(null)
    setCodingCode('')
    setCodingChallengeError('')
    setCodingRunError('')
    setCodingSolutionError('')
    setCodingRunResult(null)
    setIsRunningCode(false)
    setIsGettingSolution(false)

    if (isFullscreen && document.fullscreenElement === testScreenRef.current) {
      document.exitFullscreen().catch(() => {})
    }

    if (selectedType === 'coding') {
      await loadCodingChallenge(trimmed, codingDifficulty)
    }
  }

  const handleDifficultySelect = async (level) => {
    if (!generatedTopic) return

    const levelValue = LEVEL_ORDER.includes(level) ? level : 'easy'

    if (!document.fullscreenElement) {
      try {
        // Must run directly in the click event path; browsers can block fullscreen after awaits.
        if (testScreenRef.current?.requestFullscreen) {
          await testScreenRef.current.requestFullscreen()
        }
      } catch {
        try {
          // Fallback: request fullscreen on the root document element.
          await document.documentElement.requestFullscreen()
        } catch {
          // Fullscreen can still fail if browser policy blocks it.
        }
      }
    }

    setSelectedDifficulty(levelValue)
    setQuestions([])
    setAnswers({})
    setResult(null)
    setGenerationError('')
    setIsGeneratingQuestions(true)

    try {
      const newQuestions = await requestGeneratedMcqQuestions(generatedTopic, levelValue, QUESTION_COUNT)
      setQuestions(newQuestions)
    } catch (err) {
      setGenerationError(String(err?.message || 'Failed to generate questions. Please try again.'))
    } finally {
      setIsGeneratingQuestions(false)
    }
  }

  const handleKeyDown = (event) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      handleGenerate()
    }
  }

  const handleAnswerChange = (questionId, optionIndex) => {
    setAnswers((prev) => ({ ...prev, [questionId]: optionIndex }))
  }

  const handleSubmit = () => {
    if (!questions.length || !selectedDifficulty) return

    let correct = 0

    for (const question of questions) {
      const isCorrect = answers[question.id] === question.answerIndex
      if (isCorrect) {
        correct += 1
      }
    }

    const total = questions.length
    const percentage = Math.round((correct / total) * 100)

    setResult({ correct, total, percentage, level: selectedDifficulty })

    if (document.fullscreenElement === testScreenRef.current) {
      document.exitFullscreen().catch(() => {})
    }
  }

  const handleRunCoding = async () => {
    if (!codingChallenge || !codingCode.trim()) return

    const functionName = String(codingChallenge.function_name || '').trim()
    if (functionName) {
      const functionRegex = new RegExp(`\\bdef\\s+${functionName}\\s*\\(`)
      if (!functionRegex.test(codingCode)) {
        setCodingRunError(`Please implement required function: ${codingChallenge.function_signature}`)
        setCodingSolutionError('')
        setCodingRunResult(null)
        return
      }
    }

    setIsRunningCode(true)
    setCodingRunError('')
    setCodingSolutionError('')

    try {
      const visibleCases = Array.isArray(codingChallenge.visible_test_cases)
        ? codingChallenge.visible_test_cases.map((testCase, idx) => ({ ...testCase, is_hidden: false, label: `Visible ${idx + 1}` }))
        : []
      const hiddenCases = Array.isArray(codingChallenge.hidden_test_cases)
        ? codingChallenge.hidden_test_cases.map((testCase, idx) => ({ ...testCase, is_hidden: true, label: `Hidden ${idx + 1}` }))
        : []

      const runResult = await requestRunCodingTest(
        codingCode,
        codingChallenge.function_name,
        [...visibleCases, ...hiddenCases]
      )
      setCodingRunResult(runResult)
    } catch (err) {
      setCodingRunError(String(err?.message || 'Failed to run code. Please try again.'))
      setCodingRunResult(null)
    } finally {
      setIsRunningCode(false)
    }
  }

  const handleResetCodingCode = () => {
    setCodingCode(codingChallenge?.starter_code || '')
    setCodingRunError('')
    setCodingSolutionError('')
    setCodingRunResult(null)
  }

  const handleGetSolution = async () => {
    if (!codingChallenge) return

    setIsGettingSolution(true)
    setCodingSolutionError('')

    try {
      const generatedCode = await requestCodingSolution(codingChallenge, generatedTopic, codingDifficulty)
      setCodingCode(generatedCode)
      setCodingRunError('')
      setCodingRunResult(null)
    } catch (err) {
      setCodingSolutionError(String(err?.message || 'Failed to generate solution. Please try again.'))
    } finally {
      setIsGettingSolution(false)
    }
  }

  return (
    <div className={`h-full w-full overflow-y-auto px-5 py-8 sm:px-8 lg:px-12 ${t.pageBg}`}>
      <div className="mx-auto w-full max-w-4xl">
        {!isFullscreen && (
          <>
            <div className="mb-4 rounded-3xl border bg-white/50 p-5 shadow-sm backdrop-blur-sm dark:bg-slate-900/25">
              <h1 className={`text-2xl font-semibold ${t.assistantText}`}>Test Generator</h1>
              <p className={`mt-1 text-sm ${t.assistantText}`}>
                Create topic-based assessments with MCQ tests and coding tasks with run output, errors, and test case checks.
              </p>
            </div>

            <div className={`rounded-3xl border px-4 py-4 shadow-sm sm:px-5 ${t.inputContainer}`}>
              <label htmlFor="test-topic" className="sr-only">
                enter topic
              </label>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <input
                  id="test-topic"
                  type="text"
                  value={topic}
                  onChange={(e) => setTopic(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Enter topic"
                  className={`w-full rounded-2xl border bg-white/80 px-4 py-3 text-sm outline-none ${t.inputText}`}
                />

                <div className="inline-flex shrink-0 items-center rounded-2xl border border-slate-200/80 bg-slate-100/90 p-1 shadow-inner backdrop-blur-sm dark:border-slate-800 dark:bg-slate-900/80">
                  <button
                    type="button"
                    onClick={() => setSelectedType('mcq')}
                    className={`flex items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-bold transition-all duration-200 ${
                      selectedType === 'mcq'
                        ? 'bg-linear-to-tr from-teal-600 to-teal-500 text-white shadow-md shadow-teal-500/25'
                        : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100 hover:bg-white/40 dark:hover:bg-slate-800/50'
                    }`}
                  >
                    <FiCheckCircle className="h-3.5 w-3.5" />
                    <span>MCQ Quiz</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelectedType('coding')}
                    className={`flex items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-bold transition-all duration-200 ${
                      selectedType === 'coding'
                        ? 'bg-linear-to-tr from-teal-600 to-teal-500 text-white shadow-md shadow-teal-500/25'
                        : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100 hover:bg-white/40 dark:hover:bg-slate-800/50'
                    }`}
                  >
                    <FiCode className="h-3.5 w-3.5" />
                    <span>Coding</span>
                  </button>
                </div>

                <button
                  type="button"
                  onClick={handleGenerate}
                  disabled={!canGenerate}
                  className={`rounded-2xl px-6 py-3 text-xs font-bold transition-all duration-200 ${
                    canGenerate
                      ? 'bg-linear-to-tr from-teal-600 to-teal-500 text-white shadow-md shadow-teal-500/25 hover:scale-105 active:scale-95'
                      : 'cursor-not-allowed bg-slate-200 text-slate-400 dark:bg-slate-800 dark:text-slate-600'
                  }`}
                >
                  Generate
                </button>
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-200/60 pt-3 dark:border-slate-800">
                <span className="text-[11px] font-bold text-slate-400">Try Topic:</span>
                {[
                  'Python Basics',
                  'Binary Search',
                  'Dynamic Programming',
                  'SQL Joins',
                  'Recursion',
                  'Operating Systems',
                ].map((sample) => (
                  <button
                    key={sample}
                    type="button"
                    onClick={() => {
                      setTopic(sample)
                    }}
                    className={`rounded-xl px-2.5 py-1 text-xs font-semibold transition-all hover:scale-105 active:scale-95 ${
                      topic === sample
                        ? 'bg-teal-500 text-white shadow-xs'
                        : 'bg-white/80 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-teal-50 dark:hover:bg-slate-700'
                    }`}
                  >
                    {sample}
                  </button>
                ))}
              </div>
            </div>
          </>
        )}

        <div ref={testScreenRef} className={isFullscreen ? `h-screen overflow-y-auto px-3 py-4 sm:px-8 ${t.pageBg}` : ''}>
          {mode === 'mcq' && (
            <McqTestComponent
              topic={generatedTopic}
              selectedDifficulty={selectedDifficulty}
              onDifficultySelect={handleDifficultySelect}
              questions={questions}
              isGeneratingQuestions={isGeneratingQuestions}
              generationError={generationError}
              answers={answers}
              onAnswerChange={handleAnswerChange}
              onSubmit={handleSubmit}
              result={result}
              isFullscreen={isFullscreen}
              t={t}
            />
          )}
          {mode === 'coding' && (
            <CodingComponent
              topic={generatedTopic}
              challenge={codingChallenge}
              codingDifficulty={codingDifficulty}
              onCodingDifficultyChange={setCodingDifficulty}
              onGenerateChallenge={() => loadCodingChallenge(generatedTopic, codingDifficulty)}
              isGeneratingChallenge={isGeneratingCodingChallenge}
              challengeError={codingChallengeError}
              code={codingCode}
              onCodeChange={setCodingCode}
              onResetCode={handleResetCodingCode}
              onGetSolution={handleGetSolution}
              isGettingSolution={isGettingSolution}
              solutionError={codingSolutionError}
              onRunCode={handleRunCoding}
              isRunningCode={isRunningCode}
              runError={codingRunError}
              runResult={codingRunResult}
            />
          )}
        </div>

        {!isFullscreen && !mode && (
          <p className={`mt-6 text-sm ${t.assistantText}`}>
            Enter a topic, choose MCQ or Code, and click Generate.
          </p>
        )}
      </div>
    </div>
  )
}

export default TestPage
