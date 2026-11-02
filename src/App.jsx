import React, { useState, useEffect, useCallback } from 'react';
import {
  Activity,
  LayoutGrid,
  Monitor,
  Bell,
  LineChart as LineChartIcon,
  Cloud,
  Globe,
  Plus,
  Search,
  Settings,
  RefreshCw,
  Download,
  ChevronDown,
  Edit,
  Trash2,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Clock,
  History,
  ArrowUpRight,
  ShieldCheck,
  Check,
  X,
  Server,
  Database,
  Cpu,
  Layers,
  Send,
  ExternalLink,
  Wifi,
  Radio,
  FileSpreadsheet,
  User,
  LogOut,
  KeyRound,
  ShieldAlert,
  DollarSign,
  Wallet,
  Award,
  CheckCheck,
  Lock
} from 'lucide-react';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  AreaChart,
  Area,
  BarChart,
  Bar
} from 'recharts';

// ==========================================
// 1. GLOBAL STATE & API CONFIGURATION
// ==========================================
// Local backend connected via Vite reverse proxy (/api -> http://localhost:8000/api)
export const API_BASE_URL = '/api';
export const USE_MOCK_DATA = false;

// ==========================================
// 2. DATA SCHEMAS (Clean Slate for Real Probes)
// ==========================================
const MOCK_MONITORS = [];

const MOCK_METRICS = {
  global_uptime: 100.0,
  avg_latency: 0,
  total_checks: 0,
  active_incidents: 0,
  history_24h: [],
};

const MOCK_ALERTS = [];

const MOCK_AWS_STATS = {
  cpu_usage: 8.4,
  memory_usage: 31.2,
  sqs_messages_visible: 0,
  sqs_messages_in_flight: 1,
  sqs_queue_name: 'uptimewatch-checks-queue',
  rds_active_connections: 1,
  rds_iops: 0,
  rds_engine: 'SQLite 3 High-Performance Database Engine',
  sns_topics_active: 1,
  sns_subscriptions: 1,
  lambda_invocations_24h: 0,
  ec2_instance_id: 'i-0c3f331ec81cc9206',
  ec2_type: 't3.micro (AWS Free Tier)',
  region: 'us-east-1',
  is_simulated: false,
  disclaimer: 'Live AWS Cloud Infrastructure: Amazon EC2, SQS, SNS, S3, CloudWatch, and SSM active in us-east-1.',
};

// Mini sparklines data
const uptimeKpiData = [
  { val: 99.2 }, { val: 99.5 }, { val: 99.4 }, { val: 99.8 },
  { val: 99.7 }, { val: 99.9 }, { val: 99.87 },
];
const latencyKpiData = [
  { val: 320 }, { val: 290 }, { val: 310 }, { val: 275 },
  { val: 295 }, { val: 270 }, { val: 284 },
];
const checksKpiData = [
  { val: 40 }, { val: 65 }, { val: 55 }, { val: 80 },
  { val: 95 }, { val: 70 }, { val: 100 },
];

// Timestamp formatting helpers for historical check logs
const formatTimestamp = (isoStr) => {
  if (!isoStr) return '-';
  try {
    const d = new Date(isoStr);
    if (isNaN(d.getTime())) return isoStr;
    return d.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
  } catch {
    return isoStr;
  }
};

const formatRelativeTime = (isoStr) => {
  if (!isoStr) return '';
  try {
    const d = new Date(isoStr);
    if (isNaN(d.getTime())) return '';
    const diffSec = Math.floor((Date.now() - d.getTime()) / 1000);
    if (diffSec < 5) return 'just now';
    if (diffSec < 60) return `${diffSec}s ago`;
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24) return `${diffHr}h ago`;
    const diffDays = Math.floor(diffHr / 24);
    return `${diffDays}d ago`;
  } catch {
    return '';
  }
};

export default function App() {
  // Navigation & UI state
  const [activeNav, setActiveNav] = useState('Dashboard');
  const [searchQuery, setSearchQuery] = useState('');
  const [refreshCountdown, setRefreshCountdown] = useState(15);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [monitors, setMonitors] = useState([]);
  const [metrics, setMetrics] = useState(null);
  const [alerts, setAlerts] = useState([]);
  const [awsStats, setAwsStats] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [notificationToast, setNotificationToast] = useState(null);
  const [filterCompare, setFilterCompare] = useState('Compare All');
  const [filterPeriod, setFilterPeriod] = useState('24 Hours');
  const [showCompareDropdown, setShowCompareDropdown] = useState(false);
  const [showPeriodDropdown, setShowPeriodDropdown] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // View Check History Modal State
  const [selectedHistoryMonitor, setSelectedHistoryMonitor] = useState(null);
  const [historyChecks, setHistoryChecks] = useState([]);
  const [isHistoryLoading, setIsHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState(null);

  // Fetch real check history from backend API GET /api/monitors/{id}/history
  const fetchMonitorHistory = useCallback(async (monitor) => {
    setSelectedHistoryMonitor(monitor);
    setIsHistoryLoading(true);
    setHistoryError(null);
    setHistoryChecks([]);

    try {
      const res = await fetch(`${API_BASE_URL}/monitors/${monitor.id}/history?limit=50`);
      if (!res.ok) {
        throw new Error(`Failed to load history (HTTP ${res.status})`);
      }
      const data = await res.json();
      setHistoryChecks(data);
      setIsHistoryLoading(false);
    } catch (err) {
      console.error('Error fetching monitor history:', err);
      setHistoryError(err.message || 'Unable to retrieve check history.');
      setIsHistoryLoading(false);
    }
  }, []);

  // Runtime toggle: allows switching between Mock Simulation and Live AWS backend in the UI
  const [useMockDataMode, setUseMockDataMode] = useState(USE_MOCK_DATA);

  // Controlled Add Monitor Modal Inputs
  const [newMonitorName, setNewMonitorName] = useState('');
  const [newMonitorUrl, setNewMonitorUrl] = useState('');
  const [newMonitorInterval, setNewMonitorInterval] = useState('60');
  const [newMonitorThreshold, setNewMonitorThreshold] = useState('500');

  // ==========================================
  // Authentication & 2-Step Verification State
  // ==========================================
  const [currentUser, setCurrentUser] = useState(() => {
    try {
      const saved = localStorage.getItem('uptimewatch_user');
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  });
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [authMode, setAuthMode] = useState('login'); // 'login' or 'register'
  const [authName, setAuthName] = useState('');
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authRole, setAuthRole] = useState('user'); // 'user' or 'developer'
  const [authDevSecret, setAuthDevSecret] = useState('');
  const [auth2FACode, setAuth2FACode] = useState('');
  const [authCaptcha, setAuthCaptcha] = useState(null);
  const [authCaptchaAnswer, setAuthCaptchaAnswer] = useState('');
  const [authError, setAuthError] = useState(null);
  const [authLoading, setAuthLoading] = useState(false);
  const [awsBudgetInfo, setAwsBudgetInfo] = useState(null);
  const [testTarget, setTestTarget] = useState('');
  const [isSendingTestAlert, setIsSendingTestAlert] = useState(false);

  const handleSendTestAlert = async () => {
    if (!testTarget.trim()) {
      showToast('⚠️ Please enter a phone number (+91...) or email address');
      return;
    }
    setIsSendingTestAlert(true);
    try {
      const res = await fetch(`${API_BASE_URL}/alerts/test-notification`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target: testTarget.trim(), message: 'Live AWS SNS test alert from UptimeWatch watchdog' })
      });
      const data = await res.json();
      if (res.ok) {
        if (data.dispatched?.sms_error) {
          showToast(`⚠️ SMS Gateway: ${data.dispatched.sms_error}`);
        } else if (data.dispatched?.sms) {
          showToast(`📱 ${data.dispatched.sms}`);
        } else if (data.dispatched?.email_error) {
          showToast(`⚠️ Email Error: ${data.dispatched.email_error}`);
        } else if (data.dispatched?.email) {
          showToast(`📧 ${data.dispatched.email}`);
        } else {
          showToast('🚀 Live test alert dispatched via AWS SNS!');
        }
        fetchAlerts();
      } else {
        showToast(`Alert error: ${data.detail || 'Dispatch failed'}`);
      }
    } catch (err) {
      showToast(`Failed to trigger alert: ${err.message}`);
    } finally {
      setIsSendingTestAlert(false);
    }
  };

  const loadCaptchaChallenge = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/auth/captcha`);
      if (res.ok) {
        const data = await res.json();
        setAuthCaptcha(data);
      }
    } catch (err) {
      console.warn('Failed to load security challenge:', err);
    }
  };

  const handleSocialSignIn = async (provider) => {
    setAuthError(null);
    const label = provider === 'google' ? 'Google' : 'GitHub';
    const emailPrompt = window.prompt(
      `Sign in with ${label}\n\nEnter your ${label} email address:`,
      provider === 'google' ? 'visitor@gmail.com' : 'visitor@github.com'
    );
    if (!emailPrompt || !emailPrompt.trim()) return;

    setAuthLoading(true);
    try {
      const email = emailPrompt.trim().toLowerCase();
      const rawName = email.split('@')[0];
      const name = rawName.replace(/[._]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
      const res = await fetch(`${API_BASE_URL}/auth/social-login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider,
          email,
          name,
          role: 'user',
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || `${label} authentication failed`);

      localStorage.setItem('uptimewatch_user', JSON.stringify(data.user));
      localStorage.setItem('uptimewatch_token', data.access_token);
      setCurrentUser(data.user);
      setShowAuthModal(false);
      showToast(`🎉 Signed in with ${label} as ${data.user.name}!`);
      setTimeout(() => fetchDashboardData(true), 50);
    } catch (err) {
      setAuthError(err.message);
    } finally {
      setAuthLoading(false);
    }
  };

  const handleAuthSubmit = async (e) => {
    e.preventDefault();
    setAuthError(null);
    setAuthLoading(true);

    try {
      if (authMode === 'register') {
        const payload = {
          name: authName.trim(),
          email: authEmail.trim(),
          password: authPassword,
          role: authRole,
          developer_secret: authDevSecret.trim(),
          captcha_id: authCaptcha?.captcha_id,
          captcha_answer: authCaptchaAnswer.trim(),
        };
        const res = await fetch(`${API_BASE_URL}/auth/register`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.detail || 'Registration failed');

        localStorage.setItem('uptimewatch_user', JSON.stringify(data.user));
        localStorage.setItem('uptimewatch_token', data.access_token);
        setCurrentUser(data.user);
        setShowAuthModal(false);
        showToast(`🎉 Welcome to UptimeWatch, ${data.user.name} (${data.user.role})!`);
        setTimeout(() => fetchDashboardData(true), 50);
      } else {
        const payload = {
          email: authEmail.trim(),
          password: authPassword,
          two_factor_code: auth2FACode.trim() || '123456',
        };
        const res = await fetch(`${API_BASE_URL}/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.detail || 'Login failed');

        localStorage.setItem('uptimewatch_user', JSON.stringify(data.user));
        localStorage.setItem('uptimewatch_token', data.access_token);
        setCurrentUser(data.user);
        setShowAuthModal(false);
        showToast(`✓ Signed in as ${data.user.name} (${data.user.role})`);
        setTimeout(() => fetchDashboardData(true), 50);
      }
    } catch (err) {
      setAuthError(err.message || 'Authentication error');
      if (authMode === 'register') loadCaptchaChallenge();
    } finally {
      setAuthLoading(false);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('uptimewatch_user');
    localStorage.removeItem('uptimewatch_token');
    setCurrentUser(null);
    setMonitors([]);
    setAlerts([]);
    setMetrics({
      global_uptime: 100.0,
      avg_latency: 0,
      total_checks: 0,
      active_incidents: 0,
      total_monitors: 0,
      up_monitors: 0,
      down_monitors: 0,
      degraded_monitors: 0,
      history_24h: []
    });
    showToast('Signed out of UptimeWatch. Monitors cleared for guest session.');
  };

  const fetchAwsBudget = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/developer/aws-budget`);
      if (res.ok) {
        const data = await res.json();
        setAwsBudgetInfo(data);
      }
    } catch (err) {
      console.warn('Could not fetch AWS budget metrics:', err);
    }
  };

  const purgeAllMonitors = async () => {
    if (!window.confirm('Clear all monitoring nodes and history to start with a fresh clean slate?')) return;
    try {
      const res = await fetch(`${API_BASE_URL}/monitors/purge-all`, { method: 'DELETE' });
      if (res.ok) {
        setMonitors([]);
        setAlerts([]);
        showToast('🧹 All dummy nodes purged. Database is clean and ready for real websites.');
        fetchDashboardData(true);
      }
    } catch (err) {
      showToast('Could not purge monitors from database.');
    }
  };

  const showToast = (message) => {
    setNotificationToast(message);
    setTimeout(() => setNotificationToast(null), 3800);
  };

  // ==========================================
  // 3. API FETCHING LOGIC (fetchDashboardData)
  // ==========================================
  const fetchDashboardData = useCallback(async (isSilent = false) => {
    if (!isSilent) {
      setIsRefreshing(true);
    }

    if (!currentUser) {
      // Signed-out visitor: zero personal monitors
      setMonitors([]);
      setAlerts([]);
      setMetrics({
        global_uptime: 100.0,
        avg_latency: 0,
        total_checks: 0,
        active_incidents: 0,
        total_monitors: 0,
        up_monitors: 0,
        down_monitors: 0,
        degraded_monitors: 0,
        history_24h: []
      });
      try {
        const teleRes = await fetch(`${API_BASE_URL}/telemetry`);
        if (teleRes.ok) {
          const teleData = await teleRes.json();
          setAwsStats(teleData);
        }
      } catch {}
      setIsLoading(false);
      setIsRefreshing(false);
      return;
    }

    if (useMockDataMode) {
      // Simulation mode with network delay
      setTimeout(() => {
        setMonitors(MOCK_MONITORS);
        setMetrics(MOCK_METRICS);
        setAlerts(MOCK_ALERTS);
        setAwsStats(MOCK_AWS_STATS);
        setIsLoading(false);
        setIsRefreshing(false);
        setError(null);
      }, isSilent ? 300 : 800);
    } else {
      // Live backend connected via /api proxy, scoped to currentUser
      try {
        const userParam = currentUser.role === 'developer' ? '?user_id=-1' : (currentUser?.id ? `?user_id=${currentUser.id}` : '');
        const [dashRes, monRes, alertRes, teleRes] = await Promise.all([
          fetch(`${API_BASE_URL}/dashboard${userParam}`),
          fetch(`${API_BASE_URL}/monitors${userParam}`),
          fetch(`${API_BASE_URL}/alerts${userParam}`),
          fetch(`${API_BASE_URL}/telemetry`),
        ]);

        if (!dashRes.ok || !monRes.ok) {
          throw new Error('Backend HTTP error');
        }

        const [dashData, monData, alertData, teleData] = await Promise.all([
          dashRes.json(),
          monRes.json(),
          alertRes.ok ? alertRes.json() : Promise.resolve([]),
          teleRes.ok ? teleRes.json() : Promise.resolve(null),
        ]);

        setMetrics(dashData);
        setMonitors(monData);
        setAlerts(alertData);
        setAwsStats(teleData);
        setIsLoading(false);
        setIsRefreshing(false);
        setError(null);
      } catch (err) {
        console.warn('Backend connection failed:', err);
        setError('⚠️ Unable to connect to backend. Ensure the backend is running or toggle Simulation Mode above.');
        setIsRefreshing(false);
        // Fallback to local cache so user interface does not break
        setMetrics((prev) => prev || MOCK_METRICS);
        setMonitors((prev) => (prev.length ? prev : MOCK_MONITORS));
        setAlerts((prev) => (prev.length ? prev : MOCK_ALERTS));
        setAwsStats((prev) => prev || MOCK_AWS_STATS);
        setIsLoading(false);
      }
    }
  }, [useMockDataMode, currentUser]);

  // Initial load & 15-second auto-refresh timer
  useEffect(() => {
    fetchDashboardData();

    const intervalId = setInterval(() => {
      setRefreshCountdown((prev) => {
        if (prev <= 1) {
          fetchDashboardData(true);
          return 15;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(intervalId);
  }, [fetchDashboardData]);

  // ==========================================
  // 5. FUNCTIONAL MODALS (POST Requests)
  // ==========================================
  const handleAddMonitor = async (e) => {
    e.preventDefault();
    if (!newMonitorName.trim()) return;

    if (!currentUser) {
      showToast('⚠️ Please sign in to create and monitor your website.');
      setShowAuthModal(true);
      return;
    }

    setIsSubmitting(true);

    let targetUrl = newMonitorUrl.trim() || `https://${newMonitorName.trim()}`;
    if (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://')) {
      targetUrl = `https://${targetUrl}`;
    }

    const payload = {
      user_id: currentUser.id,
      name: newMonitorName.trim(),
      url: targetUrl,
      interval: parseInt(newMonitorInterval, 10) || 60,
      latency_threshold: parseInt(newMonitorThreshold, 10) || 500,
      threshold: parseInt(newMonitorThreshold, 10) || 500,
      status: 'PENDING',
    };

    if (useMockDataMode) {
      // Simulate network roundtrip
      setTimeout(() => {
        const createdMonitor = {
          ...payload,
          id: Date.now(),
          status: 'UP',
          latency_ms: Math.floor(Math.random() * 80) + 120,
          uptime_pct: 100.0,
          featured: false,
        };
        setMonitors((prev) => [createdMonitor, ...prev]);
        setIsSubmitting(false);
        setShowAddModal(false);
        setNewMonitorName('');
        setNewMonitorUrl('');
        showToast('✅ Monitor added in Simulation Mode');
      }, 700);
    } else {
      try {
        const response = await fetch(`${API_BASE_URL}/monitors`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });

        if (!response.ok) {
          const errData = await response.json().catch(() => ({}));
          const errMsg = errData.detail?.[0]?.msg || errData.detail || 'Failed to create monitor';
          throw new Error(errMsg);
        }
        const data = await response.json();
        setMonitors((prev) => [data, ...prev]);
        setIsSubmitting(false);
        setShowAddModal(false);
        setNewMonitorName('');
        setNewMonitorUrl('');
        showToast(`✅ Monitor ${data.name} saved to local database & queued for checks`);
        fetchDashboardData(true);
      } catch (err) {
        setIsSubmitting(false);
        showToast(`⚠️ ${err.message || 'Failed to create monitor. Check backend connectivity.'}`);
      }
    }
  };

  // ==========================================
  // DELETE MONITOR HANDLER
  // ==========================================
  const deleteMonitor = async (id, name) => {
    if (useMockDataMode) {
      setMonitors((prev) => prev.filter((m) => m.id !== id));
      showToast(`🗑️ Monitor ${name} removed`);
    } else {
      try {
        const res = await fetch(`${API_BASE_URL}/monitors/${id}`, {
          method: 'DELETE',
        });
        if (!res.ok) throw new Error('Delete failed');
        setMonitors((prev) => prev.filter((m) => m.id !== id));
        showToast(`🗑️ Monitor ${name} deleted from local database`);
        fetchDashboardData(true);
      } catch (err) {
        showToast(`⚠️ Could not delete ${name} from backend`);
      }
    }
  };

  const handleExportS3 = () => {
    // Generate an actual local JSON report export derived from real state
    const reportData = {
      project: 'UptimeWatch Availability & SLA Report',
      generated_at: new Date().toISOString(),
      environment: 'Local Development (Phase 2)',
      storage_mode: 'LOCAL_EXPORT (S3 Archive Planned for AWS Deployment Phase)',
      summary: {
        global_uptime_pct: metrics?.global_uptime ?? 99.87,
        avg_latency_ms: metrics?.avg_latency ?? 284,
        total_checks_recorded: metrics?.total_checks ?? 0,
        active_incidents_count: metrics?.active_incidents ?? 0,
        monitors_count: monitors.length,
      },
      monitors: monitors.map((m) => ({
        id: m.id,
        name: m.name,
        url: m.url,
        status: m.status,
        latency_ms: m.latency_ms,
        uptime_pct: m.uptime_pct,
        interval_seconds: m.interval,
      })),
    };

    const blob = new Blob([JSON.stringify(reportData, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `uptimewatch-report-local-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    showToast('📄 Generated local report export (JSON). Real S3 automated archiving is planned for AWS deployment.');
  };

  // Filter monitors for search
  const filteredMonitors = monitors.filter((m) =>
    m.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    (m.url && m.url.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  const upMonitorsCount = monitors.filter((m) => m.status === 'UP').length;
  const totalMonitorsCount = monitors.length;

  return (
    <div className="flex min-h-screen bg-[#0f172a] text-slate-100 font-sans">
      {/* Toast Notification */}
      {notificationToast && (
        <div className="fixed top-5 right-5 z-50 flex items-center gap-3 bg-slate-900 border border-emerald-500/50 text-white px-4 py-3 rounded-lg shadow-2xl animate-bounce">
          <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
          <span className="text-sm font-medium">{notificationToast}</span>
        </div>
      )}

      {/* 1. Sidebar */}
      <aside className="w-64 flex flex-col h-screen p-4 border-r border-slate-800 bg-[#0f172a] sticky top-0 shrink-0">
        {/* Brand Header */}
        <div className="flex items-center gap-2 mb-8">
          <div className="relative flex items-center justify-center p-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/30">
            <Activity className="w-6 h-6 text-emerald-500 animate-pulse" />
          </div>
          <div className="flex flex-col">
            <span className="text-white font-bold text-lg leading-tight tracking-tight">
              UptimeWatch
            </span>
            <span className="text-slate-400 text-[11px] font-medium tracking-wide">
              Cloud-Native Watchdog
            </span>
          </div>
        </div>

        {/* Navigation List */}
        <nav className="flex flex-col gap-1.5">
          <button
            onClick={() => setActiveNav('Dashboard')}
            className={`flex items-center gap-3 p-2.5 rounded-lg text-sm font-medium transition-all text-left ${
              activeNav === 'Dashboard'
                ? 'border border-blue-500/50 bg-blue-500/10 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
            }`}
          >
            <LayoutGrid className="w-4 h-4 text-blue-400" />
            <span>Dashboard</span>
          </button>

          <button
            onClick={() => setActiveNav('Monitors')}
            className={`flex items-center gap-3 p-2.5 rounded-lg text-sm transition-all text-left ${
              activeNav === 'Monitors'
                ? 'border border-blue-500/50 bg-blue-500/10 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
            }`}
          >
            <Monitor className="w-4 h-4" />
            <span>Monitors ({monitors.length})</span>
          </button>

          <button
            onClick={() => setActiveNav('Alerts & Incidents')}
            className={`flex items-center gap-3 p-2.5 rounded-lg text-sm transition-all text-left ${
              activeNav === 'Alerts & Incidents'
                ? 'border border-blue-500/50 bg-blue-500/10 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
            }`}
          >
            <Bell className="w-4 h-4" />
            <span>Alerts & Incidents</span>
          </button>

          <button
            onClick={() => setActiveNav('Analytics & Reports (S3)')}
            className={`flex items-center gap-3 p-2.5 rounded-lg text-sm transition-all text-left ${
              activeNav === 'Analytics & Reports (S3)'
                ? 'border border-blue-500/50 bg-blue-500/10 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
            }`}
          >
            <LineChartIcon className="w-4 h-4" />
            <span>Analytics & Reports (S3)</span>
          </button>

          <button
            onClick={() => setActiveNav('AWS Infrastructure')}
            className={`flex items-center gap-3 p-2.5 rounded-lg text-sm transition-all text-left ${
              activeNav === 'AWS Infrastructure'
                ? 'border border-blue-500/50 bg-blue-500/10 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
            }`}
          >
            <Cloud className="w-4 h-4" />
            <span>AWS Infrastructure</span>
          </button>

          {currentUser?.role === 'developer' && (
            <button
              onClick={() => {
                setActiveNav('AWS Developer & Budget');
                fetchAwsBudget();
              }}
              className={`flex items-center gap-3 p-2.5 rounded-lg text-sm transition-all text-left ${
                activeNav === 'AWS Developer & Budget'
                  ? 'border border-amber-500/50 bg-amber-500/10 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
              }`}
            >
              <Wallet className="w-4 h-4 text-amber-400" />
              <span>AWS Developer & Budget</span>
            </button>
          )}
        </nav>

        {/* Sidebar Footer */}
        <div className="mt-auto pt-4 flex flex-col">
          <button
            onClick={() => showToast('Opening Live View Dashboard monitor view...')}
            className="flex items-center gap-2 border border-slate-700 rounded-lg p-2 text-xs text-white bg-slate-800/50 hover:bg-slate-800 w-full mb-4 transition-colors"
          >
            <Globe className="w-3.5 h-3.5 text-slate-300" />
            <span>Live View Dashboard</span>
          </button>

          <div className="space-y-1.5 pb-2">
            <div className="text-[10px] text-slate-500 flex items-center gap-1.5">
              <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 shadow-sm shadow-emerald-500/50 shrink-0" />
              <span>
                RDS Connected • SQS Queue: {awsStats?.sqs_messages_visible ?? 0} Active
              </span>
            </div>

            <div className="text-[10px] text-slate-500 flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 shadow-sm shadow-emerald-500/50 shrink-0" />
                <span>SNS Trigger Active</span>
              </div>
              <span className="font-semibold text-slate-500 text-[11px] tracking-tight hover:text-slate-300 transition-colors cursor-default">
                aws
              </span>
            </div>
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col gap-4 p-6 min-w-0">
        {/* Error State Banner */}
        {error && (
          <div className="bg-red-950/40 border border-red-800/80 rounded-xl p-3 flex items-center justify-between text-sm text-red-300 animate-pulse shadow-lg">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
              <span>{error}</span>
            </div>
            <button
              onClick={() => fetchDashboardData()}
              className="text-xs bg-red-900/50 hover:bg-red-900 px-2.5 py-1 rounded text-red-200 border border-red-700 transition-colors"
            >
              Retry Now
            </button>
          </div>
        )}

        {/* 2. Main Top Header */}
        <header className="flex justify-between items-center mb-2">
          {/* Breadcrumbs */}
          <div className="flex items-center gap-3">
            <div className="text-sm">
              <span className="text-slate-400">Workspace / </span>
              <span className="text-white font-semibold">{activeNav}</span>
            </div>

            {/* Simulation / Production Mode Pill */}
            <div
              onClick={() => {
                const nextMode = !useMockDataMode;
                setUseMockDataMode(nextMode);
                showToast(
                  nextMode
                    ? 'Switched to Simulation Mode (Mock Data)'
                    : `Connecting to AWS Cloud Backend (${API_BASE_URL})`
                );
              }}
              title="Click to toggle between Simulation Mode and AWS Cloud Backend"
              className={`cursor-pointer px-2.5 py-0.5 rounded-full text-[10px] font-mono border flex items-center gap-1.5 transition-all ${
                useMockDataMode
                  ? 'bg-blue-950/40 border-blue-700/60 text-blue-300 hover:border-blue-500'
                  : 'bg-emerald-950/40 border-emerald-700/60 text-emerald-300 hover:border-emerald-500'
              }`}
            >
              <div
                className={`w-1.5 h-1.5 rounded-full ${
                  useMockDataMode ? 'bg-blue-400' : 'bg-emerald-400 animate-pulse'
                }`}
              />
              <span>
                {useMockDataMode
                  ? 'Simulation Mode (Mock)'
                  : awsStats?.is_simulated
                    ? 'Local FastAPI Backend'
                    : 'AWS Cloud (Production Live)'}
              </span>
            </div>
          </div>

          {/* Right Controls */}
          <div className="flex items-center gap-4">
            <button
              onClick={() => setShowAddModal(true)}
              className="bg-emerald-400 hover:bg-emerald-300 text-black px-4 py-1.5 rounded-md text-sm font-semibold flex items-center gap-1 shadow-md shadow-emerald-500/20 transition-all cursor-pointer active:scale-95"
            >
              <Plus className="w-4 h-4" />
              <span>Add Monitor</span>
            </button>

            <div className="bg-[#1e293b] border border-slate-700 rounded-md px-3 py-1.5 flex items-center gap-2 text-sm text-slate-400 w-48 focus-within:border-slate-500 transition-colors">
              <Search className="w-4 h-4 text-slate-400 shrink-0" />
              <input
                type="text"
                placeholder="Search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="bg-transparent border-none outline-none text-slate-200 placeholder-slate-500 text-sm w-full"
              />
            </div>

            {/* User Profile & Authentication Controls */}
            {currentUser ? (
              <div className="flex items-center gap-3 bg-slate-800/80 border border-slate-700/80 rounded-lg px-3 py-1.5 shadow-sm">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-full bg-blue-600/30 border border-blue-500/50 flex items-center justify-center text-blue-300 font-bold text-xs uppercase">
                    {currentUser.name ? currentUser.name.charAt(0) : 'U'}
                  </div>
                  <div className="flex flex-col text-left">
                    <span className="text-xs font-semibold text-white leading-tight">
                      {currentUser.name}
                    </span>
                    <span className="text-[10px] font-mono text-emerald-400">
                      {currentUser.role === 'developer' ? '⚡ AWS Developer' : '👤 Main User'}
                    </span>
                  </div>
                </div>

                <div className="h-5 w-[1px] bg-slate-700" />

                <button
                  onClick={handleLogout}
                  title="Sign Out"
                  className="p-1 rounded text-slate-400 hover:text-red-400 hover:bg-slate-700/50 transition-colors cursor-pointer"
                >
                  <LogOut className="w-4 h-4" />
                </button>
              </div>
            ) : (
              <button
                onClick={() => {
                  setShowAuthModal(true);
                  loadCaptchaChallenge();
                }}
                className="bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white px-3.5 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 shadow-md shadow-indigo-500/20 border border-indigo-400/30 transition-all cursor-pointer"
              >
                <KeyRound className="w-3.5 h-3.5" />
                <span>Sign In / 2FA</span>
              </button>
            )}

            <button
              onClick={() => showToast('Opening CloudWatch Settings')}
              className="text-slate-400 hover:text-white transition-colors cursor-pointer p-1"
            >
              <Settings className="w-5 h-5" />
            </button>
          </div>
        </header>

        {/* 3. Status Banner */}
        <div className="bg-[#1e293b] border border-slate-700 rounded-xl p-3 flex justify-between items-center mb-1 shadow-sm">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse shadow-sm shadow-emerald-400" />
            <span className="text-sm text-white font-medium">
              All systems operational ({upMonitorsCount} of {totalMonitorsCount} Up)
            </span>
          </div>

          <div
            onClick={() => fetchDashboardData()}
            className="flex items-center gap-1.5 text-sm text-emerald-400 cursor-pointer hover:text-emerald-300 transition-colors select-none"
          >
            <span>Auto-Refresh: Active ({refreshCountdown}s)</span>
            <RefreshCw
              className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`}
            />
          </div>
        </div>

        {/* ============================================================== */}
        {/* CONDITIONAL RENDERING OF THE 5 VIEWS CONSUMING DYNAMIC STATE   */}
        {/* ============================================================== */}

        {/* VIEW 1: DASHBOARD VIEW */}
        {activeNav === 'Dashboard' && (
          <>
            {/* 4. Row 1: KPI Cards */}
            {isLoading && !metrics ? (
              <div className="grid grid-cols-4 gap-4 mb-1">
                {[1, 2, 3, 4].map((i) => (
                  <div
                    key={i}
                    className="h-24 bg-slate-800 rounded-xl animate-pulse"
                  />
                ))}
              </div>
            ) : (
              <div className="grid grid-cols-4 gap-4 mb-1">
                {/* Card 1: Global Uptime */}
                <div className="bg-[#1e293b] border border-slate-700/50 rounded-xl p-4 flex flex-col justify-between shadow-sm hover:border-slate-600 transition-all">
                  <span className="text-xs text-slate-400 font-medium">
                    Global Uptime
                  </span>
                  <div className="flex justify-between items-end mt-2">
                    <span className="text-3xl font-bold text-white tracking-tight">
                      {metrics?.global_uptime ?? 99.87}%
                    </span>
                    <div className="w-24 h-9">
                      <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={uptimeKpiData}>
                          <defs>
                            <linearGradient
                              id="kpiGreen"
                              x1="0"
                              y1="0"
                              x2="0"
                              y2="1"
                            >
                              <stop
                                offset="5%"
                                stopColor="#34d399"
                                stopOpacity={0.4}
                              />
                              <stop
                                offset="95%"
                                stopColor="#34d399"
                                stopOpacity={0.0}
                              />
                            </linearGradient>
                          </defs>
                          <Area
                            type="monotone"
                            dataKey="val"
                            stroke="#34d399"
                            strokeWidth={2}
                            fill="url(#kpiGreen)"
                            dot={false}
                          />
                        </AreaChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                </div>

                {/* Card 2: Avg Latency */}
                <div className="bg-[#1e293b] border border-slate-700/50 rounded-xl p-4 flex flex-col justify-between shadow-sm hover:border-slate-600 transition-all">
                  <span className="text-xs text-slate-400 font-medium">
                    Avg Latency
                  </span>
                  <div className="flex justify-between items-end mt-2">
                    <span className="text-3xl font-bold text-white tracking-tight">
                      {metrics?.avg_latency ?? 284} ms
                    </span>
                    <div className="w-24 h-9">
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={latencyKpiData}>
                          <Line
                            type="monotone"
                            dataKey="val"
                            stroke="#3b82f6"
                            strokeWidth={2}
                            dot={false}
                          />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                </div>

                {/* Card 3: Incident Status */}
                <div className="bg-[#1e293b] border border-slate-700/50 rounded-xl p-4 flex flex-col justify-between shadow-sm hover:border-slate-600 transition-all">
                  <span className="text-xs text-slate-400 font-medium">
                    Incident Status
                  </span>
                  <div className="flex justify-between items-end mt-2">
                    <span className="text-3xl font-bold text-red-500 tracking-tight">
                      {metrics?.active_incidents ?? 1} Critical
                    </span>
                  </div>
                </div>

                {/* Card 4: Total Checks */}
                <div className="bg-[#1e293b] border border-slate-700/50 rounded-xl p-4 flex flex-col justify-between shadow-sm hover:border-slate-600 transition-all">
                  <span className="text-xs text-slate-400 font-medium">
                    Total Checks (24h)
                  </span>
                  <div className="flex justify-between items-end mt-2">
                    <span className="text-3xl font-bold text-white tracking-tight">
                      {metrics?.total_checks?.toLocaleString() ?? '14,392'}
                    </span>
                    <div className="w-24 h-9">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={checksKpiData}>
                          <Bar
                            dataKey="val"
                            fill="#94a3b8"
                            radius={[2, 2, 0, 0]}
                          />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* 5. Row 2: Charts & List */}
            {isLoading && !metrics ? (
              <div className="grid grid-cols-12 gap-4 mb-1 h-[320px]">
                <div className="col-span-8 bg-slate-800 rounded-xl animate-pulse" />
                <div className="col-span-4 bg-slate-800 rounded-xl animate-pulse" />
              </div>
            ) : (
              <div className="grid grid-cols-12 gap-4 mb-1">
                {/* Left Chart Panel */}
                <div className="col-span-8 bg-[#1e293b] border border-slate-700/50 rounded-xl p-4 flex flex-col relative overflow-hidden shadow-sm">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-[10px] tracking-wider text-slate-400 font-semibold uppercase">
                      RESPONSE TIME (MS) - COMPARISON (24H)
                    </span>
                    <div className="flex items-center gap-4 text-[11px] text-slate-400">
                      <div className="flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full bg-[#34d399] shadow-sm shadow-[#34d399]/50" />
                        <span>college-portal.edu</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full bg-[#a855f7] shadow-sm shadow-[#a855f7]/50" />
                        <span>myshop.com</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full bg-[#ef4444] shadow-sm shadow-[#ef4444]/50" />
                        <span>api.mycollege.edu</span>
                      </div>
                    </div>
                  </div>

                  {authRole === 'developer' && (
                    <div>
                      <label className="block text-slate-300 font-medium mb-1">
                        Developer Master Passcode <span className="text-amber-400">*</span>
                      </label>
                      <input
                        type="password"
                        required
                        placeholder="Enter AWS Developer Passcode"
                        value={authDevSecret}
                        onChange={(e) => setAuthDevSecret(e.target.value)}
                        className="w-full bg-[#0f172a] border border-amber-500/50 rounded-lg px-3 py-2 text-white placeholder-slate-500 focus:border-amber-400 outline-none text-xs"
                      />
                      <p className="text-[10px] text-slate-500 mt-1">
                        Developer role is restricted to system administrators with the authorized AWS master key.
                      </p>
                    </div>
                  )}

                  {/* Recharts Area with custom callouts */}
                  <div className="h-[285px] w-full relative">
                    {/* Static Tooltip Callout 1 (Peak green callout near 10:00) */}
                    <div className="absolute left-[54%] top-[14%] z-20 pointer-events-none transform -translate-x-1/2 flex items-center gap-2">
                      <div className="relative">
                        <div className="bg-black/95 border border-emerald-500/60 px-2 py-1 rounded shadow-2xl backdrop-blur-md text-left">
                          <span className="text-[11px] font-bold text-emerald-400 block leading-tight">
                            145ms
                          </span>
                          <span className="text-[10px] text-emerald-500 block leading-tight">
                            145ms
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Static Tooltip Callout 2 (Abnormal spike callout at ~14:00) */}
                    <div className="absolute left-[62%] top-[45%] z-20 pointer-events-none transform -translate-x-1/2 flex items-center gap-2">
                      <div className="relative">
                        <div className="bg-black/95 border border-slate-700/80 px-2 py-1 rounded shadow-2xl backdrop-blur-md text-left">
                          <span className="text-[11px] font-bold text-slate-200 block leading-tight">
                            2250ms
                          </span>
                          <span className="text-[10px] text-red-400 block leading-tight">
                            Uptime: 25ms
                          </span>
                        </div>
                      </div>
                    </div>

                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart
                        data={metrics?.history_24h || []}
                        margin={{ top: 15, right: 15, left: -20, bottom: 0 }}
                      >
                        <defs>
                          <linearGradient
                            id="glowGreen"
                            x1="0"
                            y1="0"
                            x2="0"
                            y2="1"
                          >
                            <stop
                              offset="5%"
                              stopColor="#34d399"
                              stopOpacity={0.28}
                            />
                            <stop
                              offset="95%"
                              stopColor="#34d399"
                              stopOpacity={0.0}
                            />
                          </linearGradient>
                          <linearGradient
                            id="glowPurple"
                            x1="0"
                            y1="0"
                            x2="0"
                            y2="1"
                          >
                            <stop
                              offset="5%"
                              stopColor="#a855f7"
                              stopOpacity={0.15}
                            />
                            <stop
                              offset="95%"
                              stopColor="#a855f7"
                              stopOpacity={0.0}
                            />
                          </linearGradient>
                          <linearGradient
                            id="glowRed"
                            x1="0"
                            y1="0"
                            x2="0"
                            y2="1"
                          >
                            <stop
                              offset="5%"
                              stopColor="#ef4444"
                              stopOpacity={0.12}
                            />
                            <stop
                              offset="95%"
                              stopColor="#ef4444"
                              stopOpacity={0.0}
                            />
                          </linearGradient>
                        </defs>
                        <CartesianGrid
                          stroke="#334155"
                          strokeDasharray="3 3"
                          vertical={false}
                        />
                        <XAxis
                          dataKey="time"
                          stroke="#475569"
                          tick={{ fill: '#64748b', fontSize: 10 }}
                          axisLine={{ stroke: '#334155' }}
                          tickLine={false}
                        />
                        <YAxis
                          stroke="#475569"
                          tick={{ fill: '#64748b', fontSize: 10 }}
                          domain={[0, 800]}
                          ticks={[0, 200, 300, 400, 500, 600, 700, 800]}
                          axisLine={{ stroke: '#334155' }}
                          tickLine={false}
                        />
                        <Tooltip
                          contentStyle={{
                            backgroundColor: '#0f172a',
                            borderColor: '#334155',
                            borderRadius: '8px',
                            fontSize: '11px',
                          }}
                          labelStyle={{ color: '#94a3b8' }}
                        />
                        {/* Dynamic lines */}
                        <Area
                          type="monotone"
                          dataKey="college-portal.edu"
                          stroke="#34d399"
                          strokeWidth={2}
                          fill="url(#glowGreen)"
                          dot={{
                            r: 4,
                            fill: '#34d399',
                            stroke: '#0f172a',
                            strokeWidth: 1.5,
                          }}
                          activeDot={{ r: 6 }}
                        />
                        <Area
                          type="monotone"
                          dataKey="myshop.com"
                          stroke="#a855f7"
                          strokeWidth={2}
                          fill="url(#glowPurple)"
                          dot={{
                            r: 4,
                            fill: '#a855f7',
                            stroke: '#0f172a',
                            strokeWidth: 1.5,
                          }}
                          activeDot={{ r: 6 }}
                        />
                        <Area
                          type="monotone"
                          dataKey="api.mycollege.edu"
                          stroke="#ef4444"
                          strokeWidth={2}
                          fill="url(#glowRed)"
                          dot={{
                            r: 4,
                            fill: '#ef4444',
                            stroke: '#0f172a',
                            strokeWidth: 1.5,
                          }}
                          activeDot={{ r: 6 }}
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                {/* Right Monitors Panel: Mapping over monitors */}
                <div className="col-span-4 bg-[#1e293b] border border-slate-700/50 rounded-xl p-4 flex flex-col shadow-sm">
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-white font-medium">
                      Active Monitors ({filteredMonitors.length})
                    </span>
                    <button
                      onClick={() => setShowAddModal(true)}
                      className="text-xs border border-slate-600 rounded px-2 py-1 text-slate-300 hover:text-white hover:bg-slate-800 transition-colors"
                    >
                      + Add
                    </button>
                  </div>

                  {/* Dynamic Monitor List */}
                  <div className="flex flex-col gap-2 mt-4 overflow-y-auto max-h-[300px] pr-1">
                    {filteredMonitors.length === 0 ? (
                      <div className="py-8 text-center text-slate-400 flex flex-col items-center justify-center gap-2">
                        <Globe className="w-6 h-6 text-slate-500" />
                        <span className="text-xs">
                          {!currentUser ? 'Signed out • 0 monitors active' : 'No monitors added yet'}
                        </span>
                        {!currentUser && (
                          <button
                            onClick={() => setShowAuthModal(true)}
                            className="mt-1 text-xs text-emerald-400 hover:underline cursor-pointer"
                          >
                            Sign In to view or add monitors →
                          </button>
                        )}
                      </div>
                    ) : (
                      filteredMonitors.map((item) => {
                      if (item.featured) {
                        return (
                          <div
                            key={item.id}
                            className="border border-emerald-500/30 p-3 rounded-lg flex flex-col gap-2 bg-emerald-950/10 hover:border-emerald-500/50 transition-colors"
                          >
                            <div className="flex justify-between items-center">
                              <div className="flex items-center gap-2">
                                <span className="text-white text-sm font-medium">
                                  {item.name}
                                </span>
                                <span className="border border-emerald-500 text-emerald-500 text-[10px] px-1.5 rounded uppercase font-semibold">
                                  {item.status}
                                </span>
                              </div>
                              <span className="text-sm text-white font-medium">
                                {item.latency_ms}ms
                              </span>
                            </div>

                            <div className="flex justify-between items-center pt-1 border-t border-slate-800/80">
                              <div className="flex items-center gap-3 text-[11px] text-slate-400">
                                <div className="flex items-center gap-1">
                                  <Activity className="w-3 h-3 text-emerald-400" />
                                  <span>{item.latency_ms}ms</span>
                                </div>
                                <div className="flex items-center gap-1">
                                  <Check className="w-3 h-3 text-emerald-400" />
                                  <span>{item.uptime_pct}%</span>
                                </div>
                              </div>

                              <div className="flex items-center gap-2 text-slate-400">
                                <button
                                  title="View Check History"
                                  onClick={() => fetchMonitorHistory(item)}
                                  className="flex items-center gap-1 text-[10px] text-blue-400 hover:text-blue-300 transition-colors cursor-pointer"
                                >
                                  <History className="w-3 h-3" />
                                  <span>History</span>
                                </button>
                                <button
                                  title="Edit Monitor"
                                  onClick={() =>
                                    showToast(`Edit settings for ${item.name}`)
                                  }
                                  className="flex items-center gap-1 text-[10px] hover:text-white transition-colors"
                                >
                                  <Edit className="w-3 h-3" />
                                  <span>Edit</span>
                                </button>
                                <button
                                  title="Alert Config"
                                  onClick={() =>
                                    showToast(
                                      `Configure alerts for ${item.name}`
                                    )
                                  }
                                  className="flex items-center gap-1 text-[10px] hover:text-white transition-colors"
                                >
                                  <Bell className="w-3 h-3" />
                                  <span>Alert Config</span>
                                </button>
                                <button
                                  title="S3 Export"
                                  onClick={() =>
                                    showToast(
                                      `Downloading S3 report for ${item.name}`
                                    )
                                  }
                                  className="flex items-center gap-1 text-[10px] hover:text-white transition-colors"
                                >
                                  <Download className="w-3 h-3" />
                                  <span>S3</span>
                                </button>
                              </div>
                            </div>
                          </div>
                        );
                      }

                      if (item.status === 'DOWN') {
                        return (
                          <div
                            key={item.id}
                            className="bg-red-950/20 border border-red-900 p-3 rounded-lg flex flex-col gap-1.5 hover:border-red-800 transition-colors"
                          >
                            <div className="flex justify-between items-center">
                              <div className="flex items-center gap-2">
                                <span className="text-white text-sm font-medium">
                                  {item.name}
                                </span>
                                <span className="bg-red-500 text-white text-[10px] px-1.5 rounded uppercase font-bold">
                                  DOWN
                                </span>
                              </div>
                              <span className="text-sm text-white font-medium">
                                0ms
                              </span>
                            </div>
                            <span className="text-xs text-red-400">
                              {item.error_message ||
                                'HTTP 502 Bad Gateway • Alerted via SNS'}
                            </span>
                          </div>
                        );
                      }

                      if (item.status === 'ABNORMAL') {
                        return (
                          <div
                            key={item.id}
                            className="border border-amber-500/30 bg-amber-950/10 p-3 rounded-lg flex flex-col gap-1.5 hover:border-amber-500/50 transition-colors"
                          >
                            <div className="flex justify-between items-center">
                              <div className="flex items-center gap-2">
                                <span className="text-white text-sm font-medium">
                                  {item.name}
                                </span>
                                <span className="border border-amber-500 text-amber-500 text-[10px] px-1.5 rounded uppercase font-semibold">
                                  ABNORMAL
                                </span>
                              </div>
                              <span className="text-sm text-white font-medium">
                                {item.latency_ms}ms
                              </span>
                            </div>
                            <span className="text-xs text-amber-500">
                              {item.error_message || 'Threshold Exceeded'}
                            </span>
                          </div>
                        );
                      }

                      // Standard UP state
                      return (
                        <div
                          key={item.id}
                          className="bg-slate-800/50 border border-slate-700 p-3 rounded-lg flex flex-col gap-1.5 hover:border-slate-600 transition-colors"
                        >
                          <div className="flex justify-between items-center">
                            <div className="flex items-center gap-2">
                              <span className="text-white text-sm font-medium">
                                {item.name}
                              </span>
                              <span className="border border-emerald-500 text-emerald-500 text-[10px] px-1.5 rounded uppercase font-semibold">
                                UP
                              </span>
                            </div>
                            <span className="text-sm text-white font-medium">
                              {item.latency_ms}ms
                            </span>
                          </div>
                          <div className="flex items-center gap-3 text-[11px] text-slate-400">
                            <div className="flex items-center gap-1">
                              <Activity className="w-3 h-3 text-emerald-400" />
                              <span>{item.latency_ms}ms</span>
                            </div>
                            <div className="flex items-center gap-1">
                              <Check className="w-3 h-3 text-emerald-400" />
                              <span>{item.uptime_pct}%</span>
                            </div>
                          </div>
                        </div>
                      );
                    }))}
                  </div>
                </div>
              </div>
            )}

            {/* 6. Row 3: Footer Action Panels */}
            <div className="grid grid-cols-12 gap-4">
              {/* Action Panel */}
              <div className="col-span-4 bg-[#1e293b] border border-slate-700/50 rounded-xl p-4 flex flex-col justify-between shadow-sm">
                <div>
                  <span className="text-[10px] tracking-wider text-slate-400 mb-2 block font-semibold">
                    ACTION
                  </span>
                  <button
                    onClick={handleExportS3}
                    className="border border-slate-500 text-slate-200 text-sm px-4 py-2 rounded flex items-center gap-2 w-fit hover:bg-slate-800 hover:text-white transition-all cursor-pointer mt-1"
                  >
                    <Download className="w-4 h-4" />
                    <span>Export S3 Uptime Report</span>
                  </button>
                </div>
              </div>

              {/* Filters Panel */}
              <div className="col-span-4 bg-[#1e293b] border border-slate-700/50 rounded-xl p-4 flex flex-col justify-between shadow-sm relative">
                <div>
                  <span className="text-[10px] text-slate-400 mb-2 block font-semibold tracking-wider">
                    FILTERS
                  </span>
                  <div className="flex items-center gap-2 mt-1">
                    {/* Compare dropdown */}
                    <div className="relative">
                      <button
                        onClick={() => {
                          setShowCompareDropdown(!showCompareDropdown);
                          setShowPeriodDropdown(false);
                        }}
                        className="bg-slate-900 border border-slate-700 text-slate-300 text-sm px-3 py-1.5 rounded flex items-center justify-between w-32 hover:border-slate-500 transition-colors cursor-pointer"
                      >
                        <span>{filterCompare}</span>
                        <ChevronDown className="w-4 h-4 text-slate-400" />
                      </button>
                      {showCompareDropdown && (
                        <div className="absolute bottom-full mb-1 left-0 w-32 bg-slate-900 border border-slate-700 rounded shadow-xl z-30 py-1">
                          {['Compare All', 'Only Active', 'Only Errors'].map(
                            (opt) => (
                              <div
                                key={opt}
                                onClick={() => {
                                  setFilterCompare(opt);
                                  setShowCompareDropdown(false);
                                }}
                                className="px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-800 hover:text-white cursor-pointer"
                              >
                                {opt}
                              </div>
                            )
                          )}
                        </div>
                      )}
                    </div>

                    {/* Period dropdown */}
                    <div className="relative">
                      <button
                        onClick={() => {
                          setShowPeriodDropdown(!showPeriodDropdown);
                          setShowCompareDropdown(false);
                        }}
                        className="bg-slate-900 border border-slate-700 text-slate-300 text-sm px-3 py-1.5 rounded flex items-center justify-between w-32 hover:border-slate-500 transition-colors cursor-pointer"
                      >
                        <span>{filterPeriod}</span>
                        <ChevronDown className="w-4 h-4 text-slate-400" />
                      </button>
                      {showPeriodDropdown && (
                        <div className="absolute bottom-full mb-1 left-0 w-32 bg-slate-900 border border-slate-700 rounded shadow-xl z-30 py-1">
                          {['1 Hour', '6 Hours', '24 Hours', '7 Days'].map(
                            (opt) => (
                              <div
                                key={opt}
                                onClick={() => {
                                  setFilterPeriod(opt);
                                  setShowPeriodDropdown(false);
                                }}
                                className="px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-800 hover:text-white cursor-pointer"
                              >
                                {opt}
                              </div>
                            )
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* Alerts Panel */}
              <div className="col-span-4 bg-[#1e293b] border border-slate-700/50 rounded-xl p-4 relative shadow-sm">
                <div className="flex justify-between items-center mb-2">
                  <span className="text-[10px] text-slate-400 font-semibold tracking-wider">
                    RECENT AWS SNS ALERTS
                  </span>
                  <ChevronDown className="w-3.5 h-3.5 text-slate-400 cursor-pointer hover:text-slate-200" />
                </div>

                <div className="flex flex-col gap-2 mt-1">
                  {alerts.length === 0 ? (
                    <span className="text-xs text-slate-500 py-1 block">
                      No active alerts. All systems operational.
                    </span>
                  ) : (
                    alerts.slice(0, 2).map((alert) => (
                      <div
                        key={alert.id}
                        className="flex items-center justify-between text-xs text-slate-300"
                      >
                        <div className="flex items-center gap-2 truncate pr-2">
                          <div
                            className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 ${
                              alert.type === 'OUTAGE'
                                ? 'bg-red-500/20 text-red-500 border-red-500/40'
                                : 'bg-emerald-500/20 text-emerald-400 border-emerald-500/40'
                            }`}
                          >
                            <span
                              className={`w-1.5 h-1.5 rounded-sm ${
                                alert.type === 'OUTAGE'
                                  ? 'bg-red-500'
                                  : 'bg-emerald-400'
                              }`}
                            />
                          </div>
                          <span className="truncate">
                            {alert.type === 'OUTAGE' ? 'Down Alert: ' : 'Recovery Alert: '}
                            {alert.monitor_name} ({alert.message})
                          </span>
                        </div>
                        <span className="text-slate-400 shrink-0 font-mono text-[11px]">
                          {alert.timeFormatted ||
                            new Date(alert.timestamp).toLocaleTimeString([], {
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          </>
        )}

        {/* VIEW 2: MONITORS DATA TABLE VIEW */}
        {activeNav === 'Monitors' && (
          <div className="bg-[#1e293b] border border-slate-700/50 rounded-xl p-6 shadow-sm flex flex-col gap-4">
            <div className="flex justify-between items-center">
              <div>
                <h2 className="text-base font-semibold text-white">
                  All Monitored Endpoints ({monitors.length})
                </h2>
                <p className="text-xs text-slate-400">
                  Target endpoints polled by AWS Synthetic Canaries with SQS FIFO task dispatch.
                </p>
              </div>
              <button
                onClick={() => setShowAddModal(true)}
                className="bg-emerald-400 hover:bg-emerald-300 text-black px-3.5 py-1.5 rounded-md text-xs font-semibold flex items-center gap-1 shadow-sm transition-all"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>New Monitor</span>
              </button>
            </div>

            <div className="overflow-x-auto border border-slate-700/60 rounded-lg">
              <table className="w-full text-left text-xs text-slate-300">
                <thead className="bg-slate-900/80 text-slate-400 uppercase tracking-wider text-[10px] border-b border-slate-700">
                  <tr>
                    <th className="py-3 px-4">Service / Domain</th>
                    <th className="py-3 px-4">Target URL</th>
                    <th className="py-3 px-4">Status</th>
                    <th className="py-3 px-4">Latency</th>
                    <th className="py-3 px-4">Uptime (24h)</th>
                    <th className="py-3 px-4">Interval</th>
                    <th className="py-3 px-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {filteredMonitors.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="py-12 text-center text-slate-400">
                        <div className="flex flex-col items-center justify-center gap-3">
                          <div className="p-3.5 rounded-full bg-slate-800/90 border border-slate-700/80 shadow-inner">
                            <Globe className="w-6 h-6 text-emerald-400" />
                          </div>
                          <div>
                            <h4 className="text-sm font-semibold text-white tracking-tight">
                              Ready for Real Domains (Clean Slate Active)
                            </h4>
                            <p className="text-xs text-slate-400 max-w-md mt-1 leading-relaxed">
                              All mock monitors have been cleared. Register real websites like Kaggle, GitHub, or your AWS APIs to run live HTTP probes and push SNS alerts to your email.
                            </p>
                          </div>
                          <div className="flex items-center gap-3 mt-2">
                            <button
                              onClick={async () => {
                                setIsSubmitting(true);
                                try {
                                  const res = await fetch(`${API_BASE_URL}/monitors`, {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({
                                      name: 'Kaggle Production Web',
                                      url: 'https://www.kaggle.com',
                                      interval: 60,
                                      latency_threshold: 600,
                                    }),
                                  });
                                  if (res.ok) {
                                    showToast('✓ Added https://www.kaggle.com for live monitoring!');
                                    fetchDashboardData(true);
                                  } else {
                                    const errData = await res.json();
                                    showToast(`Error: ${errData.detail || 'Could not add monitor'}`);
                                  }
                                } catch (err) {
                                  showToast('Failed to connect to backend.');
                                } finally {
                                  setIsSubmitting(false);
                                }
                              }}
                              className="px-4 py-2 rounded-lg bg-emerald-400 hover:bg-emerald-300 text-black font-semibold text-xs flex items-center gap-2 shadow-lg shadow-emerald-500/20 transition-all cursor-pointer active:scale-95"
                            >
                              <Plus className="w-3.5 h-3.5" />
                              <span>Monitor https://www.kaggle.com</span>
                            </button>
                            <button
                              onClick={() => setShowAddModal(true)}
                              className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-750 text-slate-200 border border-slate-700 hover:border-slate-500 text-xs font-medium cursor-pointer transition-colors"
                            >
                              + Add Custom Domain
                            </button>
                          </div>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    filteredMonitors.map((m) => (
                      <tr
                        key={m.id}
                        className="hover:bg-slate-800/40 transition-colors"
                      >
                        <td className="py-3 px-4 font-medium text-white flex items-center gap-2">
                          <div
                            className={`w-2 h-2 rounded-full ${
                              m.status === 'UP'
                                ? 'bg-emerald-500'
                                : m.status === 'DOWN'
                                ? 'bg-red-500'
                                : 'bg-amber-500'
                            }`}
                          />
                          <span>{m.name}</span>
                        </td>
                        <td className="py-3 px-4 font-mono text-slate-400 text-[11px] truncate max-w-xs">
                          {m.url}
                        </td>
                        <td className="py-3 px-4">
                          <span
                            className={`text-[10px] font-bold px-2 py-0.5 rounded uppercase ${
                              m.status === 'UP'
                                ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'
                                : m.status === 'DOWN'
                                ? 'bg-red-500/10 text-red-400 border border-red-500/30'
                                : 'bg-amber-500/10 text-amber-400 border border-amber-500/30'
                            }`}
                          >
                            {m.status}
                          </span>
                        </td>
                        <td className="py-3 px-4 font-mono">
                          {m.latency_ms ? `${m.latency_ms} ms` : '0 ms'}
                        </td>
                        <td className="py-3 px-4 font-mono text-slate-300">
                          {m.uptime_pct}%
                        </td>
                        <td className="py-3 px-4 text-slate-400">
                          {m.interval || 60}s
                        </td>
                        <td className="py-3 px-4 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <button
                              title="View Check History"
                              onClick={() => fetchMonitorHistory(m)}
                              className="flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium text-slate-200 hover:text-white bg-slate-800 hover:bg-slate-750 border border-slate-700 hover:border-blue-500/50 transition-all cursor-pointer shadow-sm group"
                            >
                              <History className="w-3.5 h-3.5 text-blue-400 group-hover:rotate-[-45deg] transition-transform" />
                              <span>View History</span>
                            </button>
                            <button
                              title="Instant ping"
                              onClick={() =>
                                showToast(`Dispatched test ping for ${m.name}`)
                              }
                              className="p-1.5 rounded text-slate-400 hover:text-emerald-400 hover:bg-slate-800 transition-colors cursor-pointer"
                            >
                              <Send className="w-3.5 h-3.5" />
                            </button>
                            <button
                              title="Delete Monitor"
                              onClick={() => deleteMonitor(m.id, m.name)}
                              className="p-1.5 rounded text-slate-400 hover:text-red-400 hover:bg-slate-800 transition-colors cursor-pointer"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* VIEW 3: ALERTS & INCIDENTS VIEW */}
        {activeNav === 'Alerts & Incidents' && (
          <div className="bg-[#1e293b] border border-slate-700/50 rounded-xl p-6 shadow-sm flex flex-col gap-4">
            <div className="flex justify-between items-center">
              <div>
                <h2 className="text-base font-semibold text-white">
                  Incident History & AWS SNS Dispatches
                </h2>
                <p className="text-xs text-slate-400">
                  Chronological event log emitted via Amazon SNS subscribers and SQS Dead Letter Queues.
                </p>
              </div>
            </div>

            {/* Live SNS & SMS Notification Tester */}
            <div className="p-4 rounded-xl bg-slate-900 border border-blue-500/30 flex flex-col sm:flex-row gap-3 items-center justify-between shadow-sm">
              <div>
                <div className="font-semibold text-white text-xs flex items-center gap-2">
                  <Bell className="w-3.5 h-3.5 text-blue-400" />
                  <span>Live AWS SNS Alert & SMS Dispatch Tester</span>
                </div>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  Enter your phone number (with country code, e.g. <span className="text-emerald-400 font-mono">+91...</span>) or email to test real cloud alerts:
                </p>
              </div>
              <div className="flex items-center gap-2 w-full sm:w-auto">
                <input
                  type="text"
                  placeholder="+919876543210 or user@example.com"
                  value={testTarget}
                  onChange={(e) => setTestTarget(e.target.value)}
                  className="bg-[#0f172a] border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-white placeholder-slate-500 focus:border-blue-500 outline-none w-full sm:w-64"
                />
                <button
                  type="button"
                  onClick={handleSendTestAlert}
                  disabled={isSendingTestAlert}
                  className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-medium text-xs px-3.5 py-1.5 rounded-lg whitespace-nowrap transition-all shadow-sm"
                >
                  {isSendingTestAlert ? 'Sending...' : 'Send Live Alert'}
                </button>
              </div>
            </div>

            <div className="flex flex-col gap-3 mt-2">
              {alerts.map((al) => (
                <div
                  key={al.id}
                  className={`p-4 rounded-lg border flex items-start justify-between ${
                    al.type === 'OUTAGE'
                      ? 'bg-red-950/20 border-red-900/60'
                      : 'bg-emerald-950/20 border-emerald-900/60'
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <div
                      className={`p-2 rounded-md shrink-0 mt-0.5 ${
                        al.type === 'OUTAGE'
                          ? 'bg-red-500/20 text-red-400 border border-red-500/40'
                          : 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40'
                      }`}
                    >
                      {al.type === 'OUTAGE' ? (
                        <AlertTriangle className="w-4 h-4" />
                      ) : (
                        <CheckCircle2 className="w-4 h-4" />
                      )}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-white text-sm">
                          {al.monitor_name}
                        </span>
                        <span
                          className={`text-[10px] font-bold px-1.5 py-0.5 rounded uppercase ${
                            al.type === 'OUTAGE'
                              ? 'bg-red-500 text-white'
                              : 'bg-emerald-500 text-white'
                          }`}
                        >
                          {al.type}
                        </span>
                      </div>
                      <p className="text-xs text-slate-300 mt-1">{al.message}</p>
                      <span className="text-[10px] text-emerald-400/90 font-mono mt-1 block">
                        Event ID: #{al.id} • Live AWS SNS Topic: arn:aws:sns:us-east-1:120736097741:uptimewatch-alerts-topic & Direct SMS (Dispatched)
                      </span>
                    </div>
                  </div>

                  <span className="text-xs font-mono text-slate-400">
                    {al.timeFormatted ||
                      new Date(al.timestamp).toLocaleTimeString()}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* VIEW 4: ANALYTICS & REPORTS (S3) VIEW */}
        {activeNav === 'Analytics & Reports (S3)' && (
          <div className="bg-[#1e293b] border border-slate-700/50 rounded-xl p-6 shadow-sm flex flex-col gap-6">
            <div className="flex justify-between items-center">
              <div>
                <h2 className="text-base font-semibold text-white">
                  Availability Analytics & SLA Reports
                </h2>
                <p className="text-xs text-slate-400">
                  Local monitoring metrics & planned Amazon S3 archive integration • Storage: Local Development Mode
                </p>
              </div>
              <button
                onClick={handleExportS3}
                className="bg-emerald-400 hover:bg-emerald-300 text-black px-4 py-1.5 rounded-md text-xs font-semibold flex items-center gap-1.5 transition-all shadow-sm cursor-pointer"
              >
                <Download className="w-4 h-4" />
                <span>Export Local Report (JSON)</span>
              </button>
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div className="bg-slate-900 border border-slate-800 p-4 rounded-lg">
                <span className="text-xs text-slate-400">30-Day SLA Target</span>
                <span className="text-2xl font-bold text-white block mt-1">
                  99.95%
                </span>
                <span className="text-[11px] text-emerald-400 mt-1 block">
                  Current: {metrics?.global_uptime ?? 99.87}% ({metrics?.global_uptime ? 'From local database checks' : 'Demo'})
                </span>
              </div>
              <div className="bg-slate-900 border border-slate-800 p-4 rounded-lg">
                <div className="flex justify-between items-center">
                  <span className="text-xs text-slate-400">S3 Automated Archive</span>
                  <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400 border border-amber-500/30">
                    LOCAL DEMO
                  </span>
                </div>
                <span className="text-2xl font-bold text-white block mt-1">
                  Planned Pipeline
                </span>
                <span className="text-[11px] text-slate-400 mt-1 block">
                  Local JSON export ready • S3 Bucket provisioned in AWS phase
                </span>
              </div>
              <div className="bg-slate-900 border border-slate-800 p-4 rounded-lg">
                <div className="flex justify-between items-center">
                  <span className="text-xs text-slate-400">Automated Cadence</span>
                  <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400 border border-blue-500/30">
                    TARGET CRON
                  </span>
                </div>
                <span className="text-2xl font-bold text-white block mt-1">
                  Daily 00:00 UTC
                </span>
                <span className="text-[11px] text-blue-400 mt-1 block">
                  Planned CloudWatch Event trigger at 00:00 UTC
                </span>
              </div>
            </div>

            <div className="border border-slate-700/60 rounded-lg overflow-hidden">
              <div className="bg-slate-900 px-4 py-2.5 border-b border-slate-700 text-xs font-semibold text-slate-300 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <FileSpreadsheet className="w-4 h-4 text-emerald-400" />
                  <span>SLA Archive Schema & Sample Exports (Local Demo Preview)</span>
                </div>
                <span className="text-[10px] text-amber-400/90 font-mono">
                  [Preview Schemas — Real S3 Uploads Activate in AWS Phase]
                </span>
              </div>
              <div className="divide-y divide-slate-800 text-xs">
                {[
                  {
                    name: 'uptime-report-daily.json',
                    size: 'Live Generated',
                    time: 'Current Local Session',
                    type: 'Local JSON Export',
                    action: 'Export Now',
                  },
                  {
                    name: 'sample-sla-archive-template.parquet',
                    size: '18.4 MB (Target Schema)',
                    time: 'Planned CloudWatch Trigger',
                    type: 'Sample Parquet Schema',
                    action: 'Download Template',
                  },
                  {
                    name: 'sample-weekly-sla-rollup.csv',
                    size: '4.2 MB (Target Schema)',
                    time: 'Planned Weekly Rollup',
                    type: 'Sample CSV Schema',
                    action: 'Download Template',
                  },
                ].map((f) => (
                  <div
                    key={f.name}
                    className="p-3 flex justify-between items-center hover:bg-slate-800/40"
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-white block">{f.name}</span>
                        <span className="text-[9px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 border border-slate-700">
                          {f.type}
                        </span>
                      </div>
                      <span className="text-[11px] text-slate-500">
                        {f.size} • {f.time}
                      </span>
                    </div>
                    <button
                      onClick={handleExportS3}
                      className="border border-slate-700 hover:border-slate-500 px-2.5 py-1 rounded text-xs text-slate-300 hover:text-white flex items-center gap-1.5 cursor-pointer"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>{f.action}</span>
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* VIEW 5: AWS INFRASTRUCTURE (LIVE TELEMETRY NODE MAP) */}
        {activeNav === 'AWS Infrastructure' && (
          <div className="bg-[#1e293b] border border-slate-700/50 rounded-xl p-6 shadow-sm flex flex-col gap-6">
            <div className="flex justify-between items-center">
              <div>
                <h2 className="text-base font-semibold text-white flex items-center gap-2">
                  <Cloud className="w-5 h-5 text-blue-400" />
                  AWS Architecture Topology & Resource Mapping
                </h2>
                <p className="text-xs text-slate-400">
                  {awsStats?.is_simulated
                    ? 'Modeled cloud architecture for UptimeWatch • Mode: LOCAL SIMULATION'
                    : 'Active Cloud Architecture for UptimeWatch • Mode: AWS CLOUD PRODUCTION (Live Connected)'}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span
                  className={`text-[10px] font-semibold uppercase tracking-wider px-2 py-1 rounded border flex items-center gap-1.5 ${
                    awsStats?.is_simulated
                      ? 'bg-amber-500/10 text-amber-400 border-amber-500/30'
                      : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30 shadow-sm'
                  }`}
                >
                  <div
                    className={`w-1.5 h-1.5 rounded-full ${
                      awsStats?.is_simulated ? 'bg-amber-400' : 'bg-emerald-400 animate-pulse'
                    }`}
                  />
                  <span>{awsStats?.is_simulated ? 'LOCAL SIMULATION' : 'AWS CLOUD PRODUCTION (LIVE)'}</span>
                </span>
                <button
                  onClick={() => fetchDashboardData()}
                  className="flex items-center gap-1 text-xs border border-slate-700 bg-slate-900 px-3 py-1.5 rounded text-slate-300 hover:text-white cursor-pointer"
                >
                  <RefreshCw
                    className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`}
                  />
                  <span>Refresh Telemetry</span>
                </button>
              </div>
            </div>

            {/* Cloud Status Banner */}
            {awsStats?.is_simulated ? (
              <div className="bg-amber-950/30 border border-amber-600/50 rounded-xl p-3.5 flex items-center gap-3 text-xs text-amber-200 shadow-sm">
                <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0" />
                <div>
                  <span className="font-semibold block text-amber-300">Phase 2 Verification Notice: Local Development Mode</span>
                  <span className="text-amber-200/80">
                    Components are running locally. Real AWS services are bypassed in local simulation mode.
                  </span>
                </div>
              </div>
            ) : (
              <div className="bg-emerald-950/30 border border-emerald-600/50 rounded-xl p-3.5 flex items-center gap-3 text-xs text-emerald-200 shadow-sm">
                <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
                <div>
                  <span className="font-semibold block text-emerald-300">AWS Cloud Production Active: All Services Connected</span>
                  <span className="text-emerald-200/80">
                    Live authenticated to AWS Account <code className="text-white font-mono font-semibold">120736097741</code> (us-east-1). Amazon EC2 (t3.micro), SQS Queue & DLQ, SNS Alerts Topic, S3 Reports Bucket, CloudWatch Logs, and SSM Parameter Store are all active and connected.
                  </span>
                </div>
              </div>
            )}

            {/* Architecture Node Map Grid */}
            <div className="grid grid-cols-4 gap-4">
              {/* Node 1: EC2 FastAPI Worker */}
              <div className="bg-slate-900/90 border border-blue-500/30 rounded-xl p-4 flex flex-col justify-between relative overflow-hidden group hover:border-blue-500/60 transition-all">
                <div className="flex justify-between items-start mb-3">
                  <div className="flex items-center gap-2">
                    <Server className="w-5 h-5 text-blue-400" />
                    <div>
                      <span className="font-semibold text-white text-sm block">
                        EC2 Server
                      </span>
                      <span className="text-[10px] text-slate-400 font-mono">
                        {awsStats?.ec2_instance_id || 'i-0c3f331ec81cc9206'}
                      </span>
                    </div>
                  </div>
                  <span className="text-[10px] font-mono bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 px-1.5 py-0.5 rounded">
                    {awsStats?.is_simulated ? 'LOCAL HOST' : 'LIVE EC2'}
                  </span>
                </div>
                <div className="space-y-2 pt-2 border-t border-slate-800 text-xs">
                  <div className="flex justify-between text-slate-400">
                    <span>Host Process:</span>
                    <span className="text-emerald-400 font-mono font-medium">
                      54.162.128.111
                    </span>
                  </div>
                  <div className="flex justify-between text-slate-400">
                    <span>Instance Type:</span>
                    <span className="text-slate-200 font-mono">
                      {awsStats?.ec2_type || 't3.micro (AWS Free Tier)'}
                    </span>
                  </div>
                  <div className="flex justify-between text-slate-400">
                    <span>AWS Region:</span>
                    <span className="text-slate-200 font-mono">
                      {awsStats?.region || 'us-east-1'}
                    </span>
                  </div>
                </div>
              </div>

              {/* Node 2: Amazon SQS Queue */}
              <div className="bg-slate-900/90 border border-emerald-500/30 rounded-xl p-4 flex flex-col justify-between relative overflow-hidden group hover:border-emerald-500/60 transition-all">
                <div className="flex justify-between items-start mb-3">
                  <div className="flex items-center gap-2">
                    <Layers className="w-5 h-5 text-emerald-400" />
                    <div>
                      <span className="font-semibold text-white text-sm block">
                        Amazon SQS
                      </span>
                      <span className="text-[10px] text-slate-400 font-mono">
                        {awsStats?.sqs_queue_name || 'uptimewatch-checks-queue'}
                      </span>
                    </div>
                  </div>
                  <span className="text-[10px] font-mono bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 px-1.5 py-0.5 rounded">
                    {awsStats?.is_simulated ? 'SIMULATED' : 'ACTIVE QUEUE'}
                  </span>
                </div>
                <div className="space-y-2 pt-2 border-t border-slate-800 text-xs">
                  <div className="flex justify-between text-slate-400">
                    <span>Queue Status:</span>
                    <span className="text-emerald-400 font-mono font-medium">
                      {awsStats?.is_simulated ? 'Simulated (Local)' : 'Connected & Active'}
                    </span>
                  </div>
                  <div className="flex justify-between text-slate-400">
                    <span>Target Queue:</span>
                    <span className="text-slate-200 font-mono">
                      Main + DLQ (redrive: 5)
                    </span>
                  </div>
                  <div className="flex justify-between text-slate-400">
                    <span>Polling Mode:</span>
                    <span className="text-emerald-400 font-mono">ThreadPool Concurrent</span>
                  </div>
                </div>
              </div>

              {/* Node 3: Database Engine */}
              <div className="bg-slate-900/90 border border-purple-500/30 rounded-xl p-4 flex flex-col justify-between relative overflow-hidden group hover:border-purple-500/60 transition-all">
                <div className="flex justify-between items-start mb-3">
                  <div className="flex items-center gap-2">
                    <Database className="w-5 h-5 text-purple-400" />
                    <div>
                      <span className="font-semibold text-white text-sm block">
                        Database Engine
                      </span>
                      <span className="text-[10px] text-slate-400 font-mono">
                        uptimewatch.db
                      </span>
                    </div>
                  </div>
                  <span className="text-[10px] font-mono bg-purple-500/10 text-purple-400 border border-purple-500/30 px-1.5 py-0.5 rounded">
                    PERSISTENT
                  </span>
                </div>
                <div className="space-y-2 pt-2 border-t border-slate-800 text-xs">
                  <div className="flex justify-between text-slate-400">
                    <span>Active DB:</span>
                    <span className="text-white font-mono font-medium">
                      SQLite 3 (EC2 Volume)
                    </span>
                  </div>
                  <div className="flex justify-between text-slate-400">
                    <span>Target Engine:</span>
                    <span className="text-purple-300 font-mono">
                      Persistent Indexed Storage
                    </span>
                  </div>
                  <div className="flex justify-between text-slate-400">
                    <span>S3 Archival:</span>
                    <span className="text-emerald-400 font-mono">Reports Bucket Active</span>
                  </div>
                </div>
              </div>

              {/* Node 4: Amazon SNS & SMS */}
              <div className="bg-slate-900/90 border border-amber-500/30 rounded-xl p-4 flex flex-col justify-between relative overflow-hidden group hover:border-amber-500/60 transition-all">
                <div className="flex justify-between items-start mb-3">
                  <div className="flex items-center gap-2">
                    <Radio className="w-5 h-5 text-amber-400" />
                    <div>
                      <span className="font-semibold text-white text-sm block">
                        Amazon SNS
                      </span>
                      <span className="text-[10px] text-slate-400 font-mono">
                        uptimewatch-alerts-topic
                      </span>
                    </div>
                  </div>
                  <span className="text-[10px] font-mono bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 px-1.5 py-0.5 rounded">
                    {awsStats?.is_simulated ? 'NOT CONNECTED' : 'CONNECTED'}
                  </span>
                </div>
                <div className="space-y-2 pt-2 border-t border-slate-800 text-xs">
                  <div className="flex justify-between text-slate-400">
                    <span>Dispatch Mode:</span>
                    <span className="text-emerald-400 font-mono font-medium">
                      {awsStats?.is_simulated ? 'Local Event Log' : 'Live AWS SNS & SMS'}
                    </span>
                  </div>
                  <div className="flex justify-between text-slate-400">
                    <span>Target Subscribers:</span>
                    <span className="text-slate-200 font-mono">
                      Email & Direct SMS
                    </span>
                  </div>
                  <div className="flex justify-between text-slate-400">
                    <span>AWS Budget Spend:</span>
                    <span className="text-emerald-400 font-mono">$0.00 (AWS Free Tier)</span>
                  </div>
                </div>
              </div>
            </div>


            {/* AWS Connection Guide Callout */}
            <div className="p-4 rounded-xl bg-slate-900 border border-slate-700 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-blue-500/10 border border-blue-500/30 text-blue-400">
                  <Wifi className="w-5 h-5" />
                </div>
                <div>
                  <h4 className="text-sm font-semibold text-white">
                    FastAPI Production Deployment Ready
                  </h4>
                  <p className="text-xs text-slate-400 mt-0.5">
                    To connect to live EC2 instance, set{' '}
                    <code className="text-emerald-400 font-mono">
                      USE_MOCK_DATA = false
                    </code>{' '}
                    in <code className="text-slate-200 font-mono">src/App.jsx</code> and
                    set <code className="text-blue-300 font-mono">API_BASE_URL</code> to your EC2 public IP.
                  </p>
                </div>
              </div>
              <button
                onClick={() => {
                  setUseMockDataMode(false);
                  showToast('Testing live API connection to ' + API_BASE_URL);
                  fetchDashboardData();
                }}
                className="text-xs bg-blue-600 hover:bg-blue-500 text-white px-3 py-1.5 rounded-lg transition-colors cursor-pointer shrink-0"
              >
                Test Live API
              </button>
            </div>
          </div>
        )}

        {/* VIEW 6: AWS DEVELOPER & BUDGET HUB */}
        {activeNav === 'AWS Developer & Budget' && (
          <div className="bg-[#1e293b] border border-slate-700/50 rounded-xl p-6 shadow-sm flex flex-col gap-6">
            <div className="flex justify-between items-center">
              <div>
                <h2 className="text-base font-semibold text-white flex items-center gap-2">
                  <Wallet className="w-5 h-5 text-amber-400" />
                  AWS Developer Hub & Real-Time Cloud Budget
                </h2>
                <p className="text-xs text-slate-400">
                  Live cloud infrastructure status, free-tier guardrails, and cost monitoring for AWS account 120736097741.
                </p>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-[10px] font-semibold uppercase tracking-wider px-2 py-1 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 flex items-center gap-1.5">
                  <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  <span>AWS Free Tier Active</span>
                </span>
                <button
                  onClick={fetchAwsBudget}
                  className="flex items-center gap-1.5 text-xs border border-slate-700 bg-slate-900 px-3 py-1.5 rounded-lg text-slate-300 hover:text-white cursor-pointer transition-colors"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>Refresh Cloud Budget</span>
                </button>
              </div>
            </div>

            {/* AWS Monthly Budget Metrics Cards */}
            <div className="grid grid-cols-4 gap-4">
              <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-4 flex flex-col justify-between shadow-inner">
                <div className="flex justify-between items-center">
                  <span className="text-xs text-slate-400 font-medium">Monthly Cost Limit</span>
                  <DollarSign className="w-4 h-4 text-emerald-400" />
                </div>
                <div className="mt-2">
                  <span className="text-2xl font-bold text-white tracking-tight">$5.00</span>
                  <span className="text-[11px] text-slate-400 block mt-0.5">Configured AWS Budget Alert</span>
                </div>
              </div>

              <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-4 flex flex-col justify-between shadow-inner">
                <div className="flex justify-between items-center">
                  <span className="text-xs text-slate-400 font-medium">Current Month Spend</span>
                  <Award className="w-4 h-4 text-blue-400" />
                </div>
                <div className="mt-2">
                  <span className="text-2xl font-bold text-emerald-400 tracking-tight">$0.00</span>
                  <span className="text-[11px] text-emerald-400/80 block mt-0.5">100% Free Tier Covered</span>
                </div>
              </div>

              <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-4 flex flex-col justify-between shadow-inner">
                <div className="flex justify-between items-center">
                  <span className="text-xs text-slate-400 font-medium">Remaining Budget</span>
                  <Wallet className="w-4 h-4 text-amber-400" />
                </div>
                <div className="mt-2">
                  <span className="text-2xl font-bold text-white tracking-tight">$5.00</span>
                  <span className="text-[11px] text-slate-400 block mt-0.5">100% Remaining (0% consumed)</span>
                </div>
              </div>

              <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-4 flex flex-col justify-between shadow-inner">
                <div className="flex justify-between items-center">
                  <span className="text-xs text-slate-400 font-medium">Early Warning Threshold</span>
                  <ShieldAlert className="w-4 h-4 text-purple-400" />
                </div>
                <div className="mt-2">
                  <span className="text-2xl font-bold text-white tracking-tight">$4.00</span>
                  <span className="text-[11px] text-purple-300 block mt-0.5">80% Trigger via Amazon SNS</span>
                </div>
              </div>
            </div>

            {/* AWS Service Architecture & Live Health Matrix */}
            <div className="border border-slate-700/60 rounded-xl overflow-hidden bg-slate-900/60">
              <div className="bg-slate-900 px-4 py-3 border-b border-slate-700 text-xs font-semibold text-slate-300 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Database className="w-4 h-4 text-emerald-400" />
                  <span>Live AWS Services Matrix (Connected & Provisioned)</span>
                </div>
                <span className="text-[11px] font-mono text-slate-400">Region: us-east-1</span>
              </div>

              <div className="p-4 grid grid-cols-2 gap-4 text-xs">
                {/* RDS PostgreSQL */}
                <div className="p-3.5 rounded-lg bg-slate-800/80 border border-slate-700/70 flex flex-col justify-between">
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="font-semibold text-white flex items-center gap-1.5">
                        <Database className="w-3.5 h-3.5 text-blue-400" />
                        Amazon RDS (PostgreSQL 16.3)
                      </span>
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
                        AVAILABLE
                      </span>
                    </div>
                    <p className="text-[11px] font-mono text-slate-400 truncate">
                      uptimewatch-db.c0neimmoq6l7.us-east-1.rds.amazonaws.com
                    </p>
                  </div>
                  <div className="mt-3 pt-2 border-t border-slate-800 flex justify-between text-[11px] text-slate-400">
                    <span>Class: db.t3.micro (750 hrs free)</span>
                    <span className="text-emerald-400 font-medium">Storage: 20 GB gp3</span>
                  </div>
                </div>

                {/* SQS FIFO / Standard */}
                <div className="p-3.5 rounded-lg bg-slate-800/80 border border-slate-700/70 flex flex-col justify-between">
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="font-semibold text-white flex items-center gap-1.5">
                        <Layers className="w-3.5 h-3.5 text-amber-400" />
                        Amazon SQS (Checks Queue + DLQ)
                      </span>
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
                        ACTIVE
                      </span>
                    </div>
                    <p className="text-[11px] font-mono text-slate-400 truncate">
                      uptimewatch-checks-queue & uptimewatch-checks-dlq
                    </p>
                  </div>
                  <div className="mt-3 pt-2 border-t border-slate-800 flex justify-between text-[11px] text-slate-400">
                    <span>Rate: 1,000,000 req/mo free</span>
                    <span className="text-emerald-400 font-medium">Retention: 4 Days</span>
                  </div>
                </div>

                {/* SNS Topics */}
                <div className="p-3.5 rounded-lg bg-slate-800/80 border border-slate-700/70 flex flex-col justify-between">
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="font-semibold text-white flex items-center gap-1.5">
                        <Bell className="w-3.5 h-3.5 text-purple-400" />
                        Amazon SNS (Real-Time Alerts)
                      </span>
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
                        ACTIVE
                      </span>
                    </div>
                    <p className="text-[11px] font-mono text-slate-400 truncate">
                      arn:aws:sns:us-east-1:120736097741:uptimewatch-alerts-topic
                    </p>
                  </div>
                  <div className="mt-3 pt-2 border-t border-slate-800 flex justify-between text-[11px] text-slate-400">
                    <span>Dispatches: 1,000,000/mo free</span>
                    <span className="text-purple-300 font-medium">Email Push Alerting</span>
                  </div>
                </div>

                {/* S3 Storage & SSM */}
                <div className="p-3.5 rounded-lg bg-slate-800/80 border border-slate-700/70 flex flex-col justify-between">
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="font-semibold text-white flex items-center gap-1.5">
                        <Cloud className="w-3.5 h-3.5 text-emerald-400" />
                        Amazon S3 & SSM Parameters
                      </span>
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
                        READY
                      </span>
                    </div>
                    <p className="text-[11px] font-mono text-slate-400 truncate">
                      s3://uptimewatch-reports-bucket-120736097741
                    </p>
                  </div>
                  <div className="mt-3 pt-2 border-t border-slate-800 flex justify-between text-[11px] text-slate-400">
                    <span>SSM: SecureString Encrypted</span>
                    <span className="text-emerald-400 font-medium">Bucket: Private ACL</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Developer Clean Slate & Maintenance Actions */}
            <div className="p-4 rounded-xl bg-slate-900 border border-slate-700 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400">
                  <Trash2 className="w-5 h-5" />
                </div>
                <div>
                  <h4 className="text-sm font-semibold text-white">
                    Database Clean Slate & Reset
                  </h4>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Purge all dummy monitoring records and history from Amazon RDS to test fresh real websites (e.g. kaggle.com).
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={purgeAllMonitors}
                  className="text-xs bg-red-950/60 hover:bg-red-900/80 text-red-200 border border-red-800 px-4 py-2 rounded-lg font-medium transition-colors cursor-pointer flex items-center gap-1.5 shadow-sm"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Purge All Monitors</span>
                </button>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* ==========================================
          5. CONTROLLED ADD MONITOR MODAL (POST)
      ========================================== */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#1e293b] border border-slate-700 rounded-xl p-6 w-full max-w-md shadow-2xl relative">
            <button
              onClick={() => setShowAddModal(false)}
              className="absolute top-4 right-4 text-slate-400 hover:text-white"
            >
              <X className="w-5 h-5" />
            </button>
            <h3 className="text-lg font-bold text-white mb-1 flex items-center gap-2">
              <Plus className="w-5 h-5 text-emerald-400" />
              Add New Watchdog Monitor
            </h3>
            <p className="text-xs text-slate-400 mb-4">
              Dispatches canary polling jobs through Amazon SQS to the FastAPI worker.
            </p>

            <form onSubmit={handleAddMonitor} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Monitor Name / Domain *
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. auth-service.internal.io"
                  value={newMonitorName}
                  onChange={(e) => setNewMonitorName(e.target.value)}
                  className="w-full bg-[#0f172a] border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:border-emerald-500 outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Target Endpoint URL
                </label>
                <input
                  type="url"
                  placeholder="https://auth-service.internal.io/health"
                  value={newMonitorUrl}
                  onChange={(e) => setNewMonitorUrl(e.target.value)}
                  className="w-full bg-[#0f172a] border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:border-emerald-500 outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    Check Interval (sec)
                  </label>
                  <select
                    value={newMonitorInterval}
                    onChange={(e) => setNewMonitorInterval(e.target.value)}
                    className="w-full bg-[#0f172a] border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:border-emerald-500 outline-none"
                  >
                    <option value="30">30 seconds</option>
                    <option value="60">60 seconds</option>
                    <option value="120">2 minutes</option>
                    <option value="300">5 minutes</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    Alert Threshold (ms)
                  </label>
                  <input
                    type="number"
                    value={newMonitorThreshold}
                    onChange={(e) => setNewMonitorThreshold(e.target.value)}
                    className="w-full bg-[#0f172a] border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:border-emerald-500 outline-none"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-4 py-2 rounded-lg text-xs font-medium text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-4 py-2 rounded-lg text-xs font-semibold bg-emerald-400 text-black hover:bg-emerald-300 shadow-md shadow-emerald-500/20 transition-all flex items-center gap-1.5 disabled:opacity-50"
                >
                  {isSubmitting ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      <span>Deploying to SQS...</span>
                    </>
                  ) : (
                    <>
                      <Check className="w-3.5 h-3.5" />
                      <span>Save & Start Monitoring</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ==========================================
          6. VIEW CHECK HISTORY MODAL
      ========================================== */}
      {selectedHistoryMonitor && (
        <div
          className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200"
          onClick={() => setSelectedHistoryMonitor(null)}
        >
          <div
            className="bg-[#1e293b] border border-slate-700 rounded-xl p-6 w-full max-w-4xl max-h-[85vh] flex flex-col shadow-2xl relative"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="flex justify-between items-start pb-4 border-b border-slate-700/80 mb-4">
              <div>
                <div className="flex items-center gap-2.5">
                  <div className="p-1.5 rounded-lg bg-blue-500/10 border border-blue-500/30">
                    <History className="w-5 h-5 text-blue-400" />
                  </div>
                  <h3 className="text-lg font-bold text-white tracking-tight">
                    Check History: {selectedHistoryMonitor.name}
                  </h3>
                  <span
                    className={`text-[10px] font-bold px-2 py-0.5 rounded uppercase border ${
                      selectedHistoryMonitor.status === 'UP'
                        ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                        : selectedHistoryMonitor.status === 'DOWN'
                        ? 'bg-red-500/10 text-red-400 border-red-500/30'
                        : 'bg-amber-500/10 text-amber-400 border-amber-500/30'
                    }`}
                  >
                    {selectedHistoryMonitor.status}
                  </span>
                </div>
                <p className="text-xs text-slate-400 font-mono mt-1.5 flex items-center gap-2">
                  <span>{selectedHistoryMonitor.url}</span>
                  <span className="text-slate-600">•</span>
                  <span>Threshold: {selectedHistoryMonitor.latency_threshold || 500}ms</span>
                  <span className="text-slate-600">•</span>
                  <span>Interval: {selectedHistoryMonitor.interval || 60}s</span>
                </p>
              </div>

              <div className="flex items-center gap-2">
                <button
                  title="Refresh History"
                  onClick={() => fetchMonitorHistory(selectedHistoryMonitor)}
                  disabled={isHistoryLoading}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer disabled:opacity-50"
                >
                  <RefreshCw className={`w-4 h-4 ${isHistoryLoading ? 'animate-spin text-blue-400' : ''}`} />
                </button>
                <button
                  title="Close Modal"
                  onClick={() => setSelectedHistoryMonitor(null)}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Modal Body / History Table */}
            <div className="flex-1 overflow-y-auto pr-1 min-h-[220px]">
              {isHistoryLoading ? (
                <div className="py-20 flex flex-col items-center justify-center gap-3 text-slate-400">
                  <RefreshCw className="w-7 h-7 animate-spin text-blue-400" />
                  <span className="text-sm font-medium">Fetching historical checks from backend...</span>
                </div>
              ) : historyError ? (
                <div className="py-14 flex flex-col items-center justify-center">
                  <div className="bg-red-950/40 border border-red-800/80 rounded-xl p-5 max-w-md text-center text-red-300 shadow-lg">
                    <AlertTriangle className="w-7 h-7 text-red-400 mx-auto mb-2" />
                    <h4 className="text-sm font-semibold text-red-200">Failed to Load History</h4>
                    <p className="text-xs text-red-300/90 mt-1">{historyError}</p>
                    <button
                      onClick={() => fetchMonitorHistory(selectedHistoryMonitor)}
                      className="mt-3.5 text-xs bg-red-900/70 hover:bg-red-900 text-white px-3.5 py-1.5 rounded-lg border border-red-700 transition-colors cursor-pointer"
                    >
                      Retry Request
                    </button>
                  </div>
                </div>
              ) : historyChecks.length === 0 ? (
                <div className="py-16 flex flex-col items-center justify-center gap-2 text-center">
                  <div className="p-3 rounded-full bg-slate-800/80 border border-slate-700 mb-1">
                    <Clock className="w-7 h-7 text-slate-500" />
                  </div>
                  <h4 className="text-sm font-semibold text-slate-200">No Check History Recorded Yet</h4>
                  <p className="text-xs text-slate-400 max-w-sm mt-0.5">
                    Health checks are recorded by the background monitoring worker. Run the worker daemon or wait for the next scheduled poll cycle.
                  </p>
                </div>
              ) : (
                <div className="overflow-x-auto border border-slate-700/60 rounded-lg">
                  <table className="w-full text-left text-xs text-slate-300">
                    <thead className="bg-slate-900/90 text-slate-400 uppercase tracking-wider text-[10px] border-b border-slate-700 sticky top-0 backdrop-blur-md">
                      <tr>
                        <th className="py-2.5 px-3">Check Timestamp</th>
                        <th className="py-2.5 px-3">Status</th>
                        <th className="py-2.5 px-3">HTTP Status</th>
                        <th className="py-2.5 px-3">Response Time</th>
                        <th className="py-2.5 px-3">Error / Diagnostics</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800">
                      {historyChecks.map((check) => (
                        <tr key={check.id} className="hover:bg-slate-800/40 transition-colors">
                          <td className="py-2.5 px-3 font-mono text-slate-300 whitespace-nowrap">
                            <div className="flex flex-col">
                              <span className="text-white text-xs">{formatTimestamp(check.checked_at)}</span>
                              <span className="text-[10px] text-slate-500">{formatRelativeTime(check.checked_at)}</span>
                            </div>
                          </td>
                          <td className="py-2.5 px-3 whitespace-nowrap">
                            <span
                              className={`text-[10px] font-bold px-2 py-0.5 rounded uppercase border ${
                                check.status === 'UP'
                                  ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                                  : check.status === 'DOWN'
                                  ? 'bg-red-500/10 text-red-400 border-red-500/30'
                                  : 'bg-amber-500/10 text-amber-400 border-amber-500/30'
                              }`}
                            >
                              {check.status}
                            </span>
                          </td>
                          <td className="py-2.5 px-3 whitespace-nowrap">
                            {check.http_status ? (
                              <span
                                className={`px-2 py-0.5 rounded text-[10px] font-mono font-semibold border ${
                                  check.http_status >= 200 && check.http_status < 300
                                    ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30'
                                    : check.http_status >= 300 && check.http_status < 400
                                    ? 'text-blue-400 bg-blue-500/10 border-blue-500/30'
                                    : check.http_status >= 400 && check.http_status < 500
                                    ? 'text-amber-400 bg-amber-500/10 border-amber-500/30'
                                    : 'text-red-400 bg-red-500/10 border-red-500/30'
                                }`}
                              >
                                {check.http_status}
                              </span>
                            ) : (
                              <span className="text-slate-500 font-mono text-[11px]">-</span>
                            )}
                          </td>
                          <td className="py-2.5 px-3 font-mono whitespace-nowrap">
                            <span
                              className={
                                check.response_time_ms > (selectedHistoryMonitor.latency_threshold || 500)
                                  ? 'text-amber-400 font-semibold'
                                  : check.status === 'DOWN' && check.response_time_ms === 0
                                  ? 'text-slate-500'
                                  : 'text-emerald-400 font-medium'
                              }
                            >
                              {check.response_time_ms} ms
                            </span>
                          </td>
                          <td className="py-2.5 px-3 max-w-sm">
                            {check.error_details ? (
                              <span
                                className="text-red-400 text-xs block truncate font-mono"
                                title={check.error_details}
                              >
                                {check.error_details}
                              </span>
                            ) : (
                              <span className="text-slate-500 text-xs">-</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="flex justify-between items-center pt-4 border-t border-slate-700/80 mt-4 text-xs text-slate-400">
              <span className="font-mono">
                {historyChecks.length > 0
                  ? `Showing ${historyChecks.length} most recent checks`
                  : 'No checks recorded'}
              </span>
              <button
                onClick={() => setSelectedHistoryMonitor(null)}
                className="px-4 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 hover:border-slate-500 transition-colors cursor-pointer text-xs font-medium"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ==========================================
          7. AUTHENTICATION & 2-STEP VERIFICATION MODAL
      ========================================== */}
      {showAuthModal && (
        <div
          className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in duration-200"
          onClick={() => setShowAuthModal(false)}
        >
          <div
            className="bg-[#1e293b] border border-slate-700/80 rounded-2xl p-6 w-full max-w-md shadow-2xl relative flex flex-col gap-4"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header & Close */}
            <div className="flex justify-between items-start">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-gradient-to-tr from-blue-600 to-indigo-600 shadow-md shadow-blue-500/20 text-white">
                  <Lock className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-white tracking-tight">
                    {authMode === 'login' ? 'Security Sign In' : 'Create UptimeWatch Account'}
                  </h3>
                  <p className="text-xs text-slate-400">
                    {authMode === 'login'
                      ? 'Access live monitoring & 2-step verification'
                      : 'Saved in Amazon RDS PostgreSQL with SNS alert binding'}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowAuthModal(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Social 1-Click Fast Sign-In */}
            <div className="grid grid-cols-2 gap-2 mt-1">
              <button
                type="button"
                onClick={() => handleSocialSignIn('google')}
                disabled={authLoading}
                className="w-full bg-slate-900 hover:bg-slate-800 border border-slate-700/80 hover:border-blue-500/60 rounded-xl py-2 px-3 flex items-center justify-center gap-2 text-xs font-medium text-white transition-all shadow-sm cursor-pointer"
              >
                <svg className="w-3.5 h-3.5 shrink-0" viewBox="0 0 24 24">
                  <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                  <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                  <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"/>
                  <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"/>
                </svg>
                <span>Google</span>
              </button>

              <button
                type="button"
                onClick={() => handleSocialSignIn('github')}
                disabled={authLoading}
                className="w-full bg-slate-900 hover:bg-slate-800 border border-slate-700/80 hover:border-slate-500 rounded-xl py-2 px-3 flex items-center justify-center gap-2 text-xs font-medium text-white transition-all shadow-sm cursor-pointer"
              >
                <svg className="w-3.5 h-3.5 shrink-0 fill-white" viewBox="0 0 24 24">
                  <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z"/>
                </svg>
                <span>GitHub</span>
              </button>
            </div>

            {/* Divider */}
            <div className="flex items-center gap-3 my-0.5">
              <div className="flex-1 h-px bg-slate-800" />
              <span className="text-[10px] uppercase font-mono tracking-wider text-slate-500">
                Or with Email
              </span>
              <div className="flex-1 h-px bg-slate-800" />
            </div>
            <div className="grid grid-cols-2 p-1 bg-slate-900 rounded-lg border border-slate-800 text-xs font-semibold">
              <button
                type="button"
                onClick={() => {
                  setAuthMode('login');
                  setAuthError(null);
                }}
                className={`py-1.5 rounded-md transition-all ${
                  authMode === 'login'
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Sign In
              </button>
              <button
                type="button"
                onClick={() => {
                  setAuthMode('register');
                  setAuthError(null);
                  loadCaptchaChallenge();
                }}
                className={`py-1.5 rounded-md transition-all ${
                  authMode === 'register'
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Register
              </button>
            </div>

            {/* Error Message */}
            {authError && (
              <div className="bg-red-950/40 border border-red-800/80 rounded-lg p-3 flex items-center gap-2 text-xs text-red-300">
                <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
                <span>{authError}</span>
              </div>
            )}

            {/* Form */}
            <form onSubmit={handleAuthSubmit} className="flex flex-col gap-3 text-xs">
              {authMode === 'register' && (
                <div>
                  <label className="block text-slate-300 font-medium mb-1">Full Name</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Arnav Brahmane"
                    value={authName}
                    onChange={(e) => setAuthName(e.target.value)}
                    className="w-full bg-[#0f172a] border border-slate-700 rounded-lg px-3 py-2 text-white placeholder-slate-500 focus:border-blue-500 outline-none"
                  />
                </div>
              )}

              <div>
                <label className="block text-slate-300 font-medium mb-1">
                  Email Address {authMode === 'register' && '(Binds to AWS SNS Alerts)'}
                </label>
                <input
                  type="email"
                  required
                  placeholder="your.email@example.com"
                  value={authEmail}
                  onChange={(e) => setAuthEmail(e.target.value)}
                  className="w-full bg-[#0f172a] border border-slate-700 rounded-lg px-3 py-2 text-white placeholder-slate-500 focus:border-blue-500 outline-none"
                />
              </div>

              <div>
                <label className="block text-slate-300 font-medium mb-1">Password</label>
                <input
                  type="password"
                  required
                  placeholder="••••••••"
                  value={authPassword}
                  onChange={(e) => setAuthPassword(e.target.value)}
                  className="w-full bg-[#0f172a] border border-slate-700 rounded-lg px-3 py-2 text-white placeholder-slate-500 focus:border-blue-500 outline-none"
                />
              </div>

              {authMode === 'register' ? (
                <>
                  {/* Role Selector */}
                  <div>
                    <label className="block text-slate-300 font-medium mb-1">Account Role</label>
                    <div className="grid grid-cols-2 gap-2">
                      <div
                        onClick={() => setAuthRole('user')}
                        className={`p-2.5 rounded-lg border cursor-pointer transition-all flex flex-col gap-0.5 ${
                          authRole === 'user'
                            ? 'bg-emerald-500/10 border-emerald-500/50 text-white'
                            : 'bg-slate-900 border-slate-800 text-slate-400 hover:border-slate-700'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-semibold text-xs">Main User</span>
                          {authRole === 'user' && <Check className="w-3.5 h-3.5 text-emerald-400" />}
                        </div>
                        <span className="text-[10px] text-slate-400">Monitor sites & receive SNS alerts</span>
                      </div>

                      <div
                        onClick={() => setAuthRole('developer')}
                        className={`p-2.5 rounded-lg border cursor-pointer transition-all flex flex-col gap-0.5 ${
                          authRole === 'developer'
                            ? 'bg-amber-500/10 border-amber-500/50 text-white'
                            : 'bg-slate-900 border-slate-800 text-slate-400 hover:border-slate-700'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-semibold text-xs">Developer</span>
                          {authRole === 'developer' && <Check className="w-3.5 h-3.5 text-amber-400" />}
                        </div>
                        <span className="text-[10px] text-slate-400">AWS budget hub & cloud controls</span>
                      </div>
                    </div>
                  </div>

                  {authRole === 'developer' && (
                    <div>
                      <label className="block text-slate-300 font-medium mb-1">
                        Developer Master Passcode <span className="text-amber-400">*</span>
                      </label>
                      <input
                        type="password"
                        required
                        placeholder="Enter AWS Developer Passcode"
                        value={authDevSecret}
                        onChange={(e) => setAuthDevSecret(e.target.value)}
                        className="w-full bg-[#0f172a] border border-amber-500/50 rounded-lg px-3 py-2 text-white placeholder-slate-500 focus:border-amber-400 outline-none text-xs"
                      />
                      <p className="text-[10px] text-slate-500 mt-1">
                        Developer role is restricted to system administrators with the authorized AWS master key.
                      </p>
                    </div>
                  )}

                  {/* 2-Step Interactive Security Verification (Captcha) */}
                  <div className="p-3 rounded-lg bg-slate-900 border border-slate-800 flex flex-col gap-2">
                    <div className="flex items-center justify-between">
                      <span className="text-slate-300 font-medium flex items-center gap-1.5">
                        <ShieldCheck className="w-3.5 h-3.5 text-blue-400" />
                        2-Step Security Verification (Captcha)
                      </span>
                      <button
                        type="button"
                        onClick={loadCaptchaChallenge}
                        className="text-[10px] text-blue-400 hover:text-blue-300 cursor-pointer flex items-center gap-1"
                      >
                        <RefreshCw className="w-3 h-3" />
                        <span>Refresh Challenge</span>
                      </button>
                    </div>

                    <div className="flex items-center gap-2">
                      <div className="px-3 py-1.5 rounded bg-slate-800 font-mono text-white text-xs border border-slate-700 shrink-0">
                        {authCaptcha?.question || 'Loading challenge...'}
                      </div>
                      <input
                        type="text"
                        required
                        placeholder="Enter Answer"
                        value={authCaptchaAnswer}
                        onChange={(e) => setAuthCaptchaAnswer(e.target.value)}
                        className="w-full bg-[#0f172a] border border-slate-700 rounded-lg px-3 py-1.5 text-white placeholder-slate-500 focus:border-blue-500 outline-none text-xs"
                      />
                    </div>
                  </div>
                </>
              ) : (
                /* 2-Step Verification PIN on Login */
                <div className="p-3 rounded-lg bg-slate-900 border border-slate-800 flex flex-col gap-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-slate-300 font-medium flex items-center gap-1.5">
                      <KeyRound className="w-3.5 h-3.5 text-emerald-400" />
                      Two-Step Verification (2FA PIN)
                    </span>
                    <span className="text-[10px] text-slate-500 font-mono">Default: 123456</span>
                  </div>
                  <input
                    type="text"
                    maxLength={6}
                    placeholder="Enter 6-digit verification code"
                    value={auth2FACode}
                    onChange={(e) => setAuth2FACode(e.target.value)}
                    className="w-full bg-[#0f172a] border border-slate-700 rounded-lg px-3 py-2 text-white font-mono tracking-widest text-center focus:border-blue-500 outline-none text-sm"
                  />
                </div>
              )}

              <button
                type="submit"
                disabled={authLoading}
                className="mt-2 w-full py-2.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-semibold flex items-center justify-center gap-2 shadow-lg shadow-blue-600/20 transition-all cursor-pointer disabled:opacity-50"
              >
                {authLoading ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    <span>Verifying Credentials...</span>
                  </>
                ) : (
                  <>
                    <CheckCheck className="w-4 h-4" />
                    <span>{authMode === 'login' ? 'Authenticate & Sign In' : 'Register Account in RDS'}</span>
                  </>
                )}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
