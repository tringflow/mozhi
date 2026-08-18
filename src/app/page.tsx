"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Mic,
  History,
  Clock,
  AudioLines,
  Plus,
  Play,
  Volume2,
  Loader2,
  ChevronRight,
} from "lucide-react";
import { mozhiService, Translation } from "../services/mozhi";

export default function Dashboard() {
  const [translations, setTranslations] = useState<Translation[]>([]);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({
    totalCount: 0,
    weekCount: 0,
    totalDuration: 0,
    avgDuration: 0,
  });

  // Audio play state
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [audioEl, setAudioEl] = useState<HTMLAudioElement | null>(null);

  useEffect(() => {
    fetchDashboardData();
  }, []);

  const fetchDashboardData = async () => {
    try {
      setLoading(true);
      const data = await mozhiService.getHistory();
      setTranslations(data);
      computeStats(data);
    } catch (err) {
      console.error("Dashboard data load error:", err);
    } finally {
      setLoading(false);
    }
  };

  const computeStats = (items: Translation[]) => {
    const totalCount = items.length;

    // Filter items created within the last 7 days
    const oneWeekAgo = new Date();
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
    const weekCount = items.filter((item) => new Date(item.created_at) >= oneWeekAgo).length;

    const totalDuration = items.reduce((acc, curr) => acc + (curr.audio_duration || 0), 0);
    const avgDuration = totalCount > 0 ? totalDuration / totalCount : 0;

    setStats({
      totalCount,
      weekCount,
      totalDuration,
      avgDuration,
    });
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
    newAudio.play();
    setPlayingId(id);
    setAudioEl(newAudio);

    newAudio.onended = () => {
      setPlayingId(null);
      setAudioEl(null);
    };
  };

  useEffect(() => {
    return () => {
      if (audioEl) audioEl.pause();
    };
  }, [audioEl]);

  const formatDuration = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = Math.round(secs % 60);
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr);
    return d.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    });
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-32">
        <Loader2 className="w-10 h-10 text-zinc-900 dark:text-white animate-spin mb-3" />
        <p className="text-sm text-zinc-500">Loading dashboard overview...</p>
      </div>
    );
  }

  const recentTranslations = translations.slice(0, 5);

  return (
    <div className="max-w-6xl mx-auto space-y-10 font-sans">
      {/* Welcome Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-6 p-8 bg-zinc-900 text-white rounded-3xl dark:bg-white dark:text-black">
        <div className="space-y-2">
          <h2 className="text-3xl font-extrabold tracking-tight">Vanakkam! Welcome to Mozhi</h2>
          <p className="text-sm opacity-80 max-w-lg leading-relaxed">
            Translate and transcribe Tamil audio or live microphone recordings to natural English instantly.
          </p>
        </div>
        <Link
          href="/new"
          className="inline-flex items-center justify-center gap-2 px-6 py-3.5 bg-white text-black font-bold rounded-2xl hover:bg-zinc-100 dark:bg-black dark:text-white dark:hover:bg-zinc-900 transition-all shadow-md text-sm active:scale-95"
        >
          <Plus className="w-5 h-5" /> New Translation
        </Link>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        {/* Stat 1 */}
        <div className="p-6 bg-white border border-zinc-200 rounded-2xl dark:bg-zinc-950 dark:border-zinc-800 shadow-sm flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Total Translations</p>
            <h3 className="text-3xl font-bold mt-1.5 text-zinc-900 dark:text-white">{stats.totalCount}</h3>
          </div>
          <div className="flex items-center justify-center w-12 h-12 rounded-xl bg-zinc-50 dark:bg-zinc-900 text-zinc-700 dark:text-zinc-300">
            <History className="w-6 h-6" />
          </div>
        </div>

        {/* Stat 2 */}
        <div className="p-6 bg-white border border-zinc-200 rounded-2xl dark:bg-zinc-950 dark:border-zinc-800 shadow-sm flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Created This Week</p>
            <h3 className="text-3xl font-bold mt-1.5 text-zinc-900 dark:text-white">{stats.weekCount}</h3>
          </div>
          <div className="flex items-center justify-center w-12 h-12 rounded-xl bg-zinc-50 dark:bg-zinc-900 text-zinc-700 dark:text-zinc-300">
            <Mic className="w-6 h-6" />
          </div>
        </div>

        {/* Stat 3 */}
        <div className="p-6 bg-white border border-zinc-200 rounded-2xl dark:bg-zinc-950 dark:border-zinc-800 shadow-sm flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Total Duration</p>
            <h3 className="text-3xl font-bold mt-1.5 text-zinc-900 dark:text-white">
              {formatDuration(stats.totalDuration)}
            </h3>
          </div>
          <div className="flex items-center justify-center w-12 h-12 rounded-xl bg-zinc-50 dark:bg-zinc-900 text-zinc-700 dark:text-zinc-300">
            <Clock className="w-6 h-6" />
          </div>
        </div>

        {/* Stat 4 */}
        <div className="p-6 bg-white border border-zinc-200 rounded-2xl dark:bg-zinc-950 dark:border-zinc-800 shadow-sm flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Avg Audio Length</p>
            <h3 className="text-3xl font-bold mt-1.5 text-zinc-900 dark:text-white">
              {formatDuration(stats.avgDuration)}
            </h3>
          </div>
          <div className="flex items-center justify-center w-12 h-12 rounded-xl bg-zinc-50 dark:bg-zinc-900 text-zinc-700 dark:text-zinc-300">
            <AudioLines className="w-6 h-6" />
          </div>
        </div>
      </div>

      {/* Main Body Grid */}
      <div className="grid grid-cols-1 gap-8">
        {/* Recent Translations Card */}
        <div className="bg-white border border-zinc-200 rounded-2xl dark:bg-zinc-950 dark:border-zinc-800 shadow-sm overflow-hidden">
          <div className="flex items-center justify-between px-6 py-5 border-b border-zinc-200 dark:border-zinc-800">
            <h3 className="font-bold text-zinc-900 dark:text-white text-base">Recent Translations</h3>
            <Link
              href="/history"
              className="inline-flex items-center gap-1 text-xs font-semibold text-zinc-500 hover:text-zinc-900 dark:hover:text-white transition-colors"
            >
              View All History <ChevronRight className="w-4 h-4" />
            </Link>
          </div>

          {recentTranslations.length === 0 ? (
            <div className="p-12 text-center">
              <p className="text-zinc-500 dark:text-zinc-400 font-medium">No recent translations.</p>
              <Link
                href="/new"
                className="inline-block mt-3 text-xs font-semibold text-zinc-900 hover:underline dark:text-white"
              >
                Create your first translation
              </Link>
            </div>
          ) : (
            <div className="divide-y divide-zinc-150 dark:divide-zinc-900">
              {recentTranslations.map((item) => (
                <div
                  key={item.id}
                  className="flex items-center justify-between p-6 hover:bg-zinc-50/40 dark:hover:bg-zinc-900/10 transition-colors gap-4"
                >
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex items-center gap-2.5">
                      <span className="text-xs font-bold text-zinc-400 font-mono">
                        {formatDate(item.created_at)}
                      </span>
                      <span className="text-sm font-semibold text-zinc-900 dark:text-white truncate max-w-[200px] font-mono">
                        {item.audio_filename}
                      </span>
                      <span className="text-xs font-medium px-2 py-0.5 rounded bg-zinc-100 text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400">
                        {formatDuration(item.audio_duration)}
                      </span>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2 pt-1.5">
                      <p className="text-sm font-medium text-zinc-800 dark:text-zinc-200 truncate font-sans">
                        {item.tamil_text}
                      </p>
                      <p className="text-sm text-zinc-500 dark:text-zinc-400 truncate font-sans">
                        {item.english_text}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handlePlayAudio(item.audio_url, item.id)}
                      className={`p-2.5 rounded-xl transition-colors ${
                        playingId === item.id
                          ? "bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40"
                          : "hover:bg-zinc-100 text-zinc-500 dark:hover:bg-zinc-900 dark:text-zinc-400"
                      }`}
                    >
                      <Volume2 className={`w-4 h-4 ${playingId === item.id ? "animate-pulse" : ""}`} />
                    </button>
                    <Link
                      href={`/history/${item.id}`}
                      className="p-2.5 hover:bg-zinc-100 text-zinc-500 rounded-xl dark:hover:bg-zinc-900 dark:text-zinc-400 transition-colors"
                    >
                      <ChevronRight className="w-5 h-5" />
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
