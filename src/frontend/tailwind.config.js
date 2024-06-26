/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: ['class'],
  content: [
    './pages/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './app/**/*.{ts,tsx}',
    './src/**/*.{ts,tsx}',
  ],
  theme: {
    container: {
      center: true,
      padding: '2rem',
      screens: {
        '2xl': '1400px',
      },
    },
    extend: {
      fontFamily: {
        primary: ['Barlow Condensed', 'sans-serif'],
      },
      height: {
        'screen-nav': 'calc(100vh - 57px)',
      },
      colors: {
        red: '#D73F3F',
        redlight: '#FFEDED',
        orange: '#FAA71E',
        tan: '#F0EFEF',
        bluedark: '#2C3038',
        bluegrey: '#68707F',
        bluelight: '#929DB3',
        greylight: '#E1E0E0',
        grey: {
          50: '#FAFAFA',
          100: '#F5F5F5',
          200: '#E6E6E6',
          300: '#D7D7D7',
          400: '#BDBDBD',
          500: '#989898',
          600: '#757575',
          700: '#616161',
          800: '#484848',
          900: '#212121',
        },
      },

      fontSize: {
        'body-lg': [
          '0.938rem',
          {
            lineHeight: '1.25rem',
            fontWeight: '400',
            letterSpacing: '0',
          },
        ],
        'body-md': [
          '0.875rem',
          {
            lineHeight: '1.125rem',
            fontWeight: '400',
            letterSpacing: '0',
          },
        ],
        'body-sm': [
          '0.75rem',
          {
            lineHeight: '1rem',
            fontWeight: '400',
            letterSpacing: '0',
          },
        ],
        'body-btn': [
          '0.875rem',
          {
            lineHeight: '1.25rem',
            fontWeight: '700',
            letterSpacing: '0',
          },
        ],
        'tooltip-bold': [
          '0.75rem',
          {
            lineHeight: '1.125rem',
            fontWeight: '700',
            letterSpacing: '0',
          },
        ],
        'icon-md': [
          '1.5rem',
          {
            fontFamily: 'Material Icons Outlined',
            fontWeight: '400',
            lineHeight: '24px',
          },
        ],
        'icon-sm': [
          '1.125rem',
          {
            lineHeight: '1.125rem',
            fontWeight: '400',
            letterSpacing: '0',
          },
        ],
      },
      boxShadow: {
        '3xl': '0px 2px 20px 4px rgba(0, 0, 0, 0.20)',
        light: '0px 2px 20px 4px rgba(0, 0, 0, 0.12)',
        dark: '0px 4px 11px 0px rgba(0, 0, 0, 0.25);',
        top: '0px 0px 6px 0px rgba(0, 0, 0, 0.15)',
      },
      animation: {
        loader: 'loader 0.6s infinite alternate',
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up': 'accordion-up 0.2s ease-out',
        'fade-left': 'fade-left 0.3s both',
        'fade-right': 'fade-right 0.3s both',
        fade: 'fade 1s both',
        'fade-down': 'fade-down 1s both',
        'fade-up': 'fade-up 1s both',
        'flip-up': 'flip-up 1s both',
        'flip-down': 'flip-down 1s both',
        jump: 'jump .5s both',
        'jump-in': 'jump-in .5s both',
        'jump-out': 'jump-out .5s both',
      },

      keyframes: {
        loader: {
          to: {
            transform: 'translate3d(0, -0.6rem, 0)',
          },
        },
        fade: {
          '0%': {
            opacity: '0',
          },
          '100%': {
            opacity: '1',
          },
        },
        'fade-left': {
          '0%': {
            opacity: '0',
            transform: 'translateX(2rem)',
          },
          '100%': {
            opacity: '1',
            transform: 'translateX(0)',
          },
        },
        'fade-right': {
          '0%': {
            opacity: '0',
            transform: 'translateX(-2rem)',
          },
          '100%': {
            opacity: '1',
            transform: 'translateX(0)',
          },
        },
        'fade-down': {
          '0%': {
            opacity: '0',
            transform: 'translateY(-2rem)',
          },
          '100%': {
            opacity: '1',
            transform: 'translateY(0)',
          },
        },
        'fade-up': {
          '0%': {
            opacity: '0',
            transform: 'translateY(2rem)',
          },
          '100%': {
            opacity: '1',
            transform: 'translateY(0)',
          },
        },
        'flip-up': {
          '0%': {
            transform: 'rotateX(90deg)',
            transformOrigin: 'bottom',
          },
          '100%': {
            transform: 'rotateX(0)',
            transformOrigin: 'bottom',
          },
        },
        'flip-down': {
          '0%': {
            transform: 'rotateX(-90deg)',
            transformOrigin: 'top',
          },
          '100%': {
            transform: 'rotateX(0)',
            transformOrigin: 'top',
          },
        },
        jump: {
          '0%, 100%': {
            transform: 'scale(100%)',
          },
          '10%': {
            transform: 'scale(80%)',
          },
          '50%': {
            transform: 'scale(120%)',
          },
        },
        'jump-in': {
          '0%': {
            transform: 'scale(0%)',
          },
          '80%': {
            transform: 'scale(100%)',
          },
          '100%': {
            transform: 'scale(100%)',
          },
        },
        'jump-out': {
          '0%': {
            transform: 'scale(100%)',
          },
          '20%': {
            transform: 'scale(120%)',
          },
          '100%': {
            transform: 'scale(0%)',
          },
        },
      },
    },
    fontSize: {
      xs: '0.75rem',
      sm: '0.838rem',
      base: '1rem',
      lg: '1.063rem',
      xl: '1.25rem',
      '2xl': '1.563rem',
      '3xl': '1.953rem',
      '4xl': '2.441rem',
      '5xl': '3.052rem',
    },
  },
  plugins: [
    require('tailwindcss-animate'),
    require('@tailwindcss/container-queries'),
  ],
  prefix: 'naxatw-',
};
