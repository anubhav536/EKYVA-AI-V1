import { useMemo, useState } from 'react';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { ClerkProvider, Show, SignIn, SignUp, useClerk, useUser } from '@clerk/react';
import { shadcn } from '@clerk/themes';
import {
  Activity, ArrowDownRight, ArrowRight, BarChart3, Check, CheckCircle2, ChevronDown, CircleHelp,
  CircleOff, Clock3, Code2, Copy, CreditCard, Gauge, KeyRound, Layers3, LayoutDashboard,
  LifeBuoy, LogOut, Menu, Network, Plus, Radar, RefreshCw, Server, Settings2, ShieldCheck,
  SlidersHorizontal, Sparkles, Terminal, Trash2, TriangleAlert, WalletCards, X, Zap,
} from 'lucide-react';
import { Link, Redirect, Route, Router as WouterRouter, Switch, useLocation, useRoute } from 'wouter';
import {
  getGetAdminOverviewQueryKey, getGetCurrentUserQueryKey, getGetDashboardSummaryQueryKey,
  getGetWalletQueryKey, getListApiKeysQueryKey, getListCapabilitiesQueryKey, getListModelsQueryKey,
  getListRequestsQueryKey, getGetUsageQueryKey, useCreateApiKey,
  useDeleteApiKey, useGenerate, useGetAdminOverview, useGetCurrentUser, useGetDashboardSummary,
  useGetUsage, useGetWallet, useHealthCheck, useListApiKeys, useListCapabilities, useListModels, useListRequests,
  useUpdateRoutingMode,
} from '@workspace/api-client-react';
import type { ApiKey, Capability, Model, RequestSummary, User } from '@workspace/api-client-react';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';

const queryClient = new QueryClient();
const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');
// Clerk's current browser package resolves the same host-aware key through its
// public provider API; keep the helper local so older Clerk runtime bundles
// remain compatible with this artifact.
const publishableKeyFromHost = (_hostname: string, key?: string) => key ?? '';
const clerkPubKey = publishableKeyFromHost(window.location.hostname, import.meta.env.VITE_CLERK_PUBLISHABLE_KEY);
const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;
if (!clerkPubKey) throw new Error('Missing VITE_CLERK_PUBLISHABLE_KEY in .env file');

const clerkAppearance = {
  theme: shadcn,
  cssLayerName: 'clerk',
  options: {
    logoPlacement: 'inside' as const,
    logoLinkUrl: basePath || '/',
    logoImageUrl: `${window.location.origin}${basePath}/logo.svg`,
  },
  variables: {
    colorPrimary: '#ff6b35',
    colorForeground: '#111a2e',
    colorMutedForeground: '#637087',
    colorDanger: '#d94545',
    colorBackground: '#f9f6ef',
    colorInput: '#f0ece2',
    colorInputForeground: '#111a2e',
    colorNeutral: '#d8d1c4',
    fontFamily: 'Manrope, sans-serif',
    borderRadius: '0.75rem',
  },
  elements: {
    rootBox: 'w-full flex justify-center',
    cardBox: 'bg-[#f9f6ef] rounded-2xl w-[440px] max-w-full overflow-hidden border border-[#d8d1c4]',
    card: '!shadow-none !border-0 !bg-transparent !rounded-none',
    footer: '!shadow-none !border-0 !bg-transparent !rounded-none',
    headerTitle: 'text-[#111a2e] font-bold',
    headerSubtitle: 'text-[#637087]',
    socialButtonsBlockButtonText: 'text-[#111a2e]',
    formFieldLabel: 'text-[#111a2e]',
    footerActionLink: 'text-[#d95124] font-semibold',
    footerActionText: 'text-[#637087]',
    dividerText: 'text-[#637087]',
    identityPreviewEditButton: 'text-[#d95124]',
    formFieldSuccessText: 'text-[#237660]',
    alertText: 'text-[#d94545]',
    logoBox: 'h-9',
    logoImage: 'h-9',
    socialButtonsBlockButton: 'border-[#d8d1c4] bg-[#f0ece2] hover:bg-[#e7e1d6]',
    formButtonPrimary: 'bg-[#ff6b35] hover:bg-[#e85a28] text-[#f9f6ef] shadow-none',
    formFieldInput: 'bg-[#f0ece2] border-[#d8d1c4] text-[#111a2e]',
    footerAction: 'bg-transparent',
    dividerLine: 'bg-[#d8d1c4]',
    alert: 'bg-[#fff0ed] border-[#f3b7aa]',
    otpCodeFieldInput: 'bg-[#f0ece2] border-[#d8d1c4]',
    formFieldRow: 'gap-1',
    main: 'gap-5',
  },
};

function stripBase(path: string) {
  return basePath && path.startsWith(basePath) ? path.slice(basePath.length) || '/' : path;
}
function money(value = 0) { return `$${Number(value).toFixed(2)}`; }
function compact(value = 0) { return new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(Number(value)); }
function dateLabel(value?: string | null) { return value ? new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(value)) : 'Never'; }
function cx(...items: Array<string | false | undefined>) { return items.filter(Boolean).join(' '); }

function Logo({ light = false }: { light?: boolean }) {
  return <Link href="/" data-testid="link-logo" className="flex items-center gap-2.5">
    <span className="grid h-8 w-8 place-items-center rounded-[9px] bg-[#ff6b35] text-[#111a2e]">
      <span className="text-lg font-black leading-none">E</span>
    </span>
    <span className={cx('text-[15px] font-extrabold tracking-[.22em]', light ? 'text-[#f9f6ef]' : 'text-[#111a2e]')}>EKYVA</span>
  </Link>;
}

function StatusPill({ status, label }: { status: string; label?: string }) {
  const tone = status === 'healthy' || status === 'completed' || status === 'active' ? 'green' : status === 'processing' || status === 'degraded' ? 'amber' : 'red';
  return <span data-testid={`status-${status}`} className={cx('inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-[.08em]', tone === 'green' && 'bg-[#d9f2e3] text-[#237660]', tone === 'amber' && 'bg-[#fff0c6] text-[#966318]', tone === 'red' && 'bg-[#ffe0dc] text-[#a53c36]')}>
    <span className={cx('signal-dot h-1.5 w-1.5 rounded-full', tone === 'green' && 'bg-[#2d9a74]', tone === 'amber' && 'bg-[#db941b]', tone === 'red' && 'bg-[#d9534f]')} />{label ?? status}
  </span>;
}

function Skeleton({ className = '' }: { className?: string }) { return <div className={cx('animate-pulse rounded-lg bg-[#e9e4da]', className)} />; }
function QueryState({ loading, error, onRetry, children, empty = false }: { loading?: boolean; error?: boolean; onRetry?: () => void; children: React.ReactNode; empty?: boolean }) {
  if (loading) return <div className="grid gap-3"><Skeleton className="h-24 w-full" /><Skeleton className="h-24 w-full" /></div>;
  if (error) return <div className="flex items-center justify-between rounded-xl border border-[#f0bdb4] bg-[#fff0ed] p-4 text-sm text-[#8e3732]" data-testid="state-error"><span className="flex items-center gap-2"><TriangleAlert size={16} /> Signal unavailable right now.</span><button onClick={onRetry} className="font-bold underline" data-testid="button-retry">Retry</button></div>;
  if (empty) return <div className="grid place-items-center rounded-xl border border-dashed border-[#cfc7b8] bg-[#f5f1e8] px-5 py-14 text-center"><CircleOff size={25} className="mb-3 text-[#9c9588]" /><p className="text-sm font-semibold">No records in this window</p><p className="mt-1 text-xs text-[#737b8c]">New activity will resolve here when the gateway receives traffic.</p></div>;
  return <>{children}</>;
}

function Landing() {
  return <main className="min-h-[100dvh] overflow-hidden bg-[#111a2e] text-[#f9f6ef]">
    <header className="relative z-10 mx-auto flex max-w-7xl items-center justify-between px-6 py-6 lg:px-10">
      <Logo light />
      <nav className="hidden items-center gap-7 text-sm text-[#bdc5d0] md:flex">
        <a href="#signal" className="transition-colors hover:text-[#f9f6ef]">The signal</a>
        <a href="#routing" className="transition-colors hover:text-[#f9f6ef]">Routing</a>
        <a href="#operators" className="transition-colors hover:text-[#f9f6ef]">For teams</a>
      </nav>
      <div className="flex items-center gap-3">
        <Link href="/sign-in" data-testid="link-sign-in" className="hidden px-3 py-2 text-sm font-bold text-[#dce2e8] transition-colors hover:text-[#ffb097] sm:block">Sign in</Link>
        <Link href="/sign-up" data-testid="link-sign-up" className="rounded-lg bg-[#ff6b35] px-4 py-2.5 text-sm font-bold text-[#111a2e] transition-transform hover:-translate-y-0.5">Open console <ArrowRight size={15} className="ml-1 inline" /></Link>
      </div>
    </header>
    <section className="relative mx-auto grid max-w-7xl gap-14 px-6 pb-24 pt-16 lg:grid-cols-[1.03fr_.97fr] lg:items-center lg:px-10 lg:pb-36 lg:pt-28">
      <div className="absolute -left-40 top-4 h-96 w-96 rounded-full bg-[#ff6b35]/10 blur-3xl" />
      <div className="relative animate-rise">
        <div className="mb-7 flex items-center gap-2 text-[11px] font-bold uppercase tracking-[.2em] text-[#8be1c7]"><span className="signal-dot h-2 w-2 rounded-full bg-[#8be1c7]" /> One control plane for AI</div>
        <h1 className="max-w-3xl text-[clamp(3.5rem,8vw,7.7rem)] font-extrabold leading-[.91] tracking-[-.075em]">Route the<br /><span className="text-[#ff6b35]">signal.</span></h1>
        <p className="mt-8 max-w-xl text-lg leading-8 text-[#bdc5d0]">EKYVA gives your team one wallet, one key surface, and one intelligent path through every model you trust.</p>
        <div className="mt-9 flex flex-wrap items-center gap-4">
          <Link href="/sign-up" data-testid="link-start-building" className="rounded-lg bg-[#f9f6ef] px-5 py-3.5 text-sm font-extrabold text-[#111a2e] transition-transform hover:-translate-y-1">Start building <ArrowRight size={16} className="ml-2 inline" /></Link>
          <a href="#signal" className="text-sm font-bold text-[#bdc5d0] transition-colors hover:text-[#f9f6ef]">See the operating model <ArrowDownRight size={16} className="ml-1 inline" /></a>
        </div>
        <div className="mt-14 flex gap-10 border-t border-[#334057] pt-5 text-xs text-[#8f9aab]"><span><strong className="text-[#f9f6ef]">05</strong> capabilities</span><span><strong className="text-[#f9f6ef]">01</strong> trusted key</span><span><strong className="text-[#f9f6ef]">24/7</strong> provider watch</span></div>
      </div>
      <div className="relative animate-rise delay-2">
        <div className="absolute -inset-5 rounded-[2rem] border border-[#8be1c7]/10 bg-[#8be1c7]/5" />
        <div className="relative overflow-hidden rounded-2xl border border-[#334057] bg-[#1b263d] shadow-2xl shadow-black/20">
          <div className="flex items-center justify-between border-b border-[#334057] px-5 py-4"><div className="flex items-center gap-2 text-xs font-bold"><span className="h-2 w-2 rounded-full bg-[#8be1c7]" /> LIVE ROUTING FABRIC</div><span className="mono text-[10px] text-[#78859b]">EKYVA / 01</span></div>
          <div className="grid grid-cols-2 border-b border-[#334057]"><div className="p-5"><p className="text-[10px] uppercase tracking-[.14em] text-[#78859b]">Current route</p><p className="mt-2 text-2xl font-bold">balanced</p><p className="mt-1 text-xs text-[#8be1c7]">adaptive failover on</p></div><div className="border-l border-[#334057] p-5"><p className="text-[10px] uppercase tracking-[.14em] text-[#78859b]">Providers healthy</p><p className="mt-2 text-2xl font-bold">06 <span className="text-base text-[#78859b]">/ 07</span></p><p className="mt-1 text-xs text-[#ffb097]">1 under observation</p></div></div>
          <div className="space-y-4 p-5"><div className="flex items-end gap-1.5">{[38,52,45,73,59,80,68,88,72,94,78,86,91,83,96,89,100,93].map((height, i) => <span key={i} className={cx('h-28 flex-1 rounded-t-sm bg-[#ff6b35]/70', i > 14 && 'bg-[#8be1c7]')} style={{ height: `${height / 1.3}px` }} />)}</div><div className="flex justify-between text-[10px] text-[#78859b]"><span>10:00</span><span>Requests / 24 hours</span><span>Now</span></div></div>
          <div className="m-5 mt-0 flex items-center justify-between rounded-lg bg-[#111a2e] px-4 py-3"><span className="flex items-center gap-2 text-xs text-[#bdc5d0]"><span className="h-1.5 w-1.5 rounded-full bg-[#8be1c7]" /> Failover policy armed</span><span className="mono text-xs text-[#8be1c7]">99.2% OK</span></div>
        </div>
      </div>
    </section>
    <section id="signal" className="bg-[#f9f6ef] px-6 py-24 text-[#111a2e] lg:px-10 lg:py-32"><div className="mx-auto max-w-7xl"><div className="grid gap-10 lg:grid-cols-[.8fr_1.2fr]"><div><p className="text-[11px] font-bold uppercase tracking-[.2em] text-[#d95124]">A useful abstraction</p><h2 className="mt-4 max-w-md text-4xl font-extrabold tracking-[-.05em] lg:text-6xl">Less plumbing.<br />More signal.</h2></div><div className="grid gap-5 md:grid-cols-3"><Feature icon={<WalletCards />} number="01" title="One wallet" copy="Fund once. Spend across providers without rebuilding your billing layer." /><Feature icon={<Radar />} number="02" title="Clear health" copy="See latency, reliability, and availability before a bad route becomes an incident." /><Feature icon={<SlidersHorizontal />} number="03" title="Smart policy" copy="Set the tradeoff. EKYVA chooses the model and fails over when the signal changes." /></div></div></div></section>
    <section id="routing" className="grid-paper bg-[#d9f2e3] px-6 py-24 text-[#111a2e] lg:px-10 lg:py-32"><div className="mx-auto grid max-w-7xl gap-12 lg:grid-cols-[1fr_1fr] lg:items-center"><div><p className="text-[11px] font-bold uppercase tracking-[.2em] text-[#237660]">Routing modes</p><h2 className="mt-4 max-w-lg text-4xl font-extrabold tracking-[-.05em] lg:text-6xl">You choose the bias.<br />We watch the edge.</h2><p className="mt-6 max-w-md leading-7 text-[#42665a]">Start with a simple operating posture. The gateway keeps the route practical as provider conditions move.</p></div><div className="space-y-3">{[['economy','Keep unit cost disciplined','Cost-aware model selection'],['balanced','The daily driver','Cost, quality, and latency together'],['quality','Spend for the hard moments','Best available route first']].map(([mode, title, desc], i) => <div key={mode} className={cx('flex items-center gap-4 rounded-xl border p-5', i === 1 ? 'border-[#111a2e] bg-[#111a2e] text-[#f9f6ef]' : 'border-[#9acbb9] bg-[#e8f8ee]')}><span className="mono w-7 text-sm">{String(i + 1).padStart(2, '0')}</span><div className="flex-1"><p className="font-extrabold">{title}</p><p className={cx('mt-1 text-xs', i === 1 ? 'text-[#b9c4d1]' : 'text-[#628173]')}>{desc}</p></div><span className={cx('rounded-full px-2.5 py-1 text-[10px] font-bold uppercase', i === 1 ? 'bg-[#ff6b35] text-[#111a2e]' : 'bg-[#c7e8d7] text-[#42665a]')}>{mode}</span></div>)}</div></div></section>
    <section id="operators" className="bg-[#111a2e] px-6 py-24 text-[#f9f6ef] lg:px-10 lg:py-32"><div className="mx-auto flex max-w-7xl flex-col justify-between gap-10 md:flex-row md:items-end"><div><p className="text-[11px] font-bold uppercase tracking-[.2em] text-[#ffb097]">Built for the people on call</p><h2 className="mt-4 max-w-2xl text-4xl font-extrabold tracking-[-.05em] lg:text-6xl">A calmer console<br />for a noisy stack.</h2></div><Link href="/sign-up" data-testid="link-open-console-footer" className="rounded-lg bg-[#ff6b35] px-5 py-3.5 text-sm font-extrabold text-[#111a2e]">Open EKYVA <ArrowRight size={16} className="ml-2 inline" /></Link></div><div className="mt-16 grid border-y border-[#334057] md:grid-cols-3">{[['Platform teams','Give every product one reliable AI ingress point.'],['Developers','Keep your integration stable while models change underneath.'],['Operators','Find the cost, health, and route story in a single glance.']].map(([title, copy]) => <div key={title} className="border-b border-[#334057] px-0 py-7 md:border-b-0 md:border-r md:px-8 md:first:pl-0 md:last:border-0"><h3 className="font-bold">{title}</h3><p className="mt-2 max-w-xs text-sm leading-6 text-[#9ea9b9]">{copy}</p></div>)}</div></section>
    <footer className="flex flex-col justify-between gap-4 bg-[#111a2e] px-6 pb-10 text-xs text-[#78859b] md:flex-row lg:px-10"><span>© 2025 EKYVA AI</span><span>Access layer for the model era.</span></footer>
  </main>;
}

function Feature({ icon, number, title, copy }: { icon: React.ReactNode; number: string; title: string; copy: string }) {
  return <div className="border-t border-[#d8d1c4] pt-4"><div className="flex items-center justify-between text-[#d95124]"><span>{icon}</span><span className="mono text-xs">{number}</span></div><h3 className="mt-6 font-extrabold">{title}</h3><p className="mt-2 text-sm leading-6 text-[#667184]">{copy}</p></div>;
}

function AuthPage({ signUp = false }: { signUp?: boolean }) {
  return <div className="grid min-h-[100dvh] bg-[#111a2e] lg:grid-cols-[.8fr_1.2fr]"><div className="hidden flex-col justify-between p-10 lg:flex"><Logo light /><div><p className="mb-5 text-[11px] font-bold uppercase tracking-[.2em] text-[#8be1c7]">EKYVA AI / ACCESS LAYER</p><h1 className="max-w-md text-6xl font-extrabold leading-[.92] tracking-[-.06em] text-[#f9f6ef]">Your models.<br /><span className="text-[#ff6b35]">One route.</span></h1><p className="mt-6 max-w-sm text-sm leading-6 text-[#9ea9b9]">A trusted control plane for AI access, spend, provider health, and model routing.</p></div><span className="mono text-[10px] text-[#78859b]">SECURE SESSION / CLERK</span></div><div className="grid place-items-center bg-[#f9f6ef] px-5 py-10"><div>{signUp ? <SignUp routing="path" path={`${basePath}/sign-up`} signInUrl={`${basePath}/sign-in`} /> : <SignIn routing="path" path={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`} />}</div></div></div>;
}

const nav = [
  { href: '/dashboard', label: 'Overview', icon: LayoutDashboard },
  { href: '/models', label: 'Models & capabilities', icon: Layers3 },
  { href: '/api-keys', label: 'API keys', icon: KeyRound },
  { href: '/usage', label: 'Usage & requests', icon: BarChart3 },
];
function PortalShell({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [location] = useLocation();
  const { signOut } = useClerk();
  const { user } = useUser();
  const health = useHealthCheck();
  return <div className="min-h-[100dvh] bg-[#f3f0e9] lg:grid lg:grid-cols-[246px_1fr]">
    <aside className={cx('fixed inset-y-0 left-0 z-40 flex w-[246px] flex-col bg-[#111a2e] px-4 py-5 text-[#f9f6ef] transition-transform lg:static lg:translate-x-0', open ? 'translate-x-0' : '-translate-x-full')}>
      <div className="flex items-center justify-between px-2"><Logo light /><button onClick={() => setOpen(false)} className="text-[#9ea9b9] lg:hidden" data-testid="button-close-menu"><X size={19} /></button></div>
      <div className="mt-10 px-2"><p className="mb-3 text-[10px] font-bold uppercase tracking-[.16em] text-[#78859b]">Control plane</p><nav className="space-y-1">{nav.map(({ href, label, icon: Icon }) => <Link key={href} href={href} onClick={() => setOpen(false)} data-testid={`link-nav-${href.slice(1)}`} className={cx('flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-semibold transition-colors', location === href ? 'bg-[#ff6b35] text-[#111a2e]' : 'text-[#aeb8c7] hover:bg-[#26334c] hover:text-[#f9f6ef]')}><Icon size={17} strokeWidth={location === href ? 2.5 : 1.8} />{label}</Link>)}</nav></div>
      <div className="mt-8 px-2"><p className="mb-3 text-[10px] font-bold uppercase tracking-[.16em] text-[#78859b]">Workspace</p><nav className="space-y-1">{[{ href: '/settings', label: 'Settings', icon: Settings2 }, { href: '/admin', label: 'Platform health', icon: Activity }].map(({ href, label, icon: Icon }) => <Link key={href} href={href} onClick={() => setOpen(false)} data-testid={`link-nav-${href.slice(1)}`} className={cx('flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-semibold transition-colors', location === href ? 'bg-[#ff6b35] text-[#111a2e]' : 'text-[#aeb8c7] hover:bg-[#26334c] hover:text-[#f9f6ef]')}><Icon size={17} />{label}</Link>)}</nav></div>
      <div className="mt-auto rounded-xl border border-[#334057] bg-[#1b263d] p-3"><div className="mb-3 flex items-center justify-between"><span className="text-[10px] font-bold uppercase tracking-[.14em] text-[#78859b]">Gateway status</span><span className={cx('signal-dot h-2 w-2 rounded-full', health.isError ? 'bg-[#d9534f]' : 'bg-[#8be1c7]')} /></div><p className="text-xs font-semibold" data-testid="status-gateway">{health.isError ? 'Signal degraded' : health.isLoading ? 'Checking fabric…' : 'All systems nominal'}</p><p className="mt-1 text-[11px] text-[#8f9aab]">{health.isError ? 'Health endpoint did not respond.' : 'Provider fabric is online.'}</p></div>
      <div className="mt-4 flex items-center gap-2 border-t border-[#334057] px-2 pt-4"><div className="grid h-8 w-8 place-items-center rounded-full bg-[#d9f2e3] text-xs font-extrabold text-[#237660]">{(user?.firstName?.[0] ?? user?.emailAddresses?.[0]?.emailAddress?.[0] ?? 'O').toUpperCase()}</div><div className="min-w-0 flex-1"><p className="truncate text-xs font-bold">{user?.firstName ?? user?.emailAddresses?.[0]?.emailAddress ?? 'Operator'}</p><p className="truncate text-[10px] text-[#78859b]">{user?.emailAddresses?.[0]?.emailAddress ?? 'Workspace'}</p></div><button onClick={() => signOut({ redirectUrl: basePath || '/' })} title="Sign out" data-testid="button-sign-out" className="text-[#78859b] transition-colors hover:text-[#ffb097]"><LogOut size={15} /></button></div>
    </aside>
    {open && <button className="fixed inset-0 z-30 bg-[#111a2e]/40 lg:hidden" onClick={() => setOpen(false)} aria-label="Close navigation" data-testid="button-overlay-close" />}
    <div className="min-w-0"><header className="sticky top-0 z-20 flex h-[70px] items-center justify-between border-b border-[#ded8cd] bg-[#f3f0e9]/95 px-5 backdrop-blur md:px-8"><button onClick={() => setOpen(true)} className="text-[#111a2e] lg:hidden" data-testid="button-open-menu"><Menu size={21} /></button><div className="hidden lg:block"><p className="mono text-[10px] uppercase tracking-[.16em] text-[#8a8e98]">EKYVA / operator console</p><p className="mt-0.5 text-sm font-bold">{pageName(location)}</p></div><div className="ml-auto flex items-center gap-3"><span className="hidden items-center gap-2 text-xs font-semibold text-[#667184] sm:flex"><span className="signal-dot h-1.5 w-1.5 rounded-full bg-[#2d9a74]" /> Session active</span><Link href="/settings" data-testid="link-top-settings" className="rounded-lg border border-[#d8d1c4] p-2 text-[#667184] transition-colors hover:bg-[#eae5dc]"><Settings2 size={16} /></Link></div></header><main className="mx-auto max-w-[1440px] p-5 md:p-8">{children}</main></div>
  </div>;
}
function pageName(location: string) { return nav.find((item) => item.href === location)?.label ?? (location === '/settings' ? 'Settings' : location === '/admin' ? 'Platform health' : 'Console'); }

function PageHeader({ eyebrow, title, copy, action }: { eyebrow: string; title: string; copy: string; action?: React.ReactNode }) {
  return <div className="mb-8 flex flex-col justify-between gap-4 md:flex-row md:items-end"><div><p className="mono text-[10px] font-medium uppercase tracking-[.18em] text-[#d95124]">{eyebrow}</p><h1 className="mt-2 text-3xl font-extrabold tracking-[-.045em] text-[#111a2e] md:text-4xl">{title}</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-[#707887]">{copy}</p></div>{action}</div>;
}
function Metric({ label, value, note, icon: Icon, accent = 'orange', testId }: { label: string; value: string; note: string; icon: typeof Gauge; accent?: 'orange' | 'green' | 'blue'; testId: string }) {
  return <div className="rounded-xl border border-[#ded8cd] bg-[#f9f6ef] p-4 transition-transform hover:-translate-y-0.5" data-testid={testId}><div className="flex items-start justify-between"><span className={cx('grid h-8 w-8 place-items-center rounded-lg', accent === 'orange' && 'bg-[#ffe0d4] text-[#d95124]', accent === 'green' && 'bg-[#d9f2e3] text-[#237660]', accent === 'blue' && 'bg-[#dce7fa] text-[#3d6db5]')}><Icon size={16} /></span><span className="mono text-[10px] text-[#8a8e98]">30D</span></div><p className="mt-5 text-2xl font-extrabold tracking-[-.04em]">{value}</p><p className="mt-1 text-xs font-semibold text-[#4e5869]">{label}</p><p className="mt-2 text-[11px] text-[#8a8e98]">{note}</p></div>;
}

function Dashboard() {
  const summary = useGetDashboardSummary();
  const wallet = useGetWallet();
  const requests = useListRequests();
  const caps = useListCapabilities();
  const generate = useGenerate();
  const [input, setInput] = useState('');
  const [capability, setCapability] = useState('text.generate');
  const [result, setResult] = useState<{ output: string; model: string; provider: string } | null>(null);
  const data = summary.data;
  const latest = (requests.data ?? []).slice(0, 5);
  const capOptions = caps.data ?? [];
  const submitProbe = () => { if (!input.trim()) return; generate.mutate({ data: { capability: capability as 'text.generate', input, mode: data?.routing_mode ?? 'balanced', model: null, max_output_tokens: 256 } }, { onSuccess: (res) => { setResult(res); setInput(''); } }); };
  return <div className="animate-rise"><PageHeader eyebrow="Overview / live" title="Good morning, operator." copy="Your gateway at a glance. Spend, reliability, and the route that is carrying the work." action={<Link href="/api-keys" data-testid="link-dashboard-api-keys" className="rounded-lg bg-[#111a2e] px-4 py-2.5 text-sm font-bold text-[#f9f6ef] transition-transform hover:-translate-y-0.5"><KeyRound size={15} className="mr-2 inline" /> Manage access</Link>} />
    <QueryState loading={summary.isLoading} error={!!summary.error} onRetry={() => summary.refetch()}><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><Metric label="Wallet balance" value={money(data?.wallet_balance ?? wallet.data?.balance)} note={`${wallet.data?.currency ?? 'USD'} available to route`} icon={WalletCards} testId="metric-wallet-balance" /><Metric label="Monthly requests" value={compact(data?.monthly_requests)} note={`${compact(data?.monthly_units)} units processed`} icon={Activity} accent="blue" testId="metric-monthly-requests" /><Metric label="Success rate" value={`${Number(data?.success_rate ?? 0).toFixed(1)}%`} note="Across the active route fabric" icon={CheckCircle2} accent="green" testId="metric-success-rate" /><Metric label="Average latency" value={`${Math.round(data?.avg_latency_ms ?? 0)}ms`} note={`${data?.active_models ?? 0} models currently active`} icon={Clock3} accent="orange" testId="metric-average-latency" /></div></QueryState>
    <div className="mt-5 grid gap-5 xl:grid-cols-[1.25fr_.75fr]"><section className="rounded-xl border border-[#ded8cd] bg-[#f9f6ef] p-5" data-testid="section-recent-requests"><div className="flex items-center justify-between"><div><p className="mono text-[10px] uppercase tracking-[.16em] text-[#8a8e98]">Request stream</p><h2 className="mt-1 text-lg font-extrabold">Recent activity</h2></div><Link href="/usage" data-testid="link-view-all-requests" className="text-xs font-bold text-[#d95124]">View all <ArrowRight size={13} className="ml-1 inline" /></Link></div><QueryState loading={requests.isLoading} error={!!requests.error} onRetry={() => requests.refetch()} empty={!requests.isLoading && !requests.error && !latest.length}><div className="mt-4 overflow-x-auto"><table className="data-table w-full min-w-[580px] text-left text-xs"><thead><tr><th>Capability</th><th>Route</th><th>Status</th><th>Units</th><th>Latency</th></tr></thead><tbody>{latest.map((item) => <RequestRow item={item} key={item.id} />)}</tbody></table></div></QueryState></section><section className="rounded-xl bg-[#111a2e] p-5 text-[#f9f6ef]" data-testid="section-routing-posture"><div className="flex items-start justify-between"><div><p className="mono text-[10px] uppercase tracking-[.16em] text-[#78859b]">Routing posture</p><h2 className="mt-1 text-lg font-extrabold">{data?.routing_mode ?? 'balanced'}</h2></div><Network size={19} className="text-[#8be1c7]" /></div><p className="mt-7 text-sm leading-6 text-[#b8c2d0]">EKYVA is selecting the best available route across <strong className="text-[#f9f6ef]">{data?.healthy_providers ?? 0} healthy providers</strong>.</p><div className="mt-7 flex items-center justify-between border-t border-[#334057] pt-4 text-xs"><span className="text-[#78859b]">Active models</span><span className="font-bold text-[#8be1c7]">{data?.active_models ?? 0}</span></div><div className="mt-3 flex items-center justify-between text-xs"><span className="text-[#78859b]">Failover</span><span className="flex items-center gap-1.5 font-bold text-[#8be1c7]"><Check size={13} /> Armed</span></div><Link href="/settings" data-testid="link-adjust-routing" className="mt-7 block rounded-lg border border-[#52617a] px-3 py-2.5 text-center text-xs font-bold transition-colors hover:bg-[#26334c]">Adjust routing mode <ArrowRight size={13} className="ml-1 inline" /></Link></section></div>
    <section className="mt-5 rounded-xl border border-[#ded8cd] bg-[#f9f6ef] p-5" data-testid="section-probe"><div className="flex flex-col justify-between gap-3 md:flex-row md:items-center"><div><p className="mono text-[10px] uppercase tracking-[.16em] text-[#8a8e98]">Gateway probe</p><h2 className="mt-1 text-lg font-extrabold">Send a test request</h2></div><span className="rounded-full bg-[#d9f2e3] px-2.5 py-1 text-[10px] font-bold uppercase tracking-[.08em] text-[#237660]"><Zap size={11} className="mr-1 inline" /> Live route</span></div><div className="mt-4 grid gap-3 md:grid-cols-[190px_1fr_auto]"><select value={capability} onChange={(e) => setCapability(e.target.value)} data-testid="select-probe-capability" className="rounded-lg border border-[#d8d1c4] bg-[#f3f0e9] px-3 py-2.5 text-sm outline-none focus:border-[#ff6b35]">{(capOptions.length ? capOptions : [{ id: 'text.generate', label: 'Text generation' } as Capability]).map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select><input value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submitProbe()} placeholder="Ask the gateway something small..." data-testid="input-probe" className="rounded-lg border border-[#d8d1c4] bg-[#f3f0e9] px-3 py-2.5 text-sm outline-none focus:border-[#ff6b35]" /><button onClick={submitProbe} disabled={generate.isPending || !input.trim()} data-testid="button-run-probe" className="rounded-lg bg-[#ff6b35] px-4 py-2.5 text-sm font-extrabold text-[#111a2e] disabled:cursor-not-allowed disabled:opacity-50">{generate.isPending ? 'Routing…' : 'Run probe'}</button></div>{result && <div className="mt-4 rounded-lg border border-[#b6ddc7] bg-[#ecfaf1] p-4 text-sm"><div className="flex items-center gap-2 text-xs font-bold text-[#237660]"><CheckCircle2 size={14} /> Response received via {result.provider} / {result.model}</div><p className="mt-2 leading-6 text-[#294d41]">{result.output}</p></div>}{generate.error && <p className="mt-3 text-xs text-[#a53c36]">The probe could not be routed. Check your wallet or try again.</p>}</section>
  </div>;
}
function RequestRow({ item }: { item: RequestSummary }) { return <tr data-testid={`row-request-${item.id}`}><td><span className="font-bold">{item.capability}</span><span className="mt-1 block text-[10px] text-[#8a8e98]">{dateLabel(item.created_at)}</span></td><td><span className="font-semibold">{item.model}</span><span className="mt-1 block text-[10px] text-[#8a8e98]">{item.provider}</span></td><td><StatusPill status={item.status} /></td><td className="mono">{compact(item.units)}</td><td className="mono">{item.latency_ms}ms</td></tr>; }

function ModelsPage() {
  const models = useListModels();
  const capabilities = useListCapabilities();
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const filtered = (models.data ?? []).filter((model) => (filter === 'all' || model.status === filter) && `${model.display_name} ${model.provider}`.toLowerCase().includes(search.toLowerCase()));
  return <div className="animate-rise"><PageHeader eyebrow="Catalog / provider fabric" title="Models & capabilities" copy="The available surface area for your requests, scored by quality, reliability, and response speed." action={<div className="flex items-center gap-2 rounded-lg border border-[#ded8cd] bg-[#f9f6ef] px-3 py-2 text-xs font-bold"><span className="h-2 w-2 rounded-full bg-[#2d9a74]" /> {models.data?.length ?? '—'} models observed</div>} /><div className="mb-5 grid gap-3 md:grid-cols-3">{(capabilities.data ?? []).map((cap) => <div key={cap.id} className="rounded-xl border border-[#ded8cd] bg-[#f9f6ef] p-4 transition-transform hover:-translate-y-0.5" data-testid={`card-capability-${cap.id}`}><div className="flex justify-between"><Code2 size={17} className="text-[#d95124]" /><span className="mono text-xs text-[#8a8e98]">{cap.model_count} models</span></div><h3 className="mt-5 font-extrabold">{cap.label}</h3><p className="mt-1 text-xs leading-5 text-[#707887]">{cap.description}</p></div>)}</div><section className="rounded-xl border border-[#ded8cd] bg-[#f9f6ef] p-5"><div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between"><div><p className="mono text-[10px] uppercase tracking-[.16em] text-[#8a8e98]">Registered routes</p><h2 className="mt-1 text-lg font-extrabold">Model health matrix</h2></div><div className="flex flex-col gap-2 sm:flex-row"><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search model or provider" data-testid="input-search-models" className="rounded-lg border border-[#d8d1c4] bg-[#f3f0e9] px-3 py-2 text-xs outline-none focus:border-[#ff6b35]" /><div className="flex rounded-lg border border-[#d8d1c4] bg-[#f3f0e9] p-1">{['all', 'healthy', 'degraded'].map((item) => <button key={item} onClick={() => setFilter(item)} data-testid={`button-filter-${item}`} className={cx('rounded-md px-2.5 py-1.5 text-[10px] font-bold capitalize', filter === item ? 'bg-[#111a2e] text-[#f9f6ef]' : 'text-[#707887]')}>{item}</button>)}</div></div></div><QueryState loading={models.isLoading} error={!!models.error} onRetry={() => models.refetch()} empty={!models.isLoading && !models.error && !filtered.length}><div className="mt-4 overflow-x-auto"><table className="data-table w-full min-w-[760px] text-left text-xs"><thead><tr><th>Model</th><th>Status</th><th>Quality</th><th>Reliability</th><th>Latency</th><th>Unit cost</th><th>Context</th></tr></thead><tbody>{filtered.map((model) => <ModelRow model={model} key={model.id} />)}</tbody></table></div></QueryState></section></div>;
}
function ModelRow({ model }: { model: Model }) { return <tr data-testid={`row-model-${model.id}`}><td><div className="flex items-center gap-3"><span className="grid h-8 w-8 place-items-center rounded-lg bg-[#dce7fa] text-[#3d6db5]"><Server size={15} /></span><div><p className="font-bold">{model.display_name}</p><p className="mt-1 text-[10px] text-[#8a8e98]">{model.provider} · {model.capabilities.slice(0, 2).join(' · ')}</p></div></div></td><td><StatusPill status={model.status} /></td><td><ScoreBar value={model.quality_score} /></td><td><ScoreBar value={model.reliability} /></td><td className="mono">{model.latency_ms}ms</td><td className="mono">${Number(model.unit_cost).toFixed(5)}</td><td className="mono">{model.context_window ? compact(model.context_window) : '—'}</td></tr>; }
function ScoreBar({ value }: { value: number }) { const percent = value > 1 ? value : value * 100; return <div className="flex items-center gap-2"><div className="h-1.5 w-16 overflow-hidden rounded-full bg-[#e2ddd3]"><div className="h-full rounded-full bg-[#2d9a74]" style={{ width: `${Math.min(100, percent)}%` }} /></div><span className="mono text-[10px]">{percent.toFixed(1)}</span></div>; }

function ApiKeysPage() {
  const queryClient = useQueryClient(); const keys = useListApiKeys(); const create = useCreateApiKey(); const remove = useDeleteApiKey(); const [name, setName] = useState(''); const [revealed, setRevealed] = useState<string | null>(null); const [notice, setNotice] = useState('');
  const submit = () => { if (!name.trim()) return; create.mutate({ data: { name: name.trim() } }, { onSuccess: (key) => { setRevealed(key.key); setName(''); setNotice('Key created. Copy it now — it will not be shown again.'); queryClient.invalidateQueries({ queryKey: getListApiKeysQueryKey() }); } }); };
  const revoke = (key: ApiKey) => { if (window.confirm(`Revoke ${key.name}? Existing requests using this key will stop working.`)) remove.mutate({ id: key.id }, { onSuccess: () => queryClient.invalidateQueries({ queryKey: getListApiKeysQueryKey() }) }); };
  return <div className="animate-rise"><PageHeader eyebrow="Access / developer keys" title="API keys" copy="Issue narrow, visible access for the services that call EKYVA. Treat the secret like production infrastructure." /><section className="rounded-xl border border-[#ded8cd] bg-[#f9f6ef] p-5"><div className="flex flex-col justify-between gap-4 md:flex-row md:items-end"><div><p className="mono text-[10px] uppercase tracking-[.16em] text-[#8a8e98]">Create access</p><h2 className="mt-1 text-lg font-extrabold">Provision a developer key</h2></div><div className="flex w-full gap-2 md:w-auto"><input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. production-ingress" data-testid="input-api-key-name" className="min-w-0 flex-1 rounded-lg border border-[#d8d1c4] bg-[#f3f0e9] px-3 py-2.5 text-sm outline-none focus:border-[#ff6b35] md:w-64" /><button onClick={submit} disabled={create.isPending || !name.trim()} data-testid="button-create-api-key" className="rounded-lg bg-[#ff6b35] px-4 py-2.5 text-sm font-extrabold text-[#111a2e] disabled:opacity-50"><Plus size={15} className="mr-1 inline" /> {create.isPending ? 'Creating…' : 'Create key'}</button></div></div>{notice && <div className="mt-4 flex items-center gap-2 rounded-lg border border-[#b6ddc7] bg-[#ecfaf1] p-3 text-xs font-semibold text-[#237660]" data-testid="status-api-key-created"><CheckCircle2 size={15} /> {notice}</div>}{revealed && <div className="mt-3 flex flex-col gap-2 rounded-lg border border-[#f1c59c] bg-[#fff6e9] p-4 md:flex-row md:items-center"><span className="mono min-w-0 flex-1 break-all text-xs text-[#744922]" data-testid="text-created-api-key">{revealed}</span><button onClick={() => navigator.clipboard?.writeText(revealed)} data-testid="button-copy-api-key" className="flex items-center justify-center gap-1 rounded-md border border-[#e7c28f] px-3 py-2 text-xs font-bold text-[#744922]"><Copy size={13} /> Copy secret</button><button onClick={() => setRevealed(null)} data-testid="button-dismiss-api-key" className="p-2 text-[#966318]"><X size={15} /></button></div>}</section><section className="mt-5 rounded-xl border border-[#ded8cd] bg-[#f9f6ef] p-5"><div className="flex items-center justify-between"><div><p className="mono text-[10px] uppercase tracking-[.16em] text-[#8a8e98]">Active surface</p><h2 className="mt-1 text-lg font-extrabold">Issued keys</h2></div><span className="rounded-full bg-[#e8e4dc] px-2.5 py-1 text-[10px] font-bold text-[#707887]">{keys.data?.length ?? 0} total</span></div><QueryState loading={keys.isLoading} error={!!keys.error} onRetry={() => keys.refetch()} empty={!keys.isLoading && !keys.error && !(keys.data?.length)}><div className="mt-4 overflow-x-auto"><table className="data-table w-full min-w-[620px] text-left text-xs"><thead><tr><th>Name</th><th>Prefix</th><th>Status</th><th>Last used</th><th>Created</th><th /></tr></thead><tbody>{(keys.data ?? []).map((key) => <tr key={key.id} data-testid={`row-api-key-${key.id}`}><td className="font-bold">{key.name}</td><td className="mono">{key.prefix}••••••</td><td><StatusPill status={key.status} /></td><td className="text-[#707887]">{dateLabel(key.last_used_at)}</td><td className="text-[#707887]">{dateLabel(key.created_at)}</td><td className="text-right"><button onClick={() => revoke(key)} disabled={key.status === 'revoked' || remove.isPending} data-testid={`button-revoke-key-${key.id}`} className="inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-[11px] font-bold text-[#a53c36] hover:bg-[#ffe0dc] disabled:opacity-40"><Trash2 size={13} /> Revoke</button></td></tr>)}</tbody></table></div></QueryState></section></div>;
}

function UsagePage() {
  const [range, setRange] = useState<'7d' | '30d' | '90d'>('30d');
  const usage = useGetUsage({ range }, { query: { queryKey: getGetUsageQueryKey({ range }) } });
  const requests = useListRequests();
  const points = usage.data?.points ?? [];
  const max = Math.max(...points.map((p) => p.requests), 1);
  return <div className="animate-rise"><PageHeader eyebrow="Observability / spend" title="Usage & requests" copy="Understand the shape of demand before it becomes a billing surprise or a latency incident." action={<div className="flex rounded-lg border border-[#ded8cd] bg-[#f9f6ef] p-1">{(['7d', '30d', '90d'] as const).map((item) => <button key={item} onClick={() => setRange(item)} data-testid={`button-range-${item}`} className={cx('rounded-md px-3 py-1.5 text-xs font-bold', range === item ? 'bg-[#111a2e] text-[#f9f6ef]' : 'text-[#707887]')}>{item}</button>)}</div>} /><QueryState loading={usage.isLoading} error={!!usage.error} onRetry={() => usage.refetch()}><div className="grid gap-3 sm:grid-cols-3"><Metric label="Requests" value={compact(usage.data?.total_requests)} note={`In the last ${range}`} icon={Activity} testId="usage-total-requests" /><Metric label="Units" value={compact(usage.data?.total_units)} note="Normalized gateway units" icon={Gauge} accent="blue" testId="usage-total-units" /><Metric label="Cost" value={money(usage.data?.total_cost)} note="Across all providers" icon={CreditCard} accent="green" testId="usage-total-cost" /></div><section className="mt-5 rounded-xl border border-[#ded8cd] bg-[#f9f6ef] p-5"><div className="flex items-center justify-between"><div><p className="mono text-[10px] uppercase tracking-[.16em] text-[#8a8e98]">Volume signal</p><h2 className="mt-1 text-lg font-extrabold">Requests by day</h2></div><span className="text-xs text-[#8a8e98]">{points.length} points</span></div>{!points.length ? <div className="mt-5"><QueryState empty>{null}</QueryState></div> : <div className="mt-7 flex h-44 items-end gap-1.5 border-b border-[#ded8cd]">{points.map((point) => <div key={point.date} className="group relative flex h-full flex-1 items-end"><div className="w-full rounded-t-sm bg-[#ff6b35] transition-opacity group-hover:opacity-70" style={{ height: `${Math.max(4, (point.requests / max) * 100)}%` }} /><span className="pointer-events-none absolute bottom-full left-1/2 mb-2 -translate-x-1/2 rounded bg-[#111a2e] px-2 py-1 text-[10px] text-[#f9f6ef] opacity-0 transition-opacity group-hover:opacity-100">{point.requests} req</span></div>)}</div>}</section></QueryState><section className="mt-5 rounded-xl border border-[#ded8cd] bg-[#f9f6ef] p-5"><div className="flex items-center justify-between"><div><p className="mono text-[10px] uppercase tracking-[.16em] text-[#8a8e98]">Trace log</p><h2 className="mt-1 text-lg font-extrabold">Request history</h2></div><span className="text-xs text-[#8a8e98]">Latest 50</span></div><QueryState loading={requests.isLoading} error={!!requests.error} onRetry={() => requests.refetch()} empty={!requests.isLoading && !requests.error && !(requests.data?.length)}><div className="mt-4 overflow-x-auto"><table className="data-table w-full min-w-[700px] text-left text-xs"><thead><tr><th>Request</th><th>Capability</th><th>Provider / model</th><th>Status</th><th>Units</th><th>Latency</th><th>Received</th></tr></thead><tbody>{(requests.data ?? []).map((item) => <tr key={item.id} data-testid={`row-usage-request-${item.id}`}><td className="mono text-[#8a8e98]">{item.id.slice(0, 12)}</td><td className="font-bold">{item.capability}</td><td><span className="font-semibold">{item.provider}</span><span className="mt-1 block text-[10px] text-[#8a8e98]">{item.model}</span></td><td><StatusPill status={item.status} /></td><td className="mono">{compact(item.units)}</td><td className="mono">{item.latency_ms}ms</td><td className="text-[#707887]">{dateLabel(item.created_at)}</td></tr>)}</tbody></table></div></QueryState></section></div>;
}

function SettingsPage() {
  const userQuery = useGetCurrentUser();
  const update = useUpdateRoutingMode();
  const queryClient = useQueryClient();
  const user = userQuery.data;
  const [mode, setMode] = useState<string>(user?.routing_mode ?? 'balanced');
  const [saved, setSaved] = useState(false);
  const save = () => update.mutate({ data: { mode: mode as 'economy' | 'balanced' | 'quality' } }, { onSuccess: () => { setSaved(true); queryClient.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() }); queryClient.invalidateQueries({ queryKey: getGetCurrentUserQueryKey() }); } });
  return <div className="animate-rise"><PageHeader eyebrow="Workspace / policy" title="Settings" copy="Keep the account context and default routing posture close to the people operating the system." /><div className="grid gap-5 lg:grid-cols-[1.1fr_.9fr]"><section className="rounded-xl border border-[#ded8cd] bg-[#f9f6ef] p-5"><p className="mono text-[10px] uppercase tracking-[.16em] text-[#8a8e98]">Account</p><h2 className="mt-1 text-lg font-extrabold">Workspace identity</h2><div className="mt-6 grid gap-4 sm:grid-cols-2"><SettingField label="Name" value={user?.name ?? 'Loading…'} testId="text-settings-name" /><SettingField label="Email" value={user?.email ?? 'Loading…'} testId="text-settings-email" /><SettingField label="Plan" value={(user?.plan ?? 'starter').toUpperCase()} testId="text-settings-plan" /><SettingField label="Member since" value={user?.created_at ? new Date(user.created_at).toLocaleDateString() : '—'} testId="text-settings-created" /></div></section><section className="rounded-xl border border-[#ded8cd] bg-[#f9f6ef] p-5"><p className="mono text-[10px] uppercase tracking-[.16em] text-[#8a8e98]">Default policy</p><h2 className="mt-1 text-lg font-extrabold">Routing mode</h2><p className="mt-2 text-xs leading-5 text-[#707887]">The default bias used when requests do not specify an explicit mode.</p><div className="mt-5 space-y-2">{[['economy','Economy','Minimize unit cost where possible.'],['balanced','Balanced','Keep quality, cost, and latency in tension.'],['quality','Quality','Prefer the strongest available route.']].map(([value, title, copy]) => <button key={value} onClick={() => { setMode(value); setSaved(false); }} data-testid={`button-routing-${value}`} className={cx('flex w-full items-start gap-3 rounded-lg border p-3 text-left transition-colors', mode === value ? 'border-[#ff6b35] bg-[#fff0e9]' : 'border-[#ded8cd] hover:bg-[#f3f0e9]')}><span className={cx('mt-0.5 grid h-4 w-4 place-items-center rounded-full border', mode === value ? 'border-[#ff6b35] bg-[#ff6b35]' : 'border-[#bdb6aa]')}>{mode === value && <span className="h-1.5 w-1.5 rounded-full bg-[#f9f6ef]" />}</span><span><span className="block text-sm font-bold capitalize">{title}</span><span className="mt-1 block text-[11px] text-[#707887]">{copy}</span></span></button>)}</div><button onClick={save} disabled={update.isPending} data-testid="button-save-routing" className="mt-5 w-full rounded-lg bg-[#111a2e] px-4 py-2.5 text-sm font-bold text-[#f9f6ef] disabled:opacity-50">{update.isPending ? 'Saving…' : saved ? 'Policy saved' : 'Save routing policy'}</button></section></div></div>;
}
function SettingField({ label, value, testId }: { label: string; value: string; testId: string }) { return <div className="rounded-lg bg-[#f3f0e9] p-3"><p className="text-[10px] font-bold uppercase tracking-[.12em] text-[#8a8e98]">{label}</p><p className="mt-2 truncate text-sm font-bold" data-testid={testId}>{value}</p></div>; }

function AdminPage() {
  const overview = useGetAdminOverview(); const health = overview.data; const models = useListModels();
  return <div className="animate-rise"><PageHeader eyebrow="Admin / platform signal" title="Platform health" copy="A compact operational read on the provider fabric. Use this to spot a system trend, not to replace a provider's own dashboard." action={<button onClick={() => overview.refetch()} data-testid="button-refresh-health" className="rounded-lg border border-[#ded8cd] bg-[#f9f6ef] px-3 py-2.5 text-xs font-bold"><RefreshCw size={14} className="mr-2 inline" /> Refresh</button>} /><QueryState loading={overview.isLoading} error={!!overview.error} onRetry={() => overview.refetch()}><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><Metric label="Providers" value={String(health?.providers ?? 0)} note="Registered in the fabric" icon={Network} testId="admin-providers" /><Metric label="Healthy providers" value={String(health?.healthy_providers ?? 0)} note="Accepting new routes" icon={ShieldCheck} accent="green" testId="admin-healthy-providers" /><Metric label="Requests today" value={compact(health?.requests_today)} note="All capabilities" icon={Activity} accent="blue" testId="admin-requests-today" /><Metric label="Units today" value={compact(health?.units_today)} note="Normalized consumption" icon={Gauge} testId="admin-units-today" /></div><div className="mt-5 grid gap-5 lg:grid-cols-[.9fr_1.1fr]"><section className="rounded-xl border border-[#ded8cd] bg-[#f9f6ef] p-5"><div className="flex items-center justify-between"><div><p className="mono text-[10px] uppercase tracking-[.16em] text-[#8a8e98]">Fabric status</p><h2 className="mt-1 text-lg font-extrabold">Provider watch</h2></div><Radar size={18} className="text-[#d95124]" /></div><div className="mt-6 space-y-3">{(models.data ?? []).slice(0, 6).map((model) => <div key={model.id} className="flex items-center gap-3 border-b border-[#e6e0d6] pb-3 last:border-0 last:pb-0"><span className={cx('h-2 w-2 rounded-full', model.status === 'healthy' ? 'bg-[#2d9a74]' : model.status === 'degraded' ? 'bg-[#db941b]' : 'bg-[#d9534f]')} /><span className="flex-1 text-sm font-semibold">{model.provider}<span className="ml-2 text-xs font-normal text-[#8a8e98]">{model.display_name}</span></span><StatusPill status={model.status} /></div>)}</div></section><section className="rounded-xl bg-[#111a2e] p-5 text-[#f9f6ef]"><p className="mono text-[10px] uppercase tracking-[.16em] text-[#78859b]">Operator note</p><h2 className="mt-2 text-xl font-extrabold">The gateway is the fallback.</h2><p className="mt-3 max-w-lg text-sm leading-6 text-[#b8c2d0]">When a provider degrades, routing should be a policy decision — not a midnight code change. Keep an eye on healthy provider count and latency drift.</p><div className="mt-8 flex items-center gap-3 rounded-lg border border-[#334057] bg-[#1b263d] p-3"><div className="grid h-8 w-8 place-items-center rounded-full bg-[#d9f2e3] text-[#237660]"><Check size={16} /></div><div><p className="text-xs font-bold">Failover coverage active</p><p className="mt-1 text-[10px] text-[#8f9aab]">Policy engine is ready to move traffic.</p></div></div></section></div></QueryState></div>;
}

function ProtectedRoutes() {
  return <Show when="signed-in"><PortalShell><Switch><Route path="/dashboard" component={Dashboard} /><Route path="/models" component={ModelsPage} /><Route path="/api-keys" component={ApiKeysPage} /><Route path="/usage" component={UsagePage} /><Route path="/settings" component={SettingsPage} /><Route path="/admin" component={AdminPage} /><Route path="/"><Redirect to="/dashboard" /></Route><Route component={NotFound} /></Switch></PortalShell></Show>;
}
function HomeRedirect() { return <><Show when="signed-in"><Redirect to="/dashboard" /></Show><Show when="signed-out"><Landing /></Show></>; }
function NotFound() { return <div className="grid min-h-[100dvh] place-items-center bg-[#111a2e] p-6 text-center text-[#f9f6ef]"><div><p className="mono text-xs text-[#ffb097]">ERROR / 404</p><h1 className="mt-4 text-5xl font-extrabold tracking-[-.06em]">Route not found.</h1><p className="mt-3 text-sm text-[#9ea9b9]">The signal you requested is not on this map.</p><Link href="/dashboard" data-testid="link-return-dashboard" className="mt-7 inline-block rounded-lg bg-[#ff6b35] px-5 py-3 text-sm font-bold text-[#111a2e]">Return to console</Link></div></div>; }
function ClerkQueryBridge() { return null; }

function RouterView() {
  return <Switch><Route path="/" component={HomeRedirect} /><Route path="/sign-in/*?" component={() => <AuthPage />} /><Route path="/sign-up/*?" component={() => <AuthPage signUp />} /><Route path="/dashboard" component={ProtectedRoutes} /><Route path="/models" component={ProtectedRoutes} /><Route path="/api-keys" component={ProtectedRoutes} /><Route path="/usage" component={ProtectedRoutes} /><Route path="/settings" component={ProtectedRoutes} /><Route path="/admin" component={ProtectedRoutes} /><Route component={NotFound} /></Switch>;
}

function App() {
  const [, setLocation] = useLocation();
  return <WouterRouter base={basePath}><ClerkProvider publishableKey={clerkPubKey} proxyUrl={clerkProxyUrl} appearance={clerkAppearance} signInUrl={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`} localization={{ signIn: { start: { title: 'Welcome back', subtitle: 'Route your next request with confidence' } }, signUp: { start: { title: 'Open your operator console', subtitle: 'The signal starts here' } } }} routerPush={(to: string) => setLocation(stripBase(to))} routerReplace={(to: string) => setLocation(stripBase(to), { replace: true })}><QueryClientProvider client={queryClient}><ClerkQueryBridge /><ErrorBoundary><RouterView /></ErrorBoundary><Toaster /></QueryClientProvider></ClerkProvider></WouterRouter>;
}

export default App;