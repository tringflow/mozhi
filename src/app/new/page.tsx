"use client";

import { useState, useEffect } from "react";
import {
  Upload,
  Copy,
  Check,
  Edit2,
  Save,
  Loader2,
  ArrowRight,
  FileAudio,
  Trash2,
  FileText,
} from "lucide-react";
import { mozhiService } from "../../services/mozhi";
import { cn } from "../../../lib/utils";
import { validateAudioFile } from "../../lib/audio";
import { getErrorMessage } from "../../lib/errors";
import { LANGUAGES, LANGUAGE_LIST, DEFAULT_LANGUAGE, type LanguageId } from "../../lib/languages";

type PipelineStep = "idle" | "uploading" | "transcribing" | "translating" | "saving" | "completed" | "error";

export default function NewTranslation() {
  // Audio states
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [audioDuration, setAudioDuration] = useState<number>(0);

  // Selected source language
  const [language, setLanguage] = useState<LanguageId>(DEFAULT_LANGUAGE);
  const lang = LANGUAGES[language];

  // Pipeline execution states
  const [pipelineStep, setPipelineStep] = useState<PipelineStep>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  // Non-blocking: processing succeeded but the result couldn't be persisted
  const [saveWarning, setSaveWarning] = useState<string | null>(null);
  // Non-blocking: saved to history, but the original audio file wasn't stored
  const [audioWarning, setAudioWarning] = useState<string | null>(null);

  // Result states
  const [sourceText, setSourceText] = useState("");
  const [englishText, setEnglishText] = useState("");
  const [isEditingSource, setIsEditingSource] = useState(false);
  const [copiedSource, setCopiedSource] = useState(false);
  const [copiedEnglish, setCopiedEnglish] = useState(false);

  // Cleanup audio preview URL when component unmounts
  useEffect(() => {
    return () => {
      if (audioUrl) URL.revokeObjectURL(audioUrl);
    };
  }, [audioUrl]);

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.round(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  // Handle File Upload Select
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setErrorMessage(null);

    // Same size/format rules the API enforces (src/lib/audio.ts)
    const invalid = validateAudioFile(file);
    if (invalid) {
      setErrorMessage(invalid);
      return;
    }

    setAudioFile(file);
    const url = URL.createObjectURL(file);
    setAudioUrl(url);

    // Estimate duration using temporary Audio element
    const tempAudio = new Audio(url);
    tempAudio.onloadedmetadata = () => {
      // Some containers (e.g. MediaRecorder webm) report Infinity/NaN until fully read.
      setAudioDuration(Number.isFinite(tempAudio.duration) ? tempAudio.duration : 0);
    };
  };

  // Execute end-to-end Translation pipeline
  const processPipeline = async () => {
    if (!audioFile) return;
    setErrorMessage(null);
    setSaveWarning(null);
    setAudioWarning(null);
    setSourceText("");
    setEnglishText("");

    try {
      // Step 1: Transcribing
      setPipelineStep("transcribing");
      const transcribeResult = await mozhiService.transcribeAudio(audioFile, language);

      let finalSourceText = "";
      let finalEnglishText = "";

      if (transcribeResult.isAsync && transcribeResult.jobId && transcribeResult.filename) {
        // Start polling status
        let isDone = false;
        let attempts = 0;
        let consecutiveErrors = 0;
        const maxAttempts = 200; // 200 * 3s = 10 minutes max
        const maxConsecutiveErrors = 3; // tolerate brief network/server blips; the job keeps running

        while (!isDone && attempts < maxAttempts) {
          attempts++;
          await new Promise((resolve) => setTimeout(resolve, 3000));

          let statusResult;
          try {
            statusResult = await mozhiService.checkBatchStatus(
              transcribeResult.jobId,
              transcribeResult.filename,
              language
            );
            consecutiveErrors = 0;
          } catch (pollErr) {
            consecutiveErrors++;
            console.warn(`Status poll failed (${consecutiveErrors}/${maxConsecutiveErrors}):`, pollErr);
            if (consecutiveErrors >= maxConsecutiveErrors) throw pollErr;
            continue;
          }

          if (statusResult.status === "completed") {
            finalSourceText = statusResult.transcription || "";
            finalEnglishText = statusResult.translation || "";
            isDone = true;
          } else if (statusResult.status === "failed") {
            throw new Error(statusResult.error || "Sarvam asynchronous speech processing failed.");
          }
        }

        if (!isDone) {
          throw new Error("Speech transcription timed out after 10 minutes. Please try again or use a shorter file.");
        }
      } else {
        // Sync STT succeeded
        finalSourceText = transcribeResult.transcription || "";

        // Step 2: Translating
        setPipelineStep("translating");
        finalEnglishText = await mozhiService.translateText(finalSourceText, language);
      }

      setSourceText(finalSourceText);
      setEnglishText(finalEnglishText);

      // Step 3: Saving to Supabase (Audio Storage + Postgres Table).
      // The result is already on screen; a failure here must not discard it.
      setPipelineStep("saving");
      try {
        const saved = await mozhiService.saveTranslation(
          audioFile,
          language,
          finalSourceText,
          finalEnglishText,
          audioDuration,
          audioFile.name
        );
        if (!saved.audio_url) {
          console.warn("Saved to history without original audio (storage unavailable).");
          setAudioWarning("Saved to history, but the original audio couldn't be stored.");
        }
      } catch (saveErr) {
        console.warn("Saving to history failed:", saveErr);
        setSaveWarning("Translation completed, but it couldn't be saved to history.");
      }

      setPipelineStep("completed");
    } catch (err) {
      console.error("Pipeline failure:", err);
      setErrorMessage(getErrorMessage(err, "An unexpected error occurred in the transcription pipeline."));
      setPipelineStep("error");
    }
  };

  const handleCopy = (text: string, type: "source" | "english") => {
    navigator.clipboard.writeText(text);
    if (type === "source") {
      setCopiedSource(true);
      setTimeout(() => setCopiedSource(false), 2000);
    } else {
      setCopiedEnglish(true);
      setTimeout(() => setCopiedEnglish(false), 2000);
    }
  };

  const resetForm = () => {
    setAudioFile(null);
    if (audioUrl) {
      URL.revokeObjectURL(audioUrl);
      setAudioUrl(null);
    }
    setAudioDuration(0);
    setSourceText("");
    setEnglishText("");
    setPipelineStep("idle");
    setErrorMessage(null);
    setSaveWarning(null);
    setAudioWarning(null);
  };

  const isBusy = pipelineStep !== "idle" && pipelineStep !== "error" && pipelineStep !== "completed";
  const canPickFile = pipelineStep === "idle" || pipelineStep === "error";
  const hasResult = pipelineStep === "completed" || !!sourceText;

  type StepState = "pending" | "active" | "done";
  const order: PipelineStep[] = ["transcribing", "translating", "saving", "completed"];
  const stepState = (index: number): StepState => {
    const current = order.indexOf(pipelineStep);
    if (pipelineStep === "completed") return "done";
    if (current === -1) return "pending";
    if (index < current) return "done";
    return index === current ? "active" : "pending";
  };

  const steps = [
    {
      name: "Speech Recognition",
      status: {
        pending: "Pending",
        active: `Transcribing ${lang.name}...`,
        done: `${lang.name} transcribed`,
      },
    },
    {
      name: "Translation",
      status: { pending: "Pending", active: "Translating to English...", done: "English ready" },
    },
    {
      name: "Save to Database",
      status: {
        pending: "Pending",
        active: "Saving to history...",
        done: saveWarning ? "Could not save" : "Saved to history",
      },
    },
    {
      name: "Complete",
      status: { pending: "Pending", active: "Finishing...", done: "Completed" },
    },
  ];

  const fileExt = audioFile?.name.split(".").pop()?.toUpperCase();

  return (
    // Desktop: fill the viewport below the header (h-20) and main padding (p-8) so only the transcript bodies scroll.
    <div className="max-w-7xl mx-auto font-sans flex flex-col gap-4 lg:h-[calc(100dvh-9rem)] lg:min-h-[28rem]">
      {/* 1. Compact upload */}
      <section className="shrink-0 p-4 bg-white border border-zinc-150 rounded-2xl dark:bg-zinc-950 dark:border-zinc-900 shadow-sm space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 px-1">
            <span className="flex items-center justify-center w-5 h-5 rounded-full bg-teal-600 text-white text-[10px] font-bold">1</span>
            <h3 className="text-xs font-extrabold text-zinc-400 uppercase tracking-wider">Upload Audio</h3>
          </div>

          <div className="flex items-center gap-1 p-1 bg-zinc-100 dark:bg-zinc-900 rounded-xl" role="radiogroup" aria-label="Audio language">
            {LANGUAGE_LIST.map((l) => (
              <button
                key={l.id}
                type="button"
                role="radio"
                aria-checked={language === l.id}
                disabled={!canPickFile}
                onClick={() => setLanguage(l.id as LanguageId)}
                className={cn(
                  "px-3 py-1.5 rounded-lg text-xs font-bold transition-all disabled:opacity-50",
                  language === l.id
                    ? "bg-white text-teal-700 shadow-sm dark:bg-zinc-950 dark:text-teal-400"
                    : "text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
                )}
              >
                {l.nativeName} · {l.name}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {canPickFile ? (
            <label className="flex items-center gap-2 px-4 py-2.5 bg-zinc-900 hover:bg-zinc-800 text-white dark:bg-white dark:text-black dark:hover:bg-zinc-100 rounded-xl cursor-pointer text-xs font-bold transition-all shadow-sm active:scale-95">
              <Upload className="w-4 h-4" />
              {audioFile ? "Replace File" : "Select Audio File"}
              <input type="file" accept="audio/*" onChange={handleFileChange} className="hidden" />
            </label>
          ) : (
            <button
              onClick={resetForm}
              disabled={isBusy}
              className="flex items-center gap-2 px-4 py-2.5 border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-900 rounded-xl text-xs font-bold text-zinc-700 dark:text-zinc-300 disabled:opacity-50"
            >
              <Upload className="w-4 h-4" />
              New File
            </button>
          )}

          {audioFile ? (
            <>
              <div className="flex items-center gap-3 min-w-0 px-3 py-2 bg-zinc-50 dark:bg-zinc-900/40 rounded-xl border border-zinc-100 dark:border-zinc-900">
                <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-teal-50 text-teal-600 dark:bg-teal-950/20 dark:text-teal-400 flex-shrink-0">
                  <FileAudio className="w-4 h-4" />
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-bold text-zinc-900 dark:text-white truncate font-mono max-w-[14rem]">{audioFile.name}</p>
                  <p className="text-[10px] text-zinc-400 uppercase tracking-wider">
                    {(audioFile.size / (1024 * 1024)).toFixed(1)} MB • {fileExt} • {formatTime(audioDuration)}
                  </p>
                </div>
                <span className="hidden sm:flex items-center gap-1 px-2.5 py-1 text-[10px] font-bold rounded-full bg-teal-50 text-teal-700 border border-teal-100 dark:bg-teal-950/20 dark:text-teal-400 dark:border-teal-900/60">
                  <Check className="w-3 h-3" /> Uploaded
                </span>
              </div>

              {audioUrl && <audio src={audioUrl} controls className="h-8 flex-1 min-w-[12rem]" />}

              {canPickFile && (
                <button
                  onClick={processPipeline}
                  className="ml-auto flex items-center justify-center gap-2 px-4 py-2.5 bg-zinc-900 hover:bg-zinc-800 text-white dark:bg-white dark:text-black dark:hover:bg-zinc-100 font-bold rounded-xl shadow-sm text-xs active:scale-95 transition-all"
                >
                  Start Transcription & Translation <ArrowRight className="w-4 h-4" />
                </button>
              )}
              {pipelineStep === "completed" && (
                <button
                  onClick={resetForm}
                  className="ml-auto p-2.5 border border-zinc-200 dark:border-zinc-800 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/20 rounded-xl text-zinc-500 transition-colors"
                  title="Clear"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
            </>
          ) : (
            <p className="text-xs text-zinc-400">MP3, WAV, M4A, or WEBM up to 25MB.</p>
          )}
        </div>

        {saveWarning && (
          <div className="px-3 py-2 bg-amber-50 text-amber-800 border border-amber-200 rounded-xl dark:bg-amber-950/30 dark:text-amber-400 dark:border-amber-900/50 text-xs" role="status">
            <span className="font-bold">Not saved to history. </span>
            <span className="opacity-90">{saveWarning}</span>
          </div>
        )}
        {audioWarning && (
          <div className="px-3 py-2 bg-amber-50 text-amber-800 border border-amber-200 rounded-xl dark:bg-amber-950/30 dark:text-amber-400 dark:border-amber-900/50 text-xs" role="status">
            <span className="font-bold">Audio not stored. </span>
            <span className="opacity-90">{audioWarning}</span>
          </div>
        )}
        {errorMessage && (
          <div className="px-3 py-2 bg-red-50 text-red-700 border border-red-200 rounded-xl dark:bg-red-950/30 dark:text-red-400 dark:border-red-900/50 text-xs">
            <span className="font-bold">Execution Failed. </span>
            <span className="opacity-90">{errorMessage}</span>
          </div>
        )}
      </section>

      {/* 2. Horizontal processing stepper */}
      <section className="shrink-0 px-5 py-4 bg-white border border-zinc-150 rounded-2xl dark:bg-zinc-950 dark:border-zinc-900 shadow-sm">
        <div className="grid grid-cols-2 gap-4 sm:flex sm:items-start sm:gap-3">
          {steps.map((step, index) => {
            const state = stepState(index);
            return (
              <div key={step.name} className="contents">
                <div className="flex items-start gap-3 min-w-0">
                  <div className={cn(
                    "flex items-center justify-center w-8 h-8 rounded-full font-bold text-xs shadow-sm flex-shrink-0",
                    state === "active"
                      ? "bg-teal-50 text-teal-600 dark:bg-teal-950/20 dark:text-teal-400 animate-pulse border border-teal-200 dark:border-teal-900"
                      : state === "done"
                      ? "bg-teal-50 text-teal-600 dark:bg-teal-950/20 dark:text-teal-400"
                      : "bg-zinc-50 text-zinc-400 dark:bg-zinc-900 dark:text-zinc-600"
                  )}>
                    {state === "done" ? (
                      <Check className="w-4 h-4 text-teal-600" />
                    ) : state === "active" ? (
                      <Loader2 className="w-4 h-4 animate-spin text-teal-600" />
                    ) : (
                      index + 1
                    )}
                  </div>
                  <div className="min-w-0 mt-0.5">
                    <h4 className="text-xs font-bold text-zinc-900 dark:text-white truncate">{step.name}</h4>
                    <p className="text-[10px] text-zinc-400 truncate">{step.status[state]}</p>
                  </div>
                </div>
                {index < steps.length - 1 && (
                  <div className="hidden sm:block flex-1 mt-4 border-t-2 border-dashed border-zinc-200 dark:border-zinc-800" />
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* 3. Source transcript | English translation (equal cards, internal scroll) */}
      <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-2 lg:grid-rows-[minmax(0,1fr)] gap-4">
        {/* Source-language Transcription Card */}
        <div className="flex flex-col min-h-0 h-80 lg:h-auto bg-white border border-zinc-150 rounded-2xl dark:bg-zinc-950 dark:border-zinc-900 overflow-hidden shadow-sm">
          <div className="shrink-0 flex items-center justify-between px-5 py-3.5 border-b border-zinc-100 dark:border-zinc-900 bg-zinc-50/50 dark:bg-zinc-900/20">
            <div className="flex items-center gap-2 min-w-0">
              <h4 className="text-xs font-bold text-zinc-900 dark:text-white truncate">{lang.name} Transcript</h4>
              <span className="px-2 py-0.5 text-[10px] font-bold rounded bg-teal-50 text-teal-700 dark:bg-teal-950/20 dark:text-teal-400 whitespace-nowrap">
                {lang.nativeName} ({lang.code})
              </span>
            </div>
            {hasResult && (
              <div className="flex items-center gap-1">
                <button
                  onClick={() => handleCopy(sourceText, "source")}
                  className="p-1.5 hover:bg-zinc-100 text-zinc-400 hover:text-zinc-755 rounded-lg dark:hover:bg-zinc-900 transition-colors"
                  title={`Copy ${lang.name}`}
                >
                  {copiedSource ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
                </button>
                <button
                  onClick={() => setIsEditingSource(!isEditingSource)}
                  className="p-1.5 hover:bg-zinc-100 text-zinc-400 hover:text-zinc-755 rounded-lg dark:hover:bg-zinc-900 transition-colors"
                  title={isEditingSource ? "Save changes" : `Edit ${lang.name}`}
                >
                  {isEditingSource ? <Save className="w-4 h-4 text-emerald-600" /> : <Edit2 className="w-4 h-4" />}
                </button>
              </div>
            )}
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto p-5 flex flex-col">
            {!hasResult ? (
              <Placeholder />
            ) : isEditingSource ? (
              <textarea
                value={sourceText}
                onChange={(e) => setSourceText(e.target.value)}
                className="w-full flex-1 min-h-[120px] p-2.5 border border-zinc-200 dark:border-zinc-800 rounded-xl focus:outline-none focus:ring-1 focus:ring-teal-500 text-sm leading-relaxed text-zinc-900 dark:bg-zinc-900 dark:text-white"
              />
            ) : (
              <p className="text-zinc-800 dark:text-zinc-200 text-sm leading-relaxed font-semibold font-sans whitespace-pre-wrap">
                {sourceText}
              </p>
            )}
          </div>
        </div>

        {/* English Translation Card */}
        <div className="flex flex-col min-h-0 h-80 lg:h-auto bg-white border border-zinc-150 rounded-2xl dark:bg-zinc-950 dark:border-zinc-900 overflow-hidden shadow-sm">
          <div className="shrink-0 flex items-center justify-between px-5 py-3.5 border-b border-zinc-100 dark:border-zinc-900 bg-zinc-50/50 dark:bg-zinc-900/20">
            <div className="flex items-center gap-2 min-w-0">
              <h4 className="text-xs font-bold text-zinc-900 dark:text-white truncate">English Translation</h4>
              <span className="px-2 py-0.5 text-[10px] font-bold rounded bg-blue-50 text-blue-700 dark:bg-blue-950/20 dark:text-blue-400 whitespace-nowrap">
                EN English
              </span>
            </div>
            {hasResult && (
              <button
                onClick={() => handleCopy(englishText, "english")}
                className="p-1.5 hover:bg-zinc-100 text-zinc-400 hover:text-zinc-755 rounded-lg dark:hover:bg-zinc-900 transition-colors"
                title="Copy English"
              >
                {copiedEnglish ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
              </button>
            )}
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto p-5 flex flex-col">
            {!hasResult ? (
              <Placeholder />
            ) : (
              <p className="text-zinc-800 dark:text-zinc-200 text-sm leading-relaxed font-sans whitespace-pre-wrap">
                {englishText}
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Placeholder() {
  return (
    <div className="flex-1 flex flex-col items-center justify-center text-center">
      <div className="w-10 h-10 rounded-full bg-zinc-50 dark:bg-zinc-900/40 flex items-center justify-center mb-3 text-zinc-400">
        <FileText className="w-5 h-5" />
      </div>
      <h4 className="text-sm font-bold text-zinc-900 dark:text-white mb-1">No transcripts generated yet</h4>
      <p className="text-xs text-zinc-400 max-w-[220px]">Upload an audio file and start the engine to view results.</p>
    </div>
  );
}
