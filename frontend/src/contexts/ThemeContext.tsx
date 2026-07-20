import React, { createContext, useContext, useState, useEffect } from 'react';

export interface EstablishmentTheme {
  id: string;
  name: string;
  slug: string;
  primary_color: string;
  secondary_color: string;
  background_color: string;
  text_color: string;
  opening_time: string;
  closing_time: string;
  slot_duration_minutes: number;
}

interface ThemeContextType {
  establishment: EstablishmentTheme | null;
  loading: boolean;
  loadEstablishmentBySlug: (slug: string) => Promise<void>;
  updateThemeColors: (newTheme: Partial<EstablishmentTheme>) => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [establishment, setEstablishment] = useState<EstablishmentTheme | null>(null);
  const [loading, setLoading] = useState(true);

  const applyCSSVariables = (theme: Partial<EstablishmentTheme>) => {
    if (theme.primary_color) {
      document.documentElement.style.setProperty('--primary', theme.primary_color);
      // Generate a slightly darker hover color dynamically
      document.documentElement.style.setProperty('--primary-hover', theme.primary_color + 'e0');
    }
    if (theme.secondary_color) {
      document.documentElement.style.setProperty('--secondary', theme.secondary_color);
    }
    if (theme.background_color) {
      document.documentElement.style.setProperty('--background', theme.background_color);
      // Adjust card border/shadow transparency based on bg color
      if (theme.background_color === '#ffffff' || theme.background_color === '#f5f5f5') {
        document.documentElement.style.setProperty('--card', '#ffffff');
        document.documentElement.style.setProperty('--foreground', '#121212');
        document.documentElement.style.setProperty('--input-bg', '#f0f0f0');
        document.documentElement.style.setProperty('--input-border', '#cccccc');
      } else {
        document.documentElement.style.setProperty('--card', '#1e1e1e');
        document.documentElement.style.setProperty('--foreground', '#f5f5f5');
        document.documentElement.style.setProperty('--input-bg', '#262626');
        document.documentElement.style.setProperty('--input-border', '#3d3d3d');
      }
    }
    if (theme.text_color) {
      document.documentElement.style.setProperty('--foreground', theme.text_color);
    }
  };

  const loadEstablishmentBySlug = async (slug: string) => {
    setLoading(true);
    try {
      const response = await fetch(`/api/establishments/slug/${slug}`);
      if (response.ok) {
        const data = await response.json();
        setEstablishment(data);
        applyCSSVariables(data);
      }
    } catch (err) {
      console.error('Failed to load establishment styles:', err);
    } finally {
      setLoading(false);
    }
  };

  // On initial load, read from slug in query parameters, subdomains, or default to 'classica'
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const slug = params.get('shop') || 'classica';
    loadEstablishmentBySlug(slug);
  }, []);

  const updateThemeColors = (newTheme: Partial<EstablishmentTheme>) => {
    if (establishment) {
      const updated = { ...establishment, ...newTheme };
      setEstablishment(updated);
      applyCSSVariables(updated);
    }
  };

  return (
    <ThemeContext.Provider value={{ establishment, loading, loadEstablishmentBySlug, updateThemeColors }}>
      {children}
    </ThemeContext.Provider>
  );
};

export const useEstablishmentTheme = () => {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useEstablishmentTheme must be used within a ThemeProvider');
  }
  return context;
};
