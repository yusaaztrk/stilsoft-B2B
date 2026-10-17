export default {
  content: ["./src/**/*.{js,jsx,ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        inter: ['Inter Variable', 'Inter', 'sans-serif'],
        display: ['Inter Variable', 'Inter', 'sans-serif'],
        sans: ['Inter Variable', 'Inter', 'sans-serif'],
        outfit: ['Outfit', 'sans-serif'],
        jakarta: ['Plus Jakarta Sans', 'sans-serif']
      },
      colors: {
        'brand-header': '#B73A0B',
        'brand-orange': '#D84315',
        'brand-blue': '#4A90E2',
        'brand-teal': '#0097A7',
        'brand-navy': '#1A237E'
      },
      animation: {
        fadeIn: 'fadeIn 0.5s ease-in-out'
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0', transform: 'translateY(20px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' }
        }
      }
    }
  },
  plugins: []
}
