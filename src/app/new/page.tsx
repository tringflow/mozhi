"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  Upload,
  Copy,
  Check,
  Edit2,
  Save,
  Loader2,
  Volume2,
  ArrowRight,
  Sparkles,
  FileAudio,
  Trash2,
  CheckCircle2,
  FileText,
  Clock,
  Languages,
  Activity,
} from "lucide-react";
import { mozhiService } from "../../services/mozhi";
import { cn } from "../../../lib/utils";

type PipelineStep = "idle" | "uploading" | "transcribing" | "translating" | "saving" | "completed" | "error";

export default function NewTranslation() {
  const router = useRouter();

  // Audio states
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [audioDuration, setAudioDuration] = useState<number>(0);

  // Pipeline execution states
  const [pipelineStep, setPipelineStep] = useState<PipelineStep>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Result states
  const [tamilText, setTamilText] = useState("");
  const [englishText, setEnglishText] = useState("");
  const [isEditingTamil, setIsEditingTamil] = useState(false);
  const [copiedTamil, setCopiedTamil] = useState(false);
  const [copiedEnglish, setCopiedEnglish] = useState(false);

  // History stats for the top row cards
  const [stats, setStats] = useState({
    totalCount: 0,
    totalDuration: 0,
    avgDuration: 0,
  });

  // Load history stats on mount
  useEffect(() => {
    fetchStats();
  }, []);

  const fetchStats = async () => {
    try {
      const data = await mozhiService.getHistory();
      const count = data.length;
      const duration = data.reduce((acc, curr) => acc + (curr.audio_duration || 0), 0);
      const avg = count > 0 ? duration / count : 0;
      setStats({
        totalCount: count,
        totalDuration: duration,
        avgDuration: avg,
      });
    } catch (err) {
      console.error("Failed to load stats:", err);
    }
  };

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

    // Validate size (max 25MB for audio processing API)
    if (file.size > 25 * 1024 * 1024) {
      setErrorMessage("File exceeds the 25MB size limit.");
      return;
    }

    // Validate file type
    const validExtensions = ["mp3", "wav", "m4a", "webm"];
    const fileExt = file.name.split(".").pop()?.toLowerCase();
    if (!fileExt || !validExtensions.includes(fileExt)) {
      setErrorMessage("Unsupported format. Please upload MP3, WAV, M4A, or WEBM.");
      return;
    }

    setAudioFile(file);
    const url = URL.createObjectURL(file);
    setAudioUrl(url);

    // Estimate duration using temporary Audio element
    const tempAudio = new Audio(url);
    tempAudio.onloadedmetadata = () => {
      setAudioDuration(tempAudio.duration);
    };
  };

  // Execute end-to-end Translation pipeline
  const processPipeline = async () => {
    if (!audioFile) return;
    setErrorMessage(null);
    setTamilText("");
    setEnglishText("");

    try {
      // Step 1: Transcribing
      setPipelineStep("transcribing");
      const transcribeResult = await mozhiService.transcribeAudio(audioFile);

      let finalTamilText = "";
      let finalEnglishText = "";

      if (transcribeResult.isAsync && transcribeResult.jobId && transcribeResult.filename) {
        console.log("Async job started:", transcribeResult.jobId);

        // Start polling status
        let isDone = false;
        let attempts = 0;
        const maxAttempts = 60; // 60 * 3s = 180s (3 minutes max)

        while (!isDone && attempts < maxAttempts) {
          attempts++;
          await new Promise((resolve) => setTimeout(resolve, 3000));

          const statusResult = await mozhiService.checkBatchStatus(
            transcribeResult.jobId,
            transcribeResult.filename
          );

          if (statusResult.status === "completed") {
            finalTamilText = statusResult.transcription || "";
            finalEnglishText = statusResult.translation || "";
            isDone = true;
          } else if (statusResult.status === "failed") {
            throw new Error(statusResult.error || "Sarvam asynchronous speech processing failed.");
          }
        }

        if (!isDone) {
          throw new Error("Speech transcription timed out. The file was too long or processing failed.");
        }
      } else {
        // Sync STT succeeded
        finalTamilText = transcribeResult.tamilText || "";

        // Step 2: Translating
        setPipelineStep("translating");
        finalEnglishText = await mozhiService.translateText(finalTamilText);
      }

      setTamilText(finalTamilText);
      setEnglishText(finalEnglishText);

      // Step 3: Saving to Supabase (Audio Storage + Postgres Table)
      setPipelineStep("saving");
      await mozhiService.saveTranslation(
        audioFile,
        finalTamilText,
        finalEnglishText,
        audioDuration,
        audioFile.name
      );

      setPipelineStep("completed");
      // Refresh stats
      fetchStats();
    } catch (err: any) {
      console.error("Pipeline failure:", err);
      setErrorMessage(err.message || "An unexpected error occurred in the transcription pipeline.");
      setPipelineStep("error");
    }
  };

  const handleCopy = (text: string, type: "tamil" | "english") => {
    navigator.clipboard.writeText(text);
    if (type === "tamil") {
      setCopiedTamil(true);
      setTimeout(() => setCopiedTamil(false), 2000);
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
    setTamilText("");
    setEnglishText("");
    setPipelineStep("idle");
    setErrorMessage(null);
  };

  return (
    <div className="max-w-7xl mx-auto space-y-8 font-sans">
      {/* 4 Stats Cards (Inspired by top row of the reference image) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        <div className="p-5 bg-white border border-zinc-150 rounded-2xl dark:bg-zinc-950 dark:border-zinc-900 shadow-sm flex items-center gap-4">
          <div className="flex items-center justify-center w-12 h-12 rounded-xl bg-teal-50 text-teal-600 dark:bg-teal-950/20 dark:text-teal-400">
            <FileText className="w-6 h-6" />
          </div>
          <div>
            <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">Total Processed</p>
            <h4 className="text-xl font-extrabold text-zinc-900 dark:text-white mt-0.5">{stats.totalCount} files</h4>
          </div>
        </div>

        <div className="p-5 bg-white border border-zinc-150 rounded-2xl dark:bg-zinc-950 dark:border-zinc-900 shadow-sm flex items-center gap-4">
          <div className="flex items-center justify-center w-12 h-12 rounded-xl bg-teal-50 text-teal-600 dark:bg-teal-950/20 dark:text-teal-400">
            <Languages className="w-6 h-6" />
          </div>
          <div>
            <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">Detected Language</p>
            <h4 className="text-xl font-extrabold text-zinc-900 dark:text-white mt-0.5">Tamil (ta-IN)</h4>
          </div>
        </div>

        <div className="p-5 bg-white border border-zinc-150 rounded-2xl dark:bg-zinc-950 dark:border-zinc-900 shadow-sm flex items-center gap-4">
          <div className="flex items-center justify-center w-12 h-12 rounded-xl bg-teal-50 text-teal-600 dark:bg-teal-950/20 dark:text-teal-400">
            <Clock className="w-6 h-6" />
          </div>
          <div>
            <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">Total Duration</p>
            <h4 className="text-xl font-extrabold text-zinc-900 dark:text-white mt-0.5">{formatTime(stats.totalDuration)}</h4>
          </div>
        </div>

        <div className="p-5 bg-white border border-zinc-150 rounded-2xl dark:bg-zinc-950 dark:border-zinc-900 shadow-sm flex items-center gap-4">
          <div className="flex items-center justify-center w-12 h-12 rounded-xl bg-teal-50 text-teal-600 dark:bg-teal-950/20 dark:text-teal-400">
            <Activity className="w-6 h-6" />
          </div>
          <div>
            <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">Avg Audio Length</p>
            <h4 className="text-xl font-extrabold text-zinc-900 dark:text-white mt-0.5">{formatTime(stats.avgDuration)}</h4>
          </div>
        </div>
      </div>

      {/* Main 3-Column Interface Layout (matching 1. Upload, 2. Processing, 3. Transcripts) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* Column 1: Upload Audio (Span 4) */}
        <div className="lg:col-span-4 space-y-4">
          <div className="flex items-center gap-2 px-1">
            <span className="flex items-center justify-center w-5 h-5 rounded-full bg-teal-600 text-white text-[10px] font-bold">1</span>
            <h3 className="text-xs font-extrabold text-zinc-400 uppercase tracking-wider">Upload Audio</h3>
          </div>

          {pipelineStep === "idle" || pipelineStep === "error" ? (
            <div className="p-6 bg-white border border-dashed border-zinc-200 rounded-2xl dark:bg-zinc-950 dark:border-zinc-900 shadow-sm text-center flex flex-col items-center justify-center min-h-[300px]">
              <div className="w-12 h-12 rounded-full bg-teal-50 dark:bg-teal-950/30 flex items-center justify-center mb-4 text-teal-600">
                <Upload className="w-6 h-6" />
              </div>
              <h4 className="text-sm font-bold text-zinc-900 dark:text-white mb-1.5">Drag & Drop or Select file</h4>
              <p className="text-xs text-zinc-400 max-w-[200px] mb-6">Supports MP3, WAV, M4A, or WEBM up to 25MB.</p>

              <label className="px-5 py-2.5 bg-zinc-900 hover:bg-zinc-800 text-white dark:bg-white dark:text-black dark:hover:bg-zinc-100 rounded-xl cursor-pointer text-xs font-bold transition-all shadow-sm active:scale-95">
                Select Audio File
                <input
                  type="file"
                  accept="audio/*"
                  onChange={handleFileChange}
                  className="hidden"
                />
              </label>
            </div>
          ) : (
            /* Selected File / Uploaded Details view card */
            <div className="p-5 bg-white border border-zinc-150 rounded-2xl dark:bg-zinc-950 dark:border-zinc-900 shadow-sm space-y-5">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1 px-2.5 py-1 text-[10px] font-bold rounded-full bg-teal-50 text-teal-700 border border-teal-100 dark:bg-teal-950/20 dark:text-teal-400 dark:border-teal-900/60">
                  <Check className="w-3 h-3" /> Uploaded
                </span>
                <span className="text-[10px] font-bold text-teal-600 dark:text-teal-400">100%</span>
              </div>

              {/* File Info Box */}
              <div className="flex items-start gap-3.5 p-3.5 bg-zinc-50 dark:bg-zinc-900/40 rounded-xl border border-zinc-100 dark:border-zinc-900">
                <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-teal-50 text-teal-600 dark:bg-teal-950/20 dark:text-teal-400 flex-shrink-0">
                  <FileAudio className="w-5 h-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-bold text-zinc-900 dark:text-white truncate font-mono">{audioFile?.name}</p>
                  <p className="text-[10px] text-zinc-400 uppercase tracking-wider mt-0.5">
                    {audioFile ? `${(audioFile.size / (1024 * 1024)).toFixed(1)} MB` : "0 MB"} • {audioFile?.name.split(".").pop()?.toUpperCase()}
                  </p>
                </div>
              </div>

              {/* Local HTML Audio Preview */}
              {audioUrl && (
                <div className="w-full">
                  <audio src={audioUrl} controls className="w-full h-8" />
                </div>
              )}

              {/* File Details Lists */}
              <div className="space-y-3 pt-3 border-t border-zinc-100 dark:border-zinc-900 text-[11px]">
                <div className="flex items-center justify-between text-zinc-500">
                  <span>Duration</span>
                  <span className="font-bold text-zinc-800 dark:text-white font-mono">{formatTime(audioDuration)}</span>
                </div>
                <div className="flex items-center justify-between text-zinc-500">
                  <span>Upload Status</span>
                  <span className="font-bold text-emerald-600 dark:text-emerald-400">Success</span>
                </div>
                <div className="flex items-center justify-between text-zinc-500">
                  <span>Format</span>
                  <span className="font-bold text-zinc-800 dark:text-white font-mono uppercase">{audioFile?.name.split(".").pop()}</span>
                </div>
              </div>

              {/* Actions row */}
              <div className="flex items-center gap-3 pt-2">
                <button
                  onClick={resetForm}
                  disabled={pipelineStep !== "completed"}
                  className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-900 rounded-xl text-xs font-bold text-zinc-700 dark:text-zinc-300 disabled:opacity-50"
                >
                  Replace File
                </button>
                <button
                  onClick={resetForm}
                  disabled={pipelineStep !== "completed"}
                  className="p-2.5 border border-zinc-200 dark:border-zinc-800 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/20 rounded-xl text-zinc-500 transition-colors disabled:opacity-50"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}

          {audioFile && (pipelineStep === "idle" || pipelineStep === "error") && (
            <button
              onClick={processPipeline}
              className="w-full flex items-center justify-center gap-2 px-5 py-3 bg-zinc-900 hover:bg-zinc-800 text-white dark:bg-white dark:text-black dark:hover:bg-zinc-100 font-bold rounded-xl shadow-sm text-sm active:scale-95 transition-all"
            >
              Start Transcription & Translation <ArrowRight className="w-4 h-4" />
            </button>
          )}

          {/* Localized specific Error Message Card */}
          {errorMessage && (
            <div className="p-4 bg-red-50 text-red-700 border border-red-200 rounded-xl dark:bg-red-950/30 dark:text-red-400 dark:border-red-900/50 shadow-sm text-xs space-y-1">
              <p className="font-bold">Execution Failed</p>
              <p className="opacity-90">{errorMessage}</p>
            </div>
          )}
        </div>

        {/* Column 2: Processing Engine (Span 4) */}
        <div className="lg:col-span-4 space-y-4">
          <div className="flex items-center gap-2 px-1">
            <span className="flex items-center justify-center w-5 h-5 rounded-full bg-teal-600 text-white text-[10px] font-bold">2</span>
            <h3 className="text-xs font-extrabold text-zinc-400 uppercase tracking-wider">Processing Engine</h3>
          </div>

          <div className="p-6 bg-white border border-zinc-150 rounded-2xl dark:bg-zinc-950 dark:border-zinc-900 shadow-sm space-y-8 min-h-[300px] flex flex-col justify-center">
            {/* Step: Audio Upload status */}
            <div className="flex items-start gap-4 relative">
              <div className="absolute left-4 top-8 bottom-[-24px] w-0.5 border-l-2 border-dashed border-zinc-200 dark:border-zinc-800" />
              <div className={cn(
                "flex items-center justify-center w-8.5 h-8.5 rounded-full z-10 font-bold text-xs shadow-sm flex-shrink-0",
                audioFile
                  ? "bg-teal-50 text-teal-600 dark:bg-teal-950/20 dark:text-teal-400"
                  : "bg-zinc-50 text-zinc-400 dark:bg-zinc-900 dark:text-zinc-600"
              )}>
                {audioFile ? <Check className="w-4 h-4 text-teal-600" /> : "1"}
              </div>
              <div className="space-y-0.5 mt-0.5">
                <h4 className="text-xs font-bold text-zinc-900 dark:text-white">Speech Source Uploaded</h4>
                <p className="text-[10px] text-zinc-400">Audio file selected and loaded</p>
              </div>
            </div>

            {/* Step: Tamil Speech Recognition */}
            <div className="flex items-start gap-4 relative">
              <div className="absolute left-4 top-8 bottom-[-24px] w-0.5 border-l-2 border-dashed border-zinc-200 dark:border-zinc-800" />
              <div className={cn(
                "flex items-center justify-center w-8.5 h-8.5 rounded-full z-10 font-bold text-xs shadow-sm flex-shrink-0",
                pipelineStep === "transcribing"
                  ? "bg-teal-50 text-teal-600 dark:bg-teal-950/20 dark:text-teal-400 animate-pulse border border-teal-200 dark:border-teal-900"
                  : pipelineStep === "translating" || pipelineStep === "saving" || pipelineStep === "completed"
                  ? "bg-teal-50 text-teal-600 dark:bg-teal-950/20 dark:text-teal-400"
                  : "bg-zinc-50 text-zinc-400 dark:bg-zinc-900 dark:text-zinc-600"
              )}>
                {pipelineStep === "translating" || pipelineStep === "saving" || pipelineStep === "completed" ? (
                  <Check className="w-4 h-4 text-teal-600" />
                ) : pipelineStep === "transcribing" ? (
                  <Loader2 className="w-4 h-4 animate-spin text-teal-600" />
                ) : (
                  "2"
                )}
              </div>
              <div className="space-y-0.5 mt-0.5">
                <h4 className="text-xs font-bold text-zinc-900 dark:text-white">Speech Recognition (Sarvam)</h4>
                <p className="text-[10px] text-zinc-400">
                  {pipelineStep === "transcribing" ? "Transcribing Tamil speech Unicode..." : "Tamil transcription complete"}
                </p>
              </div>
            </div>

            {/* Step: Translation to English */}
            <div className="flex items-start gap-4 relative">
              <div className="absolute left-4 top-8 bottom-[-24px] w-0.5 border-l-2 border-dashed border-zinc-200 dark:border-zinc-800" />
              <div className={cn(
                "flex items-center justify-center w-8.5 h-8.5 rounded-full z-10 font-bold text-xs shadow-sm flex-shrink-0",
                pipelineStep === "translating"
                  ? "bg-teal-50 text-teal-600 dark:bg-teal-950/20 dark:text-teal-400 animate-pulse border border-teal-200 dark:border-teal-900"
                  : pipelineStep === "saving" || pipelineStep === "completed"
                  ? "bg-teal-50 text-teal-600 dark:bg-teal-950/20 dark:text-teal-400"
                  : "bg-zinc-50 text-zinc-400 dark:bg-zinc-900 dark:text-zinc-600"
              )}>
                {pipelineStep === "saving" || pipelineStep === "completed" ? (
                  <Check className="w-4 h-4 text-teal-600" />
                ) : pipelineStep === "translating" ? (
                  <Loader2 className="w-4 h-4 animate-spin text-teal-600" />
                ) : (
                  "3"
                )}
              </div>
              <div className="space-y-0.5 mt-0.5">
                <h4 className="text-xs font-bold text-zinc-900 dark:text-white">Translation (Sarvam Translate)</h4>
                <p className="text-[10px] text-zinc-400">
                  {pipelineStep === "translating" ? "Translating Tamil to English..." : "English translation complete"}
                </p>
              </div>
            </div>

            {/* Step: Database Saving */}
            <div className="flex items-start gap-4">
              <div className={cn(
                "flex items-center justify-center w-8.5 h-8.5 rounded-full z-10 font-bold text-xs shadow-sm flex-shrink-0",
                pipelineStep === "saving"
                  ? "bg-teal-50 text-teal-600 dark:bg-teal-950/20 dark:text-teal-400 animate-pulse border border-teal-200 dark:border-teal-900"
                  : pipelineStep === "completed"
                  ? "bg-teal-50 text-teal-600 dark:bg-teal-950/20 dark:text-teal-400"
                  : "bg-zinc-50 text-zinc-400 dark:bg-zinc-900 dark:text-zinc-600"
              )}>
                {pipelineStep === "completed" ? (
                  <Check className="w-4 h-4 text-teal-600" />
                ) : pipelineStep === "saving" ? (
                  <Loader2 className="w-4 h-4 animate-spin text-teal-600" />
                ) : (
                  "4"
                )}
              </div>
              <div className="space-y-0.5 mt-0.5">
                <h4 className="text-xs font-bold text-zinc-900 dark:text-white">Persisting to Database</h4>
                <p className="text-[10px] text-zinc-400">
                  {pipelineStep === "saving" ? "Saving transcripts to history..." : "Metadata saved in history logs"}
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Column 3: Transcripts (Multi-language) (Span 4) */}
        <div className="lg:col-span-4 space-y-4">
          <div className="flex items-center gap-2 px-1">
            <span className="flex items-center justify-center w-5 h-5 rounded-full bg-teal-600 text-white text-[10px] font-bold">3</span>
            <h3 className="text-xs font-extrabold text-zinc-400 uppercase tracking-wider">Transcripts (Multi-language)</h3>
          </div>

          {pipelineStep !== "completed" && !tamilText ? (
            <div className="p-6 bg-white border border-zinc-150 rounded-2xl dark:bg-zinc-950 dark:border-zinc-900 shadow-sm text-center flex flex-col items-center justify-center min-h-[300px]">
              <div className="w-12 h-12 rounded-full bg-zinc-50 dark:bg-zinc-900/40 flex items-center justify-center mb-4 text-zinc-400">
                <FileText className="w-6 h-6" />
              </div>
              <h4 className="text-sm font-bold text-zinc-900 dark:text-white mb-1.5">No transcripts generated yet</h4>
              <p className="text-xs text-zinc-400 max-w-[200px]">Upload an audio file and initiate the engine to view results.</p>
            </div>
          ) : (
            <div className="space-y-6">
              {/* Tamil Transcription Card */}
              <div className="flex flex-col bg-white border border-zinc-150 rounded-2xl dark:bg-zinc-950 dark:border-zinc-900 overflow-hidden shadow-sm">
                <div className="flex items-center justify-between px-5 py-3.5 border-b border-zinc-100 dark:border-zinc-900 bg-zinc-50/50 dark:bg-zinc-900/20">
                  <span className="px-2 py-0.5 text-[10px] font-bold rounded bg-teal-50 text-teal-700 dark:bg-teal-950/20 dark:text-teal-400">
                    தமிழ் Tamil
                  </span>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => handleCopy(tamilText, "tamil")}
                      className="p-1.5 hover:bg-zinc-100 text-zinc-400 hover:text-zinc-755 rounded-lg dark:hover:bg-zinc-900 transition-colors"
                      title="Copy Tamil"
                    >
                      {copiedTamil ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
                    </button>
                    <button
                      onClick={() => setIsEditingTamil(!isEditingTamil)}
                      className="p-1.5 hover:bg-zinc-100 text-zinc-400 hover:text-zinc-755 rounded-lg dark:hover:bg-zinc-900 transition-colors"
                      title={isEditingTamil ? "Save changes" : "Edit Tamil"}
                    >
                      {isEditingTamil ? <Save className="w-4 h-4 text-emerald-600" /> : <Edit2 className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
                <div className="p-5 flex-1 min-h-[120px]">
                  {isEditingTamil ? (
                    <textarea
                      value={tamilText}
                      onChange={(e) => setTamilText(e.target.value)}
                      className="w-full min-h-[120px] p-2.5 border border-zinc-200 dark:border-zinc-800 rounded-xl focus:outline-none focus:ring-1 focus:ring-teal-500 text-xs leading-relaxed text-zinc-900 dark:bg-zinc-900 dark:text-white"
                    />
                  ) : (
                    <p className="text-zinc-800 dark:text-zinc-200 text-xs leading-relaxed font-semibold font-sans">
                      {tamilText}
                    </p>
                  )}
                </div>
              </div>

              {/* English Translation Card */}
              <div className="flex flex-col bg-white border border-zinc-150 rounded-2xl dark:bg-zinc-950 dark:border-zinc-900 overflow-hidden shadow-sm">
                <div className="flex items-center justify-between px-5 py-3.5 border-b border-zinc-100 dark:border-zinc-900 bg-zinc-50/50 dark:bg-zinc-900/20">
                  <span className="px-2 py-0.5 text-[10px] font-bold rounded bg-blue-50 text-blue-700 dark:bg-blue-950/20 dark:text-blue-400">
                    EN English
                  </span>
                  <button
                    onClick={() => handleCopy(englishText, "english")}
                    className="p-1.5 hover:bg-zinc-100 text-zinc-400 hover:text-zinc-755 rounded-lg dark:hover:bg-zinc-900 transition-colors"
                    title="Copy English"
                  >
                    {copiedEnglish ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
                  </button>
                </div>
                <div className="p-5 flex-1 min-h-[120px]">
                  <p className="text-zinc-800 dark:text-zinc-200 text-xs leading-relaxed font-sans">
                    {englishText}
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
