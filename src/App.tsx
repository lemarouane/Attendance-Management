import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { Toaster } from "react-hot-toast";
import { AuthProvider } from "./context/AuthContext";
import ProtectedRoute from "./components/ProtectedRoute";
import LoginPage from "./pages/LoginPage";
import AdminLoginPage from "./pages/AdminLoginPage";
import RegisterPage from "./pages/RegisterPage";
import DashboardPage from "./pages/DashboardPage";
import AdminScanPage from "./pages/AdminScanPage";
import AdminAttendancePage from "./pages/AdminAttendancePage";
import AdminStudentsPage from "./pages/AdminStudentsPage";
import AdminArchivePage from "./pages/AdminArchivePage";
import AdminPendingPage from "./pages/AdminPendingPage";

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
          <Route path="/" element={<Navigate to="/login" replace />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/admin-login" element={<AdminLoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route
            path="/dashboard"
            element={
              <ProtectedRoute requiredRole="student">
                <DashboardPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin-scan"
            element={
              <ProtectedRoute requiredRole="admin">
                <AdminScanPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/attendance"
            element={
              <ProtectedRoute requiredRole="admin">
                <AdminAttendancePage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/students"
            element={
              <ProtectedRoute requiredRole="admin">
                <AdminStudentsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/archive"
            element={
              <ProtectedRoute requiredRole="admin">
                <AdminArchivePage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/students/pending"
            element={
              <ProtectedRoute requiredRole="admin">
                <AdminPendingPage />
              </ProtectedRoute>
            }
          />
          <Route path="*" element={<Navigate to="/login" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
