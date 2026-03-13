import { Link } from "react-router-dom";

export default function PendingPage() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-amber-50 to-orange-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-32 -right-32 w-96 h-96 bg-amber-100 rounded-full opacity-60 blur-3xl" />
        <div className="absolute -bottom-32 -left-32 w-96 h-96 bg-orange-100 rounded-full opacity-60 blur-3xl" />
      </div>

      <div className="w-full max-w-md relative z-10 text-center fade-in">
        <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-amber-100 border-4 border-amber-200 mb-6">
          <svg className="w-10 h-10 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>

        <h1 className="text-2xl font-bold text-gray-900 mb-2">Inscription soumise !</h1>
        <p className="text-gray-500 mb-8 text-sm leading-relaxed">
          La vérification biométrique n'a pas pu confirmer automatiquement votre identité.<br />
          Votre dossier est en attente de validation manuelle par un administrateur.
        </p>

        <div className="bg-white rounded-2xl shadow-lg shadow-gray-200/80 border border-gray-100 p-6 mb-6 text-left space-y-3">
          <h2 className="font-semibold text-gray-900 mb-3">Que se passe-t-il ensuite ?</h2>
          {[
            { icon: "📋", text: "L'admin examine vos photos CIN et selfie manuellement" },
            { icon: "✅", text: "Votre compte est validé par un administrateur" },
            { icon: "🔐", text: "Vous pourrez vous connecter avec votre code apogée" },
            { icon: "📱", text: "Votre compte est verrouillé à votre appareil à la première connexion" },
          ].map(({ icon, text }) => (
            <div key={text} className="flex items-center gap-3">
              <span className="text-xl">{icon}</span>
              <span className="text-gray-600 text-sm">{text}</span>
            </div>
          ))}
        </div>

        {/* Why it wasn't auto-validated */}
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 mb-6 text-left">
          <p className="text-amber-800 text-sm font-semibold mb-2">⚠️ Pourquoi validation manuelle ?</p>
          <p className="text-amber-700 text-xs leading-relaxed">
            La vérification automatique compare votre selfie avec la photo de votre CIN.
            Si la qualité des images est insuffisante ou si les visages ne correspondent pas avec
            certitude, le système préfère laisser un administrateur décider pour éviter toute erreur.
          </p>
        </div>

        <div className="flex flex-col gap-3">
          <Link
            to="/login"
            className="w-full bg-emerald-500 hover:bg-emerald-600 text-white font-semibold py-3 rounded-xl transition-all shadow-md shadow-emerald-100 text-center"
          >
            Essayer de se connecter
          </Link>
          <p className="text-gray-400 text-xs">
            Si la validation tarde, contactez votre administrateur.
          </p>
        </div>
      </div>
    </div>
  );
}