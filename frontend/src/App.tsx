import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { ThemeProvider } from './contexts/ThemeContext';
import { Login } from './pages/Login';
import { Dashboard } from './pages/Dashboard';
import { ClientBooking } from './pages/ClientBooking';
import { ClientPortal } from './pages/ClientPortal';
import { Home } from './pages/Home';
import './App.css';

// Guard component for authenticated routes
const ProtectedRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { token, loading } = useAuth();

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: '#121212', color: '#ffffff' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ width: '40px', height: '40px', border: '3px solid #d4af37', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 1s linear infinite', margin: '0 auto 16px auto' }} />
          <p>Verificando sessão...</p>
        </div>
        <style>{`
          @keyframes spin {
            to { transform: rotate(360deg); }
          }
        `}</style>
      </div>
    );
  }

  if (!token) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
};

const AppContent: React.FC = () => {
  const { revocationReason, logout } = useAuth();

  if (revocationReason) {
    const isExpired = revocationReason === 'expired';
    const mainColor = isExpired ? '#e2a857' : '#ef4444';
    const bgLightColor = isExpired ? 'rgba(226, 168, 87, 0.1)' : 'rgba(239, 68, 68, 0.1)';
    const borderCardColor = isExpired ? 'rgba(226, 168, 87, 0.2)' : 'rgba(239, 68, 68, 0.2)';
    
    return (
      <div style={{ 
        minHeight: '100vh', 
        display: 'flex', 
        alignItems: 'center', 
        justifyContent: 'center', 
        backgroundColor: '#0f0f11', 
        color: '#ffffff',
        fontFamily: 'Inter, system-ui, Avenir, Helvetica, Arial, sans-serif',
        padding: '20px'
      }}>
        <div style={{ 
          maxWidth: '460px', 
          width: '100%',
          textAlign: 'center', 
          padding: '40px 24px',
          borderRadius: '16px',
          background: 'rgba(30, 30, 36, 0.6)',
          backdropFilter: 'blur(10px)',
          border: `1px solid ${borderCardColor}`,
          boxShadow: '0 10px 30px rgba(0,0,0,0.5)'
        }}>
          <div style={{ 
            width: '72px', 
            height: '72px', 
            borderRadius: '50%', 
            background: bgLightColor, 
            border: `2px solid ${mainColor}`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            margin: '0 auto 24px auto',
            color: mainColor
          }}>
            {isExpired ? (
              <svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10"></circle>
                <polyline points="12 6 12 12 16 14"></polyline>
              </svg>
            ) : (
              <svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
                <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
              </svg>
            )}
          </div>
          
          <h1 style={{ fontSize: '24px', fontWeight: 'bold', marginBottom: '16px', color: mainColor }}>
            {isExpired ? 'Assinatura Expirada' : 'Acesso Revogado'}
          </h1>
          
          <p style={{ fontSize: '14px', color: 'rgba(255,255,255,0.7)', lineHeight: '1.6', marginBottom: '32px' }}>
            {isExpired 
              ? 'O período de testes ou a licença de assinatura deste estabelecimento chegou ao fim. Entre em contato com a nossa equipe de suporte para realizar o pagamento e reativar o seu painel.' 
              : 'Seu acesso à plataforma BarberHub foi suspenso. Por favor, entre em contato com o proprietário do estabelecimento ou com o administrador do sistema para reativar seu cadastro.'
            }
          </p>
          
          <button 
            onClick={logout}
            style={{ 
              width: '100%',
              padding: '12px 24px',
              borderRadius: '8px',
              border: 'none',
              background: mainColor,
              color: isExpired ? '#121212' : '#ffffff',
              fontWeight: 'bold',
              cursor: 'pointer',
              fontSize: '14px',
              transition: 'opacity 0.2s ease'
            }}
            onMouseOver={(e) => e.currentTarget.style.opacity = '0.9'}
            onMouseOut={(e) => e.currentTarget.style.opacity = '1'}
          >
            Voltar para o Login
          </button>
        </div>
      </div>
    );
  }

  return (
    <Router>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/login" element={<Login />} />
        <Route path="/register-owner" element={<Navigate to="/login" replace />} />
        <Route path="/book/:slug" element={<ClientBooking />} />
        <Route path="/portal" element={<ClientPortal />} />
        <Route 
          path="/dashboard" 
          element={
            <ProtectedRoute>
              <Dashboard />
            </ProtectedRoute>
          } 
        />
        {/* Fallback routing */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Router>
  );
};

function App() {
  return (
    <AuthProvider>
      <ThemeProvider>
        <AppContent />
      </ThemeProvider>
    </AuthProvider>
  );
}

export default App;
