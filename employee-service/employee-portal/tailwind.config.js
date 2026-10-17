/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        bronze: {
          50: '#faf7f2',
          100: '#f4ede0',
          200: '#e8dac2',
          300: '#d7c09e',
          400: '#c5a059',
          500: '#b88e53',
          600: '#a67c43',
          700: '#8c6538',
          800: '#735230',
          900: '#5e432a',
          950: '#332314'
        },
        ivory: {
          50: '#fdfdfc',
          100: '#faf9f6',
          200: '#f5f4ee',
          300: '#ebe9df',
          400: '#dedad0',
          500: '#ccc6b8'
        },
        obsidian: {
          800: '#222222',
          850: '#1a1a1a',
          900: '#141414',
          950: '#0e0e0e'
        }
      },
      fontFamily: {
        serif: ['Newsreader', 'Playfair Display', 'Cormorant Garamond', 'Georgia', 'serif'],
        display: ['Playfair Display', 'Newsreader', 'Georgia', 'serif'],
        sans: ['"Plus Jakarta Sans"', 'Inter', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif']
      }
    }
  },
  plugins: []
}


