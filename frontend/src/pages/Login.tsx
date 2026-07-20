import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useEstablishmentTheme } from '../contexts/ThemeContext';
import { Scissors, Lock, Mail, ChevronRight } from 'lucide-react';

export const Login: React.FC = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  
  const { login, user } = useAuth();
  const { establishment, loadEstablishmentBySlug } = useEstablishmentTheme();
  const navigate = useNavigate();
  const location = useLocation();

  // Load target shop configurations dynamically from URL
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const shopSlug = params.get('shop');
    if (shopSlug) {
      loadEstablishmentBySlug(shopSlug);
    }
  }, [location.search]);

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
    <div style={{ display: 'flex', minHeight: '100vh', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
      <div className="glass-panel animate-fade-in" style={{ width: '100%', maxWidth: '440px', padding: '40px', border: '1px solid rgba(255, 255, 255, 0.08)' }}>
        <div style={{ textAlign: 'center', marginBottom: '32px' }}>
          <div style={{ display: 'inline-flex', padding: '12px', borderRadius: '50%', backgroundColor: 'rgba(212, 175, 55, 0.1)', color: 'var(--primary)', marginBottom: '16px' }}>
            <Scissors size={32} />
          </div>
          <h2 style={{ fontSize: '28px', color: 'var(--foreground)' }}>
            {establishment ? establishment.name : 'Barbearia Clássica'}
          </h2>
          <p style={{ color: 'var(--muted)', fontSize: '14px', marginTop: '8px' }}>Painel de Gestão & Agendamentos</p>
        </div>

        {error && (
          <div style={{ backgroundColor: 'rgba(239, 68, 68, 0.1)', border: '1px solid var(--error)', color: 'var(--error)', padding: '12px', borderRadius: '8px', marginBottom: '20px', fontSize: '14px' }}>
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-label">E-mail de Acesso</label>
            <div style={{ position: 'relative' }}>
              <span style={{ position: 'absolute', left: '14px', top: '14px', color: 'var(--muted)' }}><Mail size={18} /></span>
              <input
                type="email"
                className="form-input"
                style={{ paddingLeft: '42px' }}
                placeholder="nome@exemplo.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">Senha</label>
            <div style={{ position: 'relative' }}>
              <span style={{ position: 'absolute', left: '14px', top: '14px', color: 'var(--muted)' }}><Lock size={18} /></span>
              <input
                type="password"
                className="form-input"
                style={{ paddingLeft: '42px' }}
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
            style={{ width: '100%', justifyContent: 'center', marginTop: '12px' }}
            disabled={loading}
          >
            {loading ? 'Entrando...' : 'Entrar no Sistema'}
            <ChevronRight size={18} />
          </button>
        </form>

        <div style={{ marginTop: '24px', padding: '14px', background: 'rgba(255,255,255,0.02)', borderRadius: '8px', border: '1px dashed rgba(255,255,255,0.1)', fontSize: '12px' }}>
          <p style={{ color: 'var(--primary)', fontWeight: '600', marginBottom: '4px' }}>Dados de Teste (Seed):</p>
          <p style={{ color: 'var(--muted)' }}>• Proprietário: <strong>carlos@barbearia.com</strong> / Senha: <strong>123456</strong></p>
          <p style={{ color: 'var(--muted)' }}>• Barbeiro Juliano: <strong>juliano@barbearia.com</strong> / Senha: <strong>123456</strong></p>
        </div>

        <div style={{ textAlign: 'center', marginTop: '24px', display: 'flex', flexDirection: 'column', gap: '12px', fontSize: '14px', color: 'var(--muted)' }}>
          <div style={{ marginTop: '8px', borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '16px' }}>
            <Link to="/" style={{ color: 'var(--muted)', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '6px' }} onMouseEnter={(e) => e.currentTarget.style.color = '#ffffff'} onMouseLeave={(e) => e.currentTarget.style.color = 'var(--muted)'}>
              ← Voltar para a Página Inicial
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
};
