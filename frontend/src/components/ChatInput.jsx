import { useCallback, useEffect, useRef, useState } from 'react'
import { FiArrowUp, FiCheck, FiChevronDown, FiCornerDownLeft, FiCpu, FiFile, FiImage, FiPaperclip, FiSquare, FiX } from 'react-icons/fi'
import { useTheme } from '../context/ThemeContext.jsx'

function formatDuration(seconds) {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

function pickSupportedRecordingMimeType() {
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/mp4',
    'audio/ogg;codecs=opus',
    'audio/ogg',
  ]

  for (const type of candidates) {
    if (MediaRecorder.isTypeSupported(type)) {
      return type
    }
  }

  return ''
}

const MODELS = [
  { id: 'gemini-3.5-flash', label: 'Gemini 3.5 Flash', badge: 'Google', desc: 'Fast multimodal reasoning' },
  { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', badge: 'Google', desc: 'Lightweight & responsive' },
  { id: 'nvidia-llama-3.1-70b', label: 'Llama 3.1 70B Instruct', badge: 'NVIDIA', desc: 'High-accuracy reasoning & coding' },
  { id: 'nvidia-llama-3.1-8b', label: 'Llama 3.1 8B Instruct', badge: 'NVIDIA', desc: 'Ultra-fast low latency assistant' },
  { id: 'nvidia-llama-3.2-11b-vision', label: 'Llama 3.2 11B Vision', badge: 'NVIDIA', desc: 'Multimodal vision & text understanding' },
  { id: 'nvidia-llama-3.3-nemotron', label: 'Nemotron 49B Super', badge: 'NVIDIA', desc: 'Advanced reasoning by NVIDIA' },
  { id: 'nvidia-mistral-nemotron', label: 'Mistral Nemotron', badge: 'NVIDIA', desc: 'Fast & precise instruction following' },
  { id: 'nvidia-nemotron-mini-4b', label: 'Nemotron Mini 4B', badge: 'NVIDIA', desc: 'Compact lightning-fast helper' },
]

function ChatInput({
  placeholder = 'Ask anything or paste code...',
  showAddButton = false,
  containerClassName = '',
  inputClassName = '',
  buttonClassName = '',
  value = '',
  onChange,
  onSubmit,
  selectedModelId,
  onModelChange,
  audioFile,
  onAudioRecorded,
  onRemoveAudio,
  attachedFiles = [],
  onFilesAttached,
  onRemoveFile,
}) {
  const fileInputRef = useRef(null)
  const [isDragOver, setIsDragOver] = useState(false)
  const { t } = useTheme()
  const buttonClass = buttonClassName || t.inputBtn
  const selectedModel = MODELS.find((model) => model.id === selectedModelId) || MODELS[0]
  const [open, setOpen] = useState(false)
  const dropdownRef = useRef(null)

  // Recording state
  const [isRecording, setIsRecording] = useState(false)
  const [recordingSeconds, setRecordingSeconds] = useState(0)
  const mediaRecorderRef = useRef(null)
  const chunksRef = useRef([])
  const timerRef = useRef(null)
  const recordingSecondsRef = useRef(0)

  useEffect(() => { recordingSecondsRef.current = recordingSeconds }, [recordingSeconds])

  const stopRecording = useCallback(() => {
    mediaRecorderRef.current?.stop()
    clearInterval(timerRef.current)
  }, [])

  const cancelRecording = useCallback(() => {
    chunksRef.current = []
    mediaRecorderRef.current?.stop()
    clearInterval(timerRef.current)
    setIsRecording(false)
    setRecordingSeconds(0)
  }, [])

  const toggleRecording = useCallback(async () => {
    if (isRecording) {
      stopRecording()
      return
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      chunksRef.current = []
      setRecordingSeconds(0)

      const mimeType = pickSupportedRecordingMimeType()
      const recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream)

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data)
      }

      recorder.onstop = () => {
        stream.getTracks().forEach((track) => track.stop())
        if (chunksRef.current.length === 0) {
          setIsRecording(false)
          return
        }
        const resolvedMimeType = mimeType || recorder.mimeType || 'audio/webm'
        const blob = new Blob(chunksRef.current, { type: resolvedMimeType })
        const url = URL.createObjectURL(blob)
        onAudioRecorded?.({ blob, url, mimeType: resolvedMimeType, duration: recordingSecondsRef.current })
        setIsRecording(false)
        clearInterval(timerRef.current)
      }

      mediaRecorderRef.current = recorder
      recorder.start(100)
      setIsRecording(true)

      timerRef.current = setInterval(() => setRecordingSeconds((s) => s + 1), 1000)
    } catch (err) {
      console.error('Microphone access denied:', err)
      alert('Microphone access was denied. Please allow microphone access and try again.')
    }
  }, [isRecording, stopRecording, onAudioRecorded])

  // Cleanup on unmount
  useEffect(() => () => {
    mediaRecorderRef.current?.stop()
    clearInterval(timerRef.current)
  }, [])

  useEffect(() => {
    const handler = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const handleFileChange = (e) => {
    const files = Array.from(e.target.files || [])
    if (files.length) onFilesAttached?.(files)
    e.target.value = ''
  }

  const handleDragOver = (e) => {
    e.preventDefault()
    setIsDragOver(true)
  }

  const handleDragLeave = (e) => {
    e.preventDefault()
    setIsDragOver(false)
  }

  const handleDrop = (e) => {
    e.preventDefault()
    setIsDragOver(false)
    const files = Array.from(e.dataTransfer.files || [])
    if (files.length) onFilesAttached?.(files)
  }

  const getFileIcon = (file) => {
    if (file.type?.startsWith('image/')) return <FiImage className="h-4 w-4" />
    return <FiFile className="h-4 w-4" />
  }

  const canSubmit = !!value.trim() || attachedFiles.length > 0 || Boolean(audioFile)

  const handleKeyDown = (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      if (canSubmit) onSubmit?.()
    }
  }

  return (
    <div
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={`relative flex w-full flex-col gap-2.5 rounded-3xl border transition-all duration-300 px-4.5 pb-3.5 pt-4 shadow-md backdrop-blur-md overflow-visible ${
        isDragOver ? 'ring-2 ring-teal-500 border-teal-400 bg-teal-50/90 dark:bg-teal-950/40' : ''
      } ${containerClassName}`}
    >
      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept="image/*,application/pdf,.doc,.docx,.txt,.csv,.xls,.xlsx,.ppt,.pptx"
        className="hidden"
        onChange={handleFileChange}
      />

      {/* File attachment chips */}
      {attachedFiles.length > 0 && (
        <div className="flex flex-wrap gap-2 animate-fade-in">
          {attachedFiles.map((file, i) => (
            <div
              key={i}
              className="flex items-center gap-2 rounded-xl border border-teal-500/20 bg-white/80 dark:bg-slate-800/80 px-2.5 py-1.5 shadow-xs backdrop-blur-xs transition-all hover:scale-[1.02]"
            >
              {file.type?.startsWith('image/') ? (
                <img
                  src={URL.createObjectURL(file)}
                  alt={file.name}
                  className="h-6 w-6 rounded-md object-cover shrink-0 ring-1 ring-teal-500/30"
                />
              ) : (
                <span className="text-teal-600 dark:text-teal-400">{getFileIcon(file)}</span>
              )}
              <span className="max-w-36 truncate text-xs font-medium text-slate-700 dark:text-slate-200">
                {file.name}
              </span>
              <button
                onClick={() => onRemoveFile?.(i)}
                className="rounded-full p-1 text-slate-400 hover:bg-rose-100 hover:text-rose-600 dark:hover:bg-rose-950/60 dark:hover:text-rose-400 transition"
                title="Remove file"
              >
                <FiX className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Audio attachment chip */}
      {audioFile && (
        <div className="flex items-center gap-3 rounded-2xl border border-teal-500/20 bg-linear-to-r from-teal-50/80 to-cyan-50/80 dark:from-slate-800/90 dark:to-slate-800/70 p-2.5 shadow-xs animate-fade-in">
          <div className="flex flex-1 items-center gap-3 min-w-0">
            <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-teal-500 text-white shadow-xs">
              <FiMic className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-semibold text-slate-800 dark:text-slate-200">Voice Note Attached</p>
              <p className="text-[11px] text-teal-600 dark:text-teal-400">{formatDuration(audioFile.duration ?? 0)} duration</p>
            </div>
            <audio controls className="h-7 max-w-44 shrink-0 rounded-lg" style={{ accentColor: '#14b8a6' }}>
              <source src={audioFile.url} type={audioFile.mimeType} />
            </audio>
          </div>
          <button
            onClick={onRemoveAudio}
            className="shrink-0 rounded-full p-1.5 text-slate-400 hover:bg-rose-100 hover:text-rose-600 dark:hover:bg-rose-950/60 dark:hover:text-rose-400 transition"
            title="Remove recording"
          >
            <FiX className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Active Live Audio Recording UI */}
      {isRecording ? (
        <div className="flex items-center justify-between rounded-2xl border border-red-200 bg-red-50/80 dark:border-red-900/40 dark:bg-red-950/30 px-4 py-3 animate-fade-in">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1">
              <span className="waveform-bar h-2"></span>
              <span className="waveform-bar h-4"></span>
              <span className="waveform-bar h-6"></span>
              <span className="waveform-bar h-3"></span>
              <span className="waveform-bar h-5"></span>
              <span className="waveform-bar h-2"></span>
            </div>
            <span className="text-xs font-semibold text-red-600 dark:text-red-400">
              Recording Voice... {formatDuration(recordingSeconds)}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={cancelRecording}
              className="rounded-xl px-2.5 py-1 text-xs font-medium text-slate-500 hover:bg-slate-200/60 dark:hover:bg-slate-800 transition"
            >
              Cancel
            </button>
            <button
              onClick={stopRecording}
              className="flex items-center gap-1.5 rounded-xl bg-red-600 px-3 py-1.5 text-xs font-semibold text-white shadow-xs hover:bg-red-700 active:scale-95 transition"
            >
              <FiSquare className="h-3 w-3 fill-current" />
              Done
            </button>
          </div>
        </div>
      ) : (
        <div className="relative flex items-center">
          <input
            type="text"
            placeholder={placeholder}
            value={value}
            onChange={onChange}
            onKeyDown={handleKeyDown}
            className={`w-full min-w-0 bg-transparent text-sm text-slate-900 dark:text-slate-100 outline-none placeholder:text-slate-400 dark:placeholder:text-slate-500 ${inputClassName}`}
          />
        </div>
      )}

      {/* Control bar */}
      <div className="flex items-center justify-between pt-1">
        <div className="flex items-center gap-2">
          {showAddButton && (
            <button
              onClick={() => fileInputRef.current?.click()}
              title="Attach documents, images or code"
              className={`grid h-8.5 w-8.5 place-items-center rounded-xl transition-all duration-200 hover:scale-105 active:scale-95 ${t.inputBtnBg} ${buttonClass}`}
            >
              <FiPaperclip className="h-4 w-4" />
            </button>
          )}

          {/* Model selector dropdown */}
          <div className="relative" ref={dropdownRef}>
            <button
              onClick={() => setOpen((prev) => !prev)}
              className={`flex items-center gap-2 rounded-xl px-3 py-1.5 text-xs font-semibold transition-all duration-200 hover:scale-[1.02] active:scale-[0.98] border border-teal-500/10 ${t.inputBtnBg} ${buttonClass}`}
            >
              <FiCpu className="h-3.5 w-3.5 text-teal-600 dark:text-teal-400" />
              <span>{selectedModel.label}</span>
              <FiChevronDown className={`h-3 w-3 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
            </button>

            {open && (
              <div className={`absolute bottom-full left-0 mb-2 w-64 rounded-2xl border p-1.5 shadow-xl z-50 animate-slide-up backdrop-blur-md ${t.inputDropdownBg}`}>
                <div className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                  Select AI Engine
                </div>
                {MODELS.map((model) => {
                  const isSelected = selectedModel.id === model.id
                  return (
                    <button
                      key={model.id}
                      onClick={() => {
                        onModelChange?.(model.id)
                        setOpen(false)
                      }}
                      className={`flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-xs transition-all duration-150 ${
                        isSelected ? t.inputDropdownActive : t.inputDropdownItem
                      }`}
                    >
                      <div className="flex flex-col min-w-0 pr-2">
                        <div className="flex items-center gap-1.5">
                          <span className="font-semibold">{model.label}</span>
                          {isSelected && <FiCheck className="h-3.5 w-3.5 text-teal-500 shrink-0" />}
                        </div>
                        <span className="text-[10px] text-slate-400 truncate">{model.desc}</span>
                      </div>
                      <span className={`rounded-lg px-2 py-0.5 text-[10px] font-medium shrink-0 ${t.inputDropdownBadge}`}>
                        {model.badge}
                      </span>
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Keyboard hint */}
          <span className="hidden sm:flex items-center gap-1 text-[11px] text-slate-400 font-medium select-none pr-1">
            <span>Press</span>
            <kbd className="rounded border border-slate-300 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 px-1 py-0.5 text-[10px] font-mono">
              <FiCornerDownLeft className="inline h-2.5 w-2.5" />
            </kbd>
          </span>

          {/* Send button */}
          <button
            onClick={onSubmit}
            disabled={!canSubmit}
            className={`grid h-8.5 w-8.5 place-items-center rounded-xl transition-all duration-200 ${
              canSubmit
                ? 'bg-linear-to-tr from-teal-600 to-teal-500 text-white shadow-md shadow-teal-500/25 hover:scale-105 active:scale-95 hover:from-teal-500 hover:to-teal-400 cursor-pointer'
                : 'bg-slate-200 dark:bg-slate-800 text-slate-400 cursor-not-allowed'
            }`}
            aria-label="Send message"
            title="Send message"
          >
            <FiArrowUp className="h-4 w-4 stroke-[2.5]" />
          </button>
        </div>
      </div>
    </div>
  )
}

export default ChatInput
