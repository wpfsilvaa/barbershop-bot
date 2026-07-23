import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useEstablishmentTheme } from '../contexts/ThemeContext';
import { apiRequest } from '../services/api';
import { 
  Calendar, 
  Users, 
  Settings, 
  MessageSquare, 
  LogOut, 
  Plus, 
  Trash2, 
  Check, 
  X, 
  Clock, 
  Palette,
  RefreshCw,
  Search,
  UserPlus,
  Scissors,
  Award,
  CalendarDays,
  FileText,
  Workflow,
  HelpCircle,
  ArrowRight,
  MessageCircle,
  TrendingUp,
  Shield,
  Key,
  DollarSign,
  CheckCircle,
  Megaphone,
  BookOpen,
  Star,
  Copy,
  Cpu,
  Play
} from 'lucide-react';

interface FlowNode {
  id: string;
  type: 'message' | 'condition' | 'action' | 'api';
  actionType?: string;
  title: string;
  x: number;
  y: number;
  text?: string;
  options?: { key: string; label: string; target: string }[];
  target?: string;
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  url?: string;
  headers?: string;
  body?: string;
  webhookResponse?: string;
}

interface FlowEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string;
}

interface BotFlowSchema {
  nodes: FlowNode[];
  edges: FlowEdge[];
}

// Helper to draw dynamic SVG line chart for Metrics
const drawLineChart = (data: any[]) => {
  if (!data || data.length === 0) {
    return <p style={{ color: 'var(--muted)', textAlign: 'center', padding: '40px', fontSize: '13px' }}>Sem dados suficientes para gerar o gráfico</p>;
  }
  
  const width = 500;
  const height = 150;
  const padding = 25;
  
  const maxVal = Math.max(...data.map(d => d.revenue), 100);
  
  const points = data.map((d, index) => {
    const x = padding + (index * (width - 2 * padding)) / (data.length - 1 || 1);
    const y = height - padding - (d.revenue * (height - 2 * padding)) / maxVal;
    return { x, y, date: d.date_str, val: d.revenue };
  });

  const pathD = points.reduce((acc, p, i) => i === 0 ? `M ${p.x} ${p.y}` : `${acc} L ${p.x} ${p.y}`, '');
  const areaD = points.length > 0 ? `${pathD} L ${points[points.length - 1].x} ${height - padding} L ${points[0].x} ${height - padding} Z` : '';

  const formatDateLabel = (dStr: string) => {
    try {
      const parts = dStr.split('-');
      if (parts.length === 3) return `${parts[2]}/${parts[1]}`;
      return dStr;
    } catch {
      return dStr;
    }
  };

  return (
    <div style={{ position: 'relative' }}>
      <svg viewBox={`0 0 ${width} ${height}`} style={{ width: '100%', height: 'auto', background: 'rgba(255,255,255,0.01)', borderRadius: '8px' }}>
        <defs>
          <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--primary)" stopOpacity="0.25" />
            <stop offset="100%" stopColor="var(--primary)" stopOpacity="0.0" />
          </linearGradient>
        </defs>
        
        <line x1={padding} y1={height / 2} x2={width - padding} y2={height / 2} stroke="rgba(255,255,255,0.03)" strokeWidth="1" strokeDasharray="4 4" />
        <line x1={padding} y1={padding} x2={width - padding} y2={padding} stroke="rgba(255,255,255,0.03)" strokeWidth="1" strokeDasharray="4 4" />

        {areaD && <path d={areaD} fill="url(#areaGrad)" />}
        {pathD && <path d={pathD} fill="none" stroke="var(--primary)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />}
        
        {points.map((p, i) => (
          <g key={i}>
            <circle cx={p.x} cy={p.y} r="3.5" fill="#ffffff" stroke="var(--primary)" strokeWidth="2" style={{ cursor: 'pointer' }} />
            <title>{formatDateLabel(p.date)}: R$ {p.val.toFixed(2)}</title>
          </g>
        ))}
        
        <line x1={padding} y1={height - padding} x2={width - padding} y2={height - padding} stroke="rgba(255,255,255,0.08)" strokeWidth="1" />
      </svg>
      <div style={{ display: 'flex', justifyContent: 'space-between', padding: `0 ${padding}px`, marginTop: '4px', fontSize: '9px', color: 'var(--muted)' }}>
        {data.length > 0 && <span>{formatDateLabel(data[0].date_str)}</span>}
        {data.length > 2 && <span>{formatDateLabel(data[Math.floor(data.length / 2)].date_str)}</span>}
        {data.length > 1 && <span>{formatDateLabel(data[data.length - 1].date_str)}</span>}
      </div>
    </div>
  );
};

export const Dashboard: React.FC = () => {
  const { user, logout, reloadUser } = useAuth();
  const { establishment, updateThemeColors } = useEstablishmentTheme();
  
  const [activeTab, setActiveTab] = useState<'appointments' | 'chats' | 'barbers' | 'services' | 'my_services' | 'plans' | 'flowchart' | 'bot' | 'settings' | 'super_admin' | 'metrics' | 'clients' | 'feedbacks'>(user?.role === 'admin' ? 'super_admin' : 'appointments');

  // Bot Chats States
  const [activeChats, setActiveChats] = useState<any[]>([]);
  const [loadingChats, setLoadingChats] = useState<boolean>(false);
  const [chatsFilter, setChatsFilter] = useState<'active' | 'closed'>('active');
  const [selectedChat, setSelectedChat] = useState<any | null>(null);
  const [manualMessageInput, setManualMessageInput] = useState<string>('');
  const [localChatMessages, setLocalChatMessages] = useState<{ text: string; fromMe: boolean; time: string }[]>([]);

  // Close Chat Modal States
  const [showCloseChatModal, setShowCloseChatModal] = useState<boolean>(false);
  const [chatToClosePhone, setChatToClosePhone] = useState<string>('');
  const [closeChatMessageType, setCloseChatMessageType] = useState<'predefined_1' | 'predefined_2' | 'custom' | 'none'>('predefined_1');
  const [closeChatMessageCustomText, setCloseChatMessageCustomText] = useState<string>('');

  // List states
  const [appointments, setAppointments] = useState<any[]>([]);
  const [barbers, setBarbers] = useState<any[]>([]);
  const [plans, setPlans] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // CRM / Clients States
  const [clients, setClients] = useState<any[]>([]);
  const [loadingClients, setLoadingClients] = useState<boolean>(false);
  const [searchClientQuery, setSearchClientQuery] = useState<string>('');
  const [editingClient, setEditingClient] = useState<any | null>(null);
  const [showEditClientModal, setShowEditClientModal] = useState<boolean>(false);

  // Add Contact Manual States
  const [showCreateClientModal, setShowCreateClientModal] = useState<boolean>(false);
  const [newClientName, setNewClientName] = useState<string>('');
  const [newClientPhone, setNewClientPhone] = useState<string>('');
  const [newClientNotes, setNewClientNotes] = useState<string>('');
  const [createClientLoading, setCreateClientLoading] = useState<boolean>(false);
  
  // Promo Config
  const [promoDelayMin, setPromoDelayMin] = useState<number>(10);
  const [promoDelayMax, setPromoDelayMax] = useState<number>(20);
  const [savingPromoConfig, setSavingPromoConfig] = useState<boolean>(false);
  
  // Promo Campaign
  const [promoCampaignText, setPromoCampaignText] = useState<string>('');
  const [sendingPromoCampaign, setSendingPromoCampaign] = useState<boolean>(false);

  // Feedbacks States
  const [feedbacks, setFeedbacks] = useState<any[]>([]);
  const [loadingFeedbacks, setLoadingFeedbacks] = useState<boolean>(false);

  // Filter states
  const [filterDate, setFilterDate] = useState(new Date().toISOString().split('T')[0]);
  const [searchQuery, setSearchQuery] = useState('');

  // Form states - Appointments (Create)
  const [showApptModal, setShowApptModal] = useState(false);
  const [apptBarber, setApptBarber] = useState('');
  const [apptClientName, setApptClientName] = useState('');
  const [apptClientPhone, setApptClientPhone] = useState('');
  const [apptCountryDdi, setApptCountryDdi] = useState('55');
  const [apptService, setApptService] = useState('');
  const [apptTime, setApptTime] = useState('');
  const [apptSlots, setApptSlots] = useState<string[]>([]);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [showClientSuggestions, setShowClientSuggestions] = useState<boolean>(false);

  // Form states - Appointments (Reschedule/Update)
  const [showRescheduleModal, setShowRescheduleModal] = useState(false);
  const [rescheduleApptId, setRescheduleApptId] = useState('');
  const [rescheduleClientName, setRescheduleClientName] = useState('');
  const [rescheduleBarber, setRescheduleBarber] = useState('');
  const [rescheduleTime, setRescheduleTime] = useState('');
  const [rescheduleReason, setRescheduleReason] = useState('');
  const [rescheduleSlots, setRescheduleSlots] = useState<string[]>([]);

  // Super Admin States
  const [superUsers, setSuperUsers] = useState<any[]>([]);
  const [superSessions, setSuperSessions] = useState<any[]>([]);
  const [loadingSuper, setLoadingSuper] = useState(false);
  const [superChangePasswordModal, setSuperChangePasswordModal] = useState(false);
  const [superSelectedUser, setSuperSelectedUser] = useState<any | null>(null);
  const [superNewPassword, setSuperNewPassword] = useState('');
  const [superSearchUser, setSuperSearchUser] = useState('');

  // Super Admin - Chat States
  const [superChatOpen, setSuperChatOpen] = useState(false);
  const [superChatContact, setSuperChatContact] = useState<any | null>(null);
  const [superChatMessage, setSuperChatMessage] = useState('');
  const [superChatSending, setSuperChatSending] = useState(false);

  // Super Admin - Create Establishment States
  const [superNewEstName, setSuperNewEstName] = useState('');
  const [superNewEstSlug, setSuperNewEstSlug] = useState('');
  const [superNewOwnerName, setSuperNewOwnerName] = useState('');
  const [superNewOwnerEmail, setSuperNewOwnerEmail] = useState('');
  const [superNewOwnerPhone, setSuperNewOwnerPhone] = useState('');
  const [superCreateEstLoading, setSuperCreateEstLoading] = useState(false);
  const [superCreateEstError, setSuperCreateEstError] = useState('');
  const [superCreateEstSuccess, setSuperCreateEstSuccess] = useState('');

  // User Mandatory Password Change States
  const [userTempNewPassword, setUserTempNewPassword] = useState('');
  const [userTempConfirmPassword, setUserTempConfirmPassword] = useState('');
  const [userTempPasswordLoading, setUserTempPasswordLoading] = useState(false);
  const [userTempPasswordError, setUserTempPasswordError] = useState('');

  // Super Admin - Session Connection Modal States
  const [superConnectModalOpen, setSuperConnectModalOpen] = useState(false);
  const [superConnectEstId, setSuperConnectEstId] = useState<string | null>(null);
  const [superConnectEstName, setSuperConnectEstName] = useState('');
  const [modalBotStatus, setModalBotStatus] = useState<'connecting' | 'connected' | 'disconnected' | 'qr_ready'>('disconnected');
  const [modalBotQr, setModalBotQr] = useState<string | null>(null);
  const [modalRefreshingBot, setModalRefreshingBot] = useState(false);
  // Metrics & Relatorios States
  const [metricsDays, setMetricsDays] = useState<number>(30);
  const [metrics, setMetrics] = useState<any | null>(null);
  const [loadingMetrics, setLoadingMetrics] = useState(false);
  const [selectedEstIdForMetrics, setSelectedEstIdForMetrics] = useState<string>('all');
  const [superEditingEstId, setSuperEditingEstId] = useState<string | null>(null);
  const [superNewCommission, setSuperNewCommission] = useState<string>('');
  const [loadingRescheduleSlots, setLoadingRescheduleSlots] = useState(false);

  // Form states - Appointments (Cancel Reason)
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [cancelApptId, setCancelApptId] = useState('');
  const [cancelReason, setCancelReason] = useState('');

  // Form states - Recurring Plans
  const [showPlanModal, setShowPlanModal] = useState(false);
  const [newPlanClientName, setNewPlanClientName] = useState('');
  const [newPlanClientPhone, setNewPlanClientPhone] = useState('');
  const [newPlanBarber, setNewPlanBarber] = useState('');
  const [newPlanType, setNewPlanType] = useState<'quinzenal' | 'mensal'>('mensal');
  const [newPlanTime, setNewPlanTime] = useState('09:00');
  const [newPlanWeekday, setNewPlanWeekday] = useState(1); // 1 = Segunda

  // Form states - Barbers
  const [newBarberName, setNewBarberName] = useState('');
  const [newBarberEmail, setNewBarberEmail] = useState('');
  const [newBarberPassword, setNewBarberPassword] = useState('');
  const [newBarberPhoto, setNewBarberPhoto] = useState('');
  const [editingBarberId, setEditingBarberId] = useState<string | null>(null);

  // Form states - Settings & Message Flowchart Customizer
  const [shopName, setShopName] = useState('');
  const [botActive, setBotActive] = useState<boolean>(true);
  const [primaryColor, setPrimaryColor] = useState('');
  const [secondaryColor, setSecondaryColor] = useState('');
  const [bgColor, setBgColor] = useState('');
  const [textColor, setTextColor] = useState('');
  const [openTime, setOpenTime] = useState('');
  const [closeTime, setCloseTime] = useState('');
  const [slotDuration, setSlotDuration] = useState(30);
  const [logoUrl, setLogoUrl] = useState('');
  const [shopAddress, setShopAddress] = useState('');
  const [shopBio, setShopBio] = useState('');
  const [shopPhotos, setShopPhotos] = useState<string[]>([]);
  const [newPhotoUrl, setNewPhotoUrl] = useState<string>('');

  // Form states - Services CRUD & Assignment
  const [services, setServices] = useState<any[]>([]);
  const [showServiceModal, setShowServiceModal] = useState(false);
  const [newServiceName, setNewServiceName] = useState('');
  const [newServicePrice, setNewServicePrice] = useState('');
  const [newServiceDuration, setNewServiceDuration] = useState(30);
  const [newServiceDescription, setNewServiceDescription] = useState('');
  const [editingServiceId, setEditingServiceId] = useState<string | null>(null);

  const [showBarberServicesModal, setShowBarberServicesModal] = useState(false);
  const [selectedBarberForServices, setSelectedBarberForServices] = useState<any | null>(null);
  const [assignedServiceIds, setAssignedServiceIds] = useState<string[]>([]);
  const [customPrices, setCustomPrices] = useState<Record<string, string>>({});
  const [customDurations, setCustomDurations] = useState<Record<string, string>>({});
  
  // Customizable bot message flow templates (Legacy fields - kept for compatibility)
  const [msgWelcome, setMsgWelcome] = useState('');
  const [msgSelectBarber, setMsgSelectBarber] = useState('');
  const [msgSelectDate, setMsgSelectDate] = useState('');
  const [msgSelectSlot, setMsgSelectSlot] = useState('');
  const [msgConfirmed, setMsgConfirmed] = useState('');
  const [msgFallback, setMsgFallback] = useState('');

  // Graphical branching flowchart configuration
  const [botFlow, setBotFlow] = useState<BotFlowSchema>({ nodes: [], edges: [] });
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  // Quick Option Modal States
  const [showQuickOptionModal, setShowQuickOptionModal] = useState<boolean>(false);
  const [quickOptionNodeId, setQuickOptionNodeId] = useState<string>('');
  const [quickOptionKey, setQuickOptionKey] = useState<string>('');
  const [quickOptionLabel, setQuickOptionLabel] = useState<string>('');
  const [quickOptionError, setQuickOptionError] = useState<string>('');
  
  const [draggingNode, setDraggingNode] = useState<string | null>(null);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [drawingEdge, setDrawingEdge] = useState<{
    sourceId: string;
    sourceHandle?: string;
    startX: number;
    startY: number;
    currentX: number;
    currentY: number;
  } | null>(null);
  const canvasRef = useRef<HTMLDivElement>(null);

  // Bot states
  const [botStatus, setBotStatus] = useState<'connecting' | 'connected' | 'disconnected' | 'qr_ready'>('disconnected');
  const [botQr, setBotQr] = useState<string | null>(null);
  const [refreshingBot, setRefreshingBot] = useState(false);

  // General Notification toast
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  const showToast = (message: string, type: 'success' | 'error' = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  };

  const handleImageUpload = (file: File, onSuccess: (base64: string) => void) => {
    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          showToast('Erro ao processar imagem.', 'error');
          return;
        }

        // Standard size (400x400 is ideal for avatars and logos in web apps)
        const targetSize = 400;
        canvas.width = targetSize;
        canvas.height = targetSize;

        // Auto Center-Crop (Square crop calculation)
        let sourceX = 0;
        let sourceY = 0;
        let sourceWidth = img.width;
        let sourceHeight = img.height;

        if (img.width > img.height) {
          sourceWidth = img.height;
          sourceX = (img.width - img.height) / 2;
        } else if (img.height > img.width) {
          sourceHeight = img.width;
          sourceY = (img.height - img.width) / 2;
        }

        // Draw cropped image into square canvas
        ctx.drawImage(
          img,
          sourceX,
          sourceY,
          sourceWidth,
          sourceHeight,
          0,
          0,
          targetSize,
          targetSize
        );

        // Compress as JPEG
        let quality = 0.8;
        let compressedBase64 = canvas.toDataURL('image/jpeg', quality);

        // Safe check size constraint (must be under 500KB in base64 string bytes)
        while (compressedBase64.length > 500 * 1024 && quality > 0.1) {
          quality -= 0.1;
          compressedBase64 = canvas.toDataURL('image/jpeg', quality);
        }

        if (compressedBase64.length > 500 * 1024) {
          showToast('Não foi possível comprimir a imagem abaixo de 500KB.', 'error');
          return;
        }

        onSuccess(compressedBase64);
        showToast('Imagem processada, cortada em quadrado e otimizada!');
      };
      img.onerror = () => {
        showToast('Arquivo de imagem inválido.', 'error');
      };
      img.src = event.target?.result as string;
    };
    reader.onerror = () => {
      showToast('Erro ao ler arquivo.', 'error');
    };
    reader.readAsDataURL(file);
  };

  const loadData = async () => {
    if (!user?.establishment_id) return;
    setLoading(true);
    try {
      // 1. Fetch appointments
      const appts = await apiRequest(`/establishments/${user.establishment_id}/bookings`, 'GET');
      setAppointments(appts);

      // 2. Fetch barbers (Owner/Admin only)
      if (user.role === 'owner' || user.role === 'admin') {
        const team = await apiRequest(`/establishments/${user.establishment_id}/barbers`, 'GET');
        setBarbers(team);

        // 3. Fetch recurring plans
        const currentPlans = await apiRequest(`/establishments/${user.establishment_id}/plans`, 'GET');
        setPlans(currentPlans);

        // 4. Fetch services
        const svcs = await apiRequest(`/establishments/${user.establishment_id}/services`, 'GET');
        setServices(svcs);
      } else if (user.role === 'barber') {
        const svcs = await apiRequest(`/establishments/${user.establishment_id}/barbers/${user.id}/services`, 'GET');
        setServices(svcs);
      }
    } catch (err: any) {
      showToast(err.message || 'Erro ao carregar dados do estabelecimento.', 'error');
    } finally {
      setLoading(false);
    }
  };

  const loadBotStatus = async () => {
    if (!user?.establishment_id || (user.role !== 'owner' && user.role !== 'admin')) return;
    setRefreshingBot(true);
    try {
      const status = await apiRequest(`/establishments/${user.establishment_id}/bot/status`, 'GET');
      setBotStatus(status.status);
      setBotQr(status.qr);
    } catch (err: any) {
      console.error('Failed to load bot status:', err);
    } finally {
      setRefreshingBot(false);
    }
  };

  const loadClients = async () => {
    if (!user?.establishment_id) return;
    setLoadingClients(true);
    try {
      const data = await apiRequest(`/establishments/${user.establishment_id}/clients`, 'GET');
      setClients(data);
    } catch (err: any) {
      showToast(err.message || 'Erro ao carregar lista de contatos.', 'error');
    } finally {
      setLoadingClients(false);
    }
  };

  const handleDeleteClient = async (clientId: string) => {
    if (!user?.establishment_id) return;
    if (!window.confirm('Tem certeza que deseja remover este contato da lista telefônica?')) return;
    try {
      await apiRequest(`/establishments/${user.establishment_id}/clients/${clientId}`, 'DELETE');
      showToast('Contato removido com sucesso.', 'success');
      loadClients();
    } catch (err: any) {
      showToast(err.message || 'Erro ao remover contato.', 'error');
    }
  };

  const loadPromoConfig = async () => {
    if (!user?.establishment_id || (user.role !== 'owner' && user.role !== 'admin')) return;
    try {
      const config = await apiRequest(`/establishments/${user.establishment_id}/promo-config`, 'GET');
      setPromoDelayMin(config.promo_delay_min_seconds || 10);
      setPromoDelayMax(config.promo_delay_max_seconds || 20);
    } catch (err: any) {
      console.error('Failed to load promo config:', err);
    }
  };

  const handleUpdateClient = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user?.establishment_id || !editingClient) return;

    let cleanNum = editingClient.phone.replace(/\D/g, '');
    if (cleanNum.startsWith('55') && (cleanNum.length === 12 || cleanNum.length === 13)) {
      cleanNum = cleanNum.substring(2);
    }
    if (cleanNum.length < 10 || cleanNum.length > 11) {
      showToast('O telefone deve conter DDD + número (10 ou 11 dígitos).', 'error');
      return;
    }

    try {
      await apiRequest(
        `/establishments/${user.establishment_id}/clients/${editingClient.id}`,
        'PUT',
        {
          name: editingClient.name,
          phone: `55${cleanNum}`,
          notes: editingClient.notes,
          accept_promotions: editingClient.accept_promotions
        }
      );
      showToast('Contato atualizado com sucesso!');
      setShowEditClientModal(false);
      setEditingClient(null);
      loadClients();
    } catch (err: any) {
      showToast(err.message || 'Erro ao atualizar contato.', 'error');
    }
  };

  const handleCreateClient = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user?.establishment_id) return;
    if (!newClientName.trim() || !newClientPhone.trim()) {
      showToast('Nome e telefone são obrigatórios.', 'error');
      return;
    }

    let cleanNum = newClientPhone.replace(/\D/g, '');
    if (cleanNum.startsWith('55') && (cleanNum.length === 12 || cleanNum.length === 13)) {
      cleanNum = cleanNum.substring(2);
    }
    if (cleanNum.length < 10 || cleanNum.length > 11) {
      showToast('O telefone deve conter DDD + número (10 ou 11 dígitos).', 'error');
      return;
    }

    setCreateClientLoading(true);
    try {
      await apiRequest(`/establishments/${user.establishment_id}/clients`, 'POST', {
        name: newClientName.trim(),
        phone: `55${cleanNum}`,
        notes: newClientNotes.trim()
      });

      showToast('Contato cadastrado com sucesso!');
      setShowCreateClientModal(false);
      setNewClientName('');
      setNewClientPhone('');
      setNewClientNotes('');
      loadClients();
    } catch (err: any) {
      showToast(err.message || 'Erro ao cadastrar contato.', 'error');
    } finally {
      setCreateClientLoading(false);
    }
  };

  const handleSavePromoConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user?.establishment_id || (user.role !== 'owner' && user.role !== 'admin')) return;

    setSavingPromoConfig(true);
    try {
      await apiRequest(`/establishments/${user.establishment_id}/promo-config`, 'PUT', {
        promo_delay_min_seconds: promoDelayMin,
        promo_delay_max_seconds: promoDelayMax
      });
      showToast('Configurações de disparo salvas com sucesso!');
    } catch (err: any) {
      showToast(err.message || 'Erro ao salvar configurações.', 'error');
    } finally {
      setSavingPromoConfig(false);
    }
  };

  const handleSendPromoCampaign = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user?.establishment_id || (user.role !== 'owner' && user.role !== 'admin')) return;

    if (!promoCampaignText.trim()) {
      showToast('Digite o texto da promoção.', 'warning');
      return;
    }

    setSendingPromoCampaign(true);
    try {
      const res = await apiRequest(`/establishments/${user.establishment_id}/send-promo`, 'POST', {
        text: promoCampaignText
      });
      showToast(res.message || 'Campanha de promoção iniciada!');
      setPromoCampaignText('');
    } catch (err: any) {
      showToast(err.message || 'Erro ao enviar campanha.', 'error');
    } finally {
      setSendingPromoCampaign(false);
    }
  };

  const loadFeedbacks = async () => {
    if (!user?.establishment_id) return;
    setLoadingFeedbacks(true);
    try {
      const data = await apiRequest(`/establishments/${user.establishment_id}/feedbacks`, 'GET');
      setFeedbacks(data);
    } catch (err: any) {
      showToast(err.message || 'Erro ao carregar avaliações.', 'error');
    } finally {
      setLoadingFeedbacks(false);
    }
  };

  useEffect(() => {
    loadData();
    loadBotStatus();
    if (activeTab === 'clients') {
      loadClients();
      loadPromoConfig();
    }
    if (activeTab === 'feedbacks') {
      loadFeedbacks();
    }
    
    const interval = setInterval(() => {
      if (activeTab === 'bot') {
        loadBotStatus();
      }
    }, 5000);
    
    return () => clearInterval(interval);
  }, [user?.establishment_id, activeTab]);

  // Load current establishment settings into edit form
  useEffect(() => {
    const loadEstSettings = async () => {
      if (!user?.establishment_id) return;
      try {
        const est = await apiRequest(`/establishments/${user.establishment_id}`, 'GET');
        if (est) {
          setShopName(est.name);
          setBotActive(est.bot_active !== false);
          setPrimaryColor(est.primary_color);
          setSecondaryColor(est.secondary_color);
          setBgColor(est.background_color);
          setTextColor(est.text_color);
          setOpenTime(est.opening_time);
          setCloseTime(est.closing_time);
          setSlotDuration(est.slot_duration_minutes);
          setLogoUrl(est.logo_url || '');
          setShopAddress(est.address || '');
          setShopBio(est.bio || '');
          setShopPhotos(est.photos || []);
          
          setMsgWelcome(est.msg_welcome || '');
          setMsgSelectBarber(est.msg_select_barber || '');
          setMsgSelectDate(est.msg_select_date || '');
          setMsgSelectSlot(est.msg_select_slot || '');
          setMsgConfirmed(est.msg_confirmed || '');
          setMsgFallback(est.msg_fallback || '');

          if (est.bot_flow) {
            setBotFlow(est.bot_flow);
          }
          
          updateThemeColors(est);
        }
      } catch (err) {
        console.error('Failed to load active establishment settings:', err);
      }
    };

    loadEstSettings();
  }, [user?.establishment_id]);

  // Load slots for manual creation modal
  useEffect(() => {
    const fetchSlots = async () => {
      if (!user?.establishment_id || !apptBarber || !filterDate) return;
      setLoadingSlots(true);
      try {
        const slots = await apiRequest(
          `/establishments/${user.establishment_id}/barbers/${apptBarber}/available-slots?date=${filterDate}`,
          'GET'
        );
        setApptSlots(slots);
      } catch (err: any) {
        console.error(err);
      } finally {
        setLoadingSlots(false);
      }
    };
    fetchSlots();
  }, [apptBarber, filterDate, user?.establishment_id]);

  useEffect(() => {
    if (user?.role === 'admin') {
      document.documentElement.style.setProperty('--primary', '#d4af37');
      document.documentElement.style.setProperty('--primary-hover', '#bfa030');
      document.documentElement.style.setProperty('--secondary', '#1a1a1e');
      document.documentElement.style.setProperty('--background', '#121212');
      document.documentElement.style.setProperty('--card', '#1e1e1e');
      document.documentElement.style.setProperty('--foreground', '#f5f5f5');
      document.documentElement.style.setProperty('--input-bg', '#262626');
      document.documentElement.style.setProperty('--input-border', '#3d3d3d');
    }
  }, [user]);

  useEffect(() => {
    if (activeTab === 'super_admin') {
      loadSuperAdminData();
    } else if (activeTab === 'metrics') {
      loadMetricsData();
    }
  }, [activeTab, metricsDays, selectedEstIdForMetrics]);

  // Load slots for reschedule modal
  useEffect(() => {
    const fetchRescheduleSlots = async () => {
      if (!user?.establishment_id || !rescheduleBarber || !filterDate) return;
      setLoadingRescheduleSlots(true);
      try {
        const slots = await apiRequest(
          `/establishments/${user.establishment_id}/barbers/${rescheduleBarber}/available-slots?date=${filterDate}`,
          'GET'
        );
        setRescheduleSlots(slots);
      } catch (err: any) {
        console.error(err);
      } finally {
        setLoadingRescheduleSlots(false);
      }
    };
    fetchRescheduleSlots();
  }, [rescheduleBarber, filterDate, user?.establishment_id]);

  // Create booking
  const handleCreateAppointment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user?.establishment_id) return;

    let cleanNum = apptClientPhone.replace(/\D/g, '');
    if (cleanNum.startsWith('55') && (cleanNum.length === 12 || cleanNum.length === 13)) {
      cleanNum = cleanNum.substring(2);
    }
    if (cleanNum.length < 10 || cleanNum.length > 11) {
      showToast('O telefone do cliente deve conter DDD + número (10 ou 11 dígitos).', 'error');
      return;
    }

    try {
      await apiRequest(`/establishments/${user.establishment_id}/bookings`, 'POST', {
        barber_id: apptBarber,
        client_name: apptClientName,
        client_phone: `${apptCountryDdi}${cleanNum}`,
        appointment_time: apptTime,
        service_id: apptService || null
      });
      showToast('Agendamento realizado com sucesso!');
      setShowApptModal(false);
      
      setApptClientName('');
      setApptClientPhone('');
      setApptTime('');
      setApptService('');
      
      loadData();
    } catch (err: any) {
      showToast(err.message || 'Erro ao agendar horário.', 'error');
    }
  };

  // Load Super Admin Data
  const loadSuperAdminData = async () => {
    try {
      setLoadingSuper(true);
      const usersData = await apiRequest('/admin/users');
      setSuperUsers(usersData);
      const sessionsData = await apiRequest('/admin/whatsapp-sessions');
      setSuperSessions(sessionsData);
    } catch (err: any) {
      showToast('Erro ao carregar dados de super admin.', 'error');
    } finally {
      setLoadingSuper(false);
    }
  };

  // Change user password administratively
  const handleSuperChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!superSelectedUser) return;
    try {
      await apiRequest(`/admin/users/${superSelectedUser.id}/change-password`, 'POST', {
        password: superNewPassword
      });
      showToast(`Senha de ${superSelectedUser.name} alterada com sucesso!`);
      setSuperChangePasswordModal(false);
      setSuperNewPassword('');
      setSuperSelectedUser(null);
      
      // Reload
      const usersData = await apiRequest('/admin/users');
      setSuperUsers(usersData);
    } catch (err: any) {
      showToast(err.message || 'Erro ao alterar senha.', 'error');
    }
  };

  // Logout WhatsApp Session remotely
  const handleSuperLogoutWhatsApp = async (estId: string) => {
    if (!window.confirm('Tem certeza que deseja desconectar e deslogar esta sessão do WhatsApp remotamente?')) return;
    try {
      await apiRequest(`/admin/whatsapp-sessions/${estId}/logout`, 'POST');
      showToast('Sessão desconectada com sucesso!');
      
      // Reload
      const sessionsData = await apiRequest('/admin/whatsapp-sessions');
      setSuperSessions(sessionsData);
    } catch (err: any) {
      showToast(err.message || 'Erro ao desconectar sessão.', 'error');
    }
  };


  // Update License Expiration Days
  const handleUpdateLicenseDays = async (establishmentId: string, days: number) => {
    try {
      await apiRequest(`/admin/establishments/${establishmentId}/license`, 'PUT', {
        add_days: days
      });
      showToast(`Licença estendida em +${days} dias!`);
      loadSuperAdminData();
    } catch (err: any) {
      showToast(err.message || 'Erro ao atualizar licença.', 'error');
    }
  };

  // Expire License immediately
  const handleExpireLicense = async (establishmentId: string) => {
    if (!window.confirm('Expirar a licença deste estabelecimento imediatamente? Isso irá bloquear seu acesso.')) return;
    try {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      
      await apiRequest(`/admin/establishments/${establishmentId}/license`, 'PUT', {
        expires_at: yesterday.toISOString()
      });
      showToast('Licença expirada com sucesso!');
      loadSuperAdminData();
    } catch (err: any) {
      showToast(err.message || 'Erro ao expirar licença.', 'error');
    }
  };

  // Delete establishment and all its cascade records
  const handleDeleteEstablishment = async (establishmentId: string, name: string) => {
    const confirmFirst = window.confirm(`ATENÇÃO: Tem certeza que deseja EXCLUIR permanentemente a barbearia "${name}"?\n\nEsta ação é irreversível e removerá todos os barbeiros, clientes, agendamentos, feedbacks e configurações vinculadas.`);
    if (!confirmFirst) return;

    const confirmSecond = window.confirm(`CONFIRMAÇÃO FINAL: Para confirmar a exclusão da barbearia "${name}" e todos os seus dados do sistema, clique em OK.`);
    if (!confirmSecond) return;

    try {
      const response = await apiRequest(`/admin/establishments/${establishmentId}`, 'DELETE');
      showToast(response.message || 'Barbearia excluída com sucesso!');
      loadSuperAdminData();
    } catch (err: any) {
      showToast(err.message || 'Erro ao excluir barbearia.', 'error');
    }
  };

  // Save establishment commission percent administratively
  const handleSuperSaveCommission = async (estId: string, percent: number) => {
    try {
      await apiRequest(`/admin/establishments/${estId}/commission`, 'PUT', {
        commission_percent: percent
      });
      showToast('Comissão da barbearia atualizada com sucesso!');
      setSuperEditingEstId(null);
      setSuperNewCommission('');
      
      // Reload
      const sessionsData = await apiRequest('/admin/whatsapp-sessions');
      setSuperSessions(sessionsData);
    } catch (err: any) {
      showToast(err.message || 'Erro ao salvar comissão.', 'error');
    }
  };

  // Toggle establishment active status (block / activate due to payment)
  const handleToggleEstablishmentStatus = async (estId: string, currentActive: boolean) => {
    const actionName = currentActive ? 'bloquear' : 'ativar';
    if (!window.confirm(`Tem certeza que deseja ${actionName} esta barbearia?`)) return;
    try {
      await apiRequest(`/admin/establishments/${estId}/status`, 'PUT', {
        is_active: !currentActive
      });
      showToast(`Barbearia ${currentActive ? 'bloqueada' : 'ativada'} com sucesso!`);
      
      // Reload lists
      const sessionsData = await apiRequest('/admin/whatsapp-sessions');
      setSuperSessions(sessionsData);
    } catch (err: any) {
      showToast(err.message || 'Erro ao alterar status da barbearia.', 'error');
    }
  };

  // Send WhatsApp message to any partner/barber from Super Admin (BarberHub central bot)
  const handleSendSuperMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!superChatContact || !superChatMessage.trim()) return;

    setSuperChatSending(true);
    try {
      let cleanPhone = superChatContact.phone.replace(/\D/g, '').trim();
      if (!cleanPhone.startsWith('55') && cleanPhone.length > 0) {
        cleanPhone = '55' + cleanPhone;
      }

      await apiRequest(`/establishments/00000000-0000-0000-0000-000000000000/bot/chats/${cleanPhone}/message`, 'POST', {
        message: superChatMessage.trim()
      });

      showToast(`Mensagem enviada com sucesso para ${superChatContact.name}!`);
      setSuperChatOpen(false);
      setSuperChatMessage('');
      setSuperChatContact(null);
    } catch (err: any) {
      showToast(err.message || 'Erro ao enviar mensagem por WhatsApp.', 'error');
    } finally {
      setSuperChatSending(false);
    }
  };

  // Create new establishment and owner administratively
  const handleCreateEstablishment = async (e: React.FormEvent) => {
    e.preventDefault();
    setSuperCreateEstError('');
    setSuperCreateEstSuccess('');

    if (!superNewEstName.trim() || !superNewEstSlug.trim() || !superNewOwnerName.trim() || !superNewOwnerEmail.trim() || !superNewOwnerPhone.trim()) {
      setSuperCreateEstError('Todos os campos são obrigatórios.');
      return;
    }

    try {
      setSuperCreateEstLoading(true);
      const res = await apiRequest('/admin/establishments', 'POST', {
        name: superNewOwnerName,
        email: superNewOwnerEmail,
        phone: superNewOwnerPhone,
        establishment_name: superNewEstName,
        establishment_slug: superNewEstSlug.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')
      });

      const tempPass = res.tempPassword || 'Erro ao obter senha';
      setSuperCreateEstSuccess(`Barbearia cadastrada com sucesso! Senha temporária do dono: ${tempPass} (Copie e envie ao dono).`);
      showToast('Nova barbearia cadastrada com sucesso!');
      
      // Reset form fields
      setSuperNewEstName('');
      setSuperNewEstSlug('');
      setSuperNewOwnerName('');
      setSuperNewOwnerEmail('');
      setSuperNewOwnerPhone('');

      // Reload admin lists
      loadSuperAdminData();
    } catch (err: any) {
      setSuperCreateEstError(err.message || 'Erro ao cadastrar barbearia.');
      showToast(err.message || 'Erro ao cadastrar barbearia.', 'error');
    } finally {
      setSuperCreateEstLoading(false);
    }
  };

  // Update temporary password on first login
  const handleUpdateTempPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setUserTempPasswordError('');

    if (userTempNewPassword.length < 6) {
      setUserTempPasswordError('A nova senha deve ter pelo menos 6 caracteres.');
      return;
    }

    if (userTempNewPassword !== userTempConfirmPassword) {
      setUserTempPasswordError('As senhas não coincidem.');
      return;
    }

    try {
      setUserTempPasswordLoading(true);
      await apiRequest('/auth/change-temp-password', 'POST', {
        newPassword: userTempNewPassword
      });

      showToast('Senha atualizada com sucesso! Bem-vindo.');
      
      // Reload user profile to wipe requirePasswordChange flag
      await reloadUser();
    } catch (err: any) {
      setUserTempPasswordError(err.message || 'Erro ao redefinir senha.');
      showToast(err.message || 'Erro ao redefinir senha.', 'error');
    } finally {
      setUserTempPasswordLoading(false);
    }
  };

  // Super Admin - Load WhatsApp Connection Status for Modal
  const loadModalBotStatus = async (estId: string) => {
    if (!estId) return;
    try {
      const status = await apiRequest(`/establishments/${estId}/bot/status`, 'GET');
      setModalBotStatus(status.status);
      setModalBotQr(status.qr);
    } catch (err: any) {
      console.error('Failed to load modal bot status:', err);
    }
  };

  // Open Modal to connect WhatsApp session for any establishment
  const handleOpenConnectModal = (estId: string, estName: string) => {
    setSuperConnectEstId(estId);
    setSuperConnectEstName(estName);
    setModalBotStatus('connecting');
    setModalBotQr(null);
    setSuperConnectModalOpen(true);
    loadModalBotStatus(estId);
  };

  // Disconnect bot inside modal
  const handleModalDisconnectBot = async () => {
    if (!superConnectEstId || !window.confirm('Tem certeza que deseja desconectar e desvincular este WhatsApp?')) return;
    setModalRefreshingBot(true);
    try {
      await apiRequest(`/establishments/${superConnectEstId}/bot/disconnect`, 'POST');
      showToast('Sessão do WhatsApp desconectada.');
      loadModalBotStatus(superConnectEstId);
    } catch (err: any) {
      showToast(err.message || 'Erro ao desconectar WhatsApp.', 'error');
    } finally {
      setModalRefreshingBot(false);
    }
  };

  // Polling for the Super Admin Connection Modal
  useEffect(() => {
    if (!superConnectModalOpen || !superConnectEstId) return;
    const interval = setInterval(() => {
      loadModalBotStatus(superConnectEstId);
    }, 4000);
    return () => clearInterval(interval);
  }, [superConnectModalOpen, superConnectEstId]);

  // Load metrics data
  const loadMetricsData = async () => {
    const estId = user?.establishment_id;
    try {
      setLoadingMetrics(true);
      if (user?.role === 'admin') {
        if (selectedEstIdForMetrics === 'all') {
          const data = await apiRequest(`/admin/metrics?days=${metricsDays}`);
          setMetrics(data);
        } else {
          const data = await apiRequest(`/establishments/${selectedEstIdForMetrics}/metrics?days=${metricsDays}`);
          setMetrics(data);
        }
      } else if (estId) {
        const data = await apiRequest(`/establishments/${estId}/metrics?days=${metricsDays}`);
        setMetrics(data);
      }
    } catch (err: any) {
      showToast('Erro ao carregar métricas.', 'error');
    } finally {
      setLoadingMetrics(false);
    }
  };

  // Open cancellation reason modal
  const openCancelModal = (apptId: string) => {
    setCancelApptId(apptId);
    setCancelReason('');
    setShowCancelModal(true);
  };

  // Submit cancel booking with reason
  const handleCancelAppointment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user?.establishment_id || !cancelApptId) return;

    try {
      await apiRequest(`/establishments/${user.establishment_id}/bookings/${cancelApptId}`, 'DELETE', {
        reason: cancelReason,
      });
      showToast('Agendamento cancelado e cliente notificado via WhatsApp!');
      setShowCancelModal(false);
      loadData();
    } catch (err: any) {
      showToast(err.message || 'Erro ao cancelar agendamento.', 'error');
    }
  };

  // Complete appointment (mark as completed/paid)
  const handleCompleteAppointment = async (apptId: string) => {
    if (!user?.establishment_id) return;

    try {
      await apiRequest(`/establishments/${user.establishment_id}/bookings/${apptId}/complete`, 'POST');
      showToast('Atendimento finalizado e marcado como pago!');
      loadData();
    } catch (err: any) {
      showToast(err.message || 'Erro ao finalizar atendimento.', 'error');
    }
  };

  // Open reschedule modal
  const openRescheduleModal = (appt: any) => {
    setRescheduleApptId(appt.id);
    setRescheduleClientName(appt.client_name);
    setRescheduleBarber(appt.barber_id);
    setRescheduleTime('');
    setRescheduleReason('');
    setShowRescheduleModal(true);
  };

  // Submit reschedule / edit booking
  const handleRescheduleAppointment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user?.establishment_id || !rescheduleApptId) return;

    try {
      await apiRequest(`/establishments/${user.establishment_id}/bookings/${rescheduleApptId}`, 'PUT', {
        barber_id: rescheduleBarber,
        appointment_time: rescheduleTime,
        reason: rescheduleReason,
      });
      showToast('Agendamento remarcado e cliente notificado via WhatsApp!');
      setShowRescheduleModal(false);
      loadData();
    } catch (err: any) {
      showToast(err.message || 'Erro ao remarcar agendamento.', 'error');
    }
  };

  // Add or Edit Barber
  const handleSaveBarber = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user?.establishment_id) return;

    try {
      if (editingBarberId) {
        // Edit barber (Owner/Admin only)
        const updated = await apiRequest(`/establishments/${user.establishment_id}/barbers/${editingBarberId}`, 'PUT', {
          name: newBarberName,
          email: newBarberEmail,
          password: newBarberPassword || undefined,
          photo_url: newBarberPhoto || null
        });
        showToast(`Profissional ${updated.name} atualizado com sucesso!`);
      } else {
        // Create new barber
        if (!newBarberPassword) {
          showToast('A senha é obrigatória para novos profissionais.', 'error');
          return;
        }
        const added = await apiRequest(`/establishments/${user.establishment_id}/barbers`, 'POST', {
          name: newBarberName,
          email: newBarberEmail,
          password: newBarberPassword,
          photo_url: newBarberPhoto
        });
        showToast(`Profissional ${added.name} adicionado com sucesso!`);
      }
      setNewBarberName('');
      setNewBarberEmail('');
      setNewBarberPassword('');
      setNewBarberPhoto('');
      setEditingBarberId(null);
      loadData();
    } catch (err: any) {
      showToast(err.message || 'Erro ao salvar profissional.', 'error');
    }
  };

  const handleEditBarberClick = (barber: any) => {
    setEditingBarberId(barber.id);
    setNewBarberName(barber.name);
    setNewBarberEmail(barber.email);
    setNewBarberPassword('');
    setNewBarberPhoto(barber.photo_url || '');
  };

  const handleCancelEditBarber = () => {
    setEditingBarberId(null);
    setNewBarberName('');
    setNewBarberEmail('');
    setNewBarberPassword('');
    setNewBarberPhoto('');
  };

  // Toggle Barber Active status
  const handleToggleBarber = async (barberId: string, isActive: boolean) => {
    if (!user?.establishment_id) return;
    try {
      await apiRequest(`/establishments/${user.establishment_id}/barbers/${barberId}`, 'PUT', {
        is_active: !isActive,
        name: barbers.find(b => b.id === barberId).name,
        email: barbers.find(b => b.id === barberId).email
      });
      showToast('Status do barbeiro atualizado.');
      loadData();
    } catch (err: any) {
      showToast(err.message || 'Erro ao atualizar barbeiro.', 'error');
    }
  };

  // Delete Barber
  const handleDeleteBarber = async (barberId: string) => {
    if (!user?.establishment_id || !window.confirm('Excluir este barbeiro permanentemente?')) return;
    try {
      await apiRequest(`/establishments/${user.establishment_id}/barbers/${barberId}`, 'DELETE');
      showToast('Barbeiro removido.');
      loadData();
    } catch (err: any) {
      showToast(err.message || 'Erro ao deletar barbeiro.', 'error');
    }
  };

  // Save Settings
  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user?.establishment_id) return;

    try {
      const updated = await apiRequest(`/establishments/${user.establishment_id}`, 'PUT', {
        name: shopName,
        primary_color: primaryColor,
        secondary_color: secondaryColor,
        background_color: bgColor,
        text_color: textColor,
        opening_time: openTime,
        closing_time: closeTime,
        slot_duration_minutes: slotDuration,
        msg_fallback: msgFallback,
        bot_flow: botFlow,
        logo_url: logoUrl,
        address: shopAddress,
        bio: shopBio,
        photos: shopPhotos,
        bot_active: botActive
      });

      updateThemeColors(updated);
      showToast('Configurações salvas!');
    } catch (err: any) {
      showToast(err.message || 'Erro ao salvar configurações.', 'error');
    }
  };

  // ==========================================
  // SERVICES CRUD LOGIC
  // ==========================================
  const handleSaveService = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user?.establishment_id) return;

    try {
      if (editingServiceId) {
        await apiRequest(`/establishments/${user.establishment_id}/services/${editingServiceId}`, 'PUT', {
          name: newServiceName,
          description: newServiceDescription,
          price: parseFloat(newServicePrice),
          duration_minutes: newServiceDuration,
          is_active: true
        });
        showToast('Serviço atualizado com sucesso!');
      } else {
        await apiRequest(`/establishments/${user.establishment_id}/services`, 'POST', {
          name: newServiceName,
          description: newServiceDescription,
          price: parseFloat(newServicePrice),
          duration_minutes: newServiceDuration
        });
        showToast('Serviço criado com sucesso!');
      }
      setShowServiceModal(false);
      setNewServiceName('');
      setNewServiceDescription('');
      setNewServicePrice('');
      setNewServiceDuration(30);
      setEditingServiceId(null);
      loadData();
    } catch (err: any) {
      showToast(err.message || 'Erro ao salvar serviço.', 'error');
    }
  };

  const handleEditServiceClick = (service: any) => {
    setEditingServiceId(service.id);
    setNewServiceName(service.name);
    setNewServiceDescription(service.description || '');
    setNewServicePrice(service.price);
    setNewServiceDuration(service.duration_minutes);
    setShowServiceModal(true);
  };

  const handleDeleteService = async (serviceId: string) => {
    if (!user?.establishment_id || !window.confirm('Excluir este serviço permanentemente?')) return;
    try {
      await apiRequest(`/establishments/${user.establishment_id}/services/${serviceId}`, 'DELETE');
      showToast('Serviço removido.');
      loadData();
    } catch (err: any) {
      showToast(err.message || 'Erro ao deletar serviço.', 'error');
    }
  };

  // ==========================================
  // BARBER SERVICES ASSIGNMENT LOGIC
  // ==========================================
  const handleManageBarberServices = async (barber: any) => {
    setSelectedBarberForServices(barber);
    try {
      const assigned = await apiRequest(`/establishments/${user?.establishment_id}/barbers/${barber.id}/services`, 'GET');
      setAssignedServiceIds(assigned.map((s: any) => s.id));
      
      const prices: Record<string, string> = {};
      const durations: Record<string, string> = {};
      assigned.forEach((s: any) => {
        if (s.custom_price !== null && s.custom_price !== undefined) {
          prices[s.id] = String(s.custom_price);
        }
        if (s.custom_duration_minutes !== null && s.custom_duration_minutes !== undefined) {
          durations[s.id] = String(s.custom_duration_minutes);
        }
      });
      setCustomPrices(prices);
      setCustomDurations(durations);
      
      setShowBarberServicesModal(true);
    } catch (err: any) {
      showToast('Erro ao carregar serviços do barbeiro.', 'error');
    }
  };

  const handleSaveBarberServices = async () => {
    if (!selectedBarberForServices || !user?.establishment_id) return;
    try {
      const servicesPayload = assignedServiceIds.map(id => ({
        serviceId: id,
        price: customPrices[id] !== undefined && customPrices[id] !== '' ? customPrices[id] : null,
        duration_minutes: customDurations[id] !== undefined && customDurations[id] !== '' ? customDurations[id] : null
      }));

      await apiRequest(`/establishments/${user.establishment_id}/barbers/${selectedBarberForServices.id}/services`, 'POST', {
        services: servicesPayload
      });
      showToast('Serviços do barbeiro atualizados com sucesso!');
      setShowBarberServicesModal(false);
      setSelectedBarberForServices(null);
      setAssignedServiceIds([]);
      setCustomPrices({});
      setCustomDurations({});
    } catch (err: any) {
      showToast(err.message || 'Erro ao salvar serviços do barbeiro.', 'error');
    }
  };

  const handleToggleServiceAssignment = (serviceId: string) => {
    setAssignedServiceIds(prev => 
      prev.includes(serviceId) ? prev.filter(id => id !== serviceId) : [...prev, serviceId]
    );
  };

  const handleSaveMyBarberPrices = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user?.establishment_id) return;

    try {
      const servicesPayload = services.map(s => {
        const price = customPrices[s.id] !== undefined ? customPrices[s.id] : s.custom_price;
        const duration = customDurations[s.id] !== undefined ? customDurations[s.id] : s.custom_duration_minutes;
        
        return {
          serviceId: s.id,
          price: price !== null && price !== undefined && String(price).trim() !== '' ? price : null,
          duration_minutes: duration !== null && duration !== undefined && String(duration).trim() !== '' ? duration : null
        };
      });

      await apiRequest(`/establishments/${user.establishment_id}/barbers/${user.id}/services`, 'POST', {
        services: servicesPayload
      });
      showToast('Seus preços e durações foram atualizados com sucesso!');
      loadData();
    } catch (err: any) {
      showToast(err.message || 'Erro ao salvar alterações.', 'error');
    }
  };

  const handleCreateQuickOption = (e: React.FormEvent) => {
    e.preventDefault();
    if (!quickOptionNodeId || !quickOptionKey || !quickOptionLabel) return;

    const node = botFlow.nodes.find(n => n.id === quickOptionNodeId);
    if (!node) return;

    const exists = (node.options || []).some(
      o => o.key.trim().toLowerCase() === quickOptionKey.trim().toLowerCase()
    );

    if (exists) {
      setQuickOptionError(`A opção "${quickOptionKey}" já existe neste nó.`);
      return;
    }

    handleAddConditionOption(quickOptionNodeId, quickOptionKey, quickOptionLabel, '');
    
    setShowQuickOptionModal(false);
    setQuickOptionNodeId('');
    setQuickOptionKey('');
    setQuickOptionLabel('');
    setQuickOptionError('');
  };

  // Save Bot Flowchart JSON
  const handleSaveBotFlowchart = async (updatedFlow: BotFlowSchema) => {
    if (!user?.establishment_id) return;
    try {
      const updated = await apiRequest(`/establishments/${user.establishment_id}`, 'PUT', {
        name: shopName,
        primary_color: primaryColor,
        secondary_color: secondaryColor,
        background_color: bgColor,
        text_color: textColor,
        opening_time: openTime,
        closing_time: closeTime,
        slot_duration_minutes: slotDuration,
        msg_fallback: msgFallback,
        bot_flow: updatedFlow
      });
      setBotFlow(updated.bot_flow);
      showToast('Fluxograma de conversa salvo com sucesso!');
    } catch (err: any) {
      showToast(err.message || 'Erro ao salvar o fluxograma do bot.', 'error');
    }
  };

  // Add membership plan manually
  const handleCreatePlan = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user?.establishment_id) return;

    try {
      await apiRequest(`/establishments/${user.establishment_id}/plans`, 'POST', {
        client_name: newPlanClientName,
        client_phone: newPlanClientPhone,
        barber_id: newPlanBarber,
        plan_type: newPlanType,
        preferred_time: newPlanTime,
        preferred_day_of_week: newPlanWeekday,
      });
      showToast('Clube de Assinatura ativado e próximos horários pré-agendados!');
      setShowPlanModal(false);
      
      setNewPlanClientName('');
      setNewPlanClientPhone('');
      setNewPlanTime('09:00');
      
      loadData();
    } catch (err: any) {
      showToast(err.message || 'Erro ao criar plano recorrente.', 'error');
    }
  };

  // Cancel Plan
  const handleCancelPlan = async (planId: string) => {
    if (!user?.establishment_id || !window.confirm('Cancelar assinatura recorrente deste cliente?')) return;
    try {
      await apiRequest(`/establishments/${user.establishment_id}/plans/${planId}`, 'DELETE');
      showToast('Assinatura recorrente cancelada.');
      loadData();
    } catch (err: any) {
      showToast(err.message || 'Erro ao cancelar assinatura.', 'error');
    }
  };

  // Disconnect Bot session
  const handleDisconnectBot = async () => {
    if (!user?.establishment_id || !window.confirm('Tem certeza que deseja desconectar e desvincular este WhatsApp?')) return;
    setRefreshingBot(true);
    try {
      await apiRequest(`/establishments/${user.establishment_id}/bot/disconnect`, 'POST');
      showToast('Sessão do WhatsApp desconectada.');
      loadBotStatus();
    } catch (err: any) {
      showToast(err.message || 'Erro ao desconectar WhatsApp.', 'error');
    } finally {
      setRefreshingBot(false);
    }
  };

  // Bot Active Chats Management Handlers
  const fetchActiveChats = async () => {
    if (!user?.establishment_id) return;
    setLoadingChats(true);
    try {
      const data = await apiRequest(`/establishments/${user.establishment_id}/bot/chats`, 'GET');
      setActiveChats(data);
      if (selectedChat) {
        const updated = data.find((c: any) => c.phone === selectedChat.phone);
        if (updated) {
          setSelectedChat(updated);
          setLocalChatMessages(updated.messages || []);
        }
      }
    } catch (err: any) {
      showToast(err.message || 'Erro ao carregar conversas ativas.', 'error');
    } finally {
      setLoadingChats(false);
    }
  };

  // Realtime WebSockets for Instant Messaging Sychronization
  useEffect(() => {
    if (!user?.establishment_id) return;

    const wsUrl = window.location.protocol === 'https:'
      ? `wss://${window.location.host}`
      : `ws://${window.location.hostname}:5000`;

    console.log(`[WS] Connecting to WebSocket: ${wsUrl}`);
    let ws = new WebSocket(wsUrl);

    const connectWS = () => {
      ws.onopen = () => {
        console.log('[WS] Connected to dashboard server.');
        ws.send(JSON.stringify({
          type: 'auth',
          establishmentId: user.establishment_id
        }));
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === 'chat_update') {
            console.log('[WS] Received real-time chat update:', data);
            fetchActiveChats();
          }
        } catch (e) {
          console.error('[WS] Failed to parse message:', e);
        }
      };

      ws.onclose = () => {
        console.log('[WS] Connection closed. Reconnecting in 3s...');
        setTimeout(() => {
          ws = new WebSocket(wsUrl);
          connectWS();
        }, 3000);
      };
      
      ws.onerror = (err) => {
        console.error('[WS] Socket encountered error:', err);
        ws.close();
      };
    };

    connectWS();

    return () => {
      ws.close();
    };
  }, [user?.establishment_id]);

  const handlePauseChatBot = async (phone: string) => {
    if (!user?.establishment_id) return;
    try {
      await apiRequest(`/establishments/${user.establishment_id}/bot/chats/${phone}/pause`, 'POST');
      showToast('Bot pausado com sucesso.', 'success');
      fetchActiveChats();
    } catch (err: any) {
      showToast(err.message || 'Erro ao pausar bot.', 'error');
    }
  };

  const handleResumeChatBot = async (phone: string) => {
    if (!user?.establishment_id) return;
    try {
      await apiRequest(`/establishments/${user.establishment_id}/bot/chats/${phone}/resume`, 'POST');
      showToast('Bot ativado com sucesso.', 'success');
      fetchActiveChats();
    } catch (err: any) {
      showToast(err.message || 'Erro ao reativar bot.', 'error');
    }
  };

  const handleTerminateChatSession = (phone: string) => {
    setChatToClosePhone(phone);
    setCloseChatMessageType('predefined_1');
    setCloseChatMessageCustomText('');
    setShowCloseChatModal(true);
  };

  const handleConfirmCloseChatSession = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user?.establishment_id || !chatToClosePhone) return;

    let closingMessage = '';
    if (closeChatMessageType === 'predefined_1') {
      closingMessage = 'Seu atendimento foi encerrado. Obrigado e até a próxima! 💈';
    } else if (closeChatMessageType === 'predefined_2') {
      closingMessage = 'Finalizamos por aqui. Se precisar de algo mais, basta nos enviar uma nova mensagem.';
    } else if (closeChatMessageType === 'custom') {
      closingMessage = closeChatMessageCustomText.trim();
    }

    try {
      await apiRequest(`/establishments/${user.establishment_id}/bot/chats/${chatToClosePhone}`, 'DELETE', {
        message: closingMessage
      });
      showToast('Sessão encerrada com sucesso.', 'success');
      setShowCloseChatModal(false);
      if (selectedChat && selectedChat.phone === chatToClosePhone) {
        setSelectedChat(null);
      }
      fetchActiveChats();
    } catch (err: any) {
      showToast(err.message || 'Erro ao encerrar sessão.', 'error');
    }
  };

  const handleSendManualMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user?.establishment_id || !selectedChat || !manualMessageInput.trim()) return;

    const messageText = manualMessageInput.trim();
    setManualMessageInput('');

    try {
      const response = await apiRequest(`/establishments/${user.establishment_id}/bot/chats/${selectedChat.phone}/message`, 'POST', {
        message: messageText
      });
      showToast('Mensagem enviada!', 'success');
      
      const now = new Date();
      const timeStr = now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
      const displayText = response && response.formattedMessage ? response.formattedMessage : messageText;
      setLocalChatMessages(prev => [...prev, { text: displayText, fromMe: true, time: timeStr }]);
      
      if (response && response.realJid && response.realJid !== selectedChat.phone) {
        setSelectedChat((prev: any) => prev ? { ...prev, phone: response.realJid, state: 'PAUSED' } : null);
      }
      
      fetchActiveChats();
    } catch (err: any) {
      showToast(err.message || 'Erro ao enviar mensagem.', 'error');
    }
  };

  // Polling for active chats when chats tab is open
  useEffect(() => {
    if (activeTab !== 'chats') return;
    
    fetchActiveChats();
    const interval = setInterval(fetchActiveChats, 30000);
    return () => clearInterval(interval);
  }, [activeTab, user?.establishment_id, selectedChat?.phone]);

  // -------------------------------------------------------------
  // Node Drag and Drop Handlers
  // -------------------------------------------------------------
  const handleNodeMouseDown = (nodeId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setDraggingNode(nodeId);
    
    const node = botFlow.nodes.find(n => n.id === nodeId);
    if (!node) return;

    setDragOffset({
      x: e.clientX - node.x,
      y: e.clientY - node.y
    });
  };

  const handleCanvasMouseMove = (e: React.MouseEvent) => {
    const canvasBounds = canvasRef.current?.getBoundingClientRect();
    if (!canvasBounds) return;

    if (draggingNode) {
      let targetX = e.clientX - dragOffset.x;
      let targetY = e.clientY - dragOffset.y;

      // Enforce limits (1800 x 700)
      targetX = Math.max(10, Math.min(1600, targetX));
      targetY = Math.max(10, Math.min(600, targetY));

      const updatedNodes = botFlow.nodes.map(n => {
        if (n.id === draggingNode) {
          return { ...n, x: targetX, y: targetY };
        }
        return n;
      });

      setBotFlow(prev => ({
        ...prev,
        nodes: updatedNodes
      }));
    }

    if (drawingEdge) {
      const currentX = e.clientX - canvasBounds.left + (canvasRef.current?.scrollLeft || 0);
      const currentY = e.clientY - canvasBounds.top + (canvasRef.current?.scrollTop || 0);

      setDrawingEdge(prev => prev ? { ...prev, currentX, currentY } : null);
    }
  };

  const handleCanvasMouseUp = () => {
    setDraggingNode(null);
    setDrawingEdge(null);
  };

  // Connection dragging helpers
  const handlePortMouseDown = (nodeId: string, optionKey: string | undefined, e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();

    const node = botFlow.nodes.find(n => n.id === nodeId);
    if (!node) return;

    let startX = node.x + 240;
    let startY = node.y + 45;

    if (node.type === 'condition' && optionKey) {
      const optIndex = (node.options || []).findIndex(o => o.key === optionKey);
      if (optIndex !== -1) {
        startY = node.y + 46 + optIndex * 32;
      }
    }

    const canvasBounds = canvasRef.current?.getBoundingClientRect();
    if (!canvasBounds) return;

    const currentX = e.clientX - canvasBounds.left + (canvasRef.current?.scrollLeft || 0);
    const currentY = e.clientY - canvasBounds.top + (canvasRef.current?.scrollTop || 0);

    setDrawingEdge({
      sourceId: nodeId,
      sourceHandle: optionKey,
      startX,
      startY,
      currentX,
      currentY
    });
  };

  const handleNodeMouseUp = (targetNodeId: string) => {
    if (!drawingEdge) return;

    // Prevent connecting to self
    if (drawingEdge.sourceId === targetNodeId) {
      setDrawingEdge(null);
      return;
    }

    // Connect them, overwriting any existing connection for this specific port
    let updatedEdges = [...botFlow.edges];
    if (drawingEdge.sourceHandle) {
      // Overwrite condition option branch target
      updatedEdges = botFlow.edges.filter(
        e => !(e.source === drawingEdge.sourceId && e.sourceHandle === drawingEdge.sourceHandle)
      );
      updatedEdges.push({
        id: `e_${drawingEdge.sourceId}_${drawingEdge.sourceHandle}_${targetNodeId}`,
        source: drawingEdge.sourceId,
        sourceHandle: drawingEdge.sourceHandle,
        target: targetNodeId
      });
    } else {
      // Overwrite single output connection
      updatedEdges = botFlow.edges.filter(e => e.source !== drawingEdge.sourceId);
      updatedEdges.push({
        id: `e_${drawingEdge.sourceId}_${targetNodeId}`,
        source: drawingEdge.sourceId,
        target: targetNodeId
      });
    }

    // If source node is a condition node, map the option target in node options as well
    const updatedNodes = botFlow.nodes.map(n => {
      if (n.id === drawingEdge.sourceId && n.type === 'condition' && drawingEdge.sourceHandle) {
        const currentOptions = n.options || [];
        const updatedOptions = currentOptions.map(o => {
          if (o.key === drawingEdge.sourceHandle) {
            return { ...o, target: targetNodeId };
          }
          return o;
        });
        return { ...n, options: updatedOptions };
      }
      return n;
    });

    setBotFlow({
      nodes: updatedNodes,
      edges: updatedEdges
    });

    setDrawingEdge(null);
    showToast('Conexão realizada com sucesso!');
  };

  const handleDisconnectEdge = (edgeId: string) => {
    const edge = botFlow.edges.find(e => e.id === edgeId);
    if (!edge) return;

    // Filter out this edge
    const updatedEdges = botFlow.edges.filter(e => e.id !== edgeId);

    // If originating from condition node, clear the target of that option inside nodes array
    const updatedNodes = botFlow.nodes.map(n => {
      if (n.id === edge.source && n.type === 'condition' && edge.sourceHandle) {
        const updatedOptions = (n.options || []).map(o => {
          if (o.key === edge.sourceHandle) {
            return { ...o, target: '' };
          }
          return o;
        });
        return { ...n, options: updatedOptions };
      }
      return n;
    });

    setBotFlow({
      nodes: updatedNodes,
      edges: updatedEdges
    });

    showToast('Conexão removida! Você pode redesenhá-la agora.');
  };

  // SVG Curve Connector Builder
  const getConnectorPath = (
    fromPos: { x: number; y: number },
    toPos: { x: number; y: number },
    cardWidth = 240,
    cardHeight = 90
  ) => {
    const x1 = fromPos.x + cardWidth;
    const y1 = fromPos.y + cardHeight / 2;
    const x2 = toPos.x;
    const y2 = toPos.y + cardHeight / 2;

    const controlOffset = 80;
    const cp1x = x1 + controlOffset;
    const cp1y = y1;
    const cp2x = x2 - controlOffset;
    const cp2y = y2;

    return `M ${x1} ${y1} C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${x2} ${y2}`;
  };

  // Add a new node (supports click creation and drag-and-drop creation)
  const handleAddNewNode = (type: 'message' | 'condition' | 'api', clientX?: number, clientY?: number) => {
    const newNodeId = `node_${type === 'message' ? 'msg' : type === 'condition' ? 'cond' : 'api'}_${Date.now()}`;
    let x = 100;
    let y = 300;

    if (clientX !== undefined && clientY !== undefined && canvasRef.current) {
      const rect = canvasRef.current.getBoundingClientRect();
      x = clientX - rect.left + canvasRef.current.scrollLeft - 120; // center horizontal (240px card width)
      y = clientY - rect.top + canvasRef.current.scrollTop - 40;   // center vertical
      
      // Clamp coordinates to scrollable area boundaries
      x = Math.max(20, Math.min(2900, x));
      y = Math.max(20, Math.min(700, y));
    } else {
      // If client coordinates are not provided, position near start coordinates with a small random shift
      x = 100 + Math.floor(Math.random() * 80);
      y = 300 + Math.floor(Math.random() * 80);
    }

    let newNode: FlowNode;
    if (type === 'message') {
      newNode = {
        id: newNodeId,
        type: 'message',
        title: 'Nova Mensagem',
        x,
        y,
        text: 'Olá! Esta é uma nova mensagem.'
      };
    } else if (type === 'condition') {
      newNode = {
        id: newNodeId,
        type: 'condition',
        title: 'Nova Verificação',
        x,
        y,
        options: [
          { key: '1', label: 'Opção A', target: '' },
          { key: '2', label: 'Opção B', target: '' }
        ]
      };
    } else {
      newNode = {
        id: newNodeId,
        type: 'api',
        title: 'Integração API',
        x,
        y,
        method: 'POST',
        url: 'https://api.exemplo.com/webhook',
        headers: '{\n  "Authorization": "Bearer token"\n}',
        body: '{\n  "cliente": "{cliente}",\n  "telefone": "{cliente}",\n  "barbeiro": "{barbeiro}",\n  "data": "{data}",\n  "horario": "{horario}"\n}',
        webhookResponse: 'API integrada com sucesso! 🚀'
      };
    }

    const updatedFlow = {
      ...botFlow,
      nodes: [...botFlow.nodes, newNode]
    };
    
    setBotFlow(updatedFlow);
    setSelectedNodeId(newNodeId);
    showToast(`Novo nó de ${type === 'message' ? 'mensagem' : type === 'condition' ? 'verificação' : 'integração API'} criado!`);
  };

  // Legacy wrappers for back compatibility if needed, though they just delegate
  const handleAddNewMessageNode = () => handleAddNewNode('message');
  const handleAddNewConditionNode = () => handleAddNewNode('condition');

  // Duplicate a flowchart node with coordinates shifted slightly
  const handleDuplicateNode = (node: FlowNode) => {
    const reservedIds = ['start', 'end', 'welcome', 'check_intent', 'select_barber', 'select_date', 'select_slot', 'confirmed', 'offer_plan'];
    if (reservedIds.includes(node.id) || node.type === 'start' || node.type === 'end' || node.type === 'action') {
      showToast('Nós do sistema ou de ação automática não podem ser duplicados.', 'error');
      return;
    }

    const newNodeId = `node_${node.type === 'message' ? 'msg' : 'cond'}_${Date.now()}`;
    const duplicatedNode: FlowNode = node.type === 'message' ? {
      ...node,
      id: newNodeId,
      title: `${node.title} (Cópia)`,
      x: Math.min(2900, node.x + 40),
      y: Math.min(700, node.y + 40)
    } : {
      ...node,
      id: newNodeId,
      title: `${node.title} (Cópia)`,
      x: Math.min(2900, node.x + 40),
      y: Math.min(700, node.y + 40),
      options: (node.options || []).map(opt => ({
        ...opt,
        target: '' // clear targets to avoid copy link cycles
      }))
    };

    const updatedFlow = {
      ...botFlow,
      nodes: [...botFlow.nodes, duplicatedNode]
    };

    setBotFlow(updatedFlow);
    setSelectedNodeId(newNodeId);
    showToast('Nó duplicado com sucesso!');
  };

  // Restore Default Flowchart Preset
  const handleRestoreDefaultFlowchart = () => {
    if (!window.confirm('Atenção: Isso irá redefinir todo o fluxograma para o modelo padrão de agendamento automático. Suas alterações personalizadas não salvas serão perdidas. Deseja prosseguir?')) return;

    const defaultFlow = {
      nodes: [
        { id: 'start', type: 'start', title: 'Início', x: 50, y: 250 },
        { id: 'welcome', type: 'message', title: 'Boas-Vindas', x: 350, y: 250, text: 'Olá! Seja bem-vindo à Barbearia.' },
        { id: 'check_intent', type: 'condition', title: 'Verificar Opção', x: 690, y: 250, options: [
          { key: '1', label: 'Agendar', target: 'select_barber' },
          { key: '2', label: 'Contato', target: 'other_help' }
        ]},
        { id: 'select_barber', type: 'action', actionType: 'select_barber', title: '1. Escolher Barbeiro', x: 1050, y: 80, target: 'select_date' },
        { id: 'select_date', type: 'action', actionType: 'select_date', title: '2. Escolher Data', x: 1410, y: 80, target: 'select_slot' },
        { id: 'select_slot', type: 'action', actionType: 'select_slot', title: '3. Escolher Horário', x: 1770, y: 250, target: 'confirmed' },
        { id: 'confirmed', type: 'message', title: 'Confirmação', x: 2130, y: 250, text: '✅ *Agendamento Confirmado!*\n\n*Profissional:* {barbeiro}\n*Horário:* {horario}\n*Data:* {data}\n\nSeu agendamento foi registrado com sucesso! 💈', target: 'offer_plan' },
        { id: 'offer_plan', type: 'action', actionType: 'offer_plan', title: '4. Clube Assinatura', x: 2490, y: 250, target: 'end' },
        { id: 'end', type: 'end', title: 'Fim', x: 2850, y: 250 },
        { id: 'other_help', type: 'message', title: 'Informações', x: 1050, y: 420, text: '💈 Nossos horários de atendimento são das {abertura} às {fechamento}.\n📞 Se precisar falar com um atendente, nos ligue no (11) 99999-8888. Obrigado! 👍', target: 'end' }
      ],
      edges: [
        { id: 'e_start_welcome', source: 'start', target: 'welcome' },
        { id: 'e_welcome_check_intent', source: 'welcome', target: 'check_intent' },
        { id: 'e_check_intent_1_select_barber', source: 'check_intent', sourceHandle: '1', target: 'select_barber' },
        { id: 'e_check_intent_2_other_help', source: 'check_intent', sourceHandle: '2', target: 'other_help' },
        { id: 'e_select_barber_select_date', source: 'select_barber', target: 'select_date' },
        { id: 'e_select_date_select_slot', source: 'select_date', target: 'select_slot' },
        { id: 'e_select_slot_confirmed', source: 'select_slot', target: 'confirmed' },
        { id: 'e_confirmed_offer_plan', source: 'confirmed', target: 'offer_plan' },
        { id: 'e_offer_plan_end', source: 'offer_plan', target: 'end' },
        { id: 'e_other_help_end', source: 'other_help', target: 'end' }
      ]
    };

    setBotFlow(defaultFlow);
    setSelectedNodeId(null);
    showToast('Modelo padrão carregado no editor! Lembre-se de clicar em "Salvar Fluxograma" para aplicar.');
  };

  // Delete a flowchart node
  const handleDeleteNode = (nodeId: string) => {
    // Prevent deleting core system nodes required for booking operations
    const reservedIds = ['welcome', 'check_intent', 'select_barber', 'select_date', 'select_slot', 'confirmed', 'offer_plan'];
    if (reservedIds.includes(nodeId)) {
      showToast('Nós fundamentais do fluxo de agendamento não podem ser removidos.', 'error');
      return;
    }

    if (!window.confirm('Excluir este nó e todas as suas conexões?')) return;

    const updatedNodes = botFlow.nodes.filter(n => n.id !== nodeId);
    const updatedEdges = botFlow.edges.filter(e => e.source !== nodeId && e.target !== nodeId);

    const updatedFlow = {
      nodes: updatedNodes,
      edges: updatedEdges
    };

    setBotFlow(updatedFlow);
    setSelectedNodeId(null);
    showToast('Nó removido.');
  };

  // Connect a node to another
  const handleUpdateNodeTargetConnection = (sourceId: string, targetId: string) => {
    // Remove existing edge for this source
    let updatedEdges = botFlow.edges.filter(e => e.source !== sourceId);

    if (targetId) {
      updatedEdges.push({
        id: `e_${sourceId}_${targetId}`,
        source: sourceId,
        target: targetId
      });
    }

    const updatedFlow = {
      ...botFlow,
      edges: updatedEdges
    };
    setBotFlow(updatedFlow);
  };

  // Add branching condition option to condition nodes
  const handleAddConditionOption = (nodeId: string, optionKey: string, optionLabel: string, targetId?: string) => {
    if (!optionKey) return;

    const updatedNodes = botFlow.nodes.map(n => {
      if (n.id === nodeId) {
        const currentOptions = n.options || [];
        const filteredOptions = currentOptions.filter(o => o.key !== optionKey);
        return {
          ...n,
          options: [...filteredOptions, { key: optionKey, label: optionLabel, target: targetId || '' }]
        };
      }
      return n;
    });

    let updatedEdges = botFlow.edges;
    if (targetId) {
      const edgeId = `e_${nodeId}_${optionKey}_${targetId}`;
      const filteredEdges = botFlow.edges.filter(e => !(e.source === nodeId && e.sourceHandle === optionKey));
      updatedEdges = [
        ...filteredEdges,
        { id: edgeId, source: nodeId, sourceHandle: optionKey, target: targetId }
      ];
    } else {
      updatedEdges = botFlow.edges.filter(e => !(e.source === nodeId && e.sourceHandle === optionKey));
    }

    setBotFlow({
      nodes: updatedNodes,
      edges: updatedEdges
    });
  };

  // Remove branching option from condition nodes
  const handleRemoveConditionOption = (nodeId: string, optionKey: string) => {
    const updatedNodes = botFlow.nodes.map(n => {
      if (n.id === nodeId) {
        return {
          ...n,
          options: (n.options || []).filter(o => o.key !== optionKey)
        };
      }
      return n;
    });

    const updatedEdges = botFlow.edges.filter(e => !(e.source === nodeId && e.sourceHandle === optionKey));

    setBotFlow({
      nodes: updatedNodes,
      edges: updatedEdges
    });
  };

  const getRoleBadge = (role: string) => {
    switch (role) {
      case 'owner': return <span style={{ backgroundColor: 'rgba(212, 175, 55, 0.15)', color: 'var(--primary)', padding: '4px 8px', borderRadius: '4px', fontSize: '12px', fontWeight: 'bold' }}>Proprietário</span>;
      case 'admin': return <span style={{ backgroundColor: 'rgba(59, 130, 246, 0.15)', color: '#3b82f6', padding: '4px 8px', borderRadius: '4px', fontSize: '12px', fontWeight: 'bold' }}>Administrador</span>;
      default: return <span style={{ backgroundColor: 'rgba(255, 255, 255, 0.1)', color: '#bbb', padding: '4px 8px', borderRadius: '4px', fontSize: '12px', fontWeight: 'bold' }}>Barbeiro</span>;
    }
  };

  const getWeekdayName = (dayNum: number): string => {
    const names = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado'];
    return names[dayNum] || 'Desconhecido';
  };

  const formatTime = (isoString: string): string => {
    const date = new Date(isoString);
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `${hours}:${minutes}`;
  };

  const filteredAppointments = appointments.filter((appt) => {
    const apptDate = new Date(appt.appointment_time).toISOString().split('T')[0];
    const matchesDate = apptDate === filterDate;
    const matchesSearch = appt.client_name.toLowerCase().includes(searchQuery.toLowerCase()) || 
                          appt.client_phone.includes(searchQuery);
    return matchesDate && matchesSearch;
  });

  // Selected node reference for floating editor panel
  const selectedNode = botFlow.nodes?.find(n => n.id === selectedNodeId);

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      
      {/* Mandatory Password Change View Overlay */}
      {user?.requirePasswordChange && (
        <div style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: '#0f0f11',
          padding: '20px',
          width: '100%',
          position: 'fixed',
          top: 0,
          left: 0,
          zIndex: 9999
        }}>
          <div className="card-premium animate-fade-in" style={{ maxWidth: '440px', width: '100%', padding: '32px', border: '1px solid rgba(255,255,255,0.05)' }}>
            <div style={{ textAlign: 'center', marginBottom: '24px' }}>
              <div style={{ width: '48px', height: '48px', borderRadius: '50%', background: 'rgba(226,168,87,0.1)', display: 'flex', justifyContent: 'center', alignItems: 'center', margin: '0 auto 16px auto' }}>
                <Key style={{ color: 'var(--primary)' }} size={24} />
              </div>
              <h2 style={{ fontSize: '22px', fontWeight: '700', marginBottom: '8px', color: '#ffffff' }}>Definir Nova Senha</h2>
              <p style={{ color: 'var(--muted)', fontSize: '13px', lineHeight: '1.4' }}>
                Esta é a sua primeira vez acessando a barbearia. Por segurança, altere sua senha temporária para poder gerenciar o painel.
              </p>
            </div>

            <form onSubmit={handleUpdateTempPassword} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div className="form-group">
                <label className="form-label">Nova Senha</label>
                <input 
                  type="password" 
                  className="form-input" 
                  placeholder="Mínimo de 6 caracteres"
                  value={userTempNewPassword}
                  onChange={(e) => setUserTempNewPassword(e.target.value)}
                  required
                />
              </div>

              <div className="form-group">
                <label className="form-label">Confirmar Nova Senha</label>
                <input 
                  type="password" 
                  className="form-input" 
                  placeholder="Repita a nova senha"
                  value={userTempConfirmPassword}
                  onChange={(e) => setUserTempConfirmPassword(e.target.value)}
                  required
                />
              </div>

              {userTempPasswordError && (
                <div style={{ color: '#ef4444', fontSize: '13px', textAlign: 'center' }}>
                  <span>⚠️ {userTempPasswordError}</span>
                </div>
              )}

              <button 
                type="submit" 
                className="btn-primary" 
                style={{ width: '100%', padding: '12px', marginTop: '8px' }}
                disabled={userTempPasswordLoading}
              >
                {userTempPasswordLoading ? 'Salvando...' : 'Salvar e Acessar Painel'}
              </button>
            </form>
          </div>
        </div>
      )}
      
      {/* Toast Notification */}
      {toast && (
        <div style={{
          position: 'fixed',
          top: '20px',
          right: '20px',
          zIndex: 1000,
          backgroundColor: toast.type === 'success' ? 'var(--success)' : 'var(--error)',
          color: '#ffffff',
          padding: '16px 24px',
          borderRadius: '8px',
          boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
          animation: 'fadeIn 0.3s ease-out forwards',
          fontWeight: '500'
        }}>
          {toast.message}
        </div>
      )}

      {/* Top Navbar */}
      <header className="glass-panel" style={{ margin: '20px', padding: '16px 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderRadius: 'var(--radius)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <Scissors style={{ color: 'var(--primary)' }} size={24} />
          <div>
            <h1 style={{ fontSize: '20px', lineHeight: '1.2' }}>
              {user?.role === 'admin' ? 'BarberHub' : (establishment?.name || 'Painel de Gestão')}
            </h1>
            <span style={{ fontSize: '12px', color: 'var(--muted)' }}>
              {user?.role === 'admin' ? 'Painel de Controle Global' : 'Barbearia Clássica Booking'}
            </span>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
          {user?.role !== 'admin' && user?.establishment_expires_at && (() => {
            const expiresAt = new Date(user.establishment_expires_at);
            const diffTime = expiresAt.getTime() - new Date().getTime();
            const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
            
            let color = '#10b981'; // Verde padrão (> 15 dias)
            let isPulsing = false;
            let label = `${diffDays} dias restantes`;

            if (diffDays <= 3) {
              color = '#ef4444'; // Vermelho
              isPulsing = true;
              label = `Licença expira em ${diffDays} ${diffDays === 1 ? 'dia' : 'dias'}!`;
            } else if (diffDays <= 15) {
              color = '#e2a857'; // Amarelo/Dourado
              label = `${diffDays} dias restantes`;
            }

            return (
              <div style={{ 
                display: 'flex', 
                alignItems: 'center', 
                gap: '8px', 
                padding: '6px 12px', 
                background: 'rgba(255, 255, 255, 0.03)', 
                borderRadius: '20px', 
                border: '1px solid rgba(255, 255, 255, 0.05)',
                fontSize: '13px'
              }}>
                <span 
                  style={{ 
                    width: '8px', 
                    height: '8px', 
                    borderRadius: '50%', 
                    background: color, 
                    display: 'inline-block',
                    boxShadow: isPulsing ? `0 0 10px ${color}` : 'none',
                    animation: isPulsing ? 'pulse-red 1.2s infinite ease-in-out' : 'none'
                  }} 
                />
                <span style={{ color: color, fontWeight: '500' }}>{label}</span>
                {isPulsing && (
                  <style>{`
                    @keyframes pulse-red {
                      0% { opacity: 0.3; transform: scale(0.9); }
                      50% { opacity: 1; transform: scale(1.2); }
                      100% { opacity: 0.3; transform: scale(0.9); }
                    }
                  `}</style>
                )}
              </div>
            );
          })()}

          <div style={{ textAlign: 'right' }}>
            <p style={{ fontWeight: '500', fontSize: '15px' }}>{user?.name}</p>
            <div style={{ marginTop: '2px' }}>{getRoleBadge(user?.role || '')}</div>
          </div>
          <button className="btn-secondary" style={{ padding: '8px 12px', fontSize: '14px', gap: '6px' }} onClick={logout}>
            <LogOut size={16} />
            <span>Sair</span>
          </button>
        </div>
      </header>

      {/* Main Container */}
      <div className="dashboard-main-container">
        
        {/* Sidebar Nav */}
        <nav className="glass-panel dashboard-sidebar-nav">
          {user?.role !== 'admin' && (
            <>
              <button 
                className="btn-secondary" 
                style={{ 
                  justifyContent: 'flex-start', 
                  border: activeTab === 'appointments' ? '1px solid var(--primary)' : '1px solid transparent',
                  color: activeTab === 'appointments' ? 'var(--primary)' : 'var(--foreground)',
                  backgroundColor: activeTab === 'appointments' ? 'rgba(212, 175, 55, 0.05)' : 'transparent'
                }} 
                onClick={() => setActiveTab('appointments')}
              >
                <Calendar size={18} />
                <span>Agendamentos</span>
              </button>

              <button 
                className="btn-secondary" 
                style={{ 
                  justifyContent: 'flex-start', 
                  border: activeTab === 'chats' ? '1px solid var(--primary)' : '1px solid transparent',
                  color: activeTab === 'chats' ? 'var(--primary)' : 'var(--foreground)',
                  backgroundColor: activeTab === 'chats' ? 'rgba(212, 175, 55, 0.05)' : 'transparent'
                }} 
                onClick={() => {
                  setActiveTab('chats');
                  setSelectedChat(null);
                }}
              >
                <MessageCircle size={18} />
                <span>Conversas do Bot</span>
              </button>
              <button 
                className="btn-secondary" 
                style={{ 
                  justifyContent: 'flex-start', 
                  border: activeTab === 'clients' ? '1px solid var(--primary)' : '1px solid transparent',
                  color: activeTab === 'clients' ? 'var(--primary)' : 'var(--foreground)',
                  backgroundColor: activeTab === 'clients' ? 'rgba(212, 175, 55, 0.05)' : 'transparent'
                }} 
                onClick={() => setActiveTab('clients')}
              >
                <Users size={18} />
                <span>Contatos & Marketing</span>
              </button>
              <button 
                className="btn-secondary" 
                style={{ 
                  justifyContent: 'flex-start', 
                  border: activeTab === 'feedbacks' ? '1px solid var(--primary)' : '1px solid transparent',
                  color: activeTab === 'feedbacks' ? 'var(--primary)' : 'var(--foreground)',
                  backgroundColor: activeTab === 'feedbacks' ? 'rgba(212, 175, 55, 0.05)' : 'transparent'
                }} 
                onClick={() => setActiveTab('feedbacks')}
              >
                <Star size={18} />
                <span>Avaliações</span>
              </button>
            </>
          )}

          {user?.role === 'barber' && (
            <button 
              className="btn-secondary" 
              style={{ 
                justifyContent: 'flex-start', 
                border: activeTab === 'my_services' ? '1px solid var(--primary)' : '1px solid transparent',
                color: activeTab === 'my_services' ? 'var(--primary)' : 'var(--foreground)',
                backgroundColor: activeTab === 'my_services' ? 'rgba(212, 175, 55, 0.05)' : 'transparent'
              }} 
              onClick={() => setActiveTab('my_services')}
            >
              <Scissors size={18} style={{ transform: 'rotate(-90deg)' }} />
              <span>Meus Preços</span>
            </button>
          )}

          {user?.role === 'owner' && (
            <>
              <button 
                className="btn-secondary" 
                style={{ 
                  justifyContent: 'flex-start', 
                  border: activeTab === 'barbers' ? '1px solid var(--primary)' : '1px solid transparent',
                  color: activeTab === 'barbers' ? 'var(--primary)' : 'var(--foreground)',
                  backgroundColor: activeTab === 'barbers' ? 'rgba(212, 175, 55, 0.05)' : 'transparent'
                }} 
                onClick={() => setActiveTab('barbers')}
              >
                <Users size={18} />
                <span>Profissionais</span>
              </button>

              <button 
                className="btn-secondary" 
                style={{ 
                  justifyContent: 'flex-start', 
                  border: activeTab === 'services' ? '1px solid var(--primary)' : '1px solid transparent',
                  color: activeTab === 'services' ? 'var(--primary)' : 'var(--foreground)',
                  backgroundColor: activeTab === 'services' ? 'rgba(212, 175, 55, 0.05)' : 'transparent'
                }} 
                onClick={() => setActiveTab('services')}
              >
                <Scissors size={18} style={{ transform: 'rotate(-90deg)' }} />
                <span>Serviços</span>
              </button>

              <button 
                className="btn-secondary" 
                style={{ 
                  justifyContent: 'flex-start', 
                  border: activeTab === 'plans' ? '1px solid var(--primary)' : '1px solid transparent',
                  color: activeTab === 'plans' ? 'var(--primary)' : 'var(--foreground)',
                  backgroundColor: activeTab === 'plans' ? 'rgba(212, 175, 55, 0.05)' : 'transparent'
                }} 
                onClick={() => setActiveTab('plans')}
              >
                <Award size={18} />
                <span>Clube de Assinaturas</span>
              </button>

              <button 
                className="btn-secondary" 
                style={{ 
                  justifyContent: 'flex-start', 
                  border: activeTab === 'flowchart' ? '1px solid var(--primary)' : '1px solid transparent',
                  color: activeTab === 'flowchart' ? 'var(--primary)' : 'var(--foreground)',
                  backgroundColor: activeTab === 'flowchart' ? 'rgba(212, 175, 55, 0.05)' : 'transparent'
                }} 
                onClick={() => setActiveTab('flowchart')}
              >
                <Workflow size={18} />
                <span>Fluxo do Bot (Gráfico)</span>
              </button>

              <button 
                className="btn-secondary" 
                style={{ 
                  justifyContent: 'flex-start', 
                  border: activeTab === 'bot' ? '1px solid var(--primary)' : '1px solid transparent',
                  color: activeTab === 'bot' ? 'var(--primary)' : 'var(--foreground)',
                  backgroundColor: activeTab === 'bot' ? 'rgba(212, 175, 55, 0.05)' : 'transparent'
                }} 
                onClick={() => setActiveTab('bot')}
              >
                <MessageSquare size={18} />
                <span>Bot WhatsApp</span>
              </button>

              <button 
                className="btn-secondary" 
                style={{ 
                  justifyContent: 'flex-start', 
                  border: activeTab === 'settings' ? '1px solid var(--primary)' : '1px solid transparent',
                  color: activeTab === 'settings' ? 'var(--primary)' : 'var(--foreground)',
                  backgroundColor: activeTab === 'settings' ? 'rgba(212, 175, 55, 0.05)' : 'transparent'
                }} 
                onClick={() => setActiveTab('settings')}
              >
                <Settings size={18} />
                <span>Configurações</span>
              </button>
            </>
          )}

          {(user?.role === 'owner' || user?.role === 'admin') && (
            <button 
              className="btn-secondary" 
              style={{ 
                justifyContent: 'flex-start', 
                border: activeTab === 'metrics' ? '1px solid var(--primary)' : '1px solid transparent',
                color: activeTab === 'metrics' ? 'var(--primary)' : 'var(--foreground)',
                backgroundColor: activeTab === 'metrics' ? 'rgba(212, 175, 55, 0.05)' : 'transparent'
              }} 
              onClick={() => setActiveTab('metrics')}
            >
              <TrendingUp size={18} />
              <span>Métricas e Relatórios</span>
            </button>
          )}

          {user?.role === 'admin' && (
            <button 
              className="btn-secondary" 
              style={{ 
                justifyContent: 'flex-start', 
                border: activeTab === 'super_admin' ? '1px solid var(--primary)' : '1px solid transparent',
                color: activeTab === 'super_admin' ? 'var(--primary)' : 'var(--foreground)',
                backgroundColor: activeTab === 'super_admin' ? 'rgba(212, 175, 55, 0.05)' : 'transparent'
              }} 
              onClick={() => setActiveTab('super_admin')}
            >
              <Shield size={18} />
              <span>Super Admin</span>
            </button>
          )}
        </nav>

        {/* Dynamic Panels */}
        <main className="glass-panel" style={{ flex: 1, padding: '24px', overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
          
          {/* TAB 1: APPOINTMENTS */}
          {activeTab === 'appointments' && (
            <div className="animate-fade-in">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px', flexWrap: 'wrap', gap: '16px' }}>
                <div>
                  <h2 style={{ fontSize: '24px' }}>Quadro de Horários</h2>
                  <p style={{ color: 'var(--muted)', fontSize: '14px' }}>Gerencie as reservas ou efetue reagendamentos com aviso via bot</p>
                </div>
                <button className="btn-primary" onClick={() => {
                  if (user?.role === 'barber') setApptBarber(user.id);
                  else if (barbers.length > 0) setApptBarber(barbers[0].id);
                  loadClients();
                  setShowApptModal(true);
                }}>
                  <Plus size={18} />
                  <span>Novo Agendamento</span>
                </button>
              </div>

              {/* Filters */}
              <div style={{ display: 'flex', gap: '16px', marginBottom: '24px', flexWrap: 'wrap' }}>
                <div style={{ position: 'relative', flex: 1, minWidth: '200px' }}>
                  <Search size={18} style={{ position: 'absolute', left: '12px', top: '14px', color: 'var(--muted)' }} />
                  <input 
                    type="text" 
                    className="form-input" 
                    placeholder="Buscar por cliente ou telefone..." 
                    style={{ paddingLeft: '40px' }}
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                  />
                </div>
                <input 
                  type="date" 
                  className="form-input" 
                  style={{ width: 'auto', minWidth: '180px' }}
                  value={filterDate}
                  onChange={(e) => setFilterDate(e.target.value)}
                />
              </div>

              {loading ? (
                <div style={{ textAlign: 'center', padding: '40px', color: 'var(--muted)' }}>Carregando horários...</div>
              ) : filteredAppointments.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '60px 20px', border: '1px dashed rgba(255,255,255,0.08)', borderRadius: '12px', color: 'var(--muted)' }}>
                  <Calendar size={48} style={{ marginBottom: '16px', opacity: '0.4' }} />
                  <p>Nenhum agendamento agendado para esta data.</p>
                </div>
              ) : (
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', minWidth: '700px' }}>
                    <thead>
                      <tr style={{ borderBottom: '1px solid var(--input-border)', color: 'var(--muted)', fontSize: '14px' }}>
                        <th style={{ padding: '12px' }}>Horário</th>
                        <th style={{ padding: '12px' }}>Cliente</th>
                        <th style={{ padding: '12px' }}>Telefone</th>
                        <th style={{ padding: '12px' }}>Profissional</th>
                        <th style={{ padding: '12px' }}>Status</th>
                        <th style={{ padding: '12px', textAlign: 'right' }}>Ações</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredAppointments.map((appt) => (
                        <tr key={appt.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)', fontSize: '15px' }}>
                          <td style={{ padding: '16px 12px', fontWeight: 'bold' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                              <Clock size={16} style={{ color: 'var(--primary)' }} />
                              {formatTime(appt.appointment_time)}
                            </div>
                          </td>
                          <td style={{ padding: '16px 12px' }}>{appt.client_name}</td>
                          <td style={{ padding: '16px 12px', color: 'var(--muted)' }}>{appt.client_phone}</td>
                          <td style={{ padding: '16px 12px' }}>
                            <span style={{ backgroundColor: 'rgba(255,255,255,0.05)', padding: '4px 8px', borderRadius: '4px', fontSize: '13px' }}>
                              {appt.barber_name}
                            </span>
                          </td>
                          <td style={{ padding: '16px 12px' }}>
                            {appt.status === 'confirmed' ? (
                              <span style={{ color: 'var(--success)', display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '13px' }}>
                                <Check size={14} /> Confirmado
                              </span>
                            ) : appt.status === 'completed' ? (
                              <span style={{ color: 'var(--primary)', display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '13px', fontWeight: 'bold' }}>
                                <CheckCircle size={14} /> Pago
                              </span>
                            ) : (
                              <div style={{ display: 'flex', flexDirection: 'column' }}>
                                <span style={{ color: 'var(--error)', display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '13px' }}>
                                  <X size={14} /> Cancelado
                                </span>
                                {appt.cancellation_reason && (
                                  <span style={{ fontSize: '11px', color: 'var(--muted)', marginTop: '2px' }}>
                                    Razão: {appt.cancellation_reason}
                                  </span>
                                )}
                              </div>
                            )}
                          </td>
                          <td style={{ padding: '16px 12px', textAlign: 'right' }}>
                            {appt.status === 'confirmed' && (
                              <div style={{ display: 'inline-flex', gap: '8px' }}>
                                <button 
                                  className="btn-primary" 
                                  style={{ padding: '6px 10px', fontSize: '13px', backgroundColor: 'var(--primary)', color: '#121212', fontWeight: 'bold', gap: '4px' }}
                                  onClick={() => handleCompleteAppointment(appt.id)}
                                >
                                  <Check size={13} />
                                  <span>Finalizar / Pago</span>
                                </button>
                                <button 
                                  className="btn-secondary" 
                                  style={{ padding: '6px 10px', fontSize: '13px' }}
                                  onClick={() => openRescheduleModal(appt)}
                                >
                                  <RefreshCw size={13} />
                                  <span>Remarcar</span>
                                </button>
                                <button 
                                  className="btn-secondary" 
                                  style={{ padding: '6px 10px', fontSize: '13px', borderColor: 'rgba(239, 68, 68, 0.2)', color: 'var(--error)' }}
                                  onClick={() => openCancelModal(appt.id)}
                                >
                                  <X size={13} />
                                  <span>Cancelar</span>
                                </button>
                              </div>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* TAB 2: BARBERS MANAGEMENT */}
          {activeTab === 'barbers' && (user?.role === 'owner' || user?.role === 'admin') && (
            <div className="animate-fade-in">
              <h2 style={{ fontSize: '24px', marginBottom: '8px' }}>Gerenciamento da Equipe</h2>
              <p style={{ color: 'var(--muted)', fontSize: '14px', marginBottom: '24px' }}>Cadastre novos barbeiros e controle quem tem acesso ao sistema</p>

              <div className="dashboard-responsive-row">
                <div className="dashboard-responsive-col-left">
                  <form className="card-premium" onSubmit={handleSaveBarber}>
                    <h3 style={{ fontSize: '18px', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <UserPlus size={18} style={{ color: 'var(--primary)' }} />
                      {editingBarberId ? 'Editar Profissional' : 'Adicionar Profissional'}
                    </h3>
                    
                    <div className="form-group">
                      <label className="form-label">Nome Completo</label>
                      <input type="text" className="form-input" placeholder="Ex: Caciano Silva" value={newBarberName} onChange={(e) => setNewBarberName(e.target.value)} required />
                    </div>

                    <div className="form-group">
                      <label className="form-label">E-mail Corporativo</label>
                      <input type="email" className="form-input" placeholder="caciano@barbearia.com" value={newBarberEmail} onChange={(e) => setNewBarberEmail(e.target.value)} required />
                    </div>

                    <div className="form-group">
                      <label className="form-label">{editingBarberId ? 'Alterar Senha (deixe em branco para manter)' : 'Senha de Acesso Inicial'}</label>
                      <input type="password" className="form-input" placeholder={editingBarberId ? 'Nova senha' : 'Mínimo 6 caracteres'} value={newBarberPassword} onChange={(e) => setNewBarberPassword(e.target.value)} required={!editingBarberId} />
                    </div>

                    <div className="form-group">
                      <label className="form-label">Foto do Profissional (PNG/JPG - Máx. 500KB)</label>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginTop: '4px' }}>
                        {newBarberPhoto && (
                          <img 
                            src={newBarberPhoto} 
                            alt="Barber Preview" 
                            style={{ width: '48px', height: '48px', borderRadius: '50%', objectFit: 'cover', border: '2px solid var(--primary)' }} 
                          />
                        )}
                        <div style={{ flex: 1 }}>
                          <input 
                            type="file" 
                            accept="image/png, image/jpeg, image/jpg" 
                            className="form-input" 
                            style={{ padding: '6px 10px', height: 'auto', display: 'block', margin: 0 }} 
                            onChange={(e) => {
                              const file = e.target.files?.[0];
                              if (file) handleImageUpload(file, setNewBarberPhoto);
                            }} 
                          />
                        </div>
                      </div>
                    </div>

                    <button type="submit" className="btn-primary" style={{ width: '100%', justifyContent: 'center', marginTop: '12px' }}>
                      <Check size={18} />
                      <span>{editingBarberId ? 'Salvar Alterações' : 'Cadastrar Barbeiro'}</span>
                    </button>

                    {editingBarberId && (
                      <button 
                        type="button" 
                        className="btn-secondary" 
                        onClick={handleCancelEditBarber}
                        style={{ width: '100%', justifyContent: 'center', marginTop: '8px', color: 'var(--muted)', borderColor: 'transparent' }}
                      >
                        Cancelar Edição
                      </button>
                    )}
                  </form>
                </div>

                <div className="dashboard-responsive-col-right">
                  <div className="card-premium" style={{ height: '100%' }}>
                    <h3 style={{ fontSize: '18px', marginBottom: '16px' }}>Barbeiros Cadastrados</h3>
                    {barbers.length === 0 ? (
                      <p style={{ color: 'var(--muted)' }}>Nenhum barbeiro cadastrado no estabelecimento.</p>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                        {barbers.map((barber) => (
                          <div key={barber.id} className="dashboard-barber-item">
                            <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                              <img 
                                src={barber.photo_url || 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&q=80&w=100&h=100'} 
                                alt={barber.name} 
                                style={{ width: '50px', height: '62px', borderRadius: '6px', objectFit: 'cover', border: '2px solid rgba(212,175,55,0.3)', boxShadow: '0 4px 8px rgba(0,0,0,0.3)' }}
                              />
                              <div>
                                <p style={{ fontWeight: '600' }}>{barber.name}</p>
                                <p style={{ fontSize: '13px', color: 'var(--muted)' }}>{barber.email}</p>
                              </div>
                            </div>
                            <div className="dashboard-barber-actions">
                              <button 
                                className="btn-secondary" 
                                style={{ padding: '6px 10px', fontSize: '13px', color: barber.is_active ? 'var(--success)' : 'var(--muted)', borderColor: barber.is_active ? 'var(--success)' : 'var(--input-border)' }}
                                onClick={() => handleToggleBarber(barber.id, barber.is_active)}
                              >
                                {barber.is_active ? 'Ativo' : 'Inativo'}
                              </button>
                              <button 
                                className="btn-secondary" 
                                style={{ padding: '6px 10px', fontSize: '13px' }}
                                onClick={() => handleEditBarberClick(barber)}
                              >
                                Editar
                              </button>
                              <button 
                                className="btn-secondary" 
                                style={{ padding: '6px 10px', fontSize: '13px', display: 'flex', alignItems: 'center', gap: '6px' }}
                                onClick={() => handleManageBarberServices(barber)}
                              >
                                <Scissors size={14} style={{ transform: 'rotate(-90deg)' }} />
                                <span>Serviços</span>
                              </button>
                              <button 
                                className="btn-secondary" 
                                style={{ padding: '6px 8px', color: 'var(--error)', borderColor: 'transparent' }}
                                onClick={() => handleDeleteBarber(barber.id)}
                              >
                                <Trash2 size={16} />
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB: SERVICES CONFIG (CRUD) */}
          {activeTab === 'services' && (user?.role === 'owner' || user?.role === 'admin') && (
            <div className="animate-fade-in" style={{ width: '100%' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
                <div>
                  <h2 style={{ fontSize: '24px', marginBottom: '8px' }}>Serviços Oferecidos</h2>
                  <p style={{ color: 'var(--muted)', fontSize: '14px' }}>Gerencie os serviços, preços e a duração dos atendimentos da barbearia</p>
                </div>
                <button 
                  className="btn-primary" 
                  onClick={() => {
                    setEditingServiceId(null);
                    setNewServiceName('');
                    setNewServiceDescription('');
                    setNewServicePrice('');
                    setNewServiceDuration(30);
                    setShowServiceModal(true);
                  }}
                  style={{ display: 'flex', alignItems: 'center', gap: '8px' }}
                >
                  <Plus size={16} />
                  <span>Novo Serviço</span>
                </button>
              </div>

              <div className="card-premium">
                {services.length === 0 ? (
                  <p style={{ color: 'var(--muted)', textAlign: 'center', padding: '40px 0' }}>Nenhum serviço cadastrado. Cadastre o seu primeiro serviço!</p>
                ) : (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '16px' }}>
                    {services.map((service) => (
                      <div 
                        key={service.id} 
                        style={{ 
                          padding: '16px', 
                          background: 'rgba(255,255,255,0.01)', 
                          borderRadius: '12px', 
                          border: '1px solid rgba(255,255,255,0.05)',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '12px',
                          position: 'relative'
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                          <h3 style={{ fontSize: '16px', fontWeight: 'bold' }}>{service.name}</h3>
                          <div style={{ fontSize: '16px', fontWeight: 'bold', color: 'var(--primary)' }}>
                            R$ {parseFloat(service.price).toFixed(2)}
                          </div>
                        </div>

                        {service.description && (
                          <p style={{ fontSize: '13px', color: 'var(--muted)', lineHeight: '1.4', flex: 1 }}>
                            {service.description}
                          </p>
                        )}

                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '12px', color: 'var(--muted)', marginTop: 'auto', borderTop: '1px solid rgba(255,255,255,0.04)', paddingTop: '10px' }}>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                            <Clock size={12} />
                            <span>{service.duration_minutes} min</span>
                          </span>
                          <div style={{ display: 'flex', gap: '8px' }}>
                            <button 
                              className="btn-secondary" 
                              style={{ padding: '4px 8px', fontSize: '12px' }}
                              onClick={() => handleEditServiceClick(service)}
                            >
                              Editar
                            </button>
                            <button 
                              className="btn-secondary" 
                              style={{ padding: '4px 8px', fontSize: '12px', color: 'var(--error)', borderColor: 'transparent' }}
                              onClick={() => handleDeleteService(service.id)}
                            >
                              Excluir
                            </button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB: MY SERVICES (BARBER ROLE ONLY) */}
          {activeTab === 'my_services' && user?.role === 'barber' && (
            <div className="animate-fade-in" style={{ width: '100%' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
                <div>
                  <h2 style={{ fontSize: '24px', marginBottom: '8px' }}>Meus Serviços e Preços</h2>
                  <p style={{ color: 'var(--muted)', fontSize: '14px' }}>Defina seus preços e durações personalizadas para os serviços que você realiza</p>
                </div>
              </div>

              <form onSubmit={handleSaveMyBarberPrices} className="card-premium">
                {services.length === 0 ? (
                  <div style={{ color: 'var(--muted)', textAlign: 'center', padding: '40px 0' }}>
                    <p>Nenhum serviço atribuído a você pelo proprietário.</p>
                    <p style={{ fontSize: '13px', marginTop: '8px' }}>Solicite ao administrador para vincular serviços ao seu perfil de barbeiro.</p>
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '16px' }}>
                      {services.map((service) => {
                        const currentPrice = customPrices[service.id] !== undefined ? customPrices[service.id] : (service.custom_price !== null ? String(service.custom_price) : '');
                        const currentDuration = customDurations[service.id] !== undefined ? customDurations[service.id] : (service.custom_duration_minutes !== null ? String(service.custom_duration_minutes) : '');

                        return (
                          <div 
                            key={service.id} 
                            style={{ 
                              padding: '16px', 
                              background: 'rgba(255,255,255,0.01)', 
                              borderRadius: '12px', 
                              border: '1px solid rgba(255,255,255,0.05)',
                              display: 'flex',
                              flexDirection: 'column',
                              gap: '12px'
                            }}
                          >
                            <div>
                              <h3 style={{ fontSize: '16px', fontWeight: 'bold' }}>{service.name}</h3>
                              {service.description && (
                                <p style={{ fontSize: '12px', color: 'var(--muted)', marginTop: '4px', lineHeight: '1.4' }}>
                                  {service.description}
                                </p>
                              )}
                            </div>

                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginTop: 'auto', borderTop: '1px solid rgba(255,255,255,0.04)', paddingTop: '12px' }}>
                              <div>
                                <label style={{ fontSize: '11px', color: 'var(--muted)', display: 'block', marginBottom: '4px' }}>Seu Preço (R$)</label>
                                <input 
                                  type="number" 
                                  step="0.01" 
                                  className="form-input" 
                                  style={{ margin: 0, padding: '8px 12px' }} 
                                  placeholder={`Padrão: R$ ${parseFloat(service.default_price).toFixed(2)}`} 
                                  value={currentPrice}
                                  onChange={(e) => setCustomPrices(prev => ({ ...prev, [service.id]: e.target.value }))}
                                />
                              </div>
                              <div>
                                <label style={{ fontSize: '11px', color: 'var(--muted)', display: 'block', marginBottom: '4px' }}>Sua Duração (min)</label>
                                <input 
                                  type="number" 
                                  className="form-input" 
                                  style={{ margin: 0, padding: '8px 12px' }} 
                                  placeholder={`Padrão: ${service.default_duration_minutes} min`} 
                                  value={currentDuration}
                                  onChange={(e) => setCustomDurations(prev => ({ ...prev, [service.id]: e.target.value }))}
                                />
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'flex-end', borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '20px', marginTop: '10px' }}>
                      <button type="submit" className="btn-primary" style={{ padding: '12px 24px' }}>
                        Salvar Todos os Preços
                      </button>
                    </div>
                  </div>
                )}
              </form>
            </div>
          )}

          {/* TAB 3: GRAPHICAL BRANCHING FLOWCHART BUILDER */}
          {activeTab === 'flowchart' && (user?.role === 'owner' || user?.role === 'admin') && (
            <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                <div>
                  <h2 style={{ fontSize: '24px' }}>Fluxograma de Conversa do Bot</h2>
                  <p style={{ color: 'var(--muted)', fontSize: '14px' }}>Crie novos caminhos, gerencie ramificações condicionais e arraste os nós para organizar</p>
                </div>
                <div style={{ display: 'flex', gap: '10px' }}>
                  <button 
                    className="btn-secondary" 
                    style={{ gap: '6px', borderColor: 'rgba(212,175,55,0.3)', color: 'var(--primary)' }} 
                    onClick={handleRestoreDefaultFlowchart}
                  >
                    <RefreshCw size={16} />
                    <span>Restaurar Padrão</span>
                  </button>
                  <button className="btn-primary" style={{ gap: '6px' }} onClick={() => handleSaveBotFlowchart(botFlow)}>
                    <Check size={16} />
                    <span>Salvar Fluxograma</span>
                  </button>
                </div>
              </div>

              {/* Component Palette (Physical Elements to Drag or Click) */}
              <div 
                style={{ 
                  display: 'flex', 
                  alignItems: 'center', 
                  gap: '16px', 
                  background: 'rgba(25, 25, 28, 0.6)', 
                  border: '1px solid rgba(255, 255, 255, 0.05)', 
                  borderRadius: '12px', 
                  padding: '12px 18px', 
                  marginBottom: '16px',
                  backdropFilter: 'blur(10px)'
                }}
              >
                <div style={{ marginRight: '8px' }}>
                  <span style={{ fontSize: '12px', fontWeight: 'bold', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block' }}>
                    Componentes
                  </span>
                  <span style={{ fontSize: '11px', color: 'rgba(255, 255, 255, 0.4)' }}>
                    Clique ou arraste para o canvas
                  </span>
                </div>

                {/* Component 1: Message Node */}
                <div
                  draggable
                  onDragStart={(e) => e.dataTransfer.setData('nodeType', 'message')}
                  onClick={() => handleAddNewNode('message')}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px',
                    padding: '8px 16px',
                    borderRadius: '8px',
                    border: '1px dashed rgba(212,175,55,0.4)',
                    background: 'rgba(212,175,55,0.03)',
                    color: 'var(--foreground)',
                    cursor: 'grab',
                    fontSize: '13px',
                    fontWeight: 500,
                    userSelect: 'none',
                    transition: 'transform 0.2s, background 0.2s, box-shadow 0.2s'
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.transform = 'scale(1.03)';
                    e.currentTarget.style.background = 'rgba(212,175,55,0.08)';
                    e.currentTarget.style.boxShadow = '0 0 10px rgba(212,175,55,0.1)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.transform = 'scale(1.0)';
                    e.currentTarget.style.background = 'rgba(212,175,55,0.03)';
                    e.currentTarget.style.boxShadow = 'none';
                  }}
                  title="Clique ou arraste para criar um balão de mensagem"
                >
                  <MessageSquare size={16} style={{ color: 'var(--primary)' }} />
                  <span>Mensagem de Texto</span>
                </div>

                {/* Component 2: Condition Node */}
                <div
                  draggable
                  onDragStart={(e) => e.dataTransfer.setData('nodeType', 'condition')}
                  onClick={() => handleAddNewNode('condition')}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px',
                    padding: '8px 16px',
                    borderRadius: '8px',
                    border: '1px dashed rgba(96,165,250,0.4)',
                    background: 'rgba(96,165,250,0.03)',
                    color: 'var(--foreground)',
                    cursor: 'grab',
                    fontSize: '13px',
                    fontWeight: 500,
                    userSelect: 'none',
                    transition: 'transform 0.2s, background 0.2s, box-shadow 0.2s'
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.transform = 'scale(1.03)';
                    e.currentTarget.style.background = 'rgba(96,165,250,0.08)';
                    e.currentTarget.style.boxShadow = '0 0 10px rgba(96,165,250,0.1)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.transform = 'scale(1.0)';
                    e.currentTarget.style.background = 'rgba(96,165,250,0.03)';
                    e.currentTarget.style.boxShadow = 'none';
                  }}
                  title="Clique ou arraste para criar uma tomada de decisão/menu condicional"
                >
                  <Workflow size={16} style={{ color: '#60a5fa' }} />
                  <span>Verificação Condicional</span>
                </div>

                {/* Component 3: API Webhook Node */}
                <div
                  draggable
                  onDragStart={(e) => e.dataTransfer.setData('nodeType', 'api')}
                  onClick={() => handleAddNewNode('api')}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px',
                    padding: '8px 16px',
                    borderRadius: '8px',
                    border: '1px dashed rgba(168,85,247,0.4)',
                    background: 'rgba(168,85,247,0.03)',
                    color: 'var(--foreground)',
                    cursor: 'grab',
                    fontSize: '13px',
                    fontWeight: 500,
                    userSelect: 'none',
                    transition: 'transform 0.2s, background 0.2s, box-shadow 0.2s'
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.transform = 'scale(1.03)';
                    e.currentTarget.style.background = 'rgba(168,85,247,0.08)';
                    e.currentTarget.style.boxShadow = '0 0 10px rgba(168,85,247,0.1)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.transform = 'scale(1.0)';
                    e.currentTarget.style.background = 'rgba(168,85,247,0.03)';
                    e.currentTarget.style.boxShadow = 'none';
                  }}
                  title="Clique ou arraste para criar uma integração de API Webhook externa"
                >
                  <Cpu size={16} style={{ color: '#a855f7' }} />
                  <span>Integração API</span>
                </div>
              </div>

              {/* Viewport Canvas container */}
              <div 
                ref={canvasRef}
                style={{ 
                  position: 'relative', 
                  width: '100%', 
                  height: '600px', 
                  backgroundColor: '#0f0f12', 
                  border: '1px solid rgba(255,255,255,0.06)', 
                  borderRadius: '12px', 
                  overflow: 'auto', 
                  cursor: draggingNode ? 'grabbing' : 'default',
                  boxShadow: 'inset 0 4px 20px rgba(0,0,0,0.5)'
                }}
                onMouseMove={handleCanvasMouseMove}
                onMouseUp={handleCanvasMouseUp}
                onMouseLeave={handleCanvasMouseUp}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  const type = e.dataTransfer.getData('nodeType') as 'message' | 'condition';
                  if (type) {
                    handleAddNewNode(type, e.clientX, e.clientY);
                  }
                }}
              >
                {/* Scrollable canvas area */}
                <div style={{ width: '3200px', height: '800px', position: 'relative', backgroundImage: 'radial-gradient(rgba(212, 175, 55, 0.08) 1.5px, transparent 1.5px)', backgroundSize: '24px 24px' }}>
                  
                  {/* SVG Connecting Curves */}
                  <svg style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', pointerEvents: 'none' }}>
                    <defs>
                      <marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                        <path d="M 0 1.5 L 8 5 L 0 8.5 z" fill="#d4af37" />
                      </marker>
                    </defs>

                    {/* Render all custom edges dynamically from state */}
                    {botFlow.edges?.map((edge) => {
                      const sourceNode = botFlow.nodes.find(n => n.id === edge.source);
                      const targetNode = botFlow.nodes.find(n => n.id === edge.target);
                      if (!sourceNode || !targetNode) return null;

                      const isSelected = selectedNodeId === sourceNode.id || selectedNodeId === targetNode.id;
                      
                      // Calculate connection port offsets
                      let startX = sourceNode.x + 240;
                      let startY = sourceNode.y + 45;

                      if (sourceNode.type === 'condition' && edge.sourceHandle) {
                        const optIndex = (sourceNode.options || []).findIndex(o => o.key === edge.sourceHandle);
                        if (optIndex !== -1) {
                          startY = sourceNode.y + 46 + optIndex * 32;
                        }
                      }

                      const targetX = targetNode.x;
                      const targetY = targetNode.y + 45;

                      const pathStr = `M ${startX} ${startY} C ${startX + 80} ${startY}, ${targetX - 80} ${targetY}, ${targetX} ${targetY}`;

                      return (
                        <g key={edge.id}>
                          <path 
                            d={pathStr} 
                            fill="none" 
                            stroke={isSelected ? 'var(--primary)' : 'rgba(255,255,255,0.18)'} 
                            strokeWidth={isSelected ? '3' : '2'} 
                            markerEnd="url(#arrow)" 
                            opacity="0.85"
                            style={isSelected ? { strokeDasharray: '6', animation: 'dash 20s linear infinite' } : {}}
                          />
                          {edge.sourceHandle && (
                            <text
                              x={startX + 12}
                              y={startY - 6}
                              fill="var(--primary)"
                              fontSize="9"
                              fontWeight="bold"
                            >
                              Opção {edge.sourceHandle}
                            </text>
                          )}
                        </g>
                      );
                    })}

                    {/* Render drawing connection line preview */}
                    {drawingEdge && (
                      <path
                        d={`M ${drawingEdge.startX} ${drawingEdge.startY} C ${drawingEdge.startX + 80} ${drawingEdge.startY}, ${drawingEdge.currentX - 80} ${drawingEdge.currentY}, ${drawingEdge.currentX} ${drawingEdge.currentY}`}
                        fill="none"
                        stroke="var(--primary)"
                        strokeWidth="2"
                        strokeDasharray="4"
                        opacity="0.8"
                        style={{ animation: 'dash 30s linear infinite' }}
                      />
                    )}
                  </svg>

                  {/* Render visual disconnect buttons in the center of connection curves */}
                  {botFlow.edges?.map((edge) => {
                    const sourceNode = botFlow.nodes.find(n => n.id === edge.source);
                    const targetNode = botFlow.nodes.find(n => n.id === edge.target);
                    if (!sourceNode || !targetNode) return null;

                    let startX = sourceNode.x + 240;
                    let startY = sourceNode.y + 45;

                    if (sourceNode.type === 'condition' && edge.sourceHandle) {
                      const optIndex = (sourceNode.options || []).findIndex(o => o.key === edge.sourceHandle);
                      if (optIndex !== -1) {
                        startY = sourceNode.y + 46 + optIndex * 32;
                      }
                    }

                    const targetX = targetNode.x;
                    const targetY = targetNode.y + 45;

                    const midX = (startX + targetX) / 2;
                    const midY = (startY + targetY) / 2;

                    return (
                      <button
                        key={`del_${edge.id}`}
                        style={{
                          position: 'absolute',
                          left: `${midX - 9}px`,
                          top: `${midY - 9}px`,
                          width: '18px',
                          height: '18px',
                          borderRadius: '50%',
                          backgroundColor: '#ef4444',
                          border: 'none',
                          color: '#ffffff',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          cursor: 'pointer',
                          fontSize: '11px',
                          fontWeight: 'bold',
                          boxShadow: '0 2px 6px rgba(0,0,0,0.4)',
                          zIndex: 35,
                          transition: 'transform 0.15s ease'
                        }}
                        title="Excluir esta conexão"
                        onClick={(e) => { e.stopPropagation(); handleDisconnectEdge(edge.id); }}
                        onMouseEnter={(e) => e.currentTarget.style.transform = 'scale(1.2)'}
                        onMouseLeave={(e) => e.currentTarget.style.transform = 'scale(1.0)'}
                      >
                        ×
                      </button>
                    );
                  })}

                  {/* Render Node Cards dynamically from state */}
                  {botFlow.nodes?.map((node) => {
                    const isSelected = selectedNodeId === node.id;
                    const isSystemReserved = ['start', 'end', 'welcome', 'check_intent', 'select_barber', 'select_date', 'select_slot', 'confirmed', 'offer_plan'].includes(node.id);

                    // Dynamic colors for Start, End and generic nodes
                    let cardBorder = isSelected ? '2px solid var(--primary)' : '1px solid rgba(255,255,255,0.08)';
                    let cardBg = isSelected ? 'rgba(212,175,55,0.06)' : 'rgba(25,25,28,0.75)';
                    let cardShadow = isSelected ? '0 0 20px rgba(212,175,55,0.2)' : '0 4px 12px rgba(0,0,0,0.3)';

                    if (node.type === 'start') {
                      cardBorder = isSelected ? '2px solid #10b981' : '1px solid rgba(16,185,129,0.4)';
                      cardBg = isSelected ? 'rgba(16,185,129,0.1)' : 'rgba(16,185,129,0.03)';
                      cardShadow = isSelected ? '0 0 20px rgba(16,185,129,0.25)' : '0 4px 12px rgba(0,0,0,0.2)';
                    } else if (node.type === 'end') {
                      cardBorder = isSelected ? '2px solid #ef4444' : '1px solid rgba(239,68,68,0.4)';
                      cardBg = isSelected ? 'rgba(239,68,68,0.1)' : 'rgba(239,68,68,0.03)';
                      cardShadow = isSelected ? '0 0 20px rgba(239,68,68,0.25)' : '0 4px 12px rgba(0,0,0,0.2)';
                    } else if (node.type === 'api') {
                      cardBorder = isSelected ? '2px solid #a855f7' : '1px solid rgba(168,85,247,0.4)';
                      cardBg = isSelected ? 'rgba(168,85,247,0.1)' : 'rgba(168,85,247,0.03)';
                      cardShadow = isSelected ? '0 0 20px rgba(168,85,247,0.25)' : '0 4px 12px rgba(0,0,0,0.2)';
                    }

                    // Dynamic height based on options count
                    const cardHeight = node.type === 'condition' ? 64 + (node.options || []).length * 32 : 90;

                    return (
                      <div 
                        key={node.id}
                        style={{
                          position: 'absolute',
                          left: node.x,
                          top: node.y,
                          width: '240px',
                          minHeight: `${cardHeight}px`,
                          background: cardBg,
                          backdropFilter: 'blur(10px)',
                          border: cardBorder,
                          borderRadius: '10px',
                          padding: '12px 16px',
                          cursor: 'grab',
                          boxShadow: cardShadow,
                          transition: 'border 0.2s, box-shadow 0.2s',
                          zIndex: isSelected ? 50 : 10
                        }}
                        onMouseDown={(e) => handleNodeMouseDown(node.id, e)}
                        onMouseUp={() => handleNodeMouseUp(node.id)}
                        onClick={(e) => { e.stopPropagation(); setSelectedNodeId(node.id); }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px', borderBottom: '1px solid rgba(255,255,255,0.06)', paddingBottom: '6px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                            {node.type === 'start' ? <div style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#10b981' }} /> : 
                             node.type === 'end' ? <div style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#ef4444' }} /> : 
                             node.type === 'message' ? <MessageSquare size={14} style={{ color: 'var(--primary)' }} /> : 
                             node.type === 'condition' ? <Workflow size={14} style={{ color: '#60a5fa' }} /> : 
                             node.type === 'api' ? <Cpu size={14} style={{ color: '#a855f7' }} /> : 
                             <Award size={14} style={{ color: 'var(--success)' }} />}
                            <strong style={{ fontSize: '13px', color: 'var(--foreground)' }}>{node.title}</strong>
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            {node.type === 'condition' && (
                              <button
                                style={{ 
                                  background: 'rgba(212,175,55,0.15)', 
                                  border: 'none', 
                                  color: 'var(--primary)', 
                                  cursor: 'pointer', 
                                  padding: '2px 6px', 
                                  borderRadius: '4px',
                                  fontSize: '12px',
                                  fontWeight: 'bold',
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  width: '18px',
                                  height: '18px'
                                }}
                                title="Adicionar Opção de Saída"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setQuickOptionNodeId(node.id);
                                  setQuickOptionKey('');
                                  setQuickOptionLabel('');
                                  setQuickOptionError('');
                                  setShowQuickOptionModal(true);
                                }}
                              >
                                +
                              </button>
                            )}
                            {!isSystemReserved && (
                              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                <button 
                                  style={{ background: 'none', border: 'none', color: 'var(--primary)', cursor: 'pointer', padding: '2px', display: 'flex', alignItems: 'center' }}
                                  title="Duplicar Nó"
                                  onClick={(e) => { e.stopPropagation(); handleDuplicateNode(node); }}
                                >
                                  <Copy size={12} />
                                </button>
                                <button 
                                  style={{ background: 'none', border: 'none', color: 'var(--error)', cursor: 'pointer', padding: '2px', display: 'flex', alignItems: 'center' }}
                                  title="Excluir Nó"
                                  onClick={(e) => { e.stopPropagation(); handleDeleteNode(node.id); }}
                                >
                                  <Trash2 size={12} />
                                </button>
                              </div>
                            )}
                          </div>
                        </div>

                        {/* Card body text or condition options */}
                        {node.type === 'condition' ? (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '6.5px', marginTop: '6px' }}>
                            {(node.options || []).map((opt, index) => (
                              <div 
                                key={opt.key}
                                style={{ 
                                  display: 'flex', 
                                  justifyContent: 'space-between',
                                  fontSize: '11px',
                                  color: 'var(--muted)',
                                  padding: '4px 0',
                                  borderBottom: '1px solid rgba(255,255,255,0.02)'
                                }}
                              >
                                <span>{opt.key} - {opt.label}</span>
                                
                                {/* Individual port dot for condition option */}
                                <div 
                                  style={{ 
                                    position: 'absolute', 
                                    right: '-6px', 
                                    top: `${40 + index * 32}px`, 
                                    width: '12px', 
                                    height: '12px', 
                                    borderRadius: '50%', 
                                    background: 'var(--primary)', 
                                    border: '2px solid #0f0f12',
                                    cursor: 'crosshair',
                                    zIndex: 10
                                  }}
                                  title={`Arraste para conectar o atalho "${opt.key}"`}
                                  onMouseDown={(e) => handlePortMouseDown(node.id, opt.key, e)}
                                  onClick={(e) => e.stopPropagation()}
                                />
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p style={{ fontSize: '11px', color: 'var(--muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {node.type === 'start' ? 'Início da Conversa' :
                             node.type === 'end' ? 'Fim da Conversa' :
                             node.type === 'message' ? node.text : 
                             node.type === 'api' ? `${node.method || 'POST'}: ${node.url || ''}` :
                             `Ação: ${node.actionType}`}
                          </p>
                        )}

                        {/* Input Port (Left) - Render for all nodes except Start */}
                        {node.type !== 'start' && (
                          <div style={{ position: 'absolute', left: '-6px', top: 'calc(50% - 6px)', width: '12px', height: '12px', borderRadius: '50%', background: 'var(--primary)', border: '2px solid #0f0f12' }} />
                        )}
                        
                        {/* Output Port (Right) - Only render for standard nodes with single outputs */}
                        {node.type !== 'end' && node.type !== 'condition' && (
                          <div 
                            style={{ 
                              position: 'absolute', 
                              right: '-6px', 
                              top: 'calc(50% - 6px)', 
                              width: '12px', 
                              height: '12px', 
                              borderRadius: '50%', 
                              background: 'var(--primary)', 
                              border: '2px solid #0f0f12',
                              cursor: 'crosshair',
                              zIndex: 10
                            }}
                            title="Arraste para conectar"
                            onMouseDown={(e) => handlePortMouseDown(node.id, undefined, e)}
                            onClick={(e) => e.stopPropagation()}
                          />
                        )}
                      </div>
                    );
                  })}

                </div>
              </div>

              {/* Floating Editor Panel for selected node */}
              {selectedNode && (
                <div className="card-premium animate-fade-in" style={{ marginTop: '20px', border: '1px solid var(--primary)', background: 'rgba(20,20,24,0.9)', display: 'flex', flexDirection: 'column', gap: '16px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid rgba(255,255,255,0.06)', paddingBottom: '10px' }}>
                    <h3 style={{ fontSize: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <FileText size={18} style={{ color: 'var(--primary)' }} />
                      Configurar Nó: {selectedNode.title} (Tipo: {selectedNode.type})
                    </h3>
                    <button className="btn-secondary" style={{ padding: '4px', border: 'none' }} onClick={() => setSelectedNodeId(null)}>
                      <X size={16} />
                    </button>
                  </div>

                  {/* NODE TYPE START: START NODE EDITOR */}
                  {selectedNode.type === 'start' && (
                    <div>
                      <p style={{ fontSize: '14px', color: 'var(--muted)', lineHeight: '1.5' }}>
                        Este é o nó de <strong>Início</strong>. Ele representa a entrada do cliente quando envia a primeira mensagem (saudação inicial). 
                        Conecte a saída deste nó ao nó de Boas-Vindas para iniciar a iteração.
                      </p>
                      
                      <div className="form-group" style={{ marginTop: '16px' }}>
                        <label className="form-label">Conectar ao primeiro nó de mensagem</label>
                        <select 
                          className="form-input"
                          value={botFlow.edges.find(e => e.source === selectedNode.id)?.target || ''}
                          onChange={(e) => handleUpdateNodeTargetConnection(selectedNode.id, e.target.value)}
                        >
                          <option value="">Nenhum (Desconectado)</option>
                          {botFlow.nodes.filter(n => n.id !== selectedNode.id).map(n => (
                            <option key={n.id} value={n.id}>{n.title}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                  )}

                  {/* NODE TYPE END: END NODE EDITOR */}
                  {selectedNode.type === 'end' && (
                    <div>
                      <p style={{ fontSize: '14px', color: 'var(--muted)', lineHeight: '1.5' }}>
                        Este é o nó de <strong>Fim</strong>. Ele representa a conclusão da iteração do cliente.
                        Qualquer caminho da conversa que aponte para este nó resultará na finalização automática da sessão, voltando o bot para o estado inativo à espera de uma nova saudação.
                      </p>
                    </div>
                  )}

                  {/* NODE TYPE 1: MESSAGE NODE EDITOR */}
                  {selectedNode.type === 'message' && (
                    <div style={{ display: 'flex', gap: '20px', flexDirection: 'row' }}>
                      <div style={{ flex: 2, display: 'flex', flexDirection: 'column', gap: '12px' }}>
                        <div className="form-group">
                          <label className="form-label">Título do Nó</label>
                          <input 
                            type="text" 
                            className="form-input" 
                            value={selectedNode.title} 
                            onChange={(e) => {
                              const val = e.target.value;
                              setBotFlow(prev => ({
                                ...prev,
                                nodes: prev.nodes.map(n => n.id === selectedNode.id ? { ...n, title: val } : n)
                              }));
                            }} 
                          />
                        </div>

                        <div className="form-group">
                          <label className="form-label">Texto da Mensagem (WhatsApp)</label>
                          <textarea
                            className="form-input"
                            style={{ minHeight: '110px', fontFamily: 'monospace', fontSize: '13px', lineHeight: '1.5' }}
                            value={selectedNode.text || ''}
                            onChange={(e) => {
                              const val = e.target.value;
                              setBotFlow(prev => ({
                                ...prev,
                                nodes: prev.nodes.map(n => n.id === selectedNode.id ? { ...n, text: val } : n)
                              }));
                            }}
                          />
                        </div>

                        {/* Edge Target Selector */}
                        <div className="form-group">
                          <label className="form-label">Próximo Passo (Conectar ao nó)</label>
                          <select 
                            className="form-input"
                            value={botFlow.edges.find(e => e.source === selectedNode.id)?.target || ''}
                            onChange={(e) => handleUpdateNodeTargetConnection(selectedNode.id, e.target.value)}
                          >
                            <option value="">Nenhum (Fim do fluxo)</option>
                            {botFlow.nodes.filter(n => n.id !== selectedNode.id).map(n => (
                              <option key={n.id} value={n.id}>{n.title} ({n.type === 'action' ? `Ação: ${n.actionType}` : n.type})</option>
                            ))}
                          </select>
                        </div>
                      </div>

                      <div style={{ flex: 1, padding: '14px', background: 'rgba(255,255,255,0.02)', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.04)', fontSize: '12px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                        <strong style={{ display: 'block', color: 'var(--primary)' }}>Tags de Substituição:</strong>
                        <p>`{"{cliente}"}` - Nome do Cliente</p>
                        <p>`{"{estabelecimento}"}` - Nome da Barbearia</p>
                        <p>`{"{abertura}"}` - Horário Abertura</p>
                        <p>`{"{fechamento}"}` - Horário Fechamento</p>
                        <p>`{"{barbeiro}"}` - Nome do Barbeiro</p>
                        <p>`{"{data}"}` - Dia do Corte</p>
                        <p>`{"{horario}"}` - Hora do Corte</p>
                        <div style={{ marginTop: '8px', borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: '8px', fontSize: '11px', color: 'var(--muted)', lineHeight: '1.4' }}>
                          ℹ️ As tags funcionam em <strong>todos os cartões (inclusive novos)</strong>. Apenas garanta que o nó esteja posicionado depois que o cliente já tiver respondido o dado (ex: a tag de <em>barbeiro</em> só terá valor nos cartões pós-Escolha do Barbeiro).
                        </div>
                      </div>
                    </div>
                  )}

                  {/* NODE TYPE 2: CONDITION NODE EDITOR (BRANCHING) */}
                  {selectedNode.type === 'condition' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                      <div className="form-group">
                        <label className="form-label">Título do Nó</label>
                        <input 
                          type="text" 
                          className="form-input" 
                          style={{ maxWidth: '300px' }}
                          value={selectedNode.title} 
                          onChange={(e) => {
                            const val = e.target.value;
                            setBotFlow(prev => ({
                              ...prev,
                              nodes: prev.nodes.map(n => n.id === selectedNode.id ? { ...n, title: val } : n)
                            }));
                          }} 
                        />
                      </div>

                      {/* Configured Branches List */}
                      <div className="card-premium" style={{ background: 'rgba(255,255,255,0.01)' }}>
                        <h4 style={{ fontSize: '14px', marginBottom: '12px', color: 'var(--primary)' }}>Ramificações do Menu (Condições)</h4>
                        
                        {(selectedNode.options || []).length === 0 ? (
                          <p style={{ color: 'var(--muted)', fontSize: '13px' }}>Nenhuma ramificação configurada ainda. Adicione uma abaixo.</p>
                        ) : (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                            {(selectedNode.options || []).map((opt) => {
                              const targetNode = botFlow.nodes.find(n => n.id === opt.target);
                              return (
                                <div key={opt.key} style={{ display: 'flex', justifyItems: 'center', justifyContent: 'space-between', padding: '10px', background: 'rgba(255,255,255,0.02)', borderRadius: '6px', fontSize: '13px' }}>
                                  <div>
                                    Se digitou <strong>"{opt.key}"</strong> ({opt.label}) → Direcionar para <strong>{targetNode?.title || 'Fim do Fluxo'}</strong>
                                  </div>
                                  <button 
                                    className="btn-secondary" 
                                    style={{ padding: '2px 8px', color: 'var(--error)', borderColor: 'transparent' }}
                                    onClick={() => handleRemoveConditionOption(selectedNode.id, opt.key)}
                                  >
                                    Remover
                                  </button>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>

                      {/* Add new branch form */}
                      <div className="card-premium" style={{ background: 'rgba(255,255,255,0.02)', border: '1px dashed rgba(255,255,255,0.08)' }}>
                        <h4 style={{ fontSize: '13px', marginBottom: '10px' }}>Adicionar Ramificação</h4>
                        <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                          <input 
                            type="text" 
                            id="new_branch_key" 
                            placeholder="Teclar (ex: 1)" 
                            className="form-input" 
                            style={{ flex: 1, minWidth: '100px' }} 
                          />
                          <input 
                            type="text" 
                            id="new_branch_label" 
                            placeholder="Nome (ex: Agendar)" 
                            className="form-input" 
                            style={{ flex: 1, minWidth: '120px' }} 
                          />
                          <select 
                            id="new_branch_target" 
                            className="form-input" 
                            style={{ flex: 1.5, minWidth: '180px' }}
                          >
                            <option value="">Escolha o nó destino...</option>
                            {botFlow.nodes.map(n => (
                              <option key={n.id} value={n.id}>{n.title}</option>
                            ))}
                          </select>
                          <button 
                            type="button" 
                            className="btn-primary"
                            onClick={() => {
                              const key = (document.getElementById('new_branch_key') as HTMLInputElement).value;
                              const label = (document.getElementById('new_branch_label') as HTMLInputElement).value;
                              const target = (document.getElementById('new_branch_target') as HTMLSelectElement).value;
                              
                              if (key && target) {
                                handleAddConditionOption(selectedNode.id, key, label, target);
                                (document.getElementById('new_branch_key') as HTMLInputElement).value = '';
                                (document.getElementById('new_branch_label') as HTMLInputElement).value = '';
                                (document.getElementById('new_branch_target') as HTMLSelectElement).value = '';
                              } else {
                                showToast('Digite a opção e o nó de destino.', 'error');
                              }
                            }}
                          >
                            Conectar
                          </button>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* NODE TYPE 3: ACTION NODE EDITOR */}
                  {selectedNode.type === 'action' && (
                    <div>
                      <p style={{ fontSize: '14px', color: 'var(--muted)', lineHeight: '1.5' }}>
                        Nós de ação representam as rotinas programadas do motor de agendamentos (Listagem de Barbeiros, Datas, Horários Livres ou Clube de Assinatura).
                        O conteúdo interno destas etapas é processado automaticamente pelo servidor.
                      </p>
                      
                      <div className="form-group" style={{ marginTop: '16px' }}>
                        <label className="form-label">Próximo Passo pós-Ação</label>
                        <select 
                          className="form-input"
                          value={botFlow.edges.find(e => e.source === selectedNode.id)?.target || ''}
                          onChange={(e) => handleUpdateNodeTargetConnection(selectedNode.id, e.target.value)}
                        >
                          <option value="">Nenhum (Fim do fluxo)</option>
                          {botFlow.nodes.filter(n => n.id !== selectedNode.id).map(n => (
                            <option key={n.id} value={n.id}>{n.title} ({n.type})</option>
                          ))}
                        </select>
                      </div>
                    </div>
                  )}

                  {/* NODE TYPE 4: API WEBHOOK NODE EDITOR */}
                  {selectedNode.type === 'api' && (
                    <div style={{ display: 'flex', gap: '20px', flexDirection: 'row' }}>
                      <div style={{ flex: 2, display: 'flex', flexDirection: 'column', gap: '12px' }}>
                        <div className="form-group">
                          <label className="form-label">Título do Nó</label>
                          <input 
                            type="text" 
                            className="form-input" 
                            value={selectedNode.title} 
                            onChange={(e) => {
                              const val = e.target.value;
                              setBotFlow(prev => ({
                                ...prev,
                                nodes: prev.nodes.map(n => n.id === selectedNode.id ? { ...n, title: val } : n)
                              }));
                            }} 
                          />
                        </div>

                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '12px' }}>
                          <div className="form-group">
                            <label className="form-label">Método HTTP</label>
                            <select
                              className="form-input"
                              value={selectedNode.method || 'POST'}
                              onChange={(e) => {
                                const val = e.target.value as any;
                                setBotFlow(prev => ({
                                  ...prev,
                                  nodes: prev.nodes.map(n => n.id === selectedNode.id ? { ...n, method: val } : n)
                                }));
                              }}
                            >
                              <option value="GET">GET</option>
                              <option value="POST">POST</option>
                              <option value="PUT">PUT</option>
                              <option value="DELETE">DELETE</option>
                            </select>
                          </div>

                          <div className="form-group">
                            <label className="form-label">URL da API (Endpoint Webhook)</label>
                            <input
                              type="text"
                              className="form-input"
                              placeholder="https://api.seusistema.com/webhooks/reserva"
                              value={selectedNode.url || ''}
                              onChange={(e) => {
                                const val = e.target.value;
                                setBotFlow(prev => ({
                                  ...prev,
                                  nodes: prev.nodes.map(n => n.id === selectedNode.id ? { ...n, url: val } : n)
                                }));
                              }}
                            />
                          </div>
                        </div>

                        <div className="form-group">
                          <label className="form-label">Headers da Requisição (JSON)</label>
                          <textarea
                            className="form-input"
                            style={{ minHeight: '60px', fontFamily: 'monospace', fontSize: '12px' }}
                            placeholder='{ "Authorization": "Bearer token-secreto" }'
                            value={selectedNode.headers || ''}
                            onChange={(e) => {
                              const val = e.target.value;
                              setBotFlow(prev => ({
                                ...prev,
                                nodes: prev.nodes.map(n => n.id === selectedNode.id ? { ...n, headers: val } : n)
                                }));
                            }}
                          />
                        </div>

                        {selectedNode.method !== 'GET' && (
                          <div className="form-group">
                            <label className="form-label">Corpo da Requisição (JSON Payload)</label>
                            <textarea
                              className="form-input"
                              style={{ minHeight: '90px', fontFamily: 'monospace', fontSize: '12px' }}
                              placeholder='{ "cliente": "{cliente}", "telefone": "{cliente}" }'
                              value={selectedNode.body || ''}
                              onChange={(e) => {
                                const val = e.target.value;
                                setBotFlow(prev => ({
                                  ...prev,
                                  nodes: prev.nodes.map(n => n.id === selectedNode.id ? { ...n, body: val } : n)
                                }));
                              }}
                            />
                          </div>
                        )}

                        <div className="form-group">
                          <label className="form-label">Mensagem de Resposta ao Cliente (WhatsApp)</label>
                          <textarea
                            className="form-input"
                            style={{ minHeight: '60px', fontFamily: 'monospace', fontSize: '13px' }}
                            placeholder="Resposta opcional pós-chamada com sucesso..."
                            value={selectedNode.webhookResponse || ''}
                            onChange={(e) => {
                              const val = e.target.value;
                              setBotFlow(prev => ({
                                ...prev,
                                nodes: prev.nodes.map(n => n.id === selectedNode.id ? { ...n, webhookResponse: val } : n)
                              }));
                            }}
                          />
                        </div>

                        <div className="form-group">
                          <label className="form-label">Próximo Passo pós-Integração</label>
                          <select 
                            className="form-input"
                            value={botFlow.edges.find(e => e.source === selectedNode.id)?.target || ''}
                            onChange={(e) => handleUpdateNodeTargetConnection(selectedNode.id, e.target.value)}
                          >
                            <option value="">Nenhum (Fim do fluxo)</option>
                            {botFlow.nodes.filter(n => n.id !== selectedNode.id).map(n => (
                              <option key={n.id} value={n.id}>{n.title} ({n.type === 'action' ? `Ação: ${n.actionType}` : n.type})</option>
                            ))}
                          </select>
                        </div>
                      </div>

                      <div style={{ flex: 1, padding: '14px', background: 'rgba(255,255,255,0.02)', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.04)', fontSize: '12px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                        <strong style={{ display: 'block', color: 'var(--primary)' }}>Como integrar Webhooks:</strong>
                        <p>💡 Utilize tags dinâmicas como `{`{cliente}`}` e `{`{barbeiro}`}` no URL ou Body para passar as respostas do agendamento.</p>
                        <p>🔒 Headers e Body devem ser strings formatadas como JSON válido.</p>
                        <p>⚡ A chamada é disparada de forma automatizada pelo servidor central do BarberHub assim que a conversa atinge essa etapa.</p>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* CSS Animation override for dashed SVG path lines */}
              <style>{`
                @keyframes dash {
                  to {
                    stroke-dashoffset: -1000;
                  }
                }
              `}</style>
            </div>
          )}

          {/* TAB 4: CLUBE DE ASSINATURAS */}
          {activeTab === 'plans' && (user?.role === 'owner' || user?.role === 'admin') && (
            <div className="animate-fade-in">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
                <div>
                  <h2 style={{ fontSize: '24px' }}>Clube de Assinaturas (Planos)</h2>
                  <p style={{ color: 'var(--muted)', fontSize: '14px' }}>Gerencie clientes em planos recorrentes e configure agendamentos automáticos</p>
                </div>
                <button className="btn-primary" onClick={() => {
                  if (barbers.length > 0) setNewPlanBarber(barbers[0].id);
                  setShowPlanModal(true);
                }}>
                  <Plus size={18} />
                  <span>Cadastrar Assinante</span>
                </button>
              </div>

              {loading ? (
                <div style={{ textAlign: 'center', padding: '40px', color: 'var(--muted)' }}>Carregando assinaturas...</div>
              ) : plans.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '60px 20px', border: '1px dashed rgba(255,255,255,0.08)', borderRadius: '12px', color: 'var(--muted)' }}>
                  <Award size={48} style={{ marginBottom: '16px', opacity: '0.4' }} />
                  <p>Nenhuma assinatura ativa encontrada no momento.</p>
                </div>
              ) : (
                <div className="grid-cols-responsive">
                  {plans.map((plan) => (
                    <div key={plan.id} className="card-premium animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <div>
                          <h4 style={{ fontSize: '17px', color: 'var(--foreground)' }}>{plan.client_name}</h4>
                          <span style={{ fontSize: '12px', color: 'var(--muted)' }}>Tel: {plan.client_phone}</span>
                        </div>
                        <span style={{
                          backgroundColor: plan.plan_type === 'quinzenal' ? 'rgba(16, 185, 129, 0.15)' : 'rgba(212, 175, 55, 0.15)',
                          color: plan.plan_type === 'quinzenal' ? 'var(--success)' : 'var(--primary)',
                          padding: '4px 8px',
                          borderRadius: '4px',
                          fontSize: '11px',
                          fontWeight: 'bold',
                          textTransform: 'uppercase'
                        }}>
                          {plan.plan_type}
                        </span>
                      </div>

                      <div style={{ padding: '12px', background: 'rgba(255,255,255,0.02)', borderRadius: '8px', fontSize: '13px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <Users size={14} style={{ color: 'var(--primary)' }} />
                          <span>Profissional: <strong>{plan.barber_name}</strong></span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <Clock size={14} style={{ color: 'var(--primary)' }} />
                          <span>Dia/Hora: <strong>{getWeekdayName(plan.preferred_day_of_week)} às {plan.preferred_time.substring(0,5)}</strong></span>
                        </div>
                      </div>

                      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '8px' }}>
                        <button 
                          className="btn-secondary" 
                          style={{ padding: '6px 12px', fontSize: '13px', color: 'var(--error)', borderColor: 'rgba(239, 68, 68, 0.2)' }}
                          onClick={() => handleCancelPlan(plan.id)}
                        >
                          <Trash2 size={14} />
                          <span>Cancelar Assinatura</span>
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* TAB 4: WHATSAPP BOT CONFIG */}
          {activeTab === 'bot' && (user?.role === 'owner' || user?.role === 'admin') && (
            <div className="animate-fade-in">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
                <div>
                  <h2 style={{ fontSize: '24px' }}>Conexão do WhatsApp Bot</h2>
                  <p style={{ color: 'var(--muted)', fontSize: '14px' }}>Conecte seu WhatsApp de atendimento para automatizar os agendamentos dos clientes</p>
                </div>
                <button className="btn-secondary" onClick={loadBotStatus} disabled={refreshingBot}>
                  <RefreshCw size={16} className={refreshingBot ? 'animate-spin' : ''} />
                  <span>Atualizar Status</span>
                </button>
              </div>

              <div style={{ display: 'flex', gap: '24px', flexDirection: 'row' }}>
                <div style={{ flex: 1 }} className="card-premium">
                  <h3 style={{ fontSize: '18px', marginBottom: '16px' }}>Status da Conexão</h3>
                  
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '24px' }}>
                    <div style={{ 
                      width: '12px', 
                      height: '12px', 
                      borderRadius: '50%', 
                      backgroundColor: botStatus === 'connected' ? 'var(--success)' : botStatus === 'qr_ready' ? 'var(--warning)' : 'var(--error)' 
                    }} />
                    <span style={{ fontWeight: '600', fontSize: '16px', textTransform: 'capitalize' }}>
                      {botStatus === 'connected' ? 'Conectado (Online)' : botStatus === 'qr_ready' ? 'Aguardando Leitura de QR Code' : botStatus === 'connecting' ? 'Iniciando Serviço...' : 'Desconectado'}
                    </span>
                  </div>

                  <p style={{ fontSize: '14px', color: 'var(--muted)', lineHeight: '1.6', marginBottom: '16px' }}>
                    O bot de agendamento funciona respondendo mensagens automaticamente no seu número do WhatsApp.
                    Quando um cliente entra em contato, o bot lista os barbeiros cadastrados, verifica a agenda no banco de dados e confirma o horário marcado.
                  </p>

                  <div style={{ padding: '16px', background: 'rgba(255,255,255,0.02)', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.04)' }}>
                    <p style={{ fontSize: '14px', fontWeight: '500', marginBottom: '8px' }}>Como conectar:</p>
                    <ol style={{ fontSize: '13px', color: 'var(--muted)', paddingLeft: '20px', lineHeight: '1.8' }}>
                      <li>Abra o WhatsApp no seu celular</li>
                      <li>Vá em Dispositivos Conectados (Linked Devices)</li>
                      <li>Clique em Conectar um Dispositivo (Link a Device)</li>
                      <li>Aponte a câmera para o QR Code ao lado</li>
                    </ol>
                  </div>

                  {botStatus !== 'disconnected' && botStatus !== 'connecting' && (
                    <button 
                      className="btn-secondary" 
                      style={{ marginTop: '16px', color: 'var(--error)', borderColor: 'rgba(239, 68, 68, 0.2)', width: '100%', justifyContent: 'center' }}
                      onClick={handleDisconnectBot}
                      disabled={refreshingBot}
                    >
                      <X size={16} />
                      <span>Desconectar WhatsApp</span>
                    </button>
                  )}
                </div>

                <div style={{ flex: 1, display: 'flex', justifyContent: 'center', alignItems: 'center' }} className="card-premium">
                  {botStatus === 'connected' ? (
                    <div style={{ textAlign: 'center', padding: '40px' }}>
                      <Check size={64} style={{ color: 'var(--success)', marginBottom: '16px' }} />
                      <h4 style={{ fontSize: '20px', color: 'var(--success)' }}>Bot Ativo & Operacional</h4>
                      <p style={{ color: 'var(--muted)', fontSize: '14px', marginTop: '8px' }}>O bot está respondendo e agendando mensagens no WhatsApp.</p>
                    </div>
                  ) : botStatus === 'qr_ready' && botQr ? (
                    <div style={{ textAlign: 'center', padding: '10px' }}>
                      <h4 style={{ fontSize: '16px', marginBottom: '16px' }}>Escaneie o QR Code abaixo:</h4>
                      <div style={{ background: '#ffffff', padding: '16px', borderRadius: '12px', display: 'inline-block', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}>
                        <img 
                          src={`https://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent(botQr)}&size=240x240`} 
                          alt="WhatsApp Connection QR Code"
                          style={{ display: 'block' }}
                        />
                      </div>
                      <p style={{ fontSize: '12px', color: 'var(--muted)', marginTop: '16px' }}>O QR code atualiza a cada poucos minutos.</p>
                    </div>
                  ) : (
                    <div style={{ textAlign: 'center', padding: '40px', color: 'var(--muted)' }}>
                      <RefreshCw size={48} className="animate-spin" style={{ marginBottom: '16px', opacity: '0.5' }} />
                      <h4>Inicializando WhatsApp Web Engine...</h4>
                      <p style={{ fontSize: '13px', marginTop: '8px' }}>Isso pode levar alguns segundos. Se demorar, clique em "Atualizar Status".</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* TAB 4.5: WHATSAPP BOT CHATS */}
          {activeTab === 'chats' && (user?.role === 'owner' || user?.role === 'admin' || user?.role === 'barber') && (
            <div className="animate-fade-in dashboard-chats-tab-wrapper">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <h2 style={{ fontSize: '24px' }}>Painel de Atendimento Humano</h2>
                  <p style={{ color: 'var(--muted)', fontSize: '14px' }}>Monitore conversas ativas do bot, pause para interagir pessoalmente ou encerre sessões</p>
                </div>
                <button className="btn-secondary" onClick={fetchActiveChats} disabled={loadingChats}>
                  <RefreshCw size={16} className={loadingChats ? 'animate-spin' : ''} />
                  <span>Atualizar Conversas</span>
                </button>
              </div>

              <div className={`dashboard-chats-split-container ${selectedChat ? 'chat-selected' : ''}`}>
                {/* Left Side: Chats List */}
                <div className="card-premium dashboard-chats-sidebar">
                  <div style={{ display: 'flex', borderBottom: '1px solid rgba(255,255,255,0.08)', marginBottom: '14px', paddingBottom: '2px', gap: '8px' }}>
                    <button 
                      onClick={() => setChatsFilter('active')}
                      style={{
                        flex: 1,
                        background: 'none',
                        border: 'none',
                        color: chatsFilter === 'active' ? 'var(--primary)' : 'var(--muted)',
                        borderBottom: chatsFilter === 'active' ? '2px solid var(--primary)' : '2px solid transparent',
                        padding: '8px 4px',
                        fontSize: '13px',
                        fontWeight: chatsFilter === 'active' ? '600' : 'normal',
                        cursor: 'pointer',
                        transition: 'all 0.2s'
                      }}
                    >
                      Em Andamento ({activeChats.filter(c => c.state !== 'IDLE').length})
                    </button>
                    <button 
                      onClick={() => setChatsFilter('closed')}
                      style={{
                        flex: 1,
                        background: 'none',
                        border: 'none',
                        color: chatsFilter === 'closed' ? 'var(--primary)' : 'var(--muted)',
                        borderBottom: chatsFilter === 'closed' ? '2px solid var(--primary)' : '2px solid transparent',
                        padding: '8px 4px',
                        fontSize: '13px',
                        fontWeight: chatsFilter === 'closed' ? '600' : 'normal',
                        cursor: 'pointer',
                        transition: 'all 0.2s'
                      }}
                    >
                      Encerradas ({activeChats.filter(c => c.state === 'IDLE').length})
                    </button>
                  </div>

                  {loadingChats && activeChats.length === 0 ? (
                    <div style={{ flex: 1, display: 'flex', justifyContent: 'center', alignItems: 'center', color: 'var(--muted)' }}>
                      <RefreshCw size={24} className="animate-spin" />
                    </div>
                  ) : activeChats.filter(c => chatsFilter === 'active' ? c.state !== 'IDLE' : c.state === 'IDLE').length === 0 ? (
                    <div style={{ flex: 1, display: 'flex', justifyContent: 'center', alignItems: 'center', color: 'var(--muted)', textAlign: 'center', padding: '20px', fontSize: '13px' }}>
                      {chatsFilter === 'active' ? 'Nenhuma conversa em andamento.' : 'Nenhuma conversa encerrada.'}
                    </div>
                  ) : (
                    <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                      {activeChats
                        .filter(chat => chatsFilter === 'active' ? chat.state !== 'IDLE' : chat.state === 'IDLE')
                        .map((chat) => (
                        <div 
                          key={chat.phone} 
                          className="chat-item" 
                          style={{
                            padding: '12px',
                            borderRadius: '8px',
                            background: selectedChat?.phone === chat.phone ? 'rgba(212, 175, 55, 0.08)' : 'rgba(255,255,255,0.02)',
                            border: selectedChat?.phone === chat.phone ? '1px solid var(--primary)' : '1px solid rgba(255,255,255,0.05)',
                            cursor: 'pointer',
                            transition: 'all 0.2s ease-in-out',
                            display: 'flex',
                            gap: '12px',
                            alignItems: 'center'
                          }}
                          onClick={() => {
                            setSelectedChat(chat);
                            setLocalChatMessages(chat.messages || []);
                          }}
                        >
                          {/* Avatar do cliente */}
                          <div style={{ position: 'relative', flexShrink: 0 }}>
                            {chat.profilePictureUrl && chat.profilePictureUrl !== 'no-pic' ? (
                              <img 
                                src={chat.profilePictureUrl} 
                                alt={chat.clientPushName} 
                                style={{ width: '40px', height: '40px', borderRadius: '50%', objectFit: 'cover', border: '2px solid var(--primary)' }}
                              />
                            ) : (
                              <div style={{ 
                                width: '40px', 
                                height: '40px', 
                                borderRadius: '50%', 
                                background: 'linear-gradient(135deg, var(--primary) 0%, #1e1e24 100%)', 
                                color: '#ffffff', 
                                display: 'flex', 
                                alignItems: 'center', 
                                justifyContent: 'center', 
                                fontWeight: 'bold', 
                                fontSize: '14px',
                                border: '2px solid rgba(212, 175, 55, 0.2)'
                              }}>
                                {chat.clientPushName.substring(0, 2).toUpperCase()}
                              </div>
                            )}
                          </div>

                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2px' }}>
                              <span style={{ fontWeight: '600', fontSize: '14px', color: 'var(--foreground)', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>
                                {chat.clientPushName}
                              </span>
                              <span style={{ 
                                fontSize: '10px', 
                                padding: '2px 6px', 
                                borderRadius: '4px',
                                fontWeight: '600',
                                backgroundColor: chat.state === 'PAUSED' ? 'rgba(239, 68, 68, 0.1)' : chat.state === 'ACTIVE' ? 'rgba(34, 197, 94, 0.1)' : 'rgba(156, 163, 175, 0.1)',
                                color: chat.state === 'PAUSED' ? '#ef4444' : chat.state === 'ACTIVE' ? '#22c55e' : '#9ca3af'
                              }}>
                                {chat.state === 'PAUSED' ? 'Pausado' : chat.state === 'ACTIVE' ? 'Bot' : 'IDLE'}
                              </span>
                            </div>
                            <div style={{ fontSize: '12px', color: 'var(--muted)' }}>
                              {chat.phone}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Right Side: Chat Panel */}
                <div className="dashboard-chat-conversation-wrapper">
                  {selectedChat ? (
                    <div className="card-premium" style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '20px', gap: '20px', minHeight: 0 }}>
                      
                      {/* Header */}
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: '16px', flexWrap: 'wrap', gap: '16px' }}>
                        <div>
                          <div style={{ display: 'flex', gap: '14px', alignItems: 'center', marginBottom: '8px' }}>
                            <button 
                              className="btn-secondary mobile-only-btn" 
                              style={{ padding: '6px 12px', fontSize: '12px', display: 'none', alignItems: 'center', gap: '4px' }} 
                              onClick={() => setSelectedChat(null)}
                            >
                              ← Voltar
                            </button>
                            
                            {/* Foto do perfil do cabeçalho */}
                            {selectedChat.profilePictureUrl && selectedChat.profilePictureUrl !== 'no-pic' ? (
                              <img 
                                src={selectedChat.profilePictureUrl} 
                                alt={selectedChat.clientPushName} 
                                style={{ width: '48px', height: '48px', borderRadius: '50%', objectFit: 'cover', border: '2px solid var(--primary)', boxShadow: '0 4px 12px rgba(212, 175, 55, 0.15)' }}
                              />
                            ) : (
                              <div style={{ 
                                width: '48px', 
                                height: '48px', 
                                borderRadius: '50%', 
                                background: 'linear-gradient(135deg, var(--primary) 0%, #1e1e24 100%)', 
                                color: '#ffffff', 
                                display: 'flex', 
                                alignItems: 'center', 
                                justifyContent: 'center', 
                                fontWeight: 'bold', 
                                fontSize: '16px',
                                border: '2px solid rgba(212, 175, 55, 0.2)',
                                boxShadow: '0 4px 12px rgba(0,0,0,0.2)'
                              }}>
                                {selectedChat.clientPushName.substring(0, 2).toUpperCase()}
                              </div>
                            )}

                            <div>
                              <h3 style={{ fontSize: '18px', fontWeight: 'bold', margin: 0 }}>{selectedChat.clientPushName}</h3>
                              <p style={{ fontSize: '13px', color: 'var(--muted)', marginTop: '2px', margin: 0 }}>{selectedChat.phone}</p>
                            </div>
                          </div>

                          <div style={{ display: 'flex', gap: '12px', marginTop: '8px', fontSize: '12px', flexWrap: 'wrap' }}>
                            {selectedChat.selectedBarberName && (
                              <span style={{ background: 'rgba(255,255,255,0.04)', padding: '2px 8px', borderRadius: '4px' }}>
                                💈 {selectedChat.selectedBarberName}
                              </span>
                            )}
                            {selectedChat.selectedDateLabel && (
                              <span style={{ background: 'rgba(255,255,255,0.04)', padding: '2px 8px', borderRadius: '4px' }}>
                                📅 {selectedChat.selectedDateLabel}
                              </span>
                            )}
                            {selectedChat.selectedSlotISO && (
                              <span style={{ background: 'rgba(255,255,255,0.04)', padding: '2px 8px', borderRadius: '4px' }}>
                                ⏰ {new Date(selectedChat.selectedSlotISO).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                              </span>
                            )}
                          </div>
                        </div>

                        <div style={{ display: 'flex', gap: '10px' }}>
                          {selectedChat.state === 'PAUSED' ? (
                            <button 
                              className="btn-primary" 
                              style={{ padding: '8px 12px', fontSize: '13px' }}
                              onClick={() => handleResumeChatBot(selectedChat.phone)}
                            >
                              <span>Ativar Bot</span>
                            </button>
                          ) : (
                            <button 
                              className="btn-secondary" 
                              style={{ padding: '8px 12px', fontSize: '13px', borderColor: 'rgba(239, 68, 68, 0.2)' }}
                              onClick={() => handlePauseChatBot(selectedChat.phone)}
                            >
                              <span>Pausar Bot</span>
                            </button>
                          )}
                          <button 
                            className="btn-secondary" 
                            style={{ padding: '8px 12px', fontSize: '13px', color: 'var(--error)', borderColor: 'rgba(239, 68, 68, 0.2)' }}
                            onClick={() => handleTerminateChatSession(selectedChat.phone)}
                          >
                            <span>Encerrar Sessão</span>
                          </button>
                        </div>
                      </div>

                      {/* Chat Messages */}
                      <div style={{ flex: 1, overflowY: 'auto', background: 'rgba(0,0,0,0.15)', borderRadius: '8px', padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                        <div style={{ alignSelf: 'center', backgroundColor: 'rgba(212,175,55,0.08)', border: '1px solid rgba(212,175,55,0.15)', color: 'var(--primary)', padding: '6px 12px', borderRadius: '6px', fontSize: '12px', textAlign: 'center', maxWidth: '80%' }}>
                          {selectedChat.state === 'PAUSED' 
                            ? 'O bot está pausado. Você pode enviar mensagens livremente sem interferência.'
                            : 'O bot está controlando esta conversa. Enviar uma mensagem aqui pausará o bot automaticamente.'}
                        </div>

                        {localChatMessages.map((msg, index) => (
                          <div 
                            key={index} 
                            style={{
                              alignSelf: msg.fromMe ? 'flex-end' : 'flex-start',
                              backgroundColor: msg.fromMe ? 'var(--primary)' : 'rgba(255,255,255,0.06)',
                              color: msg.fromMe ? '#000000' : 'var(--foreground)',
                              padding: '10px 14px',
                              borderRadius: msg.fromMe ? '12px 12px 0 12px' : '12px 12px 12px 0',
                              maxWidth: '70%',
                              wordBreak: 'break-word',
                              fontSize: '14px',
                              boxShadow: '0 2px 4px rgba(0,0,0,0.05)'
                            }}
                          >
                            <div>
                              <div>{msg.text}</div>
                              {(msg as any).isPoll && (msg as any).pollOptions && (msg as any).pollOptions.length > 0 && (
                                <div style={{ marginTop: '8px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                  {(msg as any).pollOptions.map((opt: string, i: number) => (
                                    <div 
                                      key={i} 
                                      style={{ 
                                        padding: '6px 10px', 
                                        background: 'rgba(255,255,255,0.08)', 
                                        borderRadius: '6px', 
                                        fontSize: '12px',
                                        color: 'var(--foreground)',
                                        border: '1px solid rgba(255,255,255,0.1)',
                                        textAlign: 'left'
                                      }}
                                    >
                                      🔘 {opt}
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                            <div style={{ 
                              fontSize: '10px', 
                              textAlign: 'right', 
                              marginTop: '4px', 
                              opacity: '0.6',
                              color: msg.fromMe ? '#000000' : 'var(--muted)'
                            }}>
                              {msg.time}
                            </div>
                          </div>
                        ))}
                      </div>

                      {/* Message Input */}
                      <form 
                        onSubmit={handleSendManualMessage} 
                        style={{ display: 'flex', gap: '10px', alignItems: 'center' }}
                      >
                        <input 
                          type="text" 
                          placeholder="Digite uma mensagem para o cliente..." 
                          className="form-input" 
                          value={manualMessageInput}
                          onChange={(e) => setManualMessageInput(e.target.value)}
                          style={{ flex: 1, margin: 0 }}
                          required
                        />
                        <button type="submit" className="btn-primary" style={{ padding: '10px 20px', whiteSpace: 'nowrap' }}>
                          <span>Enviar</span>
                        </button>
                      </form>

                    </div>
                  ) : (
                    <div className="card-premium" style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', color: 'var(--muted)', textAlign: 'center', padding: '40px' }}>
                      <MessageSquare size={48} style={{ marginBottom: '16px', opacity: 0.3 }} />
                      <h4 style={{ fontSize: '18px', fontWeight: 'bold', color: 'var(--foreground)' }}>Selecione um Chat</h4>
                      <p style={{ fontSize: '14px', marginTop: '8px', maxWidth: '300px' }}>Clique em uma conversa na lista para acompanhar o status e interagir diretamente.</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* TAB 5: ESTABLISHMENT CONFIG */}
          {activeTab === 'settings' && (user?.role === 'owner' || user?.role === 'admin') && (
            <div className="animate-fade-in" style={{ maxWidth: '900px' }}>
              <h2 style={{ fontSize: '24px', marginBottom: '8px' }}>Configurações da Barbearia</h2>
              <p style={{ color: 'var(--muted)', fontSize: '14px', marginBottom: '24px' }}>Configure o horário, a paleta de cores e detalhes visuais do estabelecimento</p>

              <form onSubmit={handleSaveSettings} style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
                
                {/* General config */}
                <div className="card-premium">
                  <h3 style={{ fontSize: '18px', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Settings size={18} style={{ color: 'var(--primary)' }} />
                    Configurações Gerais
                  </h3>

                  <div className="form-group" style={{ background: 'rgba(255,255,255,0.02)', padding: '16px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.05)', marginBottom: '20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div>
                      <label className="form-label" style={{ margin: 0, fontWeight: 'bold', fontSize: '15px' }}>Chatbot WhatsApp Automático</label>
                      <p style={{ color: 'var(--muted)', fontSize: '12px', margin: '4px 0 0 0' }}>
                        Quando ativado, o bot responderá automaticamente agendamentos e contatos recebidos.
                      </p>
                    </div>
                    <label style={{ position: 'relative', display: 'inline-block', width: '50px', height: '26px', cursor: 'pointer' }}>
                      <input 
                        type="checkbox" 
                        checked={botActive}
                        onChange={(e) => setBotActive(e.target.checked)}
                        style={{ opacity: 0, width: 0, height: 0 }}
                      />
                      <span style={{ 
                        position: 'absolute', 
                        top: 0, 
                        left: 0, 
                        right: 0, 
                        bottom: 0, 
                        backgroundColor: botActive ? 'var(--primary)' : 'rgba(255,255,255,0.1)', 
                        transition: '0.4s', 
                        borderRadius: '34px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: botActive ? 'flex-end' : 'flex-start',
                        padding: '3px'
                      }}>
                        <span style={{ 
                          width: '20px', 
                          height: '20px', 
                          borderRadius: '50%', 
                          backgroundColor: botActive ? '#121212' : '#ffffff', 
                          transition: '0.4s',
                          display: 'block'
                        }} />
                      </span>
                    </label>
                  </div>

                  <div className="form-group">
                    <label className="form-label">Nome do Estabelecimento</label>
                    <input type="text" className="form-input" value={shopName} onChange={(e) => setShopName(e.target.value)} required />
                  </div>

                  <div className="form-group">
                    <label className="form-label">Logo da Barbearia (PNG/JPG - Máx. 500KB)</label>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginTop: '4px' }}>
                      {logoUrl && (
                        <img 
                          src={logoUrl} 
                          alt="Logo Preview" 
                          style={{ width: '48px', height: '48px', borderRadius: '50%', objectFit: 'cover', border: '2px solid var(--primary)' }} 
                        />
                      )}
                      <div style={{ flex: 1 }}>
                        <input 
                          type="file" 
                          accept="image/png, image/jpeg, image/jpg" 
                          className="form-input" 
                          style={{ padding: '6px 10px', height: 'auto', display: 'block', margin: 0 }} 
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) handleImageUpload(file, setLogoUrl);
                          }} 
                        />
                      </div>
                    </div>
                  </div>

                  <div className="form-group">
                    <label className="form-label">Endereço da Barbearia</label>
                    <input type="text" className="form-input" placeholder="Ex: Av. Principal, 123 - Centro" value={shopAddress} onChange={(e) => setShopAddress(e.target.value)} />
                  </div>

                  <div className="form-group">
                    <label className="form-label">Biografia / Filosofia da Barbearia</label>
                    <textarea className="form-input" placeholder="Escreva sobre a filosofia ou história da sua barbearia..." value={shopBio} onChange={(e) => setShopBio(e.target.value)} style={{ minHeight: '80px', resize: 'vertical' }} />
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                    <div className="form-group">
                      <label className="form-label">Horário de Abertura</label>
                      <input type="time" className="form-input" value={openTime} onChange={(e) => setOpenTime(e.target.value)} required />
                    </div>
                    <div className="form-group">
                      <label className="form-label">Horário de Fechamento</label>
                      <input type="time" className="form-input" value={closeTime} onChange={(e) => setCloseTime(e.target.value)} required />
                    </div>
                  </div>

                  <div className="form-group">
                    <label className="form-label">Duração do Atendimento (Minutos)</label>
                    <select 
                      className="form-input" 
                      value={slotDuration} 
                      onChange={(e) => setSlotDuration(parseInt(e.target.value, 10))}
                    >
                      <option value={15}>15 minutos</option>
                      <option value={30}>30 minutos</option>
                      <option value={45}>45 minutos</option>
                      <option value={60}>60 minutos (1 hora)</option>
                    </select>
                  </div>

                  <div style={{ marginTop: '20px', padding: '16px', background: 'rgba(212,175,55,0.05)', border: '1px solid rgba(212,175,55,0.15)', borderRadius: '8px' }}>
                    <label className="form-label" style={{ color: 'var(--primary)', fontWeight: 'bold', display: 'block', marginBottom: '8px' }}>🔗 Link do Web App de Agendamento</label>
                    <p style={{ fontSize: '13px', color: 'var(--muted)', marginBottom: '10px', lineHeight: '1.4' }}>
                      Seus clientes podem acessar este link do celular ou computador para agendar pelo navegador, com visualização da tabela de horários livres:
                    </p>
                    <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                      <input 
                        type="text" 
                        className="form-input" 
                        readOnly 
                        value={`http://localhost:5173/book/${user?.establishment_slug || 'classica'}`} 
                        style={{ fontFamily: 'monospace', fontSize: '13px', background: 'rgba(0,0,0,0.2)', flex: 1 }} 
                      />
                      <a 
                        href={`http://localhost:5173/book/${user?.establishment_slug || 'classica'}`} 
                        target="_blank" 
                        rel="noopener noreferrer" 
                        className="btn-primary" 
                        style={{ padding: '10px 14px', textDecoration: 'none', fontSize: '13px', whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'center', gap: '6px' }}
                      >
                        <span>Testar Web App</span>
                        <ArrowRight size={14} />
                      </a>
                    </div>
                  </div>
                </div>

                {/* Color customizer */}
                <div className="card-premium">
                  <h3 style={{ fontSize: '18px', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Palette size={18} style={{ color: 'var(--primary)' }} />
                    Paleta de Cores & Customização
                  </h3>

                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '16px' }}>
                    <div className="form-group">
                      <label className="form-label">Cor Primária (Destaques)</label>
                      <div style={{ display: 'flex', gap: '8px' }}>
                        <input type="color" style={{ width: '40px', height: '40px', border: 'none', cursor: 'pointer', borderRadius: '4px' }} value={primaryColor} onChange={(e) => setPrimaryColor(e.target.value)} />
                        <input type="text" className="form-input" style={{ flex: 1, padding: '8px' }} value={primaryColor} onChange={(e) => setPrimaryColor(e.target.value)} />
                      </div>
                    </div>

                    <div className="form-group">
                      <label className="form-label">Cor Secundária (Layout)</label>
                      <div style={{ display: 'flex', gap: '8px' }}>
                        <input type="color" style={{ width: '40px', height: '40px', border: 'none', cursor: 'pointer', borderRadius: '4px' }} value={secondaryColor} onChange={(e) => setSecondaryColor(e.target.value)} />
                        <input type="text" className="form-input" style={{ flex: 1, padding: '8px' }} value={secondaryColor} onChange={(e) => setSecondaryColor(e.target.value)} />
                      </div>
                    </div>

                    <div className="form-group">
                      <label className="form-label">Cor de Fundo</label>
                      <div style={{ display: 'flex', gap: '8px' }}>
                        <input type="color" style={{ width: '40px', height: '40px', border: 'none', cursor: 'pointer', borderRadius: '4px' }} value={bgColor} onChange={(e) => setBgColor(e.target.value)} />
                        <input type="text" className="form-input" style={{ flex: 1, padding: '8px' }} value={bgColor} onChange={(e) => setBgColor(e.target.value)} />
                      </div>
                    </div>

                    <div className="form-group">
                      <label className="form-label">Cor dos Textos</label>
                      <div style={{ display: 'flex', gap: '8px' }}>
                        <input type="color" style={{ width: '40px', height: '40px', border: 'none', cursor: 'pointer', borderRadius: '4px' }} value={textColor} onChange={(e) => setTextColor(e.target.value)} />
                        <input type="text" className="form-input" style={{ flex: 1, padding: '8px' }} value={textColor} onChange={(e) => setTextColor(e.target.value)} />
                      </div>
                    </div>
                  </div>
                </div>

                {/* Galeria de Fotos */}
                <div className="card-premium">
                  <h3 style={{ fontSize: '18px', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Palette size={18} style={{ color: 'var(--primary)' }} />
                    Fotos da Barbearia (Galeria / Carrossel)
                  </h3>
                  <p style={{ color: 'var(--muted)', fontSize: '13px', marginBottom: '16px', lineHeight: '1.4' }}>
                    Selecione arquivos de imagens do seu salão (fachada, cadeiras, recepção). Elas serão convertidas e salvas diretamente no banco de dados para o carrossel dos clientes.
                  </p>

                  <div className="form-group" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <label className="form-label" style={{ fontSize: '12px', color: 'var(--muted)' }}>Adicionar Nova Foto (PNG/JPG - Máx. 800KB)</label>
                    <input 
                      type="file" 
                      accept="image/*"
                      className="form-input"
                      style={{ padding: '8px', cursor: 'pointer' }}
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) {
                          if (file.size > 800 * 1024) {
                            showToast('A imagem deve ter no máximo 800KB para evitar sobrecarga no banco.', 'error');
                            return;
                          }
                          const reader = new FileReader();
                          reader.onloadend = () => {
                            const base64String = reader.result as string;
                            setShopPhotos([...shopPhotos, base64String]);
                            showToast('Imagem carregada com sucesso! Lembre-se de clicar em "Salvar Alterações" no final da página.');
                          };
                          reader.readAsDataURL(file);
                        }
                        e.target.value = ''; // Reset input to allow selecting same file again
                      }}
                    />
                  </div>

                  {shopPhotos.length === 0 ? (
                    <p style={{ color: 'var(--muted)', fontSize: '13px', fontStyle: 'italic', textAlign: 'center', padding: '20px' }}>
                      Nenhuma imagem cadastrada. Adicione links de imagens acima.
                    </p>
                  ) : (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: '16px', marginTop: '16px' }}>
                      {shopPhotos.map((photo, index) => (
                        <div key={index} style={{ position: 'relative', borderRadius: '8px', overflow: 'hidden', height: '100px', border: '1px solid rgba(255,255,255,0.08)' }}>
                          <img 
                            src={photo} 
                            alt={`Salão ${index + 1}`} 
                            style={{ width: '100%', height: '100%', objectFit: 'cover' }} 
                            onError={(e) => {
                              e.currentTarget.src = 'https://images.unsplash.com/photo-1503951914875-452162b0f3f1?q=80&w=200'; // fallback
                            }}
                          />
                          <button
                            type="button"
                            style={{ position: 'absolute', top: '4px', right: '4px', background: 'rgba(239, 68, 68, 0.9)', color: '#ffffff', border: 'none', borderRadius: '4px', padding: '4px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                            onClick={() => {
                              const updatedPhotos = shopPhotos.filter((_, idx) => idx !== index);
                              setShopPhotos(updatedPhotos);
                              showToast('Foto removida. Lembre-se de salvar as alterações.');
                            }}
                          >
                            <Trash2 size={12} />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <button type="submit" className="btn-primary" style={{ alignSelf: 'flex-end' }}>
                  <span>Salvar Alterações</span>
                </button>
              </form>
            </div>
          )}

          {/* TAB: SUPER ADMIN */}
          {activeTab === 'super_admin' && user?.role === 'admin' && (
            <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px' }}>
                <div>
                  <h2 style={{ fontSize: '24px', marginBottom: '8px' }}>Painel do Super Administrador</h2>
                  <p style={{ color: 'var(--muted)', fontSize: '14px' }}>Gerencie de forma global todos os usuários, sessões de WhatsApp e saúde do ecossistema.</p>
                </div>
                <button className="btn-secondary" onClick={loadSuperAdminData} disabled={loadingSuper}>
                  <RefreshCw size={16} className={loadingSuper ? 'spin' : ''} />
                  <span>Atualizar Dados</span>
                </button>
              </div>

              {/* Sugestões de Gestão (Super Admin Suggestion Area) */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '16px' }}>
                <div className="card-premium" style={{ borderLeft: '4px solid var(--primary)', padding: '16px' }}>
                  <h4 style={{ color: 'var(--primary)', fontSize: '15px', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <TrendingUp size={16} />
                    Incentivo de Receita
                  </h4>
                  <p style={{ fontSize: '13px', color: 'var(--muted)', lineHeight: '1.4' }}>
                    Sugerimos orientar as barbearias parceiras com baixo faturamento a criarem pacotes de serviços no <strong>Clube de Assinaturas</strong>, maximizando a previsibilidade financeira mensal.
                  </p>
                </div>
                <div className="card-premium" style={{ borderLeft: '4px solid #ef4444', padding: '16px' }}>
                  <h4 style={{ color: '#ef4444', fontSize: '15px', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <MessageSquare size={16} />
                    Sessões Desconectadas
                  </h4>
                  <p style={{ fontSize: '13px', color: 'var(--muted)', lineHeight: '1.4' }}>
                    As conexões instáveis do WhatsApp de alguns estabelecimentos sugerem a necessidade de atualizar o Baileys ou alertá-los para realizarem novo login via QR Code.
                  </p>
                </div>
                <div className="card-premium" style={{ borderLeft: '4px solid #3b82f6', padding: '16px' }}>
                  <h4 style={{ color: '#3b82f6', fontSize: '15px', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Shield size={16} />
                    Segurança do Sistema
                  </h4>
                  <p style={{ fontSize: '13px', color: 'var(--muted)', lineHeight: '1.4' }}>
                    Lembrete: Como super admin, você pode alterar senhas administrativamente. Recomende sempre o uso de senhas seguras com caracteres especiais.
                  </p>
                </div>
              </div>

              {/* Cadastrar Nova Barbearia */}
              <div className="card-premium" style={{ padding: '24px' }}>
                <h3 style={{ fontSize: '18px', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Plus size={18} style={{ color: 'var(--primary)' }} />
                  Cadastrar Nova Barbearia & Proprietário
                </h3>
                <p style={{ color: 'var(--muted)', fontSize: '13px', marginBottom: '20px' }}>
                  Crie um novo estabelecimento no ecossistema. O proprietário cadastrado poderá logar e finalizar as configurações (serviços, profissionais e horários).
                </p>

                <form onSubmit={handleCreateEstablishment} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '16px', alignItems: 'end' }}>
                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label className="form-label">Nome da Barbearia</label>
                    <input 
                      type="text" 
                      className="form-input" 
                      placeholder="Ex: Barbearia do Gabriel"
                      value={superNewEstName}
                      onChange={(e) => {
                        setSuperNewEstName(e.target.value);
                        setSuperNewEstSlug(e.target.value.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, ''));
                      }}
                      required
                    />
                  </div>

                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label className="form-label">Slug de URL (Sem espaços/acentos)</label>
                    <input 
                      type="text" 
                      className="form-input" 
                      placeholder="Ex: barbearia-gabriel"
                      value={superNewEstSlug}
                      onChange={(e) => setSuperNewEstSlug(e.target.value.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, ''))}
                      required
                    />
                  </div>

                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label className="form-label">Nome do Proprietário</label>
                    <input 
                      type="text" 
                      className="form-input" 
                      placeholder="Ex: Gabriel Silva"
                      value={superNewOwnerName}
                      onChange={(e) => setSuperNewOwnerName(e.target.value)}
                      required
                    />
                  </div>

                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label className="form-label">E-mail do Proprietário</label>
                    <input 
                      type="email" 
                      className="form-input" 
                      placeholder="Ex: gabriel@email.com"
                      value={superNewOwnerEmail}
                      onChange={(e) => setSuperNewOwnerEmail(e.target.value)}
                      required
                    />
                  </div>

                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label className="form-label">Celular do Proprietário (WhatsApp)</label>
                    <input 
                      type="text" 
                      className="form-input" 
                      placeholder="Ex: 34995880392"
                      value={superNewOwnerPhone}
                      onChange={(e) => setSuperNewOwnerPhone(e.target.value)}
                      required
                    />
                  </div>

                  <div style={{ gridColumn: '1 / -1', display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '8px' }}>
                    {superCreateEstError && (
                      <div style={{ color: '#ef4444', fontSize: '13px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span>⚠️ {superCreateEstError}</span>
                      </div>
                    )}
                    {superCreateEstSuccess && (
                      <div style={{ color: '#10b981', fontSize: '13px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span>✅ {superCreateEstSuccess}</span>
                      </div>
                    )}
                    
                    <button 
                      type="submit" 
                      className="btn-primary" 
                      style={{ alignSelf: 'flex-end', minWidth: '180px' }}
                      disabled={superCreateEstLoading}
                    >
                      {superCreateEstLoading ? 'Cadastrando...' : 'Cadastrar Barbearia'}
                    </button>
                  </div>
                </form>
              </div>

              {/* Seção WhatsApp e Usuários */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '24px' }}>
                {/* Sessões WhatsApp */}
                <div className="card-premium">
                  <h3 style={{ fontSize: '18px', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <MessageSquare size={18} style={{ color: 'var(--primary)' }} />
                    Sessões de WhatsApp Ativas
                  </h3>
                  {loadingSuper ? (
                    <p style={{ color: 'var(--muted)' }}>Carregando sessões...</p>
                  ) : superSessions.length === 0 ? (
                    <p style={{ color: 'var(--muted)' }}>Nenhum estabelecimento cadastrado.</p>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                      {superSessions.map((session) => (
                        <div key={session.establishment_id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px', background: 'rgba(255,255,255,0.02)', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.05)' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                            {session.logo_url ? (
                              <img src={session.logo_url} style={{ width: '36px', height: '36px', borderRadius: '50%', objectFit: 'cover' }} />
                            ) : (
                              <div style={{ width: '36px', height: '36px', borderRadius: '50%', background: 'var(--primary)', display: 'flex', justifyContent: 'center', alignItems: 'center', color: '#121212', fontWeight: 'bold', fontSize: '14px' }}>
                                {session.establishment_name[0]}
                              </div>
                            )}
                            <div>
                              <div style={{ fontSize: '14px', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                {session.establishment_name}
                                {session.establishment_id !== '00000000-0000-0000-0000-000000000000' && (
                                  <span style={{ 
                                    fontSize: '10px', 
                                    padding: '2px 6px', 
                                    borderRadius: '4px', 
                                    background: session.is_active ? 'rgba(16,185,129,0.1)' : 'rgba(239,68,68,0.1)', 
                                    color: session.is_active ? '#10b981' : '#ef4444',
                                    border: `1px solid ${session.is_active ? 'rgba(16,185,129,0.2)' : 'rgba(239,68,68,0.2)'}`
                                  }}>
                                    {session.is_active ? 'Ativo' : 'Bloqueado'}
                                  </span>
                                )}
                              </div>
                              <div style={{ fontSize: '12px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                                <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: session.status === 'CONNECTED' ? '#10b981' : '#ef4444', display: 'inline-block' }} />
                                <span style={{ color: session.status === 'CONNECTED' ? '#10b981' : 'var(--muted)' }}>
                                  {session.status === 'CONNECTED' ? `Conectado (${session.phone || 'Sem número'})` : 'Desconectado'}
                                </span>
                              </div>

                              {session.establishment_id !== '00000000-0000-0000-0000-000000000000' && session.expires_at && (() => {
                                const expiresAt = new Date(session.expires_at);
                                const isExpired = expiresAt < new Date();
                                const diffTime = expiresAt.getTime() - new Date().getTime();
                                const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
                                
                                return (
                                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginTop: '6px' }}>
                                    <div style={{ fontSize: '11px', color: isExpired ? '#ef4444' : 'rgba(255,255,255,0.6)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                      <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: isExpired ? '#ef4444' : '#10b981' }} />
                                      <span>
                                        {isExpired 
                                          ? `Licença Expirada (${expiresAt.toLocaleDateString('pt-BR')})` 
                                          : `Licença ativa: ${diffDays} dias (${expiresAt.toLocaleDateString('pt-BR')})`
                                        }
                                      </span>
                                    </div>
                                    <div style={{ display: 'flex', gap: '6px', marginTop: '2px' }}>
                                      <button 
                                        type="button" 
                                        style={{ padding: '2px 6px', fontSize: '9px', borderRadius: '4px', background: 'rgba(255,255,255,0.05)', color: 'var(--primary)', border: '1px solid rgba(212,175,55,0.2)', cursor: 'pointer' }}
                                        onClick={() => handleUpdateLicenseDays(session.establishment_id, 7)}
                                      >
                                        +7d
                                      </button>
                                      <button 
                                        type="button" 
                                        style={{ padding: '2px 6px', fontSize: '9px', borderRadius: '4px', background: 'rgba(255,255,255,0.05)', color: 'var(--primary)', border: '1px solid rgba(212,175,55,0.2)', cursor: 'pointer' }}
                                        onClick={() => handleUpdateLicenseDays(session.establishment_id, 30)}
                                      >
                                        +30d
                                      </button>
                                      <button 
                                        type="button" 
                                        style={{ padding: '2px 6px', fontSize: '9px', borderRadius: '4px', background: 'rgba(239,68,68,0.05)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.2)', cursor: 'pointer' }}
                                        onClick={() => handleExpireLicense(session.establishment_id)}
                                      >
                                        Expirar
                                      </button>
                                    </div>
                                  </div>
                                );
                              })()}
                            </div>
                          </div>
                          <div style={{ display: 'flex', gap: '8px' }}>
                            {session.establishment_id !== '00000000-0000-0000-0000-000000000000' && (
                              <>
                                <button 
                                  className="btn-secondary" 
                                  style={{ 
                                    padding: '6px 12px', 
                                    fontSize: '12px', 
                                    borderColor: session.is_active ? 'rgba(239,68,68,0.3)' : 'rgba(16,185,129,0.3)', 
                                    color: session.is_active ? '#ef4444' : '#10b981' 
                                  }} 
                                  onClick={() => handleToggleEstablishmentStatus(session.establishment_id, session.is_active)}
                                >
                                  <span>{session.is_active ? 'Bloquear' : 'Desbloquear'}</span>
                                </button>

                                <button 
                                  className="btn-secondary" 
                                  style={{ 
                                    padding: '6px 8px', 
                                    fontSize: '12px', 
                                    borderColor: 'rgba(239,68,68,0.3)', 
                                    color: '#ef4444',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center'
                                  }} 
                                  onClick={() => handleDeleteEstablishment(session.establishment_id, session.establishment_name)}
                                  title="Excluir barbearia permanentemente"
                                >
                                  <Trash2 size={14} />
                                </button>
                              </>
                            )}
                            
                            {session.status === 'CONNECTED' ? (
                              <button className="btn-secondary" style={{ padding: '6px 12px', fontSize: '12px', borderColor: '#ef4444', color: '#ef4444' }} onClick={() => handleSuperLogoutWhatsApp(session.establishment_id)}>
                                <LogOut size={12} />
                                <span>Desconectar</span>
                              </button>
                            ) : (
                              <button className="btn-primary" style={{ padding: '6px 12px', fontSize: '12px' }} onClick={() => handleOpenConnectModal(session.establishment_id, session.establishment_name)}>
                                <MessageCircle size={12} />
                                <span>Conectar</span>
                              </button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Usuários do Sistema */}
                <div className="card-premium">
                  <h3 style={{ fontSize: '18px', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Users size={18} style={{ color: 'var(--primary)' }} />
                    Usuários do Sistema
                  </h3>
                  
                  {/* Busca */}
                  <div className="form-group" style={{ marginBottom: '16px' }}>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <input 
                        type="text" 
                        className="form-input" 
                        placeholder="Buscar por nome, email ou salão..." 
                        value={superSearchUser} 
                        onChange={(e) => setSuperSearchUser(e.target.value)} 
                      />
                    </div>
                  </div>

                  {loadingSuper ? (
                    <p style={{ color: 'var(--muted)' }}>Carregando usuários...</p>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', maxHeight: '400px', overflowY: 'auto', paddingRight: '4px' }}>
                      {superUsers
                        .filter(u => {
                          const query = superSearchUser.toLowerCase();
                          return u.name.toLowerCase().includes(query) || 
                                 u.email.toLowerCase().includes(query) || 
                                 (u.establishment_name && u.establishment_name.toLowerCase().includes(query));
                        })
                        .map((u) => (
                          <div key={u.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px', background: 'rgba(255,255,255,0.02)', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.05)' }}>
                            <div>
                              <div style={{ fontSize: '14px', fontWeight: 'bold' }}>{u.name}</div>
                              <div style={{ fontSize: '12px', color: 'var(--muted)', wordBreak: 'break-all' }}>{u.email}</div>
                              <div style={{ display: 'flex', gap: '6px', marginTop: '4px', flexWrap: 'wrap' }}>
                                <span style={{ fontSize: '10px', padding: '2px 6px', borderRadius: '4px', background: 'rgba(212,175,55,0.1)', color: 'var(--primary)', fontWeight: 'bold' }}>
                                  {u.role === 'admin' ? 'Super Admin' : u.role === 'owner' ? 'Dono' : 'Barbeiro'}
                                </span>
                                {u.establishment_name && (
                                  <span style={{ fontSize: '10px', padding: '2px 6px', borderRadius: '4px', background: 'rgba(255,255,255,0.05)', color: 'var(--foreground)' }}>
                                    {u.establishment_name}
                                  </span>
                                )}
                              </div>
                            </div>
                            <button 
                              className="btn-secondary" 
                              style={{ padding: '6px 10px', fontSize: '12px' }} 
                              onClick={() => {
                                setSuperSelectedUser(u);
                                setSuperNewPassword('');
                                setSuperChangePasswordModal(true);
                              }}
                            >
                              <Key size={12} />
                              <span>Senha</span>
                            </button>
                          </div>
                        ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Configuração de Comissões das Barbearias */}
              <div className="card-premium" style={{ marginTop: '8px' }}>
                <h3 style={{ fontSize: '18px', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <TrendingUp size={18} style={{ color: 'var(--primary)' }} />
                  Comissões de Barbearias Parceiras
                </h3>
                <p style={{ color: 'var(--muted)', fontSize: '13px', marginBottom: '20px' }}>
                  Defina a comissão padrão retida/paga por cada barbearia para o cálculo de divisão de lucros dos profissionais.
                </p>

                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', minWidth: '500px' }}>
                    <thead>
                      <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                        <th style={{ padding: '12px 8px', color: 'var(--muted)', fontSize: '12px', fontWeight: 'bold', textTransform: 'uppercase' }}>Barbearia</th>
                        <th style={{ padding: '12px 8px', color: 'var(--muted)', fontSize: '12px', fontWeight: 'bold', textTransform: 'uppercase', textAlign: 'center' }}>Comissão Atual</th>
                        <th style={{ padding: '12px 8px', color: 'var(--muted)', fontSize: '12px', fontWeight: 'bold', textTransform: 'uppercase', textAlign: 'right' }}>Ações</th>
                      </tr>
                    </thead>
                    <tbody>
                      {superSessions.map((session) => {
                        const isEditing = superEditingEstId === session.establishment_id;
                        return (
                          <tr key={session.establishment_id} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                            <td style={{ padding: '12px 8px', fontSize: '14px', display: 'flex', alignItems: 'center', gap: '10px' }}>
                              {session.logo_url ? (
                                <img src={session.logo_url} style={{ width: '28px', height: '28px', borderRadius: '50%', objectFit: 'cover' }} />
                              ) : (
                                <div style={{ width: '28px', height: '28px', borderRadius: '50%', background: 'var(--primary)', display: 'flex', justifyContent: 'center', alignItems: 'center', fontSize: '11px', fontWeight: 'bold', color: '#121212' }}>
                                  {session.establishment_name[0]}
                                </div>
                              )}
                              <span>{session.establishment_name}</span>
                            </td>
                            <td style={{ padding: '12px 8px', fontSize: '14px', textAlign: 'center', fontWeight: 'bold', color: 'var(--primary)' }}>
                              {isEditing ? (
                                <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '6px' }}>
                                  <input 
                                    type="number" 
                                    className="form-input" 
                                    style={{ width: '80px', padding: '4px 8px', textAlign: 'center' }} 
                                    min="0" 
                                    max="100"
                                    value={superNewCommission} 
                                    onChange={(e) => setSuperNewCommission(e.target.value)} 
                                  />
                                  <span>%</span>
                                </div>
                              ) : (
                                `${session.commission_percent !== undefined ? session.commission_percent : 50}%`
                              )}
                            </td>
                            <td style={{ padding: '12px 8px', fontSize: '14px', textAlign: 'right' }}>
                              {isEditing ? (
                                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                                  <button 
                                    className="btn-primary" 
                                    style={{ padding: '4px 10px', fontSize: '12px' }} 
                                    onClick={() => handleSuperSaveCommission(session.establishment_id, parseInt(superNewCommission, 10))}
                                  >
                                    Salvar
                                  </button>
                                  <button 
                                    className="btn-secondary" 
                                    style={{ padding: '4px 10px', fontSize: '12px' }} 
                                    onClick={() => {
                                      setSuperEditingEstId(null);
                                      setSuperNewCommission('');
                                    }}
                                  >
                                    Cancelar
                                  </button>
                                </div>
                              ) : (
                                <button 
                                  className="btn-secondary" 
                                  style={{ padding: '6px 12px', fontSize: '12px' }} 
                                  onClick={() => {
                                    setSuperEditingEstId(session.establishment_id);
                                    setSuperNewCommission(String(session.commission_percent !== undefined ? session.commission_percent : 50));
                                  }}
                                >
                                  Configurar Taxa
                                </button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Agenda de Contatos e Chat de Suporte */}
              <div className="card-premium" style={{ marginTop: '24px' }}>
                <h3 style={{ fontSize: '18px', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Users size={18} style={{ color: 'var(--primary)' }} />
                  Agenda de Contatos dos Parceiros (WhatsApp)
                </h3>
                <p style={{ color: 'var(--muted)', fontSize: '13px', marginBottom: '20px' }}>
                  Visualize os contatos de todos os donos e barbeiros cadastrados na plataforma BarberHub e envie mensagens rápidas de suporte via o WhatsApp central da plataforma.
                </p>

                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', minWidth: '700px' }}>
                    <thead>
                      <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                        <th style={{ padding: '12px 8px', color: 'var(--muted)', fontSize: '12px', fontWeight: 'bold', textTransform: 'uppercase' }}>Nome</th>
                        <th style={{ padding: '12px 8px', color: 'var(--muted)', fontSize: '12px', fontWeight: 'bold', textTransform: 'uppercase' }}>Email</th>
                        <th style={{ padding: '12px 8px', color: 'var(--muted)', fontSize: '12px', fontWeight: 'bold', textTransform: 'uppercase' }}>Telefone</th>
                        <th style={{ padding: '12px 8px', color: 'var(--muted)', fontSize: '12px', fontWeight: 'bold', textTransform: 'uppercase' }}>Cargo</th>
                        <th style={{ padding: '12px 8px', color: 'var(--muted)', fontSize: '12px', fontWeight: 'bold', textTransform: 'uppercase' }}>Barbearia</th>
                        <th style={{ padding: '12px 8px', color: 'var(--muted)', fontSize: '12px', fontWeight: 'bold', textTransform: 'uppercase', textAlign: 'right' }}>Ações</th>
                      </tr>
                    </thead>
                    <tbody>
                      {superUsers
                        .filter(u => u.role !== 'admin' && u.phone) // Mostra apenas parceiros que têm telefone cadastrado
                        .map((u) => (
                          <tr key={u.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                            <td style={{ padding: '12px 8px', fontSize: '14px', fontWeight: 'bold' }}>{u.name}</td>
                            <td style={{ padding: '12px 8px', fontSize: '13px', color: 'var(--muted)' }}>{u.email}</td>
                            <td style={{ padding: '12px 8px', fontSize: '13px' }}>{u.phone}</td>
                            <td style={{ padding: '12px 8px', fontSize: '13px' }}>
                              <span style={{ 
                                fontSize: '10px', 
                                padding: '2px 6px', 
                                borderRadius: '4px', 
                                background: u.role === 'owner' ? 'rgba(212,175,55,0.1)' : 'rgba(255,255,255,0.05)', 
                                color: u.role === 'owner' ? 'var(--primary)' : 'var(--foreground)',
                                fontWeight: 'bold'
                              }}>
                                {u.role === 'owner' ? 'Dono' : 'Barbeiro'}
                              </span>
                            </td>
                            <td style={{ padding: '12px 8px', fontSize: '13px', color: 'var(--muted)' }}>{u.establishment_name || '-'}</td>
                            <td style={{ padding: '12px 8px', fontSize: '14px', textAlign: 'right' }}>
                              <button 
                                className="btn-primary" 
                                style={{ padding: '6px 12px', fontSize: '12px', display: 'inline-flex', alignItems: 'center', gap: '6px' }}
                                onClick={() => {
                                  setSuperChatContact(u);
                                  setSuperChatMessage('');
                                  setSuperChatOpen(true);
                                }}
                              >
                                <MessageCircle size={12} />
                                <span>Conversar</span>
                              </button>
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* TAB: METRICS */}
          {activeTab === 'metrics' && (user?.role === 'owner' || user?.role === 'admin') && (
            <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px' }}>
                <div>
                  <h2 style={{ fontSize: '24px', marginBottom: '8px' }}>Métricas & Relatórios Financeiros</h2>
                  <p style={{ color: 'var(--muted)', fontSize: '14px' }}>Acompanhe o desempenho da sua barbearia com gráficos interativos e relatórios por profissional.</p>
                </div>
                
                {/* Filtro de Dias e Barbearias */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}>
                  {user?.role === 'admin' && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <span style={{ fontSize: '14px', color: 'var(--muted)' }}>Barbearia:</span>
                      <select 
                        className="form-input" 
                        style={{ width: '220px', padding: '8px 12px' }} 
                        value={selectedEstIdForMetrics} 
                        onChange={(e) => setSelectedEstIdForMetrics(e.target.value)}
                      >
                        <option value="all">Todas (Consolidado)</option>
                        {superSessions.map(session => (
                          <option key={session.establishment_id} value={session.establishment_id}>
                            {session.establishment_name}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}

                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <span style={{ fontSize: '14px', color: 'var(--muted)' }}>Período:</span>
                    <select 
                      className="form-input" 
                      style={{ width: '150px', padding: '8px 12px' }} 
                      value={metricsDays} 
                      onChange={(e) => setMetricsDays(parseInt(e.target.value, 10))}
                    >
                      <option value={7}>Últimos 7 dias</option>
                      <option value={30}>Últimos 30 dias</option>
                      <option value={90}>Últimos 90 dias</option>
                    </select>
                  </div>
                </div>
              </div>

              {loadingMetrics || !metrics ? (
                <p style={{ color: 'var(--muted)', textAlign: 'center', padding: '40px' }}>Carregando métricas da barbearia...</p>
              ) : (
                <>
                  {/* KPIs de Topo */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '20px' }}>
                    <div className="card-premium" style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                      <div style={{ width: '48px', height: '48px', borderRadius: '12px', background: 'rgba(212,175,55,0.1)', display: 'flex', justifyContent: 'center', alignItems: 'center', color: 'var(--primary)' }}>
                        <DollarSign size={24} />
                      </div>
                      <div>
                        <div style={{ fontSize: '12px', color: 'var(--muted)' }}>Faturamento Pago</div>
                        <div style={{ fontSize: '24px', fontWeight: 'bold', color: 'var(--primary)' }}>R$ {metrics.total_revenue.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                      </div>
                    </div>

                    <div className="card-premium" style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                      <div style={{ width: '48px', height: '48px', borderRadius: '12px', background: 'rgba(245,158,11,0.1)', display: 'flex', justifyContent: 'center', alignItems: 'center', color: '#f59e0b' }}>
                        <DollarSign size={24} />
                      </div>
                      <div>
                        <div style={{ fontSize: '12px', color: 'var(--muted)' }}>Faturamento Pendente</div>
                        <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#f59e0b' }}>R$ {(metrics.pending_revenue || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                      </div>
                    </div>

                    <div className="card-premium" style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                      <div style={{ width: '48px', height: '48px', borderRadius: '12px', background: 'rgba(16,185,129,0.1)', display: 'flex', justifyContent: 'center', alignItems: 'center', color: '#10b981' }}>
                        <CalendarDays size={24} />
                      </div>
                      <div>
                        <div style={{ fontSize: '12px', color: 'var(--muted)' }}>Atendimentos Concluídos</div>
                        <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#10b981' }}>{metrics.total_bookings}</div>
                      </div>
                    </div>

                    <div className="card-premium" style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                      <div style={{ width: '48px', height: '48px', borderRadius: '12px', background: 'rgba(59,130,246,0.1)', display: 'flex', justifyContent: 'center', alignItems: 'center', color: '#3b82f6' }}>
                        <TrendingUp size={24} />
                      </div>
                      <div>
                        <div style={{ fontSize: '12px', color: 'var(--muted)' }}>Ticket Médio</div>
                        <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#3b82f6' }}>R$ {metrics.avg_ticket.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                      </div>
                    </div>
                  </div>

                  {/* Gráficos em Grid */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: '24px' }}>
                    {/* Gráfico 1: Evolução Diária */}
                    <div className="card-premium" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                      <h3 style={{ fontSize: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <TrendingUp size={18} style={{ color: 'var(--primary)' }} />
                        Evolução Diária de Receita
                      </h3>
                      <div style={{ padding: '10px 0' }}>
                        {drawLineChart(metrics.evolution)}
                      </div>
                    </div>

                    {/* Gráfico 2: Desempenho dos Barbeiros ou Barbearias */}
                    <div className="card-premium" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                      <h3 style={{ fontSize: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <Users size={18} style={{ color: 'var(--primary)' }} />
                        {user?.role === 'admin' && selectedEstIdForMetrics === 'all' ? 'Desempenho por Barbearia' : 'Desempenho por Profissional'}
                      </h3>
                      <div style={{ overflowY: 'auto', maxHeight: '180px', paddingRight: '4px' }}>
                        {user?.role === 'admin' && selectedEstIdForMetrics === 'all' ? (
                          !metrics.establishment_performance || metrics.establishment_performance.length === 0 ? (
                            <p style={{ color: 'var(--muted)', fontSize: '14px', textAlign: 'center', padding: '20px' }}>Sem dados no período.</p>
                          ) : (
                            metrics.establishment_performance.map((e: any) => {
                              const percent = metrics.total_revenue > 0 ? (e.total_revenue / metrics.total_revenue) * 100 : 0;
                              return (
                                <div key={e.establishment_id} style={{ marginBottom: '16px' }}>
                                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                                    <span style={{ fontSize: '13px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                      {e.logo_url ? (
                                        <img src={e.logo_url} style={{ width: '22px', height: '22px', borderRadius: '50%', objectFit: 'cover' }} />
                                      ) : (
                                        <div style={{ width: '22px', height: '22px', borderRadius: '50%', background: 'var(--primary)', display: 'flex', justifyContent: 'center', alignItems: 'center', fontSize: '9px', fontWeight: 'bold', color: '#121212' }}>
                                          {e.establishment_name[0]}
                                        </div>
                                      )}
                                      {e.establishment_name}
                                    </span>
                                    <span style={{ fontSize: '13px', fontWeight: 'bold' }}>R$ {e.total_revenue.toFixed(2)} ({e.total_bookings})</span>
                                  </div>
                                  <div style={{ width: '100%', height: '6px', background: 'rgba(255,255,255,0.05)', borderRadius: '3px', overflow: 'hidden' }}>
                                    <div style={{ width: `${percent}%`, height: '100%', background: 'linear-gradient(90deg, var(--primary), #ffffff)', borderRadius: '3px', transition: 'width 0.5s ease-in-out' }} />
                                  </div>
                                </div>
                              );
                            })
                          )
                        ) : (
                          !metrics.barber_performance || metrics.barber_performance.length === 0 ? (
                            <p style={{ color: 'var(--muted)', fontSize: '14px', textAlign: 'center', padding: '20px' }}>Sem dados no período.</p>
                          ) : (
                            metrics.barber_performance.map((b: any) => {
                              const percent = metrics.total_revenue > 0 ? (b.total_revenue / metrics.total_revenue) * 100 : 0;
                              return (
                                <div key={b.barber_id} style={{ marginBottom: '16px' }}>
                                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                                    <span style={{ fontSize: '13px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                      {b.photo_url ? (
                                        <img src={b.photo_url} style={{ width: '22px', height: '22px', borderRadius: '50%', objectFit: 'cover' }} />
                                      ) : (
                                        <div style={{ width: '22px', height: '22px', borderRadius: '50%', background: 'var(--primary)', display: 'flex', justifyContent: 'center', alignItems: 'center', fontSize: '9px', fontWeight: 'bold', color: '#121212' }}>
                                          {b.barber_name[0]}
                                        </div>
                                      )}
                                      {b.barber_name}
                                    </span>
                                    <span style={{ fontSize: '13px', fontWeight: 'bold' }}>R$ {b.total_revenue.toFixed(2)} ({b.total_bookings})</span>
                                  </div>
                                  <div style={{ width: '100%', height: '6px', background: 'rgba(255,255,255,0.05)', borderRadius: '3px', overflow: 'hidden' }}>
                                    <div style={{ width: `${percent}%`, height: '100%', background: 'linear-gradient(90deg, var(--primary), #ffffff)', borderRadius: '3px', transition: 'width 0.5s ease-in-out' }} />
                                  </div>
                                </div>
                              );
                            })
                          )
                        )}
                      </div>
                    </div>

                    {/* Gráfico 3: Distribuição de Serviços */}
                    <div className="card-premium" style={{ display: 'flex', flexDirection: 'column', gap: '16px', gridColumn: 'span 1' }}>
                      <h3 style={{ fontSize: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <Scissors size={18} style={{ color: 'var(--primary)', transform: 'rotate(-90deg)' }} />
                        Serviços Mais Procurados
                      </h3>
                      <div style={{ overflowY: 'auto', maxHeight: '180px', paddingRight: '4px' }}>
                        {metrics.services_distribution.length === 0 ? (
                          <p style={{ color: 'var(--muted)', fontSize: '14px', textAlign: 'center', padding: '20px' }}>Sem dados no período.</p>
                        ) : (
                          metrics.services_distribution.map((s: any) => {
                            const percent = metrics.total_bookings > 0 ? (s.count / metrics.total_bookings) * 100 : 0;
                            return (
                              <div key={s.service_id} style={{ marginBottom: '16px' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                                  <span style={{ fontSize: '13px' }}>{s.service_name}</span>
                                  <span style={{ fontSize: '13px', fontWeight: 'bold', color: 'var(--primary)' }}>{s.count} agendamentos ({percent.toFixed(0)}%)</span>
                                </div>
                                <div style={{ width: '100%', height: '6px', background: 'rgba(255,255,255,0.05)', borderRadius: '3px', overflow: 'hidden' }}>
                                  <div style={{ width: `${percent}%`, height: '100%', background: 'var(--primary)', borderRadius: '3px' }} />
                                </div>
                              </div>
                            );
                          })
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Relatório Detalhado */}
                  <div className="card-premium">
                    <h3 style={{ fontSize: '18px', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <Users size={18} style={{ color: 'var(--primary)' }} />
                      {user?.role === 'admin' && selectedEstIdForMetrics === 'all' ? 'Métricas Detalhadas por Barbearia' : 'Métricas Detalhadas por Profissional'}
                    </h3>
                    <div style={{ overflowX: 'auto' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', minWidth: '600px' }}>
                        <thead>
                          <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                            <th style={{ padding: '12px 8px', color: 'var(--muted)', fontSize: '12px', fontWeight: 'bold', textTransform: 'uppercase' }}>
                              {user?.role === 'admin' && selectedEstIdForMetrics === 'all' ? 'Barbearia' : 'Profissional'}
                            </th>
                            <th style={{ padding: '12px 8px', color: 'var(--muted)', fontSize: '12px', fontWeight: 'bold', textTransform: 'uppercase', textAlign: 'center' }}>Atendimentos</th>
                            <th style={{ padding: '12px 8px', color: 'var(--muted)', fontSize: '12px', fontWeight: 'bold', textTransform: 'uppercase', textAlign: 'right' }}>Faturamento Pago</th>
                            <th style={{ padding: '12px 8px', color: 'var(--muted)', fontSize: '12px', fontWeight: 'bold', textTransform: 'uppercase', textAlign: 'right' }}>Faturamento Pendente</th>
                            <th style={{ padding: '12px 8px', color: 'var(--muted)', fontSize: '12px', fontWeight: 'bold', textTransform: 'uppercase', textAlign: 'right' }}>
                              {user?.role === 'admin' && selectedEstIdForMetrics === 'all' ? 'Ticket Médio' : `Comissão Proj. (${metrics.commission_percent || 50}%)`}
                            </th>
                            {!(user?.role === 'admin' && selectedEstIdForMetrics === 'all') && (
                              <th style={{ padding: '12px 8px', color: 'var(--muted)', fontSize: '12px', fontWeight: 'bold', textTransform: 'uppercase', textAlign: 'right' }}>Líquido Casa</th>
                            )}
                          </tr>
                        </thead>
                        <tbody>
                          {user?.role === 'admin' && selectedEstIdForMetrics === 'all' ? (
                            metrics.establishment_performance?.map((e: any) => (
                              <tr key={e.establishment_id} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                                <td style={{ padding: '12px 8px', fontSize: '14px', display: 'flex', alignItems: 'center', gap: '10px' }}>
                                  {e.logo_url ? (
                                    <img src={e.logo_url} style={{ width: '28px', height: '28px', borderRadius: '50%', objectFit: 'cover' }} />
                                  ) : (
                                    <div style={{ width: '28px', height: '28px', borderRadius: '50%', background: 'var(--primary)', display: 'flex', justifyContent: 'center', alignItems: 'center', fontSize: '11px', fontWeight: 'bold', color: '#121212' }}>
                                      {e.establishment_name[0]}
                                    </div>
                                  )}
                                  <span>{e.establishment_name}</span>
                                </td>
                                <td style={{ padding: '12px 8px', fontSize: '14px', textAlign: 'center' }}>{e.total_bookings}</td>
                                <td style={{ padding: '12px 8px', fontSize: '14px', textAlign: 'right', fontWeight: 'bold' }}>R$ {e.total_revenue.toFixed(2)}</td>
                                <td style={{ padding: '12px 8px', fontSize: '14px', textAlign: 'right', color: '#f59e0b' }}>R$ {(e.pending_revenue || 0).toFixed(2)}</td>
                                <td style={{ padding: '12px 8px', fontSize: '14px', textAlign: 'right', color: 'var(--primary)' }}>
                                  R$ {(e.total_bookings > 0 ? e.total_revenue / e.total_bookings : 0).toFixed(2)}
                                </td>
                              </tr>
                            ))
                          ) : (
                            metrics.barber_performance?.map((b: any) => {
                              const pct = metrics.commission_percent !== undefined ? metrics.commission_percent : 50;
                              return (
                                <tr key={b.barber_id} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                                  <td style={{ padding: '12px 8px', fontSize: '14px', display: 'flex', alignItems: 'center', gap: '10px' }}>
                                    {b.photo_url ? (
                                      <img src={b.photo_url} style={{ width: '28px', height: '28px', borderRadius: '50%', objectFit: 'cover' }} />
                                    ) : (
                                      <div style={{ width: '28px', height: '28px', borderRadius: '50%', background: 'var(--primary)', display: 'flex', justifyContent: 'center', alignItems: 'center', fontSize: '11px', fontWeight: 'bold', color: '#121212' }}>
                                        {b.barber_name[0]}
                                      </div>
                                    )}
                                    <span>{b.barber_name}</span>
                                  </td>
                                  <td style={{ padding: '12px 8px', fontSize: '14px', textAlign: 'center' }}>{b.total_bookings}</td>
                                  <td style={{ padding: '12px 8px', fontSize: '14px', textAlign: 'right', fontWeight: 'bold' }}>R$ {b.total_revenue.toFixed(2)}</td>
                                  <td style={{ padding: '12px 8px', fontSize: '14px', textAlign: 'right', color: '#f59e0b' }}>R$ {(b.pending_revenue || 0).toFixed(2)}</td>
                                  <td style={{ padding: '12px 8px', fontSize: '14px', textAlign: 'right', color: '#10b981' }}>R$ {(b.total_revenue * (pct / 100)).toFixed(2)}</td>
                                  <td style={{ padding: '12px 8px', fontSize: '14px', textAlign: 'right', color: 'var(--primary)' }}>R$ {(b.total_revenue * (1 - pct / 100)).toFixed(2)}</td>
                                </tr>
                              );
                            })
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </>
              )}
            </div>
          )}

          {/* TAB: CLIENTS & CAMPAIGNS MARKETING */}
          {activeTab === 'clients' && (
            <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
              <div>
                <h2 style={{ fontSize: '24px', marginBottom: '8px' }}>Gestão de Contatos & Marketing</h2>
                <p style={{ color: 'var(--muted)', fontSize: '14px' }}>
                  Visualize a lista telefônica de clientes cadastrados pelo bot, adicione observações de atendimento e dispare campanhas promocionais com proteção anti-ban.
                </p>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: (user?.role === 'owner' || user?.role === 'admin') ? '2fr 1.2fr' : '1fr', gap: '24px', alignItems: 'start' }}>
                
                {/* Left Column: Clients Directory */}
                <div className="card-premium" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                      <h3 style={{ fontSize: '18px', display: 'flex', alignItems: 'center', gap: '8px', margin: 0 }}>
                        <BookOpen size={20} style={{ color: 'var(--primary)' }} />
                        Lista Telefônica do Salão
                      </h3>
                      <button 
                        className="btn-primary" 
                        style={{ padding: '6px 12px', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '6px' }}
                        onClick={() => {
                          setNewClientName('');
                          setNewClientPhone('');
                          setNewClientNotes('');
                          setShowCreateClientModal(true);
                        }}
                      >
                        <UserPlus size={14} />
                        <span>Novo Contato</span>
                      </button>
                    </div>
                    
                    {/* Search Input */}
                    <div style={{ position: 'relative', width: '100%', maxWidth: '280px' }}>
                      <input
                        type="text"
                        className="form-input"
                        placeholder="Buscar por nome ou telefone..."
                        style={{ paddingLeft: '36px', height: '38px', fontSize: '14px' }}
                        value={searchClientQuery}
                        onChange={(e) => setSearchClientQuery(e.target.value)}
                      />
                      <Search size={16} style={{ position: 'absolute', left: '12px', top: '11px', color: 'var(--muted)' }} />
                    </div>
                  </div>

                  {loadingClients ? (
                    <div style={{ display: 'flex', justifyContent: 'center', padding: '40px', color: 'var(--muted)' }}>
                      <RefreshCw size={24} className="animate-spin" />
                    </div>
                  ) : clients.length === 0 ? (
                    <p style={{ color: 'var(--muted)', fontSize: '14px', textAlign: 'center', padding: '40px' }}>Nenhum contato cadastrado no momento.</p>
                  ) : (
                    <div style={{ overflowX: 'auto' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                        <thead>
                          <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                            <th style={{ padding: '12px 8px', color: 'var(--muted)', fontSize: '12px', fontWeight: 'bold', textTransform: 'uppercase' }}>Nome</th>
                            <th style={{ padding: '12px 8px', color: 'var(--muted)', fontSize: '12px', fontWeight: 'bold', textTransform: 'uppercase' }}>WhatsApp</th>
                            <th style={{ padding: '12px 8px', color: 'var(--muted)', fontSize: '12px', fontWeight: 'bold', textTransform: 'uppercase', textAlign: 'center' }}>Promoções</th>
                            <th style={{ padding: '12px 8px', color: 'var(--muted)', fontSize: '12px', fontWeight: 'bold', textTransform: 'uppercase' }}>Observações</th>
                            <th style={{ padding: '12px 8px', color: 'var(--muted)', fontSize: '12px', fontWeight: 'bold', textTransform: 'uppercase', textAlign: 'right' }}>Ações</th>
                          </tr>
                        </thead>
                        <tbody>
                          {clients
                            .filter(c => 
                              c.name.toLowerCase().includes(searchClientQuery.toLowerCase()) || 
                              c.phone.includes(searchClientQuery)
                            )
                            .map((client) => (
                              <tr key={client.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                                <td style={{ padding: '12px 8px', fontSize: '14px', fontWeight: '500' }}>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                    {client.profile_picture_url && client.profile_picture_url !== 'no-pic' ? (
                                      <img 
                                        src={client.profile_picture_url} 
                                        alt={client.name} 
                                        style={{ width: '28px', height: '28px', borderRadius: '50%', objectFit: 'cover', border: '1px solid var(--primary)' }}
                                      />
                                    ) : (
                                      <div style={{ 
                                        width: '28px', 
                                        height: '28px', 
                                        borderRadius: '50%', 
                                        background: 'linear-gradient(135deg, var(--primary) 0%, #1e1e24 100%)', 
                                        color: '#ffffff', 
                                        display: 'flex', 
                                        alignItems: 'center', 
                                        justify: 'center', 
                                        fontWeight: 'bold', 
                                        fontSize: '11px',
                                        border: '1px solid rgba(212, 175, 55, 0.2)',
                                        flexShrink: 0
                                      }}>
                                        {client.name.substring(0, 2).toUpperCase()}
                                      </div>
                                    )}
                                    <span>{client.name}</span>
                                  </div>
                                </td>
                                <td style={{ padding: '12px 8px', fontSize: '14px', color: 'var(--muted)' }}>{client.phone}</td>
                                <td style={{ padding: '12px 8px', fontSize: '14px', textAlign: 'center' }}>
                                  <span style={{ 
                                    padding: '2px 8px', 
                                    borderRadius: '4px', 
                                    fontSize: '11px', 
                                    fontWeight: 'bold',
                                    backgroundColor: client.accept_promotions ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.1)',
                                    color: client.accept_promotions ? '#10b981' : '#ef4444'
                                  }}>
                                    {client.accept_promotions ? 'Aceita' : 'Recusa'}
                                  </span>
                                </td>
                                <td style={{ padding: '12px 8px', fontSize: '13px', maxWidth: '180px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--muted)' }}>
                                  {client.notes || <em style={{ opacity: 0.5 }}>Sem anotações</em>}
                                </td>
                                <td style={{ padding: '12px 8px', textAlign: 'right', display: 'flex', gap: '8px', justifyContent: 'flex-end', alignItems: 'center' }}>
                                  <button
                                    className="btn-secondary"
                                    style={{ padding: '6px 12px', fontSize: '13px' }}
                                    onClick={() => {
                                      setEditingClient({ ...client });
                                      setShowEditClientModal(true);
                                    }}
                                  >
                                    Editar
                                  </button>
                                  {(user?.role === 'owner' || user?.role === 'admin') && (
                                    <button
                                      className="btn-secondary"
                                      style={{ padding: '6px', color: 'var(--error)', borderColor: 'rgba(239, 68, 68, 0.2)' }}
                                      onClick={() => handleDeleteClient(client.id)}
                                      title="Remover Contato"
                                    >
                                      <Trash2 size={15} />
                                    </button>
                                  )}
                                </td>
                              </tr>
                            ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>

                {/* Right Column: Promotional Campaign & Anti-Ban Config (Admin/Owner only) */}
                {(user?.role === 'owner' || user?.role === 'admin') && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
                    
                    {/* Panel 1: Anti-Ban Delays Config */}
                    <div className="card-premium" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                      <h3 style={{ fontSize: '18px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <Settings size={20} style={{ color: 'var(--primary)' }} />
                        Configurações Anti-Ban
                      </h3>
                      <p style={{ color: 'var(--muted)', fontSize: '13px', lineHeight: '1.4' }}>
                        O WhatsApp bloqueia envios em lote muito rápidos. Configure um intervalo aleatório de atraso entre o envio de cada cliente para simular comportamento humano.
                      </p>
                      
                      <form onSubmit={handleSavePromoConfig} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                        <div style={{ display: 'flex', gap: '16px' }}>
                          <div style={{ flex: 1 }}>
                            <label className="form-label" style={{ fontSize: '12px' }}>Atraso Mínimo (seg)</label>
                            <input
                              type="number"
                              className="form-input"
                              min="1"
                              value={promoDelayMin}
                              onChange={(e) => setPromoDelayMin(parseInt(e.target.value, 10))}
                              required
                            />
                          </div>
                          <div style={{ flex: 1 }}>
                            <label className="form-label" style={{ fontSize: '12px' }}>Atraso Máximo (seg)</label>
                            <input
                              type="number"
                              className="form-input"
                              min={promoDelayMin}
                              value={promoDelayMax}
                              onChange={(e) => setPromoDelayMax(parseInt(e.target.value, 10))}
                              required
                            />
                          </div>
                        </div>
                        
                        <button
                          type="submit"
                          className="btn-primary"
                          style={{ width: '100%', height: '42px', color: '#121212', fontWeight: 'bold' }}
                          disabled={savingPromoConfig}
                        >
                          {savingPromoConfig ? 'Salvando...' : 'Salvar Configuração'}
                        </button>
                      </form>
                    </div>

                    {/* Panel 2: Campaign Sender Form */}
                    <div className="card-premium" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                      <h3 style={{ fontSize: '18px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <Megaphone size={20} style={{ color: 'var(--primary)' }} />
                        Disparar Campanha Promocional
                      </h3>
                      <p style={{ color: 'var(--muted)', fontSize: '13px', lineHeight: '1.4' }}>
                        Escreva a mensagem abaixo. Ela será enviada <strong>apenas</strong> para os contatos que aceitaram receber promoções no bot.
                      </p>
                      <div style={{ backgroundColor: 'rgba(212,175,55,0.05)', border: '1px solid rgba(212,175,55,0.15)', borderRadius: '6px', padding: '10px 14px', fontSize: '12px', color: 'var(--primary)' }}>
                        💡 Use a tag <strong>{`{cliente}`}</strong> no texto para personalizar com o nome de cada pessoa automaticamente.
                      </div>

                      <form onSubmit={handleSendPromoCampaign} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                        <div>
                          <label className="form-label">Mensagem de Disparo</label>
                          <textarea
                            className="form-input"
                            rows={5}
                            placeholder={`Ex: Olá, {cliente}! 💈\n\nNesta quarta-feira teremos uma promoção especial de corte + barba por apenas R$ 50,00! Agende seu horário respondendo este bot.`}
                            style={{ resize: 'vertical', padding: '12px', fontSize: '14px', fontFamily: 'inherit' }}
                            value={promoCampaignText}
                            onChange={(e) => setPromoCampaignText(e.target.value)}
                            required
                          />
                        </div>

                        <button
                          type="submit"
                          className="btn-primary"
                          style={{ width: '100%', height: '42px', color: '#121212', fontWeight: 'bold', gap: '8px' }}
                          disabled={sendingPromoCampaign}
                        >
                          <Megaphone size={16} />
                          {sendingPromoCampaign ? 'Disparando...' : 'Iniciar Disparo da Campanha'}
                        </button>
                      </form>
                    </div>

                  </div>
                )}

              </div>
            </div>
          )}

          {/* TAB: FEEDBACKS / EVALUATIONS */}
          {activeTab === 'feedbacks' && (
            <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
              <div>
                <h2 style={{ fontSize: '24px', marginBottom: '8px' }}>Avaliações dos Clientes</h2>
                <p style={{ color: 'var(--muted)', fontSize: '14px' }}>
                  Acompanhe a opinião dos clientes sobre os atendimentos realizados e identifique pontos de melhoria.
                </p>
              </div>

              {/* Summary Cards */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '20px' }}>
                <div className="card-premium" style={{ display: 'flex', alignItems: 'center', gap: '16px', padding: '24px' }}>
                  <div style={{ width: '48px', height: '48px', borderRadius: '50%', background: 'rgba(212, 175, 55, 0.1)', display: 'flex', justifyContent: 'center', alignItems: 'center', color: 'var(--primary)' }}>
                    <Star size={24} fill="var(--primary)" />
                  </div>
                  <div>
                    <span style={{ fontSize: '13px', color: 'var(--muted)' }}>Nota Média Geral</span>
                    <h3 style={{ fontSize: '28px', fontWeight: 'bold', marginTop: '4px', display: 'flex', alignItems: 'baseline', gap: '6px' }}>
                      {feedbacks.length > 0 
                        ? (feedbacks.reduce((sum, f) => sum + f.rating, 0) / feedbacks.length).toFixed(1)
                        : '0.0'}
                      <span style={{ fontSize: '14px', color: 'var(--muted)', fontWeight: 'normal' }}>/ 5.0</span>
                    </h3>
                  </div>
                </div>

                <div className="card-premium" style={{ display: 'flex', alignItems: 'center', gap: '16px', padding: '24px' }}>
                  <div style={{ width: '48px', height: '48px', borderRadius: '50%', background: 'rgba(255, 255, 255, 0.05)', display: 'flex', justifyContent: 'center', alignItems: 'center', color: 'var(--muted)' }}>
                    <BookOpen size={24} />
                  </div>
                  <div>
                    <span style={{ fontSize: '13px', color: 'var(--muted)' }}>Total de Avaliações</span>
                    <h3 style={{ fontSize: '28px', fontWeight: 'bold', marginTop: '4px' }}>{feedbacks.length}</h3>
                  </div>
                </div>
              </div>

              {/* Feedbacks Grid List */}
              {loadingFeedbacks ? (
                <div style={{ display: 'flex', justifyContent: 'center', padding: '40px', color: 'var(--muted)' }}>
                  <RefreshCw size={24} className="animate-spin" />
                </div>
              ) : feedbacks.length === 0 ? (
                <div className="card-premium" style={{ padding: '40px', textAlign: 'center', color: 'var(--muted)' }}>
                  Nenhuma avaliação registrada até o momento.
                </div>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '20px' }}>
                  {feedbacks.map((f) => (
                    <div key={f.id} className="card-premium" style={{ display: 'flex', flexDirection: 'column', gap: '12px', padding: '20px', border: '1px solid rgba(255,255,255,0.05)', borderRadius: '8px' }}>
                      
                      {/* Rating & Date */}
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div style={{ display: 'flex' }}>
                          {Array.from({ length: 5 }, (_, idx) => (
                            <Star 
                              key={idx} 
                              size={15} 
                              fill={idx < f.rating ? 'var(--primary)' : 'none'} 
                              color={idx < f.rating ? 'var(--primary)' : 'rgba(255,255,255,0.2)'} 
                              style={{ marginRight: '2px' }}
                            />
                          ))}
                        </div>
                        <span style={{ fontSize: '12px', color: 'var(--muted)' }}>
                          {new Date(f.created_at).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })}
                        </span>
                      </div>

                      {/* Comment */}
                      <div style={{ flex: 1, minHeight: '60px', fontSize: '14px', color: 'var(--foreground)', lineHeight: '1.4' }}>
                        {f.comment ? (
                          `"${f.comment}"`
                        ) : (
                          <span style={{ color: 'var(--muted)', fontStyle: 'italic', opacity: 0.5 }}>Sem comentário adicional.</span>
                        )}
                      </div>

                      {/* Client info & Barber info */}
                      <div style={{ borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '10px', display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '12px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                          <span style={{ color: 'var(--muted)' }}>Cliente:</span>
                          <span style={{ fontWeight: '500' }}>{f.client_name} ({f.client_phone})</span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                          <span style={{ color: 'var(--muted)' }}>Profissional:</span>
                          <span style={{ fontWeight: '500', color: 'var(--primary)' }}>{f.barber_name}</span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                          <span style={{ color: 'var(--muted)' }}>Serviço:</span>
                          <span>{f.service_name}</span>
                        </div>
                      </div>

                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* MODAL: SUPER ADMIN CHANGE PASSWORD */}
          {superChangePasswordModal && superSelectedUser && (
            <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.8)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 999, padding: '20px' }}>
              <div className="glass-panel animate-fade-in" style={{ width: '100%', maxWidth: '400px', padding: '32px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
                  <h3 style={{ fontSize: '20px' }}>Alterar Senha de Usuário</h3>
                  <button className="btn-secondary" style={{ padding: '6px', border: 'none', color: 'var(--muted)' }} onClick={() => {
                    setSuperChangePasswordModal(false);
                    setSuperSelectedUser(null);
                    setSuperNewPassword('');
                  }}><X size={20} /></button>
                </div>

                <form onSubmit={handleSuperChangePassword}>
                  <div className="form-group">
                    <label className="form-label" style={{ marginBottom: '12px', display: 'block' }}>
                      Usuário: <strong>{superSelectedUser.name}</strong> ({superSelectedUser.email})
                    </label>
                    <label className="form-label">Nova Senha (mín. 6 caracteres)</label>
                    <input 
                      type="password" 
                      className="form-input" 
                      placeholder="Nova senha" 
                      value={superNewPassword} 
                      onChange={(e) => setSuperNewPassword(e.target.value)} 
                      required 
                      minLength={6}
                    />
                  </div>

                  <div style={{ display: 'flex', gap: '12px', marginTop: '24px', justifyContent: 'flex-end' }}>
                    <button type="button" className="btn-secondary" onClick={() => {
                      setSuperChangePasswordModal(false);
                      setSuperSelectedUser(null);
                      setSuperNewPassword('');
                    }}>Cancelar</button>
                    <button type="submit" className="btn-primary">Confirmar</button>
                  </div>
                </form>
              </div>
            </div>
          )}

          {/* MODAL: SUPER ADMIN CHAT SUPPORT */}
          {superChatOpen && superChatContact && (
            <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.8)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 999, padding: '20px' }}>
              <div className="glass-panel animate-fade-in" style={{ width: '100%', maxWidth: '500px', padding: '32px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
                  <h3 style={{ fontSize: '20px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <MessageCircle style={{ color: 'var(--primary)' }} />
                    Enviar WhatsApp de Suporte
                  </h3>
                  <button className="btn-secondary" style={{ padding: '6px', border: 'none', color: 'var(--muted)' }} onClick={() => {
                    setSuperChatOpen(false);
                    setSuperChatContact(null);
                    setSuperChatMessage('');
                  }}><X size={20} /></button>
                </div>

                <form onSubmit={handleSendSuperMessage}>
                  <div style={{ background: 'rgba(255,255,255,0.02)', padding: '12px 16px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.05)', marginBottom: '20px' }}>
                    <p style={{ fontSize: '14px', marginBottom: '4px' }}>
                      Destinatário: <strong>{superChatContact.name}</strong> ({superChatContact.role === 'owner' ? 'Dono' : 'Barbeiro'})
                    </p>
                    <p style={{ fontSize: '13px', color: 'var(--muted)', marginBottom: '4px' }}>
                      Telefone: <strong>{superChatContact.phone}</strong>
                    </p>
                    {superChatContact.establishment_name && (
                      <p style={{ fontSize: '13px', color: 'var(--muted)', margin: 0 }}>
                        Barbearia: <strong>{superChatContact.establishment_name}</strong>
                      </p>
                    )}
                  </div>

                  <div className="form-group">
                    <label className="form-label">Mensagem (será enviada via WhatsApp central)</label>
                    <textarea 
                      className="form-input" 
                      style={{ width: '100%', minHeight: '120px', resize: 'vertical', fontFamily: 'inherit', fontSize: '14px', padding: '12px' }}
                      placeholder="Digite sua mensagem de suporte aqui..." 
                      value={superChatMessage} 
                      onChange={(e) => setSuperChatMessage(e.target.value)} 
                      required 
                    />
                    <span style={{ fontSize: '11px', color: 'var(--muted)', display: 'block', marginTop: '6px' }}>
                      Dica: Use markdown para negrito, ex: *texto em negrito*
                    </span>
                  </div>

                  <div style={{ display: 'flex', gap: '12px', marginTop: '24px', justifyContent: 'flex-end' }}>
                    <button type="button" className="btn-secondary" onClick={() => {
                      setSuperChatOpen(false);
                      setSuperChatContact(null);
                      setSuperChatMessage('');
                    }} disabled={superChatSending}>Cancelar</button>
                    <button type="submit" className="btn-primary" disabled={superChatSending}>
                      {superChatSending ? 'Enviando...' : 'Enviar WhatsApp'}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}

          {/* MODAL: EDIT CLIENT / CONTACT */}
          {showEditClientModal && editingClient && (
            <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.8)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 999, padding: '20px' }}>
              <div className="glass-panel animate-fade-in" style={{ width: '100%', maxWidth: '480px', padding: '32px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
                  <h3 style={{ fontSize: '20px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Users size={20} style={{ color: 'var(--primary)' }} />
                    Editar Ficha de Contato
                  </h3>
                  <button className="btn-secondary" style={{ padding: '6px', border: 'none', color: 'var(--muted)' }} onClick={() => {
                    setShowEditClientModal(false);
                    setEditingClient(null);
                  }}><X size={20} /></button>
                </div>

                <form onSubmit={handleUpdateClient} style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                  <div className="form-group">
                    <label className="form-label">Nome Completo</label>
                    <input 
                      type="text" 
                      className="form-input" 
                      value={editingClient.name} 
                      onChange={(e) => setEditingClient({ ...editingClient, name: e.target.value })} 
                      required 
                    />
                  </div>

                  <div className="form-group">
                    <label className="form-label">WhatsApp (JID / Telefone)</label>
                    <input 
                      type="text" 
                      className="form-input" 
                      value={editingClient.phone} 
                      onChange={(e) => setEditingClient({ ...editingClient, phone: e.target.value })} 
                      required 
                    />
                  </div>

                  <div className="form-group" style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <input 
                      type="checkbox" 
                      id="accept_promotions_checkbox"
                      checked={editingClient.accept_promotions} 
                      onChange={(e) => setEditingClient({ ...editingClient, accept_promotions: e.target.checked })} 
                      style={{ width: '18px', height: '18px', accentColor: 'var(--primary)', cursor: 'pointer' }}
                    />
                    <label htmlFor="accept_promotions_checkbox" className="form-label" style={{ margin: 0, cursor: 'pointer', userSelect: 'none' }}>
                      Aceita receber novidades e mensagens promocionais
                    </label>
                  </div>

                  <div className="form-group">
                    <label className="form-label">Observações e Preferências do Cliente</label>
                    <textarea 
                      className="form-input" 
                      rows={4}
                      placeholder="Ex: Prefere corte degradê navalhado. Usa gel finalizador. Costuma vir aos sábados de manhã."
                      value={editingClient.notes || ''} 
                      onChange={(e) => setEditingClient({ ...editingClient, notes: e.target.value })} 
                      style={{ resize: 'vertical', padding: '10px' }}
                    />
                  </div>

                  <div style={{ display: 'flex', gap: '12px', marginTop: '10px' }}>
                    <button 
                      type="button" 
                      className="btn-secondary" 
                      style={{ flex: 1 }} 
                      onClick={() => {
                        setShowEditClientModal(false);
                        setEditingClient(null);
                      }}
                    >
                      Cancelar
                    </button>
                    <button 
                      type="submit" 
                      className="btn-primary" 
                      style={{ flex: 1, color: '#121212', fontWeight: 'bold' }}
                    >
                      Salvar Alterações
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}

          {/* MODAL: CREATE CLIENT / CONTACT (MANUAL) */}
          {showCreateClientModal && (
            <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.8)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 999, padding: '20px' }}>
              <div className="glass-panel animate-fade-in" style={{ width: '100%', maxWidth: '480px', padding: '32px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
                  <h3 style={{ fontSize: '20px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <UserPlus size={20} style={{ color: 'var(--primary)' }} />
                    Cadastrar Novo Contato
                  </h3>
                  <button className="btn-secondary" style={{ padding: '6px', border: 'none', color: 'var(--muted)' }} onClick={() => {
                    setShowCreateClientModal(false);
                    setNewClientName('');
                    setNewClientPhone('');
                    setNewClientNotes('');
                  }}><X size={20} /></button>
                </div>

                <form onSubmit={handleCreateClient} style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                  <div className="form-group">
                    <label className="form-label">Nome Completo</label>
                    <input 
                      type="text" 
                      className="form-input" 
                      placeholder="Ex: João da Silva"
                      value={newClientName} 
                      onChange={(e) => setNewClientName(e.target.value)} 
                      required 
                    />
                  </div>

                  <div className="form-group">
                    <label className="form-label">WhatsApp (DDD + Número)</label>
                    <input 
                      type="tel" 
                      className="form-input" 
                      placeholder="Ex: 11999998888"
                      value={newClientPhone} 
                      onChange={(e) => setNewClientPhone(e.target.value)} 
                      required 
                    />
                    <span style={{ fontSize: '11px', color: 'var(--muted)', display: 'block', marginTop: '6px' }}>
                      Não é necessário colocar o código do país (+55). Insira apenas o DDD e o número de celular.
                    </span>
                  </div>

                  <div className="form-group">
                    <label className="form-label">Observações e Preferências do Cliente (Opcional)</label>
                    <textarea 
                      className="form-input" 
                      rows={4}
                      placeholder="Ex: Prefere corte social com tesoura. Usa gel finalizador."
                      value={newClientNotes} 
                      onChange={(e) => setNewClientNotes(e.target.value)} 
                      style={{ resize: 'vertical', padding: '10px' }}
                    />
                  </div>

                  <div style={{ display: 'flex', gap: '12px', marginTop: '10px' }}>
                    <button 
                      type="button" 
                      className="btn-secondary" 
                      style={{ flex: 1 }} 
                      onClick={() => {
                        setShowCreateClientModal(false);
                        setNewClientName('');
                        setNewClientPhone('');
                        setNewClientNotes('');
                      }}
                      disabled={createClientLoading}
                    >
                      Cancelar
                    </button>
                    <button 
                      type="submit" 
                      className="btn-primary" 
                      style={{ flex: 1, color: '#121212', fontWeight: 'bold' }}
                      disabled={createClientLoading}
                    >
                      {createClientLoading ? 'Cadastrando...' : 'Cadastrar Contato'}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}
        </main>
      </div>

      {/* MODAL: MANUAL BOOKING FORM (CREATE) */}
      {showApptModal && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.8)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 999, padding: '20px' }}>
          <div className="glass-panel animate-fade-in" style={{ width: '100%', maxWidth: '500px', padding: '32px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
              <h3 style={{ fontSize: '20px' }}>Agendar Horário Manualmente</h3>
              <button className="btn-secondary" style={{ padding: '6px', border: 'none', color: 'var(--muted)' }} onClick={() => setShowApptModal(false)}><X size={20} /></button>
            </div>

            <form onSubmit={handleCreateAppointment}>
              <div className="form-group">
                <label className="form-label">Data do Agendamento</label>
                <input type="date" className="form-input" value={filterDate} onChange={(e) => setFilterDate(e.target.value)} required />
              </div>

              {user?.role !== 'barber' ? (
                <div className="form-group">
                  <label className="form-label">Selecionar Barbeiro</label>
                  <select className="form-input" value={apptBarber} onChange={(e) => setApptBarber(e.target.value)} required>
                    <option value="">Selecione um barbeiro...</option>
                    {barbers.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                  </select>
                </div>
              ) : (
                <div className="form-group">
                  <label className="form-label">Barbeiro Designado</label>
                  <input type="text" className="form-input" value={user.name} disabled />
                </div>
              )}

              <div className="form-group" style={{ position: 'relative' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <label className="form-label">Nome do Cliente</label>
                  <button 
                    type="button" 
                    style={{ background: 'none', border: 'none', color: 'var(--primary)', fontSize: '11px', cursor: 'pointer', padding: '0 0 4px 0', textDecoration: 'underline' }}
                    onClick={() => setShowClientSuggestions(!showClientSuggestions)}
                  >
                    {showClientSuggestions ? 'Ocultar contatos' : '🔍 Ver contatos salvos'}
                  </button>
                </div>
                <input 
                  type="text" 
                  className="form-input" 
                  placeholder="Comece a digitar o nome do cliente..." 
                  value={apptClientName} 
                  onChange={(e) => {
                    setApptClientName(e.target.value);
                    if (e.target.value.trim().length > 0) {
                      setShowClientSuggestions(true);
                    } else {
                      setShowClientSuggestions(false);
                    }
                  }} 
                  onFocus={() => {
                    if (clients.length > 0) {
                      setShowClientSuggestions(true);
                    }
                  }}
                  required 
                />

                {showClientSuggestions && (
                  <div style={{
                    position: 'absolute',
                    top: '100%',
                    left: 0,
                    right: 0,
                    backgroundColor: '#1E1E1E',
                    border: '1px solid rgba(255,255,255,0.1)',
                    borderRadius: '8px',
                    maxHeight: '180px',
                    overflowY: 'auto',
                    zIndex: 1000,
                    boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
                    marginTop: '4px'
                  }}>
                    {clients.filter(c => 
                      c.name.toLowerCase().includes(apptClientName.toLowerCase()) || 
                      (c.phone && c.phone.includes(apptClientName))
                    ).length === 0 ? (
                      <div style={{ padding: '12px', color: 'var(--muted)', fontSize: '13px', textAlign: 'center' }}>
                        Nenhum contato salvo correspondente.
                      </div>
                    ) : (
                      clients.filter(c => 
                        c.name.toLowerCase().includes(apptClientName.toLowerCase()) || 
                        (c.phone && c.phone.includes(apptClientName))
                      ).map(client => (
                        <div
                          key={client.id || client.phone}
                          style={{
                            padding: '10px 14px',
                            borderBottom: '1px solid rgba(255,255,255,0.03)',
                            cursor: 'pointer',
                            transition: 'background 0.2s',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '2px'
                          }}
                          onClick={() => {
                            setApptClientName(client.name);
                            const rawPhone = client.phone.replace(/\D/g, '');
                            if (rawPhone.startsWith('55') && rawPhone.length >= 12) {
                              setApptCountryDdi('55');
                              setApptClientPhone(rawPhone.substring(2));
                            } else if (rawPhone.length > 10) {
                              setApptCountryDdi(rawPhone.substring(0, 2));
                              setApptClientPhone(rawPhone.substring(2));
                            } else {
                              setApptCountryDdi('55');
                              setApptClientPhone(rawPhone);
                            }
                            setShowClientSuggestions(false);
                          }}
                          onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'rgba(212, 175, 55, 0.08)'}
                          onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                        >
                          <span style={{ fontWeight: '600', fontSize: '13px', color: '#FFF' }}>{client.name}</span>
                          <span style={{ fontSize: '11px', color: 'var(--muted)' }}>{client.phone}</span>
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>

              <div className="form-group">
                <label className="form-label">Telefone do Cliente (DDD + Número)</label>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span style={{ fontSize: '18px', fontWeight: 'bold', color: 'var(--primary)' }}>+</span>
                  <input
                    type="text"
                    className="form-input"
                    style={{ width: '60px', padding: '10px 6px', textAlign: 'center' }}
                    value={apptCountryDdi}
                    onChange={(e) => setApptCountryDdi(e.target.value.replace(/\D/g, ''))}
                    placeholder="55"
                    maxLength={4}
                    required
                  />
                  <input 
                    type="text" 
                    className="form-input" 
                    style={{ flex: 1 }}
                    placeholder="Ex: 11999998888" 
                    value={apptClientPhone} 
                    onChange={(e) => setApptClientPhone(e.target.value)} 
                    required 
                  />
                </div>
              </div>

              <div className="form-group">
                <label className="form-label">Serviço Opcional</label>
                <select 
                  className="form-input" 
                  value={apptService} 
                  onChange={(e) => setApptService(e.target.value)}
                >
                  <option value="">Nenhum serviço selecionado...</option>
                  {services.map((s) => (
                    <option key={s.id} value={s.id}>{s.name} (R$ {parseFloat(s.price).toFixed(2)})</option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label className="form-label">Escolher Horário Disponível</label>
                {loadingSlots ? (
                  <p style={{ color: 'var(--muted)', fontSize: '14px' }}>Buscando horários da agenda...</p>
                ) : !apptBarber ? (
                  <p style={{ color: 'var(--muted)', fontSize: '14px' }}>Selecione um barbeiro primeiro.</p>
                ) : apptSlots.length === 0 ? (
                  <p style={{ color: 'var(--error)', fontSize: '14px' }}>Sem horários vagos para este profissional nesta data.</p>
                ) : (
                  <select className="form-input" value={apptTime} onChange={(e) => setApptTime(e.target.value)} required>
                    <option value="">Escolha o horário...</option>
                    {apptSlots.map((slot) => <option key={slot} value={slot}>{formatTime(slot)}</option>)}
                  </select>
                )}
              </div>

              <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end', marginTop: '24px' }}>
                <button type="button" className="btn-secondary" onClick={() => setShowApptModal(false)}>Cancelar</button>
                <button type="submit" className="btn-primary" disabled={!apptTime}>Confirmar Agendamento</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: RESCHEDULE BOOKING FORM (UPDATE) */}
      {showRescheduleModal && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.8)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 999, padding: '20px' }}>
          <div className="glass-panel animate-fade-in" style={{ width: '100%', maxWidth: '500px', padding: '32px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
              <h3 style={{ fontSize: '20px' }}>Reagendar Horário do Cliente</h3>
              <button className="btn-secondary" style={{ padding: '6px', border: 'none', color: 'var(--muted)' }} onClick={() => setShowRescheduleModal(false)}><X size={20} /></button>
            </div>

            <form onSubmit={handleRescheduleAppointment}>
              <div className="form-group">
                <label className="form-label">Cliente</label>
                <input type="text" className="form-input" value={rescheduleClientName} disabled />
              </div>

              <div className="form-group">
                <label className="form-label">Data do Novo Agendamento</label>
                <input type="date" className="form-input" value={filterDate} onChange={(e) => setFilterDate(e.target.value)} required />
              </div>

              <div className="form-group">
                <label className="form-label">Selecionar Profissional</label>
                <select className="form-input" value={rescheduleBarber} onChange={(e) => setRescheduleBarber(e.target.value)} required>
                  <option value="">Selecione um barbeiro...</option>
                  {barbers.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              </div>

              <div className="form-group">
                <label className="form-label">Escolher Novo Horário Disponível</label>
                {loadingRescheduleSlots ? (
                  <p style={{ color: 'var(--muted)', fontSize: '14px' }}>Buscando horários da agenda...</p>
                ) : !rescheduleBarber ? (
                  <p style={{ color: 'var(--muted)', fontSize: '14px' }}>Selecione um barbeiro primeiro.</p>
                ) : rescheduleSlots.length === 0 ? (
                  <p style={{ color: 'var(--error)', fontSize: '14px' }}>Sem horários livres nesta data.</p>
                ) : (
                  <select className="form-input" value={rescheduleTime} onChange={(e) => setRescheduleTime(e.target.value)} required>
                    <option value="">Escolha o horário...</option>
                    {rescheduleSlots.map((slot) => <option key={slot} value={slot}>{formatTime(slot)}</option>)}
                  </select>
                )}
              </div>

              <div className="form-group">
                <label className="form-label">Motivo do Reagendamento (Enviado por WhatsApp)</label>
                <input type="text" className="form-input" placeholder="Ex: Ajuste de horários na barbearia" value={rescheduleReason} onChange={(e) => setRescheduleReason(e.target.value)} required />
              </div>

              <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end', marginTop: '24px' }}>
                <button type="button" className="btn-secondary" onClick={() => setShowRescheduleModal(false)}>Cancelar</button>
                <button type="submit" className="btn-primary" disabled={!rescheduleTime || !rescheduleReason}>Salvar Alterações</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: CANCELLATION REASON */}
      {showCancelModal && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.8)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 999, padding: '20px' }}>
          <div className="glass-panel animate-fade-in" style={{ width: '100%', maxWidth: '450px', padding: '32px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
              <h3 style={{ fontSize: '19px' }}>Cancelar Agendamento</h3>
              <button className="btn-secondary" style={{ padding: '6px', border: 'none', color: 'var(--muted)' }} onClick={() => setShowCancelModal(false)}><X size={18} /></button>
            </div>

            <form onSubmit={handleCancelAppointment}>
              <p style={{ fontSize: '14px', color: 'var(--muted)', marginBottom: '20px', lineHeight: '1.5' }}>
                O agendamento será cancelado no painel e o cliente receberá uma notificação automática no WhatsApp informando o cancelamento e a justificativa.
              </p>
              
              <div className="form-group">
                <label className="form-label">Motivo do Cancelamento</label>
                <input 
                  type="text" 
                  className="form-input" 
                  placeholder="Ex: Imprevisto com o barbeiro Juliano" 
                  value={cancelReason} 
                  onChange={(e) => setCancelReason(e.target.value)} 
                  required 
                />
              </div>

              <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end', marginTop: '24px' }}>
                <button type="button" className="btn-secondary" onClick={() => setShowCancelModal(false)}>Voltar</button>
                <button type="submit" className="btn-primary" style={{ backgroundColor: 'var(--error)', color: '#fff' }} disabled={!cancelReason}>
                  Confirmar Cancelamento
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: CREATE MEMBERSHIP PLAN */}
      {showPlanModal && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.8)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 999, padding: '20px' }}>
          <div className="glass-panel animate-fade-in" style={{ width: '100%', maxWidth: '500px', padding: '32px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
              <h3 style={{ fontSize: '20px' }}>Ativar Assinatura Recorrente</h3>
              <button className="btn-secondary" style={{ padding: '6px', border: 'none', color: 'var(--muted)' }} onClick={() => setShowPlanModal(false)}><X size={20} /></button>
            </div>

            <form onSubmit={handleCreatePlan}>
              <div className="form-group">
                <label className="form-label">Nome do Cliente</label>
                <input type="text" className="form-input" placeholder="Nome completo" value={newPlanClientName} onChange={(e) => setNewPlanClientName(e.target.value)} required />
              </div>

              <div className="form-group">
                <label className="form-label">Telefone do Cliente</label>
                <input type="text" className="form-input" placeholder="Ex: 5511999998888" value={newPlanClientPhone} onChange={(e) => setNewPlanClientPhone(e.target.value)} required />
              </div>

              <div className="form-group">
                <label className="form-label">Selecionar Barbeiro Preferido</label>
                <select className="form-input" value={newPlanBarber} onChange={(e) => setNewPlanBarber(e.target.value)} required>
                  <option value="">Selecione um barbeiro...</option>
                  {barbers.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                <div className="form-group">
                  <label className="form-label">Tipo de Plano</label>
                  <select className="form-input" value={newPlanType} onChange={(e) => setNewPlanType(e.target.value as any)} required>
                    <option value="quinzenal">Quinzenal (15 dias)</option>
                    <option value="mensal">Mensal (30 dias)</option>
                  </select>
                </div>

                <div className="form-group">
                  <label className="form-label">Horário do Corte</label>
                  <input type="time" className="form-input" value={newPlanTime} onChange={(e) => setNewPlanTime(e.target.value)} required />
                </div>
              </div>

              <div className="form-group">
                <label className="form-label">Dia da Semana Preferido</label>
                <select className="form-input" value={newPlanWeekday} onChange={(e) => setNewPlanWeekday(parseInt(e.target.value, 10))} required>
                  <option value={1}>Segunda-feira</option>
                  <option value={2}>Terça-feira</option>
                  <option value={3}>Quarta-feira</option>
                  <option value={4}>Quinta-feira</option>
                  <option value={5}>Sexta-feira</option>
                  <option value={6}>Sábado</option>
                  <option value={0}>Domingo</option>
                </select>
              </div>

              <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end', marginTop: '24px' }}>
                <button type="button" className="btn-secondary" onClick={() => setShowPlanModal(false)}>Cancelar</button>
                <button type="submit" className="btn-primary">Ativar Assinatura</button>
              </div>
            </form>
          </div>
        </div>
      )}
      {/* MODAL: CLOSE CHAT SESSION */}
      {showCloseChatModal && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.8)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 999, padding: '20px' }}>
          <div className="glass-panel animate-fade-in" style={{ width: '100%', maxWidth: '500px', padding: '32px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
              <h3 style={{ fontSize: '20px', fontWeight: 'bold' }}>Encerrar Sessão Conversacional</h3>
              <button className="btn-secondary" style={{ padding: '6px', border: 'none', color: 'var(--muted)' }} onClick={() => setShowCloseChatModal(false)}><X size={20} /></button>
            </div>

            <form onSubmit={handleConfirmCloseChatSession} style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              <div style={{ fontSize: '14px', color: 'var(--muted)' }}>
                Todos os dados temporários do fluxo conversacional deste cliente serão apagados. Deseja enviar uma mensagem de encerramento pelo WhatsApp?
              </div>

              <div className="form-group" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '14px' }}>
                  <input 
                    type="radio" 
                    name="closeMessageType" 
                    checked={closeChatMessageType === 'predefined_1'} 
                    onChange={() => setCloseChatMessageType('predefined_1')}
                  />
                  <span>Mensagem Padrão 1:</span>
                </label>
                <div style={{ fontSize: '13px', color: 'var(--foreground)', padding: '10px', background: 'rgba(255,255,255,0.03)', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.05)', marginLeft: '22px' }}>
                  "Seu atendimento foi encerrado. Obrigado e até a próxima! 💈"
                </div>

                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '14px', marginTop: '8px' }}>
                  <input 
                    type="radio" 
                    name="closeMessageType" 
                    checked={closeChatMessageType === 'predefined_2'} 
                    onChange={() => setCloseChatMessageType('predefined_2')}
                  />
                  <span>Mensagem Padrão 2:</span>
                </label>
                <div style={{ fontSize: '13px', color: 'var(--foreground)', padding: '10px', background: 'rgba(255,255,255,0.03)', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.05)', marginLeft: '22px' }}>
                  "Finalizamos por aqui. Se precisar de algo mais, basta nos enviar uma nova mensagem."
                </div>

                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '14px', marginTop: '8px' }}>
                  <input 
                    type="radio" 
                    name="closeMessageType" 
                    checked={closeChatMessageType === 'custom'} 
                    onChange={() => setCloseChatMessageType('custom')}
                  />
                  <span>Mensagem Personalizada</span>
                </label>
                {closeChatMessageType === 'custom' && (
                  <textarea
                    className="form-input animate-scale-in"
                    placeholder="Digite a mensagem personalizada de encerramento..."
                    style={{ minHeight: '80px', resize: 'vertical', marginLeft: '22px', width: 'calc(100% - 22px)' }}
                    value={closeChatMessageCustomText}
                    onChange={(e) => setCloseChatMessageCustomText(e.target.value)}
                    required
                  />
                )}

                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '14px', marginTop: '8px' }}>
                  <input 
                    type="radio" 
                    name="closeMessageType" 
                    checked={closeChatMessageType === 'none'} 
                    onChange={() => setCloseChatMessageType('none')}
                  />
                  <span>Não enviar nenhuma mensagem (apenas encerrar)</span>
                </label>
              </div>

              <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end', marginTop: '16px' }}>
                <button type="button" className="btn-secondary" onClick={() => setShowCloseChatModal(false)}>Cancelar</button>
                <button type="submit" className="btn-primary" style={{ backgroundColor: 'var(--error)', borderColor: 'var(--error)', color: '#ffffff' }}>Encerrar Sessão</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: ADD / EDIT SERVICE */}
      {showServiceModal && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.8)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 999, padding: '20px' }}>
          <div className="glass-panel animate-fade-in" style={{ width: '100%', maxWidth: '500px', padding: '32px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
              <h3 style={{ fontSize: '20px' }}>{editingServiceId ? 'Editar Serviço' : 'Novo Serviço'}</h3>
              <button className="btn-secondary" style={{ padding: '6px', border: 'none', color: 'var(--muted)' }} onClick={() => setShowServiceModal(false)}><X size={20} /></button>
            </div>

            <form onSubmit={handleSaveService}>
              <div className="form-group">
                <label className="form-label">Nome do Serviço</label>
                <input type="text" className="form-input" placeholder="Ex: Corte de cabelo completo" value={newServiceName} onChange={(e) => setNewServiceName(e.target.value)} required />
              </div>

              <div className="form-group">
                <label className="form-label">Descrição do Serviço</label>
                <textarea className="form-input" placeholder="Ex: Lavagem simples inclusa..." value={newServiceDescription} onChange={(e) => setNewServiceDescription(e.target.value)} style={{ minHeight: '60px', resize: 'vertical' }} />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                <div className="form-group">
                  <label className="form-label">Preço (R$)</label>
                  <input type="number" step="0.01" className="form-input" placeholder="Ex: 45.00" value={newServicePrice} onChange={(e) => setNewServicePrice(e.target.value)} required />
                </div>

                <div className="form-group">
                  <label className="form-label">Duração (Minutos)</label>
                  <input type="number" className="form-input" placeholder="Ex: 30" value={newServiceDuration} onChange={(e) => setNewServiceDuration(parseInt(e.target.value, 10))} required />
                </div>
              </div>

              <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end', marginTop: '24px' }}>
                <button type="button" className="btn-secondary" onClick={() => setShowServiceModal(false)}>Cancelar</button>
                <button type="submit" className="btn-primary">{editingServiceId ? 'Salvar Alterações' : 'Criar Serviço'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: MANAGE BARBER SERVICES ASSIGNMENT */}
      {showBarberServicesModal && selectedBarberForServices && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.8)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 999, padding: '20px' }}>
          <div className="glass-panel animate-fade-in" style={{ width: '100%', maxWidth: '500px', padding: '32px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
              <h3 style={{ fontSize: '20px' }}>Atribuir Serviços a {selectedBarberForServices.name}</h3>
              <button className="btn-secondary" style={{ padding: '6px', border: 'none', color: 'var(--muted)' }} onClick={() => setShowBarberServicesModal(false)}><X size={20} /></button>
            </div>

            <p style={{ fontSize: '13px', color: 'var(--muted)', marginBottom: '16px', lineHeight: '1.4' }}>
              Selecione quais serviços o profissional *{selectedBarberForServices.name}* está qualificado e disponível para realizar:
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', maxHeight: '300px', overflowY: 'auto', paddingRight: '4px' }}>
              {services.length === 0 ? (
                <p style={{ color: 'var(--muted)', textAlign: 'center', padding: '20px' }}>Cadastre serviços primeiro na aba Serviços.</p>
              ) : (
                services.map((service) => {
                  const isChecked = assignedServiceIds.includes(service.id);
                  return (
                    <div 
                      key={service.id} 
                      style={{ 
                        display: 'flex', 
                        flexDirection: 'column', 
                        gap: '10px', 
                        padding: '14px', 
                        background: 'rgba(255,255,255,0.02)', 
                        borderRadius: '8px', 
                        border: isChecked ? '1px solid var(--primary)' : '1px solid rgba(255,255,255,0.04)',
                        fontSize: '14px'
                      }}
                    >
                      <label style={{ display: 'flex', alignItems: 'center', gap: '12px', cursor: 'pointer', margin: 0, userSelect: 'none' }}>
                        <input 
                          type="checkbox" 
                          checked={isChecked} 
                          onChange={() => handleToggleServiceAssignment(service.id)} 
                          style={{ cursor: 'pointer', width: '16px', height: '16px' }}
                        />
                        <div style={{ flex: 1 }}>
                          <strong>{service.name}</strong>
                          <span style={{ fontSize: '12px', color: 'var(--muted)', marginLeft: '8px' }}>R$ {parseFloat(service.price).toFixed(2)} ({service.duration_minutes} min)</span>
                        </div>
                      </label>

                      {isChecked && (
                        <div className="animate-scale-in" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginTop: '4px', borderTop: '1px dashed rgba(255,255,255,0.05)', paddingTop: '10px' }}>
                          <div>
                            <label style={{ fontSize: '11px', color: 'var(--muted)', display: 'block', marginBottom: '4px' }}>Preço Personalizado (R$)</label>
                            <input 
                              type="number" 
                              step="0.01" 
                              className="form-input" 
                              style={{ margin: 0, padding: '6px 10px', fontSize: '13px' }} 
                              placeholder={`Padrão: R$ ${parseFloat(service.price).toFixed(2)}`} 
                              value={customPrices[service.id] || ''}
                              onChange={(e) => setCustomPrices(prev => ({ ...prev, [service.id]: e.target.value }))}
                            />
                          </div>
                          <div>
                            <label style={{ fontSize: '11px', color: 'var(--muted)', display: 'block', marginBottom: '4px' }}>Tempo Personalizado (min)</label>
                            <input 
                              type="number" 
                              className="form-input" 
                              style={{ margin: 0, padding: '6px 10px', fontSize: '13px' }} 
                              placeholder={`Padrão: ${service.duration_minutes} min`} 
                              value={customDurations[service.id] || ''}
                              onChange={(e) => setCustomDurations(prev => ({ ...prev, [service.id]: e.target.value }))}
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>

            <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end', marginTop: '24px' }}>
              <button type="button" className="btn-secondary" onClick={() => setShowBarberServicesModal(false)}>Cancelar</button>
              <button type="button" className="btn-primary" onClick={handleSaveBarberServices} disabled={services.length === 0}>Salvar Alterações</button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: QUICK OPTION BRANCH CREATION */}
      {showQuickOptionModal && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.8)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 999, padding: '20px' }}>
          <div className="glass-panel animate-fade-in" style={{ width: '100%', maxWidth: '400px', padding: '32px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
              <h3 style={{ fontSize: '20px', fontWeight: 'bold' }}>Criar Opção de Atalho</h3>
              <button className="btn-secondary" style={{ padding: '6px', border: 'none', color: 'var(--muted)' }} onClick={() => setShowQuickOptionModal(false)}><X size={20} /></button>
            </div>

            <form onSubmit={handleCreateQuickOption} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {quickOptionError && (
                <div style={{ padding: '10px', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)', color: '#f87171', borderRadius: '6px', fontSize: '13px' }}>
                  {quickOptionError}
                </div>
              )}
              
              <div className="form-group">
                <label className="form-label">Número/Chave (Digitada pelo Cliente)</label>
                <input 
                  type="text" 
                  className="form-input" 
                  placeholder="Ex: 1, 2, 3, a, b" 
                  value={quickOptionKey} 
                  onChange={(e) => {
                    setQuickOptionKey(e.target.value);
                    setQuickOptionError('');
                  }} 
                  required 
                />
              </div>

              <div className="form-group">
                <label className="form-label">Rótulo/Roteamento da Opção</label>
                <input 
                  type="text" 
                  className="form-input" 
                  placeholder="Ex: Agendar Horário" 
                  value={quickOptionLabel} 
                  onChange={(e) => {
                    setQuickOptionLabel(e.target.value);
                    setQuickOptionError('');
                  }} 
                  required 
                />
              </div>

              <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end', marginTop: '12px' }}>
                <button type="button" className="btn-secondary" onClick={() => setShowQuickOptionModal(false)}>Cancelar</button>
                <button type="submit" className="btn-primary">Criar Opção</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Super Admin - WhatsApp Session Connection Modal */}
      {superConnectModalOpen && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0,0,0,0.85)',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          zIndex: 10000,
          padding: '20px',
          backdropFilter: 'blur(5px)'
        }}>
          <div className="card-premium animate-fade-in" style={{ maxWidth: '640px', width: '100%', padding: '28px', border: '1px solid rgba(255,255,255,0.06)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
              <div>
                <h3 style={{ fontSize: '18px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <MessageSquare size={20} style={{ color: 'var(--primary)' }} />
                  Conexão WhatsApp: {superConnectEstName}
                </h3>
                <span style={{ fontSize: '12px', color: 'var(--muted)' }}>Gerencie e escaneie a sessão correspondente</span>
              </div>
              <button 
                onClick={() => {
                  setSuperConnectModalOpen(false);
                  loadSuperAdminData(); // refresh list when modal closes
                }} 
                style={{ background: 'transparent', border: 'none', color: 'var(--muted)', cursor: 'pointer' }}
              >
                <X size={20} />
              </button>
            </div>

            <div style={{ display: 'flex', gap: '24px', marginTop: '16px' }} className="responsive-modal-flex">
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px' }}>
                  <div style={{ 
                    width: '10px', 
                    height: '10px', 
                    borderRadius: '50%', 
                    backgroundColor: modalBotStatus === 'connected' ? 'var(--success)' : modalBotStatus === 'qr_ready' ? 'var(--warning)' : 'var(--error)' 
                  }} />
                  <span style={{ fontWeight: '600', fontSize: '14px', textTransform: 'capitalize' }}>
                    {modalBotStatus === 'connected' ? 'Conectado (Online)' : modalBotStatus === 'qr_ready' ? 'Aguardando Leitura de QR Code' : modalBotStatus === 'connecting' ? 'Iniciando Serviço...' : 'Desconectado'}
                  </span>
                </div>

                <p style={{ fontSize: '13px', color: 'var(--muted)', lineHeight: '1.6', marginBottom: '16px' }}>
                  Conecte o WhatsApp para enviar notificações ativas.
                </p>

                <div style={{ padding: '12px', background: 'rgba(255,255,255,0.02)', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.04)', fontSize: '12px' }}>
                  <p style={{ fontWeight: '500', marginBottom: '4px' }}>Instruções:</p>
                  <ol style={{ color: 'var(--muted)', paddingLeft: '16px', lineHeight: '1.6' }}>
                    <li>Abra o WhatsApp no celular correspondente</li>
                    <li>Vá em Dispositivos Conectados</li>
                    <li>Clique em Conectar um Dispositivo</li>
                    <li>Aponte para o QR Code ao lado</li>
                  </ol>
                </div>

                {modalBotStatus !== 'disconnected' && modalBotStatus !== 'connecting' && (
                  <button 
                    className="btn-secondary" 
                    style={{ marginTop: '16px', color: 'var(--error)', borderColor: 'rgba(239, 68, 68, 0.2)', width: '100%', justifyContent: 'center', fontSize: '13px' }}
                    onClick={handleModalDisconnectBot}
                    disabled={modalRefreshingBot}
                  >
                    <X size={14} />
                    <span>Desconectar WhatsApp</span>
                  </button>
                )}
              </div>

              <div style={{ flex: 1, display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '260px', background: 'rgba(0,0,0,0.1)', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.03)' }}>
                {modalBotStatus === 'connected' ? (
                  <div style={{ textAlign: 'center', padding: '24px' }}>
                    <CheckCircle size={48} style={{ color: 'var(--success)', marginBottom: '12px' }} />
                    <h4 style={{ fontSize: '16px', color: 'var(--success)' }}>Conexão Estabelecida</h4>
                    <p style={{ color: 'var(--muted)', fontSize: '12px', marginTop: '6px' }}>Esta sessão está ativa e operacional.</p>
                  </div>
                ) : modalBotStatus === 'qr_ready' && modalBotQr ? (
                  <div style={{ textAlign: 'center', padding: '8px' }}>
                    <div style={{ background: '#ffffff', padding: '12px', borderRadius: '8px', display: 'inline-block' }}>
                      <img 
                        src={`https://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent(modalBotQr)}&size=200x200`} 
                        alt="WhatsApp Connection QR Code"
                        style={{ display: 'block' }}
                      />
                    </div>
                    <p style={{ fontSize: '11px', color: 'var(--muted)', marginTop: '10px' }}>QR Code atualizado dinamicamente.</p>
                  </div>
                ) : (
                  <div style={{ textAlign: 'center', padding: '24px', color: 'var(--muted)' }}>
                    <RefreshCw size={36} className="animate-spin" style={{ marginBottom: '12px', opacity: '0.5' }} />
                    <h4 style={{ fontSize: '14px' }}>Inicializando...</h4>
                    <p style={{ fontSize: '11px', marginTop: '4px' }}>Isso pode levar alguns segundos.</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}


    </div>
  );
};
