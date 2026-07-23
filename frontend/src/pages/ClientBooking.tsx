import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { 
  User, 
  Calendar, 
  Clock, 
  CheckCircle2, 
  ArrowRight, 
  ArrowLeft, 
  Scissors,
  Check,
  MapPin,
  ChevronRight,
  X
} from 'lucide-react';

interface EstablishmentInfo {
  id: string;
  name: string;
  slug: string;
  primary_color: string;
  secondary_color: string;
  background_color: string;
  text_color: string;
  slot_duration_minutes: number;
  logo_url?: string;
  address?: string;
  bio?: string;
  photos?: string[];
}

interface BarberInfo {
  id: string;
  name: string;
  photo_url?: string;
}

interface ServiceInfo {
  id: string;
  name: string;
  description?: string;
  price: string;
  duration_minutes: number;
}

export const ClientBooking: React.FC = () => {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  
  // States
  const [est, setEst] = useState<EstablishmentInfo | null>(null);
  const [expandedPhoto, setExpandedPhoto] = useState<string | null>(null);
  const [barbers, setBarbers] = useState<BarberInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  // Selection States
  const [currentStep, setCurrentStep] = useState<number>(1);
  const [selectedBarber, setSelectedBarber] = useState<BarberInfo | null>(null);
  const [barberServices, setBarberServices] = useState<ServiceInfo[]>([]);
  const [selectedService, setSelectedService] = useState<ServiceInfo | null>(null);
  const [selectedDate, setSelectedDate] = useState<string>(''); // YYYY-MM-DD
  const [selectedSlot, setSelectedSlot] = useState<string>(''); // ISO string
  const [clientName, setClientName] = useState<string>('');
  const [clientPhone, setClientPhone] = useState<string>('');
  const [countryDdi, setCountryDdi] = useState<string>('55');
  
  // Fetch lists
  const [availableSlots, setAvailableSlots] = useState<string[]>([]);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [loadingServices, setLoadingServices] = useState(false);
  const [bookingSuccess, setBookingSuccess] = useState(false);
  const [bookingLoading, setBookingLoading] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const handleScroll = (direction: 'left' | 'right') => {
    if (scrollRef.current) {
      const { scrollLeft, clientWidth, scrollWidth } = scrollRef.current;
      const scrollAmount = clientWidth * 0.75;
      
      let scrollTo = 0;
      if (direction === 'right') {
        if (scrollLeft + clientWidth >= scrollWidth - 20) {
          scrollTo = 0;
        } else {
          scrollTo = scrollLeft + scrollAmount;
        }
      } else {
        if (scrollLeft <= 20) {
          scrollTo = scrollWidth - clientWidth;
        } else {
          scrollTo = scrollLeft - scrollAmount;
        }
      }
      
      scrollRef.current.scrollTo({ left: scrollTo, behavior: 'smooth' });
    }
  };

  // Load Establishment Dynamic Theme & Styles
  useEffect(() => {
    const fetchEstablishment = async () => {
      try {
        setLoading(true);
        const res = await fetch(`/api/establishments/slug/${slug}`);
        if (!res.ok) {
          throw new Error('Estabelecimento não encontrado.');
        }
        const data = await res.json();
        setEst(data);

        // Fetch public barbers for this establishment
        const bRes = await fetch(`/api/establishments/${data.id}/public-barbers`);
        if (bRes.ok) {
          const bData = await bRes.json();
          setBarbers(bData);
        }
      } catch (err: any) {
        setError(err.message || 'Erro ao carregar agendamento.');
      } finally {
        setLoading(false);
      }
    };

    if (slug) {
      fetchEstablishment();
    }
  }, [slug]);

  // Load available slots when barber or date changes
  useEffect(() => {
    const fetchSlots = async () => {
      if (!est || !selectedBarber || !selectedDate) return;
      try {
        setLoadingSlots(true);
        const res = await fetch(
          `/api/establishments/${est.id}/barbers/${selectedBarber.id}/available-slots?date=${selectedDate}`
        );
        if (res.ok) {
          const slots = await res.json();
          setAvailableSlots(slots);
        }
      } catch (err) {
        console.error('Error fetching slots:', err);
      } finally {
        setLoadingSlots(false);
      }
    };

    fetchSlots();
  }, [selectedBarber, selectedDate, est]);

  const selectBarberAndNext = async (barber: BarberInfo) => {
    setSelectedBarber(barber);
    if (!est) return;

    try {
      setLoadingServices(true);
      const res = await fetch(`/api/establishments/${est.id}/barbers/${barber.id}/services`);
      if (res.ok) {
        const data = await res.json();
        if (data.length > 0) {
          setBarberServices(data);
        } else {
          // Fallback to all services if barber has no custom assignments
          const fallbackRes = await fetch(`/api/establishments/${est.id}/public-services`);
          if (fallbackRes.ok) {
            const fallbackData = await fallbackRes.json();
            setBarberServices(fallbackData);
          }
        }
      }
    } catch (err) {
      console.error('Error loading barber services:', err);
    } finally {
      setLoadingServices(false);
      setCurrentStep(2);
    }
  };

  // Generate helper date list (Next 7 days)
  const getNextDays = () => {
    const list = [];
    const today = new Date();
    for (let i = 0; i < 7; i++) {
      const d = new Date(today);
      d.setDate(today.getDate() + i);
      
      const yyyy = d.getFullYear();
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      const dateStr = `${yyyy}-${mm}-${dd}`;
      
      const label = d.toLocaleDateString('pt-BR', { weekday: 'short', day: 'numeric' });
      list.push({ dateStr, label });
    }
    return list;
  };

  const handleBookingSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!est || !selectedBarber || !selectedSlot || !clientName || !clientPhone) return;

    try {
      setBookingLoading(true);
      const cleanPhone = clientPhone.replace(/\D/g, '');
      const formattedPhone = `${countryDdi}${cleanPhone}`;

      const res = await fetch(`/api/establishments/${est.id}/public-bookings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          barber_id: selectedBarber.id,
          client_name: clientName,
          client_phone: formattedPhone,
          appointment_time: selectedSlot,
          service_id: selectedService?.id || null
        })
      });

      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || 'Erro ao realizar agendamento.');
      }

      setBookingSuccess(true);
      setCurrentStep(6);
    } catch (err: any) {
      alert(err.message || 'Erro ao finalizar agendamento.');
    } finally {
      setBookingLoading(false);
    }
  };

  // Group slots by shift helper
  const getGroupedSlots = () => {
    const morning: string[] = [];
    const afternoon: string[] = [];
    const evening: string[] = [];

    availableSlots.forEach(slot => {
      const h = new Date(slot).getHours();
      if (h < 12) morning.push(slot);
      else if (h < 18) afternoon.push(slot);
      else evening.push(slot);
    });

    return { morning, afternoon, evening };
  };

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: '#0c0c0e', color: '#ffffff' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ width: '45px', height: '45px', border: '3px solid #d4af37', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 1s linear infinite', margin: '0 auto 16px auto' }} />
          <p style={{ color: 'rgba(255,255,255,0.7)', fontSize: '15px' }}>Carregando dados da Barbearia...</p>
        </div>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  if (error || !est) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: '#0c0c0e', color: '#ffffff', padding: '20px' }}>
        <div style={{ textAlign: 'center', maxWidth: '400px', padding: '24px', background: 'rgba(255,255,255,0.02)', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.06)' }}>
          <Scissors size={40} style={{ color: '#ef4444', marginBottom: '16px' }} />
          <h2 style={{ fontSize: '20px', marginBottom: '8px' }}>Erro ao Carregar</h2>
          <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: '14px', marginBottom: '20px' }}>{error || 'Não foi possível encontrar a barbearia informada.'}</p>
          <button 
            onClick={() => navigate('/')}
            style={{ padding: '10px 18px', borderRadius: '6px', border: 'none', background: '#d4af37', color: '#000', fontWeight: '600', cursor: 'pointer' }}
          >
            Voltar para a Inicial
          </button>
        </div>
      </div>
    );
  }

  // Set colors dynamically based on establishment preferences
  const primaryColor = est.primary_color || '#d4af37';
  const secondaryColor = est.secondary_color || '#1e1e24';
  const bgColor = est.background_color || '#0f0f12';
  const textColor = est.text_color || '#f5f5f5';

  const grouped = getGroupedSlots();

  return (
    <div style={{ 
      minHeight: '100vh', 
      backgroundColor: bgColor, 
      color: textColor, 
      fontFamily: "'Outfit', 'Inter', sans-serif",
      padding: '16px',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center'
    }}>
      {/* Back to catalog button */}
      <button 
        onClick={() => navigate('/')}
        style={{
          alignSelf: 'flex-start',
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          background: 'transparent',
          border: 'none',
          color: 'rgba(255,255,255,0.4)',
          fontSize: '13px',
          cursor: 'pointer',
          marginBottom: '10px',
          padding: '4px 8px',
          borderRadius: '4px',
          transition: 'all 0.2s'
        }}
        onMouseEnter={(e) => e.currentTarget.style.color = '#ffffff'}
        onMouseLeave={(e) => e.currentTarget.style.color = 'rgba(255,255,255,0.4)'}
      >
        <ArrowLeft size={14} /> Voltar ao Catálogo
      </button>

      {/* Header Bar */}
      <header style={{ 
        width: '100%', 
        maxWidth: '480px', 
        textAlign: 'center', 
        marginBottom: '20px',
        padding: '16px 0',
        borderBottom: '1px solid rgba(255,255,255,0.06)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '12px'
      }}>
        {est.logo_url ? (
          <img 
            src={est.logo_url} 
            alt={est.name} 
            style={{ width: '80px', height: '80px', borderRadius: '50%', objectFit: 'cover', border: `2px solid ${primaryColor}` }} 
          />
        ) : (
          <div style={{ width: '80px', height: '80px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: `linear-gradient(135deg, ${primaryColor}22, ${primaryColor}44)`, border: `2px solid ${primaryColor}` }}>
            <Scissors size={32} style={{ color: primaryColor }} />
          </div>
        )}
        <div>
          <h1 style={{ fontSize: '24px', fontWeight: 'bold', letterSpacing: '0.5px' }}>{est.name}</h1>
          {est.bio && <p style={{ fontSize: '13px', color: 'rgba(255,255,255,0.6)', marginTop: '6px', fontStyle: 'italic', padding: '0 16px', lineHeight: '1.4' }}>"{est.bio}"</p>}
          {est.address && <p style={{ fontSize: '11px', color: 'rgba(255,255,255,0.4)', marginTop: '6px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px' }}><MapPin size={12} style={{ color: primaryColor }} /> {est.address}</p>}
        </div>
      </header>

      {/* Main Container */}
      <main style={{ width: '100%', maxWidth: '480px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
        
        {/* Progress Bar */}
        {currentStep <= 5 && (
          <div style={{ 
            background: 'rgba(255,255,255,0.02)', 
            border: '1px solid rgba(255,255,255,0.05)',
            borderRadius: '12px',
            padding: '10px 14px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            fontSize: '11px',
            color: 'rgba(255,255,255,0.4)',
            overflowX: 'auto',
            gap: '8px'
          }}>
            <span style={currentStep === 1 ? { color: primaryColor, fontWeight: 'bold' } : {}}>1. Barbeiro</span>
            <ArrowRight size={10} />
            <span style={currentStep === 2 ? { color: primaryColor, fontWeight: 'bold' } : {}}>2. Serviço</span>
            <ArrowRight size={10} />
            <span style={currentStep === 3 ? { color: primaryColor, fontWeight: 'bold' } : {}}>3. Data</span>
            <ArrowRight size={10} />
            <span style={currentStep === 4 ? { color: primaryColor, fontWeight: 'bold' } : {}}>4. Horário</span>
            <ArrowRight size={10} />
            <span style={currentStep === 5 ? { color: primaryColor, fontWeight: 'bold' } : {}}>5. Cadastro</span>
          </div>
        )}

        {/* STEP 1: SELECT BARBER */}
        {currentStep === 1 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            
            {/* Carrossel de fotos da barbearia */}
            {est && est.photos && est.photos.length > 0 && (
              <div style={{ position: 'relative', width: '100%', marginBottom: '6px' }}>
                {/* Setas de navegação flutuantes */}
                {est.photos.length > 3 && (
                  <>
                    <button
                      type="button"
                      style={{ position: 'absolute', left: '-10px', top: '50%', transform: 'translateY(-50%)', background: 'rgba(0,0,0,0.8)', color: primaryColor, border: '1px solid rgba(255,255,255,0.1)', borderRadius: '50%', width: '32px', height: '32px', display: 'flex', justifyContent: 'center', alignItems: 'center', cursor: 'pointer', zIndex: 10, boxShadow: '0 4px 10px rgba(0,0,0,0.5)' }}
                      onClick={() => handleScroll('left')}
                    >
                      <ChevronRight size={18} style={{ transform: 'rotate(180deg)' }} />
                    </button>
                    <button
                      type="button"
                      style={{ position: 'absolute', right: '-10px', top: '50%', transform: 'translateY(-50%)', background: 'rgba(0,0,0,0.8)', color: primaryColor, border: '1px solid rgba(255,255,255,0.1)', borderRadius: '50%', width: '32px', height: '32px', display: 'flex', justifyContent: 'center', alignItems: 'center', cursor: 'pointer', zIndex: 10, boxShadow: '0 4px 10px rgba(0,0,0,0.5)' }}
                      onClick={() => handleScroll('right')}
                    >
                      <ChevronRight size={18} />
                    </button>
                  </>
                )}
                
                {/* Container horizontal com scroll suave */}
                <div 
                  ref={scrollRef}
                  style={{ 
                    display: 'flex', 
                    gap: '12px', 
                    overflowX: 'auto', 
                    scrollBehavior: 'smooth', 
                    padding: '2px 0',
                    scrollbarWidth: 'none',
                    msOverflowStyle: 'none'
                  }}
                  className="hide-scrollbar"
                >
                  {est.photos.map((photo, idx) => (
                    <div 
                      key={idx} 
                      style={{ 
                        flex: '0 0 calc(33.333% - 8px)', 
                        minWidth: '110px', 
                        height: '90px', 
                        borderRadius: '8px', 
                        overflow: 'hidden', 
                        border: '1px solid rgba(255,255,255,0.06)' 
                      }}
                    >
                      <img 
                        src={photo} 
                        alt={`Foto local ${idx + 1}`} 
                        style={{ width: '100%', height: '100%', objectFit: 'cover', cursor: 'pointer' }} 
                        onClick={() => setExpandedPhoto(photo)}
                        onError={(e) => {
                          e.currentTarget.src = 'https://images.unsplash.com/photo-1503951914875-452162b0f3f1?q=80&w=300';
                        }}
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}

            <h2 style={{ fontSize: '18px', fontWeight: '600' }}>Escolha o Profissional</h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {barbers.map((barber) => (
                <div 
                  key={barber.id}
                  onClick={() => selectBarberAndNext(barber)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '16px',
                    padding: '14px',
                    borderRadius: '12px',
                    background: 'rgba(255,255,255,0.02)',
                    border: '1px solid rgba(255,255,255,0.06)',
                    cursor: 'pointer',
                    transition: 'all 0.2s ease'
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.borderColor = primaryColor;
                    e.currentTarget.style.background = 'rgba(255,255,255,0.04)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.borderColor = 'rgba(255,255,255,0.06)';
                    e.currentTarget.style.background = 'rgba(255,255,255,0.02)';
                  }}
                >
                  {barber.photo_url ? (
                    <img 
                      src={barber.photo_url} 
                      alt={barber.name} 
                      style={{ width: '48px', height: '48px', borderRadius: '50%', objectFit: 'cover' }}
                    />
                  ) : (
                    <div style={{ width: '48px', height: '48px', borderRadius: '50%', backgroundColor: secondaryColor, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <User style={{ color: 'rgba(255,255,255,0.6)' }} size={20} />
                    </div>
                  )}
                  <div style={{ flex: 1 }}>
                    <h3 style={{ fontSize: '16px', fontWeight: 'bold' }}>{barber.name}</h3>
                    <p style={{ fontSize: '12px', color: 'rgba(255,255,255,0.4)', marginTop: '2px' }}>Profissional Especializado</p>
                  </div>
                  <ArrowRight size={16} style={{ color: 'rgba(255,255,255,0.3)' }} />
                </div>
              ))}
            </div>

            {est.address && (
              <div 
                style={{ 
                  marginTop: '16px',
                  display: 'flex', 
                  flexDirection: 'column', 
                  gap: '10px', 
                  padding: '16px', 
                  borderRadius: '12px',
                  background: 'rgba(255,255,255,0.02)', 
                  border: '1px solid rgba(255,255,255,0.06)'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: primaryColor }}>
                  <MapPin size={14} />
                  <span><strong>Localização:</strong> {est.address}</span>
                </div>

                <div style={{ width: '100%', height: '150px', borderRadius: '8px', overflow: 'hidden' }}>
                  <iframe 
                    width="100%" 
                    height="100%" 
                    frameBorder="0" 
                    style={{ border: 0 }} 
                    src={`https://maps.google.com/maps?q=${encodeURIComponent(est.address)}&t=&z=15&ie=UTF8&iwloc=&output=embed`} 
                    allowFullScreen
                  />
                </div>
              </div>
            )}
          </div>
        )}

        {/* STEP 2: SELECT SERVICE */}
        {currentStep === 2 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <button 
                onClick={() => setCurrentStep(1)}
                style={{ background: 'none', border: 'none', color: '#ffffff', cursor: 'pointer', display: 'flex', alignItems: 'center' }}
              >
                <ArrowLeft size={20} />
              </button>
              <h2 style={{ fontSize: '18px', fontWeight: '600' }}>Escolha o Serviço</h2>
            </div>

            {loadingServices ? (
              <div style={{ textAlign: 'center', padding: '20px 0' }}>
                <div style={{ width: '24px', height: '24px', border: '2px solid #d4af37', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 1s linear infinite', margin: '0 auto 8px auto' }} />
                <p style={{ fontSize: '13px', color: 'rgba(255,255,255,0.5)' }}>Carregando serviços...</p>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {barberServices.length === 0 ? (
                  <p style={{ textAlign: 'center', padding: '20px', color: 'rgba(255,255,255,0.4)', fontSize: '14px' }}>Nenhum serviço disponível no momento.</p>
                ) : (
                  barberServices.map((service) => (
                    <div 
                      key={service.id}
                      onClick={() => {
                        setSelectedService(service);
                        setCurrentStep(3);
                      }}
                      style={{
                        padding: '16px',
                        borderRadius: '12px',
                        background: 'rgba(255,255,255,0.02)',
                        border: '1px solid rgba(255,255,255,0.06)',
                        cursor: 'pointer',
                        transition: 'all 0.2s ease',
                        textAlign: 'left'
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.borderColor = primaryColor;
                        e.currentTarget.style.background = 'rgba(255,255,255,0.04)';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.borderColor = 'rgba(255,255,255,0.06)';
                        e.currentTarget.style.background = 'rgba(255,255,255,0.02)';
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <div>
                          <h3 style={{ fontSize: '16px', fontWeight: 'bold' }}>{service.name}</h3>
                          {service.description && (
                            <p style={{ fontSize: '13px', color: 'rgba(255,255,255,0.4)', marginTop: '4px', lineHeight: '1.4' }}>
                              {service.description}
                            </p>
                          )}
                          <p style={{ fontSize: '12px', color: 'rgba(255,255,255,0.3)', marginTop: '6px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                            <Clock size={12} /> {service.duration_minutes} min
                          </p>
                        </div>
                        <div style={{ 
                          fontSize: '16px', 
                          fontWeight: 'bold', 
                          color: primaryColor,
                          background: `rgba(212, 175, 55, 0.08)`,
                          padding: '4px 10px',
                          borderRadius: '6px',
                          border: `1px solid ${primaryColor}22`
                        }}>
                          R$ {parseFloat(service.price).toFixed(2)}
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        )}

        {/* STEP 3: SELECT DATE */}
        {currentStep === 3 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <button 
                onClick={() => setCurrentStep(2)}
                style={{ background: 'none', border: 'none', color: '#ffffff', cursor: 'pointer', display: 'flex', alignItems: 'center' }}
              >
                <ArrowLeft size={20} />
              </button>
              <h2 style={{ fontSize: '18px', fontWeight: '600' }}>Escolha a Data</h2>
            </div>
            
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '10px' }}>
              {getNextDays().map((d) => (
                <button
                  key={d.dateStr}
                  onClick={() => {
                    setSelectedDate(d.dateStr);
                    setCurrentStep(4);
                  }}
                  style={{
                    padding: '16px 10px',
                    borderRadius: '12px',
                    background: selectedDate === d.dateStr ? `linear-gradient(135deg, ${primaryColor}22, ${primaryColor}44)` : 'rgba(255,255,255,0.02)',
                    border: `1px solid ${selectedDate === d.dateStr ? primaryColor : 'rgba(255,255,255,0.06)'}`,
                    color: '#ffffff',
                    fontWeight: 'bold',
                    fontSize: '14px',
                    cursor: 'pointer',
                    transition: 'all 0.15s ease',
                    textTransform: 'capitalize'
                  }}
                >
                  <Calendar size={18} style={{ color: primaryColor, marginBottom: '6px', display: 'inline-block' }} />
                  <div>{d.label}</div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* STEP 4: SELECT HOUR */}
        {currentStep === 4 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <button 
                onClick={() => setCurrentStep(3)}
                style={{ background: 'none', border: 'none', color: '#ffffff', cursor: 'pointer', display: 'flex', alignItems: 'center' }}
              >
                <ArrowLeft size={20} />
              </button>
              <h2 style={{ fontSize: '18px', fontWeight: '600' }}>Escolha o Horário</h2>
            </div>

            {loadingSlots ? (
              <div style={{ textAlign: 'center', padding: '30px 0' }}>
                <div style={{ width: '30px', height: '30px', border: '2px solid #d4af37', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 1s linear infinite', margin: '0 auto 12px auto' }} />
                <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: '14px' }}>Buscando horários disponíveis...</p>
              </div>
            ) : availableSlots.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '30px 16px', background: 'rgba(255,255,255,0.01)', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.05)' }}>
                <Clock size={32} style={{ color: 'rgba(255,255,255,0.2)', marginBottom: '8px' }} />
                <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: '14px' }}>Desculpe, sem horários vagos com *{selectedBarber?.name}* para este dia.</p>
                <button 
                  onClick={() => setCurrentStep(3)}
                  style={{ marginTop: '14px', padding: '8px 14px', borderRadius: '6px', background: 'rgba(255,255,255,0.05)', color: '#fff', border: '1px solid rgba(255,255,255,0.1)', cursor: 'pointer' }}
                >
                  Tentar Outro Dia
                </button>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                {/* Morning */}
                {grouped.morning.length > 0 && (
                  <div>
                    <h4 style={{ fontSize: '13px', color: 'rgba(255,255,255,0.4)', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Manhã</h4>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px' }}>
                      {grouped.morning.map((slot) => {
                        const timeStr = new Date(slot).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
                        return (
                          <button
                            key={slot}
                            onClick={() => {
                              setSelectedSlot(slot);
                              setCurrentStep(5);
                            }}
                            style={{
                              padding: '10px 4px',
                              borderRadius: '8px',
                              background: 'rgba(255,255,255,0.02)',
                              border: '1px solid rgba(255,255,255,0.06)',
                              color: '#ffffff',
                              fontSize: '14px',
                              cursor: 'pointer',
                              fontWeight: '600'
                            }}
                          >
                            {timeStr}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Afternoon */}
                {grouped.afternoon.length > 0 && (
                  <div>
                    <h4 style={{ fontSize: '13px', color: 'rgba(255,255,255,0.4)', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Tarde</h4>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px' }}>
                      {grouped.afternoon.map((slot) => {
                        const timeStr = new Date(slot).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
                        return (
                          <button
                            key={slot}
                            onClick={() => {
                              setSelectedSlot(slot);
                              setCurrentStep(5);
                            }}
                            style={{
                              padding: '10px 4px',
                              borderRadius: '8px',
                              background: 'rgba(255,255,255,0.02)',
                              border: '1px solid rgba(255,255,255,0.06)',
                              color: '#ffffff',
                              fontSize: '14px',
                              cursor: 'pointer',
                              fontWeight: '600'
                            }}
                          >
                            {timeStr}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Evening */}
                {grouped.evening.length > 0 && (
                  <div>
                    <h4 style={{ fontSize: '13px', color: 'rgba(255,255,255,0.4)', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Noite</h4>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px' }}>
                      {grouped.evening.map((slot) => {
                        const timeStr = new Date(slot).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
                        return (
                          <button
                            key={slot}
                            onClick={() => {
                              setSelectedSlot(slot);
                              setCurrentStep(5);
                            }}
                            style={{
                              padding: '10px 4px',
                              borderRadius: '8px',
                              background: 'rgba(255,255,255,0.02)',
                              border: '1px solid rgba(255,255,255,0.06)',
                              color: '#ffffff',
                              fontSize: '14px',
                              cursor: 'pointer',
                              fontWeight: '600'
                            }}
                          >
                            {timeStr}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* STEP 5: REGISTRATION */}
        {currentStep === 5 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <button 
                onClick={() => setCurrentStep(4)}
                style={{ background: 'none', border: 'none', color: '#ffffff', cursor: 'pointer', display: 'flex', alignItems: 'center' }}
              >
                <ArrowLeft size={20} />
              </button>
              <h2 style={{ fontSize: '18px', fontWeight: '600' }}>Confirme Seus Dados</h2>
            </div>

            {/* Resume Card */}
            <div style={{
              background: 'rgba(255,255,255,0.01)',
              border: '1px solid rgba(255,255,255,0.05)',
              borderRadius: '12px',
              padding: '16px',
              display: 'flex',
              flexDirection: 'column',
              gap: '12px',
              fontSize: '14px'
            }}>
              <h3 style={{ fontWeight: 'bold', color: primaryColor, textTransform: 'uppercase', fontSize: '12px', letterSpacing: '0.5px', marginBottom: '4px' }}>Resumo da Reserva</h3>
              <p><span style={{ color: 'rgba(255,255,255,0.4)' }}>Profissional:</span> <strong>{selectedBarber?.name}</strong></p>
              {selectedService && (
                <p><span style={{ color: 'rgba(255,255,255,0.4)' }}>Serviço:</span> <strong>{selectedService.name} (R$ {parseFloat(selectedService.price).toFixed(2)})</strong></p>
              )}
              <p><span style={{ color: 'rgba(255,255,255,0.4)' }}>Data:</span> <strong>{new Date(selectedSlot).toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })}</strong></p>
              <p><span style={{ color: 'rgba(255,255,255,0.4)' }}>Horário:</span> <strong>{new Date(selectedSlot).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })} hs</strong></p>
            </div>

            <form onSubmit={handleBookingSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <label style={{ fontSize: '13px', color: 'rgba(255,255,255,0.6)' }}>Seu Nome Completo</label>
                <input 
                  type="text" 
                  placeholder="Digite seu nome"
                  value={clientName}
                  onChange={(e) => setClientName(e.target.value)}
                  required
                  style={{
                    padding: '12px 14px',
                    borderRadius: '8px',
                    background: 'rgba(255,255,255,0.01)',
                    border: '1px solid rgba(255,255,255,0.08)',
                    color: '#ffffff',
                    outline: 'none',
                    fontSize: '15px'
                  }}
                />
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <label style={{ fontSize: '13px', color: 'rgba(255,255,255,0.6)' }}>WhatsApp (DDD + Número)</label>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span style={{ fontSize: '18px', fontWeight: 'bold', color: 'var(--primary)' }}>+</span>
                  <input
                    type="text"
                    value={countryDdi}
                    onChange={(e) => setCountryDdi(e.target.value.replace(/\D/g, ''))}
                    placeholder="55"
                    maxLength={4}
                    required
                    style={{
                      width: '60px',
                      padding: '12px 6px',
                      borderRadius: '8px',
                      background: 'rgba(255,255,255,0.01)',
                      border: '1px solid rgba(255,255,255,0.08)',
                      color: '#ffffff',
                      textAlign: 'center',
                      outline: 'none',
                      fontSize: '15px'
                    }}
                  />
                  <input 
                    type="tel" 
                    placeholder="Ex: 11999998888"
                    value={clientPhone}
                    onChange={(e) => setClientPhone(e.target.value)}
                    required
                    style={{
                      flex: 1,
                      padding: '12px 14px',
                      borderRadius: '8px',
                      background: 'rgba(255,255,255,0.01)',
                      border: '1px solid rgba(255,255,255,0.08)',
                      color: '#ffffff',
                      outline: 'none',
                      fontSize: '15px'
                    }}
                  />
                </div>
                <span style={{ fontSize: '11px', color: 'rgba(255,255,255,0.3)', marginTop: '2px' }}>
                  Enviaremos uma confirmação para este número pelo WhatsApp.
                </span>
              </div>

              <button 
                type="submit" 
                disabled={bookingLoading}
                style={{
                  padding: '14px',
                  borderRadius: '8px',
                  background: primaryColor,
                  color: '#000000',
                  border: 'none',
                  fontWeight: 'bold',
                  fontSize: '15px',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '8px',
                  marginTop: '10px',
                  opacity: bookingLoading ? 0.7 : 1
                }}
              >
                {bookingLoading ? 'Processando...' : 'Confirmar Agendamento'}
                <Check size={18} />
              </button>
            </form>
          </div>
        )}

        {/* STEP 6: BOOKING SUCCESS PAGE */}
        {currentStep === 6 && bookingSuccess && (
          <div style={{ 
            textAlign: 'center', 
            padding: '30px 16px',
            background: 'rgba(255,255,255,0.01)',
            border: '1px solid rgba(255,255,255,0.05)',
            borderRadius: '16px',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '16px',
            boxShadow: '0 8px 32px rgba(0,0,0,0.5)'
          }}>
            <div style={{
              width: '64px',
              height: '64px',
              borderRadius: '50%',
              backgroundColor: 'rgba(16,185,129,0.1)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              border: '2px solid #10b981',
              color: '#10b981',
              marginBottom: '10px'
            }}>
              <CheckCircle2 size={36} />
            </div>

            <h2 style={{ fontSize: '22px', fontWeight: 'bold' }}>Agendado com Sucesso!</h2>
            <p style={{ fontSize: '14px', color: 'rgba(255,255,255,0.6)', lineHeight: '1.5' }}>
              Olá *{clientName}*, sua reserva foi cadastrada! Você receberá uma confirmação no número informado pelo WhatsApp.
            </p>

            <div style={{
              width: '100%',
              background: 'rgba(255,255,255,0.02)',
              border: '1px solid rgba(255,255,255,0.05)',
              borderRadius: '12px',
              padding: '16px',
              textAlign: 'left',
              fontSize: '14px',
              display: 'flex',
              flexDirection: 'column',
              gap: '10px',
              marginTop: '10px'
            }}>
              <p><span style={{ color: 'rgba(255,255,255,0.4)' }}>Barbearia:</span> <strong>{est.name}</strong></p>
              {selectedService && (
                <p><span style={{ color: 'rgba(255,255,255,0.4)' }}>Serviço:</span> <strong>{selectedService.name} (R$ {parseFloat(selectedService.price).toFixed(2)})</strong></p>
              )}
              <p><span style={{ color: 'rgba(255,255,255,0.4)' }}>Profissional:</span> <strong>{selectedBarber?.name}</strong></p>
              <p><span style={{ color: 'rgba(255,255,255,0.4)' }}>Data:</span> <strong>{new Date(selectedSlot).toLocaleDateString('pt-BR', { day: 'numeric', month: 'long', year: 'numeric' })}</strong></p>
              <p><span style={{ color: 'rgba(255,255,255,0.4)' }}>Horário:</span> <strong>{new Date(selectedSlot).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })} hs</strong></p>
            </div>

            <button
              onClick={() => {
                setSelectedBarber(null);
                setSelectedService(null);
                setSelectedDate('');
                setSelectedSlot('');
                setClientName('');
                setClientPhone('');
                setBookingSuccess(false);
                setCurrentStep(1);
              }}
              style={{
                width: '100%',
                padding: '12px',
                borderRadius: '8px',
                background: 'rgba(255,255,255,0.05)',
                border: '1px solid rgba(255,255,255,0.1)',
                color: '#ffffff',
                fontWeight: 'bold',
                cursor: 'pointer',
                fontSize: '14px',
                marginTop: '10px',
                transition: 'all 0.15s ease'
              }}
            >
              Novo Agendamento
            </button>
          </div>
        )}

      </main>

      {/* LIGHTBOX: FOTO EXPANDIDA */}
      {expandedPhoto && (
        <div 
          style={{ 
            position: 'fixed', 
            top: 0, 
            left: 0, 
            right: 0, 
            bottom: 0, 
            backgroundColor: 'rgba(0,0,0,0.95)', 
            display: 'flex', 
            justifyContent: 'center', 
            alignItems: 'center', 
            zIndex: 99999, 
            padding: '20px',
            cursor: 'zoom-out'
          }}
          onClick={() => setExpandedPhoto(null)}
        >
          <button
            type="button"
            style={{ 
              position: 'absolute', 
              top: '20px', 
              right: '20px', 
              background: 'rgba(255,255,255,0.1)', 
              color: '#ffffff', 
              border: 'none', 
              borderRadius: '50%', 
              width: '40px', 
              height: '40px', 
              display: 'flex', 
              justifyContent: 'center', 
              alignItems: 'center', 
              cursor: 'pointer',
              zIndex: 100000
            }}
            onClick={(e) => {
              e.stopPropagation();
              setExpandedPhoto(null);
            }}
          >
            <X size={24} />
          </button>
          
          <img 
            src={expandedPhoto} 
            alt="Local do Salão Expandido" 
            style={{ 
              maxWidth: '90%', 
              maxHeight: '85%', 
              objectFit: 'contain', 
              borderRadius: '8px', 
              boxShadow: '0 10px 30px rgba(0,0,0,0.8)',
              cursor: 'default'
            }}
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}

      {/* Footer */}
      <footer style={{ 
        width: '100%', 
        maxWidth: '480px', 
        textAlign: 'center', 
        marginTop: 'auto',
        padding: '30px 0 10px 0',
        fontSize: '11px',
        color: 'rgba(255,255,255,0.25)'
      }}>
        <p>&copy; {new Date().getFullYear()} {est.name}. Todos os direitos reservados.</p>
        <p style={{ marginTop: '4px' }}>Desenvolvido por Antigravity Barber Systems ⚡</p>
      </footer>
    </div>
  );
};
