import React, { createContext, useContext, useState, useEffect } from 'react';
import { apiRequest, setAuthToken, getAuthToken } from '../services/api';

export interface User {
  id: string;
  name: string;
  email: string;
  role: 'admin' | 'owner' | 'barber';
  establishment_id: string | null;
  requirePasswordChange?: boolean;
  establishment_expires_at?: string;
}

interface AuthContextType {
  user: User | null;
  token: string | null;
  loading: boolean;
  revocationReason: 'revoked' | 'expired' | null;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  reloadUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [token, setTokenState] = useState<string | null>(getAuthToken());
  const [loading, setLoading] = useState(true);
  const [revocationReason, setRevocationReason] = useState<'revoked' | 'expired' | null>(null);

  const reloadUser = async () => {
    const currentToken = getAuthToken();
    if (!currentToken) {
      setUser(null);
      setTokenState(null);
      setLoading(false);
      return;
    }

    try {
      const userData = await apiRequest('/auth/me', 'GET');
      setUser(userData);
      setRevocationReason(null);
    } catch (err: any) {
      console.error('Failed to load user profile:', err);
      if (err.message) {
        if (err.message.includes('expirado') || err.message.includes('assinatura')) {
          setRevocationReason('expired');
        } else if (err.message.includes('revogado') || err.message.includes('suspenso')) {
          setRevocationReason('revoked');
        } else {
          // Clean invalid token
          setAuthToken(null);
          setTokenState(null);
          setUser(null);
        }
      } else {
        // Clean invalid token
        setAuthToken(null);
        setTokenState(null);
        setUser(null);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    reloadUser();
  }, []);

  const login = async (email: string, password: string) => {
    setLoading(true);
    setRevocationReason(null);
    try {
      const response = await apiRequest('/auth/login', 'POST', { email, password });
      setAuthToken(response.token);
      setTokenState(response.token);
      setUser(response.user);
    } catch (err: any) {
      setLoading(false);
      if (err.message) {
        if (err.message.includes('expirado') || err.message.includes('assinatura')) {
          setRevocationReason('expired');
        } else if (err.message.includes('revogado') || err.message.includes('suspenso')) {
          setRevocationReason('revoked');
        }
      }
      throw err;
    } finally {
      setLoading(false);
    }
  };

  const logout = () => {
    setAuthToken(null);
    setTokenState(null);
    setUser(null);
    setRevocationReason(null);
    window.location.href = '/login';
  };

  return (
    <AuthContext.Provider value={{ user, token, loading, revocationReason, login, logout, reloadUser }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
