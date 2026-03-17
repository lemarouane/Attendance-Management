import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import ProfLayout from "../components/ProfLayout";
import { useAuth } from "../context/AuthContext";
import { getProfTimetable, EdtSession } from "../services/apiService";

const DAY_NAMES = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi"];

const TYPE_COLORS: Record<string, string> = {
  "1": "bg-purple-100 border-purple-300 text-purple-800",
  "2": "bg-yellow-100 border-yellow-300 text-yellow-800",
  "3": "bg-green-100 border-green-300 text-green-800",
  "9": "bg-red-100 border-red-300 text-red-800",
  "4": "bg-orange-100 border-orange-300 text-orange-800",
};

function getISOWeek(d: Date): number {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

function parseTime(timeStr: string): { hours: number; minutes: number } {
  const [h, m] = timeStr.split(":").map(Number);
  return { hours: h || 0, minutes: m || 0 };
}

function getSessionStatus(session: EdtSession, todayStr: string, nowMinutes: number): {
  canScan: boolean;
  status: "ready" | "wait" | "active" | "past" | "future_day" | "past_day";
  message: string;
  waitMinutes?: number;
} {
  if (session.date !== todayStr) {
    const sessionDate = new Date(session.date);
    const today = new Date(todayStr);
    if (sessionDate < today) {
      return { canScan: false, status: "past_day", message: "Séance passée" };
    }
    return { canScan: false, status: "future_day", message: "Séance à venir" };
  }

  const start = parseTime(session.startTime);
  const end = parseTime(session.endTime);
  const startMinutes = start.hours * 60 + start.minutes;
  const endMinutes = end.hours * 60 + end.minutes;
  const scanAllowedFrom = startMinutes - 15;

  if (nowMinutes >= endMinutes) {
    return { canScan: false, status: "past", message: "Séance terminée" };
  }

  if (nowMinutes >= scanAllowedFrom && nowMinutes < endMinutes) {
    return { canScan: true, status: nowMinutes >= startMinutes ? "active" : "ready", message: "Scanner disponible" };
  }

  const waitMinutes = scanAllowedFrom - nowMinutes;
  const waitH = Math.floor(waitMinutes / 60);
  const waitM = waitMinutes % 60;
  const waitStr = waitH > 0 ? `${waitH}h${String(waitM).padStart(2, "0")}` : `${waitM} min`;

  return {
    canScan: false,
    status: "wait",
    message: `Disponible dans ${waitStr}`,
    waitMinutes,
  };
}

export default function ProfTimetablePage() {
  const { profProfile } = useAuth();
  const navigate = useNavigate();

  const now = new Date();
  const [week, setWeek]       = useState(getISOWeek(now));
  const [year, setYear]       = useState(now.getFullYear());
  const [sessions, setSessions] = useState<EdtSession[]>([]);
  const [monday, setMonday]   = useState("");
  const [loading, setLoading] = useState(true);
  const [selectedSession, setSelectedSession] = useState<EdtSession | null>(null);
  const [currentTime, setCurrentTime] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 30000);
    return () => clearInterval(timer);
  }, []);

  const todayStr = `${currentTime.getFullYear()}-${String(currentTime.getMonth() + 1).padStart(2, "0")}-${String(currentTime.getDate()).padStart(2, "0")}`;
  const nowMinutes = currentTime.getHours() * 60 + currentTime.getMinutes();

  const loadTimetable = useCallback(async () => {
    if (!profProfile) return;
    setLoading(true);
    try {
      const result = await getProfTimetable(profProfile.codeProf, week, year);
      if (result.success) {
        setSessions(result.sessions);
        setMonday(result.monday);
      } else {
        toast.error(result.message || "Erreur de chargement.");
        setSessions([]);
      }
    } catch {
      toast.error("Impossible de charger l'emploi du temps.");
    } finally {
      setLoading(false);
    }
  }, [profProfile, week, year]);

  useEffect(() => {
    if (!profProfile) {
      navigate("/prof-login");
      return;
    }
    loadTimetable();
  }, [profProfile, loadTimetable, navigate]);

  function changeWeek(delta: number) {
    let newWeek = week + delta;
    let newYear = year;
    if (newWeek < 1) { newYear -= 1; newWeek = 52; }
    else if (newWeek > 52) { newYear += 1; newWeek = 1; }
    setWeek(newWeek);
    setYear(newYear);
  }

  function goToday() {
    const today = new Date();
    setWeek(getISOWeek(today));
    setYear(today.getFullYear());
  }

  const sessionsByDay: Record<string, EdtSession[]> = {};
  for (const s of sessions) {
    if (!sessionsByDay[s.date]) sessionsByDay[s.date] = [];
    sessionsByDay[s.date].push(s);
  }

  const dayDates: string[] = [];
  if (monday) {
    const m = new Date(monday);
    for (let i = 0; i < 6; i++) {
      const d = new Date(m);
      d.setDate(d.getDate() + i);
      dayDates.push(d.toISOString().split("T")[0]);
    }
  }

  // Navigate to scan page — works for all sessions (scan page handles access control)
  function handleOpenSession(session: EdtSession) {
    const salleName = session.salles.length > 0 ? session.salles[0].nom : "";
    navigate(
      `/prof/scan?salle=${encodeURIComponent(salleName)}&matiere=${encodeURIComponent(session.displayName)}&seance=${session.codeSeance}&startTime=${encodeURIComponent(session.startTime)}&endTime=${encodeURIComponent(session.endTime)}&date=${encodeURIComponent(session.date)}`
    );
  }

  const isToday = (dateStr: string) => dateStr === todayStr;

  return (
    <ProfLayout>
      <div className="p-6">
        {/* Week Navigation */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-4 mb-6">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-3">
              <button
                onClick={() => changeWeek(-1)}
                className="w-9 h-9 rounded-xl bg-slate-100 hover:bg-slate-200 flex items-center justify-center transition-colors"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
              </button>
              <div className="text-center">
                <p className="text-lg font-bold text-slate-900">Semaine {week}</p>
                <p className="text-sm text-slate-500">{year}</p>
              </div>
              <button
                onClick={() => changeWeek(1)}
                className="w-9 h-9 rounded-xl bg-slate-100 hover:bg-slate-200 flex items-center justify-center transition-colors"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </button>
            </div>

            <div className="flex items-center gap-2">
              <button onClick={goToday} className="px-4 py-2 bg-teal-50 text-teal-700 rounded-xl text-sm font-medium hover:bg-teal-100 transition-colors">
                Aujourd'hui
              </button>
              <button onClick={loadTimetable} disabled={loading} className="px-4 py-2 bg-slate-100 text-slate-700 rounded-xl text-sm font-medium hover:bg-slate-200 transition-colors">
                {loading ? "Chargement…" : "Actualiser"}
              </button>
            </div>

            {monday && dayDates.length > 0 && (
              <p className="text-sm text-slate-500">
                {new Date(dayDates[0]).toLocaleDateString("fr-FR", { day: "numeric", month: "short" })}
                {" — "}
                {new Date(dayDates[5]).toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" })}
              </p>
            )}
          </div>
        </div>

        {loading && (
          <div className="flex items-center justify-center py-20">
            <div className="w-8 h-8 border-3 border-teal-200 border-t-teal-600 rounded-full animate-spin" />
          </div>
        )}

        {!loading && sessions.length === 0 && (
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-12 text-center">
            <div className="w-16 h-16 bg-slate-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
            </div>
            <h3 className="text-lg font-semibold text-slate-900 mb-1">Aucune séance</h3>
            <p className="text-slate-500 text-sm">Aucune séance trouvée pour la semaine {week}.</p>
          </div>
        )}

        {!loading && sessions.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
            {dayDates.map((dateStr, dayIndex) => {
              const daySessions = sessionsByDay[dateStr] || [];
              const today = isToday(dateStr);

              return (
                <div key={dateStr} className="space-y-2">
                  <div className={`rounded-xl px-3 py-2 text-center ${
                    today
                      ? "bg-teal-500 text-white shadow-md shadow-teal-200"
                      : "bg-white border border-slate-200"
                  }`}>
                    <p className={`text-sm font-bold ${today ? "text-white" : "text-slate-900"}`}>
                      {DAY_NAMES[dayIndex]}
                    </p>
                    <p className={`text-xs ${today ? "text-teal-100" : "text-slate-500"}`}>
                      {new Date(dateStr).toLocaleDateString("fr-FR", { day: "numeric", month: "short" })}
                    </p>
                  </div>

                  {daySessions.length === 0 && (
                    <div className="bg-slate-50 border border-dashed border-slate-200 rounded-xl p-4 text-center">
                      <p className="text-xs text-slate-400">Aucune séance</p>
                    </div>
                  )}

                  {daySessions.map((session) => {
                    const typeColor = TYPE_COLORS[String(session.codeTypeActivite)] || "bg-slate-100 border-slate-300 text-slate-800";
                    const status = getSessionStatus(session, todayStr, nowMinutes);

                    return (
                      <div
                        key={session.codeSeance}
                        className={`rounded-xl border-2 p-3 cursor-pointer hover:shadow-md transition-all ${typeColor}`}
                        onClick={() => setSelectedSession(session)}
                      >
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="text-xs font-bold">
                            {session.startTime} - {session.endTime}
                          </span>
                          {session.typeActivite && (
                            <span className="text-xs font-semibold px-1.5 py-0.5 rounded-md bg-white/60">
                              {session.typeActivite}
                            </span>
                          )}
                        </div>

                        <p className="text-sm font-bold leading-tight mb-1">
                          {session.displayName || session.matiere}
                        </p>

                        {session.salles.length > 0 && (
                          <div className="flex items-center gap-1 mt-1.5">
                            <svg className="w-3 h-3 opacity-60" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                            </svg>
                            <span className="text-xs font-medium">
                              {session.salles.map(s => s.alias || s.nom).join(", ")}
                            </span>
                          </div>
                        )}

                        {session.groupes.length > 0 && (
                          <div className="flex items-center gap-1 mt-1">
                            <svg className="w-3 h-3 opacity-60" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
                            </svg>
                            <span className="text-xs">
                              {session.groupes.map(g => g.alias || g.nom).join(", ")}
                            </span>
                          </div>
                        )}

                        {/* Action button — TODAY */}
                        {today && (
                          <div className="mt-2">
                            {status.canScan ? (
                              <button
                                onClick={(e) => { e.stopPropagation(); handleOpenSession(session); }}
                                className="w-full py-1.5 bg-white/80 hover:bg-white rounded-lg text-xs font-semibold text-teal-700 transition-colors flex items-center justify-center gap-1"
                              >
                                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                    d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z" />
                                </svg>
                                {status.status === "active" ? "Scanner présences" : "Scanner (pré-séance)"}
                              </button>
                            ) : status.status === "wait" ? (
                              <div className="w-full py-1.5 bg-amber-50/80 rounded-lg text-xs font-medium text-amber-700 text-center flex items-center justify-center gap-1">
                                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                    d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                                </svg>
                                {status.message}
                              </div>
                            ) : status.status === "past" ? (
                              <button
                                onClick={(e) => { e.stopPropagation(); handleOpenSession(session); }}
                                className="w-full py-1.5 bg-slate-100/80 hover:bg-slate-200/80 rounded-lg text-xs font-medium text-slate-500 transition-colors flex items-center justify-center gap-1"
                              >
                                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                    d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                                </svg>
                                Consulter PV
                              </button>
                            ) : null}
                          </div>
                        )}

                        {/* Action button — NOT TODAY */}
                        {!today && (
                          <div className="mt-2">
                            {status.status === "past_day" ? (
                              <button
                                onClick={(e) => { e.stopPropagation(); handleOpenSession(session); }}
                                className="w-full py-1 bg-slate-100/60 hover:bg-slate-200/60 rounded-lg text-xs text-slate-500 text-center transition-colors flex items-center justify-center gap-1"
                              >
                                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                    d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                                </svg>
                                Consulter PV
                              </button>
                            ) : (
                              <div className="w-full py-1 bg-blue-50/60 rounded-lg text-xs text-blue-400 text-center">
                                À venir
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        )}

        {/* Session Detail Modal */}
        {selectedSession && (() => {
          const status = getSessionStatus(selectedSession, todayStr, nowMinutes);
          const isPast = status.status === "past" || status.status === "past_day";

          return (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
              <div className="fixed inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setSelectedSession(null)} />
              <div className="relative bg-white rounded-2xl shadow-2xl max-w-md w-full p-6 z-10">
                <button
                  onClick={() => setSelectedSession(null)}
                  className="absolute top-4 right-4 w-8 h-8 rounded-lg bg-slate-100 hover:bg-slate-200 flex items-center justify-center"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>

                <h3 className="text-lg font-bold text-slate-900 mb-4">Détails de la séance</h3>

                <div className="space-y-3">
                  <div className="bg-slate-50 rounded-xl p-3">
                    <p className="text-xs text-slate-500 mb-1">Matière</p>
                    <p className="font-semibold text-slate-900">{selectedSession.displayName || selectedSession.matiere}</p>
                    {selectedSession.enseignement && (
                      <p className="text-xs text-slate-500 mt-0.5">{selectedSession.enseignement}</p>
                    )}
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="bg-slate-50 rounded-xl p-3">
                      <p className="text-xs text-slate-500 mb-1">Date</p>
                      <p className="font-semibold text-slate-900 text-sm">
                        {new Date(selectedSession.date).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" })}
                      </p>
                    </div>
                    <div className="bg-slate-50 rounded-xl p-3">
                      <p className="text-xs text-slate-500 mb-1">Horaire</p>
                      <p className="font-semibold text-slate-900 text-sm">
                        {selectedSession.startTime} → {selectedSession.endTime}
                      </p>
                      <p className="text-xs text-slate-400">{selectedSession.duration}</p>
                    </div>
                  </div>

                  {selectedSession.typeActivite && (
                    <div className="bg-slate-50 rounded-xl p-3">
                      <p className="text-xs text-slate-500 mb-1">Type</p>
                      <p className="font-semibold text-slate-900 text-sm">{selectedSession.typeActivite}</p>
                    </div>
                  )}

                  {selectedSession.salles.length > 0 && (
                    <div className="bg-slate-50 rounded-xl p-3">
                      <p className="text-xs text-slate-500 mb-1">Salle(s)</p>
                      <p className="font-semibold text-slate-900 text-sm">
                        {selectedSession.salles.map(s => s.nom).join(", ")}
                      </p>
                    </div>
                  )}

                  {selectedSession.groupes.length > 0 && (
                    <div className="bg-slate-50 rounded-xl p-3">
                      <p className="text-xs text-slate-500 mb-1">Groupe(s)</p>
                      <p className="font-semibold text-slate-900 text-sm">
                        {selectedSession.groupes.map(g => g.nom).join(", ")}
                      </p>
                    </div>
                  )}

                  {/* Status indicator */}
                  <div className={`rounded-xl p-3 ${
                    status.canScan ? "bg-emerald-50 border border-emerald-200" :
                    status.status === "wait" ? "bg-amber-50 border border-amber-200" :
                    isPast ? "bg-slate-50 border border-slate-200" :
                    "bg-blue-50 border border-blue-200"
                  }`}>
                    <div className="flex items-center gap-2">
                      {status.canScan ? (
                        <div className="w-2 h-2 rounded-full bg-emerald-500 pulse-dot" />
                      ) : status.status === "wait" ? (
                        <svg className="w-4 h-4 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                            d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                      ) : (
                        <div className={`w-2 h-2 rounded-full ${isPast ? "bg-slate-400" : "bg-blue-400"}`} />
                      )}
                      <p className={`text-sm font-medium ${
                        status.canScan ? "text-emerald-700" :
                        status.status === "wait" ? "text-amber-700" :
                        isPast ? "text-slate-500" :
                        "text-blue-500"
                      }`}>
                        {status.message}
                      </p>
                    </div>
                  </div>
                </div>

                {/* Modal action button */}
                {status.canScan ? (
                  <button
                    onClick={() => {
                      handleOpenSession(selectedSession);
                      setSelectedSession(null);
                    }}
                    className="mt-5 w-full py-3 bg-teal-600 hover:bg-teal-700 text-white rounded-xl font-semibold transition-colors flex items-center justify-center gap-2"
                  >
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                        d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z" />
                    </svg>
                    Lancer le scan de présences
                  </button>
                ) : isPast ? (
                  <button
                    onClick={() => {
                      handleOpenSession(selectedSession);
                      setSelectedSession(null);
                    }}
                    className="mt-5 w-full py-3 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-xl font-semibold transition-colors flex items-center justify-center gap-2"
                  >
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                        d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                    </svg>
                    Consulter le PV de présences
                  </button>
                ) : (
                  <button
                    disabled
                    className="mt-5 w-full py-3 bg-slate-100 text-slate-400 rounded-xl font-semibold cursor-not-allowed flex items-center justify-center gap-2"
                  >
                    {status.status === "wait" ? (
                      <>
                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                            d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        {status.message}
                      </>
                    ) : (
                      <>{status.message}</>
                    )}
                  </button>
                )}
              </div>
            </div>
          );
        })()}
      </div>
    </ProfLayout>
  );
}