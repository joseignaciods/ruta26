import { Navigate, Route, Routes } from 'react-router-dom'
import { useAuth } from './state/AuthContext.jsx'
import AuthPage from './screens/AuthPage.jsx'
import TripsPage from './screens/TripsPage.jsx'
import TripWorkspace from './screens/TripWorkspace.jsx'
import JoinPage from './screens/JoinPage.jsx'

function Protected({ children }) {
  const { user, loading } = useAuth()
  if (loading) return <div className="center-page">Cargando...</div>
  return user ? children : <Navigate to="/login" replace />
}

export default function App() {
  const { user } = useAuth()
  const pendingInvite = localStorage.getItem('ruta26_pending_invite')
  return (
    <Routes>
      <Route path="/login" element={user ? <Navigate to={pendingInvite ? `/join/${pendingInvite}` : '/trips'} replace /> : <AuthPage />} />
      <Route path="/register" element={user ? <Navigate to={pendingInvite ? `/join/${pendingInvite}` : '/trips'} replace /> : <AuthPage initialMode="register" />} />
      <Route path="/join/:token" element={<JoinPage />} />
      <Route path="/trips" element={<Protected><TripsPage /></Protected>} />
      <Route path="/trips/:tripId/*" element={<Protected><TripWorkspace /></Protected>} />
      <Route path="*" element={<Navigate to={user ? '/trips' : '/login'} replace />} />
    </Routes>
  )
}
