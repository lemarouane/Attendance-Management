import { Navigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { ReactNode } from "react";

interface Props {
  children: ReactNode;
  requiredRole?: string;
}

export default function ProtectedRoute({ children, requiredRole }: Props) {
  const { firebaseUser, role, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 border-4 border-emerald-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-gray-400 text-sm">Loading...</p>
        </div>
      </div>
    );
  }

  if (!firebaseUser) {
    if (requiredRole === "admin") return <Navigate to="/admin-login" replace />;
    if (requiredRole === "prof") return <Navigate to="/prof-login" replace />;
    return <Navigate to="/login" replace />;
  }

  if (requiredRole && role !== requiredRole) {
    // Special case: prof uses admin Firebase account, so allow "admin" role to access prof routes
    // if they have a prof session active
    if (requiredRole === "prof" && role !== "prof") {
      return <Navigate to="/prof-login" replace />;
    }
    if (requiredRole === "admin" && role !== "admin") {
      return <Navigate to="/admin-login" replace />;
    }
    if (requiredRole === "student" && role !== "student") {
      if (role === "admin") return <Navigate to="/admin-scan" replace />;
      if (role === "prof") return <Navigate to="/prof/timetable" replace />;
      return <Navigate to="/dashboard" replace />;
    }
  }

  return <>{children}</>;
}