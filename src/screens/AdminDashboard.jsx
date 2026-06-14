import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { hasSupabase } from '../lib/supabase.js'
import AdminUsersList from '../components/admin/AdminUsersList.jsx'
import AdminUserDetail from '../components/admin/AdminUserDetail.jsx'
import AdminSettings from '../components/admin/AdminSettings.jsx'

export default function AdminDashboard() {
  const navigate = useNavigate()
  const [section, setSection] = useState('users')
  const [selectedUser, setSelectedUser] = useState(null)
  return (
    <main className="dashboard admin-dashboard">
      <header className="dashboard-header">
        <div><span className="eyebrow">RUTA 26</span><h1>Administración</h1><p>Usuarios, consumo y límites</p></div>
        <button className="ghost-btn" onClick={() => navigate('/trips')}>Volver</button>
      </header>
      {!hasSupabase ? <div className="notice">El panel de administración requiere Supabase.</div> : selectedUser ? (
        <AdminUserDetail userId={selectedUser} onBack={() => setSelectedUser(null)} />
      ) : (
        <>
          <div className="subtabs admin-tabs">
            <button className={section === 'users' ? 'active' : ''} onClick={() => setSection('users')}>Usuarios</button>
            <button className={section === 'settings' ? 'active' : ''} onClick={() => setSection('settings')}>Ajustes</button>
          </div>
          {section === 'users' ? <AdminUsersList onSelect={setSelectedUser} /> : <AdminSettings />}
        </>
      )}
    </main>
  )
}
