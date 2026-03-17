import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { logoutUser } from "../services/authService";
import toast from "react-hot-toast";

interface ProfLayoutProps {
  children: React.ReactNode;
  title?: string;
  subtitle?: string;
}

const NAV = [
  {
    section: "Principal",
    items: [
      {
        path: "/prof/timetable",
        label: "Emploi du temps",
        icon: (
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
        ),
        accent: "teal",
      },
    ],
  },
];

const accentMap: Record<string, { text: string }> = {
  teal: { text: "text-teal-600" },
};

export default function ProfLayout({ children, title, subtitle }: ProfLayoutProps) {
  const location  = useLocation();
  const navigate  = useNavigate();
  const { profProfile } = useAuth();
  const [collapsed,  setCollapsed]  = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  async function handleLogout() {
    sessionStorage.removeItem("profProfile");
    sessionStorage.removeItem("activeRole");
    await logoutUser();
    toast.success("Déconnexion réussie.");
    navigate("/prof-login");
  }

  function isActive(p: string) {
    return location.pathname.startsWith(p);
  }

  const pageTitles: Record<string, { title: string; subtitle: string }> = {
    "/prof/timetable": { title: "Emploi du temps", subtitle: "Votre planning de la semaine" },
    "/prof/scan":      { title: "Scanner QR",      subtitle: "Scanner les présences étudiants" },
  };
  const currentPage = pageTitles[location.pathname] || {
    title: title || "Espace Professeur",
    subtitle: subtitle || "",
  };

  const SidebarContent = (
    <aside
      className={`${collapsed ? "w-16" : "w-60"} h-screen bg-white border-r border-slate-200 flex flex-col sticky top-0 transition-all duration-300 z-40 shadow-sm`}
    >
      <div className={`flex items-center gap-3 px-4 py-5 border-b border-slate-100 ${collapsed ? "justify-center" : ""}`}>
        <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-teal-500 to-emerald-600 flex items-center justify-center flex-shrink-0 shadow-md shadow-teal-200">
          <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
          </svg>
        </div>
        {!collapsed && (
          <div className="min-w-0 flex-1">
            <p className="font-bold text-slate-900 text-sm leading-none">ENSAT</p>
            <p className="text-xs text-teal-500 font-medium mt-0.5">Espace Professeur</p>
          </div>
        )}
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="ml-auto w-7 h-7 rounded-lg hover:bg-slate-100 flex items-center justify-center text-slate-400 transition-colors flex-shrink-0"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d={collapsed ? "M9 5l7 7-7 7" : "M15 19l-7-7 7-7"} />
          </svg>
        </button>
      </div>

      <nav className="flex-1 overflow-y-auto py-4 px-2 space-y-5">
        {NAV.map((section) => (
          <div key={section.section}>
            {!collapsed && (
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-widest px-3 mb-2">
                {section.section}
              </p>
            )}
            <div className="space-y-1">
              {section.items.map((item) => {
                const active = isActive(item.path);
                const accent = accentMap[item.accent] || accentMap["teal"];
                return (
                  <Link
                    key={item.path}
                    to={item.path}
                    onClick={() => setMobileOpen(false)}
                    title={collapsed ? item.label : undefined}
                    className={`flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all duration-200 group ${
                      active
                        ? "bg-gradient-to-r from-teal-500 to-emerald-600 text-white shadow-md shadow-teal-200"
                        : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                    } ${collapsed ? "justify-center" : ""}`}
                  >
                    <span className={`flex-shrink-0 ${active ? "text-white" : accent.text}`}>
                      {item.icon}
                    </span>
                    {!collapsed && (
                      <span className="text-sm font-medium truncate flex-1">{item.label}</span>
                    )}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      <div className="border-t border-slate-100 p-3 space-y-1">
        {!collapsed && profProfile && (
          <div className="px-3 py-2 mb-1 bg-teal-50 rounded-xl">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-teal-100 flex items-center justify-center">
                <svg className="w-4 h-4 text-teal-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                </svg>
              </div>
              <div className="min-w-0">
                <p className="text-xs font-semibold text-slate-700 truncate">
                  {profProfile.prenom} {profProfile.nom}
                </p>
                <p className="text-xs text-slate-400">PPR: {profProfile.identifiant}</p>
              </div>
            </div>
          </div>
        )}
        <button
          onClick={handleLogout}
          className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-red-500 hover:bg-red-50 transition-all duration-200 ${collapsed ? "justify-center" : ""}`}
          title={collapsed ? "Déconnexion" : undefined}
        >
          <svg className="w-5 h-5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
          </svg>
          {!collapsed && <span className="text-sm font-medium">Déconnexion</span>}
        </button>
      </div>
    </aside>
  );

  return (
    <div className="flex h-screen bg-slate-100 overflow-hidden">
      <div className="hidden md:flex flex-shrink-0">{SidebarContent}</div>
      {mobileOpen && (
        <div className="md:hidden fixed inset-0 z-50 flex">
          <div className="fixed inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setMobileOpen(false)} />
          <div className="relative">{SidebarContent}</div>
        </div>
      )}
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        <header className="bg-white border-b border-slate-200 px-6 py-4 flex items-center gap-4 flex-shrink-0">
          <button
            className="md:hidden w-9 h-9 rounded-xl hover:bg-slate-100 flex items-center justify-center text-slate-600 transition-colors"
            onClick={() => setMobileOpen(true)}
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          <div className="flex-1 min-w-0">
            <h1 className="text-lg font-bold text-slate-900 leading-none">{currentPage.title}</h1>
            {currentPage.subtitle && (
              <p className="text-sm text-slate-500 mt-0.5">{currentPage.subtitle}</p>
            )}
          </div>
          <div className="flex items-center gap-2 text-xs text-slate-500 bg-slate-50 border border-slate-200 px-3 py-2 rounded-xl">
            <div className="w-2 h-2 rounded-full bg-emerald-400" />
            <span>{new Date().toLocaleDateString("fr-MA", { dateStyle: "long" })}</span>
          </div>
        </header>
        <main className="flex-1 overflow-y-auto p-6">
          {children}
        </main>
      </div>
    </div>
  );
}