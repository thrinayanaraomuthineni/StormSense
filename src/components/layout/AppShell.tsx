import React, { useState } from 'react';
import {
  Activity,
  BarChart3,
  Bell,
  Bot,
  CloudLightning,
  CloudRain,
  LayoutDashboard,
  LogOut,
  Map as MapIcon,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  RefreshCw,
  Settings,
  ShieldAlert,
  Truck,
  X,
  Zap,
} from 'lucide-react';
import { type PageId, useStormSense } from '../../context/StormSenseContext';
import { AtmosphericBackdrop } from '../graphics/AtmosphericBackdrop';
import { ErrorBanner, formatIstDateTime } from '../ui/DataProvenanceTag';

const NAV_ITEMS: Array<{ id: PageId; label: string; icon: React.ComponentType<{ className?: string }> }> = [
  { id: 'command', label: 'Command Center', icon: LayoutDashboard },
  { id: 'weather', label: 'Weather Intelligence', icon: CloudLightning },
  { id: 'risk', label: 'Outage Risk Prediction', icon: Activity },
  { id: 'simulation', label: 'Storm Simulation Lab', icon: CloudRain },
  { id: 'map', label: 'Telangana GIS Map', icon: MapIcon },
  { id: 'incidents', label: 'Incident Management', icon: ShieldAlert },
  { id: 'dispatch', label: 'Smart Crew Dispatch', icon: Truck },
  { id: 'ai', label: 'AI Intelligence Center', icon: Bot },
  { id: 'alerts', label: 'Alert Management', icon: Bell },
  { id: 'analytics', label: 'Reports & Analytics', icon: BarChart3 },
  { id: 'settings', label: 'Settings & Config', icon: Settings },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const {
    currentUser,
    logout,
    activePage,
    setActivePage,
    weather,
    alertSummary,
    isRefreshingWeather,
    refreshWeather,
    globalError,
    reloadState,
  } = useStormSense();

  const [collapsed, setCollapsed] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const unreadAlerts = alertSummary.unread;
  const activeItem = NAV_ITEMS.find((n) => n.id === activePage) || NAV_ITEMS[0];
  const isWeatherFocused = activePage === 'weather' || activePage === 'simulation' || activePage === 'command';

  const handleNav = (id: PageId) => {
    setActivePage(id);
    setMobileMenuOpen(false);
  };

  return (
    <div className="min-h-screen ss-atmospheric-backdrop text-[#E5EDF3] flex relative">
      {/* Animated atmospheric mist, pressure contours & curved wind-flow particles */}
      <AtmosphericBackdrop intensity="subtle" showPrecipitation={isWeatherFocused} />

      {/* Desktop Sidebar */}
      <aside
        aria-label="Primary Navigation"
        className={`relative z-10 hidden lg:flex flex-col border-r border-[#60788A]/80 bg-[#344655]/95 transition-all duration-200 shrink-0 ${
          collapsed ? 'w-[72px]' : 'w-64'
        }`}
      >
        <div className="h-16 px-4 flex items-center justify-between border-b border-[#60788A]/70 bg-[#3B5061]/90">
          <div className="flex items-center gap-2.5 overflow-hidden">
            <div className="w-8 h-8 rounded-md bg-[#70A9CF]/18 border border-[#70A9CF]/45 flex items-center justify-center shrink-0">
              <Zap className="w-4 h-4 text-[#70A9CF]" aria-hidden="true" />
            </div>
            {!collapsed && (
              <div className="truncate">
                <span className="font-display font-bold text-base tracking-tight text-[#E5EDF3] block leading-none">
                  StormSense
                </span>
                <span className="text-[11px] text-[#8FA3B3] block mt-0.5 truncate">
                  Telangana Dept. of Energy
                </span>
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={() => setCollapsed((c) => !c)}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className="p-1.5 rounded text-[#8FA3B3] hover:text-[#E5EDF3] hover:bg-[#43596A] transition-colors"
          >
            {collapsed ? <PanelLeftOpen className="w-4 h-4" /> : <PanelLeftClose className="w-4 h-4" />}
          </button>
        </div>

        <nav className="flex-1 py-3 px-2.5 space-y-1 overflow-y-auto">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive = activePage === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => handleNav(item.id)}
                title={collapsed ? item.label : undefined}
                aria-current={isActive ? 'page' : undefined}
                className={`w-full flex items-center justify-between px-3 py-2.5 rounded-md text-sm font-medium transition-all duration-150 ${
                  isActive
                    ? 'bg-[#43596A] text-[#E5EDF3] border border-[#70A9CF]/55 shadow-[0_4px_12px_rgba(15,24,32,0.24)]'
                    : 'text-[#AABBC9] hover:text-[#E5EDF3] hover:bg-[#3B5061]/80 border border-transparent'
                }`}
              >
                <span className="flex items-center gap-3 min-w-0">
                  <Icon
                    className={`w-4 h-4 shrink-0 ${isActive ? 'text-[#55B7B0]' : 'text-[#8FA3B3]'}`}
                    aria-hidden="true"
                  />
                  {!collapsed && <span className="truncate">{item.label}</span>}
                </span>
                {!collapsed && item.id === 'alerts' && unreadAlerts > 0 && (
                  <span className="font-mono tabular-nums text-xs px-1.5 py-0.5 rounded bg-[#E36D6D]/22 text-[#F29B9B] border border-[#E36D6D]/50">
                    {unreadAlerts}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        <div className="p-3 border-t border-[#60788A]/70 bg-[#3B5061]/85 space-y-2">
          {!collapsed && currentUser && (
            <div className="px-2 py-1.5">
              <div className="text-xs font-semibold text-[#E5EDF3] truncate">{currentUser.name}</div>
              <div className="text-[11px] text-[#55B7B0] font-medium truncate">
                {currentUser.role} · {currentUser.discom}
              </div>
            </div>
          )}
          <button
            type="button"
            onClick={logout}
            aria-label="Sign out"
            className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-md text-xs font-medium text-[#E5EDF3] bg-[#43596A] hover:bg-[#4F687B] border border-[#60788A] transition-colors"
          >
            <LogOut className="w-3.5 h-3.5 shrink-0 text-[#70A9CF]" aria-hidden="true" />
            {!collapsed && <span>Switch Account / Sign Out</span>}
          </button>
        </div>
      </aside>

      {/* Mobile Drawer */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div
            className="fixed inset-0 bg-[#1B2630]/65 backdrop-blur-xs"
            onClick={() => setMobileMenuOpen(false)}
            aria-hidden="true"
          />
          <aside className="relative w-72 max-w-[85vw] bg-[#344655] border-r border-[#60788A] flex flex-col z-10 shadow-2xl">
            <div className="h-14 px-4 flex items-center justify-between border-b border-[#60788A]/80 bg-[#3B5061]">
              <span className="font-display font-bold text-base text-[#E5EDF3]">StormSense</span>
              <button
                type="button"
                onClick={() => setMobileMenuOpen(false)}
                aria-label="Close navigation menu"
                className="p-2 text-[#AABBC9] hover:text-[#E5EDF3]"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
              {NAV_ITEMS.map((item) => {
                const Icon = item.icon;
                const isActive = activePage === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => handleNav(item.id)}
                    className={`w-full flex items-center justify-between px-3 py-2.5 rounded-md text-sm font-medium ${
                      isActive
                        ? 'bg-[#43596A] text-[#E5EDF3] border border-[#70A9CF]/55'
                        : 'text-[#AABBC9] hover:bg-[#3B5061]'
                    }`}
                  >
                    <span className="flex items-center gap-3">
                      <Icon className={`w-4 h-4 shrink-0 ${isActive ? 'text-[#55B7B0]' : 'text-[#8FA3B3]'}`} />
                      <span>{item.label}</span>
                    </span>
                    {item.id === 'alerts' && unreadAlerts > 0 && (
                      <span className="font-mono text-xs text-[#F29B9B] font-semibold">{unreadAlerts}</span>
                    )}
                  </button>
                );
              })}
            </nav>
            <div className="p-3 border-t border-[#60788A]/80 bg-[#3B5061]">
              <button
                type="button"
                onClick={logout}
                className="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-md text-xs font-medium text-[#E5EDF3] bg-[#43596A] border border-[#60788A]"
              >
                <LogOut className="w-4 h-4 text-[#70A9CF]" />
                <span>Sign Out ({currentUser?.role})</span>
              </button>
            </div>
          </aside>
        </div>
      )}

      {/* Main Content */}
      <div className="relative z-10 flex-1 flex flex-col min-w-0">
        <header className="h-16 px-4 lg:px-6 border-b border-[#60788A]/80 bg-[#3B5061]/95 flex items-center justify-between gap-4 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              aria-label="Open navigation menu"
              className="lg:hidden p-2 rounded-md text-[#AABBC9] hover:text-[#E5EDF3] hover:bg-[#43596A]"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="min-w-0">
              <h1 className="font-display text-sm sm:text-base lg:text-lg font-semibold text-[#E5EDF3] truncate">
                {activeItem.label}
              </h1>
              <div className="text-[11px] sm:text-xs text-[#8FA3B3] flex items-center gap-1.5 sm:gap-2 truncate">
                <span className="hidden sm:inline">Open-Meteo Feed:</span>
                <span
                  className={
                    weather.status === 'live'
                      ? 'text-[#5AC49E] font-semibold'
                      : weather.status === 'stale'
                        ? 'text-[#E5A94C] font-semibold'
                        : 'text-[#F29B9B] font-semibold'
                  }
                >
                  {weather.status === 'live'
                    ? 'Live'
                    : weather.status === 'stale'
                      ? 'Stale Cache'
                      : 'Unavailable'}
                </span>
                {weather.lastUpdated && (
                  <>
                    <span aria-hidden="true" className="text-[#60788A]">·</span>
                    <span className="font-mono tabular-nums text-[#AABBC9] truncate">
                      {formatIstDateTime(weather.lastUpdated)}
                    </span>
                  </>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setActivePage('alerts')}
              aria-label={`Open Alert Management (${unreadAlerts} unread)`}
              className="relative px-2.5 sm:px-3 py-2 rounded-md text-xs font-medium text-[#E5EDF3] bg-[#43596A] border border-[#60788A] hover:border-[#70A9CF] transition-colors flex items-center gap-1.5 sm:gap-2 whitespace-nowrap shrink-0"
            >
              <Bell className="w-3.5 h-3.5 text-[#70A9CF]" aria-hidden="true" />
              <span className="hidden sm:inline">Alerts</span>
              <span className="font-mono tabular-nums font-semibold text-[#55B7B0]">{unreadAlerts}</span>
            </button>

            <button
              type="button"
              onClick={refreshWeather}
              disabled={isRefreshingWeather}
              className="px-2.5 sm:px-3.5 py-2 rounded-md text-xs font-semibold text-[#17222B] bg-[#70A9CF] hover:bg-[#5E97BD] disabled:opacity-60 transition-colors flex items-center gap-1.5 sm:gap-2 whitespace-nowrap shrink-0 shadow-xs"
            >
              <RefreshCw
                className={`w-3.5 h-3.5 ${isRefreshingWeather ? 'animate-spin' : ''}`}
                aria-hidden="true"
              />
              <span className="sm:hidden">{isRefreshingWeather ? 'Syncing' : 'Refresh'}</span>
              <span className="hidden sm:inline">
                {isRefreshingWeather ? 'Refreshing...' : 'Refresh Weather'}
              </span>
            </button>
          </div>
        </header>

        <main className="flex-1 p-4 lg:p-6 overflow-y-auto space-y-4">
          {globalError && <ErrorBanner message={globalError} onRetry={reloadState} />}
          {weather.status === 'stale' && weather.errorMessage && (
            <div
              role="status"
              className="px-4 py-2.5 rounded-lg bg-[#E5A94C]/18 border border-[#E5A94C]/50 text-[#F2C16E] text-xs flex items-center justify-between gap-3"
            >
              <span>{weather.errorMessage}</span>
              <button
                type="button"
                onClick={refreshWeather}
                className="px-2.5 py-1 rounded bg-[#3B5061] hover:bg-[#43596A] text-[#E5EDF3] border border-[#E5A94C]/50 font-medium whitespace-nowrap shrink-0"
              >
                Retry Live Sync
              </button>
            </div>
          )}
          {weather.status === 'error' && weather.errorMessage && (
            <ErrorBanner message={weather.errorMessage} onRetry={refreshWeather} />
          )}
          <div key={activePage} className="ss-page-enter">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
