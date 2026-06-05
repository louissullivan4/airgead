// Tailwind v4 runs as a PostCSS plugin. This is the whole config — the design
// tokens live in src/app/globals.css (@theme), not a tailwind.config.js.
const config = {
  plugins: {
    "@tailwindcss/postcss": {},
  },
};

export default config;
