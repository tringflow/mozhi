"use client";

import { useEffect, useState } from "react";
import { BarChart3, Clock, Calendar, AudioLines, Loader2 } from "lucide-react";
import { mozhiService, Translation } from "../../services/mozhi";

interface DailyActivity {
  date: string;
  count: number;
}

export default function AnalyticsPage() {
  const [translations, setTranslations] = useState<Translation[]>([]);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({
    totalCount: 0,
    totalDuration: 0,
    avgDuration: 0,
    weekCount: 0,
    monthCount: 0,
  });
  const [chartData, setChartData] = useState<DailyActivity[]>([]);

  useEffect(() => {
    fetchAnalyticsData();
  }, []);

  const fetchAnalyticsData = async () => {
    try {
      setLoading(true);
      const data = await mozhiService.getHistory();
      setTranslations(data);
      computeStats(data);
      generateChartData(data);
    } catch (err) {
      console.error("Analytics load error:", err);
    } finally {
      setLoading(false);
    }
  };

  const computeStats = (items: Translation[]) => {
    const totalCount = items.length;
    const totalDuration = items.reduce((acc, curr) => acc + (curr.audio_duration || 0), 0);
    const avgDuration = totalCount > 0 ? totalDuration / totalCount : 0;

    const now = new Date();
    const oneWeekAgo = new Date();
    oneWeekAgo.setDate(now.getDate() - 7);
    const oneMonthAgo = new Date();
    oneMonthAgo.setMonth(now.getMonth() - 1);

    const weekCount = items.filter((item) => new Date(item.created_at) >= oneWeekAgo).length;
    const monthCount = items.filter((item) => new Date(item.created_at) >= oneMonthAgo).length;

    setStats({
      totalCount,
      totalDuration,
      avgDuration,
      weekCount,
      monthCount,
    });
  };

  const generateChartData = (items: Translation[]) => {
    // Generate daily activity for the last 7 days
    const last7Days: DailyActivity[] = [];
    const dateMap: { [key: string]: number } = {};

    // Initialize map
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const formattedDate = d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
      dateMap[formattedDate] = 0;
      last7Days.push({ date: formattedDate, count: 0 });
    }

    // Populate data
    items.forEach((item) => {
      const itemDate = new Date(item.created_at).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
      });
      if (itemDate in dateMap) {
        dateMap[itemDate] += 1;
      }
    });

    // Map back to array
    const populatedChartData = last7Days.map((day) => ({
      date: day.date,
      count: dateMap[day.date] || 0,
    }));

    setChartData(populatedChartData);
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
        <p className="text-sm text-zinc-500">Loading analytics insights...</p>
      </div>
    );
  }

  // Find max count to scale the SVG chart bars
  const maxCount = Math.max(...chartData.map((d) => d.count), 1);

  return (
    <div className="max-w-6xl mx-auto space-y-8 font-sans">
      <div>
        <h2 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-white">
          System Analytics
        </h2>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          Track usage statistics, audio processing metrics, and daily translation activities.
        </p>
      </div>

      {/* Analytics Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
        {/* Metric 1 */}
        <div className="p-6 bg-white border border-zinc-200 rounded-2xl dark:bg-zinc-950 dark:border-zinc-800 shadow-sm flex items-start gap-4">
          <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-zinc-50 dark:bg-zinc-900 text-zinc-600 dark:text-zinc-400 flex-shrink-0">
            <BarChart3 className="w-5 h-5" />
          </div>
          <div>
            <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Total Translations</p>
            <h3 className="text-3xl font-extrabold mt-1 text-zinc-900 dark:text-white">{stats.totalCount}</h3>
            <p className="text-xs text-zinc-400 mt-1">Total database records stored</p>
          </div>
        </div>

        {/* Metric 2 */}
        <div className="p-6 bg-white border border-zinc-200 rounded-2xl dark:bg-zinc-950 dark:border-zinc-800 shadow-sm flex items-start gap-4">
          <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-zinc-50 dark:bg-zinc-900 text-zinc-600 dark:text-zinc-400 flex-shrink-0">
            <Clock className="w-5 h-5" />
          </div>
          <div>
            <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Total Audio Duration</p>
            <h3 className="text-3xl font-extrabold mt-1 text-zinc-900 dark:text-white">
              {formatDuration(stats.totalDuration)}
            </h3>
            <p className="text-xs text-zinc-400 mt-1">Processed Tamil audio length</p>
          </div>
        </div>

        {/* Metric 3 */}
        <div className="p-6 bg-white border border-zinc-200 rounded-2xl dark:bg-zinc-950 dark:border-zinc-800 shadow-sm flex items-start gap-4">
          <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-zinc-50 dark:bg-zinc-900 text-zinc-600 dark:text-zinc-400 flex-shrink-0">
            <AudioLines className="w-5 h-5" />
          </div>
          <div>
            <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Average Audio Length</p>
            <h3 className="text-3xl font-extrabold mt-1 text-zinc-900 dark:text-white">
              {formatDuration(stats.avgDuration)}
            </h3>
            <p className="text-xs text-zinc-400 mt-1">Mean duration per recording</p>
          </div>
        </div>

        {/* Metric 4 */}
        <div className="p-6 bg-white border border-zinc-200 rounded-2xl dark:bg-zinc-950 dark:border-zinc-800 shadow-sm flex items-start gap-4">
          <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-zinc-50 dark:bg-zinc-900 text-zinc-600 dark:text-zinc-400 flex-shrink-0">
            <Calendar className="w-5 h-5" />
          </div>
          <div>
            <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">This Week</p>
            <h3 className="text-3xl font-extrabold mt-1 text-zinc-900 dark:text-white">{stats.weekCount}</h3>
            <p className="text-xs text-zinc-400 mt-1">Created in the last 7 days</p>
          </div>
        </div>

        {/* Metric 5 */}
        <div className="p-6 bg-white border border-zinc-200 rounded-2xl dark:bg-zinc-950 dark:border-zinc-800 shadow-sm flex items-start gap-4">
          <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-zinc-50 dark:bg-zinc-900 text-zinc-600 dark:text-zinc-400 flex-shrink-0">
            <Calendar className="w-5 h-5" />
          </div>
          <div>
            <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">This Month</p>
            <h3 className="text-3xl font-extrabold mt-1 text-zinc-900 dark:text-white">{stats.monthCount}</h3>
            <p className="text-xs text-zinc-400 mt-1">Created in the last 30 days</p>
          </div>
        </div>
      </div>

      {/* SVG-based Activity Chart */}
      <div className="p-6 bg-white border border-zinc-200 rounded-2xl dark:bg-zinc-950 dark:border-zinc-800 shadow-sm space-y-6">
        <div>
          <h3 className="font-bold text-zinc-900 dark:text-white text-base">Translation Activity</h3>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">Total requests processed daily (last 7 days)</p>
        </div>

        {/* Custom SVG Chart */}
        <div className="h-64 w-full flex items-end justify-between px-4 pb-6 pt-4 border-b border-zinc-100 dark:border-zinc-900 font-mono text-xs">
          {chartData.map((day) => {
            // Calculate height percentage
            const heightPct = Math.max((day.count / maxCount) * 100, 4); // Min 4% height so it is visible

            return (
              <div key={day.date} className="flex flex-col items-center flex-1 group">
                {/* Count tooltip on hover */}
                <span className="opacity-0 group-hover:opacity-100 bg-zinc-900 text-white text-[10px] px-2 py-1 rounded mb-2 transition-opacity duration-200 dark:bg-white dark:text-black">
                  {day.count}
                </span>
                
                {/* Bar */}
                <div
                  style={{ height: `${heightPct}%` }}
                  className="w-8 sm:w-12 bg-zinc-900 rounded-t-lg transition-all duration-300 dark:bg-white hover:bg-zinc-700 dark:hover:bg-zinc-200"
                />
                
                {/* Date Label */}
                <span className="mt-3 text-[10px] font-semibold text-zinc-500 dark:text-zinc-400">
                  {day.date}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
