"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  Upload,
  Mic,
  Square,
  Play,
  Pause,
  Copy,
  Check,
  Edit2,
  Save,
  Loader2,
  Volume2,
  ArrowRight,
  Sparkles,
} from "lucide-react";
import { mozhiService } from "../../services/mozhi";

type PipelineStep = "idle" | "uploading" | "transcribing" | "translating" | "saving" | "completed" | "error";

export default function NewTranslation() {
  const router = useRouter();
  
  // Audio states
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [audioDuration, setAudioDuration] = useState<number>(0);
  
  // Recording states
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  // Pipeline execution states
  const [pipelineStep, setPipelineStep] = useState<PipelineStep>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Result states
  const [tamilText, setTamilText] = useState("");
  const [englishText, setEnglishText] = useState("");
  const [isEditingTamil, setIsEditingTamil] = useState(false);
  const [copiedTamil, setCopiedTamil] = useState(false);
  const [copiedEnglish, setCopiedEnglish] = useState(false);

  // Cleanup audio preview URL when component unmounts
  useEffect(() => {
    return () => {
      if (audioUrl) URL.revokeObjectURL(audioUrl);
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [audioUrl]);

  // Handle Recording Timer
  useEffect(() => {
    if (isRecording) {
      timerRef.current = setInterval(() => {
        setRecordingSeconds((prev) => prev + 1);
      }, 1000);
    } else {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [isRecording]);

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  // Start Mic Recording
  const startRecording = async () => {
    try {
      setErrorMessage(null);
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      audioChunksRef.current = [];
      setRecordingSeconds(0);

      let options = {};
      if (MediaRecorder.isTypeSupported("audio/webm;codecs=opus")) {
        options = { mimeType: "audio/webm;codecs=opus" };
      } else if (MediaRecorder.isTypeSupported("audio/ogg;codecs=opus")) {
        options = { mimeType: "audio/ogg;codecs=opus" };
      }

      const mediaRecorder = new MediaRecorder(stream, options);

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = () => {
        const mimeType = mediaRecorder.mimeType || "audio/webm";
        const audioBlob = new Blob(audioChunksRef.current, { type: mimeType });
        const fileExt = mimeType.includes("ogg") ? "ogg" : "webm";
        const file = new File([audioBlob], `recording-${Date.now()}.${fileExt}`, {
          type: mimeType,
        });

        // Set file and local URL for preview
        setAudioFile(file);
        const url = URL.createObjectURL(audioBlob);
        setAudioUrl(url);
        setAudioDuration(recordingSeconds);

        // Stop all tracks on the stream to release mic
        stream.getTracks().forEach((track) => track.stop());
      };

      mediaRecorderRef.current = mediaRecorder;
      mediaRecorder.start();
      setIsRecording(true);
    } catch (err: any) {
      console.error("Microphone access error:", err);
      setErrorMessage("Microphone permission denied or unsupported by browser.");
    }
  };

  // Stop Mic Recording
  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
  };

  // Handle File Upload Select
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setErrorMessage(null);

    // Validate size (max 25MB for Groq Whisper API)
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
      const tamilTranscript = await mozhiService.transcribeAudio(audioFile);
      setTamilText(tamilTranscript);

      // Step 2: Translating
      setPipelineStep("translating");
      const englishTranslation = await mozhiService.translateText(tamilTranscript);
      setEnglishText(englishTranslation);

      // Step 3: Saving to Supabase (Audio Storage + Postgres Table)
      setPipelineStep("saving");
      await mozhiService.saveTranslation(
        audioFile,
        tamilTranscript,
        englishTranslation,
        audioDuration,
        audioFile.name
      );

      setPipelineStep("completed");
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
    <div className="max-w-5xl mx-auto space-y-8 font-sans">
      <div className="flex flex-col gap-2">
        <h2 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-white">
          Create Tamil-to-English Translation
        </h2>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          Upload Tamil audio or record speech to transcribe and translate in real-time.
        </p>
      </div>

      {pipelineStep === "idle" || pipelineStep === "error" ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Record Column */}
          <div className="flex flex-col items-center justify-center p-8 bg-white border border-zinc-200 rounded-2xl dark:bg-zinc-950 dark:border-zinc-800">
            <div className="flex items-center justify-center w-16 h-16 rounded-full bg-zinc-50 dark:bg-zinc-900 mb-6">
              <Mic className="w-8 h-8 text-zinc-600 dark:text-zinc-400" />
            </div>
            <h3 className="text-lg font-semibold text-zinc-900 dark:text-white mb-2">Record Audio</h3>
            <p className="text-sm text-zinc-500 dark:text-zinc-400 text-center mb-6 max-w-xs">
              Record Tamil speech directly using your browser microphone.
            </p>

            {isRecording ? (
              <div className="flex flex-col items-center gap-4">
                <div className="flex items-center gap-3 px-4 py-2 bg-red-50 text-red-700 border border-red-200 rounded-full animate-pulse dark:bg-red-950/30 dark:text-red-400 dark:border-red-900">
                  <span className="w-2.5 h-2.5 rounded-full bg-red-600 dark:bg-red-500 animate-ping" />
                  <span className="font-semibold">{formatTime(recordingSeconds)}</span>
                </div>
                <button
                  onClick={stopRecording}
                  className="flex items-center justify-center gap-2 px-6 py-3 bg-red-600 text-white font-semibold rounded-xl hover:bg-red-700 active:scale-95 transition-all shadow-md"
                >
                  <Square className="w-5 h-5 fill-white" /> Stop Recording
                </button>
              </div>
            ) : (
              <button
                onClick={startRecording}
                className="flex items-center justify-center gap-2 px-6 py-3 bg-zinc-900 text-white font-semibold rounded-xl hover:bg-zinc-800 dark:bg-white dark:text-black dark:hover:bg-zinc-100 active:scale-95 transition-all shadow-md"
              >
                <Mic className="w-5 h-5" /> Start Recording
              </button>
            )}
          </div>

          {/* Upload Column */}
          <div className="flex flex-col items-center justify-center p-8 bg-white border border-zinc-200 rounded-2xl dark:bg-zinc-950 dark:border-zinc-800">
            <div className="flex items-center justify-center w-16 h-16 rounded-full bg-zinc-50 dark:bg-zinc-900 mb-6">
              <Upload className="w-8 h-8 text-zinc-600 dark:text-zinc-400" />
            </div>
            <h3 className="text-lg font-semibold text-zinc-900 dark:text-white mb-2">Upload Audio</h3>
            <p className="text-sm text-zinc-500 dark:text-zinc-400 text-center mb-6 max-w-xs">
              Supports MP3, WAV, M4A, or WEBM. Max size 25MB.
            </p>

            <label className="flex items-center justify-center gap-2 px-6 py-3 border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-900 rounded-xl cursor-pointer font-semibold text-zinc-700 dark:text-zinc-300 transition-colors shadow-sm">
              <Upload className="w-5 h-5" /> Select File
              <input
                type="file"
                accept="audio/*"
                onChange={handleFileChange}
                className="hidden"
              />
            </label>
          </div>
        </div>
      ) : null}

      {/* Selected Audio Preview and Action Trigger */}
      {audioFile && (pipelineStep === "idle" || pipelineStep === "error") && (
        <div className="p-6 bg-white border border-zinc-200 rounded-2xl dark:bg-zinc-950 dark:border-zinc-800 space-y-4">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div>
              <p className="text-sm font-semibold text-zinc-900 dark:text-white">Selected Audio</p>
              <p className="text-xs text-zinc-500 dark:text-zinc-400 font-mono mt-0.5">
                {audioFile.name} ({formatTime(Math.round(audioDuration))})
              </p>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={resetForm}
                className="px-4 py-2 text-sm font-medium text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-900 rounded-lg transition-colors"
              >
                Clear
              </button>
              <button
                onClick={processPipeline}
                className="flex items-center gap-2 px-5 py-2.5 bg-zinc-900 text-white font-semibold rounded-xl hover:bg-zinc-800 dark:bg-white dark:text-black dark:hover:bg-zinc-100 transition-all shadow-sm"
              >
                Start Transcription <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>
          {audioUrl && (
            <div className="w-full flex items-center justify-center p-3 bg-zinc-50 dark:bg-zinc-900/50 rounded-xl border border-zinc-100 dark:border-zinc-800/80">
              <audio src={audioUrl} controls className="w-full max-w-xl h-10" />
            </div>
          )}
        </div>
      )}

      {/* Pipeline Loader View */}
      {pipelineStep !== "idle" && pipelineStep !== "error" && pipelineStep !== "completed" && (
        <div className="p-8 bg-white border border-zinc-200 rounded-2xl dark:bg-zinc-950 dark:border-zinc-800 space-y-6">
          <div className="flex flex-col items-center justify-center py-6">
            <Loader2 className="w-10 h-10 text-zinc-900 dark:text-white animate-spin mb-4" />
            <h3 className="text-lg font-semibold text-zinc-900 dark:text-white">Processing translation...</h3>
            <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">Please keep this tab open during processing.</p>
          </div>

          <div className="max-w-md mx-auto space-y-4">
            {/* Step 1 */}
            <div className="flex items-center justify-between text-sm">
              <span className="text-zinc-600 dark:text-zinc-300">Audio Uploaded</span>
              <span className="text-emerald-600 dark:text-emerald-400 font-semibold">✓</span>
            </div>

            {/* Step 2 */}
            <div className="flex items-center justify-between text-sm">
              <span className="text-zinc-600 dark:text-zinc-300">Transcribing Tamil Speech</span>
              {pipelineStep === "transcribing" ? (
                <span className="text-zinc-900 dark:text-white animate-pulse flex items-center gap-1">
                  Transcribing... <Loader2 className="w-3.5 h-3.5 animate-spin" />
                </span>
              ) : (
                <span className="text-emerald-600 dark:text-emerald-400 font-semibold">✓</span>
              )}
            </div>

            {/* Step 3 */}
            <div className="flex items-center justify-between text-sm">
              <span className="text-zinc-600 dark:text-zinc-300">Translating to English</span>
              {pipelineStep === "transcribing" ? (
                <span className="text-zinc-400">Waiting...</span>
              ) : pipelineStep === "translating" ? (
                <span className="text-zinc-900 dark:text-white animate-pulse flex items-center gap-1">
                  Translating... <Loader2 className="w-3.5 h-3.5 animate-spin" />
                </span>
              ) : (
                <span className="text-emerald-600 dark:text-emerald-400 font-semibold">✓</span>
              )}
            </div>

            {/* Step 4 */}
            <div className="flex items-center justify-between text-sm">
              <span className="text-zinc-600 dark:text-zinc-300">Saving Result to History</span>
              {pipelineStep === "saving" ? (
                <span className="text-zinc-900 dark:text-white animate-pulse flex items-center gap-1">
                  Saving... <Loader2 className="w-3.5 h-3.5 animate-spin" />
                </span>
              ) : pipelineStep === "completed" ? (
                <span className="text-emerald-600 dark:text-emerald-400 font-semibold">✓</span>
              ) : (
                <span className="text-zinc-400">Waiting...</span>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Error message card */}
      {errorMessage && (
        <div className="p-4 bg-red-50 text-red-700 border border-red-200 rounded-xl dark:bg-red-950/30 dark:text-red-400 dark:border-red-900/50">
          <p className="text-sm font-semibold">Processing Error</p>
          <p className="text-xs mt-1">{errorMessage}</p>
        </div>
      )}

      {/* Side-by-Side Results Card */}
      {pipelineStep === "completed" && (
        <div className="space-y-6">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 p-4 bg-emerald-50 text-emerald-800 border border-emerald-200 rounded-2xl dark:bg-emerald-950/30 dark:text-emerald-400 dark:border-emerald-900">
            <div className="flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
              <div>
                <p className="text-sm font-semibold">Translation Saved Successfully!</p>
                <p className="text-xs opacity-90">Your files and transcripts have been stored in Supabase.</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={resetForm}
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold rounded-lg transition-colors"
              >
                Translate New Audio
              </button>
              <button
                onClick={() => router.push("/history")}
                className="px-4 py-2 border border-emerald-300 dark:border-emerald-800 hover:bg-emerald-100 dark:hover:bg-emerald-900/50 text-xs font-semibold rounded-lg transition-colors"
              >
                View History
              </button>
            </div>
          </div>

          {audioUrl && (
            <div className="p-4 bg-zinc-50 border border-zinc-200 rounded-xl dark:bg-zinc-900/50 dark:border-zinc-800 flex items-center justify-between gap-4">
              <div className="flex items-center gap-2 text-zinc-700 dark:text-zinc-300">
                <Volume2 className="w-5 h-5" />
                <span className="text-sm font-semibold">Original Audio Playback</span>
              </div>
              <audio src={audioUrl} controls className="h-8 max-w-sm sm:max-w-md w-full" />
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Tamil Transcript */}
            <div className="flex flex-col bg-white border border-zinc-200 rounded-2xl dark:bg-zinc-950 dark:border-zinc-800 overflow-hidden">
              <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/50">
                <h3 className="font-semibold text-zinc-900 dark:text-white">Tamil Transcription</h3>
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => handleCopy(tamilText, "tamil")}
                    className="p-2 text-zinc-500 hover:bg-zinc-100 rounded-lg dark:text-zinc-400 dark:hover:bg-zinc-900 transition-colors"
                    title="Copy Tamil"
                  >
                    {copiedTamil ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
                  </button>
                  <button
                    onClick={() => setIsEditingTamil(!isEditingTamil)}
                    className="p-2 text-zinc-500 hover:bg-zinc-100 rounded-lg dark:text-zinc-400 dark:hover:bg-zinc-900 transition-colors"
                    title={isEditingTamil ? "Save changes" : "Edit Tamil"}
                  >
                    {isEditingTamil ? <Save className="w-4 h-4 text-emerald-600" /> : <Edit2 className="w-4 h-4" />}
                  </button>
                </div>
              </div>
              <div className="p-6 flex-1 min-h-[150px]">
                {isEditingTamil ? (
                  <textarea
                    value={tamilText}
                    onChange={(e) => setTamilText(e.target.value)}
                    className="w-full h-full min-h-[150px] p-3 border border-zinc-300 dark:border-zinc-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-zinc-500 text-base font-sans leading-relaxed text-zinc-900 dark:bg-zinc-900 dark:text-white"
                  />
                ) : (
                  <p className="text-zinc-900 dark:text-zinc-100 text-base leading-relaxed font-medium font-sans">
                    {tamilText}
                  </p>
                )}
              </div>
            </div>

            {/* English Translation */}
            <div className="flex flex-col bg-white border border-zinc-200 rounded-2xl dark:bg-zinc-950 dark:border-zinc-800 overflow-hidden">
              <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/50">
                <h3 className="font-semibold text-zinc-900 dark:text-white">English Translation</h3>
                <button
                  onClick={() => handleCopy(englishText, "english")}
                  className="p-2 text-zinc-500 hover:bg-zinc-100 rounded-lg dark:text-zinc-400 dark:hover:bg-zinc-900 transition-colors"
                  title="Copy English"
                >
                  {copiedEnglish ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
                </button>
              </div>
              <div className="p-6 flex-1 min-h-[150px]">
                <p className="text-zinc-900 dark:text-zinc-100 text-base leading-relaxed font-sans">
                  {englishText}
                </p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
