/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        obsidian: {
          950: '#05070a',
          900: '#090d14',
          850: '#0d131d',
          800: '#141c2b',
          700: '#1c2638',
          600: '#28354c',
        },
        cyber: {
          cyan: '#00f0ff',
          teal: '#00c8b3',
          red: '#ff2a6d',
          vermilion: '#ff4438',
          gold: '#ffd000',
          amber: '#e5b869',
          green: '#10ffa0',
        },
        basalt: {
          light: '#3a4454',
          DEFAULT: '#222936',
          dark: '#161b24',
        }
      },
      fontFamily: {
        mono: ['"JetBrains Mono"', 'Fira Code', 'monospace'],
        cyber: ['Orbitron', 'Rajdhani', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        'glow-cyan': '0 0 15px rgba(0, 240, 255, 0.4), 0 0 30px rgba(0, 240, 255, 0.2)',
        'glow-red': '0 0 15px rgba(255, 42, 109, 0.5), 0 0 30px rgba(255, 42, 109, 0.2)',
        'glow-gold': '0 0 15px rgba(255, 208, 0, 0.4), 0 0 30px rgba(255, 208, 0, 0.2)',
        'obsidian-inner': 'inset 0 1px 3px rgba(255,255,255,0.05), inset 0 -2px 6px rgba(0,0,0,0.8)',
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'flicker': 'flicker 0.15s ease-in-out infinite alternate',
        'scanline': 'scanline 6s linear infinite',
        // Modals, menus and toasts were already asking for `animate-fadeIn`, which was never
        // defined — they simply appeared. This makes the request real.
        'fadeIn': 'fadeIn 0.18s ease-out',
      },
      keyframes: {
        scanline: {
          '0%': { transform: 'translateY(-100%)' },
          '100%': { transform: 'translateY(1000%)' },
        },
        fadeIn: {
          '0%': { opacity: '0', transform: 'translateY(6px) scale(0.995)' },
          '100%': { opacity: '1', transform: 'translateY(0) scale(1)' },
        },
      }
    },
  },
  plugins: [],
}
