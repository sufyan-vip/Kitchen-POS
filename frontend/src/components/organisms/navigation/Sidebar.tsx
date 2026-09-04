import { Button } from '../../../components/atoms';
import React, { useState } from 'react';
import { NavLink } from 'react-router-dom';
import { SvgIcon } from '../../../components/atoms/svg-sprite-loader';
import { api } from '../../../lib/ipc';
import { hasPermission } from '../../../lib/permissions';
import { useAuthStore } from '../../../store/auth';

interface SidebarProps {
  isCollapsed: boolean;
  isMobileOpen: boolean;
  isSidebarPermanent: boolean;
  isPointerFine: boolean;
  onCloseMobileDrawer: () => void;
  onToggleSidebar?: () => void;
}

const navItems = [
  { name: "Dashboard", path: "/dashboard", icon: "dashboard", permission: "reports" },
  { name: "Tables", path: "/tables", icon: "grid", permission: "table_viewing" },
  { name: "Order", path: "/order/0", icon: "list", permission: "orders_create" },
  { name: "KDS", path: "/kds", icon: "chef-hat", permission: "kot_view" },
  { name: "Past Orders", path: "/past-orders", icon: "clock", permission: "reports" },
  { name: "Customers", path: "/customers", icon: "users", permission: "customers_view" },
  { name: "Menu", path: "/menu", icon: "book-open", permission: "menu_viewing" },
  { name: "Inventory", path: "/inventory", icon: "inventory", permission: "inventory_view" },
  { name: "Purchasing", path: "/purchasing", icon: "checklist", permission: "purchasing_view" },
  { name: "Expenses", path: "/expenses", icon: "dollar", permission: "expenses_view" },
  { name: "Reports", path: "/reports", icon: "analytics", permission: "reports" },
  { name: "Staff", path: "/staff", icon: "user", permission: "staff" },
  { name: "Settings", path: "/settings", icon: "settings", permission: "settings" },
];

const navItemsForRole = (role: string | undefined): typeof navItems =>
  navItems.filter(item => hasPermission(role ?? null, item.permission));

const Sidebar: React.FC<SidebarProps> = ({
  isCollapsed,
  isMobileOpen,
  isSidebarPermanent,
  isPointerFine,
  onCloseMobileDrawer,
  onToggleSidebar,
}) => {
  // Hover state — only meaningful on pointer (mouse/trackpad) devices
  const [isHovered, setIsHovered] = useState(false);
  const [isKdsEnabled, setIsKdsEnabled] = useState(true);

  React.useEffect(() => {
    const fetchSettings = () => {
      api.settings.get().then(res => {
        if (res.success && res.data) {
          setIsKdsEnabled((res.data as Record<string, unknown>).is_kds_enabled !== false);
        }
      }).catch(console.error);
    };
    fetchSettings();
    window.addEventListener('settings-updated', fetchSettings);
    return () => { window.removeEventListener('settings-updated', fetchSettings); };
  }, []);

  // Labels visible when: mobile open, OR desktop not-collapsed, OR desktop collapsed but hovered
  const isEffectivelyExpanded =
    !isSidebarPermanent || !isCollapsed || (isPointerFine && isHovered);

  const role = useAuthStore(state => state.staff?.role);
  const visibleNavItems = navItemsForRole(role).filter(item => {
    if (item.name === 'KDS' && !isKdsEnabled) { return false; }
    return true;
  });

  return (
    <aside
      onMouseEnter={isPointerFine ? () => { setIsHovered(true); } : undefined}
      onMouseLeave={isPointerFine ? () => { setIsHovered(false); } : undefined}
      className={[
        'fixed h-full z-50 flex flex-col bg-gray-900 text-white',
        'transition-[width,transform] duration-300 ease-in-out',
        // Slide in/out
        isSidebarPermanent || isMobileOpen ? 'translate-x-0' : '-translate-x-full',
        // Width
        isSidebarPermanent && isCollapsed && !isHovered ? 'w-[72px]' : 'w-[260px]',
      ].join(' ')}
    >

      {/* ── Header: Logo + Toggle ─────────────────────────────── */}
      <div className="flex items-center h-[72px] px-3 shrink-0 overflow-hidden border-b border-white/10">

        {/* Logo icon — always visible */}
        <img
          src="/logo-128.png"
          alt="S Restaurant"
          width={40}
          height={40}
          className="w-10 h-10 rounded-xl shrink-0 object-contain"
        />

        {/* App name — animate in/out with max-w trick */}
        <span className={[
          'ml-3 font-bold text-lg overflow-hidden whitespace-nowrap',
          'transition-all duration-300 ease-in-out',
          isEffectivelyExpanded ? 'max-w-[150px] opacity-100' : 'max-w-0 opacity-0',
        ].join(' ')}>
          S Restaurant
        </span>

        {/* Pin/unpin toggle — desktop + pointer device + currently expanded only */}
        {isSidebarPermanent && isPointerFine && isEffectivelyExpanded && onToggleSidebar && (
          <Button
            variant="ghost"
            size="icon"
            onClick={onToggleSidebar}
            className="ml-auto text-white/60 hover:text-white hover:bg-white/10"
            aria-label={isCollapsed ? 'Pin sidebar' : 'Collapse sidebar'}
          >
            <SvgIcon name={isCollapsed ? "pinned" : "menu"} width="20" height="20" className="opacity-70 hover:opacity-100" />
          </Button>
        )}
      </div>

      {/* ── Nav Items ─────────────────────────────────────────── */}
      <nav className="flex-1 py-4 space-y-1 overflow-y-auto overflow-x-hidden">
        {visibleNavItems.map((item) => (
          <NavLink
            key={item.name}
            to={item.path}
            onClick={onCloseMobileDrawer}
            className={({ isActive }) => [
              'flex items-center h-[46px] rounded-xl mx-3 relative group cursor-pointer',
              'transition-all duration-300 ease-in-out whitespace-nowrap',
              !isEffectivelyExpanded ? 'w-12' : 'w-[calc(100%-24px)]',
              isActive
                ? 'bg-white/15 text-white font-medium'
                : 'text-white/60 hover:text-white hover:bg-white/10',
            ].join(' ')}
          >
            {/* Icon — always visible, fixed width */}
            <div className="w-12 h-full flex items-center justify-center shrink-0">
              <SvgIcon name={item.icon} width="20" height="20" />
            </div>

            {/* Label — animate in/out */}
            <span className={[
              'text-sm overflow-hidden transition-all duration-300 ease-in-out',
              isEffectivelyExpanded ? 'max-w-[160px] opacity-100' : 'max-w-0 opacity-0',
            ].join(' ')}>
              {item.name}
            </span>

            {/* Tooltip — only when collapsed on desktop */}
            {!isEffectivelyExpanded && (
              <span className={[
                'absolute left-[calc(100%+8px)] px-2.5 py-1.5 z-50',
                'bg-gray-900 text-white text-xs rounded shadow-lg font-medium whitespace-nowrap',
                'opacity-0 group-hover:opacity-100 pointer-events-none',
                'transition-opacity duration-150',
                'hidden group-hover:inline-block',
              ].join(' ')}>
                {item.name}
              </span>
            )}
          </NavLink>
        ))}
      </nav>

    </aside>
  );
};

export default Sidebar;
