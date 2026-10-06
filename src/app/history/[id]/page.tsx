"use client";

import { useEffect, useState, use } from "react";
import { languageOrDefault } from "../../../lib/languages";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  Volume2,
  Copy,
  Check,
  Trash2,
  Calendar,
  Clock,
  FileAudio,
  Loader2,
  AlertCircle,
} from "lucide-react";
import { mozhiService, Translation } from "../../../services/mozhi";
import { getErrorMessage } from "../../../lib/errors";

type PageProps = {
  params: Promise<{ id: string }>;
};

export default function TranslationDetails({ params }: PageProps) {
  const router = useRouter();
  const { id } = use(params);

  const [translation, setTranslation] = useState<Translation | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Copy success states
  const [copiedTamil, setCopiedTamil] = useState(false);
  const [copiedEnglish, setCopiedEnglish] = useState(false);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        setError(null);
        const data = await mozhiService.getTranslation(id);
        if (!cancelled) setTranslation(data);
      } catch (err) {
        console.error("Fetch details error:", err);
        if (!cancelled) setError(getErrorMessage(err, "Failed to load translation details."));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

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

  const handleDelete = async () => {
    if (!confirm("Are you sure you want to delete this translation? This action cannot be undone.")) {
      return;
    }

    try {
      await mozhiService.deleteTranslation(id);
      router.push("/history");
    } catch (err) {
      console.error("Delete translation error:", err);
      alert(getErrorMessage(err, "Failed to delete translation."));
    }
  };

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr);
    return d.toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const formatDuration = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = Math.round(secs % 60);
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-32">
        <Loader2 className="w-10 h-10 text-zinc-900 dark:text-white animate-spin mb-3" />
        <p className="text-sm text-zinc-500">Loading translation details...</p>
      </div>
    );
  }

  if (error || !translation) {
    return (
      <div className="max-w-3xl mx-auto space-y-6">
        <Link
          href="/history"
          className="inline-flex items-center gap-2 text-sm font-semibold text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white"
        >
          <ArrowLeft className="w-4 h-4" /> Back to History
        </Link>
        <div className="flex items-center gap-3 p-4 bg-red-50 border border-red-200 rounded-xl text-red-700 dark:bg-red-950/30 dark:border-red-900/50 dark:text-red-400">
          <AlertCircle className="w-5 h-5 flex-shrink-0" />
          <p className="text-sm font-semibold">{error || "Record not found."}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto space-y-8 font-sans">
      {/* Back button & Action buttons */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <Link
          href="/history"
          className="inline-flex items-center gap-2 text-sm font-semibold text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white"
        >
          <ArrowLeft className="w-4 h-4" /> Back to History
        </Link>
        <button
          onClick={handleDelete}
          className="inline-flex items-center justify-center gap-2 px-4 py-2 text-sm font-semibold text-red-600 border border-red-200 rounded-xl hover:bg-red-50 dark:border-red-900/50 dark:hover:bg-red-950/20 transition-colors"
        >
          <Trash2 className="w-4 h-4" /> Delete Translation
        </button>
      </div>

      {/* Metadata Card */}
      <div className="p-6 bg-white border border-zinc-200 rounded-2xl dark:bg-zinc-950 dark:border-zinc-800 shadow-sm space-y-4">
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-zinc-50 dark:bg-zinc-900">
            <FileAudio className="w-5 h-5 text-zinc-600 dark:text-zinc-400" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-zinc-900 dark:text-white font-mono truncate max-w-md sm:max-w-xl">
              {translation.audio_filename}
            </h2>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">ID: {translation.id}</p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4 pt-2 border-t border-zinc-100 dark:border-zinc-900 text-sm">
          <div className="flex items-center gap-2 text-zinc-600 dark:text-zinc-400">
            <Calendar className="w-4 h-4 text-zinc-400" />
            <span>{formatDate(translation.created_at)}</span>
          </div>
          <div className="flex items-center gap-2 text-zinc-600 dark:text-zinc-400">
            <Clock className="w-4 h-4 text-zinc-400" />
            <span>Duration: {formatDuration(translation.audio_duration)}</span>
          </div>
          <div className="flex items-center gap-2 text-zinc-600 dark:text-zinc-400">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
            <span>Status: Completed</span>
          </div>
        </div>

        {/* Audio Player */}
        {translation.audio_url && (
        <div className="w-full flex items-center justify-between gap-4 p-4 bg-zinc-50 dark:bg-zinc-900/50 rounded-xl border border-zinc-100 dark:border-zinc-850">
          <div className="flex items-center gap-2 text-zinc-700 dark:text-zinc-300">
            <Volume2 className="w-5 h-5" />
            <span className="text-sm font-semibold">Playback Original Audio</span>
          </div>
          <audio src={translation.audio_url} controls className="h-8 max-w-md w-full" />
        </div>
        )}
      </div>

      {/* Side-by-Side Content Display */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Source-language Transcript */}
        <div className="flex flex-col bg-white border border-zinc-200 rounded-2xl dark:bg-zinc-950 dark:border-zinc-800 overflow-hidden shadow-sm">
          <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/50">
            <h3 className="font-semibold text-zinc-900 dark:text-white">{languageOrDefault(translation.language).name} Transcription</h3>
            <button
              onClick={() => handleCopy(translation.tamil_text, "tamil")}
              className="p-2 text-zinc-500 hover:bg-zinc-100 rounded-lg dark:text-zinc-400 dark:hover:bg-zinc-900 transition-colors"
              title={`Copy ${languageOrDefault(translation.language).name}`}
            >
              {copiedTamil ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
            </button>
          </div>
          <div className="p-6 min-h-[200px]">
            <p className="text-zinc-900 dark:text-zinc-100 text-base leading-relaxed font-medium font-sans">
              {translation.tamil_text}
            </p>
          </div>
        </div>

        {/* English Translation */}
        <div className="flex flex-col bg-white border border-zinc-200 rounded-2xl dark:bg-zinc-950 dark:border-zinc-800 overflow-hidden shadow-sm">
          <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/50">
            <h3 className="font-semibold text-zinc-900 dark:text-white">English Translation</h3>
            <button
              onClick={() => handleCopy(translation.english_text, "english")}
              className="p-2 text-zinc-500 hover:bg-zinc-100 rounded-lg dark:text-zinc-400 dark:hover:bg-zinc-900 transition-colors"
              title="Copy English"
            >
              {copiedEnglish ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
            </button>
          </div>
          <div className="p-6 min-h-[200px]">
            <p className="text-zinc-900 dark:text-zinc-100 text-base leading-relaxed font-sans">
              {translation.english_text}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
