// src/components/Header.js - UPDATED VERSION with cloud status and clear all button removed
import React, { memo, useMemo } from 'react';
import { LogOut, User, Shield, LifeBuoy, FileText, Menu, HelpCircle } from 'lucide-react';
import { handleLogout } from '../services/authService';
import { hasAdminRole } from '../utils/auth';
import { getTokenUsageStats } from '../utils/tokenUsage';

const Header = memo(({ 
  user,
  isSaving = false,
  lastSaveTime = null,
  onShowAdmin,
  onShowProfile,
  onOpenNotebook,
  onShowRAGConfig,
  onOpenSupport,
  onLogout
}) => {
  // Enhanced admin detection with debugging
  const isAdmin = useMemo(() => hasAdminRole(user), [user]);

  // Debug user object in development
  React.useEffect(() => {
    if (user && process.env.NODE_ENV === 'development') {
      console.log('=== HEADER USER DEBUG ===');
      console.log('Full user object:', user);
      console.log('User roles:', user.roles);
      console.log('User roles type:', typeof user.roles);
      console.log('Is array?:', Array.isArray(user.roles));
      console.log('Has admin role:', hasAdminRole(user));
      console.log('isAdmin result:', isAdmin);
      console.log('=========================');
    }
  }, [user, isAdmin]);

  const handleLogoutClick = async () => {
    try {
      await handleLogout();
      if (onLogout) {
        onLogout();
      }
    } catch (error) {
      console.error('Logout failed:', error);
    }
  };

  // Debug admin click handler
  const handleAdminClick = () => {
    console.log('Admin button clicked');
    console.log('onShowAdmin function:', typeof onShowAdmin);
    console.log('onShowAdmin exists:', !!onShowAdmin);
    
    if (onShowAdmin) {
      onShowAdmin();
    } else {
      console.error('onShowAdmin function not provided to Header component');
      alert('Admin function not available. Check console for details.');
    }
  };

  // Support handled by parent via onOpenSupport

  const displayName = user?.email || user?.name || 'User';
  const roleLabel = user?.roles?.length ? user.roles.join(', ') : null;

  const orgLabel = user?.organization || null;

  const [menuOpen, setMenuOpen] = React.useState(false);
  const [monthlyTokens, setMonthlyTokens] = React.useState(0);

  React.useEffect(() => {
    if (menuOpen) {
      const stats = getTokenUsageStats();
      const currentMonth = stats.monthly[stats.monthly.length - 1];
      setMonthlyTokens(currentMonth?.tokens || 0);
    }
  }, [menuOpen]);

  return (
    <header className="bg-gray-50 border-b border-gray-200">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center h-16">
          <div className="flex-shrink-0 flex items-center space-x-2">
            <img
              src="/AceleraQA_logo.png"
              alt="AcceleraQA logo"
              width="180"
              height="20"
            />
            <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">| Beta</span>
          </div>

          <div className="relative flex items-center space-x-4 ml-auto">
            {/* User Info */}
            <div className="flex items-center space-x-2 text-sm text-gray-700">
              <User className="h-4 w-4 text-gray-500" />
              <span className="hidden sm:block whitespace-nowrap">
                {displayName}
                {roleLabel
                  ? ` (${roleLabel}${orgLabel ? ` / ${orgLabel}` : ''})`
                  : orgLabel
                    ? ` (${orgLabel})`
                    : ''}
              </span>
            </div>
            {/* Menu toggle */}
            <button
              onClick={() => setMenuOpen((prev) => !prev)}
              className="p-2 rounded hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-gray-300"
              aria-label="Toggle menu"
            >
              <Menu className="h-5 w-5 text-gray-700" />
            </button>

            {menuOpen && (
              <div className="absolute right-0 top-full mt-2 w-56 bg-white border border-gray-200 rounded-md shadow-lg py-1 z-50">
                <button
                  onClick={() => {
                    onShowProfile();
                    setMenuOpen(false);
                  }}
                  className="flex w-full items-center px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                  aria-label="View your profile"
                >
                  <User className="h-4 w-4 mr-2" />
                  Your Profile
                </button>

                {isAdmin && (
                  <button
                    onClick={() => {
                      handleAdminClick();
                      setMenuOpen(false);
                    }}
                    className="flex w-full items-center px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                    aria-label="Access admin panel"
                  >
                    <Shield className="h-4 w-4 mr-2" />
                    Admin
                  </button>
                )}

                <button
                  onClick={() => {
                    onOpenNotebook();
                    setMenuOpen(false);
                  }}
                  className="flex w-full items-center px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                  aria-label="Open notebook"
                >
                  <svg className="h-4 w-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.746 0 3.332.477 4.5 1.253v13C19.832 18.477 18.246 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                  </svg>
                  Open Notebook
                </button>

                <button
                  onClick={() => {
                    onShowRAGConfig();
                    setMenuOpen(false);
                  }}
                  className="flex w-full items-center px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                  aria-label="Manage personal resources"
                >
                  <FileText className="h-4 w-4 mr-2" />
                  My Resources
                </button>

                <a
                  href="https://acceleraqa-main.netlify.app/privacy"
                  onClick={() => setMenuOpen(false)}
                  className="flex w-full items-center px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                  aria-label="View terms and policies"
                >
                  <FileText className="h-4 w-4 mr-2" />
                  Terms & Policies
                </a>

                <a
                  href="/help.html"
                  onClick={() => setMenuOpen(false)}
                  className="flex w-full items-center px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                  aria-label="View help information"
                >
                  <HelpCircle className="h-4 w-4 mr-2" />
                  Help
                </a>

                <button
                  onClick={() => {
                    onOpenSupport();
                    setMenuOpen(false);
                  }}
                  className="flex w-full items-center px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                  aria-label="Raise support request"
                >
                  <LifeBuoy className="h-4 w-4 mr-2" />
                  Support
                </button>

                <button
                  onClick={() => {
                    handleLogoutClick();
                    setMenuOpen(false);
                  }}
                  className="flex w-full items-center px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                  aria-label="Sign out of AcceleraQA"
                >
                  <LogOut className="h-4 w-4 mr-2" />
                  Sign Out
                </button>
                <div className="border-t my-1"></div>
                <div className="px-4 py-2 text-xs text-gray-500">
                  Monthly Tokens Used: {monthlyTokens}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
});

Header.displayName = 'Header';

export default Header;
