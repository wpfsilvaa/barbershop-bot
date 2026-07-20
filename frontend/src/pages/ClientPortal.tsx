import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  Calendar, 
  CalendarRange,
  Clock, 
  User, 
  Scissors, 
  Star, 
  Trash2, 
  LogOut, 
  Plus, 
  CheckCircle2, 
  AlertCircle, 
  Activity, 
  ChevronRight,
  MapPin,
  Sparkles,
  ArrowLeft,
  X
} from 'lucide-react';
import { apiRequest } from '../services/api';

// Interface definitions
interface Booking {
  id: string;
  appointment_time: string;
  status: 'confirmed' | 'cancelled' | 'completed';
  cancellation_reason: string | null;
  service_name: string;
  price: string;
  duration_minutes: number;
  barber_name: string;
  establishment_name: string;
  establishment_id: string;
  rating: number | null;
  comment: string | null;
}

interface ClientPlan {
  id: string;
  status: string;
  expires_at: string;
  created_at: string;
  plan_name: string;
  price: string;
  duration_days: number;
  max_bookings: number;
  establishment_name: string;
}

interface Establishment {
  id: string;
  name: string;
  logo_url: string | null;
  address?: string;
  opening_time: string;
  closing_time: string;
}

interface Barber {
  id: string;
  name: string;
  photo_url: string | null;
}

interface Service {
  id: string;
  name: string;
  price: string;
  duration_minutes: number;
  description: string | null;
}

interface Plan {
  id: string;
  name: string;
  price: string;
  duration_days: number;
  max_bookings: number;
  description: string | null;
}

export const ClientPortal: React.FC = () => {
  const navigate = useNavigate();

  const getApiUrl = (path: string) => {
    return `/api${path}`;
  };

  // Auth States
  const [token, setToken] = useState<string | null>(localStorage.getItem('client_portal_token'));
  const [clientInfo, setClientInfo] = useState<any>(JSON.parse(localStorage.getItem('client_portal_user') || 'null'));
  const [phone, setPhone] = useState('');
  const [name, setName] = useState('');
  const [showRegisterName, setShowRegisterName] = useState(false);
  const [authError, setAuthError] = useState('');
  const [authLoading, setAuthLoading] = useState(false);

  // Portal Dashboard States
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [plans, setPlans] = useState<ClientPlan[]>([]);
  const [establishments, setEstablishments] = useState<Establishment[]>([]);
  const [loadingData, setLoadingData] = useState(false);

  // Action / Modal States
  const [activeTab, setActiveTab] = useState<'appointments' | 'book' | 'plans'>('appointments');
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  // Booking Flow States
  const [selectedEst, setSelectedEst] = useState<string>('');
  const [estDetails, setEstDetails] = useState<{ barbers: Barber[]; services: Service[]; plans: Plan[] } | null>(null);
  const [selectedBarber, setSelectedBarber] = useState('');
  const [selectedService, setSelectedService] = useState('');
  const [selectedDate, setSelectedDate] = useState('');
  const [selectedTime, setSelectedTime] = useState('');
  const [availableSlots, setAvailableSlots] = useState<string[]>([]);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [bookingLoading, setBookingLoading] = useState(false);

  // Rescheduling States
  const [rescheduleBookingId, setRescheduleBookingId] = useState<string | null>(null);
  const [rescheduleDate, setRescheduleDate] = useState('');
  const [rescheduleTime, setRescheduleTime] = useState('');
  const [rescheduleSlots, setRescheduleSlots] = useState<string[]>([]);
  const [loadingReschedSlots, setLoadingReschedSlots] = useState(false);
  const [reschedulingLoading, setReschedulingLoading] = useState(false);

  // Feedback/Evaluation States
  const [feedbackBookingId, setFeedbackBookingId] = useState<string | null>(null);
  const [feedbackRating, setFeedbackRating] = useState<number>(5);
  const [feedbackComment, setFeedbackComment] = useState('');
  const [feedbackLoading, setFeedbackLoading] = useState(false);

  // Subscription Flow States
  const [selectedPlanType, setSelectedPlanType] = useState<'quinzenal' | 'mensal'>('mensal');
  const [selectedPlanBarber, setSelectedPlanBarber] = useState('');
  const [selectedPlanDay, setSelectedPlanDay] = useState(1);
  const [selectedPlanTime, setSelectedPlanTime] = useState('09:00');
  const [subscribingLoading, setSubscribingLoading] = useState(false);

  // Trigger Toast helper
  const showToast = (message: string, type: 'success' | 'error' = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  };

  // 1. Fetch Client Dashboard data from API
  const fetchDashboardData = async () => {
    if (!token) return;
    setLoadingData(true);
    try {
      const response = await fetch(getApiUrl('/client/dashboard'), {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          handleLogout();
        }
        throw new Error('Falha ao obter dados.');
      }
      const data = await response.json();
      setBookings(data.bookings || []);
      setPlans(data.plans || []);
      setEstablishments(data.establishments || []);
    } catch (err: any) {
      showToast('Erro ao carregar dados do portal.', 'error');
    } finally {
      setLoadingData(false);
    }
  };

  useEffect(() => {
    if (token) {
      fetchDashboardData();
    }
  }, [token]);

  // 2. Fetch specific establishment details for booking flow
  const fetchEstablishmentDetails = async (estId: string) => {
    if (!token || !estId) return;
    try {
      const response = await fetch(getApiUrl(`/client/establishments/${estId}/details`), {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      if (response.ok) {
        const data = await response.json();
        setEstDetails(data);
      }
    } catch (err) {
      showToast('Erro ao carregar detalhes do estabelecimento.', 'error');
    }
  };

  useEffect(() => {
    if (selectedEst) {
      fetchEstablishmentDetails(selectedEst);
      setSelectedBarber('');
      setSelectedService('');
      setSelectedDate('');
      setSelectedTime('');
      setAvailableSlots([]);
    } else {
      setEstDetails(null);
    }
  }, [selectedEst]);

  // 3. Fetch available timeslots for booking
  const loadSlots = async (barberId: string, date: string, isReschedule = false) => {
    if (!token || !barberId || !date) return;
    const estId = isReschedule 
      ? bookings.find(b => b.id === rescheduleBookingId)?.establishment_id 
      : selectedEst;

    if (!estId) return;

    if (isReschedule) setLoadingReschedSlots(true);
    else setLoadingSlots(true);

    try {
      const response = await fetch(getApiUrl(`/establishments/${estId}/barbers/${barberId}/available-slots?date=${date}`), {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      if (response.ok) {
        const data = await response.json();
        if (isReschedule) setRescheduleSlots(data || []);
        else setAvailableSlots(data || []);
      }
    } catch (err) {
      showToast('Erro ao carregar horários disponíveis.', 'error');
    } finally {
      if (isReschedule) setLoadingReschedSlots(false);
      else setLoadingSlots(false);
    }
  };

  useEffect(() => {
    if (selectedBarber && selectedDate) {
      loadSlots(selectedBarber, selectedDate, false);
    }
  }, [selectedBarber, selectedDate]);

  useEffect(() => {
    if (rescheduleBookingId && rescheduleDate) {
      const b = bookings.find(x => x.id === rescheduleBookingId);
      const apptRes = rescheduleBookingId;
      // Fetch details
      const fetchApptInfo = async () => {
        try {
          const res = await fetch(getApiUrl('/client/dashboard'), {
            headers: { 'Authorization': `Bearer ${token}` }
          });
          if (res.ok) {
            const data = await res.json();
            const currentAppt = data.bookings.find((x: any) => x.id === apptRes);
            if (currentAppt) {
              // Retrieve barber ID by mapping barber name, or query
              const estDetRes = await fetch(getApiUrl(`/client/establishments/${currentAppt.establishment_id}/details`), {
                headers: { 'Authorization': `Bearer ${token}` }
              });
              if (estDetRes.ok) {
                const estDetailsData = await estDetRes.json();
                const matchedBarber = estDetailsData.barbers.find((barb: any) => barb.name === currentAppt.barber_name);
                if (matchedBarber) {
                  loadSlots(matchedBarber.id, rescheduleDate, true);
                }
              }
            }
          }
        } catch (e) {
          console.error(e);
        }
      };
      fetchApptInfo();
    }
  }, [rescheduleDate, rescheduleBookingId]);

  // Auth Submit Action
  const handleAuthSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!phone) {
      setAuthError('Digite seu telefone.');
      return;
    }
    setAuthError('');
    setAuthLoading(true);
    try {
      const response = await fetch(getApiUrl('/client/auth'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, name: showRegisterName ? name : undefined })
      });
      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.error || 'Erro ao realizar login.');
      }

      if (data.exists === false) {
        setShowRegisterName(true);
        showToast('Por favor, informe seu nome para realizar o cadastro rápido.', 'error');
        setAuthLoading(false);
        return;
      }

      // Login success
      localStorage.setItem('client_portal_token', data.token);
      localStorage.setItem('client_portal_user', JSON.stringify(data.client));
      setToken(data.token);
      setClientInfo(data.client);
      showToast(`Bem-vindo, ${data.client.name}! 💈`);
    } catch (err: any) {
      setAuthError(err.message || 'Erro ao realizar login.');
    } finally {
      setAuthLoading(false);
    }
  };

  // Logout Action
  const handleLogout = () => {
    localStorage.removeItem('client_portal_token');
    localStorage.removeItem('client_portal_user');
    setToken(null);
    setClientInfo(null);
    setPhone('');
    setName('');
    setShowRegisterName(false);
  };

  // Book Appointment Submit Action
  const handleBookAppointmentSubmit = async () => {
    if (!selectedEst || !selectedBarber || !selectedService || !selectedDate || !selectedTime) {
      showToast('Por favor, preencha todos os campos do agendamento.', 'error');
      return;
    }

    setBookingLoading(true);
    try {
      const appointmentTime = `${selectedDate}T${selectedTime}:00`;
      const response = await fetch(getApiUrl('/client/bookings'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          establishmentId: selectedEst,
          barberId: selectedBarber,
          serviceId: selectedService,
          appointmentTime
        })
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Erro ao agendar.');
      }

      showToast('Horário agendado com sucesso! Confirmação enviada no WhatsApp.');
      // Reset form
      setSelectedEst('');
      setEstDetails(null);
      setActiveTab('appointments');
      fetchDashboardData();
    } catch (err: any) {
      showToast(err.message || 'Erro ao efetuar agendamento.', 'error');
    } finally {
      setBookingLoading(false);
    }
  };

  // Cancel Appointment Action
  const handleCancelBooking = async (bookingId: string) => {
    if (!window.confirm('Tem certeza que deseja cancelar este agendamento?')) return;
    try {
      const response = await fetch(getApiUrl(`/client/bookings/${bookingId}/cancel`), {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Erro ao cancelar.');
      }
      showToast('Agendamento cancelado com sucesso.');
      fetchDashboardData();
    } catch (err: any) {
      showToast(err.message || 'Erro ao cancelar agendamento.', 'error');
    }
  };

  // Cancel All Appointments Action
  const handleCancelAllBookings = async () => {
    if (!window.confirm('Tem certeza que deseja cancelar TODOS os seus agendamentos futuros?')) return;
    try {
      const response = await fetch(getApiUrl('/client/bookings/cancel-all'), {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Erro ao cancelar todos.');
      }
      showToast(`Cancelamento finalizado. ${data.cancelledCount} agendamentos cancelados.`);
      fetchDashboardData();
    } catch (err: any) {
      showToast(err.message || 'Erro ao cancelar agendamentos.', 'error');
    }
  };

  // Reschedule Appointment Submit Action
  const handleRescheduleSubmit = async () => {
    if (!rescheduleBookingId || !rescheduleDate || !rescheduleTime) {
      showToast('Selecione data e hora para remarcar.', 'error');
      return;
    }
    setReschedulingLoading(true);
    try {
      const newTime = `${rescheduleDate}T${rescheduleTime}:00`;
      const response = await fetch(getApiUrl(`/client/bookings/${rescheduleBookingId}/reschedule`), {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ newTime })
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Erro ao remarcar.');
      }
      showToast('Horário alterado com sucesso! Confirmação enviada no WhatsApp.');
      setRescheduleBookingId(null);
      setRescheduleDate('');
      setRescheduleTime('');
      fetchDashboardData();
    } catch (err: any) {
      showToast(err.message || 'Erro ao remarcar horário.', 'error');
    } finally {
      setReschedulingLoading(false);
    }
  };

  // Submit Feedback Submit Action
  const handleFeedbackSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!feedbackBookingId) return;
    setFeedbackLoading(true);
    try {
      const response = await fetch(getApiUrl('/client/feedbacks'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          appointmentId: feedbackBookingId,
          rating: feedbackRating,
          comment: feedbackComment
        })
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Erro ao enviar feedback.');
      }
      showToast('Avaliação enviada com sucesso! Muito obrigado.');
      setFeedbackBookingId(null);
      setFeedbackComment('');
      setFeedbackRating(5);
      fetchDashboardData();
    } catch (err: any) {
      showToast(err.message || 'Erro ao enviar avaliação.', 'error');
    } finally {
      setFeedbackLoading(false);
    }
  };

  // Subscribe to plan action
  const handleSubscribePlan = async () => {
    if (!selectedEst || !selectedPlanBarber || !selectedPlanTime) {
      showToast('Por favor, preencha todos os campos da assinatura.', 'error');
      return;
    }
    if (!window.confirm('Confirmar assinatura do plano recorrente? O agendamento automático será gerado.')) return;
    
    setSubscribingLoading(true);
    try {
      const response = await fetch(getApiUrl('/client/subscribe'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          establishmentId: selectedEst,
          barberId: selectedPlanBarber,
          planType: selectedPlanType,
          preferredTime: selectedPlanTime + ':00',
          preferredDayOfWeek: selectedPlanDay
        })
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Erro ao assinar plano.');
      }
      showToast('Plano assinado com sucesso! Cortes recorrentes agendados.');
      setSelectedPlanBarber('');
      setSelectedPlanTime('09:00');
      fetchDashboardData();
      setActiveTab('appointments');
    } catch (err: any) {
      showToast(err.message || 'Erro ao assinar plano.', 'error');
    } finally {
      setSubscribingLoading(false);
    }
  };

  // Helper formatting values
  const getMinDateString = () => {
    const today = new Date();
    return today.toISOString().split('T')[0];
  };

  // Login JSX Layout
  if (!token) {
    return (
      <div style={{ minHeight: '100vh', background: 'radial-gradient(circle at top right, #1a1a1a, #0b0b0b)', display: 'flex', justifyContent: 'center', alignItems: 'center', color: '#ffffff', fontFamily: '"Outfit", sans-serif', padding: '20px' }}>
        <div className="glass-panel animate-fade-in" style={{ width: '100%', maxWidth: '440px', padding: '40px', borderRadius: '24px', boxShadow: '0 20px 40px rgba(0,0,0,0.5)', background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', backdropFilter: 'blur(20px)' }}>
          <div style={{ textAlign: 'center', marginBottom: '32px' }}>
            <div style={{ width: '72px', height: '72px', borderRadius: '24px', background: 'linear-gradient(135deg, var(--primary), #ffffff)', margin: '0 auto 20px auto', display: 'flex', justifyContent: 'center', alignItems: 'center', color: '#121212', boxShadow: '0 8px 16px rgba(212,175,55,0.2)' }}>
              <Scissors size={32} />
            </div>
            <h1 style={{ fontSize: '28px', fontWeight: 'bold', marginBottom: '8px', letterSpacing: '-0.5px' }}>Portal do Cliente</h1>
            <p style={{ color: 'var(--muted)', fontSize: '14px' }}>Digite seu número para gerenciar seus horários e planos</p>
          </div>

          <form onSubmit={handleAuthSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            <div className="form-group">
              <label style={{ display: 'block', fontSize: '13px', marginBottom: '8px', color: 'var(--muted)' }}>Seu WhatsApp</label>
              <div style={{ display: 'flex', position: 'relative', alignItems: 'center' }}>
                <span style={{ position: 'absolute', left: '16px', color: 'var(--muted)', fontSize: '15px' }}>+55</span>
                <input 
                  type="tel" 
                  className="form-input" 
                  style={{ paddingLeft: '56px', height: '48px', fontSize: '15px', borderRadius: '12px' }} 
                  placeholder="(DDD) 99999-9999"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  disabled={authLoading}
                />
              </div>
            </div>

            {showRegisterName && (
              <div className="form-group animate-slide-in">
                <label style={{ display: 'block', fontSize: '13px', marginBottom: '8px', color: 'var(--muted)' }}>Como devemos te chamar? (Seu Nome)</label>
                <input 
                  type="text" 
                  className="form-input" 
                  style={{ height: '48px', fontSize: '15px', borderRadius: '12px' }} 
                  placeholder="Seu nome completo"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  disabled={authLoading}
                />
              </div>
            )}

            {authError && (
              <div style={{ padding: '12px 16px', background: 'rgba(239,68,68,0.1)', color: '#ef4444', borderRadius: '10px', fontSize: '13px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <AlertCircle size={16} />
                <span>{authError}</span>
              </div>
            )}

            <button 
              type="submit" 
              className="btn-primary" 
              style={{ height: '48px', borderRadius: '12px', fontWeight: 'bold', fontSize: '15px', marginTop: '8px', justifyContent: 'center' }}
              disabled={authLoading}
            >
              {authLoading ? 'Verificando...' : showRegisterName ? 'Criar Conta & Entrar' : 'Acessar Meu Portal'}
            </button>
          </form>

          <div style={{ textAlign: 'center', marginTop: '24px', borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '20px' }}>
            <button 
              type="button" 
              style={{ background: 'transparent', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: '13px', display: 'inline-flex', alignItems: 'center', gap: '6px' }}
              onClick={() => navigate('/')}
              onMouseEnter={(e) => e.currentTarget.style.color = '#ffffff'}
              onMouseLeave={(e) => e.currentTarget.style.color = 'var(--muted)'}
            >
              ← Voltar para a Página Inicial
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Active future bookings helper
  const futureBookings = bookings.filter(b => b.status === 'confirmed' && new Date(b.appointment_time) > new Date());
  // Passed/Completed bookings helper
  const pastBookings = bookings.filter(b => b.status === 'completed' || new Date(b.appointment_time) <= new Date() || b.status === 'cancelled');

  // Customer Portal Main Layout
  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#0d0d0d', color: '#ffffff', fontFamily: '"Outfit", sans-serif', display: 'flex', flexDirection: 'column' }}>
      
      {/* HEADER DE TOPO */}
      <header style={{ borderBottom: '1px solid rgba(255,255,255,0.05)', background: 'rgba(18,18,18,0.8)', backdropFilter: 'blur(10px)', position: 'sticky', top: 0, zIndex: 100 }}>
        <div style={{ maxWidth: '1000px', margin: '0 auto', padding: '16px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{ width: '38px', height: '38px', borderRadius: '10px', background: 'var(--primary)', display: 'flex', justifyContent: 'center', alignItems: 'center', color: '#121212', fontWeight: 'bold' }}>
              <Scissors size={18} />
            </div>
            <div>
              <span style={{ fontSize: '14px', color: 'var(--muted)', display: 'block' }}>Olá, bem-vindo</span>
              <span style={{ fontSize: '16px', fontWeight: 'bold' }}>{clientInfo?.name}</span>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <button className="btn-secondary" style={{ padding: '8px 12px', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px' }} onClick={handleLogout}>
              <LogOut size={14} />
              <span>Sair</span>
            </button>
          </div>
        </div>
      </header>

      {/* TOAST SYSTEM */}
      {toast && (
        <div style={{ position: 'fixed', bottom: '24px', right: '24px', padding: '16px 24px', borderRadius: '12px', background: toast.type === 'success' ? '#10b981' : '#ef4444', color: '#ffffff', display: 'flex', alignItems: 'center', gap: '12px', boxShadow: '0 10px 25px rgba(0,0,0,0.3)', zIndex: 1000, fontWeight: 'bold', animation: 'slide-in 0.3s ease-out' }}>
          {toast.type === 'success' ? <CheckCircle2 size={20} /> : <AlertCircle size={20} />}
          <span>{toast.message}</span>
        </div>
      )}

      {/* MAIN CONTAINER */}
      <main style={{ flex: 1, maxWidth: '1000px', width: '100%', margin: '0 auto', padding: '24px 20px', display: 'flex', flexDirection: 'column', gap: '24px' }}>
        
        {/* MENU TABS */}
        <div style={{ display: 'flex', gap: '12px', borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: '12px' }}>
          <button 
            style={{ padding: '10px 16px', borderRadius: '10px', border: 'none', background: activeTab === 'appointments' ? 'rgba(212,175,55,0.1)' : 'transparent', color: activeTab === 'appointments' ? 'var(--primary)' : 'var(--muted)', fontWeight: 'bold', fontSize: '14px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px' }} 
            onClick={() => setActiveTab('appointments')}
          >
            <Calendar size={16} />
            Meus Agendamentos
          </button>
          <button 
            style={{ padding: '10px 16px', borderRadius: '10px', border: 'none', background: activeTab === 'book' ? 'rgba(212,175,55,0.1)' : 'transparent', color: activeTab === 'book' ? 'var(--primary)' : 'var(--muted)', fontWeight: 'bold', fontSize: '14px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px' }} 
            onClick={() => setActiveTab('book')}
          >
            <Plus size={16} />
            Agendar Horário
          </button>
          <button 
            style={{ padding: '10px 16px', borderRadius: '10px', border: 'none', background: activeTab === 'plans' ? 'rgba(212,175,55,0.1)' : 'transparent', color: activeTab === 'plans' ? 'var(--primary)' : 'var(--muted)', fontWeight: 'bold', fontSize: '14px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px' }} 
            onClick={() => setActiveTab('plans')}
          >
            <Sparkles size={16} />
            Assinaturas / Planos
          </button>
        </div>

        {/* TAB CONTENT: APPOINTMENTS */}
        {activeTab === 'appointments' && (
          <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
            
            {/* Agendamentos Futuros */}
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                <h2 style={{ fontSize: '20px', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Calendar size={18} style={{ color: 'var(--primary)' }} />
                  Horários Reservados
                </h2>
                {futureBookings.length > 1 && (
                  <button className="btn-secondary" style={{ color: '#ef4444', borderColor: 'rgba(239,68,68,0.2)', padding: '6px 12px', fontSize: '12px' }} onClick={handleCancelAllBookings}>
                    <Trash2 size={12} />
                    <span>Cancelar Todos</span>
                  </button>
                )}
              </div>

              {loadingData ? (
                <p style={{ color: 'var(--muted)' }}>Carregando seus horários...</p>
              ) : futureBookings.length === 0 ? (
                <div className="card-premium" style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--muted)' }}>
                  <CalendarRange size={36} style={{ margin: '0 auto 12px auto', opacity: 0.3 }} />
                  <p style={{ fontSize: '14px', marginBottom: '16px' }}>Você não possui nenhum agendamento pendente.</p>
                  <button className="btn-primary" style={{ display: 'inline-flex', gap: '8px', padding: '10px 20px', fontSize: '14px' }} onClick={() => setActiveTab('book')}>
                    <Plus size={16} />
                    <span>Agendar Agora</span>
                  </button>
                </div>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '16px' }}>
                  {futureBookings.map((b) => {
                    const date = new Date(b.appointment_time);
                    const formattedDate = date.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });
                    const formattedTime = date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
                    
                    return (
                      <div key={b.id} className="card-premium animate-slide-in" style={{ display: 'flex', flexDirection: 'column', gap: '14px', borderLeft: '4px solid var(--primary)' }}>
                        <div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '4px' }}>
                            <span style={{ fontSize: '13px', color: 'var(--primary)', fontWeight: 'bold' }}>{b.establishment_name}</span>
                            <span className="badge badge-confirmed">Agendado</span>
                          </div>
                          <h4 style={{ fontSize: '16px', fontWeight: 'bold', textTransform: 'capitalize' }}>{formattedDate}</h4>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', color: 'var(--muted)', marginTop: '4px' }}>
                            <Clock size={12} />
                            <span>{formattedTime} ({b.duration_minutes} min)</span>
                          </div>
                        </div>

                        <div style={{ background: 'rgba(255,255,255,0.02)', padding: '10px', borderRadius: '8px', fontSize: '13px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                          <div><strong>Serviço:</strong> {b.service_name} - R$ {parseFloat(b.price).toFixed(2)}</div>
                          <div><strong>Profissional:</strong> {b.barber_name}</div>
                        </div>

                        <div style={{ display: 'flex', gap: '8px', marginTop: '4px' }}>
                          <button 
                            className="btn-secondary" 
                            style={{ flex: 1, padding: '8px', fontSize: '12px' }}
                            onClick={() => {
                              setRescheduleBookingId(b.id);
                              setRescheduleDate('');
                              setRescheduleTime('');
                              setRescheduleSlots([]);
                            }}
                          >
                            Remarcar
                          </button>
                          <button 
                            className="btn-secondary" 
                            style={{ flex: 1, padding: '8px', fontSize: '12px', color: '#ef4444', borderColor: 'rgba(239,68,68,0.1)' }}
                            onClick={() => handleCancelBooking(b.id)}
                          >
                            Cancelar
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Histórico e Cancelados */}
            <div>
              <h2 style={{ fontSize: '20px', fontWeight: 'bold', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Activity size={18} style={{ color: 'var(--muted)' }} />
                Histórico de Atendimentos
              </h2>

              {loadingData ? (
                <p style={{ color: 'var(--muted)' }}>Carregando histórico...</p>
              ) : pastBookings.length === 0 ? (
                <p style={{ color: 'var(--muted)', fontSize: '14px' }}>Sem histórico de agendamentos registrados.</p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  {pastBookings.map((b) => {
                    const date = new Date(b.appointment_time);
                    const formattedDate = date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
                    const formattedTime = date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
                    
                    return (
                      <div key={b.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px', background: 'rgba(255,255,255,0.01)', border: '1px solid rgba(255,255,255,0.03)', borderRadius: '12px', flexWrap: 'wrap', gap: '16px' }}>
                        <div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                            <span style={{ fontSize: '13px', fontWeight: 'bold' }}>{b.service_name}</span>
                            <span style={{ fontSize: '12px', color: 'var(--muted)' }}>• {b.establishment_name}</span>
                          </div>
                          <div style={{ fontSize: '12px', color: 'var(--muted)' }}>
                            {formattedDate} às {formattedTime} com {b.barber_name}
                          </div>
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                          {b.status === 'completed' && !b.rating && (
                            <button 
                              className="btn-primary" 
                              style={{ padding: '6px 12px', fontSize: '12px', background: 'linear-gradient(135deg, #eab308, #ca8a04)', color: '#121212', fontWeight: 'bold' }}
                              onClick={() => {
                                setFeedbackBookingId(b.id);
                                setFeedbackRating(5);
                                setFeedbackComment('');
                              }}
                            >
                              Avaliar Serviço
                            </button>
                          )}
                          {b.rating && (
                            <div style={{ display: 'flex', alignItems: 'center', gap: '4px', background: 'rgba(234,179,8,0.1)', padding: '4px 8px', borderRadius: '6px', color: '#eab308', fontSize: '12px', fontWeight: 'bold' }}>
                              <Star size={12} fill="#eab308" />
                              <span>{b.rating}</span>
                            </div>
                          )}
                          <span className={`badge ${b.status === 'completed' ? 'badge-completed' : b.status === 'cancelled' ? 'badge-cancelled' : 'badge-confirmed'}`}>
                            {b.status === 'completed' ? 'Pago' : b.status === 'cancelled' ? 'Cancelado' : 'Agendado'}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        {/* TAB CONTENT: BOOK NEW */}
        {activeTab === 'book' && (
          <div className="card-premium animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            <h2 style={{ fontSize: '20px', fontWeight: 'bold', marginBottom: '8px' }}>Agendar Novo Atendimento</h2>
            
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '20px' }}>
              
              {/* Barbearia */}
              <div className="form-group">
                <label style={{ display: 'block', fontSize: '13px', marginBottom: '8px', color: 'var(--muted)' }}>Escolha o Salão</label>
                <select 
                  className="form-input" 
                  value={selectedEst}
                  onChange={(e) => setSelectedEst(e.target.value)}
                >
                  <option value="">Selecione...</option>
                  {establishments.map(est => (
                    <option key={est.id} value={est.id}>{est.name}</option>
                  ))}
                </select>
              </div>

              {selectedEst && (
                (() => {
                  const estObj = establishments.find(e => e.id === selectedEst);
                  if (!estObj || !estObj.address) return null;
                  return (
                    <div className="card-premium" style={{ gridColumn: 'span 2', display: 'flex', flexDirection: 'column', gap: '12px', padding: '16px', background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: 'var(--primary)' }}>
                        <MapPin size={16} />
                        <span><strong>Endereço do Salão:</strong> {estObj.address}</span>
                      </div>
                      <div style={{ width: '100%', height: '180px', borderRadius: '6px', overflow: 'hidden' }}>
                        <iframe 
                          width="100%" 
                          height="100%" 
                          frameBorder="0" 
                          style={{ border: 0 }} 
                          src={`https://maps.google.com/maps?q=${encodeURIComponent(estObj.address)}&t=&z=15&ie=UTF8&iwloc=&output=embed`} 
                          allowFullScreen
                        />
                      </div>
                    </div>
                  );
                })()
              )}

              {/* Barbeiro */}
              <div className="form-group">
                <label style={{ display: 'block', fontSize: '13px', marginBottom: '8px', color: 'var(--muted)' }}>Profissional</label>
                <select 
                  className="form-input" 
                  value={selectedBarber}
                  onChange={(e) => setSelectedBarber(e.target.value)}
                  disabled={!selectedEst || !estDetails}
                >
                  <option value="">Selecione...</option>
                  {estDetails?.barbers.map(b => (
                    <option key={b.id} value={b.id}>{b.name}</option>
                  ))}
                </select>
              </div>

              {/* Serviço */}
              <div className="form-group">
                <label style={{ display: 'block', fontSize: '13px', marginBottom: '8px', color: 'var(--muted)' }}>Serviço</label>
                <select 
                  className="form-input" 
                  value={selectedService}
                  onChange={(e) => setSelectedService(e.target.value)}
                  disabled={!selectedEst || !estDetails}
                >
                  <option value="">Selecione...</option>
                  {estDetails?.services.map(s => (
                    <option key={s.id} value={s.id}>{s.name} (R$ {parseFloat(s.price).toFixed(2)})</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Data e Hora */}
            {selectedBarber && selectedService && (
              <div className="animate-slide-in" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '20px', marginTop: '12px' }}>
                <div className="form-group">
                  <label style={{ display: 'block', fontSize: '13px', marginBottom: '8px', color: 'var(--muted)' }}>Selecione a Data</label>
                  <input 
                    type="date" 
                    className="form-input" 
                    min={getMinDateString()}
                    value={selectedDate}
                    onChange={(e) => {
                      setSelectedDate(e.target.value);
                      setSelectedTime('');
                    }}
                  />
                </div>

                <div className="form-group">
                  <label style={{ display: 'block', fontSize: '13px', marginBottom: '8px', color: 'var(--muted)' }}>Horário Disponível</label>
                  {loadingSlots ? (
                    <p style={{ color: 'var(--muted)', fontSize: '14px', padding: '10px 0' }}>Consultando horários livres...</p>
                  ) : availableSlots.length === 0 ? (
                    <p style={{ color: '#ef4444', fontSize: '13px', padding: '10px 0' }}>Selecione uma data para ver os horários ou tente outra data.</p>
                  ) : (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(70px, 1fr))', gap: '8px', maxHeight: '160px', overflowY: 'auto', paddingRight: '4px' }}>
                      {availableSlots.map((slot) => {
                        const timeStr = slot.split('T')[1].substring(0, 5);
                        const isSelected = selectedTime === timeStr;
                        return (
                          <button 
                            key={slot} 
                            type="button"
                            className={isSelected ? 'btn-primary' : 'btn-secondary'}
                            style={{ padding: '6px 4px', fontSize: '12px', textAlign: 'center', borderRadius: '8px' }}
                            onClick={() => setSelectedTime(timeStr)}
                          >
                            {timeStr}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Agendar Confirmar */}
            {selectedTime && (
              <div style={{ marginTop: '24px', display: 'flex', justifyContent: 'flex-end', gap: '12px', borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '20px' }}>
                <button 
                  className="btn-primary animate-scale-up" 
                  style={{ padding: '12px 24px', fontWeight: 'bold' }}
                  onClick={handleBookAppointmentSubmit}
                  disabled={bookingLoading}
                >
                  {bookingLoading ? 'Agendando...' : 'Confirmar Horário'}
                </button>
              </div>
            )}
          </div>
        )}

        {/* TAB CONTENT: PLANS */}
        {activeTab === 'plans' && (
          <div className="animate-fade-in" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '32px' }}>
            
            {/* Minhas Assinaturas Ativas */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              <h2 style={{ fontSize: '20px', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <CheckCircle2 size={18} style={{ color: 'var(--primary)' }} />
                Minhas Assinaturas Ativas
              </h2>

              {plans.length === 0 ? (
                <div className="card-premium" style={{ color: 'var(--muted)', padding: '24px', textAlign: 'center' }}>
                  Nenhum plano ativo assinado no momento.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                  {plans.map((p: any) => {
                    const planName = p.plan_type === 'mensal' ? 'Plano Mensal' : 'Plano Quinzenal';
                    const priceLabel = p.plan_type === 'mensal' ? 'R$ 149,90' : 'R$ 79,90';
                    const weekdayNames = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado'];
                    const dayName = weekdayNames[p.preferred_day_of_week] || 'Dia Indefinido';
                    const timeLabel = p.preferred_time.substring(0, 5);
                    return (
                      <div key={p.id} className="card-premium animate-slide-in" style={{ borderLeft: '4px solid #10b981', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                          <span style={{ fontSize: '13px', color: '#10b981', fontWeight: 'bold' }}>{p.establishment_name}</span>
                          <span className="badge badge-completed" style={{ background: 'rgba(16,185,129,0.1)', color: '#10b981' }}>Ativo</span>
                        </div>
                        <h4 style={{ fontSize: '18px', fontWeight: 'bold' }}>{planName}</h4>
                        <div style={{ fontSize: '13px', color: 'var(--muted)' }}>
                          <div><strong>Valor estimado:</strong> {priceLabel} / período</div>
                          <div><strong>Profissional Favorito:</strong> {p.barber_name}</div>
                          <div><strong>Dia/Hora Fixo:</strong> {dayName} às {timeLabel}</div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Assinar um Novo Plano */}
            <div className="card-premium" style={{ display: 'flex', flexDirection: 'column', gap: '20px', height: 'fit-content' }}>
              <h2 style={{ fontSize: '20px', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                <Sparkles size={18} style={{ color: 'var(--primary)' }} />
                Aderir a um Plano Recorrente
              </h2>

              <div className="form-group">
                <label style={{ display: 'block', fontSize: '13px', marginBottom: '8px', color: 'var(--muted)' }}>1. Escolha o Salão</label>
                <select 
                  className="form-input" 
                  value={selectedEst} 
                  onChange={(e) => setSelectedEst(e.target.value)}
                >
                  <option value="">Selecione a barbearia...</option>
                  {establishments.map(est => (
                    <option key={est.id} value={est.id}>{est.name}</option>
                  ))}
                </select>
              </div>

              {selectedEst && estDetails && (
                <div className="animate-slide-in" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                  
                  <div className="form-group">
                    <label style={{ display: 'block', fontSize: '13px', marginBottom: '8px', color: 'var(--muted)' }}>2. Profissional Favorito</label>
                    <select 
                      className="form-input" 
                      value={selectedPlanBarber} 
                      onChange={(e) => setSelectedPlanBarber(e.target.value)}
                    >
                      <option value="">Selecione o profissional...</option>
                      {estDetails.barbers.map(b => (
                        <option key={b.id} value={b.id}>{b.name}</option>
                      ))}
                    </select>
                  </div>

                  <div className="form-group">
                    <label style={{ display: 'block', fontSize: '13px', marginBottom: '8px', color: 'var(--muted)' }}>3. Tipo do Plano</label>
                    <div style={{ display: 'flex', gap: '10px' }}>
                      <button 
                        type="button"
                        className={selectedPlanType === 'mensal' ? 'btn-primary' : 'btn-secondary'}
                        style={{ flex: 1, fontWeight: 'bold', py: '10px', fontSize: '13px' }}
                        onClick={() => setSelectedPlanType('mensal')}
                      >
                        Mensal (R$ 149,90)
                      </button>
                      <button 
                        type="button"
                        className={selectedPlanType === 'quinzenal' ? 'btn-primary' : 'btn-secondary'}
                        style={{ flex: 1, fontWeight: 'bold', py: '10px', fontSize: '13px' }}
                        onClick={() => setSelectedPlanType('quinzenal')}
                      >
                        Quinzenal (R$ 79,90)
                      </button>
                    </div>
                  </div>

                  <div className="form-group">
                    <label style={{ display: 'block', fontSize: '13px', marginBottom: '8px', color: 'var(--muted)' }}>4. Dia da Semana Fixo</label>
                    <select 
                      className="form-input" 
                      value={selectedPlanDay} 
                      onChange={(e) => setSelectedPlanDay(parseInt(e.target.value, 10))}
                    >
                      <option value="1">Segunda-feira</option>
                      <option value="2">Terça-feira</option>
                      <option value="3">Quarta-feira</option>
                      <option value="4">Quinta-feira</option>
                      <option value="5">Sexta-feira</option>
                      <option value="6">Sábado</option>
                    </select>
                  </div>

                  <div className="form-group">
                    <label style={{ display: 'block', fontSize: '13px', marginBottom: '8px', color: 'var(--muted)' }}>5. Horário Fixo</label>
                    <select 
                      className="form-input" 
                      value={selectedPlanTime} 
                      onChange={(e) => setSelectedPlanTime(e.target.value)}
                    >
                      <option value="09:00">09:00</option>
                      <option value="09:30">09:30</option>
                      <option value="10:00">10:00</option>
                      <option value="10:30">10:30</option>
                      <option value="11:00">11:00</option>
                      <option value="11:30">11:30</option>
                      <option value="12:00">12:00</option>
                      <option value="12:30">12:30</option>
                      <option value="13:00">13:00</option>
                      <option value="13:30">13:30</option>
                      <option value="14:00">14:00</option>
                      <option value="14:30">14:30</option>
                      <option value="15:00">15:00</option>
                      <option value="15:30">15:30</option>
                      <option value="16:00">16:00</option>
                      <option value="16:30">16:30</option>
                      <option value="17:00">17:00</option>
                      <option value="17:30">17:30</option>
                      <option value="18:00">18:00</option>
                      <option value="18:30">18:30</option>
                      <option value="19:00">19:00</option>
                    </select>
                  </div>

                  <button 
                    type="button" 
                    className="btn-primary" 
                    style={{ width: '100%', fontWeight: 'bold', padding: '12px', marginTop: '10px' }}
                    onClick={handleSubscribePlan}
                    disabled={subscribingLoading}
                  >
                    {subscribingLoading ? 'Processando Assinatura...' : 'Confirmar & Agendar Recorrência'}
                  </button>
                </div>
              )}
            </div>

          </div>
        )}
      </main>

      {/* MODAL: RESCHEDULE */}
      {rescheduleBookingId && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.85)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 999, padding: '20px' }}>
          <div className="glass-panel animate-fade-in" style={{ width: '100%', maxWidth: '440px', padding: '32px', borderRadius: '16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
              <h3 style={{ fontSize: '18px', fontWeight: 'bold' }}>Alterar Horário do Agendamento</h3>
              <button 
                className="btn-secondary" 
                style={{ padding: '6px', border: 'none', color: 'var(--muted)' }} 
                onClick={() => setRescheduleBookingId(null)}
              >
                <X size={16} />
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div className="form-group">
                <label style={{ display: 'block', fontSize: '13px', marginBottom: '8px', color: 'var(--muted)' }}>Nova Data</label>
                <input 
                  type="date" 
                  className="form-input" 
                  min={getMinDateString()}
                  value={rescheduleDate}
                  onChange={(e) => {
                    setRescheduleDate(e.target.value);
                    setRescheduleTime('');
                    setRescheduleSlots([]);
                  }}
                />
              </div>

              <div className="form-group">
                <label style={{ display: 'block', fontSize: '13px', marginBottom: '8px', color: 'var(--muted)' }}>Horários Livres</label>
                {loadingReschedSlots ? (
                  <p style={{ color: 'var(--muted)', fontSize: '13px' }}>Carregando horários...</p>
                ) : rescheduleSlots.length === 0 ? (
                  <p style={{ color: '#ef4444', fontSize: '12px' }}>Escolha uma data com horários disponíveis.</p>
                ) : (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(70px, 1fr))', gap: '6px', maxHeight: '140px', overflowY: 'auto' }}>
                    {rescheduleSlots.map((slot) => {
                      const timeStr = slot.split('T')[1].substring(0, 5);
                      const isSelected = rescheduleTime === timeStr;
                      return (
                        <button 
                          key={slot} 
                          className={isSelected ? 'btn-primary' : 'btn-secondary'}
                          style={{ padding: '6px 4px', fontSize: '12px', textAlign: 'center', borderRadius: '8px' }}
                          onClick={() => setRescheduleTime(timeStr)}
                        >
                          {timeStr}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              <div style={{ display: 'flex', justifySelf: 'flex-end', gap: '10px', marginTop: '16px' }}>
                <button className="btn-secondary" style={{ flex: 1 }} onClick={() => setRescheduleBookingId(null)}>Cancelar</button>
                <button 
                  className="btn-primary" 
                  style={{ flex: 1, fontWeight: 'bold' }} 
                  onClick={handleRescheduleSubmit}
                  disabled={!rescheduleTime || reschedulingLoading}
                >
                  {reschedulingLoading ? 'Salvando...' : 'Confirmar Alteração'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: FEEDBACK (AVALIAÇÃO) */}
      {feedbackBookingId && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.85)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 999, padding: '20px' }}>
          <form className="glass-panel animate-fade-in" style={{ width: '100%', maxWidth: '440px', padding: '32px', borderRadius: '16px' }} onSubmit={handleFeedbackSubmit}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
              <h3 style={{ fontSize: '18px', fontWeight: 'bold' }}>Como foi seu atendimento?</h3>
              <button 
                type="button"
                className="btn-secondary" 
                style={{ padding: '6px', border: 'none', color: 'var(--muted)' }} 
                onClick={() => setFeedbackBookingId(null)}
              >
                <X size={16} />
              </button>
            </div>

            <p style={{ color: 'var(--muted)', fontSize: '13px', marginBottom: '20px', lineHeight: '1.4' }}>
              Sua avaliação ajuda a barbearia a melhorar os serviços e dar o devido destaque aos melhores profissionais.
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              
              {/* Estrelas */}
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '13px', color: 'var(--muted)' }}>Sua nota</span>
                <div style={{ display: 'flex', gap: '8px' }}>
                  {[1, 2, 3, 4, 5].map((star) => {
                    const active = star <= feedbackRating;
                    return (
                      <button 
                        key={star}
                        type="button" 
                        style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: active ? '#eab308' : '#4b5563', padding: '4px' }}
                        onClick={() => setFeedbackRating(star)}
                      >
                        <Star size={32} fill={active ? '#eab308' : 'none'} />
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Comentário */}
              <div className="form-group">
                <label style={{ display: 'block', fontSize: '13px', marginBottom: '8px', color: 'var(--muted)' }}>Mensagem (Opcional)</label>
                <textarea 
                  className="form-input" 
                  style={{ minHeight: '80px', padding: '10px 12px', fontSize: '14px', borderRadius: '8px', resize: 'vertical' }} 
                  placeholder="Escreva como foi sua experiência..."
                  value={feedbackComment}
                  onChange={(e) => setFeedbackComment(e.target.value)}
                />
              </div>

              <div style={{ display: 'flex', justifySelf: 'flex-end', gap: '10px', marginTop: '10px' }}>
                <button type="button" className="btn-secondary" style={{ flex: 1 }} onClick={() => setFeedbackBookingId(null)}>Cancelar</button>
                <button 
                  type="submit" 
                  className="btn-primary" 
                  style={{ flex: 1, fontWeight: 'bold' }}
                  disabled={feedbackLoading}
                >
                  {feedbackLoading ? 'Enviando...' : 'Enviar Avaliação'}
                </button>
              </div>
            </div>
          </form>
        </div>
      )}

      {/* FOOTER */}
      <footer style={{ borderTop: '1px solid rgba(255,255,255,0.03)', padding: '24px 20px', textAlign: 'center', background: 'rgba(10,10,10,0.8)' }}>
        <p style={{ color: 'var(--muted)', fontSize: '12px' }}>
          &copy; 2026 BarberHub. Todos os direitos reservados.
        </p>
      </footer>
    </div>
  );
};
