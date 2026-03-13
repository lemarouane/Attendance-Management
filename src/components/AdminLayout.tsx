import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { logoutUser } from "../services/authService";
import toast from "react-hot-toast";

interface AdminLayoutProps {
  children: React.ReactNode;
  title?: string;
  subtitle?: string;
}

const NAV = [
  {
    section: "Principal",
    items: [
      {
        path: "/admin-scan",
        label: "Scanner QR",
        icon: (
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z" />
          </svg>
        ),
        accent: "indigo",
      },
    ],
  },
  {
    section: "Étudiants",
    items: [
      {
        path: "/admin/students",
        label: "Tous les étudiants",
        icon: (
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
        ),
        accent: "blue",
      },
      {
        path: "/admin/students/pending",
        label: "En attente",
        icon: (
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        ),
        accent: "amber",
        badge: "pending",
      },
    ],
  },
  {
    section: "Présences",
    items: [
      {
        path: "/admin/attendance",
        label: "Rapport présences",
        icon: (
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
          </svg>
        ),
        accent: "emerald",
      },
      {
        path: "/admin/archive",
        label: "Archive",
        icon: (
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
          </svg>
        ),
        accent: "purple",
      },
    ],
  },
];

const accentMap: Record<string, { bg: string; text: string; dot: string }> = {
  indigo:  { bg: "bg-indigo-50",  text: "text-indigo-600",  dot: "bg-indigo-500"  },
  blue:    { bg: "bg-blue-50",    text: "text-blue-600",    dot: "bg-blue-500"    },
  amber:   { bg: "bg-amber-50",   text: "text-amber-600",   dot: "bg-amber-500"   },
  emerald: { bg: "bg-emerald-50", text: "text-emerald-600", dot: "bg-emerald-500" },
  purple:  { bg: "bg-purple-50",  text: "text-purple-600",  dot: "bg-purple-500"  },
};

export default function AdminLayout({ children, title, subtitle }: AdminLayoutProps) {
  const location  = useLocation();
  const navigate  = useNavigate();
  const { firebaseUser } = useAuth();
  const [collapsed,   setCollapsed]   = useState(false);
  const [mobileOpen,  setMobileOpen]  = useState(false);

  async function handleLogout() {
    await logoutUser();
    toast.success("Déconnexion réussie.");
    navigate("/admin-login");
  }

  function isActive(path: string) {
    return location.pathname === path;
  }

  const pageTitles: Record<string, { title: string; subtitle: string }> = {
    "/admin-scan":              { title: "Scanner QR",           subtitle: "Scannez les codes QR des étudiants" },
    "/admin/students":          { title: "Étudiants",            subtitle: "Gestion des comptes étudiants" },
    "/admin/students/pending":  { title: "En attente",           subtitle: "Comptes en attente de validation" },
    "/admin/attendance":        { title: "Rapport de présences", subtitle: "Historique des présences par salle" },
    "/admin/archive":           { title: "Archive",              subtitle: "Historique permanent de toutes les présences" },
  };
  const currentPage = pageTitles[location.pathname] || { title: title || "Tableau de bord", subtitle: subtitle || "" };

  const SidebarContent = (
    <aside
      className={`${collapsed ? "w-16" : "w-60"} h-screen bg-white border-r border-slate-200 flex flex-col sticky top-0 transition-all duration-300 z-40 shadow-sm`}
    >
      {/* Logo */}
      <div className={`flex items-center gap-3 px-4 py-5 border-b border-slate-100 ${collapsed ? "justify-center" : ""}`}>
        <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center flex-shrink-0 shadow-md shadow-indigo-200">
          <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
          </svg>
        </div>
        {!collapsed && (
          <div className="min-w-0 flex-1">
            <p className="font-bold text-slate-900 text-sm leading-none">ENSAT</p>
            <p className="text-xs text-indigo-500 font-medium mt-0.5">Panneau Admin</p>
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

      {/* Nav */}
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
                const accent = accentMap[item.accent] || accentMap["indigo"];
                return (
                  <Link
                    key={item.path}
                    to={item.path}
                    onClick={() => setMobileOpen(false)}
                    title={collapsed ? item.label : undefined}
                    className={`flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all duration-200 group ${
                      active
                        ? "nav-active"
                        : `text-slate-600 hover:bg-slate-50 hover:text-slate-900`
                    } ${collapsed ? "justify-center" : ""}`}
                  >
                    <span className={`flex-shrink-0 ${active ? "text-white" : `${accent.text} group-hover:${accent.text}`}`}>
                      {item.icon}
                    </span>
                    {!collapsed && (
                      <span className="text-sm font-medium truncate flex-1">{item.label}</span>
                    )}
                    {!collapsed && item.badge === "pending" && !active && (
                      <span className="w-2 h-2 rounded-full bg-amber-400 flex-shrink-0" />
                    )}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* Footer */}
      <div className="border-t border-slate-100 p-3 space-y-1">
        {!collapsed && firebaseUser && (
          <div className="px-3 py-2 mb-1 bg-slate-50 rounded-xl">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-indigo-100 flex items-center justify-center">
                <svg className="w-4 h-4 text-indigo-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                </svg>
              </div>
              <div className="min-w-0">
                <p className="text-xs font-semibold text-slate-700 truncate">{firebaseUser.email}</p>
                <p className="text-xs text-slate-400">Administrateur</p>
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
      {/* Desktop */}
      <div className="hidden md:flex flex-shrink-0">{SidebarContent}</div>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div className="md:hidden fixed inset-0 z-50 flex">
          <div className="fixed inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setMobileOpen(false)} />
          <div className="relative">{SidebarContent}</div>
        </div>
      )}

      {/* Main */}
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        {/* Top bar */}
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
            <div className="w-2 h-2 rounded-full bg-emerald-400 pulse-dot" />
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
