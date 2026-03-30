import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { Toaster } from "react-hot-toast";
import { AuthProvider } from "./context/AuthContext";
import ProtectedRoute from "./components/ProtectedRoute";
import UnifiedLoginPage from "./pages/UnifiedLoginPage";
import RegisterPage from "./pages/RegisterPage";
import DashboardPage from "./pages/DashboardPage";
import AdminScanPage from "./pages/AdminScanPage";
import AdminAttendancePage from "./pages/AdminAttendancePage";
import AdminStudentsPage from "./pages/AdminStudentsPage";
import AdminArchivePage from "./pages/AdminArchivePage";
import AdminPendingPage from "./pages/AdminPendingPage";
import ProfTimetablePage from "./pages/ProfTimetablePage";
import ProfScanPage from "./pages/ProfScanPage";

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Toaster
          position="top-right"
          toastOptions={{
            style: {
              background: "#ffffff",
              color: "#111827",
              border: "1px solid #e5e7eb",
              borderRadius: "12px",
              fontSize: "14px",
              boxShadow: "0 4px 24px rgba(0,0,0,0.08)",
            },
            success: { iconTheme: { primary: "#10b981", secondary: "#ffffff" } },
            error:   { iconTheme: { primary: "#ef4444", secondary: "#ffffff" } },
          }}
        />
        <Routes>
          {/* ── Public ────────────────────────────────────────────────────── */}
          <Route path="/"            element={<Navigate to="/login" replace />} />
          <Route path="/login"       element={<UnifiedLoginPage />} />
          <Route path="/register"    element={<RegisterPage />} />

          {/* Old login routes → redirect to unified login */}
          <Route path="/admin-login" element={<Navigate to="/login" replace />} />
          <Route path="/prof-login"  element={<Navigate to="/login" replace />} />

          {/* ── Student ───────────────────────────────────────────────────── */}
          <Route path="/dashboard" element={
            <ProtectedRoute requiredRole="student"><DashboardPage /></ProtectedRoute>
          } />

          {/* ── Admin ─────────────────────────────────────────────────────── */}
          <Route path="/admin-scan" element={
            <ProtectedRoute requiredRole="admin"><AdminScanPage /></ProtectedRoute>
          } />
          <Route path="/admin/attendance" element={
            <ProtectedRoute requiredRole="admin"><AdminAttendancePage /></ProtectedRoute>
          } />
          <Route path="/admin/students" element={
            <ProtectedRoute requiredRole="admin"><AdminStudentsPage /></ProtectedRoute>
          } />
          <Route path="/admin/archive" element={
            <ProtectedRoute requiredRole="admin"><AdminArchivePage /></ProtectedRoute>
          } />
          <Route path="/admin/students/pending" element={
            <ProtectedRoute requiredRole="admin"><AdminPendingPage /></ProtectedRoute>
          } />

          {/* ── Prof ──────────────────────────────────────────────────────── */}
          <Route path="/prof/timetable" element={
            <ProtectedRoute requiredRole="prof"><ProfTimetablePage /></ProtectedRoute>
          } />
          <Route path="/prof/scan" element={
            <ProtectedRoute requiredRole="prof"><ProfScanPage /></ProtectedRoute>
          } />

          {/* ── Fallback ──────────────────────────────────────────────────── */}
          <Route path="*" element={<Navigate to="/login" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}