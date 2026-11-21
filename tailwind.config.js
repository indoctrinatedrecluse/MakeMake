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
          950: 'rgb(var(--obsidian-950) / <alpha-value>)',
          900: 'rgb(var(--obsidian-900) / <alpha-value>)',
          850: 'rgb(var(--obsidian-850) / <alpha-value>)',
          800: 'rgb(var(--obsidian-800) / <alpha-value>)',
          700: 'rgb(var(--obsidian-700) / <alpha-value>)',
          600: 'rgb(var(--obsidian-600) / <alpha-value>)',
        },
        cyber: {
          cyan: 'rgb(var(--cyber-cyan) / <alpha-value>)',
          teal: 'rgb(var(--cyber-teal) / <alpha-value>)',
          red: 'rgb(var(--cyber-red) / <alpha-value>)',
          vermilion: 'rgb(var(--cyber-vermilion) / <alpha-value>)',
          gold: 'rgb(var(--cyber-gold) / <alpha-value>)',
          amber: 'rgb(var(--cyber-amber) / <alpha-value>)',
          green: 'rgb(var(--cyber-green) / <alpha-value>)',
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
        'glow-cyan': '0 0 15px rgb(var(--cyber-cyan) / 0.4), 0 0 30px rgb(var(--cyber-cyan) / 0.2)',
        'glow-red': '0 0 15px rgb(var(--cyber-red) / 0.5), 0 0 30px rgb(var(--cyber-red) / 0.2)',
        'glow-gold': '0 0 15px rgb(var(--cyber-gold) / 0.4), 0 0 30px rgb(var(--cyber-gold) / 0.2)',
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
