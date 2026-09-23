/** Tailwind offline build config — `npm run build:css` */
module.exports = {
  content: ['./index.html', './app.js'],
  safelist: [
    'hidden', 'drag-over', 'rez-draggable', 'light-theme', 'translate-x-full', '-translate-x-full', 'opacity-0', 'translate-y-2'
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'Segoe UI', 'Roboto', 'Helvetica Neue', 'Arial', 'system-ui', 'sans-serif']
      }
    }
  },
  plugins: []
};
