"use client";

import { useEffect, useState } from "react";
import { languageOrDefault } from "../../lib/languages";
import Link from "next/link";
import {
  Search,
  Volume2,
  Trash2,
  Copy,
  Check,
  Eye,
  Loader2,
  AlertCircle,
} from "lucide-react";
import { mozhiService, Translation } from "../../services/mozhi";
import { getErrorMessage } from "../../lib/errors";

export default function HistoryPage() {
  const [history, setHistory] = useState<Translation[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Copy success states
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [copiedType, setCopiedType] = useState<"tamil" | "english" | null>(null);

  // Audio playing states
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [audioEl, setAudioEl] = useState<HTMLAudioElement | null>(null);

  // Debounced search; `cancelled` drops responses from superseded requests so stale results never overwrite newer ones.
  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        setLoading(true);
        setError(null);
        const data = await mozhiService.getHistory(search.trim() || undefined);
        if (!cancelled) setHistory(data);
      } catch (err) {
        console.error("Fetch history error:", err);
        if (!cancelled) setError(getErrorMessage(err, "Failed to load translation history."));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, search ? 300 : 0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [search]);

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearch(e.target.value);
  };

  const handleCopy = (text: string, id: string, type: "tamil" | "english") => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setCopiedType(type);
    setTimeout(() => {
      setCopiedId(null);
      setCopiedType(null);
    }, 2000);
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Are you sure you want to delete this translation? This will also remove the audio file from storage.")) {
      return;
    }

    try {
      if (playingId === id && audioEl) {
        audioEl.pause();
        setPlayingId(null);
      }

      await mozhiService.deleteTranslation(id);
      setHistory((prev) => prev.filter((item) => item.id !== id));
    } catch (err) {
      console.error("Delete translation error:", err);
      alert(getErrorMessage(err, "Failed to delete translation."));
    }
  };

  const handlePlayAudio = (url: string, id: string) => {
    if (playingId === id && audioEl) {
      audioEl.pause();
      setPlayingId(null);
      setAudioEl(null);
      return;
    }

    if (audioEl) {
      audioEl.pause();
    }

    const newAudio = new Audio(url);
    newAudio.onended = () => {
      setPlayingId(null);
      setAudioEl(null);
    };
    newAudio.play().catch((err) => {
      console.warn("Audio playback failed:", err);
      setPlayingId(null);
      setAudioEl(null);
    });
    setPlayingId(id);
    setAudioEl(newAudio);
  };

  // Cleanup audio on component unmount
  useEffect(() => {
    return () => {
      if (audioEl) {
        audioEl.pause();
      }
    };
  }, [audioEl]);

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr);
    return d.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  };

  const formatTime = (dateStr: string) => {
    const d = new Date(dateStr);
    return d.toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const formatDuration = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = Math.round(secs % 60);
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  return (
    <div className="max-w-6xl mx-auto space-y-8 font-sans">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-white">
            Translation History
          </h2>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            Browse, search, and manage all your past transcriptions and translations.
          </p>
        </div>
        <Link
          href="/new"
          className="inline-flex items-center justify-center px-4 py-2.5 bg-zinc-900 text-white font-semibold rounded-xl hover:bg-zinc-800 dark:bg-white dark:text-black dark:hover:bg-zinc-100 transition-colors shadow-sm text-sm"
        >
          New Translation
        </Link>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-col sm:flex-row gap-4 p-4 bg-white border border-zinc-200 rounded-2xl dark:bg-zinc-950 dark:border-zinc-800 shadow-sm">
        <div className="relative flex-1">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
          <input
            type="text"
            placeholder="Search source or English text..."
            value={search}
            onChange={handleSearchChange}
            className="w-full pl-10 pr-4 py-2 text-sm border border-zinc-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-zinc-500 dark:bg-zinc-900 dark:border-zinc-800"
          />
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-3 p-4 bg-red-50 border border-red-200 rounded-xl text-red-700 dark:bg-red-950/30 dark:border-red-900/50 dark:text-red-400">
          <AlertCircle className="w-5 h-5 flex-shrink-0" />
          <p className="text-sm font-semibold">{error}</p>
        </div>
      )}

      {loading ? (
        <div className="flex flex-col items-center justify-center py-20">
          <Loader2 className="w-10 h-10 text-zinc-900 dark:text-white animate-spin mb-3" />
          <p className="text-sm text-zinc-500">Loading history records...</p>
        </div>
      ) : history.length === 0 ? (
        <div className="text-center py-16 bg-white border border-dashed border-zinc-200 rounded-2xl dark:bg-zinc-950 dark:border-zinc-800">
          <p className="text-zinc-500 dark:text-zinc-400 font-medium">No translations found.</p>
          <p className="text-xs text-zinc-400 mt-1">Try translating some audio to populate your history.</p>
        </div>
      ) : (
        <div className="bg-white border border-zinc-200 rounded-2xl dark:bg-zinc-950 dark:border-zinc-800 overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900/50">
                  <th className="px-6 py-4 text-xs font-semibold uppercase tracking-wider text-zinc-500">Date / Time</th>
                  <th className="px-6 py-4 text-xs font-semibold uppercase tracking-wider text-zinc-500">File Name</th>
                  <th className="px-6 py-4 text-xs font-semibold uppercase tracking-wider text-zinc-500">Duration</th>
                  <th className="px-6 py-4 text-xs font-semibold uppercase tracking-wider text-zinc-500">Source Transcript</th>
                  <th className="px-6 py-4 text-xs font-semibold uppercase tracking-wider text-zinc-500">English Translation</th>
                  <th className="px-6 py-4 text-xs font-semibold uppercase tracking-wider text-zinc-500 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                {history.map((item) => (
                  <tr key={item.id} className="hover:bg-zinc-50/50 dark:hover:bg-zinc-900/20 transition-colors">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm font-semibold text-zinc-900 dark:text-white">
                        {formatDate(item.created_at)}
                      </div>
                      <div className="text-xs text-zinc-500 mt-0.5">
                        {formatTime(item.created_at)}
                      </div>
                    </td>
                    <td className="px-6 py-4 max-w-[150px] truncate">
                      <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300 font-mono" title={item.audio_filename}>
                        {item.audio_filename}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-zinc-600 dark:text-zinc-400">
                      {formatDuration(item.audio_duration)}
                    </td>
                    <td className="px-6 py-4 max-w-[200px] truncate">
                      <span className="mr-2 px-1.5 py-0.5 text-[10px] font-bold rounded bg-teal-50 text-teal-700 dark:bg-teal-950/20 dark:text-teal-400">
                        {languageOrDefault(item.language).name}
                      </span>
                      <span className="text-sm text-zinc-900 dark:text-zinc-200 font-sans" title={item.tamil_text}>
                        {item.tamil_text}
                      </span>
                    </td>
                    <td className="px-6 py-4 max-w-[200px] truncate">
                      <span className="text-sm text-zinc-600 dark:text-zinc-400 font-sans" title={item.english_text}>
                        {item.english_text}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => item.audio_url && handlePlayAudio(item.audio_url, item.id)}
                          disabled={!item.audio_url}
                          className={`p-2 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                            playingId === item.id
                              ? "bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40"
                              : "hover:bg-zinc-100 text-zinc-500 dark:hover:bg-zinc-900 dark:text-zinc-400"
                          }`}
                          title={item.audio_url ? "Play original audio" : "Original audio was not stored"}
                        >
                          <Volume2 className={`w-4 h-4 ${playingId === item.id ? "animate-pulse" : ""}`} />
                        </button>
                        <button
                          onClick={() => handleCopy(item.tamil_text, item.id, "tamil")}
                          className="p-2 hover:bg-zinc-100 text-zinc-500 rounded-lg dark:hover:bg-zinc-900 dark:text-zinc-400 transition-colors"
                          title={`Copy ${languageOrDefault(item.language).name}`}
                        >
                          {copiedId === item.id && copiedType === "tamil" ? (
                            <Check className="w-4 h-4 text-emerald-600" />
                          ) : (
                            <Copy className="w-4 h-4" />
                          )}
                        </button>
                        <button
                          onClick={() => handleCopy(item.english_text, item.id, "english")}
                          className="p-2 hover:bg-zinc-100 text-zinc-500 rounded-lg dark:hover:bg-zinc-900 dark:text-zinc-400 transition-colors"
                          title="Copy English"
                        >
                          {copiedId === item.id && copiedType === "english" ? (
                            <Check className="w-4 h-4 text-emerald-600" />
                          ) : (
                            <Copy className="w-4 h-4" />
                          )}
                        </button>
                        <Link
                          href={`/history/${item.id}`}
                          className="p-2 hover:bg-zinc-100 text-zinc-500 rounded-lg dark:hover:bg-zinc-900 dark:text-zinc-400 transition-colors"
                          title="View details"
                        >
                          <Eye className="w-4 h-4" />
                        </Link>
                        <button
                          onClick={() => handleDelete(item.id)}
                          className="p-2 hover:bg-red-50 text-red-600 rounded-lg dark:hover:bg-red-950/30 dark:text-red-400 transition-colors"
                          title="Delete translation"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
