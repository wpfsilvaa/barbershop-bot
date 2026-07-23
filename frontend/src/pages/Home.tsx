import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Scissors, MapPin, Search, ArrowRight, ShieldAlert, Menu, X, User, LayoutDashboard, Home as HomeIcon } from 'lucide-react';

interface EstablishmentCard {
  id: string;
  name: string;
  slug: string;
  logo_url?: string;
  address?: string;
  bio?: string;
  primary_color: string;
  secondary_color: string;
  background_color: string;
  text_color: string;
}

export const Home: React.FC = () => {
  const navigate = useNavigate();
  const [establishments, setEstablishments] = useState<EstablishmentCard[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  useEffect(() => {
    const fetchEstablishments = async () => {
      try {
        setLoading(true);
        const res = await fetch(`/api/establishments`);
        if (!res.ok) {
          throw new Error('Erro ao buscar barbearias.');
        }
        const data = await res.json();
        setEstablishments(data);
      } catch (err: any) {
        console.error('Error fetching establishments:', err);
        setError(err.message || 'Não foi possível carregar as barbearias.');
      } finally {
        setLoading(false);
      }
    };

    fetchEstablishments();
  }, []);

  const filtered = establishments.filter((est) => 
    est.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    (est.address && est.address.toLowerCase().includes(searchTerm.toLowerCase()))
  );

  return (
    <div style={{
      minHeight: '100vh',
      backgroundColor: '#0a0a0c',
      color: '#ffffff',
      fontFamily: "'Outfit', 'Inter', sans-serif",
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      padding: '24px 16px',
      overflowX: 'hidden'
    }}>
      {/* Navbar */}
      <header style={{
        width: '100%',
        maxWidth: '1200px',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '16px 0',
        borderBottom: '1px solid rgba(255,255,255,0.04)',
        marginBottom: '40px'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer' }} onClick={() => navigate('/')}>
          <div style={{ width: '40px', height: '40px', borderRadius: '8px', background: 'linear-gradient(135deg, #d4af37, #aa820a)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Scissors size={20} style={{ color: '#000000' }} />
          </div>
          <span style={{ fontSize: '20px', fontWeight: 'bold', letterSpacing: '1px' }}>BARBER<span style={{ color: '#d4af37' }}>HUB</span></span>
        </div>

        {/* Desktop Buttons */}
        <div className="home-desktop-nav" style={{ display: 'flex', gap: '12px' }}>
          <button
            onClick={() => navigate('/portal')}
            style={{
              padding: '10px 20px',
              borderRadius: '8px',
              background: 'linear-gradient(135deg, #d4af37, #aa820a)',
              border: 'none',
              color: '#000000',
              fontWeight: 'bold',
              fontSize: '14px',
              cursor: 'pointer',
              transition: 'all 0.2s',
              display: 'flex',
              alignItems: 'center',
              gap: '8px'
            }}
          >
            <User size={16} />
            Portal do Cliente
          </button>

          <button
            onClick={() => navigate('/login')}
            style={{
              padding: '10px 20px',
              borderRadius: '8px',
              background: 'rgba(255,255,255,0.03)',
              border: '1px solid rgba(255,255,255,0.08)',
              color: '#ffffff',
              fontWeight: '600',
              fontSize: '14px',
              cursor: 'pointer',
              transition: 'all 0.2s',
              display: 'flex',
              alignItems: 'center',
              gap: '8px'
            }}
          >
            <LayoutDashboard size={16} />
            Painel Administrativo
          </button>
        </div>

        {/* Mobile Sandwich Button */}
        <button
          className="home-mobile-hamburger"
          onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
          style={{
            display: 'none',
            background: 'rgba(255,255,255,0.05)',
            border: '1px solid rgba(255,255,255,0.1)',
            color: '#ffffff',
            padding: '10px',
            borderRadius: '8px',
            cursor: 'pointer',
            alignItems: 'center',
            justifyContent: 'center'
          }}
          aria-label="Abrir menu"
        >
          {isMobileMenuOpen ? <X size={24} /> : <Menu size={24} />}
        </button>
      </header>

      {/* Mobile Backdrop & Drawer Menu */}
      {isMobileMenuOpen && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          width: '100vw',
          height: '100vh',
          zIndex: 9999,
          display: 'flex',
          justifyContent: 'flex-end',
          background: 'rgba(0,0,0,0.75)',
          backdropFilter: 'blur(8px)',
          animation: 'fadeIn 0.2s ease'
        }} onClick={() => setIsMobileMenuOpen(false)}>
          <div style={{
            width: '80%',
            maxWidth: '320px',
            height: '100%',
            background: '#121216',
            borderLeft: '1px solid rgba(255,255,255,0.1)',
            padding: '24px',
            display: 'flex',
            flexDirection: 'column',
            gap: '24px',
            boxShadow: '-10px 0 30px rgba(0,0,0,0.8)',
            animation: 'slideLeft 0.25s ease'
          }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: '16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Scissors size={20} style={{ color: '#d4af37' }} />
                <span style={{ fontWeight: 'bold', fontSize: '18px' }}>BARBER<span style={{ color: '#d4af37' }}>HUB</span></span>
              </div>
              <button 
                onClick={() => setIsMobileMenuOpen(false)}
                style={{ background: 'transparent', border: 'none', color: '#ffffff', cursor: 'pointer', padding: '4px' }}
              >
                <X size={24} />
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', flex: 1 }}>
              <button
                onClick={() => { setIsMobileMenuOpen(false); navigate('/'); }}
                style={{
                  width: '100%',
                  padding: '14px 16px',
                  borderRadius: '10px',
                  background: 'rgba(255,255,255,0.04)',
                  border: '1px solid rgba(255,255,255,0.08)',
                  color: '#ffffff',
                  fontWeight: '600',
                  fontSize: '15px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px',
                  cursor: 'pointer',
                  textAlign: 'left'
                }}
              >
                <HomeIcon size={18} style={{ color: '#d4af37' }} />
                Início (Catálogo)
              </button>

              <button
                onClick={() => { setIsMobileMenuOpen(false); navigate('/portal'); }}
                style={{
                  width: '100%',
                  padding: '14px 16px',
                  borderRadius: '10px',
                  background: 'linear-gradient(135deg, #d4af37, #aa820a)',
                  border: 'none',
                  color: '#000000',
                  fontWeight: 'bold',
                  fontSize: '15px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px',
                  cursor: 'pointer',
                  textAlign: 'left',
                  boxShadow: '0 4px 14px rgba(212,175,55,0.3)'
                }}
              >
                <User size={18} />
                Portal do Cliente
              </button>

              <button
                onClick={() => { setIsMobileMenuOpen(false); navigate('/login'); }}
                style={{
                  width: '100%',
                  padding: '14px 16px',
                  borderRadius: '10px',
                  background: 'rgba(255,255,255,0.04)',
                  border: '1px solid rgba(255,255,255,0.08)',
                  color: '#ffffff',
                  fontWeight: '600',
                  fontSize: '15px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px',
                  cursor: 'pointer',
                  textAlign: 'left'
                }}
              >
                <LayoutDashboard size={18} style={{ color: '#d4af37' }} />
                Painel Administrativo
              </button>
            </div>

            <div style={{ fontSize: '12px', color: 'rgba(255,255,255,0.3)', textAlign: 'center', paddingTop: '16px', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
              BarberHub Platform &copy; {new Date().getFullYear()}
            </div>
          </div>
          <style>{`
            @keyframes slideLeft {
              from { transform: translateX(100%); }
              to { transform: translateX(0); }
            }
          `}</style>
        </div>
      )}

      {/* Hero Banner */}
      <section style={{
        textAlign: 'center',
        maxWidth: '800px',
        marginBottom: '40px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '16px'
      }}>
        <div style={{
          padding: '6px 14px',
          borderRadius: '50px',
          background: 'rgba(212,175,55,0.08)',
          border: '1px solid rgba(212,175,55,0.2)',
          color: '#d4af37',
          fontSize: '13px',
          fontWeight: '600',
          letterSpacing: '1px',
          textTransform: 'uppercase'
        }}>
          Agendamento Online de Barbearias
        </div>
        <h1 style={{
          fontSize: '44px',
          fontWeight: '800',
          lineHeight: '1.2',
          background: 'linear-gradient(to right, #ffffff, #888888)',
          WebkitBackgroundClip: 'text',
          WebkitTextFillColor: 'transparent',
          letterSpacing: '-0.5px'
        }}>
          Encontre a Barbearia Perfeita & Reserve seu Horário
        </h1>
        <p style={{
          fontSize: '16px',
          color: 'rgba(255,255,255,0.6)',
          maxWidth: '540px',
          lineHeight: '1.6'
        }}>
          Selecione uma barbearia cadastrada na nossa plataforma para ver os profissionais, serviços e marcar o seu corte em segundos.
        </p>
      </section>

      {/* Search Input */}
      <div style={{
        width: '100%',
        maxWidth: '540px',
        position: 'relative',
        marginBottom: '48px'
      }}>
        <Search style={{
          position: 'absolute',
          left: '16px',
          top: '50%',
          transform: 'translateY(-50%)',
          color: 'rgba(255,255,255,0.3)'
        }} size={20} />
        <input
          type="text"
          placeholder="Buscar barbearia pelo nome ou endereço..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          style={{
            width: '100%',
            padding: '16px 16px 16px 48px',
            borderRadius: '12px',
            background: 'rgba(255,255,255,0.02)',
            border: '1px solid rgba(255,255,255,0.08)',
            color: '#ffffff',
            fontSize: '16px',
            outline: 'none',
            transition: 'all 0.2s'
          }}
          onFocus={(e) => e.target.style.borderColor = '#d4af37'}
          onBlur={(e) => e.target.style.borderColor = 'rgba(255,255,255,0.08)'}
        />
      </div>

      {/* Main Grid */}
      <main style={{
        width: '100%',
        maxWidth: '1200px',
        marginBottom: '60px'
      }}>
        {loading ? (
          <div style={{ textAlign: 'center', padding: '60px 0' }}>
            <div style={{ width: '40px', height: '40px', border: '3px solid #d4af37', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 1s linear infinite', margin: '0 auto 16px auto' }} />
            <p style={{ color: 'rgba(255,255,255,0.5)' }}>Carregando catálogo de barbearias...</p>
          </div>
        ) : error ? (
          <div style={{
            textAlign: 'center',
            padding: '40px',
            background: 'rgba(239, 68, 68, 0.05)',
            border: '1px solid rgba(239, 68, 68, 0.15)',
            borderRadius: '12px',
            maxWidth: '500px',
            margin: '0 auto'
          }}>
            <ShieldAlert size={40} style={{ color: '#ef4444', marginBottom: '16px' }} />
            <h3 style={{ fontSize: '18px', fontWeight: 'bold', marginBottom: '8px' }}>Erro ao conectar</h3>
            <p style={{ color: 'rgba(255,255,255,0.6)', fontSize: '14px' }}>{error}</p>
          </div>
        ) : filtered.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px', color: 'rgba(255,255,255,0.4)' }}>
            Nenhuma barbearia encontrada para a sua busca.
          </div>
        ) : (
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))',
            gap: '24px'
          }}>
            {filtered.map((est) => {
              const primary = est.primary_color || '#d4af37';
              return (
                <div
                  key={est.id}
                  onClick={() => navigate(`/book/${est.slug}`)}
                  style={{
                    background: 'rgba(255,255,255,0.01)',
                    border: '1px solid rgba(255,255,255,0.05)',
                    borderRadius: '16px',
                    padding: '24px',
                    cursor: 'pointer',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '16px',
                    transition: 'all 0.25s ease',
                    position: 'relative',
                    overflow: 'hidden'
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.borderColor = primary;
                    e.currentTarget.style.transform = 'translateY(-4px)';
                    e.currentTarget.style.background = 'rgba(255,255,255,0.03)';
                    e.currentTarget.style.boxShadow = `0 10px 30px ${primary}08`;
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.borderColor = 'rgba(255,255,255,0.05)';
                    e.currentTarget.style.transform = 'translateY(0)';
                    e.currentTarget.style.background = 'rgba(255,255,255,0.01)';
                    e.currentTarget.style.boxShadow = 'none';
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                    {est.logo_url ? (
                      <img 
                        src={est.logo_url} 
                        alt={est.name} 
                        style={{ width: '60px', height: '60px', borderRadius: '50%', objectFit: 'cover', border: `2px solid ${primary}` }} 
                      />
                    ) : (
                      <div style={{ width: '60px', height: '60px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: `linear-gradient(135deg, ${primary}22, ${primary}44)`, border: `2px solid ${primary}` }}>
                        <Scissors size={24} style={{ color: primary }} />
                      </div>
                    )}
                    <div>
                      <h3 style={{ fontSize: '18px', fontWeight: 'bold' }}>{est.name}</h3>
                      <span style={{ fontSize: '12px', color: 'rgba(255,255,255,0.3)' }}>/{est.slug}</span>
                    </div>
                  </div>

                  {est.bio ? (
                    <p style={{
                      fontSize: '14px',
                      color: 'rgba(255,255,255,0.6)',
                      lineHeight: '1.5',
                      height: '42px',
                      overflow: 'hidden',
                      display: '-webkit-box',
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: 'vertical',
                      fontStyle: 'italic'
                    }}>
                      "{est.bio}"
                    </p>
                  ) : (
                    <p style={{ fontSize: '14px', color: 'rgba(255,255,255,0.4)', fontStyle: 'italic' }}>
                      Sem biografia definida.
                    </p>
                  )}

                  {est.address && (
                    <div style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      fontSize: '12px',
                      color: 'rgba(255,255,255,0.4)',
                      marginTop: 'auto',
                      borderTop: '1px solid rgba(255,255,255,0.03)',
                      paddingTop: '12px'
                    }}>
                      <MapPin size={14} style={{ color: primary }} />
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{est.address}</span>
                    </div>
                  )}

                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    marginTop: '4px'
                  }}>
                    <span style={{ fontSize: '13px', fontWeight: 'bold', color: primary }}>Agendar Horário</span>
                    <div style={{
                      width: '32px',
                      height: '32px',
                      borderRadius: '50%',
                      background: primary,
                      color: '#000000',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      transition: 'all 0.2s'
                    }}>
                      <ArrowRight size={16} />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>

      <footer style={{
        width: '100%',
        maxWidth: '1200px',
        textAlign: 'center',
        padding: '30px 0 10px 0',
        fontSize: '12px',
        color: 'rgba(255,255,255,0.2)',
        borderTop: '1px solid rgba(255,255,255,0.03)',
        marginTop: 'auto'
      }}>
        <p>&copy; {new Date().getFullYear()} BarberHub Catalog. Todos os direitos reservados.</p>
        <p style={{ marginTop: '4px' }}>Desenvolvido por Antigravity Systems ⚡</p>
      </footer>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
};
