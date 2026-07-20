import React, { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { Scissors, Lock, Mail, ChevronRight } from 'lucide-react';

export const Login: React.FC = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  
  const { login, user } = useAuth();
  const navigate = useNavigate();

  // Reset theme variables to BarberHub default landing page colors
  useEffect(() => {
    document.documentElement.style.setProperty('--primary', '#d4af37');
    document.documentElement.style.setProperty('--secondary', '#ffffff');
    document.documentElement.style.setProperty('--background', '#121212');
    document.documentElement.style.setProperty('--foreground', '#ffffff');
    document.documentElement.style.setProperty('--muted', '#a3a3a3');
    document.documentElement.style.setProperty('--card', '#1e1e1e');
  }, []);

  // Redirect if already logged in
  useEffect(() => {
    if (user) {
      navigate('/dashboard');
    }
  }, [user, navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      await login(email, password);
      navigate('/dashboard');
    } catch (err: any) {
      setError(err.message || 'Credenciais inválidas. Verifique os dados inseridos.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ display: 'flex', minHeight: '100vh', alignItems: 'center', justifyContent: 'center', padding: '20px', backgroundColor: '#121212' }}>
      <div className="glass-panel animate-fade-in" style={{ width: '100%', maxWidth: '440px', padding: '40px', border: '1px solid rgba(255, 255, 255, 0.08)', backgroundColor: '#1e1e1e' }}>
        <div style={{ textAlign: 'center', marginBottom: '32px' }}>
          <div style={{ display: 'inline-flex', padding: '12px', borderRadius: '50%', backgroundColor: 'rgba(212, 175, 55, 0.1)', color: '#d4af37', marginBottom: '16px' }}>
            <Scissors size={32} />
          </div>
          <h2 style={{ fontSize: '28px', color: '#ffffff', fontWeight: 'bold', letterSpacing: '0.5px' }}>
            BarberHub
          </h2>
          <p style={{ color: '#a3a3a3', fontSize: '14px', marginTop: '8px' }}>Painel de Gestão & Agendamentos</p>
        </div>

        {error && (
          <div style={{ backgroundColor: 'rgba(239, 68, 68, 0.1)', border: '1px solid #ef4444', color: '#ef4444', padding: '12px', borderRadius: '8px', marginBottom: '20px', fontSize: '14px' }}>
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-label" style={{ color: '#ffffff' }}>E-mail de Acesso</label>
            <div style={{ position: 'relative' }}>
              <span style={{ position: 'absolute', left: '14px', top: '14px', color: '#a3a3a3' }}><Mail size={18} /></span>
              <input
                type="email"
                className="form-input"
                style={{ paddingLeft: '42px', backgroundColor: '#121212', color: '#ffffff', border: '1px solid rgba(255,255,255,0.1)' }}
                placeholder="nome@exemplo.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
          </div>

          <div className="form-group">
            <label className="form-label" style={{ color: '#ffffff' }}>Senha</label>
            <div style={{ position: 'relative' }}>
              <span style={{ position: 'absolute', left: '14px', top: '14px', color: '#a3a3a3' }}><Lock size={18} /></span>
              <input
                type="password"
                className="form-input"
                style={{ paddingLeft: '42px', backgroundColor: '#121212', color: '#ffffff', border: '1px solid rgba(255,255,255,0.1)' }}
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
          </div>

          <button
            type="submit"
            className="btn-primary"
            style={{ width: '100%', justifyContent: 'center', marginTop: '12px', backgroundColor: '#d4af37', color: '#121212', fontWeight: 'bold' }}
            disabled={loading}
          >
            {loading ? 'Entrando...' : 'Entrar no Sistema'}
            <ChevronRight size={18} />
          </button>
        </form>

        <div style={{ marginTop: '24px', padding: '14px', background: 'rgba(255,255,255,0.02)', borderRadius: '8px', border: '1px dashed rgba(255,255,255,0.1)', fontSize: '12px' }}>
          <p style={{ color: '#d4af37', fontWeight: '600', marginBottom: '4px' }}>Dados de Teste (Seed):</p>
          <p style={{ color: '#a3a3a3' }}>• Proprietário: <strong>carlos@barbearia.com</strong> / Senha: <strong>123456</strong></p>
          <p style={{ color: '#a3a3a3' }}>• Barbeiro Juliano: <strong>juliano@barbearia.com</strong> / Senha: <strong>123456</strong></p>
        </div>

        <div style={{ textAlign: 'center', marginTop: '24px', display: 'flex', flexDirection: 'column', gap: '12px', fontSize: '14px', color: '#a3a3a3' }}>
          <div style={{ marginTop: '8px', borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '16px' }}>
            <Link to="/" style={{ color: '#a3a3a3', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '6px' }} onMouseEnter={(e) => e.currentTarget.style.color = '#ffffff'} onMouseLeave={(e) => e.currentTarget.style.color = '#a3a3a3'}>
              ← Voltar para a Página Inicial
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
};
