/**
 * Earl's design system — the single source of visual truth.
 *
 * These tokens are defined here first (Phase 2's Astro pilot), and are the
 * exact palette/scale Phase 1 will extend across the rest of the app. Nothing
 * here is throwaway: it is the start of the shared system.
 */
export default {
  content: ['./src/**/*.{astro,html,js,jsx,ts,tsx,md,mdx}'],
  theme: {
    extend: {
      colors: {
        bg: '#f5f0e8',
        card: '#fffdf8',
        ink: '#1a1512',
        ink2: '#0a0a0f',
        muted: '#6a5c4a',
        line: '#e0d7c8',
        accent: '#7a5c3a',
        earl: '#efe7d8',
        // Marketing brand accent (the landing's gold).
        gold: '#c8a96e',
        golddark: '#a8884c',
        dark: '#1a1512',
      },
      fontFamily: {
        // Editorial pairing (matches the iconsrg.org family): Playfair Display
        // for display headings, Epilogue for body, Space Mono for tiny
        // instrument-style labels.
        display: ['Playfair Display', 'Georgia', 'serif'],
        ui: ['Epilogue', 'system-ui', 'sans-serif'],
        data: ['Space Mono', 'ui-monospace', 'monospace'],
        serif: ['Playfair Display', 'Georgia', 'serif'],
      },
      // Fluid type: scales smoothly between phone and desktop, no jumps.
      fontSize: {
        'fluid-sm': 'clamp(0.8rem, 0.75rem + 0.3vw, 0.95rem)',
        'fluid-base': 'clamp(1rem, 0.95rem + 0.4vw, 1.15rem)',
        'fluid-lg': 'clamp(1.15rem, 1rem + 0.8vw, 1.4rem)',
        'fluid-xl': 'clamp(1.5rem, 1.2rem + 1.6vw, 2.1rem)',
        'fluid-2xl': 'clamp(1.9rem, 1.4rem + 2.6vw, 3rem)',
        'fluid-3xl': 'clamp(2.2rem, 1.5rem + 3.4vw, 3.8rem)',
        'fluid-4xl': 'clamp(2.6rem, 1.6rem + 4.6vw, 4.7rem)',
      },
      maxWidth: {
        reading: '42rem',
      },
      keyframes: {
        drift: {
          '0%, 100%': { transform: 'translate3d(0,0,0) scale(1)' },
          '50%': { transform: 'translate3d(-3%, 2%, 0) scale(1.08)' },
        },
        marquee: {
          '0%': { transform: 'translateX(0)' },
          '100%': { transform: 'translateX(-50%)' },
        },
      },
      animation: {
        drift: 'drift 18s ease-in-out infinite',
        marquee: 'marquee 38s linear infinite',
      },
    },
  },
  plugins: [],
};
