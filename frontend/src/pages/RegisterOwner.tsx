import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Scissors, Lock, Mail, User, Building, ExternalLink } from 'lucide-react';
import { apiRequest } from '../services/api';

export const RegisterOwner: React.FC = () => {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [estName, setEstName] = useState('');
  const [estSlug, setEstSlug] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      await apiRequest('/auth/register-owner', 'POST', {
        name,
        email,
        password,
        establishment_name: estName,
        establishment_slug: estSlug.toLowerCase().replace(/[^a-z0-9-_]/g, ''),
      });
      navigate(`/login?shop=${estSlug}`);
    } catch (err: any) {
      setError(err.message || 'Erro ao realizar cadastro.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ display: 'flex', minHeight: '100vh', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
      <div className="glass-panel animate-fade-in" style={{ width: '100%', maxWidth: '480px', padding: '40px', border: '1px solid rgba(255,255,255,0.08)' }}>
        <div style={{ textAlign: 'center', marginBottom: '32px' }}>
          <div style={{ display: 'inline-flex', padding: '12px', borderRadius: '50%', backgroundColor: 'rgba(212, 175, 55, 0.1)', color: 'var(--primary)', marginBottom: '16px' }}>
            <Scissors size={32} />
          </div>
          <h2 style={{ fontSize: '28px', color: 'var(--foreground)' }}>Cadastre seu Negócio</h2>
          <p style={{ color: 'var(--muted)', fontSize: '14px', marginTop: '8px' }}>Crie seu painel administrativo e customize seu Bot de WhatsApp</p>
        </div>

        {error && (
          <div style={{ backgroundColor: 'rgba(239, 68, 68, 0.1)', border: '1px solid var(--error)', color: 'var(--error)', padding: '12px', borderRadius: '8px', marginBottom: '20px', fontSize: '14px' }}>
            {error}
          </div>
        )}

        <form onSubmit={handleRegister}>
          <div className="form-group">
            <label className="form-label">Nome Completo</label>
            <div style={{ position: 'relative' }}>
              <span style={{ position: 'absolute', left: '14px', top: '14px', color: 'var(--muted)' }}><User size={18} /></span>
              <input type="text" className="form-input" style={{ paddingLeft: '42px' }} placeholder="Ex: Carlos Santos" value={name} onChange={(e) => setName(e.target.value)} required />
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">E-mail</label>
            <div style={{ position: 'relative' }}>
              <span style={{ position: 'absolute', left: '14px', top: '14px', color: 'var(--muted)' }}><Mail size={18} /></span>
              <input type="email" className="form-input" style={{ paddingLeft: '42px' }} placeholder="seuemail@exemplo.com" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">Senha</label>
            <div style={{ position: 'relative' }}>
              <span style={{ position: 'absolute', left: '14px', top: '14px', color: 'var(--muted)' }}><Lock size={18} /></span>
              <input type="password" className="form-input" style={{ paddingLeft: '42px' }} placeholder="••••••••" value={password} onChange={(e) => setPassword(e.target.value)} required />
            </div>
          </div>

          <hr style={{ border: '0', borderTop: '1px solid var(--input-border)', margin: '24px 0' }} />

          <div className="form-group">
            <label className="form-label">Nome da Barbearia</label>
            <div style={{ position: 'relative' }}>
              <span style={{ position: 'absolute', left: '14px', top: '14px', color: 'var(--muted)' }}><Building size={18} /></span>
              <input type="text" className="form-input" style={{ paddingLeft: '42px' }} placeholder="Ex: Barbearia Clássica" value={estName} onChange={(e) => setEstName(e.target.value)} required />
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">URL Slug (Identificador único)</label>
            <div style={{ position: 'relative' }}>
              <span style={{ position: 'absolute', left: '14px', top: '14px', color: 'var(--muted)' }}><ExternalLink size={18} /></span>
              <input type="text" className="form-input" style={{ paddingLeft: '42px' }} placeholder="Ex: classica (sem espaços ou acentos)" value={estSlug} onChange={(e) => setEstSlug(e.target.value)} required />
            </div>
            <span style={{ fontSize: '11px', color: 'var(--muted)', marginTop: '4px', display: 'block' }}>
              Seu painel estará em: /login?shop={estSlug || 'slug'}
            </span>
          </div>

          <button type="submit" className="btn-primary" style={{ width: '100%', justifyContent: 'center', marginTop: '16px' }} disabled={loading}>
            {loading ? 'Cadastrando...' : 'Cadastrar Estabelecimento'}
          </button>
        </form>

        <div style={{ textAlign: 'center', marginTop: '24px', display: 'flex', flexDirection: 'column', gap: '12px', fontSize: '14px', color: 'var(--muted)' }}>
          <div>
            Já possui estabelecimento? <Link to="/login" style={{ color: 'var(--primary)', fontWeight: '600' }}>Faça Login</Link>
          </div>
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
